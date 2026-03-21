const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

/**
 * Fuzzy Task Linking System
 * - Intelligently matches unlinked tasks to goals/stories
 * - Runs nightly to suggest and auto-link tasks
 * - Logs suggestions to activity stream
 * - Handles partial text matching with confidence scoring
 */

// Levenshtein Distance Algorithm for string similarity
function levenshteinDistance(str1, str2) {
  const track = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(0));
  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }
  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }
  return track[str2.length][str1.length];
}

// Calculate similarity score 0-1
function calculateSimilarity(str1, str2) {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(str1.toLowerCase().trim(), str2.toLowerCase().trim());
  return Math.max(0, 1 - distance / maxLen);
}

// Check for keyword overlap (bonus points for semantic similarity)
function hasKeywordOverlap(taskTitle, targetTitle) {
  const taskWords = taskTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const targetWords = targetTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const overlap = taskWords.filter(w => targetWords.includes(w)).length;
  return overlap > 0 ? (overlap / Math.max(taskWords.length, targetWords.length)) * 0.3 : 0;
}

// Combined similarity with keyword bonus
function calculateCombinedScore(taskTitle, targetTitle) {
  const similarity = calculateSimilarity(taskTitle, targetTitle);
  const keywords = hasKeywordOverlap(taskTitle, targetTitle);
  return Math.min(1.0, similarity + keywords);
}

function calculateStoryGoalScore(story, goal) {
  const storyTitle = (story?.title || '').toString();
  const storyDescription = (story?.description || '').toString();
  const goalTitle = (goal?.title || goal?.name || '').toString();

  const titleScore = calculateCombinedScore(storyTitle, goalTitle);
  const descriptionScore = storyDescription
    ? calculateCombinedScore(storyDescription.slice(0, 500), goalTitle)
    : 0;

  let combined = Math.max(titleScore, (titleScore * 0.75) + (descriptionScore * 0.25));
  const storyTheme = (story?.theme || '').toString().trim().toLowerCase();
  const goalTheme = (goal?.theme || '').toString().trim().toLowerCase();
  if (storyTheme && goalTheme && storyTheme === goalTheme) {
    combined += 0.15;
  }

  return Math.min(1.0, combined);
}

