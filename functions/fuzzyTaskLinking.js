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
  suggestedTitle = null,
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
  const suggestedText = suggestedType && suggestedTitle
    ? ` Suggested ${suggestedType}: ${suggestedTitle}${confidence != null ? ` (${confidence}% confidence)` : ''}.`
    : '';
  const title = reason === 'no_match'
    ? `Validate ${sourceType} linkage for ${sourceRef}`
    : `Review low-confidence ${sourceType} linkage for ${sourceRef}`;
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
        title: story.title,
        score,
        type: 'story',
        linkedGoal: story.goalId
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
    const results = {
      usersProcessed: 0,
      tasksScanned: 0,
      matchesFound: 0,
      autoLinked: 0,
      suggestionsCreated: 0,
      validationTasksCreated: 0,
      errors: []
    };

    try {
      // Get all users
      const usersSnap = await db.collection('users').get();
      results.usersProcessed = usersSnap.size;

      for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;

        try {
          // Get all unlinked tasks for this user
          const tasksSnap = await db
            .collection('tasks')
            .where('ownerUid', '==', userId)
            .where('goalId', '==', null)
            .limit(1000)
            .get();

          results.tasksScanned += tasksSnap.size;

          if (tasksSnap.size === 0) continue;

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
              continue;
            }

            results.matchesFound++;

            // Get best match
            const bestGoalMatch = matches.goals[0];
            const bestStoryMatch = matches.stories[0];
            const bestMatch = [bestGoalMatch, bestStoryMatch]
              .filter(Boolean)
              .sort((a, b) => b.score - a.score)[0];

            if (!bestMatch) continue;

            // AUTO-LINK if confidence > 85%
            if (bestMatch.score > 0.85) {
              const updateData = {};
              if (bestMatch.type === 'goal') {
                updateData.goalId = bestMatch.id;
              } else {
                updateData.storyId = bestMatch.id;
                // If story linked, also set the goal
                if (bestMatch.linkedGoal) {
                  updateData.goalId = bestMatch.linkedGoal;
                }
              }

              await db.collection('tasks').doc(task.id).update(updateData);

              // Log to activity stream
              await db.collection('activity_stream').add({
                entityId: task.id,
                entityType: 'task',
                activityType: 'auto_linked',
                userId,
                userEmail: userDoc.data()?.email || 'system',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                fieldName: bestMatch.type === 'goal' ? 'goalId' : 'storyId',
                oldValue: '',
                newValue: bestMatch.id,
                description: `Auto-linked task "${task.title}" to ${bestMatch.type} "${bestMatch.title}" (${(bestMatch.score * 100).toFixed(0)}% confidence)`,
                persona: task.persona || 'personal',
                referenceNumber: task.reference || '',
                source: 'system',
                sourceDetails: `fuzzyTaskLinking_v1_${bestMatch.score.toFixed(3)}`
              });

              results.autoLinked++;
            }
            // CREATE SUGGESTION if 65% < confidence <= 85%
            else if (bestMatch.score > 0.65) {
              // Store suggestion for user review
              const suggestionRef = await db.collection('task_suggestions').add({
                taskId: task.id,
                userId,
                taskTitle: task.title,
                suggestedId: bestMatch.id,
                suggestedTitle: bestMatch.title,
                suggestedType: bestMatch.type,
                confidence: Math.round(bestMatch.score * 100),
                allMatches: {
                  goals: matches.goals.slice(0, 3),
                  stories: matches.stories.slice(0, 3)
                },
                status: 'pending', // pending, accepted, rejected, expired
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                reviewed: false
              });

              // Log suggestion to activity stream
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
                  suggestionId: suggestionRef.id,
                  confidence: Math.round(bestMatch.score * 100),
                  topMatches: {
                    goals: matches.goals.slice(0, 2).map(m => ({ id: m.id, title: m.title, score: (m.score * 100).toFixed(0) + '%' })),
                    stories: matches.stories.slice(0, 2).map(m => ({ id: m.id, title: m.title, score: (m.score * 100).toFixed(0) + '%' }))
                  }
                }
              });

              results.suggestionsCreated++;
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
                suggestedTitle: bestMatch.title,
                confidence: Math.round(bestMatch.score * 100),
              });
              results.validationTasksCreated++;
            }
          }
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
        duration: context.executionId
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
    const results = {
      usersProcessed: 0,
      storiesScanned: 0,
      matchesFound: 0,
      autoLinked: 0,
      suggestionsCreated: 0,
      validationTasksCreated: 0,
      errors: []
    };

    try {
      const usersSnap = await db.collection('users').get();
      results.usersProcessed = usersSnap.size;

      for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;

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
          if (storiesSnap.empty || goalsSnap.empty) continue;

          const goals = goalsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

          for (const storyDoc of storiesSnap.docs) {
            const story = { id: storyDoc.id, ...storyDoc.data() };
            if (story.deleted || Number(story.status) === 99) continue;

            const matches = findPotentialGoalMatchesForStory(story, goals);
            const storyRef = story.ref || `ST-${String(story.id).slice(-6).toUpperCase()}`;
            if (!matches.length) {
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
              continue;
            }

            results.matchesFound++;
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
            } else if (bestMatch.score > 0.65) {
              const suggestionRef = await db.collection('story_goal_suggestions').add({
                storyId: story.id,
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
                  suggestionId: suggestionRef.id,
                  confidence: Math.round(bestMatch.score * 100),
                  topMatches: matches.slice(0, 2).map((m) => ({
                    id: m.id,
                    title: m.title,
                    score: `${(m.score * 100).toFixed(0)}%`
                  }))
                }
              });

              results.suggestionsCreated++;
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
                suggestedTitle: bestMatch.title,
                confidence: Math.round(bestMatch.score * 100),
              });
              results.validationTasksCreated++;
            }
          }
        } catch (userError) {
          results.errors.push(`User ${userId}: ${userError.message}`);
        }
      }

      await db.collection('system_logs').add({
        functionName: 'nightlyStoryGoalLinking',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'success',
        results,
        duration: context.executionId
      });

      console.log('✅ Nightly story-goal linking complete:', results);
      return results;
    } catch (error) {
      console.error('❌ Nightly story-goal linking failed:', error);
      await db.collection('system_logs').add({
        functionName: 'nightlyStoryGoalLinking',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: 'error',
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
        tasksScanned: tasksSnap.size,
        autoLinked: 0,
        suggestionsCreated: 0,
        results: []
      };

      for (const taskDoc of tasksSnap.docs) {
        const task = { id: taskDoc.id, ...taskDoc.data() };
        if (task.status === 99 || task.deleted) continue;

        const matches = await findPotentialMatches(db, userId, task, goals, stories);
        const bestMatch = [matches.goals[0], matches.stories[0]]
          .filter(Boolean)
          .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

        if (!bestMatch) continue;

        if (bestMatch.score > 0.85) {
          const updateData =
            bestMatch.type === 'goal' ? { goalId: bestMatch.id } : { storyId: bestMatch.id };
          if (bestMatch.type === 'story' && bestMatch.linkedGoal) {
            updateData.goalId = bestMatch.linkedGoal;
          }
          await db.collection('tasks').doc(task.id).update(updateData);
          results.autoLinked++;
          results.results.push({
            taskId: task.id,
            action: 'auto_linked',
            matched: bestMatch
          });
        } else if (bestMatch.score > 0.65) {
          results.suggestionsCreated++;
          results.results.push({
            taskId: task.id,
            action: 'suggestion_created',
            matched: bestMatch,
            score: bestMatch.score
          });
        }
      }

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
        storiesScanned: storiesSnap.size,
        autoLinked: 0,
        suggestionsCreated: 0,
        results: []
      };

      for (const storyDoc of storiesSnap.docs) {
        const story = { id: storyDoc.id, ...storyDoc.data() };
        if (story.deleted || Number(story.status) === 99) continue;

        const matches = findPotentialGoalMatchesForStory(story, goals);
        const best = matches[0];
        if (!best) continue;

        if (best.score > 0.85) {
          await db.collection('stories').doc(story.id).set({
            goalId: best.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          out.autoLinked++;
          out.results.push({ storyId: story.id, action: 'auto_linked', matched: best });
        } else if (best.score > 0.65) {
          out.suggestionsCreated++;
          out.results.push({ storyId: story.id, action: 'suggestion_created', matched: best, score: best.score });
        }
      }

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
        // Apply the link
        const updateData =
          suggestion.suggestedType === 'goal'
            ? { goalId: suggestion.suggestedId }
            : { storyId: suggestion.suggestedId };

        await db.collection('tasks').doc(suggestion.taskId).update(updateData);

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
        await db.collection('stories').doc(suggestion.storyId).set({
          goalId: suggestion.suggestedGoalId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

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
