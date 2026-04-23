const { startOfDayMs, toMillis } = require('./capacityService');
const { schedulePlannerItemMutation } = require('./schedulingService');

const DAY_MS = 24 * 60 * 60 * 1000;

const RECURRING_TYPES = new Set(['chore', 'routine', 'habit']);

function getManualPriorityRank(entity) {
  const explicit = Number(entity?.userPriorityRank);
  if (explicit === 1 || explicit === 2 || explicit === 3) return explicit;
  return entity?.userPriorityFlag === true ? 1 : null;
}

function isToday(dateIso, todayIso) {
  return String(dateIso || '').slice(0, 10) === todayIso;
}

function isAiTop3Today(entity, todayIso) {
  return entity?.aiTop3ForDay === true && (!entity?.aiTop3Date || isToday(entity.aiTop3Date, todayIso));
}

function isRecurring(entity) {
  const freq = String(entity?.repeatFrequency || entity?.recurrence?.frequency || entity?.recurrence?.freq || '').toLowerCase();
  return freq.length > 0;
}

function inferEffortHours(entity, entityType) {
  if (entityType === 'task') {
    const direct = Number(entity?.points);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const mins = Number(entity?.estimateMin);
    if (Number.isFinite(mins) && mins > 0) return Math.max(0.25, mins / 60);
    return 1;
  }
  const direct = Number(entity?.points);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 2;
}

function resolveProtectedBy(entity, parentStory, todayIso, focusGoalIds) {
  if (isAiTop3Today(entity, todayIso)) return 'aiTop3';
  const manualRank = getManualPriorityRank(entity);
  if (manualRank) return 'manual';
  const goalId = String(entity?.goalId || '').trim();
  if (goalId && focusGoalIds.has(goalId)) return 'focus';

  if (parentStory) {
    if (isAiTop3Today(parentStory, todayIso)) return 'aiTop3';
    if (getManualPriorityRank(parentStory)) return 'manual';
    const parentGoalId = String(parentStory?.goalId || '').trim();
    if (parentGoalId && focusGoalIds.has(parentGoalId)) return 'focus';
  }

  return null;
}

function buildReasonCodes(entity, entityType, parentStory, todayIso) {
  const codes = [];
  const rank = getManualPriorityRank(entity);
  if (!rank && !isAiTop3Today(entity, todayIso)) codes.push('not_priority');
  if (entityType === 'story') {
    const pts = Number(entity?.points || 0);
    if (pts >= 3) codes.push('large_effort');
  }
  if (entityType === 'task') {
    const hrs = inferEffortHours(entity, 'task');
    if (hrs >= 2) codes.push('large_effort');
    const hasGoalLink = Boolean(entity?.goalId || (parentStory && parentStory.goalId));
    if (!hasGoalLink) codes.push('no_goal_link');
  }
  if (!codes.length) codes.push('low_relative_priority');
  return codes;
}

function buildReasonSummary(reasonCodes, entityType) {
  const parts = [];
  if (reasonCodes.includes('not_priority')) parts.push('not in top priorities or focus goals');
  if (reasonCodes.includes('large_effort')) parts.push(`high effort for current sprint`);
  if (reasonCodes.includes('no_goal_link')) parts.push('no linked goal');
  if (reasonCodes.includes('low_relative_priority')) parts.push('lower relative priority');
  return parts.length ? parts.join('; ') : 'lower priority than available focus work';
}

async function getPreviewSlot(db, userId, entity, entityType, todayMs) {
  const targetDateMs = todayMs + DAY_MS;
  try {
    const result = await schedulePlannerItemMutation({
      db,
      userId,
      itemType: entityType,
      itemId: entity._id || entity.id,
      targetDateMs,
      previewOnly: true,
      source: 'deferral_candidate_service',
    });
    if (result?.ok) {
      return {
        exactTargetStartMs: result.appliedStartMs || null,
        exactTargetEndMs: result.appliedEndMs || null,
        targetBucket: result.appliedBucket || null,
        targetDateMs: result.appliedDayMs || targetDateMs,
      };
    }
  } catch (_err) {
    // preview failures are non-fatal
  }
  return {
    exactTargetStartMs: null,
    exactTargetEndMs: null,
    targetBucket: null,
    targetDateMs,
  };
}