function findPotentialGoalMatchesForStory(story, goals) {
  const matches = [];
  for (const goal of goals) {
    const score = calculateStoryGoalScore(story, goal);
    if (score > 0.5) {
      matches.push({
        id: goal.id,
        title: goal.title || goal.name || '',
        score,
        type: 'goal'
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function tomorrowEndOfDayMillis() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 0, 0);
  return tomorrow.getTime();
}

async function ensureValidationTask({
  db,
  userId,
  sourceType,
  sourceId,
  sourceRef,
  sourceTitle,
  reason,
  suggestedType = null,
  suggestedId = null,
  suggestedRef = null,
  suggestedTitle = null,
  linkedGoalRef = null,
  linkedGoalTitle = null,
  confidence = null,
}) {
  const duplicateKey = `link_validation:${sourceType}:${sourceId}:${reason}`;
  const existing = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('duplicateKey', '==', duplicateKey)
    .where('status', 'in', [0, 1, 'open', 'todo', 'backlog'])
    .limit(1)
    .get();

  if (!existing.empty) return existing.docs[0].id;

  const dueDate = tomorrowEndOfDayMillis();
  const suggestedLabel = suggestedType && (suggestedRef || suggestedTitle)
    ? [suggestedRef, suggestedTitle].filter(Boolean).join(' · ')
    : '';
  const linkedGoalLabel = linkedGoalRef || linkedGoalTitle
    ? [linkedGoalRef, linkedGoalTitle].filter(Boolean).join(' · ')
    : '';
  const suggestedText = suggestedType && suggestedLabel
    ? ` Suggested ${suggestedType}: ${suggestedLabel}${linkedGoalLabel ? ` -> goal ${linkedGoalLabel}` : ''}${confidence != null ? ` (${confidence}% confidence)` : ''}.`
    : '';
  const title = reason === 'no_match'
    ? `Validate ${sourceType} linkage for ${sourceRef}${suggestedLabel ? ` -> ${suggestedLabel}` : ''}`
    : `Review low-confidence ${sourceType} linkage for ${sourceRef}${suggestedLabel ? ` -> ${suggestedLabel}` : ''}`;
  const description = `${sourceType.toUpperCase()}: ${sourceTitle || sourceRef}.${suggestedText}`.trim();

  const taskRef = db.collection('tasks').doc();
  await taskRef.set({
    ownerUid: userId,
    title,
    description,
    status: 0,
    dueDate,
    source: 'system',
    entry_method: 'auto:fuzzy_link_validation',
    task_type: 'task',
    duplicateKey,
    parentType: sourceType,
    parentId: sourceId,
    metadata: {
      validationReason: reason,
      sourceType,
      sourceId,
      sourceRef,
      suggestedType,
      suggestedId,
      confidence,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    syncState: 'dirty',
  }, { merge: true });

  return taskRef.id;
}

const ENABLE_FUZZY_VALIDATION_TASKS = false;

function createConfidenceTierCounts() {
  return {
    no_match: 0,
    low_confidence: 0,
    auto_linked: 0,
  };
}

function buildRunId(runType, context = null) {
  const executionId = String(context?.executionId || '').trim();
  const eventId = String(context?.eventId || '').trim();
  const suffix = executionId || eventId || String(Date.now());
  return `${runType}_${suffix}`;
}

async function persistLinkingRunMetrics({
  db,
  runId,
  runType,
  source,
  userId,
  confidenceTierCounts,
  scanned,
  matchesFound,
  suggestionsCreated,
  validationTasksCreated,
  autoLinked,
}) {
  await db.collection('linking_run_metrics').add({
    runId,
    runType,
    source,
    userId,
    confidenceTierCounts: {
      no_match: Number(confidenceTierCounts?.no_match || 0),
      low_confidence: Number(confidenceTierCounts?.low_confidence || 0),
      auto_linked: Number(confidenceTierCounts?.auto_linked || 0),
    },
    scanned: Number(scanned || 0),
    matchesFound: Number(matchesFound || 0),
    suggestionsCreated: Number(suggestionsCreated || 0),
    validationTasksCreated: Number(validationTasksCreated || 0),
    autoLinked: Number(autoLinked || 0),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function planTaskLinkUpdate(taskData, match) {
  const currentGoalId = taskData?.goalId || null;
  const currentStoryId = taskData?.storyId || null;

  if (!match || !match.type || !match.id) {
    return { shouldUpdate: false, reason: 'invalid_match', updateData: null };
  }

  if (match.type === 'goal') {
    if (currentGoalId === match.id) {
      return { shouldUpdate: false, reason: 'goal_unchanged', updateData: null };
    }
    if (currentGoalId) {
      return { shouldUpdate: false, reason: 'goal_already_linked', updateData: null };
    }
    return { shouldUpdate: true, reason: 'goal_null_to_value', updateData: { goalId: match.id } };
  }

  if (match.type === 'story') {
    if (currentStoryId === match.id) {
      const linkedGoalMatches = !match.linkedGoal || currentGoalId === match.linkedGoal;
      if (linkedGoalMatches) {
        return { shouldUpdate: false, reason: 'story_unchanged', updateData: null };
      }
      return { shouldUpdate: false, reason: 'story_goal_conflict', updateData: null };
    }
    if (currentStoryId) {
      return { shouldUpdate: false, reason: 'story_already_linked', updateData: null };
    }

    const updateData = { storyId: match.id };
    if (match.linkedGoal) {
      if (currentGoalId && currentGoalId !== match.linkedGoal) {
        return { shouldUpdate: false, reason: 'goal_conflict_with_story_link', updateData: null };
      }
      if (!currentGoalId) {
        updateData.goalId = match.linkedGoal;
      }
    }

    return { shouldUpdate: true, reason: 'story_null_to_value', updateData };
  }

  return { shouldUpdate: false, reason: 'unsupported_match_type', updateData: null };
}

const SUGGESTION_REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

async function ensureTaskSuggestion({
  db,
  task,
  userId,
  bestMatch,
  matches,
}) {
  const taskId = String(task?.id || '').trim();
  if (!taskId) return { created: false, suggestionId: null, suppressedByRecentRejection: false };

  const baseQuery = db.collection('task_suggestions')
    .where('taskId', '==', taskId)
    .where('userId', '==', userId)
    .where('suggestedType', '==', bestMatch.type)
    .where('suggestedId', '==', bestMatch.id)
    .limit(1);

  const pendingSnap = await baseQuery.where('status', '==', 'pending').get();
  if (!pendingSnap.empty) {
    return { created: false, suggestionId: pendingSnap.docs[0].id, suppressedByRecentRejection: false };
  }

  const rejectedSnap = await baseQuery.where('status', '==', 'rejected').get();
  if (!rejectedSnap.empty) {
    const now = Date.now();
    const recentRejection = rejectedSnap.docs.find((doc) => {
      const data = doc.data() || {};
      const reviewedAt = data.reviewedAt && typeof data.reviewedAt.toMillis === 'function'
        ? data.reviewedAt.toMillis()
        : Number(data.reviewedAt || 0);
      return reviewedAt > 0 && (now - reviewedAt) < SUGGESTION_REJECTION_COOLDOWN_MS;
    });
    if (recentRejection) {
      return { created: false, suggestionId: recentRejection.id, suppressedByRecentRejection: true };
    }
  }

  const suggestionRef = await db.collection('task_suggestions').add({
    taskId,
    userId,
    taskTitle: task.title,
    suggestedId: bestMatch.id,
    suggestedTitle: bestMatch.title,
    suggestedType: bestMatch.type,
    suggestedLinkedGoalId: bestMatch.linkedGoal || null,
    confidence: Math.round(bestMatch.score * 100),
    allMatches: {
      goals: matches.goals.slice(0, 3),
      stories: matches.stories.slice(0, 3)
    },
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    reviewed: false
  });

  return { created: true, suggestionId: suggestionRef.id, suppressedByRecentRejection: false };
}

async function ensureStoryGoalSuggestion({
  db,
  story,
  userId,
  bestMatch,
  matches,
}) {
  const storyId = String(story?.id || '').trim();
  if (!storyId) return { created: false, suggestionId: null, suppressedByRecentRejection: false };

  const baseQuery = db.collection('story_goal_suggestions')
    .where('storyId', '==', storyId)
    .where('userId', '==', userId)
    .where('suggestedGoalId', '==', bestMatch.id)
    .limit(1);

  const pendingSnap = await baseQuery.where('status', '==', 'pending').get();
  if (!pendingSnap.empty) {
    return { created: false, suggestionId: pendingSnap.docs[0].id, suppressedByRecentRejection: false };
  }

  const rejectedSnap = await baseQuery.where('status', '==', 'rejected').get();
  if (!rejectedSnap.empty) {
    const now = Date.now();
    const recentRejection = rejectedSnap.docs.find((doc) => {
      const data = doc.data() || {};
      const reviewedAt = data.reviewedAt && typeof data.reviewedAt.toMillis === 'function'
        ? data.reviewedAt.toMillis()
        : Number(data.reviewedAt || 0);
      return reviewedAt > 0 && (now - reviewedAt) < SUGGESTION_REJECTION_COOLDOWN_MS;
    });
    if (recentRejection) {
      return { created: false, suggestionId: recentRejection.id, suppressedByRecentRejection: true };
    }
  }

  const suggestionRef = await db.collection('story_goal_suggestions').add({
    storyId,
    userId,
    storyTitle: story.title || '',
    suggestedGoalId: bestMatch.id,
    suggestedGoalTitle: bestMatch.title,
    confidence: Math.round(bestMatch.score * 100),
    allMatches: matches.slice(0, 3),
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    reviewed: false
  });

  return { created: true, suggestionId: suggestionRef.id, suppressedByRecentRejection: false };
}

/**
 * Find potential matches for an unlinked task
 */
async function findPotentialMatches(db, userId, task, goals, stories) {
  const matches = {
    goals: [],
    stories: []
  };

  // Score against all goals
  for (const goal of goals) {
    const score = calculateCombinedScore(task.title || '', goal.title || '');
    if (score > 0.5) {
      // Only suggest if > 50% similar
      matches.goals.push({
        id: goal.id,
        ref: goal.ref || null,
        title: goal.title,
        score,
        type: 'goal'
      });
    }
  }

  // Score against all stories
  for (const story of stories) {
    const score = calculateCombinedScore(task.title || '', story.title || '');
    if (score > 0.5) {
      matches.stories.push({
        id: story.id,
        ref: story.referenceNumber || story.ref || null,
        title: story.title,
        score,
        type: 'story',
        linkedGoal: story.goalId,
        linkedGoalRef: (goals.find((goal) => goal.id === story.goalId) || {}).ref || null,
        linkedGoalTitle: (goals.find((goal) => goal.id === story.goalId) || {}).title || null,
      });
    }
  }

  // Sort by score descending
  matches.goals.sort((a, b) => b.score - a.score);
  matches.stories.sort((a, b) => b.score - a.score);

  return matches;
}

/**
 * Main function: Nightly task linking and deduplication
 * Runs via Cloud Scheduler every night at 2 AM UTC
 */
exports.nightlyTaskLinking = onSchedule(
  {
    schedule: '0 2 * * *', // 2 AM UTC daily
    timeoutSeconds: 540, // 9 minutes
    memory: '512MB',
    region: 'europe-west2'
  },
  async (context) => {
    const db = admin.firestore();
    const startedAt = Date.now();
    const runId = buildRunId('nightlyTaskLinking', context);
    const results = {
      runId,
      usersProcessed: 0,
      tasksScanned: 0,
      matchesFound: 0,
      autoLinked: 0,
      suggestionsCreated: 0,
      validationTasksCreated: 0,
      confidenceTierTotals: createConfidenceTierCounts(),
      errors: []
    };

    try {
      // Get all users
      const usersSnap = await db.collection('users').get();
      results.usersProcessed = usersSnap.size;

      for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const userRunCounts = createConfidenceTierCounts();
        let userTasksScanned = 0;
        let userMatchesFound = 0;
        let userSuggestionsCreated = 0;
        let userValidationTasksCreated = 0;
        let userAutoLinked = 0;

        try {
          // Get all unlinked tasks for this user
          const tasksSnap = await db
            .collection('tasks')
            .where('ownerUid', '==', userId)
            .where('goalId', '==', null)
            .limit(1000)
            .get();

          results.tasksScanned += tasksSnap.size;
          userTasksScanned += tasksSnap.size;

          if (tasksSnap.size === 0) {
            await persistLinkingRunMetrics({
              db,
              runId,
              runType: 'nightlyTaskLinking',
              source: 'nightly',
              userId,
              confidenceTierCounts: userRunCounts,
              scanned: userTasksScanned,
              matchesFound: userMatchesFound,
              suggestionsCreated: userSuggestionsCreated,
              validationTasksCreated: userValidationTasksCreated,
              autoLinked: userAutoLinked,
            });
            continue;
          }

          // Get all goals and stories
          const goalsSnap = await db
            .collection('goals')
            .where('ownerUid', '==', userId)
            .get();

          const storiesSnap = await db
            .collection('stories')
            .where('ownerUid', '==', userId)
            .get();

          const goals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const stories = storiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          if (goals.length === 0 && stories.length === 0) continue;

          // Process each unlinked task
          for (const taskDoc of tasksSnap.docs) {
            const task = { id: taskDoc.id, ...taskDoc.data() };

            // Skip if task is already archived/deleted
            if (task.status === 99 || task.deleted) continue;

            // Find potential matches
            const matches = await findPotentialMatches(db, userId, task, goals, stories);

            if (matches.goals.length === 0 && matches.stories.length === 0) {
              userRunCounts.no_match++;
              results.confidenceTierTotals.no_match++;
              if (ENABLE_FUZZY_VALIDATION_TASKS) {
                const taskRef = task.reference || `TK-${String(task.id).slice(-6).toUpperCase()}`;
                await ensureValidationTask({
                  db,
                  userId,
                  sourceType: 'task',
                  sourceId: task.id,
                  sourceRef: taskRef,
                  sourceTitle: task.title || taskRef,
                  reason: 'no_match',
                });
                results.validationTasksCreated++;
                userValidationTasksCreated++;
              }
              continue;
            }

            results.matchesFound++;
            userMatchesFound++;

            // Get best match
            const bestGoalMatch = matches.goals[0];
            const bestStoryMatch = matches.stories[0];
            const bestMatch = [bestGoalMatch, bestStoryMatch]
              .filter(Boolean)
              .sort((a, b) => b.score - a.score)[0];

            if (!bestMatch) continue;

            const previousGoalId = task.goalId || null;
            const previousStoryId = task.storyId || null;

            // AUTO-LINK if confidence > 85%
            if (bestMatch.score > 0.85) {
              const linkPlan = planTaskLinkUpdate(task, bestMatch);
              if (!linkPlan.shouldUpdate || !linkPlan.updateData) continue;

              await db.collection('tasks').doc(task.id).update(linkPlan.updateData);

              // Log to activity stream
              await db.collection('activity_stream').add({
                entityId: task.id,
                entityType: 'task',
                activityType: 'auto_linked',
                userId,
                userEmail: userDoc.data()?.email || 'system',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                fieldName: bestMatch.type === 'goal' ? 'goalId' : 'storyId',
                oldValue: bestMatch.type === 'goal' ? (previousGoalId || '') : (previousStoryId || ''),
                newValue: bestMatch.id,
                description: `Auto-linked task "${task.title}" to ${bestMatch.type} "${bestMatch.title}" (${(bestMatch.score * 100).toFixed(0)}% confidence)`,
                persona: task.persona || 'personal',
                referenceNumber: task.reference || '',
                source: 'system',
                sourceDetails: `fuzzyTaskLinking_v1_${bestMatch.score.toFixed(3)}`
              });

              results.autoLinked++;
              userRunCounts.auto_linked++;
              results.confidenceTierTotals.auto_linked++;
              userAutoLinked++;
            }
            // CREATE SUGGESTION if 65% < confidence <= 85%
            else if (bestMatch.score > 0.65) {
              const suggestionResult = await ensureTaskSuggestion({
                db,
                task,
                userId,
                bestMatch,
                matches,
              });

              if (suggestionResult.created) {
                await db.collection('activity_stream').add({
                  entityId: task.id,
                  entityType: 'task',
                  activityType: 'link_suggested',
                  userId,
                  userEmail: userDoc.data()?.email || 'system',
                  timestamp: admin.firestore.FieldValue.serverTimestamp(),
                  description: `Suggested linking task "${task.title}" to ${bestMatch.type} "${bestMatch.title}"`,
                  persona: task.persona || 'personal',
                  referenceNumber: task.reference || '',
                  source: 'system',
                  sourceDetails: `fuzzyTaskLinking_suggest_${bestMatch.score.toFixed(3)}`,
                  metadata: {
                    suggestionId: suggestionResult.suggestionId,
                    confidence: Math.round(bestMatch.score * 100),
                    topMatches: {
                      goals: matches.goals.slice(0, 2).map(m => ({ id: m.id, title: m.title, score: (m.score * 100).toFixed(0) + '%' })),
                      stories: matches.stories.slice(0, 2).map(m => ({ id: m.id, title: m.title, score: (m.score * 100).toFixed(0) + '%' }))
                    }
                  }
                });
              }

              if (suggestionResult.created) {
                results.suggestionsCreated++;
                userSuggestionsCreated++;
              }
              userRunCounts.low_confidence++;
              results.confidenceTierTotals.low_confidence++;
              if (ENABLE_FUZZY_VALIDATION_TASKS) {
                const taskRef = task.reference || `TK-${String(task.id).slice(-6).toUpperCase()}`;
                await ensureValidationTask({
                  db,
                  userId,
                  sourceType: 'task',
                  sourceId: task.id,
                  sourceRef: taskRef,
                  sourceTitle: task.title || taskRef,
                  reason: 'low_confidence',
                  suggestedType: bestMatch.type,
                  suggestedId: bestMatch.id,
                  suggestedRef: bestMatch.ref || null,
                  suggestedTitle: bestMatch.title,
                  linkedGoalRef: bestMatch.linkedGoalRef || null,
                  linkedGoalTitle: bestMatch.linkedGoalTitle || null,
                  confidence: Math.round(bestMatch.score * 100),
                });
                results.validationTasksCreated++;
                userValidationTasksCreated++;
              }
            }
          }

          await persistLinkingRunMetrics({
            db,
            runId,
            runType: 'nightlyTaskLinking',
            source: 'nightly',
            userId,
            confidenceTierCounts: userRunCounts,
            scanned: userTasksScanned,
            matchesFound: userMatchesFound,
            suggestionsCreated: userSuggestionsCreated,
            validationTasksCreated: userValidationTasksCreated,
            autoLinked: userAutoLinked,
          });
        } catch (userError) {
          results.errors.push(`User ${userId}: ${userError.message}`);
        }
      }

      // Log overall results
      await db.collection('system_logs').add({
        functionName: 'nightlyTaskLinking',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'success',
        results,
        durationMs: Date.now() - startedAt,
        runId,
      });

      console.log('✅ Nightly task linking complete:', results);
      return results;
    } catch (error) {
      console.error('❌ Nightly task linking failed:', error);
      await db
        .collection('system_logs')
        .add({
          functionName: 'nightlyTaskLinking',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: 'error',
          durationMs: Date.now() - startedAt,
          runId,
          error: error.message,
          stack: error.stack
        })
        .catch(logError => console.error('Failed to log error:', logError));
      throw error;
    }
  }
);

/**
 * Main function: Nightly story-to-goal linking
 * Links stories without goalId to likely goals using fuzzy similarity.
 */
exports.nightlyStoryGoalLinking = onSchedule(
  {
    schedule: '20 2 * * *', // 2:20 AM UTC daily
    timeoutSeconds: 540,
    memory: '512MB',
    region: 'europe-west2'
  },
  async (context) => {
    const db = admin.firestore();
    const startedAt = Date.now();
    const runId = buildRunId('nightlyStoryGoalLinking', context);
    const results = {
      runId,
      usersProcessed: 0,
      storiesScanned: 0,
      matchesFound: 0,
      autoLinked: 0,
      suggestionsCreated: 0,
      validationTasksCreated: 0,
      confidenceTierTotals: createConfidenceTierCounts(),
      errors: []
    };

    try {
      const usersSnap = await db.collection('users').get();
      results.usersProcessed = usersSnap.size;

      for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const userRunCounts = createConfidenceTierCounts();
        let userStoriesScanned = 0;
        let userMatchesFound = 0;
        let userSuggestionsCreated = 0;
        let userValidationTasksCreated = 0;
        let userAutoLinked = 0;

        try {
          const [storiesSnap, goalsSnap] = await Promise.all([
            db.collection('stories')
              .where('ownerUid', '==', userId)
              .where('goalId', '==', null)
              .limit(1000)
              .get(),
            db.collection('goals')
              .where('ownerUid', '==', userId)
              .get()
          ]);

          results.storiesScanned += storiesSnap.size;
          userStoriesScanned += storiesSnap.size;
          if (storiesSnap.empty || goalsSnap.empty) {
            await persistLinkingRunMetrics({
              db,
              runId,
              runType: 'nightlyStoryGoalLinking',
              source: 'nightly',
              userId,
              confidenceTierCounts: userRunCounts,
              scanned: userStoriesScanned,
              matchesFound: userMatchesFound,
              suggestionsCreated: userSuggestionsCreated,
              validationTasksCreated: userValidationTasksCreated,
              autoLinked: userAutoLinked,
            });
            continue;
          }

          const goals = goalsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

          for (const storyDoc of storiesSnap.docs) {
            const story = { id: storyDoc.id, ...storyDoc.data() };
            if (story.deleted || Number(story.status) === 99) continue;

            const matches = findPotentialGoalMatchesForStory(story, goals);
            const storyRef = story.ref || `ST-${String(story.id).slice(-6).toUpperCase()}`;
            if (!matches.length) {
              userRunCounts.no_match++;
              results.confidenceTierTotals.no_match++;
              await ensureValidationTask({
                db,
                userId,
                sourceType: 'story',
                sourceId: story.id,
                sourceRef: storyRef,
                sourceTitle: story.title || storyRef,
                reason: 'no_match',
              });
              results.validationTasksCreated++;
              userValidationTasksCreated++;
              continue;
            }

            results.matchesFound++;
            userMatchesFound++;
            const bestMatch = matches[0];

            if (bestMatch.score > 0.85) {
              await db.collection('stories').doc(story.id).set({
                goalId: bestMatch.id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });

              await db.collection('activity_stream').add({
                entityId: story.id,
                entityType: 'story',
                activityType: 'story_goal_auto_linked',
                userId,
                userEmail: userDoc.data()?.email || 'system',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                fieldName: 'goalId',
                oldValue: '',
                newValue: bestMatch.id,
                description: `Auto-linked story "${story.title || story.id}" to goal "${bestMatch.title}" (${(bestMatch.score * 100).toFixed(0)}% confidence)`,
                source: 'system',
                sourceDetails: `fuzzyStoryGoalLinking_v1_${bestMatch.score.toFixed(3)}`
              });

              results.autoLinked++;
              userRunCounts.auto_linked++;
              results.confidenceTierTotals.auto_linked++;
              userAutoLinked++;
            } else if (bestMatch.score > 0.65) {
              const suggestionResult = await ensureStoryGoalSuggestion({
                db,
                story,
                userId,
                bestMatch,
                matches,
              });

              if (suggestionResult.created) {
                await db.collection('activity_stream').add({
                  entityId: story.id,
                  entityType: 'story',
                  activityType: 'story_goal_link_suggested',
                  userId,
                  userEmail: userDoc.data()?.email || 'system',
                  timestamp: admin.firestore.FieldValue.serverTimestamp(),
                  description: `Suggested linking story "${story.title || story.id}" to goal "${bestMatch.title}"`,
                  source: 'system',
                  sourceDetails: `fuzzyStoryGoalLinking_suggest_${bestMatch.score.toFixed(3)}`,
                  metadata: {
                    suggestionId: suggestionResult.suggestionId,
                    confidence: Math.round(bestMatch.score * 100),
                    topMatches: matches.slice(0, 2).map((m) => ({
                      id: m.id,
                      title: m.title,
                      score: `${(m.score * 100).toFixed(0)}%`
                    }))
                  }
                });
              }

              if (suggestionResult.created) {
                results.suggestionsCreated++;
                userSuggestionsCreated++;
              }
              userRunCounts.low_confidence++;
              results.confidenceTierTotals.low_confidence++;
              await ensureValidationTask({
                db,
                userId,
                sourceType: 'story',
                sourceId: story.id,
                sourceRef: storyRef,
                sourceTitle: story.title || storyRef,
                reason: 'low_confidence',
                suggestedType: 'goal',
                suggestedId: bestMatch.id,
                suggestedRef: bestMatch.ref || null,
                suggestedTitle: bestMatch.title,
                confidence: Math.round(bestMatch.score * 100),
              });
              results.validationTasksCreated++;
              userValidationTasksCreated++;
            }
          }

          await persistLinkingRunMetrics({
            db,
            runId,
            runType: 'nightlyStoryGoalLinking',
            source: 'nightly',
            userId,
            confidenceTierCounts: userRunCounts,
            scanned: userStoriesScanned,
            matchesFound: userMatchesFound,
            suggestionsCreated: userSuggestionsCreated,
            validationTasksCreated: userValidationTasksCreated,
            autoLinked: userAutoLinked,
          });
        } catch (userError) {
          results.errors.push(`User ${userId}: ${userError.message}`);
        }
      }

      await db.collection('system_logs').add({
        functionName: 'nightlyStoryGoalLinking',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'success',
        results,
        durationMs: Date.now() - startedAt,
        runId,
      });

      console.log('✅ Nightly story-goal linking complete:', results);
      return results;
    } catch (error) {
      console.error('❌ Nightly story-goal linking failed:', error);
      await db.collection('system_logs').add({
        functionName: 'nightlyStoryGoalLinking',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'error',
        durationMs: Date.now() - startedAt,
        runId,
        error: error.message,
        stack: error.stack
      }).catch(logError => console.error('Failed to log error:', logError));
      throw error;
    }
  }
);

/**
 * HTTP endpoint to manually trigger task linking
 * Useful for testing or on-demand runs
 */
exports.triggerTaskLinking = onCall(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }

    // Only allow admins or the user themselves
    const adminUser = await admin.auth().getUser(uid);
    if (!adminUser.customClaims?.admin) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }

    const db = admin.firestore();
    const { userId } = req.data;

    if (!userId) {
      throw new HttpsError('invalid-argument', 'userId required');
    }

    try {
      const runId = buildRunId('triggerTaskLinking');
      const tasksSnap = await db
        .collection('tasks')
        .where('ownerUid', '==', userId)
        .where('goalId', '==', null)
        .limit(500)
        .get();

      const goalsSnap = await db.collection('goals').where('ownerUid', '==', userId).get();
      const storiesSnap = await db.collection('stories').where('ownerUid', '==', userId).get();

      const goals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const stories = storiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const results = {
        runId,
        tasksScanned: tasksSnap.size,
        autoLinked: 0,
        suggestionsCreated: 0,
        confidenceTierCounts: createConfidenceTierCounts(),
        results: []
      };

      for (const taskDoc of tasksSnap.docs) {
        const task = { id: taskDoc.id, ...taskDoc.data() };
        if (task.status === 99 || task.deleted) continue;

        const matches = await findPotentialMatches(db, userId, task, goals, stories);
        const bestMatch = [matches.goals[0], matches.stories[0]]
          .filter(Boolean)
          .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

        if (!bestMatch) {
          results.confidenceTierCounts.no_match++;
          continue;
        }

        if (bestMatch.score > 0.85) {
          const linkPlan = planTaskLinkUpdate(task, bestMatch);
          if (!linkPlan.shouldUpdate || !linkPlan.updateData) {
            continue;
          }
          await db.collection('tasks').doc(task.id).update(linkPlan.updateData);
          results.autoLinked++;
          results.confidenceTierCounts.auto_linked++;
          results.results.push({
            taskId: task.id,
            action: 'auto_linked',
            matched: bestMatch
          });
        } else if (bestMatch.score > 0.65) {
          results.suggestionsCreated++;
          results.confidenceTierCounts.low_confidence++;
          results.results.push({
            taskId: task.id,
            action: 'suggestion_created',
            matched: bestMatch,
            score: bestMatch.score
          });
        }
      }

      await persistLinkingRunMetrics({
        db,
        runId,
        runType: 'triggerTaskLinking',
        source: 'manual',
        userId,
        confidenceTierCounts: results.confidenceTierCounts,
        scanned: results.tasksScanned,
        matchesFound:
          results.tasksScanned -
          Number(results.confidenceTierCounts.no_match || 0),
        suggestionsCreated: results.suggestionsCreated,
        validationTasksCreated: 0,
        autoLinked: results.autoLinked,
      });

      return results;
    } catch (error) {
      console.error('Error in triggerTaskLinking:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * HTTP endpoint to manually trigger story->goal linking
 */
exports.triggerStoryGoalLinking = onCall(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }

    const adminUser = await admin.auth().getUser(uid);
    if (!adminUser.customClaims?.admin) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }

    const db = admin.firestore();
    const { userId } = req.data;
    if (!userId) {
      throw new HttpsError('invalid-argument', 'userId required');
    }

    try {
      const runId = buildRunId('triggerStoryGoalLinking');
      const [storiesSnap, goalsSnap] = await Promise.all([
        db.collection('stories')
          .where('ownerUid', '==', userId)
          .where('goalId', '==', null)
          .limit(500)
          .get(),
        db.collection('goals')
          .where('ownerUid', '==', userId)
          .get()
      ]);

      const goals = goalsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const out = {
        runId,
        storiesScanned: storiesSnap.size,
        autoLinked: 0,
        suggestionsCreated: 0,
        confidenceTierCounts: createConfidenceTierCounts(),
        results: []
      };

      for (const storyDoc of storiesSnap.docs) {
        const story = { id: storyDoc.id, ...storyDoc.data() };
        if (story.deleted || Number(story.status) === 99) continue;

        const matches = findPotentialGoalMatchesForStory(story, goals);
        const best = matches[0];
        if (!best) {
          out.confidenceTierCounts.no_match++;
          continue;
        }

        if (best.score > 0.85) {
          await db.collection('stories').doc(story.id).set({
            goalId: best.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          out.autoLinked++;
          out.confidenceTierCounts.auto_linked++;
          out.results.push({ storyId: story.id, action: 'auto_linked', matched: best });
        } else if (best.score > 0.65) {
          out.suggestionsCreated++;
          out.confidenceTierCounts.low_confidence++;
          out.results.push({ storyId: story.id, action: 'suggestion_created', matched: best, score: best.score });
        }
      }

      await persistLinkingRunMetrics({
        db,
        runId,
        runType: 'triggerStoryGoalLinking',
        source: 'manual',
        userId,
        confidenceTierCounts: out.confidenceTierCounts,
        scanned: out.storiesScanned,
        matchesFound:
          out.storiesScanned -
          Number(out.confidenceTierCounts.no_match || 0),
        suggestionsCreated: out.suggestionsCreated,
        validationTasksCreated: 0,
        autoLinked: out.autoLinked,
      });

      return out;
    } catch (error) {
      console.error('Error in triggerStoryGoalLinking:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Accept or reject a task linking suggestion
 */
exports.respondToTaskSuggestion = onCall(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }

    const db = admin.firestore();
    const { suggestionId, action } = req.data; // action: 'accept' | 'reject'

    if (!suggestionId || !['accept', 'reject'].includes(action)) {
      throw new HttpsError('invalid-argument', 'suggestionId and action required');
    }

    try {
      // Get suggestion
      const suggestionDoc = await db.collection('task_suggestions').doc(suggestionId).get();
      if (!suggestionDoc.exists) {
        throw new HttpsError('not-found', 'Suggestion not found');
      }

      const suggestion = suggestionDoc.data();

      // Verify ownership
      if (suggestion.userId !== uid) {
        throw new HttpsError('permission-denied', 'Not your suggestion');
      }

      if (action === 'accept') {
        const taskRef = db.collection('tasks').doc(suggestion.taskId);
        const taskDoc = await taskRef.get();
        const taskData = taskDoc.exists ? taskDoc.data() || {} : {};
        const syntheticMatch = {
          type: suggestion.suggestedType,
          id: suggestion.suggestedId,
          linkedGoal: suggestion.suggestedLinkedGoalId || null,
        };
        const linkPlan = planTaskLinkUpdate(taskData, syntheticMatch);
        if (linkPlan.shouldUpdate && linkPlan.updateData) {
          await taskRef.update(linkPlan.updateData);
        }

        // Log acceptance
        await db.collection('activity_stream').add({
          entityId: suggestion.taskId,
          entityType: 'task',
          activityType: 'link_accepted',
          userId: uid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          description: `Accepted suggested link to ${suggestion.suggestedType}`,
          source: 'human'
        });
      }

      // Update suggestion status
      await db.collection('task_suggestions').doc(suggestionId).update({
        status: action === 'accept' ? 'accepted' : 'rejected',
        reviewed: true,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, action };
    } catch (error) {
      console.error('Error in respondToTaskSuggestion:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Accept or reject a story->goal linking suggestion
 */
exports.respondToStoryGoalSuggestion = onCall(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }

    const db = admin.firestore();
    const { suggestionId, action } = req.data;
    if (!suggestionId || !['accept', 'reject'].includes(action)) {
      throw new HttpsError('invalid-argument', 'suggestionId and action required');
    }

    try {
      const suggestionDoc = await db.collection('story_goal_suggestions').doc(suggestionId).get();
      if (!suggestionDoc.exists) {
        throw new HttpsError('not-found', 'Suggestion not found');
      }

      const suggestion = suggestionDoc.data() || {};
      if (suggestion.userId !== uid) {
        throw new HttpsError('permission-denied', 'Not your suggestion');
      }

      if (action === 'accept') {
        const storyRef = db.collection('stories').doc(suggestion.storyId);
        const storyDoc = await storyRef.get();
        const storyData = storyDoc.exists ? storyDoc.data() || {} : {};
        const currentGoalId = storyData.goalId || null;
        if (!currentGoalId) {
          await storyRef.set({
            goalId: suggestion.suggestedGoalId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        await db.collection('activity_stream').add({
          entityId: suggestion.storyId,
          entityType: 'story',
          activityType: 'story_goal_link_accepted',
          userId: uid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          description: `Accepted suggested goal link for story`,
          source: 'human'
        });
      }

      await db.collection('story_goal_suggestions').doc(suggestionId).update({
        status: action === 'accept' ? 'accepted' : 'rejected',
        reviewed: true,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, action };
    } catch (error) {
      console.error('Error in respondToStoryGoalSuggestion:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);
