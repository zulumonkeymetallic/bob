const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { DateTime, Interval } = require('luxon');

const { ensureFirestore, resolveTimezone } = require('./lib/reporting');
const { clampTaskPoints } = require('./utils/taskPoints');
const { buildAbsoluteUrl } = require('./utils/urlHelpers');
const { coerceZone, toDateTime } = require('./lib/time');

// Secrets
const GOOGLE_AI_STUDIO_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');

// ===== Helpers
async function callLLMJsonSafe({ system, user, purpose, userId }) {
  const { callLLMJson } = require('./utils/llmHelper');
  try {
    const raw = await callLLMJson({
      system,
      user,
      purpose,
      userId,
      expectJson: true,
      temperature: 0.1,
    });
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[llm-json] failed', { purpose, userId, error: error?.message || error });
    return null;
  }
}

function computeCriticalityScore({ dueDateMs, createdAtMs, goalDueMs, theme, points }) {
  let score = 0;
  const now = Date.now();

  // Due date urgency
  if (dueDateMs) {
    const days = Math.max(-30, Math.min(120, (dueDateMs - now) / 86400000));
    if (days <= 0) score += 40;
    else if (days <= 3) score += 30;
    else if (days <= 7) score += 22;
    else if (days <= 14) score += 15;
    else if (days <= 30) score += 8;
  }

  // Age
  if (createdAtMs) {
    const ageDays = Math.max(0, (now - createdAtMs) / 86400000);
    if (ageDays > 30) score += 15;
    else if (ageDays > 14) score += 10;
    else if (ageDays > 7) score += 6;
  }

  // Theme weighting
  const themeKey = String(theme || '').toLowerCase();
  if (['health', 'wealth', 'learning', 'growth', 'spirituality'].some((k) => themeKey.includes(k))) score += 10;
  if (themeKey.includes('hobby') || themeKey.includes('hobbies')) score -= 5;

  // Goal due date
  if (goalDueMs) {
    const daysGoal = Math.max(-30, Math.min(180, (goalDueMs - now) / 86400000));
    if (daysGoal <= 0) score += 15;
    else if (daysGoal <= 7) score += 10;
    else if (daysGoal <= 30) score += 5;
  }

  // Size: smaller tasks due soon get a nudge; very large items less likely to be immediate
  if (points != null) {
    if (points <= 2) score += 6;
    else if (points >= 8) score -= 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildCriticalityReason({ dueDateMs, goalDueMs, theme, points }) {
  const reasons = [];
  if (dueDateMs) {
    const days = Math.round((dueDateMs - Date.now()) / 86400000);
    reasons.push(`Due in ${days} day(s)`);
  } else {
    reasons.push('No explicit due date');
  }
  if (goalDueMs) {
    const days = Math.round((goalDueMs - Date.now()) / 86400000);
    reasons.push(`Parent goal due in ${days} day(s)`);
  }
  if (theme) reasons.push(`Theme: ${theme}`);
  if (points != null) reasons.push(`Size: ${points} pts`);
  return reasons.join(' · ');
}

function clampStoryStatus(status) {
  if (status === 'done' || status === 4 || status === 'completed') return 4;
  return 0; // default active
}

// Map theme identifiers (numeric or string) to a readable label for calendar blocks
const THEME_LABELS = {
  1: 'Growth',
  2: 'Health',
  3: 'Finance & Wealth',
  4: 'Tribe',
  5: 'Home',
  6: 'Hobbies & Interests',
  7: 'Spirituality',
  8: 'Learning',
};
function resolveThemeLabel(theme) {
  if (theme == null) return null;
  if (typeof theme === 'number' && THEME_LABELS[theme]) return THEME_LABELS[theme];
  const t = String(theme).trim();
  // Try to match common labels
  const lower = t.toLowerCase();
  if (lower.includes('wealth') || lower.includes('finance')) return 'Finance & Wealth';
  if (lower.includes('growth')) return 'Growth';
  if (lower.includes('hobby')) return 'Hobbies & Interests';
  if (lower.includes('game') || lower.includes('gaming') || lower.includes('tv')) return 'Hobbies & Interests';
  if (lower.includes('health')) return 'Health';
  if (lower.includes('learn')) return 'Learning';
  if (lower.includes('spirit')) return 'Spirituality';
  if (lower.includes('tribe')) return 'Tribe';
  if (lower.includes('home')) return 'Home';
  return t; // fallback to the provided string
}

function activityPayload({ ownerUid, entityId, entityType, activityType, description, metadata }) {
  return {
    id: admin.firestore().collection('activity_stream').doc().id,
    entityId,
    entityType,
    activityType,
    actor: 'AI_Agent',
    userId: ownerUid,
    ownerUid,
    description,
    metadata,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function appendToDescription(ref, existing, line) {
  const desc = (existing || '').trim();
  const updated = desc ? `${desc}\n\n${line}` : line;
  await ref.set({ description: updated }, { merge: true });
}

const isTaskLocked = (task) => task.dueDateLocked || task.lockDueDate || task.immovable === true || task.status === 'immovable';

// ===== 01:00 Auto-pointing (missing points only)
async function runAutoPointingJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));

  for (const prof of profiles.docs) {
    const userId = prof.id;
    const userSnap = await db.collection('users').doc(userId).get().catch(() => null);
    if (userSnap && userSnap.exists && userSnap.data()?.sizingEnabled === false) continue;

    // Tasks missing points
    const tasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', userId)
      .where('points', '==', null)
      .limit(25)
      .get()
      .catch(() => ({ docs: [] }));

    for (const doc of tasksSnap.docs) {
      const data = doc.data() || {};
      const estimate = await callLLMJsonSafe({
        system: 'Estimate agile story points (1-8). Return {"points":number}.',
        user: `Title: ${data.title || data.ref || 'Task'}\nDescription: ${data.description || ''}`,
        purpose: 'autoPoint_task',
        userId,
      });
      const pts = clampTaskPoints(estimate?.points);
      if (!pts) continue;
      await doc.ref.set({ points: pts, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: doc.id,
        entityType: 'task',
        activityType: 'auto_point',
        description: `Auto-pointed task at ${pts} points`,
        metadata: { run: '01:00_auto_point', points: pts },
      }));
    }

    // Stories missing points
    const storiesSnap = await db.collection('stories')
      .where('ownerUid', '==', userId)
      .where('points', '==', null)
      .limit(25)
      .get()
      .catch(() => ({ docs: [] }));

    for (const doc of storiesSnap.docs) {
      const data = doc.data() || {};
      const estimate = await callLLMJsonSafe({
        system: 'Estimate agile story points (1-8). Return {"points":number}.',
        user: `Title: ${data.title || data.ref || 'Story'}\nDescription: ${data.description || ''}`,
        purpose: 'autoPoint_story',
        userId,
      });
      const pts = clampTaskPoints(estimate?.points);
      if (!pts) continue;
      await doc.ref.set({ points: pts, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: doc.id,
        entityType: 'story',
        activityType: 'auto_point',
        description: `Auto-pointed story at ${pts} points`,
        metadata: { run: '01:00_auto_point', points: pts },
      }));
    }
  }
}

