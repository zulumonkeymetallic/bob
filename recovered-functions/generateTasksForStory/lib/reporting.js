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

const TASK_DONE_STATUSES = new Set(['done', 'completed', 'complete', 'archived', 2, 3]);
const STORY_DONE_STATUSES = new Set(['done', 'complete', 'archived', 3]);

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
  const activitySnap = await db
    .collection('activity_stream')
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()
    .catch(async (error) => {
      console.warn('[reporting] activity_stream query failed, falling back to ownerUid filter', error?.message || error);
      return db
        .collection('activity_stream')
        .where('ownerUid', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
    });

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
  if (status == null) return 'open';
  if (typeof status === 'string') return status.toLowerCase();
  if (typeof status === 'number') {
    if (status === 2 || status === 3) return 'done';
    if (status === 1) return 'in_progress';
    return 'open';
  }
  return 'open';
};

const ensureTaskReference = (task) => {
  const ref = task.ref || task.reference || task.displayId || null;
  if (ref) return ref;
  return `TASK-${String(task.id || '').slice(-6).padStart(6, '0').toUpperCase()}`;
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
  const base =
    type === 'task' ? '/task/' :
    type === 'story' ? '/story/' :
    type === 'goal' ? '/goal/' :
    type === 'chore' ? '/chore/' :
    type === 'routine' ? '/routine/' :
    '/';
  return `${base}${refOrId}`;
};

const buildDailySummaryData = async (db, userId, { day, timezone, locale = 'en-GB' }) => {
  const zone = coerceZone(timezone || DEFAULT_TIMEZONE);
  const { start, end } = computeDayWindow({ day, timezone: zone });
  const startMs = start.toMillis();
  const endMs = end.toMillis();

  const [
    tasksSnap,
    storiesSnap,
    calendarSnap,
    remindersSnap,
    schedulerSnap,
    choresSnap,
    routinesSnap,
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
  ]);

  const tasks = toList(tasksSnap).filter((task) => {
    if (TASK_DONE_STATUSES.has(task.status)) return false;
    const dueMs = toMillis(task.dueDate || task.dueDateMs || task.targetDate);
    if (!dueMs) return false;
    return dueMs >= startMs && dueMs <= endMs;
  });

  const stories = toList(storiesSnap).filter((story) => {
    if (STORY_DONE_STATUSES.has(story.status)) return false;
    if (story.sprintDueDate || story.targetDate) {
      const dueMs = toMillis(story.sprintDueDate || story.targetDate);
      return dueMs && dueMs <= end.plus({ days: 7 }).toMillis();
    }
    return true;
  });

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

  const { goalsById, storiesById } = await collectGoalsAndStories(db, tasks, stories);
  const taskSummaries = tasks.map((task) => {
    const goal = task.goalId ? goalsById.get(task.goalId) : null;
    const story = task.storyId ? storiesById.get(task.storyId) : null;
    const dueDt = toDateTime(task.dueDate || task.dueDateMs || task.targetDate, { zone });
    return {
      id: task.id,
      ref: ensureTaskReference(task),
      title: task.title || task.description || 'Task',
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
      const goal = story.goalId ? goalsById.get(story.goalId) : null;
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

  const calendarBlocks = toList(calendarSnap)
    .map((block) => {
      const startDt = toDateTime(block.start || block.startAt, { zone });
      const endDt = toDateTime(block.end || block.endAt, { zone });
      const story = block.storyId ? storiesById.get(block.storyId) : null;
      const task = block.taskId ? tasks.find((t) => t.id === block.taskId) : null;
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
        allocatedMinutes: startDt && endDt ? Math.round(endDt.diff(startDt, 'minutes').minutes) : null,
      };
    })
    .filter((block) => {
      if (!block.startIso || !block.endIso) return false;
      const blockStartMs = toDateTime(block.startIso, { zone }).toMillis();
      return blockStartMs >= start.minus({ minutes: 1 }).toMillis() && blockStartMs <= end.plus({ hours: 16 }).toMillis();
    })
    .sort((a, b) => (a.startIso || '').localeCompare(b.startIso || ''));

  const reminders = toList(remindersSnap)
    .filter((reminder) => (reminder.status || 'open') !== 'done')
    .map((reminder) => ({
      id: reminder.id,
      title: reminder.title || reminder.note || 'Reminder',
      dueDate: reminder.dueDate || reminder.dueAt || null,
      relatedTaskId: reminder.taskId || null,
    }));

  const priorityCandidates = [];

  for (const task of tasks) {
    const dueMs = toMillis(task.dueDate || task.dueDateMs || task.targetDate) || end.toMillis();
    const importance = Number(task.importanceScore || task.priority || 0);
    const urgency = Math.max(0, 1_000_000 - Math.max(0, dueMs - start.toMillis()));
    const score = importance * 1000 + urgency;
    priorityCandidates.push({
      type: 'task',
      id: task.id,
      ref: ensureTaskReference(task),
      title: task.title || 'Task',
      goalId: task.goalId || null,
      storyId: task.storyId || null,
      score,
      deepLink: makeDeepLink('task', ensureTaskReference(task)),
      dueDateDisplay: formatDateTime(toDateTime(task.dueDate || task.targetDate, { zone }), { locale }),
    });
  }

  for (const story of stories) {
    const dueMs = toMillis(story.sprintDueDate || story.targetDate || story.plannedStartDate) || end.plus({ days: 3 }).toMillis();
    const importance = Number(story.importanceScore || story.priority || story.points || 0);
    const urgency = Math.max(0, 1_000_000 - Math.max(0, dueMs - start.toMillis()));
    const score = importance * 1200 + urgency;
    priorityCandidates.push({
      type: 'story',
      id: story.id,
      ref: ensureStoryReference(story),
      title: story.title || 'Story',
      goalId: story.goalId || null,
      score,
      deepLink: makeDeepLink('story', ensureStoryReference(story)),
      dueDateDisplay: formatDateTime(toDateTime(story.sprintDueDate || story.targetDate, { zone }), { locale }),
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

  const manualRerunCallable = 'sendDailySummaryNow';

  const schedulerChanges = schedulerSnap.docs[0]?.data()?.changes || [];

  return {
    metadata: {
      dayIso: isoDate(start),
      timezone: zone,
      locale,
      start: start.toISO(),
      end: end.toISO(),
      generatedAt: new Date().toISOString(),
      manualCallable: manualRerunCallable,
    },
    hierarchy,
    tasksDue: taskSummaries,
    storiesToStart,
    calendarBlocks,
    reminders,
    choresDue: dueChores,
    routinesDue: dueRoutines,
    priorities,
    worldSummary: worldSummary ? { summary: worldSummary, weather: worldWeather, source: worldSource } : null,
    fitness,
    monzo,
    profile,
    schedulerChanges,
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
    }));

  const missingGoalLink = stories
    .filter((story) => !story.goalId)
    .map((story) => ({
      id: story.id,
      ref: ensureStoryReference(story),
      title: story.title || 'Story',
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
  buildDailySummaryData,
  buildDataQualitySnapshot,
  loadSchedulerInputs,
};