async function buildDeferralCandidates(db, userId, { sprintId, focusGoalIds = new Set(), nextSprintId = null } = {}) {
  if (!db || !userId || !sprintId) return [];

  const nowMs = Date.now();
  const todayMs = startOfDayMs(nowMs);
  const todayIso = new Date(todayMs).toISOString().slice(0, 10);

  const [storiesSnap, tasksSnap] = await Promise.all([
    db.collection('stories').where('ownerUid', '==', userId).where('sprintId', '==', sprintId).get().catch(() => ({ docs: [] })),
    db.collection('tasks').where('ownerUid', '==', userId).where('sprintId', '==', sprintId).get().catch(() => ({ docs: [] })),
  ]);

  const storiesById = new Map();
  const storyRows = (storiesSnap.docs || []).map((d) => {
    const data = { _id: d.id, ...d.data() };
    storiesById.set(d.id, data);
    return data;
  });

  const taskRows = (tasksSnap.docs || []).map((d) => ({ _id: d.id, ...d.data() }));

  const candidates = [];

  for (const story of storyRows) {
    const status = String(story.status || '').toLowerCase();
    if (status === 'done' || status === 'completed' || status === 'closed') continue;

    const protectedBy = resolveProtectedBy(story, null, todayIso, focusGoalIds);
    if (protectedBy) continue;

    const goalId = String(story.goalId || '').trim();
    candidates.push({
      id: story._id,
      type: 'story',
      title: String(story.title || 'Untitled story'),
      reasonCodes: buildReasonCodes(story, 'story', null, todayIso),
      reasonSummary: buildReasonSummary(buildReasonCodes(story, 'story', null, todayIso), 'story'),
      protectedBy: null,
      recommendedAction: nextSprintId ? 'next_sprint' : 'next_sprint_pending',
      targetDateMs: null,
      targetSprintId: nextSprintId || null,
      exactTargetStartMs: null,
      exactTargetEndMs: null,
      targetBucket: null,
      focusAligned: goalId ? focusGoalIds.has(goalId) : false,
      manualPriorityRank: getManualPriorityRank(story),
      aiTop3: isAiTop3Today(story, todayIso),
      effortHours: inferEffortHours(story, 'story'),
    });
  }

  const taskPreviewPromises = [];

  for (const task of taskRows) {
    const status = String(task.status || '').toLowerCase();
    if (status === 'done' || status === 'completed' || status === 'closed') continue;

    const taskType = String(task.type || '').toLowerCase();
    if (RECURRING_TYPES.has(taskType) && isRecurring(task)) continue;

    const parentStory = task.storyId ? storiesById.get(task.storyId) || null : null;
    const protectedBy = resolveProtectedBy(task, parentStory, todayIso, focusGoalIds);
    if (protectedBy) continue;

    const goalId = String(task.goalId || parentStory?.goalId || '').trim();
    const candidateBase = {
      id: task._id,
      type: 'task',
      title: String(task.title || 'Untitled task'),
      reasonCodes: buildReasonCodes(task, 'task', parentStory, todayIso),
      reasonSummary: buildReasonSummary(buildReasonCodes(task, 'task', parentStory, todayIso), 'task'),
      protectedBy: null,
      recommendedAction: 'next_free_day',
      targetDateMs: todayMs + DAY_MS,
      targetSprintId: null,
      exactTargetStartMs: null,
      exactTargetEndMs: null,
      targetBucket: null,
      focusAligned: goalId ? focusGoalIds.has(goalId) : false,
      manualPriorityRank: getManualPriorityRank(task),
      aiTop3: isAiTop3Today(task, todayIso),
      effortHours: inferEffortHours(task, 'task'),
    };

    taskPreviewPromises.push(
      getPreviewSlot(db, userId, task, 'task', todayMs).then((slot) => ({
        ...candidateBase,
        ...slot,
      }))
    );
  }

  const taskCandidates = await Promise.all(taskPreviewPromises);
  candidates.push(...taskCandidates);

  return candidates;
}

module.exports = { buildDeferralCandidates };