exports.runAutoPointing = onSchedule({
  schedule: '0 1 * * *',
  timeZone: 'Europe/London',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
  memory: '512MiB',
}, runAutoPointingJob);

// ===== 02:00 Bi-directional conversion
async function runAutoConversionsJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));

  for (const prof of profiles.docs) {
    const userId = prof.id;

    // Task -> Story (points > 4)
    const tasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', userId)
      .where('points', '>', 4)
      .limit(50)
      .get()
      .catch(() => ({ docs: [] }));

    for (const doc of tasksSnap.docs) {
      const task = doc.data() || {};
      if (task.convertedToStoryId) continue;
      const storyRef = db.collection('stories').doc();
      const storyRefValue = task.ref ? `ST-${String(task.ref).replace(/^TK-?/i, '')}` : storyRef.id.slice(-8).toUpperCase();
      await storyRef.set({
        ref: storyRefValue,
        title: task.title || 'Story created from task',
        description: task.description || '',
        points: task.points,
        ownerUid: userId,
        goalId: task.goalId || null,
        sprintId: task.sprintId || null,
        theme: task.theme || null,
        status: clampStoryStatus(task.status),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        convertedFromTaskId: doc.id,
      }, { merge: true });

      await appendToDescription(doc.ref, task.description, `Converted to a story (${storyRefValue})`);
      await doc.ref.set({
        status: 'done',
        convertedToStoryId: storyRef.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: doc.id,
        entityType: 'task',
        activityType: 'task_to_story_conversion',
        description: `Converted to story ${storyRefValue}`,
        metadata: { storyId: storyRef.id, storyRef: storyRefValue, points: task.points },
      }));
    }

    // Story -> Task (points < 4)
    const storiesSnap = await db.collection('stories')
      .where('ownerUid', '==', userId)
      .where('points', '<', 4)
      .limit(50)
      .get()
      .catch(() => ({ docs: [] }));

    for (const doc of storiesSnap.docs) {
      const story = doc.data() || {};
      if (story.convertedToTaskId) continue;
      const taskRef = db.collection('tasks').doc();
      const taskRefValue = story.ref ? `TK-${String(story.ref).replace(/^ST-?/i, '')}` : taskRef.id.slice(-8).toUpperCase();
      await taskRef.set({
        ref: taskRefValue,
        title: story.title || 'Task created from story',
        description: story.description || '',
        points: story.points,
        ownerUid: userId,
        goalId: story.goalId || null,
        sprintId: story.sprintId || null,
        theme: story.theme || null,
        status: 'todo',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        convertedFromStoryId: doc.id,
      }, { merge: true });

      await appendToDescription(doc.ref, story.description, `Converted to a task (${taskRefValue})`);
      await doc.ref.set({
        status: 'done',
        convertedToTaskId: taskRef.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: doc.id,
        entityType: 'story',
        activityType: 'task_to_story_conversion',
        description: `Converted to task ${taskRefValue}`,
        metadata: { direction: 'story_to_task', taskId: taskRef.id, taskRef: taskRefValue, points: story.points },
      }));
    }
  }
}

