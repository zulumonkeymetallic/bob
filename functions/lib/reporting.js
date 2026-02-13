const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const {
  DEFAULT_TIMEZONE,
  coerceZone,
  computeDayWindow,
  formatDate,
  formatDateTime,
  isoDate,
  toDateTime,
  toMillis,
} = require('./time');
const { expandRecurrence } = require('../scheduler/engine');
const { fetchWeather, fetchNews } = require('../services/newsWeather');
const { buildAbsoluteUrl, buildEntityUrl } = require('../utils/urlHelpers');

const TASK_DONE_STATUSES = new Set(['done', 'completed', 'complete', 'archived', 2, 3]);
const STORY_DONE_STATUSES = new Set(['done', 'complete', 'archived', 3]);
const STORY_STATUS_MAP = {
  0: 'backlog',
  1: 'planned',
  2: 'in-progress',
  3: 'testing',
  4: 'done',
};
const STORY_NOT_STARTED_STATUSES = new Set(['backlog', 'planned', 'plan', 'todo', 'new']);
const GOAL_STATUS_MAP = {
  0: 'new',
  1: 'in-progress',
  2: 'complete',
  3: 'blocked',
  4: 'deferred',
};

const extractAmountPence = (tx) => {
  if (Number.isFinite(tx.amountMinor)) return Number(tx.amountMinor);
  const raw = Number(tx.amount || 0);
  if (!Number.isFinite(raw)) return 0;
  if (Math.abs(raw) < 10) return Math.round(raw * 100);
  return Math.round(raw);
};

const resolveFinanceBucket = (tx) => {
  const raw = tx.aiBucket || tx.userCategoryType || tx.defaultCategoryType || 'unknown';
  const bucket = String(raw || '').toLowerCase();
  return bucket === 'optional' ? 'discretionary' : bucket;
};

const buildFinanceSummary = (transactions = []) => {
  const summary = {
    totalSpendPence: 0,
    totalIncomePence: 0,
    buckets: {},
    topMerchants: [],
    anomalies: [],
    transactionCount: 0,
    spendCount: 0,
    incomeCount: 0,
  };
  const merchantTotals = {};
  transactions.forEach((tx) => {
    summary.transactionCount += 1;
    const amount = extractAmountPence(tx);
    const bucket = resolveFinanceBucket(tx);
    const isIncome = ['income', 'net_salary', 'irregular_income'].includes(bucket);
    if (amount < 0 && !isIncome) {
      summary.totalSpendPence += Math.abs(amount);
      summary.spendCount += 1;
    }
    if (amount > 0 && isIncome) {
      summary.totalIncomePence += amount;
      summary.incomeCount += 1;
    }
    if (!summary.buckets[bucket]) summary.buckets[bucket] = 0;
    summary.buckets[bucket] += amount;
    const merchant = tx.merchant?.name || tx.counterparty?.name || tx.description || 'Unknown';
    merchantTotals[merchant] = (merchantTotals[merchant] || 0) + Math.abs(amount);
    if (tx.aiAnomalyFlag) {
      summary.anomalies.push({
        merchant,
        amountPence: Math.abs(amount),
        reason: tx.aiAnomalyReason || 'Anomaly',
      });
    }
  });
  summary.topMerchants = Object.entries(merchantTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([merchant, total]) => ({ merchant, totalPence: total }));
  return summary;
};

const ensureFirestore = () => {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
};

const loadProfile = async (db, userId) => {
  const profileRef = db.collection('profiles').doc(userId);
  const profileSnap = await profileRef.get();
  if (profileSnap.exists) {
    return { id: profileSnap.id, ...profileSnap.data() };
  }
  const usersSnap = await db.collection('users').doc(userId).get();
  if (usersSnap.exists) {
    return { id: usersSnap.id, ...usersSnap.data() };
  }
  return { id: userId };
};

const resolveTimezone = (profile, fallback) => {
  if (!profile) return fallback || DEFAULT_TIMEZONE;
  return (
    profile.timezone ||
    profile.timeZone ||
    profile.settings?.timezone ||
    profile.preferences?.timezone ||
    fallback ||
    DEFAULT_TIMEZONE
  );
};

const toList = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

const computeNextOccurrenceInWindow = (recurrence, dtstart, windowStart, windowEnd) => {
  if (!recurrence || !recurrence.rrule) return null;
  try {
    const occurrences = expandRecurrence(
      { ...recurrence, dtstart },
      windowStart.minus({ days: 1 }),
      windowEnd.plus({ days: 1 }),
    );
    if (!Array.isArray(occurrences) || !occurrences.length) return null;
    const startMs = windowStart.toMillis();
    const endMs = windowEnd.toMillis();
    const directHit = occurrences.find((occ) => {
      const millis = occ.toMillis();
      return millis >= startMs && millis <= endMs;
    });
    if (directHit) return directHit.toMillis();
    const nextAfterStart = occurrences.find((occ) => occ.toMillis() >= startMs);
    return nextAfterStart ? nextAfterStart.toMillis() : occurrences[0].toMillis();
  } catch (error) {
    console.warn('[reporting] recurrence expansion failed', error?.message || error);
    return null;
  }
};

const resolveRecurringDueWithinWindow = (entity, windowStart, windowEnd) => {
  const startMs = windowStart.toMillis();
  const endMs = windowEnd.toMillis();
  const direct = toMillis(entity.nextDueAt || entity.nextDue || entity.dueDate || entity.dueAt);
  if (direct && direct >= startMs && direct <= endMs) {
    return direct;
  }
  const recurrence = entity.recurrence || null;
  if (!recurrence || !recurrence.rrule) return null;
  const dtstart = recurrence.dtstart || entity.dtstart || entity.createdAt || null;
  const computed = computeNextOccurrenceInWindow(recurrence, dtstart, windowStart, windowEnd);
  if (!computed) return null;
  if (computed >= startMs && computed <= endMs) return computed;
  return null;
};