exports.runAutoConversions = onSchedule({
  schedule: '0 2 * * *',
  timeZone: 'Europe/London',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
  memory: '512MiB',
}, runAutoConversionsJob);

// ===== 03:00 Prioritisation (0-100) + To-do promotion
async function runPriorityScoringJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));
  const now = Date.now();

  for (const prof of profiles.docs) {
    const userId = prof.id;
    const goalMap = new Map();
    const goalSnap = await db.collection('goals').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] }));
    goalSnap.docs.forEach((d) => {
      const gd = d.data() || {};
      const due = gd.targetDate || gd.dueDate || null;
      goalMap.set(d.id, {
        dueDateMs: due ? toDateTime(due, { defaultValue: null })?.toMillis() : null,
        priority: gd.priority || null,
        theme: gd.theme || null,
      });
    });

    const sprintMap = new Map();
    const sprintSnap = await db.collection('sprints').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] }));
    sprintSnap.docs.forEach((d) => {
      const sd = d.data() || {};
      const end = sd.endDate || null;
      sprintMap.set(d.id, { endDateMs: end ? toDateTime(end, { defaultValue: null })?.toMillis() : null });
    });

    const tasksSnap = await db.collection('tasks').where('ownerUid', '==', userId).limit(500).get().catch(() => ({ docs: [] }));
    const storiesSnap = await db.collection('stories').where('ownerUid', '==', userId).limit(200).get().catch(() => ({ docs: [] }));

    const storyMetaMap = new Map();
    storiesSnap.docs.forEach((d) => {
      const st = d.data() || {};
      const goal = st.goalId ? goalMap.get(st.goalId) || {} : {};
      storyMetaMap.set(d.id, {
        theme: st.theme || null,
        goalId: st.goalId || null,
        goalTheme: goal.theme || null,
        sprintId: st.sprintId || null,
      });
    });

    const taskScores = [];

    const applyScore = async (ref, entity, entityType) => {
      const goal = entity.goalId ? goalMap.get(entity.goalId) : null;
      const sprint = entity.sprintId ? sprintMap.get(entity.sprintId) : null;
      const dueMs = toDateTime(entity.dueDate || entity.targetDate || sprint?.endDateMs, { defaultValue: null })?.toMillis() || null;
      const createdMs = toDateTime(entity.createdAt || entity.serverCreatedAt, { defaultValue: null })?.toMillis() || null;
      const effectiveTheme = (() => {
        if (entityType === 'task') {
          const storyMeta = entity.storyId ? storyMetaMap.get(entity.storyId) || {} : {};
          return entity.theme || storyMeta.theme || storyMeta.goalTheme || (entity.goalId ? goalMap.get(entity.goalId)?.theme : null);
        }
        return entity.theme || null;
      })();

      const ageDays = createdMs ? (Date.now() - createdMs) / 86400000 : null;
      const storyMetaForTask = entityType === 'task' && entity.storyId ? (storyMetaMap.get(entity.storyId) || {}) : {};
      const isLinkedActiveSprint = storyMetaForTask.sprintId
        ? (() => {
            const s = sprintMap.get(storyMetaForTask.sprintId);
            if (!s || !s.endDateMs) return false;
            const nowMs = Date.now();
            return nowMs <= s.endDateMs;
          })()
        : false;

      let bonus = 0;
      const bonusReasons = [];
      if (entityType === 'task' && isLinkedActiveSprint) {
        bonus += 8;
        bonusReasons.push('Linked story in active sprint');
      }
      const oldUnlinked = entityType === 'task' && !entity.storyId && ageDays != null && ageDays >= 90;
      if (oldUnlinked) {
        bonus += 15;
        bonusReasons.push('Aged > 90 days and unlinked');
      }

      const baseScore = computeCriticalityScore({
        dueDateMs: dueMs,
        createdAtMs: createdMs,
        goalDueMs: goal?.dueDateMs || null,
        theme: effectiveTheme,
        points: entity.points,
      });
      const score = Math.min(100, baseScore + bonus);
      const reason = buildCriticalityReason({
        dueDateMs: dueMs,
        goalDueMs: goal?.dueDateMs || null,
        theme: effectiveTheme,
        points: entity.points,
      }) + (bonusReasons.length ? ' · ' + bonusReasons.join(' · ') : '');
      const patch = {
        aiCriticalityScore: score,
        aiCriticalityReason: reason,
        aiPriorityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      // Promote small due-today tasks to high priority
      if (entityType === 'task' && dueMs) {
        const isToday = DateTime.fromMillis(dueMs).hasSame(DateTime.now(), 'day');
        if (isToday && (entity.points || 0) <= 4) {
          patch.priority = 'high';
          patch.iosPriority = '!!';
        }
      }
      await ref.set(patch, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: ref.id,
        entityType,
        activityType: 'ai_priority_score',
        description: `Criticality ${score}/100 · ${reason}`,
        metadata: { score, reason, run: '03:00_priority' },
      }));

      if (entityType === 'task') {
        taskScores.push({ id: ref.id, score, data: entity, reason, dueMs, refObj: ref });
        // Force due today for very old unlinked tasks (if not locked)
        if (oldUnlinked && !isTaskLocked(entity)) {
          const todayEnd = DateTime.now().endOf('day').toMillis();
          await ref.set({
            dueDate: todayEnd,
            priority: 'high',
            iosPriority: '!!',
            aiDueDateSetAt: admin.firestore.FieldValue.serverTimestamp(),
            dueDateReason: `AI priority promotion (aged unlinked >90d, score ${score}/100${bonusReasons.length ? `, ${bonusReasons.join(', ')}` : ''})`,
            syncState: 'dirty',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          await db.collection('activity_stream').add(activityPayload({
            ownerUid: userId,
            entityId: ref.id,
            entityType: 'task',
            activityType: 'ai_due_date_adjustment',
            description: 'Moved due date to today (aged > 90 days, unlinked)',
            metadata: { reason: 'aged_unlinked', ageDays, newDueDate: todayEnd, run: '03:00_priority' },
          }));
        }
      }
    };

    for (const doc of tasksSnap.docs) {
      const data = doc.data() || {};
      const statusRaw = data.status;
      const statusStr = String(statusRaw || '').toLowerCase();
      const isDone = statusStr === 'done' || statusStr === 'completed' || statusStr === 'complete' || Number(statusRaw) >= 2;
      if (isDone || data.deleted) continue;
      await applyScore(doc.ref, data, 'task');
    }

    for (const doc of storiesSnap.docs) {
      const data = doc.data() || {};
      const statusRaw = data.status;
      const statusStr = String(statusRaw || '').toLowerCase();
      const isDone = statusStr === 'done' || statusStr === 'completed' || statusStr === 'complete' || Number(statusRaw) >= 4;
      if (isDone) continue;
      await applyScore(doc.ref, data, 'story');
    }

    // Promote top tasks to today (cap 3) unless locked
    const topTasks = taskScores
      .filter(t => !isTaskLocked(t.data))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const todayEnd = DateTime.now().endOf('day').toMillis();
    for (const task of topTasks) {
      const alreadyToday = task.dueMs && DateTime.fromMillis(task.dueMs).hasSame(DateTime.now(), 'day');
      if (alreadyToday) continue;
      const detailedReason = [
        'AI priority promotion to today',
        `score=${task.score}`,
        task.reason ? `why=${task.reason}` : null,
      ].filter(Boolean).join(' | ');
      await task.refObj.set({
        dueDate: todayEnd,
        priority: 'high',
        iosPriority: '!!',
        aiDueDateSetAt: admin.firestore.FieldValue.serverTimestamp(),
        dueDateReason: detailedReason,
        syncState: 'dirty',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: task.id,
        entityType: 'task',
        activityType: 'ai_due_date_adjustment',
        description: `Moved due date to today based on score ${task.score}/100 (${task.reason || 'priority'})`,
        metadata: { score: task.score, reason: task.reason || 'top3_priority', run: '03:00_priority', newDueDate: todayEnd },
      }));
    }
  }
}

exports.runPriorityScoring = onSchedule({
  schedule: '0 3 * * *',
  timeZone: 'Europe/London',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
  memory: '512MiB',
}, runPriorityScoringJob);

// ===== 05:30 Calendar insertion respecting theme windows and busy time
async function runCalendarPlannerJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));
  const now = DateTime.now();

  const themeRules = [
    { match: ['growth'], slots: [{ days: [1, 2, 3, 4, 5], start: 7, end: 9, label: 'Growth AM' }, { days: [1, 2, 3, 4, 5], start: 17, end: 19, label: 'Growth PM' }] },
    { match: ['finance', 'wealth'], slots: [{ days: [1, 2, 3, 4, 5], start: 18, end: 21, label: 'Wealth weekday evening' }, { days: [6, 7], start: 9, end: 12, label: 'Wealth weekend AM' }, { days: [6, 7], start: 13, end: 17, label: 'Wealth weekend PM' }] },
    { match: ['hobby', 'hobbies'], slots: [{ days: [1, 2, 3, 4, 5, 6, 7], start: 18, end: 22, label: 'Hobbies evenings' }] },
    { match: ['game', 'gaming', 'tv'], slots: [{ days: [5, 6], start: 19, end: 23, label: 'Gaming/TV Fri/Sat evening' }] },
    { match: ['health'], slots: [{ days: [1, 2, 3, 4, 5], start: 6, end: 20, label: 'Health focus' }] },
    { match: ['learning', 'spiritual'], slots: [{ days: [1, 2, 3, 4, 5], start: 6, end: 20, label: 'Growth/Learning' }] },
  ];

  const hasOverlap = (candidate, existing) => {
    const cand = Interval.fromDateTimes(candidate.start, candidate.end);
    return existing.some((block) => {
      const s = toDateTime(block.start, { defaultValue: null });
      const e = toDateTime(block.end, { defaultValue: null });
      if (!s || !e) return false;
      return cand.overlaps(Interval.fromDateTimes(s, e));
    });
  };

  const toDayKey = (dt) => dt.toISODate();
  const toMinutes = (hhmm) => {
    const [h = '0', m = '0'] = String(hhmm || '0:0').split(':');
    return Number(h) * 60 + Number(m);
  };

  for (const prof of profiles.docs) {
    const userId = prof.id;
    const profile = prof.data() || {};
    const zone = resolveTimezone(profile, 'Europe/London');
    const windowStart = now.setZone(coerceZone(zone)).startOf('day');
    const windowEnd = windowStart.plus({ days: 7 }).endOf('day');

    // User-defined weekly theme blocks
    let themeAllocations = [];
    try {
      const allocDoc = await db.collection('theme_allocations').doc(userId).get();
      if (allocDoc.exists) themeAllocations = allocDoc.data()?.allocations || [];
    } catch { /* ignore */ }

    const getUserSlots = (themeLabel, day) => {
      const matches = themeAllocations.filter((a) => {
        if (a.dayOfWeek !== day.weekday % 7) return false; // stored as 0=Sun, 1=Mon...
        const label = String(themeLabel || '').toLowerCase();
        const allocTheme = String(a.theme || '').toLowerCase();
        return allocTheme && (allocTheme === label || label.includes(allocTheme) || allocTheme.includes(label));
      });
      return matches.map((a) => {
        const startMinutes = toMinutes(a.startTime);
        const endMinutes = toMinutes(a.endTime);
        return {
          days: [day.weekday],
          start: startMinutes / 60,
          end: endMinutes / 60,
          label: `Theme block: ${a.theme}`,
        };
      });
    };

    const pickSlots = (themeLabel, day) => {
      const userSlots = getUserSlots(themeLabel, day);
      if (userSlots.length) return userSlots;
      const key = String(themeLabel || '').toLowerCase();
      for (const rule of themeRules) {
        if (rule.match.some((m) => key.includes(m))) return rule.slots;
      }
      return [{ days: [1, 2, 3, 4, 5], start: 9, end: 18, label: 'Default weekday window' }];
    };

    // Cache goals for theme inheritance
    const goalMetaMap = new Map();
    try {
      const goalsSnap = await db.collection('goals').where('ownerUid', '==', userId).get();
      goalsSnap.docs.forEach((d) => {
        const gd = d.data() || {};
        goalMetaMap.set(d.id, { theme: gd.theme || null, tags: gd.tags || [], title: gd.title || '' });
      });
    } catch { /* ignore */ }

    const storiesSnap = await db.collection('stories')
      .where('ownerUid', '==', userId)
      .where('status', 'in', ['active', 'in-progress', 0, 1, 2])
      .get()
      .catch(() => ({ docs: [] }));

    const tasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', userId)
      .get()
      .catch(() => ({ docs: [] }));

    const blocksSnap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', userId)
      .where('start', '>=', windowStart.toMillis())
      .where('start', '<=', windowEnd.toMillis())
      .get()
      .catch(() => ({ docs: [] }));
    const existingBlocks = blocksSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    const isChoreLike = (block) => {
      const type = String(block.entityType || block.category || '').toLowerCase();
      return ['chore', 'routine', 'habit'].includes(type);
    };

    // Busy = everything already on calendar (including GCal imports) except chores/routines/habits (phase 1 exclusion)
    const busy = existingBlocks
      .filter((b) => !isChoreLike(b))
      .map((b) => ({ start: b.start, end: b.end }));
    const capCounts = new Map();
    existingBlocks
      .filter((b) => (b.storyId || b.taskId) && !isChoreLike(b))
      .forEach((b) => {
        const day = DateTime.fromMillis(b.start).toISODate();
        capCounts.set(day, (capCounts.get(day) || 0) + 1);
      });

    const candidates = [];
    for (const storyDoc of storiesSnap.docs) {
      const story = storyDoc.data() || {};
      const goalMeta = story.goalId ? goalMetaMap.get(story.goalId) || {} : {};
      const theme = resolveThemeLabel(story.theme || goalMeta.theme || null);
      const points = story.points || 1;
      const durationMinutes = Math.max(60, Math.min(240, points * 60));
      const score = story.aiCriticalityScore || 0;
      const titlePrefix = story.ref ? `${story.ref}: ` : '';
      candidates.push({
        kind: 'story',
        id: storyDoc.id,
        title: `${titlePrefix}${story.title || 'Story block'}`,
        score,
        theme,
        goalId: story.goalId || null,
        sprintId: story.sprintId || null,
        durationMinutes,
        deepLink: buildAbsoluteUrl(`/stories?storyId=${encodeURIComponent(storyDoc.id)}`),
        rationaleBase: `Story priority ${score}/100`,
        storyRef: story.ref || null,
      });
    }

    for (const taskDoc of tasksSnap.docs) {
      const task = taskDoc.data() || {};
      const status = String(task.status || '').toLowerCase();
      if (['done', 'complete', 'completed'].includes(status) || task.deleted) continue;
      const estimateMinutes = task.estimateMin
        || (Number.isFinite(Number(task.estimatedHours)) ? Number(task.estimatedHours) * 60 : null)
        || (Number.isFinite(Number(task.points)) ? Number(task.points) * 60 : null);
      const durationMinutes = clampTaskPoints(task.points) > 4 || (estimateMinutes && estimateMinutes > 240)
        ? Math.max(120, Math.min(360, estimateMinutes || (task.points || 5) * 60))
        : null;
      if (!durationMinutes) continue; // only long tasks for this phase
      const goalMeta = task.goalId ? goalMetaMap.get(task.goalId) || {} : {};
      const theme = resolveThemeLabel(task.theme || goalMeta.theme || null);
      const ref = task.ref || task.reference || task.displayId || null;
      candidates.push({
        kind: 'task',
        id: taskDoc.id,
        title: `${ref ? `${ref}: ` : ''}${task.title || 'Task block'}`,
        score: task.priority || 50,
        theme,
        goalId: task.goalId || null,
        storyId: task.storyId || null,
        durationMinutes,
        deepLink: buildAbsoluteUrl(`/tasks?taskId=${encodeURIComponent(taskDoc.id)}`),
        rationaleBase: `Long task (${durationMinutes}m)`,
        taskRef: ref,
      });
    }

    // Sort by score descending to fill the 7-day window
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    for (const candidate of candidates) {
      let placed = false;
      for (let offset = 0; offset < 7 && !placed; offset++) {
        const day = windowStart.plus({ days: offset });
        const dayKey = toDayKey(day);
        if ((capCounts.get(dayKey) || 0) >= 3) continue; // cap applies only to story/task blocks

        const slots = pickSlots(candidate.theme, day);
        for (const slot of slots) {
          const slotDays = slot.days || [1, 2, 3, 4, 5];
          if (!slotDays.includes(day.weekday)) continue;
          const start = day.set({ hour: Math.floor(slot.start), minute: Math.round((slot.start % 1) * 60), second: 0, millisecond: 0 });
          const end = day.set({ hour: Math.floor(slot.end), minute: Math.round((slot.end % 1) * 60), second: 0, millisecond: 0 });
          const slotInterval = Interval.fromDateTimes(start, end);
          if (slotInterval.length('minutes') < candidate.durationMinutes) continue;

          // carve out sleep/work quiet windows
          const sleepInterval = Interval.fromDateTimes(day.set({ hour: 22, minute: 0 }), day.plus({ days: 1 }).set({ hour: 5, minute: 0 }));
          if (slotInterval.overlaps(sleepInterval)) continue;

          const candidateEnd = start.plus({ minutes: candidate.durationMinutes });
          const candidateInterval = Interval.fromDateTimes(start, candidateEnd);
          if (candidateEnd > end) continue;
          if (hasOverlap({ start, end: candidateEnd }, busy)) continue;

          const blockRef = db.collection('calendar_blocks').doc();
          const rationale = `${candidate.rationaleBase} · ${slot.label || 'Preferred window'}`;
          const payload = {
            ownerUid: userId,
            start: start.toMillis(),
            end: candidateEnd.toMillis(),
            title: candidate.title,
            entityType: candidate.kind === 'story' ? 'story' : 'task',
            theme: candidate.theme || null,
            status: 'planned',
            aiGenerated: true,
            rationale,
            deepLink: candidate.deepLink,
            placementReason: rationale,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (candidate.kind === 'story') {
            payload.storyId = candidate.id;
            payload.goalId = candidate.goalId || null;
            payload.sprintId = candidate.sprintId || null;
            payload.storyRef = candidate.storyRef || null;
          } else {
            payload.taskId = candidate.id;
            payload.goalId = candidate.goalId || null;
            payload.storyId = candidate.storyId || null;
            payload.taskRef = candidate.taskRef || null;
          }

          await blockRef.set(payload);
          busy.push({ start: payload.start, end: payload.end });
          capCounts.set(dayKey, (capCounts.get(dayKey) || 0) + 1);
          placed = true;

          await db.collection('activity_stream').add(activityPayload({
            ownerUid: userId,
            entityId: candidate.id,
            entityType: candidate.kind === 'story' ? 'story' : 'task',
            activityType: 'calendar_insertion',
            description: `Calendar block created (${day.toISODate()} ${start.toFormat('HH:mm')}–${candidateEnd.toFormat('HH:mm')})`,
            metadata: { blockId: blockRef.id, reason: rationale, theme: candidate.theme || null, goalId: candidate.goalId || null },
          }));
          break;
        }
      }
    }
  }
}