const buildActivityIndex = async (db, userId, limit = 400) => {
  // Prefer ownerUid; fall back to legacy userId if needed
  let activitySnap = await db
    .collection('activity_stream')
    .where('ownerUid', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()
    .catch(() => null);
  if (!activitySnap || activitySnap.empty) {
    activitySnap = await db
      .collection('activity_stream')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
      .catch(() => ({ empty: true, docs: [] }));
  }

  const latestByEntity = new Map();
  const latestByType = new Map();
  const activityByType = new Map();

  for (const doc of activitySnap.docs) {
    const data = doc.data() || {};
    const entityType = data.entityType || data.targetType || data.kind || null;
    const entityId = data.entityId || data.targetId || null;
    const actor = data.actor || data.user || data.userId || null;
    const createdAt = data.createdAt || data.timestamp || data.updatedAt || null;
    const comment = data.metadata?.comment || data.metadata?.body || data.details?.comment || null;
    const summary = comment || data.description || data.message || data.title || null;
    const activityType = data.activityType || null;
    const baseEntry = {
      docId: doc.id,
      summary,
      actor,
      createdAt,
      raw: data,
    };

    if (entityType && entityId && !latestByEntity.has(`${entityType}:${entityId}`)) {
      latestByEntity.set(`${entityType}:${entityId}`, baseEntry);
    }

    if (activityType) {
      if (!activityByType.has(activityType)) {
        activityByType.set(activityType, []);
      }
      activityByType.get(activityType).push(baseEntry);
      if (!latestByType.has(activityType)) {
        latestByType.set(activityType, {
          createdAt,
          data,
          actor,
          summary,
          docId: doc.id,
          raw: data,
        });
      }
    }
  }

  return { latestByEntity, latestByType, activityByType };
};

const collectGoalsAndStories = async (db, taskDocs, storyDocs) => {
  const goalIds = new Set();
  const storyIds = new Set();

  for (const task of taskDocs) {
    if (task.goalId) goalIds.add(task.goalId);
    if (task.storyId) storyIds.add(task.storyId);
  }
  for (const story of storyDocs) {
    if (story.goalId) goalIds.add(story.goalId);
  }

  const [goalSnapshots, storySnapshots] = await Promise.all([
    goalIds.size
      ? Promise.all(
        Array.from(goalIds).map((goalId) => db.collection('goals').doc(goalId).get())
      )
      : [],
    storyIds.size
      ? Promise.all(
        Array.from(storyIds).map((storyId) => db.collection('stories').doc(storyId).get())
      )
      : [],
  ]);

  const goalsById = new Map();
  const storiesById = new Map();

  for (const snap of goalSnapshots) {
    if (snap.exists) goalsById.set(snap.id, { id: snap.id, ...snap.data() });
  }
  for (const snap of storySnapshots) {
    if (snap.exists) storiesById.set(snap.id, { id: snap.id, ...snap.data() });
  }

  return { goalsById, storiesById };
};

const normaliseTaskStatus = (status) => {
  if (typeof status === 'number') {
    if (status >= 3) return 'blocked';
    if (status === 2) return 'done';
    if (status === 1) return 'in-progress';
    return 'backlog';
  }
  const str = String(status || '').toLowerCase();
  if (!str) return 'backlog';
  if (str.includes('done') || str.includes('complete')) return 'done';
  if (str.includes('block')) return 'blocked';
  if (str.includes('progress') || str.includes('active')) return 'in-progress';
  if (str.includes('review') || str.includes('qa')) return 'in-review';
  return 'backlog';
};

const isRoutineLikeTask = (task) => {
  const type = String(task?.type || task?.category || '').toLowerCase();
  if (['routine', 'chore', 'habit', 'habitual'].some((k) => type.includes(k))) return true;
  const tags = Array.isArray(task?.tags) ? task.tags.map((t) => String(t || '').toLowerCase()) : [];
  if (tags.some((t) => ['routine', 'chore', 'habit', 'habitual'].includes(t))) return true;
  return false;
};

const normaliseStoryStatus = (status) => {
  if (typeof status === 'number') {
    return STORY_STATUS_MAP[status] || 'backlog';
  }
  const str = String(status || '').toLowerCase();
  if (!str) return 'backlog';
  if (str.includes('done') || str.includes('complete')) return 'done';
  if (str.includes('test') || str.includes('qa')) return 'testing';
  if (str.includes('active') || str.includes('progress')) return 'in-progress';
  if (str.includes('plan')) return 'planned';
  return 'backlog';
};

const normaliseGoalStatus = (status) => {
  if (typeof status === 'number') {
    return GOAL_STATUS_MAP[status] || 'new';
  }
  const str = String(status || '').toLowerCase();
  if (!str) return 'new';
  if (str.includes('block')) return 'blocked';
  if (str.includes('defer')) return 'deferred';
  if (str.includes('progress') || str.includes('active')) return 'in-progress';
  if (str.includes('done') || str.includes('complete')) return 'complete';
  return 'new';
};

const normaliseSprintStatus = (value) => {
  if (typeof value === 'number') return value;
  const str = String(value || '').toLowerCase();
  if (!str) return null;
  if (str.includes('active')) return 1;
  if (str.includes('plan')) return 0;
  if (str.includes('done') || str.includes('complete')) return 2;
  if (str.includes('cancel')) return 3;
  return null;
};

const ensureTaskReference = (task) => {
  const ref = task.ref || task.reference || task.displayId || null;
  if (ref) return ref;
  return `TK-${String(task.id || '').slice(-6).padStart(6, '0').toUpperCase()}`;
};

const ensureStoryReference = (story) => {
  if (!story) return null;
  const ref = story.ref || story.reference || story.displayId || null;
  if (ref) return ref;
  return `STRY-${String(story.id || '').slice(-6).padStart(6, '0').toUpperCase()}`;
};

const ensureGoalReference = (goal) => {
  if (!goal) return null;
  const ref = goal.ref || goal.reference || goal.displayId || null;
  if (ref) return ref;
  return `GOAL-${String(goal.id || '').slice(-6).padStart(6, '0').toUpperCase()}`;
};

const makeDeepLink = (type, refOrId) => {
  if (!type || !refOrId) return null;
  if (type === 'task' || type === 'story' || type === 'goal') {
    return buildEntityUrl(type, null, refOrId);
  }
  const base =
    type === 'chore' ? '/chores' :
      type === 'routine' ? '/routines' :
        type === 'habit' ? '/habits' :
          '/';
  return buildAbsoluteUrl(`${base}/${encodeURIComponent(refOrId)}`);
};

const buildGoogleEventLink = (eventId) => {
  if (!eventId) return null;
  try {
    return `https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(String(eventId))}`;
  } catch {
    return null;
  }
};

const isAiPlannerBlock = (block) => {
  if (!block) return false;
  const source = String(block.source || '').toLowerCase();
  if (source === 'gcal' || source === 'google_calendar') return false;
  if (block.aiGenerated === true || block.isAiGenerated === true || block.createdBy === 'ai') return true;
  const entryMethod = String(block.entry_method || block.entryMethod || '').toLowerCase();
  if (entryMethod.includes('calendar_ai')) return true;
  const sourceType = String(block.sourceType || block.source || '').toLowerCase();
  if (sourceType.includes('allocation')) return true;
  return false;
};

const buildDailySummaryData = async (db, userId, { day, timezone, locale = 'en-GB' }) => {
  const zone = coerceZone(timezone || DEFAULT_TIMEZONE);
  const { start, end } = computeDayWindow({ day, timezone: zone });
  const startMs = start.toMillis();
  const endMs = end.toMillis();
  const financeWindowDays = 5;
  const financeWindowStart = start.minus({ days: financeWindowDays - 1 }).startOf('day');
  const financeWindowLabel = `${isoDate(financeWindowStart)} → ${isoDate(end)}`;

  const [
    tasksSnap,
    storiesSnap,
    calendarSnap,
    remindersSnap,
    schedulerSnap,
    choresSnap,
    routinesSnap,
    goalsAllSnap,
    sprintsSnap,
    monzoTxSnap,
  ] = await Promise.all([
    db.collection('tasks').where('ownerUid', '==', userId).get(),
    db.collection('stories').where('ownerUid', '==', userId).get(),
    db.collection('calendar_blocks').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] })),
    db.collection('reminders').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] })),
    db.collection('scheduler_runs')
      .where('userId', '==', userId)
      .where('dayIso', '==', isoDate(start))
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
      .catch(() => ({ docs: [] })),
    db.collection('chores').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] })),
    db.collection('routines').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] })),
    db.collection('goals').where('ownerUid', '==', userId).get(),
    db.collection('sprints').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] })),
    db.collection('monzo_transactions')
      .where('ownerUid', '==', userId)
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(financeWindowStart.toJSDate()))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(end.toJSDate()))
      .orderBy('createdAt', 'desc')
      .limit(400)
      .get()
      .catch(() => ({ docs: [] })),
  ]);

  const taskDocs = toList(tasksSnap);
  const allTasks = taskDocs;
  const tasksById = new Map(allTasks.map((task) => [task.id, task]));

  const storiesAll = toList(storiesSnap);
  const storiesById = new Map(storiesAll.map((story) => [story.id, story]));

  const goalsAll = toList(goalsAllSnap);
  const goalLookup = new Map(goalsAll.map((goal) => [goal.id, goal]));
  const sprints = toList(sprintsSnap);
  const monzoTransactions = toList(monzoTxSnap);
  const financeDaily = monzoTransactions.length ? buildFinanceSummary(monzoTransactions) : null;

  const resolveActiveSprint = (sprintList) => {
    if (!Array.isArray(sprintList) || !sprintList.length) return null;
    const nowMs = Date.now();
    const byStatus = sprintList.find((sprint) => normaliseSprintStatus(sprint.status) === 1);
    if (byStatus) return byStatus;
    const inWindow = sprintList.find((sprint) => {
      const startMs = toMillis(sprint.startDate || sprint.start);
      const endMs = toMillis(sprint.endDate || sprint.end);
      if (!startMs || !endMs) return false;
      return nowMs >= startMs && nowMs <= endMs;
    });
    if (inWindow) return inWindow;
    return sprintList.find((sprint) => normaliseSprintStatus(sprint.status) === 0) || null;
  };

  const activeSprint = resolveActiveSprint(sprints);
  const activeSprintId = activeSprint?.id || null;

  const activeStories = activeSprintId
    ? storiesAll.filter((story) => {
        if (STORY_DONE_STATUSES.has(story.status)) return false;
        return story.sprintId === activeSprintId;
      })
    : [];
  const activeStoryIds = new Set(activeStories.map((story) => story.id));

  const activeTasks = activeSprintId
    ? allTasks.filter((task) => {
        if (TASK_DONE_STATUSES.has(task.status)) return false;
        if (task.deleted) return false;
        if (isRoutineLikeTask(task)) return false;
        const inSprint = task.sprintId && task.sprintId === activeSprintId;
        const inStorySprint = task.storyId && activeStoryIds.has(task.storyId);
        return inSprint || inStorySprint;
      })
    : [];

  const tasks = activeTasks;
  const stories = activeStories;

  const rawChores = toList(choresSnap);
  const dueChores = rawChores
    .map((chore) => {
      const dueMs = resolveRecurringDueWithinWindow(chore, start, end);
      if (!dueMs) return null;
      const dueDt = DateTime.fromMillis(dueMs, { zone });
      return {
        id: chore.id,
        title: chore.title || 'Chore',
        dueMs,
        dueIso: dueDt.toISO(),
        dueDisplay: formatDateTime(dueDt, { locale }),
        cadence: chore.recurrence?.rrule || null,
        durationMinutes: Number(chore.durationMinutes || 0) || null,
        priority: Number(chore.priority || 0) || null,
        tags: Array.isArray(chore.tags) ? chore.tags : [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.dueMs || Number.MAX_SAFE_INTEGER) - (b.dueMs || Number.MAX_SAFE_INTEGER));

  const rawRoutines = toList(routinesSnap);
  const dueRoutines = rawRoutines
    .map((routine) => {
      const dueMs = resolveRecurringDueWithinWindow(routine, start, end);
      if (!dueMs) return null;
      const dueDt = DateTime.fromMillis(dueMs, { zone });
      return {
        id: routine.id,
        title: routine.name || routine.title || 'Routine',
        dueMs,
        dueIso: dueDt.toISO(),
        dueDisplay: formatDateTime(dueDt, { locale }),
        cadence: routine.recurrence?.rrule || null,
        durationMinutes: Number(routine.durationMinutes || 0) || null,
        priority: Number(routine.priority || 0) || null,
        tags: Array.isArray(routine.tags) ? routine.tags : [],
        goalId: routine.goalId || null,
        theme: routine.theme || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.dueMs || Number.MAX_SAFE_INTEGER) - (b.dueMs || Number.MAX_SAFE_INTEGER));

  const goalsById = goalLookup;
  const taskSummaries = tasks.map((task) => {
    const goal = task.goalId ? goalsById.get(task.goalId) : null;
    const story = task.storyId ? storiesById.get(task.storyId) : null;
    const dueDt = toDateTime(task.dueDate || task.dueDateMs || task.targetDate, { zone });
    const aiReason = task.aiCriticalityReason || task.dueDateReason || null;
    return {
      id: task.id,
      ref: ensureTaskReference(task),
      title: task.title || task.description || 'Task',
      description: task.description || task.notes || task.details || null,
      goalId: goal?.id || null,
      goalTitle: goal?.title || null,
      storyId: story?.id || null,
      storyTitle: story?.title || null,
      theme: task.theme || goal?.theme || story?.theme || 'General',
      persona: task.persona || null,
      dueMs: dueDt ? dueDt.toMillis() : null,
      dueIso: dueDt ? dueDt.toISO() : null,
      dueDisplay: dueDt ? formatDateTime(dueDt, { locale }) : null,
      deepLink: makeDeepLink('task', ensureTaskReference(task)),
      status: normaliseTaskStatus(task.status),
      estimateMinutes: Number(task.estimateMin || task.estimatedMinutes || 0) || null,
      aiScore: task.aiCriticalityScore ?? null,
      aiReason,
      aiTextScore: task.aiCriticalityTextScore ?? task.aiPriorityTextScore ?? null,
      aiTextReason: task.aiCriticalityTextReason ?? task.aiPriorityTextReason ?? null,
      aiTextModel: task.aiCriticalityTextModel ?? task.aiPriorityTextModel ?? null,
    };
  });
  const { latestByEntity } = await buildActivityIndex(db, userId, 400);

  const hierarchy = [];
  const hierarchyIndex = new Map();

  for (const task of tasks) {
    const goal = task.goalId ? goalsById.get(task.goalId) : null;
    const story = task.storyId ? storiesById.get(task.storyId) : null;
    const themeKey = (task.theme || goal?.theme || story?.theme || 'General').toString();

    if (!hierarchyIndex.has(themeKey)) {
      const themeNode = { theme: themeKey, goals: [] };
      hierarchyIndex.set(themeKey, themeNode);
      hierarchy.push(themeNode);
    }
    const themeNode = hierarchyIndex.get(themeKey);

    const goalKey = goal ? goal.id : `__no_goal__${themeKey}`;
    let goalNode = themeNode.goals.find((g) => g.goalKey === goalKey);
    if (!goalNode) {
      goalNode = {
        goalKey,
        goalId: goal?.id || null,
        goalTitle: goal?.title || (goalKey.startsWith('__no_goal__') ? 'Unassigned' : 'Goal'),
        goalRef: ensureGoalReference(goal),
        stories: [],
      };
      themeNode.goals.push(goalNode);
    }

    const storyKey = story ? story.id : `__no_story__${goalKey}`;
    let storyNode = goalNode.stories.find((s) => s.storyKey === storyKey);
    if (!storyNode) {
      storyNode = {
        storyKey,
        storyId: story?.id || null,
        storyTitle: story?.title || (storyKey.startsWith('__no_story__') ? 'Backlog Task' : 'Story'),
        storyRef: ensureStoryReference(story),
        tasks: [],
      };
      goalNode.stories.push(storyNode);
    }

    const dueDt = toDateTime(task.dueDate || task.dueDateMs || task.targetDate, { zone });
    const activityKey = `task:${task.id}`;
    const activity = latestByEntity.get(activityKey) || null;

    storyNode.tasks.push({
      id: task.id,
      ref: ensureTaskReference(task),
      deepLink: makeDeepLink('task', ensureTaskReference(task)),
      description: task.title || task.description || 'Task',
      dueDateIso: dueDt ? dueDt.toISO() : null,
      dueDateDisplay: dueDt ? formatDateTime(dueDt, { locale }) : null,
      status: normaliseTaskStatus(task.status),
      latestComment: activity?.summary || null,
      latestCommentAt: activity?.createdAt ? toDateTime(activity.createdAt, { zone })?.toISO() : null,
      latestCommentActor: activity?.actor || null,
      theme: themeKey,
      goal: goalNode.goalTitle,
      story: storyNode.storyTitle,
    });
  }

  hierarchy.forEach((themeNode) => {
    themeNode.goals.forEach((goalNode) => {
      goalNode.stories.forEach((storyNode) => {
        storyNode.tasks.sort((a, b) => {
          const aDue = a.dueDateIso || '';
          const bDue = b.dueDateIso || '';
          return aDue.localeCompare(bDue);
        });
      });
      goalNode.stories.sort((a, b) => a.storyTitle.localeCompare(b.storyTitle));
    });
    themeNode.goals.sort((a, b) => a.goalTitle.localeCompare(b.goalTitle));
  });

  const storiesToStart = stories
    .filter((story) => (story.sprintDueDate || story.targetDate || story.plannedStartDate))
    .map((story) => {
      const goal = story.goalId ? (goalsById.get(story.goalId) || goalLookup.get(story.goalId)) : null;
      const due = toDateTime(story.sprintDueDate || story.targetDate, { zone });
      const acceptanceCriteria = Array.isArray(story.acceptanceCriteria)
        ? story.acceptanceCriteria.filter(Boolean)
        : typeof story.acceptanceCriteria === 'string'
          ? story.acceptanceCriteria.split('\n').map((item) => item.trim()).filter(Boolean)
          : [];
      const activity = latestByEntity.get(`story:${story.id}`) || null;
      return {
        id: story.id,
        ref: ensureStoryReference(story),
        deepLink: makeDeepLink('story', ensureStoryReference(story)),
        title: story.title || 'Story',
        description: story.description || null,
        goal: goal?.title || null,
        goalRef: ensureGoalReference(goal),
        sprintDueDateIso: due ? due.toISO() : null,
        sprintDueDateDisplay: due ? formatDate(due, { locale }) : null,
        status: story.status || 'open',
        acceptanceCriteria,
        latestComment: activity?.summary || null,
        latestCommentAt: activity?.createdAt ? toDateTime(activity.createdAt, { zone })?.toISO() : null,
      };
    })
    .sort((a, b) => {
      const aDue = a.sprintDueDateIso || '';
      const bDue = b.sprintDueDateIso || '';
      return aDue.localeCompare(bDue);
    });

  const normaliseAcceptanceCriteria = (entity) => {
    if (!entity) return [];
    if (Array.isArray(entity.acceptanceCriteria)) {
      return entity.acceptanceCriteria.filter(Boolean).map((item) => String(item).trim()).filter(Boolean).slice(0, 6);
    }
    if (typeof entity.acceptanceCriteria === 'string') {
      return entity.acceptanceCriteria.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 6);
    }
    return [];
  };

  const activeWorkItems = [
    ...tasks.map((task) => {
      const story = task.storyId ? storiesById.get(task.storyId) : null;
      const goal = task.goalId ? goalsById.get(task.goalId) : null;
      const dueDt = toDateTime(task.dueDate || task.dueDateMs || task.targetDate, { zone });
      return {
        type: 'task',
        id: task.id,
        ref: ensureTaskReference(task),
        title: task.title || task.description || 'Task',
        description: task.description || task.notes || task.details || null,
        acceptanceCriteria: normaliseAcceptanceCriteria(task),
        theme: task.theme || story?.theme || goal?.theme || 'General',
        goalId: goal?.id || null,
        storyId: story?.id || null,
        storyRef: story ? ensureStoryReference(story) : null,
        dueIso: dueDt ? dueDt.toISO() : null,
        dueDisplay: dueDt ? formatDateTime(dueDt, { locale }) : null,
        deepLink: makeDeepLink('task', ensureTaskReference(task)),
        aiScore: task.aiCriticalityScore ?? null,
        aiReason: task.aiCriticalityReason || task.dueDateReason || null,
        aiTextScore: task.aiCriticalityTextScore ?? task.aiPriorityTextScore ?? null,
        aiTextReason: task.aiCriticalityTextReason ?? task.aiPriorityTextReason ?? null,
        aiTextModel: task.aiCriticalityTextModel ?? task.aiPriorityTextModel ?? null,
      };
    }),
    ...stories.map((story) => {
      const goal = story.goalId ? goalsById.get(story.goalId) : null;
      const dueDt = toDateTime(story.sprintDueDate || story.targetDate || story.plannedStartDate, { zone });
      return {
        type: 'story',
        id: story.id,
        ref: ensureStoryReference(story),
        title: story.title || 'Story',
        description: story.description || null,
        acceptanceCriteria: normaliseAcceptanceCriteria(story),
        theme: story.theme || goal?.theme || 'General',
        goalId: goal?.id || null,
        dueIso: dueDt ? dueDt.toISO() : null,
        dueDisplay: dueDt ? formatDateTime(dueDt, { locale }) : null,
        deepLink: makeDeepLink('story', ensureStoryReference(story)),
        aiScore: story.aiCriticalityScore ?? null,
        aiReason: story.aiCriticalityReason || story.dueDateReason || null,
        aiTextScore: story.aiCriticalityTextScore ?? story.aiPriorityTextScore ?? null,
        aiTextReason: story.aiCriticalityTextReason ?? story.aiPriorityTextReason ?? null,
        aiTextModel: story.aiCriticalityTextModel ?? story.aiPriorityTextModel ?? null,
      };
    }),
  ].sort((a, b) => (Number(b.aiScore || 0) - Number(a.aiScore || 0)));

  const calendarBlocks = toList(calendarSnap)
    .map((block) => {
      const startDt = toDateTime(block.start || block.startAt, { zone });
      const endDt = toDateTime(block.end || block.endAt, { zone });
      const story = block.storyId ? storiesById.get(block.storyId) : null;
      const task = block.taskId ? tasksById.get(block.taskId) : null;
      const goalId = block.goalId || task?.goalId || story?.goalId || null;
      const goal = goalId ? goalsById.get(goalId) : null;
      const goalRef = goal ? ensureGoalReference(goal) : null;
      const deepLink = block.deepLink || block.linkUrl || block.url || null;
      const entryMethod = block.entry_method || block.entryMethod || null;
      const sourceType = block.sourceType || block.source || null;
      const aiGenerated = block.aiGenerated === true || block.isAiGenerated === true || block.createdBy === 'ai';
      const googleEventId = block.googleEventId || null;
      const externalLink = block.externalLink || block.htmlLink || null;
      const googleLink = externalLink || buildGoogleEventLink(googleEventId);
      const aiPlanner = isAiPlannerBlock(block);
      return {
        id: block.id,
        title: block.title || block.note || block.category || 'Block',
        theme: block.theme || story?.theme || task?.theme || 'General',
        startIso: startDt ? startDt.toISO() : null,
        endIso: endDt ? endDt.toISO() : null,
        startDisplay: startDt ? formatDateTime(startDt, { locale }) : null,
        endDisplay: endDt ? formatDateTime(endDt, { locale }) : null,
        linkedStory: story ? { id: story.id, ref: ensureStoryReference(story), deepLink: makeDeepLink('story', ensureStoryReference(story)) } : null,
        linkedTask: task ? { id: task.id, ref: ensureTaskReference(task), deepLink: makeDeepLink('task', ensureTaskReference(task)) } : null,
        linkedGoal: goal ? { id: goal.id, ref: goalRef, title: goal.title || goal.name || 'Goal', deepLink: makeDeepLink('goal', goalRef) } : null,
        allocatedMinutes: startDt && endDt ? Math.round(endDt.diff(startDt, 'minutes').minutes) : null,
        aiGenerated,
        entryMethod,
        sourceType,
        deepLink,
        googleEventId,
        googleLink,
        externalLink,
        isAiPlanner: aiPlanner,
      };
    })
    .filter((block) => {
      if (!block.startIso || !block.endIso) return false;
      const blockStartMs = toDateTime(block.startIso, { zone }).toMillis();
      return blockStartMs >= start.minus({ minutes: 1 }).toMillis() && blockStartMs <= end.plus({ hours: 16 }).toMillis();
    })
    .sort((a, b) => (a.startIso || '').localeCompare(b.startIso || ''));

  const plannerBlocks = calendarBlocks
    .filter((block) => block.isAiPlanner)
    .map((block) => ({
      id: block.id,
      title: block.title,
      theme: block.theme || 'General',
      startDisplay: block.startDisplay,
      endDisplay: block.endDisplay,
      durationMinutes: block.allocatedMinutes || 0,
      linkedGoal: block.linkedGoal || null,
      linkedStory: block.linkedStory || null,
      linkedTask: block.linkedTask || null,
      deepLink: block.deepLink || null,
      googleLink: block.googleLink || null,
    }));

  const plannerSummary = (() => {
    if (!plannerBlocks.length) return null;
    const themeTotals = new Map();
    let totalMinutes = 0;
    plannerBlocks.forEach((block) => {
      const minutes = Number(block.durationMinutes || 0) || 0;
      totalMinutes += minutes;
      const themeKey = block.theme || 'General';
      const entry = themeTotals.get(themeKey) || { theme: themeKey, minutes: 0, count: 0 };
      entry.minutes += minutes;
      entry.count += 1;
      themeTotals.set(themeKey, entry);
    });
    const byTheme = Array.from(themeTotals.values())
      .map((entry) => ({
        theme: entry.theme,
        minutes: entry.minutes,
        hours: Math.round((entry.minutes / 60) * 10) / 10,
        count: entry.count,
      }))
      .sort((a, b) => b.minutes - a.minutes);
    return {
      totalBlocks: plannerBlocks.length,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      byTheme,
    };
  })();

  const reminders = toList(remindersSnap)
    .filter((reminder) => (reminder.status || 'open') !== 'done')
    .map((reminder) => ({
      id: reminder.id,
      title: reminder.title || reminder.note || 'Reminder',
      dueDate: reminder.dueDate || reminder.dueAt || null,
      relatedTaskId: reminder.taskId || null,
    }));

  const priorityCandidates = [];
  const resolvePriorityScore = (entity, type) => {
    const fields = [
      entity.aiCriticalityScore,
      entity.aiCriticalityScore,
      entity.priorityScore,
      entity.importanceScore,
      entity.priority,
      type === 'story' ? entity.points : null,
    ];
    for (const val of fields) {
      const num = Number(val);
      if (Number.isFinite(num)) return num;
    }
    return 0;
  };

  for (const task of tasks) {
    const dueDt = toDateTime(task.dueDate || task.dueDateMs || task.targetDate, { zone });
    const dueMs = dueDt ? dueDt.toMillis() : end.toMillis();
    const priorityScore = resolvePriorityScore(task, 'task');
    const urgencyScore = Math.max(0, 1_000_000 - Math.max(0, dueMs - startMs));
    const score = priorityScore * 1000 + urgencyScore;
    const aiReason = task.aiCriticalityReason || task.dueDateReason || null;
    priorityCandidates.push({
      type: 'task',
      id: task.id,
      ref: ensureTaskReference(task),
      title: task.title || 'Task',
      goalId: task.goalId || null,
      storyId: task.storyId || null,
      status: normaliseTaskStatus(task.status),
      score,
      priorityScore,
      urgencyScore,
      aiScore: task.aiCriticalityScore ?? priorityScore ?? null,
      aiReason,
      aiTextModel: task.aiCriticalityTextModel ?? task.aiPriorityTextModel ?? null,
      deepLink: makeDeepLink('task', ensureTaskReference(task)),
      dueDateDisplay: dueDt ? formatDateTime(dueDt, { locale }) : null,
      dueDateIso: dueDt ? dueDt.toISO() : null,
    });
  }

  for (const story of stories) {
    const dueDt = toDateTime(story.sprintDueDate || story.targetDate || story.plannedStartDate, { zone });
    const dueMs = dueDt ? dueDt.toMillis() : end.plus({ days: 3 }).toMillis();
    const priorityScore = resolvePriorityScore(story, 'story');
    const urgencyScore = Math.max(0, 1_000_000 - Math.max(0, dueMs - startMs));
    const score = priorityScore * 1000 + urgencyScore;
    const aiReason = story.aiCriticalityReason || story.dueDateReason || null;
    priorityCandidates.push({
      type: 'story',
      id: story.id,
      ref: ensureStoryReference(story),
      title: story.title || 'Story',
      goalId: story.goalId || null,
      status: normaliseStoryStatus(story.status),
      score,
      priorityScore,
      urgencyScore,
      aiScore: story.aiCriticalityScore ?? priorityScore ?? null,
      aiReason,
      aiTextModel: story.aiCriticalityTextModel ?? story.aiPriorityTextModel ?? null,
      deepLink: makeDeepLink('story', ensureStoryReference(story)),
      dueDateDisplay: dueDt ? formatDateTime(dueDt, { locale }) : null,
      dueDateIso: dueDt ? dueDt.toISO() : null,
    });
  }

  const priorities = priorityCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  let worldSummary = null;
  let worldWeather = null;
  let worldSource = null;

  try {
    const worldDoc = await db.collection('world_summaries').doc(userId).get();
    if (worldDoc.exists) {
      const data = worldDoc.data() || {};
      worldSummary = data.summary || data.news || null;
      worldWeather = data.weather || null;
      worldSource = data.source || null;
    }
  } catch (error) {
    console.warn('[reporting] world_summaries lookup failed', error?.message || error);
  }

  const profile = await loadProfile(db, userId);
  if (!worldSummary) worldSummary = profile.worldSummary || profile.newsBrief || null;
  if (!worldWeather) worldWeather = profile.weatherSnapshot || profile.weatherBrief || null;

  // Fallback: fetch fresh news/weather if still missing
  try {
    if (!worldSummary) {
      const newsItems = await fetchNews(5);
      if (Array.isArray(newsItems) && newsItems.length) {
        worldSummary = { news: newsItems, highlights: newsItems, source: 'newsWeather' };
        if (!worldSource) worldSource = 'newsWeather';
      }
    }
    if (!worldWeather) {
      const lat = profile.locationLat || profile.lat || 51.5074;
      const lon = profile.locationLon || profile.lon || -0.1278;
      const weather = await fetchWeather(lat, lon);
      if (weather) {
        worldWeather = weather;
        if (!worldSummary || typeof worldSummary !== 'object') {
          worldSummary = { summary: null, weather, source: worldSource || 'newsWeather' };
        } else {
          worldSummary = { ...(worldSummary || {}), weather, source: worldSource || 'newsWeather' };
        }
      }
    }
  } catch (error) {
    console.warn('[reporting] news/weather fetch failed', error?.message || error);
  }

  const extractNewsLines = (summary) => {
    if (!summary) return [];
    if (Array.isArray(summary.highlights)) return summary.highlights;
    if (Array.isArray(summary.news)) return summary.news;
    return [];
  };

  const normaliseWeather = (weather) => {
    if (!weather) return null;
    if (typeof weather === 'string') return { summary: weather, temp: null };
    return {
      summary: weather.summary || weather.description || null,
      temp: weather.temp || weather.temperature || null,
    };
  };

  const dailyBrief = (() => {
    const lines = [];
    if (typeof worldSummary === 'string') lines.push(worldSummary);
    if (worldSummary && typeof worldSummary === 'object' && typeof worldSummary.summary === 'string') {
      lines.push(worldSummary.summary);
    }
    const newsItems = extractNewsLines(worldSummary)
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'string') return item;
        return item.title || item.summary || item.headline || null;
      })
      .filter(Boolean)
      .slice(0, 5);
    const weatherPayload = normaliseWeather(worldWeather || (worldSummary && worldSummary.weather));
    return {
      lines,
      news: newsItems,
      weather: weatherPayload,
      source: worldSource || (worldSummary && worldSummary.source) || null,
    };
  })();

  let fitness = null;
  try {
    const fitnessDoc = await db.collection('fitness_overview').doc(userId).get();
    if (fitnessDoc.exists) {
      fitness = fitnessDoc.data() || null;
    } else {
      const latestWorkout = await db
        .collection('metrics_workouts')
        .where('ownerUid', '==', userId)
        .orderBy('startDate', 'desc')
        .limit(1)
        .get();
      const latest = latestWorkout.docs[0]?.data() || null;
      const hrvDoc = await db
        .collection('metrics_hrv')
        .where('ownerUid', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      const hrv = hrvDoc.docs[0]?.data() || null;
      if (latest || hrv) {
        fitness = {
          lastWorkout: latest ? {
            provider: latest.provider || null,
            title: latest.title || latest.name || null,
            startDate: latest.startDate || latest.startTime || null,
            distance_m: latest.distance_m || latest.distance || null,
            duration_s: latest.movingTime_s || latest.elapsedTime_s || null,
          } : null,
          hrv: hrv ? { value: hrv.value || hrv.hrv || null, capturedAt: hrv.timestamp || hrv.date || null } : null,
        };
      }
    }
  } catch (error) {
    console.warn('[reporting] fitness lookup failed', error?.message || error);
  }

  let monzo = null;
  try {
    const budgetDoc = await db.collection('monzo_budget_summary').doc(userId).get();
    if (budgetDoc.exists) {
      const data = budgetDoc.data() || {};
      monzo = {
        totals: data.totals || null,
        categories: Array.isArray(data.categories) ? data.categories.slice(0, 10) : [],
        updatedAt: data.updatedAt || null,
      };
    }
    const alignmentDoc = await db.collection('monzo_goal_alignment').doc(userId).get();
    if (alignmentDoc.exists) {
      monzo = Object.assign({}, monzo || {}, {
        goalAlignment: alignmentDoc.data() || null,
      });
    }
  } catch (error) {
    console.warn('[reporting] monzo lookup failed', error?.message || error);
  }

  let goalProgress = null;
  if (goalsAll.length) {
    const counts = {
      total: goalsAll.length,
      completed: 0,
      active: 0,
      blocked: 0,
      deferred: 0,
    };
    const goalDetails = goalsAll.map((goal) => {
      const status = normaliseGoalStatus(goal.status);
      if (status === 'complete') counts.completed += 1;
      else if (status === 'blocked') counts.blocked += 1;
      else if (status === 'deferred') counts.deferred += 1;
      else counts.active += 1;
      const dueDt = goal.targetDate ? toDateTime(goal.targetDate, { zone }) : null;
      return {
        id: goal.id,
        ref: ensureGoalReference(goal),
        title: goal.title || 'Goal',
        status,
        progress: goal.progress ?? goal.percentComplete ?? null,
        dueDisplay: dueDt ? formatDate(dueDt, { locale }) : null,
        deepLink: makeDeepLink('goal', ensureGoalReference(goal)),
      };
    });
    const topGoals = goalDetails
      .filter((g) => g.status !== 'complete')
      .sort((a, b) => {
        const aProgress = Number(a.progress || 0);
        const bProgress = Number(b.progress || 0);
        return aProgress - bProgress;
      })
      .slice(0, 5);
    goalProgress = Object.assign({}, counts, {
      percentComplete: counts.total ? Math.round((counts.completed / counts.total) * 100) : null,
      goals: topGoals,
    });
  }

  let sprintProgress = null;
  if (activeSprint) {
    const sprintStories = storiesAll.filter((story) => story.sprintId === activeSprint.id);
    const completedStories = sprintStories.filter((story) => normaliseStoryStatus(story.status) === 'done').length;
    const pendingStories = sprintStories
      .filter((story) => STORY_NOT_STARTED_STATUSES.has(normaliseStoryStatus(story.status)))
      .map((story) => {
        const goal = story.goalId ? (goalLookup.get(story.goalId) || goalsById.get(story.goalId)) : null;
        const due = toDateTime(story.sprintDueDate || story.targetDate, { zone });
        const status = normaliseStoryStatus(story.status);
        return {
          id: story.id,
          ref: ensureStoryReference(story),
          title: story.title || 'Story',
          status,
          goal: goal?.title || null,
          dueDisplay: due ? formatDate(due, { locale }) : null,
          deepLink: makeDeepLink('story', ensureStoryReference(story)),
        };
      })
      .slice(0, 5);
    const totalStories = sprintStories.length;
    const nowMs = Date.now();
    const startMs = toMillis(activeSprint.startDate || activeSprint.start || null);
    const endMs = toMillis(activeSprint.endDate || activeSprint.end || null);
    let daysTotal = null;
    let daysRemaining = null;
    let daysElapsed = null;
    let timeProgress = null;
    let onTrack = null;
    if (startMs && endMs && endMs >= startMs) {
      daysTotal = Math.max(1, Math.ceil((endMs - startMs) / 86400000));
      daysRemaining = Math.max(0, Math.ceil((endMs - nowMs) / 86400000));
      daysElapsed = Math.min(daysTotal, Math.max(0, daysTotal - daysRemaining));
      timeProgress = daysTotal ? Math.round((daysElapsed / daysTotal) * 100) : null;
      if (timeProgress != null) {
        const completedPct = totalStories ? Math.round((completedStories / totalStories) * 100) : 0;
        onTrack = completedPct >= timeProgress - 5;
      }
    }
    sprintProgress = {
      sprintId: activeSprint.id,
      sprintName: activeSprint.name || activeSprint.ref || `Sprint ${activeSprint.id.slice(0, 4)}`,
      startDate: activeSprint.startDate || null,
      endDate: activeSprint.endDate || null,
      totalStories,
      completedStories,
      percentComplete: totalStories ? Math.round((completedStories / totalStories) * 100) : null,
      pendingStories,
      daysTotal,
      daysElapsed,
      daysRemaining,
      timeProgress,
      onTrack,
    };
  }

  const budgetProgress = monzo?.totals && monzo?.budgetProgress ? monzo.budgetProgress : null;

  const budgetSummary = (() => {
    if (!budgetProgress || !budgetProgress.length) return null;
    const totalBudget = budgetProgress.reduce((sum, entry) => sum + (Number(entry.budget) || 0), 0);
    const totalActual = budgetProgress.reduce((sum, entry) => sum + (Number(entry.actual) || 0), 0);
    if (!totalBudget) return null;
    const utilisation = Math.min(100, Math.round((totalActual / totalBudget) * 100));
    const remaining = totalBudget - totalActual;
    return {
      totalBudget,
      totalActual,
      remaining,
      utilisation,
      currency: monzo?.currency || 'GBP',
    };
  })();

  let financeAlerts = [];
  if (monzo?.budgetProgress) {
    const overBudget = monzo.budgetProgress.filter(b => b.variance < 0).map(b => `${b.key}: Over by £${Math.abs(b.variance).toFixed(2)}`);
    if (overBudget.length > 0) {
      financeAlerts.push(...overBudget);
    }
  }
  if (monzo?.goalAlignment?.themes) {
    const themeShortfalls = monzo.goalAlignment.themes.filter(t => t.totalShortfall > 0).map(t => `${t.themeName}: Shortfall £${t.totalShortfall.toFixed(2)}`);
    if (themeShortfalls.length > 0) {
      financeAlerts.push(...themeShortfalls);
    }
  }

  const manualRerunCallable = 'sendDailySummaryNow';

  const schedulerChanges = schedulerSnap.docs[0]?.data()?.changes || [];

  const kpis = {
    sprint: sprintProgress
      ? {
          name: sprintProgress.sprintName || null,
          percentComplete: sprintProgress.percentComplete ?? null,
          daysRemaining: sprintProgress.daysRemaining ?? null,
          timeProgress: sprintProgress.timeProgress ?? null,
          status: sprintProgress.onTrack == null ? null : (sprintProgress.onTrack ? 'On track' : 'Behind'),
        }
      : null,
    fitness: fitness && fitness.fitnessScore != null ? { score: fitness.fitnessScore } : null,
    budget: budgetSummary,
  };

  return {
    metadata: {
      dayIso: isoDate(start),
      timezone: zone,
      locale,
      start: start.toISO(),
      end: end.toISO(),
      financeWindowDays,
      financeWindowStart: financeWindowStart.toISO(),
      financeWindowEnd: end.toISO(),
      financeWindowLabel,
      generatedAt: new Date().toISOString(),
      manualCallable: manualRerunCallable,
    },
    hierarchy,
    tasksDue: taskSummaries,
    storiesToStart,
    activeWorkItems,
    calendarBlocks,
    plannerSummary,
    plannerBlocks,
    reminders,
    choresDue: dueChores,
    routinesDue: dueRoutines,
    priorities,
    dailyBrief,
    worldSummary: worldSummary ? { summary: worldSummary, weather: worldWeather, source: worldSource } : null,
    fitness,
    monzo,
    financeDaily,
    financeAlerts,
    profile,
    schedulerChanges,
    goalProgress,
    sprintProgress,
    budgetProgress,
    budgetSummary,
    kpis,
  };
};