exports.runCalendarPlanner = onSchedule({
  schedule: '30 5 * * *',
  timeZone: 'Europe/London',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
  memory: '1GiB',
  timeoutSeconds: 540,
}, runCalendarPlannerJob);

// Manual trigger to run the nightly chain (pointing → conversions → priority → calendar)
exports.runNightlyChainNow = onCall({
  timeZone: 'Europe/London',
  memory: '1GiB',
  timeoutSeconds: 540,
}, async () => {
  const steps = [
    { name: 'runAutoPointing', fn: runAutoPointingJob },
    { name: 'runAutoConversions', fn: runAutoConversionsJob },
    { name: 'runPriorityScoring', fn: runPriorityScoringJob },
    { name: 'runCalendarPlanner', fn: runCalendarPlannerJob },
  ];
  const results = [];
  for (const step of steps) {
    try {
      await step.fn();
      results.push({ step: step.name, status: 'ok' });
    } catch (err) {
      results.push({ step: step.name, status: 'error', error: err?.message || String(err) });
      // Continue so later steps still attempt to run
    }
  }
  return { ok: true, results };
});

// Internal job exports to enable manual orchestration/testing without scheduler
exports._runAutoPointingJob = runAutoPointingJob;
exports._runAutoConversionsJob = runAutoConversionsJob;
exports._runPriorityScoringJob = runPriorityScoringJob;
exports._runCalendarPlannerJob = runCalendarPlannerJob;