const buildDataQualitySnapshot = async (db, userId, { windowEnd, windowHours = 24 }) => {
  const endDt = windowEnd ? toDateTime(windowEnd, { zone: DEFAULT_TIMEZONE }) : DateTime.now();
  const startDt = endDt.minus({ hours: windowHours });
  const { activityByType } = await buildActivityIndex(db, userId, 500);

  const withinWindow = (value) => {
    const dt = toDateTime(value, { defaultValue: null });
    if (!dt) return false;
    return dt >= startDt && dt <= endDt;
  };

  const conversionActivities = activityByType.get('task_to_story_conversion') || [];
  const dedupeActivities = activityByType.get('deduplicate_tasks') || [];

  const conversionTaskIds = new Set();
  const conversionStoryIds = new Set();
  const conversionRecords = [];

  for (const activity of conversionActivities) {
    if (!withinWindow(activity.createdAt)) continue;
    const metadata = activity.raw?.metadata || {};
    const createdAtIso = toDateTime(activity.createdAt, { defaultValue: null })?.toISO();
    const actor = activity.actor || metadata.actor || 'AI_Agent';
    const runId = metadata.runId || metadata.lastRunId || activity.raw?.runId || null;
    const baseSource = metadata.automation || activity.raw?.automation || (actor === 'AI_Agent' ? 'automation' : 'manual');

    if (Array.isArray(metadata.results) && metadata.results.length) {
      metadata.results.forEach((result, index) => {
        const taskId = result.taskId || result.sourceTaskId || null;
        const storyId = result.storyId || null;
        if (taskId) conversionTaskIds.add(taskId);
        if (storyId) conversionStoryIds.add(storyId);
        conversionRecords.push({
          taskId,
          storyId,
          storyRef: result.storyRef || null,
          taskStatus: result.status || null,
          createdAtIso,
          actor,
          runId,
          source: baseSource,
          index,
          activityDocId: activity.docId,
        });
      });
      continue;
    }

    const taskId = metadata.taskId || activity.raw?.taskId || activity.raw?.entityId || null;
    const storyId = metadata.storyId || activity.raw?.storyId || null;
    if (taskId) conversionTaskIds.add(taskId);
    if (storyId) conversionStoryIds.add(storyId);
    conversionRecords.push({
      taskId,
      storyId,
      storyRef: metadata.storyRef || null,
      taskStatus: metadata.status || null,
      createdAtIso,
      actor,
      runId,
      source: baseSource,
      index: 0,
      activityDocId: activity.docId,
    });
  }

  const duplicateTaskIds = new Set();
  const canonicalTaskIds = new Set();
  const dedupeRecords = [];

  for (const activity of dedupeActivities) {
    if (!withinWindow(activity.createdAt)) continue;
    const metadata = activity.raw?.metadata || {};
    const groups = Array.isArray(metadata.groups) ? metadata.groups : [];
    const createdAtIso = toDateTime(activity.createdAt, { defaultValue: null })?.toISO();
    const actor = activity.actor || metadata.actor || 'AI_Agent';
    const hardDelete = !!metadata.hardDelete;

    for (const group of groups) {
      const canonicalId = group.kept;
      if (!canonicalId || !Array.isArray(group.removed) || !group.removed.length) continue;
      canonicalTaskIds.add(canonicalId);
      group.removed.forEach((id) => duplicateTaskIds.add(id));
      dedupeRecords.push({
        canonicalId,
        removedIds: group.removed,
        keys: Array.isArray(group.keys) ? group.keys : [],
        createdAtIso,
        actor,
        hardDelete,
        activityDocId: activity.docId,
      });
    }
  }

  const fetchDocsByIds = async (collection, ids) => {
    const uniqueIds = Array.from(ids).filter(Boolean);
    if (!uniqueIds.length) return new Map();
    const docs = await Promise.all(uniqueIds.map((id) => db.collection(collection).doc(id).get()));
    const map = new Map();
    docs.forEach((snap) => {
      if (snap.exists) map.set(snap.id, { id: snap.id, ...(snap.data() || {}) });
    });
    return map;
  };

  const tasksToFetch = new Set([...conversionTaskIds, ...duplicateTaskIds, ...canonicalTaskIds]);
  const tasksMap = await fetchDocsByIds('tasks', tasksToFetch);
  const storiesMap = await fetchDocsByIds('stories', conversionStoryIds);

  const conversions = conversionRecords.map((record) => {
    const task = record.taskId ? tasksMap.get(record.taskId) : null;
    const story = record.storyId ? storiesMap.get(record.storyId) : null;
    const taskRef = task ? ensureTaskReference(task) : (record.taskId || null);
    const storyRef = story ? ensureStoryReference(story) : (record.storyRef || record.storyId || null);
    const taskTitle = task?.title || taskRef || record.taskId || 'Task';
    const storyTitle = story?.title || storyRef || record.storyId || 'Story';
    const taskDeepLink = taskRef ? makeDeepLink('task', taskRef) : null;
    const storyDeepLink = storyRef ? makeDeepLink('story', storyRef) : null;
    const acceptanceCount = Array.isArray(story?.acceptanceCriteria)
      ? story.acceptanceCriteria.filter(Boolean).length
      : 0;
    const acceptanceAutoFilled = !!(story?.acceptanceCriteriaGenerated || story?.generatedAcceptanceCriteria);

    return {
      taskId: record.taskId || null,
      taskRef,
      taskTitle,
      taskDeepLink,
      storyId: record.storyId || null,
      storyRef,
      storyTitle,
      storyDeepLink,
      actor: record.actor,
      createdAt: record.createdAtIso,
      runId: record.runId || null,
      source: record.source || 'manual',
      acceptanceCount,
      acceptanceAutoFilled,
    };
  });

  const dedupes = dedupeRecords.map((record) => {
    const canonicalTask = tasksMap.get(record.canonicalId) || null;
    const canonicalRef = canonicalTask ? ensureTaskReference(canonicalTask) : record.canonicalId;
    const canonicalTitle = canonicalTask?.title || canonicalRef || 'Task';
    const canonicalReminder = canonicalTask?.reminderId || canonicalTask?.iosReminderId || null;
    const canonicalDeepLink = canonicalRef ? makeDeepLink('task', canonicalRef) : null;

    const duplicates = record.removedIds.map((id) => {
      const duplicateTask = tasksMap.get(id) || null;
      const duplicateRef = duplicateTask ? ensureTaskReference(duplicateTask) : id;
      return {
        id,
        ref: duplicateRef,
        title: duplicateTask?.title || duplicateRef || 'Task',
        reminderId: duplicateTask?.reminderId || duplicateTask?.iosReminderId || null,
        source: duplicateTask?.source || null,
      };
    });

    return {
      canonical: {
        id: record.canonicalId,
        ref: canonicalRef,
        title: canonicalTitle,
        reminderId: canonicalReminder,
        deepLink: canonicalDeepLink,
      },
      duplicates,
      keys: record.keys,
      actor: record.actor,
      createdAt: record.createdAtIso,
      hardDelete: record.hardDelete,
    };
  });

  const errorEntries = [];
  activityByType.forEach((entries, type) => {
    if (!type || !type.toLowerCase().includes('error')) return;
    entries.forEach((entry) => {
      if (!withinWindow(entry.createdAt)) return;
      const createdAtIso = toDateTime(entry.createdAt, { defaultValue: null })?.toISO();
      const description = entry.summary || entry.raw?.description || entry.raw?.message || 'Automation error';
      errorEntries.push({
        id: entry.docId,
        ref: entry.docId,
        title: createdAtIso ? `${description} (${createdAtIso.slice(0, 16)})` : description,
        message: entry.raw?.message || null,
      });
    });
  });

  const storiesSnap = await db.collection('stories').where('ownerUid', '==', userId).get();
  const stories = toList(storiesSnap);

  const missingAcceptance = stories
    .filter((story) => !STORY_DONE_STATUSES.has(story.status))
    .filter((story) => {
      if (Array.isArray(story.acceptanceCriteria)) {
        return story.acceptanceCriteria.filter(Boolean).length === 0;
      }
      if (typeof story.acceptanceCriteria === 'string') {
        return story.acceptanceCriteria.trim().length === 0;
      }
      return true;
    })
    .map((story) => ({
      id: story.id,
      ref: ensureStoryReference(story),
      title: story.title || 'Story',
      autoFilled: !!story.acceptanceCriteriaGenerated || !!story.generatedAcceptanceCriteria,
      deepLink: makeDeepLink('story', ensureStoryReference(story)),
    }));

  const missingGoalLink = stories
    .filter((story) => !story.goalId)
    .map((story) => ({
      id: story.id,
      ref: ensureStoryReference(story),
      title: story.title || 'Story',
      deepLink: makeDeepLink('story', ensureStoryReference(story)),
    }));

  const summaryStats = {
    conversions: conversions.length,
    dedupes: dedupes.length,
    missingAcceptance: missingAcceptance.length,
    missingGoalLink: missingGoalLink.length,
    errors: errorEntries.length,
  };

  return {
    window: {
      startIso: startDt.toISO(),
      endIso: endDt.toISO(),
      hours: windowHours,
    },
    conversions,
    dedupes,
    missingAcceptance,
    missingGoalLink,
    errors: errorEntries,
    summaryStats,
  };
};

const loadSchedulerInputs = async (db, userId, { timezone } = {}) => {
  const zone = coerceZone(timezone || DEFAULT_TIMEZONE);
  const tasksSnap = await db.collection('tasks').where('ownerUid', '==', userId).get();
  const storiesSnap = await db.collection('stories').where('ownerUid', '==', userId).get();
  const remindersSnap = await db.collection('reminders').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] }));

  const tasks = toList(tasksSnap).map((task) => ({
    ...task,
    dueDateMs: toMillis(task.dueDate || task.dueDateMs || task.targetDate),
    scheduledStartMs: toMillis(task.scheduledStart || task.startDate),
    scheduledEndMs: toMillis(task.scheduledEnd || task.endDate),
  }));

  const stories = toList(storiesSnap).map((story) => ({
    ...story,
    sprintDueMs: toMillis(story.sprintDueDate || story.targetDate),
    plannedStartMs: toMillis(story.plannedStartDate),
  }));

  const dependencies = new Map();

  const collectDeps = (item, type) => {
    const list = [];
    const direct = item.dependencies || item.dependencyIds || item.blockedBy || item.blocks || [];
    if (Array.isArray(direct)) {
      direct.filter(Boolean).forEach((id) => list.push({ dependsOn: id, via: 'list' }));
    }
    if (item.dependencyMap && typeof item.dependencyMap === 'object') {
      Object.entries(item.dependencyMap).forEach(([id, reason]) => {
        list.push({ dependsOn: id, via: reason || 'map' });
      });
    }
    if (list.length) dependencies.set(`${type}:${item.id}`, list);
  };

  tasks.forEach((task) => collectDeps(task, 'task'));
  stories.forEach((story) => collectDeps(story, 'story'));

  const reminders = toList(remindersSnap).map((reminder) => ({
    ...reminder,
    dueDateMs: toMillis(reminder.dueDate || reminder.dueAt),
  }));

  return {
    timezone: zone,
    tasks,
    stories,
    reminders,
    dependencies,
  };
};

module.exports = {
  ensureFirestore,
  loadProfile,
  resolveTimezone,
  buildActivityIndex,
  buildFinanceSummary,
  buildDailySummaryData,
  buildDataQualitySnapshot,
  loadSchedulerInputs,
};
