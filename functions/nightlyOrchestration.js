const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const https = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { DateTime, Interval } = require('luxon');

const { ensureFirestore, resolveTimezone } = require('./lib/reporting');
const { clampTaskPoints } = require('./utils/taskPoints');
const { buildAbsoluteUrl, buildEntityUrl } = require('./utils/urlHelpers');
const { coerceZone, toDateTime, toMillis } = require('./lib/time');
const {
  cloneThemeAllocations,
  getAllocationWeekKey,
  normalizeThemeAllocationPlan,
  resolveThemeAllocationsForDate,
} = require('./lib/themeAllocations');
const {
  writeScheduledInstances,
  writeLegacyCalendarBlocks,
  writeConsolidatedCalendarBlocks,
  calculateBlockCapacity,
  getDayCapacityWarnings,
  updatePlannerStats,
  groupTasksByStory,
  writeScheduledTimesToSources,
} = require('./scheduler/syncToFirestore');

// Secrets
const GOOGLE_AI_STUDIO_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');
const BOB_CLI_ACCESS = defineSecret('BOB_CLI_ACCESS');

const THEME_RULES = [
  { match: ['growth'], slots: [{ days: [1, 2, 3, 4, 5], start: 7, end: 9, label: 'Growth AM' }, { days: [1, 2, 3, 4, 5], start: 17, end: 19, label: 'Growth PM' }] },
  { match: ['finance', 'wealth'], slots: [{ days: [1, 2, 3, 4, 5], start: 18, end: 21, label: 'Wealth weekday evening' }, { days: [6, 7], start: 9, end: 12, label: 'Wealth weekend AM' }, { days: [6, 7], start: 13, end: 17, label: 'Wealth weekend PM' }] },
  { match: ['side gig', 'side-gig', 'sidegig'], slots: [{ days: [1, 2, 3, 4, 5], start: 18, end: 22, label: 'Side gig evenings' }, { days: [6, 7], start: 10, end: 16, label: 'Side gig weekend' }] },
  { match: ['hobby', 'hobbies'], slots: [{ days: [1, 2, 3, 4, 5, 6, 7], start: 18, end: 22, label: 'Hobbies evenings' }] },
  { match: ['game', 'gaming', 'tv'], slots: [{ days: [5, 6], start: 19, end: 23, label: 'Gaming/TV Fri/Sat evening' }] },
  { match: ['health'], slots: [{ days: [1, 2, 3, 4, 5], start: 6, end: 20, label: 'Health focus' }] },
  { match: ['learning', 'spiritual'], slots: [{ days: [1, 2, 3, 4, 5], start: 6, end: 20, label: 'Growth/Learning' }] },
];

const toDayKey = (dt) => dt.toISODate();
const toMinutes = (hhmm) => {
  const [h = '0', m = '0'] = String(hhmm || '0:0').split(':');
  return Number(h) * 60 + Number(m);
};

const isMainGigLabel = (value) => {
  const raw = String(value || '').toLowerCase();
  if (!raw) return false;
  if (raw.includes('workout')) return false;
  if (raw.includes('main gig') || raw.includes('work shift')) return true;
  return /\bwork\b/.test(raw);
};

const isMainGigBlock = (block) => {
  if (!block) return false;
  if (block.entityType === 'work_shift' || block.sourceType === 'work_shift_allocation') return true;
  const label = block.theme || block.category || block.title || '';
  return isMainGigLabel(label);
};

const buildPickSlots = (themeAllocationPlan) => {
  const getUserSlots = (themeLabel, day) => {
    const dayAllocations = resolveThemeAllocationsForDate(themeAllocationPlan, day, day.zoneName);
    const matches = dayAllocations.filter((a) => {
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
    for (const rule of THEME_RULES) {
      if (rule.match.some((m) => key.includes(m))) return rule.slots;
    }
    return [{ days: [1, 2, 3, 4, 5, 6, 7], start: 6, end: 22, label: 'Default window' }];
  };

  return { getUserSlots, pickSlots };
};

/**
 * Narrow a set of slots to those matching a time-of-day preference.
 * Falls back to all slots if none match (so nothing gets permanently unscheduled).
 * @param {Array} slots - from pickSlots()
 * @param {string|null} timeOfDay - 'morning' | 'afternoon' | 'evening' | null
 * @returns {Array}
 */
function filterSlotsByTimeOfDay(slots, timeOfDay) {
  if (!timeOfDay) return slots;
  const filtered = slots.filter((slot) => {
    const h = Number(slot.start);
    if (timeOfDay === 'morning') return h >= 5 && h < 13;
    if (timeOfDay === 'afternoon') return h >= 13 && h < 19;
    if (timeOfDay === 'evening') return h >= 19 || h < 5;
    return true;
  });
  return filtered.length ? filtered : slots; // fallback: never starve the scheduler
}

const seedPlannerWeekForUser = async ({
  db,
  userId,
  targetWeekKey = null,
  force = false,
}) => {
  const profileSnap = await db.collection('profiles').doc(userId).get().catch(() => null);
  const profile = profileSnap && profileSnap.exists ? (profileSnap.data() || {}) : {};
  const zone = coerceZone(resolveTimezone(profile, 'Europe/London'));
  const planRef = db.collection('theme_allocations').doc(userId);
  const planSnap = await planRef.get().catch(() => null);

  if (!planSnap || !planSnap.exists) {
    return { status: 'skipped', reason: 'missing_plan', userId };
  }

  const plan = normalizeThemeAllocationPlan(planSnap.data() || {});
  if (!plan.allocations.length && !Object.keys(plan.weeklyOverrides || {}).length) {
    return { status: 'skipped', reason: 'no_allocations', userId };
  }

  const targetStart = targetWeekKey
    ? DateTime.fromISO(String(targetWeekKey), { zone }).startOf('day')
    : DateTime.now().setZone(zone).startOf('week').plus({ weeks: 1 });

  if (!targetStart.isValid) {
    return {
      status: 'skipped',
      reason: 'invalid_target_week',
      userId,
      weekKey: String(targetWeekKey || ''),
    };
  }

  const weekKey = getAllocationWeekKey(targetStart, zone);
  const existingOverride = Array.isArray(plan.weeklyOverrides?.[weekKey]) ? plan.weeklyOverrides[weekKey] : [];
  if (existingOverride.length && !force) {
    return { status: 'skipped', reason: 'already_seeded', userId, weekKey };
  }

  const previousWeekKey = getAllocationWeekKey(targetStart.minus({ weeks: 1 }), zone);
  const previousWeekAllocations = Array.isArray(plan.weeklyOverrides?.[previousWeekKey]) ? plan.weeklyOverrides[previousWeekKey] : [];
  const sourceAllocations = previousWeekAllocations.length
    ? cloneThemeAllocations(previousWeekAllocations)
    : cloneThemeAllocations(plan.allocations);

  if (!sourceAllocations.length) {
    return { status: 'skipped', reason: 'no_source_allocations', userId, weekKey };
  }

  const nextOverrides = {
    ...(plan.weeklyOverrides || {}),
    [weekKey]: sourceAllocations,
  };

  await planRef.set({
    weeklyOverrides: nextOverrides,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return {
    status: 'seeded',
    userId,
    weekKey,
    slots: sourceAllocations.length,
    source: previousWeekAllocations.length ? `override:${previousWeekKey}` : 'template',
  };
};

const seedPlannerWeekForAllUsers = async ({
  targetWeekKey = null,
  force = false,
} = {}) => {
  const db = ensureFirestore();
  const allocationsSnap = await db.collection('theme_allocations').get().catch(() => ({ docs: [] }));
  const results = [];

  for (const docSnap of allocationsSnap.docs) {
    const userId = docSnap.id;
    try {
      const result = await seedPlannerWeekForUser({ db, userId, targetWeekKey, force });
      results.push(result);
    } catch (error) {
      results.push({
        status: 'error',
        userId,
        weekKey: String(targetWeekKey || ''),
        error: error?.message || String(error),
      });
    }
  }

  const summary = results.reduce((acc, result) => {
    acc.total += 1;
    if (result.status === 'seeded') acc.seeded += 1;
    else if (result.status === 'error') acc.errors += 1;
    else acc.skipped += 1;
    return acc;
  }, { total: 0, seeded: 0, skipped: 0, errors: 0 });

  return { ok: true, ...summary, results };
};

const hasOverlap = (candidate, existing) => {
  const cand = Interval.fromDateTimes(candidate.start, candidate.end);
  return existing.some((block) => {
    const s = toDateTime(block.start, { defaultValue: null });
    const e = toDateTime(block.end, { defaultValue: null });
    if (!s || !e) return false;
    return cand.overlaps(Interval.fromDateTimes(s, e));
  });
};

function normalizeCalendarMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCalendarTitleMatch(title, entity) {
  const eventTitle = normalizeCalendarMatchText(title);
  const entityTitle = normalizeCalendarMatchText(entity?.title || entity?.name || '');
  if (!eventTitle || !entityTitle) return 0;

  const eventRef = normalizeCalendarMatchText(entity?.ref || '');
  let score = 0;

  if (eventRef && eventTitle.includes(eventRef)) score += 1.3;
  if (eventTitle === entityTitle) score += 1.2;
  if (eventTitle.includes(entityTitle) || entityTitle.includes(eventTitle)) score += 0.65;

  const eventWords = eventTitle.split(' ').filter((w) => w.length > 2);
  const entityWords = entityTitle.split(' ').filter((w) => w.length > 2);
  if (eventWords.length && entityWords.length) {
    const overlap = eventWords.filter((w) => entityWords.includes(w)).length;
    score += (overlap / Math.max(eventWords.length, entityWords.length)) * 0.7;
  }

  return score;
}

function toCalendarMatchConfidence(score) {
  const normalized = Math.max(0, Math.min(100, Math.round((Number(score || 0) / 2) * 100)));
  const tier = normalized >= 75 ? 'high' : normalized >= 50 ? 'medium' : 'low';
  return { normalized, tier };
}

async function matchExternalCalendarEventsToEntities({
  db,
  userId,
  blocks,
  openStories,
  openTasks,
}) {
  const result = { matchedStories: 0, matchedTasks: 0 };
  if (!Array.isArray(blocks) || !blocks.length) return result;

  const candidates = [
    ...openStories.map((story) => ({ type: 'story', ...story })),
    ...openTasks.map((task) => ({ type: 'task', ...task })),
  ];
  if (!candidates.length) return result;

  const nowMs = Date.now();
  const horizonMs = nowMs + (45 * 24 * 60 * 60 * 1000);
  const unmatchedExternalBlocks = blocks.filter((block) => {
    const start = Number(block?.start || 0);
    const source = String(block?.source || '').toLowerCase();
    const hasLink = !!(block?.storyId || block?.taskId);
    return source === 'gcal' && !hasLink && start >= nowMs && start <= horizonMs;
  });

  if (!unmatchedExternalBlocks.length) return result;

  for (const block of unmatchedExternalBlocks) {
    const title = String(block?.title || '').trim();
    if (!title) continue;

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: scoreCalendarTitleMatch(title, candidate),
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.72) continue;

    const matched = best.candidate;
    const confidence = toCalendarMatchConfidence(best.score);
    const goalId = matched.goalId || null;
    const blockPatch = {
      storyId: matched.type === 'story' ? matched.id : null,
      taskId: matched.type === 'task' ? matched.id : null,
      goalId,
      sprintId: matched.sprintId || null,
      persona: matched.persona || null,
      entityType: matched.type,
      calendarMatchSource: 'matched_user_created_calendar_event',
      calendarMatchNote: 'Matched user created calendar event',
      calendarMatchScore: Number(best.score.toFixed(3)),
      calendarMatchConfidence: confidence.normalized,
      calendarMatchConfidenceTier: confidence.tier,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('calendar_blocks').doc(block.id).set(blockPatch, { merge: true });

    if (matched.type === 'story') {
      result.matchedStories += 1;
      await db.collection('stories').doc(matched.id).set({
        calendarMatchSource: 'matched_user_created_calendar_event',
        calendarMatchNote: 'Matched user created calendar event',
        calendarMatchConfidence: confidence.normalized,
        calendarMatchConfidenceTier: confidence.tier,
        calendarMatchedStart: block.start || null,
        calendarMatchedEnd: block.end || null,
        plannedStartDate: block.start || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      result.matchedTasks += 1;
      await db.collection('tasks').doc(matched.id).set({
        calendarMatchSource: 'matched_user_created_calendar_event',
        calendarMatchNote: 'Matched user created calendar event',
        calendarMatchConfidence: confidence.normalized,
        calendarMatchConfidenceTier: confidence.tier,
        calendarMatchedStart: block.start || null,
        calendarMatchedEnd: block.end || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await db.collection('activity_stream').add(activityPayload({
      ownerUid: userId,
      entityId: matched.id,
      entityType: matched.type,
      activityType: 'calendar_event_matched',
      description: `Matched user created calendar event "${title}"`,
      metadata: {
        blockId: block.id,
        source: 'matched_user_created_calendar_event',
        score: Number(best.score.toFixed(3)),
        confidence: confidence.normalized,
        confidenceTier: confidence.tier,
      },
    }));

    const inMemory = blocks.find((entry) => entry.id === block.id);
    if (inMemory) {
      inMemory.storyId = matched.type === 'story' ? matched.id : null;
      inMemory.taskId = matched.type === 'task' ? matched.id : null;
      inMemory.goalId = goalId;
      inMemory.sprintId = matched.sprintId || null;
      inMemory.persona = matched.persona || null;
      inMemory.entityType = matched.type;
      inMemory.calendarMatchSource = 'matched_user_created_calendar_event';
      inMemory.calendarMatchNote = 'Matched user created calendar event';
      inMemory.calendarMatchScore = Number(best.score.toFixed(3));
      inMemory.calendarMatchConfidence = confidence.normalized;
      inMemory.calendarMatchConfidenceTier = confidence.tier;
    }
  }

  return result;
}

// ===== Helpers
const PRIORITY_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

async function callLLMJsonSafe({ system, user, purpose, userId, model }) {
  const { callLLM } = require('./utils/llmHelper');
  try {
    const raw = await callLLM(system, user, model);
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[llm-json] failed', { purpose, userId, error: error?.message || error });
    return null;
  }
}

function computeCriticalityScore({ dueDateMs, createdAtMs, goalDueMs, theme, points, taskType }) {
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

  // NEW: Cap chores/habits/routines at 30 to prevent them from appearing in Top 3
  const isExcludedType = ['chore', 'habit', 'routine'].includes(taskType);
  if (isExcludedType) {
    score = Math.min(30, score);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

const LLM_PRIORITY_MAX_ITEMS = 40;
const LLM_PRIORITY_MAX_TEXT = 500;
const LLM_PRIORITY_MAX_CRITERIA = 6;

const clampTextScore = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(20, Math.round(num)));
};

const trimText = (value, maxLen) => {
  if (!value) return '';
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  if (!maxLen || cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen);
};

const normalizeAcceptanceCriteria = (entity) => {
  if (!entity) return [];
  const raw = entity.acceptanceCriteria
    ?? entity.acceptance_criteria
    ?? entity.criteria
    ?? entity.acceptance
    ?? null;
  if (Array.isArray(raw)) {
    return raw.filter(Boolean).map((c) => trimText(c, 140)).slice(0, LLM_PRIORITY_MAX_CRITERIA);
  }
  if (raw && typeof raw === 'object') {
    return Object.values(raw)
      .filter(Boolean)
      .map((c) => trimText(c, 140))
      .slice(0, LLM_PRIORITY_MAX_CRITERIA);
  }
  if (typeof raw === 'string') {
    return raw
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, ''))
      .map((line) => trimText(line, 140))
      .filter(Boolean)
      .slice(0, LLM_PRIORITY_MAX_CRITERIA);
  }
  return [];
};

const buildSizingPrompt = (entity, fallbackLabel = 'Work Item') => {
  const title = trimText(entity?.title || entity?.ref || fallbackLabel, 200);
  const description = trimText(entity?.description || entity?.notes || '', 1000);
  const criteria = normalizeAcceptanceCriteria(entity).slice(0, 8);
  const lines = [`Title: ${title}`];
  if (description) lines.push(`Description: ${description}`);
  if (criteria.length) {
    lines.push('Acceptance Criteria:');
    criteria.forEach((criterion, index) => {
      lines.push(`${index + 1}. ${criterion}`);
    });
  }
  return lines.join('\n');
};

async function scorePriorityWithLLM({ userId, items }) {
  const model = PRIORITY_TEXT_MODEL;
  if (!items || !items.length) return { scores: new Map(), model };
  const payload = items
    .slice(0, LLM_PRIORITY_MAX_ITEMS)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      ref: item.ref || null,
      title: trimText(item.title, 120),
      description: trimText(item.description, LLM_PRIORITY_MAX_TEXT),
      acceptanceCriteria: item.acceptanceCriteria || [],
      theme: item.theme || null,
      goal: trimText(item.goalTitle, 120) || null,
      persona: item.persona || null,
      dueInDays: Number.isFinite(Number(item.dueInDays)) ? Number(item.dueInDays) : null,
      userPriority: item.userPriority || null,
    }));

  const system = [
    'You are a prioritization analyst for a productivity app.',
    'Score importance based on title/description/acceptance criteria and the provided dueInDays + userPriority.',
    'Prefer family/health/safety/finance/compliance over hobbies/low-stakes items.',
    'If items are tied, use the text to break ties (be decisive).',
    'Return JSON {"items":[{"id":string,"score":number,"reason":string}]} where score is 0-20.',
    'Keep reason under 120 characters, and use only the provided ids.',
  ].join(' ');
  const user = `Items:\n${JSON.stringify(payload)}`;

  const parsed = await callLLMJsonSafe({
    system,
    user,
    purpose: 'priority_text_score',
    userId,
    model,
  });
  const map = new Map();
  if (!parsed || !Array.isArray(parsed.items)) return { scores: map, model };
  parsed.items.forEach((item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    map.set(id, {
      score: clampTextScore(item.score),
      reason: trimText(item.reason, 120),
    });
  });
  return { scores: map, model };
}

function normalizeUserPriority(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (value === 4) return 'critical';
    if (value === 3) return 'high';
    if (value === 2) return 'medium';
    if (value === 1) return 'low';
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('crit') || normalized === 'p0') return 'critical';
  if (normalized === 'p1' || normalized.includes('high')) return 'high';
  if (normalized === 'p2' || normalized.includes('med')) return 'medium';
  if (normalized === 'p3' || normalized.includes('low')) return 'low';
  return null;
}

function priorityBoostFor(level) {
  switch (level) {
    case 'critical':
      return { boost: 500, label: 'Critical' };
    case 'high':
      return { boost: 12, label: 'High' };
    case 'medium':
      return { boost: 6, label: 'Medium' };
    case 'low':
      return { boost: 0, label: 'Low' };
    default:
      return { boost: 0, label: null };
  }
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

const normalizeStatusValue = (value) => String(value ?? '').trim().toLowerCase();
const parseStatusNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const isTaskDoneStatus = (status) => {
  const num = parseStatusNumber(status);
  if (num != null) return num === 2 || num >= 4;
  const normalized = normalizeStatusValue(status);
  return ['done', 'complete', 'completed', 'finished', 'closed'].includes(normalized);
};

const isStoryDoneStatus = (status) => {
  const num = parseStatusNumber(status);
  if (num != null) return num >= 4;
  const normalized = normalizeStatusValue(status);
  return ['done', 'complete', 'completed', 'finished', 'closed'].includes(normalized);
};

const isTaskOpenStatus = (status) => {
  if (status === null || status === undefined || status === '') return true;
  const num = parseStatusNumber(status);
  if (num != null) return num === 0 || num === 1;
  const normalized = normalizeStatusValue(status);
  return ['backlog', 'todo', 'to do', 'in-progress', 'in progress', 'open', 'active', 'pending', 'planned', '0', '1'].includes(normalized);
};

const isStoryOpenStatus = (status) => {
  if (status === null || status === undefined || status === '') return true;
  const num = parseStatusNumber(status);
  if (num != null) return num >= 0 && num < 4;
  const normalized = normalizeStatusValue(status);
  return ['backlog', 'planned', 'in-progress', 'in progress', 'open', 'active', 'pending', '0', '1', '2', '3'].includes(normalized);
};

function clampStoryStatus(status) {
  return isStoryDoneStatus(status) ? 4 : 0;
}

function hasRecurrence(entity) {
  if (!entity) return false;
  if (entity.recurrence) return true;
  if (entity.repeatFrequency || entity.repeatInterval) return true;
  if (Array.isArray(entity.daysOfWeek) && entity.daysOfWeek.length) return true;
  return false;
}

function isRoutineChoreHabit(entity) {
  const type = String(entity?.type || entity?.category || '').toLowerCase();
  if (['routine', 'chore', 'habit', 'habitual'].some((k) => type.includes(k))) return true;
  const tags = Array.isArray(entity?.tags) ? entity.tags.map((t) => String(t || '').toLowerCase().replace(/^#/, '')) : [];
  if (tags.some((t) => ['routine', 'chore', 'habit', 'habitual'].includes(t))) return true;
  const listName = String(entity?.reminderListName || '').toLowerCase();
  if (['routine', 'chore', 'habit'].some((k) => listName.includes(k))) return true;
  return false;
}

// Helper: check if a millis due date is today or past
function isTodayOrOverdue(dueDate) {
  if (!dueDate) return false;
  const now = Date.now();
  const start = DateTime.now().startOf('day').toMillis();
  const end = DateTime.now().endOf('day').toMillis();
  return dueDate <= end && dueDate >= start ? true : dueDate < start;
}

// Map theme identifiers (numeric or string) to a readable label for calendar blocks
const THEME_LABELS = {
  0: 'General',
  1: 'Health & Fitness',
  2: 'Career & Professional',
  3: 'Finance & Wealth',
  4: 'Learning & Education',
  5: 'Family & Relationships',
  6: 'Hobbies & Interests',
  7: 'Travel & Adventure',
  8: 'Home & Living',
  9: 'Spiritual & Personal Growth',
  10: 'Chores',
  11: 'Rest & Recovery',
  12: 'Work (Main Gig)',
  13: 'Sleep',
  14: 'Random',
  15: 'Side Gig',
};
function resolveThemeLabel(theme) {
  if (theme == null) return null;
  if (typeof theme === 'number' && THEME_LABELS[theme]) return THEME_LABELS[theme];
  const t = String(theme).trim();
  // Try to match common labels
  const lower = t.toLowerCase();
  if (lower.includes('work')) return 'Work (Main Gig)';
  if (lower.includes('sleep')) return 'Sleep';
  if (lower.includes('random')) return 'Random';
  if (lower.includes('wealth') || lower.includes('finance')) return 'Finance & Wealth';
  if (lower.includes('career') || lower.includes('professional')) return 'Career & Professional';
  if (lower.includes('growth')) return 'Spiritual & Personal Growth';
  if (lower.includes('hobby')) return 'Hobbies & Interests';
  if (lower.includes('side gig') || lower.includes('side-gig') || lower.includes('sidegig')) return 'Side Gig';
  if (lower.includes('game') || lower.includes('gaming') || lower.includes('tv')) return 'Hobbies & Interests';
  if (lower.includes('health')) return 'Health & Fitness';
  if (lower.includes('learn')) return 'Learning & Education';
  if (lower.includes('spirit')) return 'Spiritual & Personal Growth';
  if (lower.includes('tribe') || lower.includes('family') || lower.includes('relationship')) return 'Family & Relationships';
  if (lower.includes('home')) return 'Home & Living';
  if (lower.includes('travel') || lower.includes('adventure')) return 'Travel & Adventure';
  if (lower.includes('chore')) return 'Chores';
  if (lower.includes('rest') || lower.includes('recovery')) return 'Rest & Recovery';
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

const resolvePersona = (value) => (String(value || '').toLowerCase() === 'work' ? 'work' : 'personal');

const isTaskLocked = (task) => task.dueDateLocked || task.lockDueDate || task.immovable === true || task.status === 'immovable';
const isStoryLocked = (story) => story?.dueDateLocked || story?.lockDueDate || story?.immovable === true || story?.status === 'immovable';

const TOP3_TAG_TOKENS = new Set(['top3', '#top3']);

function stripTop3Tags(tags) {
  if (!Array.isArray(tags) || !tags.length) return [];
  return tags.filter((tag) => !TOP3_TAG_TOKENS.has(String(tag || '').trim().toLowerCase()));
}

function withTop3Tag(tags) {
  const base = stripTop3Tags(tags);
  base.push('Top3');
  return base;
}

async function collectOwnerDocsByFilter(db, collectionName, ownerUid, {
  field,
  op = '==',
  value,
  pageSize = 400,
  maxPages = 200,
} = {}) {
  if (!field) return [];
  const docs = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    let q = db.collection(collectionName)
      .where('ownerUid', '==', ownerUid)
      .where(field, op, value);
    if (op === '>') {
      q = q.orderBy(field).orderBy(admin.firestore.FieldPath.documentId());
      if (cursor) q = q.startAfter(cursor.value, cursor.id);
    } else {
      q = q.orderBy(admin.firestore.FieldPath.documentId());
      if (cursor) q = q.startAfter(cursor.id);
    }
    const snap = await q.limit(pageSize).get().catch(() => ({ docs: [] }));
    const pageDocs = snap?.docs || [];
    if (!pageDocs.length) break;
    docs.push(...pageDocs);
    const last = pageDocs[pageDocs.length - 1];
    cursor = {
      id: last.id,
      value: op === '>' ? Number(last.get(field) || 0) : null,
    };
    if (pageDocs.length < pageSize) break;
  }
  return docs;
}

async function collectTaskTop3CandidateDocs(db, ownerUid, pageSize = 400) {
  const [top3Docs, flaggedDocs, rankedDocs] = await Promise.all([
    collectOwnerDocsByFilter(db, 'tasks', ownerUid, {
      field: 'aiTop3ForDay',
      op: '==',
      value: true,
      pageSize,
    }),
    collectOwnerDocsByFilter(db, 'tasks', ownerUid, {
      field: 'aiFlaggedTop',
      op: '==',
      value: true,
      pageSize,
    }),
    collectOwnerDocsByFilter(db, 'tasks', ownerUid, {
      field: 'aiPriorityRank',
      op: '>',
      value: 0,
      pageSize,
    }),
  ]);
  const map = new Map();
  [top3Docs, flaggedDocs, rankedDocs].forEach((list) => {
    list.forEach((doc) => {
      if (!map.has(doc.id)) map.set(doc.id, doc);
    });
  });
  return map;
}

async function collectStoryTop3CandidateDocs(db, ownerUid, pageSize = 400) {
  const [top3Docs, rankedDocs] = await Promise.all([
    collectOwnerDocsByFilter(db, 'stories', ownerUid, {
      field: 'aiTop3ForDay',
      op: '==',
      value: true,
      pageSize,
    }),
    collectOwnerDocsByFilter(db, 'stories', ownerUid, {
      field: 'aiFocusStoryRank',
      op: '>',
      value: 0,
      pageSize,
    }),
  ]);
  const map = new Map();
  [top3Docs, rankedDocs].forEach((list) => {
    list.forEach((doc) => {
      if (!map.has(doc.id)) map.set(doc.id, doc);
    });
  });
  return map;
}

function storyForcesTop3Tasks(storyData) {
  if (!storyData) return false;
  if (storyData.userPriorityFlag === true) return true;
  const level = normalizeUserPriority(storyData.userPriority || storyData.priority || storyData.priorityLabel);
  return level === 'critical';
}

function scoreCreatedSort(a, b) {
  if ((b?.score || 0) !== (a?.score || 0)) return (b?.score || 0) - (a?.score || 0);
  return (a?.createdMs || 0) - (b?.createdMs || 0);
}

function selectTopStoriesFresh(items) {
  const sorted = [...(items || [])].sort(scoreCreatedSort);
  if (!sorted.length) return [];

  const selected = [];
  const selectedIds = new Set();
  const pick = (entry) => {
    if (!entry || selectedIds.has(entry.id)) return;
    selected.push(entry);
    selectedIds.add(entry.id);
  };

  const manualStories = sorted.filter((story) => story?.data?.userPriorityFlag === true);
  if (manualStories.length) pick(manualStories[0]);

  const criticalStories = sorted.filter((story) => storyForcesTop3Tasks(story?.data));
  for (const story of criticalStories) {
    if (selected.length >= 3) break;
    pick(story);
  }

  for (const story of sorted) {
    if (selected.length >= 3) break;
    pick(story);
  }

  return selected.slice(0, 3);
}

function selectTopTasksFresh(items, storyMap = new Map()) {
  const sorted = [...(items || [])].sort(scoreCreatedSort);
  if (!sorted.length) return [];

  const selected = [];
  const selectedIds = new Set();
  const pick = (entry) => {
    if (!entry || selectedIds.has(entry.id)) return;
    selected.push(entry);
    selectedIds.add(entry.id);
  };

  const manualTasks = sorted.filter((task) => task?.data?.userPriorityFlag === true);
  if (manualTasks.length) {
    // Explicit user #1 flag always owns rank 1.
    pick(manualTasks[0]);
  }

  const storyDrivenTasks = sorted.filter((task) => {
    const storyId = task?.data?.storyId;
    if (!storyId) return false;
    const parentStory = storyMap.get(storyId);
    return storyForcesTop3Tasks(parentStory?.data);
  });
  for (const task of storyDrivenTasks) {
    if (selected.length >= 3) break;
    pick(task);
  }

  for (const task of sorted) {
    if (selected.length >= 3) break;
    pick(task);
  }

  return selected.slice(0, 3);
}

function getEntityKey(kind, id) {
  if (!kind || !id) return null;
  return `${kind}:${id}`;
}

function getDueDateMs(value) {
  const raw = value?.dueDate ?? value?.targetDate ?? value?.dueDateMs ?? value?.endDate ?? null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw.toDate === 'function') {
    const dt = raw.toDate();
    return dt instanceof Date ? dt.getTime() : null;
  }
  const parsed = raw ? Date.parse(String(raw)) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function getCreatedAtMs(value) {
  const raw = value?.createdAt ?? value?.created_at ?? null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw.toDate === 'function') {
    const dt = raw.toDate();
    return dt instanceof Date ? dt.getTime() : null;
  }
  const parsed = raw ? Date.parse(String(raw)) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Total remaining minutes needed for a candidate, accounting for progress %.
 * 10-point story at 50% → 300 minutes remaining.
 * No max cap — the scheduler fills available slots up to this total.
 */
function estimateRequiredMinutes(candidate, kind) {
  const points = Number(candidate?.points) || 0;
  const rawProgress = candidate?.progressPct ?? candidate?.progress ?? candidate?.completionPct ?? 0;
  const progressPct = Math.min(100, Math.max(0, Number(rawProgress || 0)));
  const remainingFraction = progressPct > 0 ? (1 - progressPct / 100) : 1;
  const rawFromPoints = points > 0 ? Math.round(points * 60 * remainingFraction) : 0;
  const raw = rawFromPoints || Number(candidate?.estimateMin) || (kind === 'task' ? 60 : 90);
  const minMinutes = kind === 'task' ? 30 : 60;
  return Math.max(minMinutes, raw || minMinutes);
}

// Keep a capped version for backward-compatible single-block estimates elsewhere
function estimateSchedulingMinutes(candidate, kind) {
  return estimateRequiredMinutes(candidate, kind);
}

/**
 * Find all free time gaps within [slotStartMs, slotEndMs] that are not covered
 * by any interval in busyList and are at least minGapMs long.
 */
function findFreeGapsInSlot(slotStartMs, slotEndMs, busyList, minGapMs = 30 * 60000) {
  const overlaps = busyList
    .filter((b) => b.end > slotStartMs && b.start < slotEndMs)
    .sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = slotStartMs;
  for (const o of overlaps) {
    if (o.start > cursor && o.start - cursor >= minGapMs) {
      gaps.push({ start: cursor, end: Math.min(o.start, slotEndMs) });
    }
    cursor = Math.max(cursor, o.end);
    if (cursor >= slotEndMs) break;
  }
  if (slotEndMs - cursor >= minGapMs) {
    gaps.push({ start: cursor, end: slotEndMs });
  }
  return gaps;
}

function sortPlannerCandidates(items, {
  rankKey,
  isTopFn,
  extraPriorityFn,
}) {
  return [...(items || [])].sort((a, b) => {
    const aManual = a?.userPriorityFlag === true ? 1 : 0;
    const bManual = b?.userPriorityFlag === true ? 1 : 0;
    if (aManual !== bManual) return bManual - aManual;

    const aExtra = extraPriorityFn?.(a) ? 1 : 0;
    const bExtra = extraPriorityFn?.(b) ? 1 : 0;
    if (aExtra !== bExtra) return bExtra - aExtra;

    const aTop = isTopFn?.(a) ? 1 : 0;
    const bTop = isTopFn?.(b) ? 1 : 0;
    if (aTop !== bTop) return bTop - aTop;

    const aRank = Number(a?.[rankKey] || 0) || 99;
    const bRank = Number(b?.[rankKey] || 0) || 99;
    if (aRank !== bRank) return aRank - bRank;

    const aScore = Number(a?.aiScore || 0);
    const bScore = Number(b?.aiScore || 0);
    if (aScore !== bScore) return bScore - aScore;

    const aDue = getDueDateMs(a);
    const bDue = getDueDateMs(b);
    if (aDue != null || bDue != null) {
      if (aDue == null) return 1;
      if (bDue == null) return -1;
      if (aDue !== bDue) return aDue - bDue;
    }

    const aCreated = getCreatedAtMs(a) ?? Number.MAX_SAFE_INTEGER;
    const bCreated = getCreatedAtMs(b) ?? Number.MAX_SAFE_INTEGER;
    if (aCreated !== bCreated) return aCreated - bCreated;

    return String(a?.title || '').localeCompare(String(b?.title || ''));
  });
}

function buildUnifiedPlacementQueue({
  stories = [],
  tasks = [],
  isTopStory,
  isTopTask,
  storyMap = new Map(),
}) {
  const rows = [
    ...stories.map((story) => ({
      kind: 'story',
      candidate: story,
      manual: story?.userPriorityFlag === true ? 1 : 0,
      extra: storyForcesTop3Tasks(story) ? 1 : 0,
      top: isTopStory?.(story) ? 1 : 0,
      rank: Number(story?.aiFocusStoryRank || 0) || 99,
      score: Number(story?.aiScore || 0),
      due: getDueDateMs(story),
      created: getCreatedAtMs(story) ?? Number.MAX_SAFE_INTEGER,
      title: String(story?.title || ''),
    })),
    ...tasks.map((task) => {
      const parentStory = task?.storyId ? storyMap.get(task.storyId) : null;
      return {
        kind: 'task',
        candidate: task,
        manual: task?.userPriorityFlag === true ? 1 : 0,
        extra: storyForcesTop3Tasks(parentStory) ? 1 : 0,
        top: isTopTask?.(task) ? 1 : 0,
        rank: Number(task?.aiPriorityRank || 0) || 99,
        score: Number(task?.aiScore || 0),
        due: getDueDateMs(task),
        created: getCreatedAtMs(task) ?? Number.MAX_SAFE_INTEGER,
        title: String(task?.title || ''),
      };
    }),
  ];

  rows.sort((a, b) => {
    if (a.manual !== b.manual) return b.manual - a.manual;
    if (a.extra !== b.extra) return b.extra - a.extra;
    if (a.top !== b.top) return b.top - a.top;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.score !== b.score) return b.score - a.score;
    if (a.due != null || b.due != null) {
      if (a.due == null) return 1;
      if (b.due == null) return -1;
      if (a.due !== b.due) return a.due - b.due;
    }
    if (a.created !== b.created) return a.created - b.created;
    return a.title.localeCompare(b.title);
  });

  return rows.map((row) => ({ kind: row.kind, candidate: row.candidate }));
}

function collectScheduledMinutesByEntity(blocks) {
  const scheduledMinutesByEntity = new Map();
  for (const block of blocks || []) {
    const kind = block?.storyId ? 'story' : block?.taskId ? 'task' : null;
    const entityId = block?.storyId || block?.taskId || null;
    const key = getEntityKey(kind, entityId);
    const startMs = toMillis(block?.start);
    const endMs = toMillis(block?.end);
    if (!key || !startMs || !endMs || endMs <= startMs) continue;
    const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    scheduledMinutesByEntity.set(key, (scheduledMinutesByEntity.get(key) || 0) + minutes);
  }
  return scheduledMinutesByEntity;
}

function addScheduledMinutes(scheduledMinutesByEntity, kind, entityId, minutes) {
  const key = getEntityKey(kind, entityId);
  if (!scheduledMinutesByEntity || !key || !minutes) return;
  scheduledMinutesByEntity.set(key, (scheduledMinutesByEntity.get(key) || 0) + Number(minutes || 0));
}

function buildPlannerCoverageSummary({ stories, tasks, scheduledMinutesByEntity }) {
  const storyList = stories || [];
  const taskList = tasks || [];
  let requiredStoryMinutes = 0;
  let scheduledStoryMinutes = 0;
  let requiredTaskMinutes = 0;
  let scheduledTaskMinutes = 0;
  let unscheduledStories = 0;
  let unscheduledTasks = 0;

  for (const story of storyList) {
    const required = estimateRequiredMinutes(story, 'story');
    const scheduled = Number(scheduledMinutesByEntity?.get(getEntityKey('story', story.id)) || 0);
    requiredStoryMinutes += required;
    scheduledStoryMinutes += scheduled;
    if (scheduled <= 0) unscheduledStories += 1;
  }

  for (const task of taskList) {
    const required = estimateRequiredMinutes(task, 'task');
    const scheduled = Number(scheduledMinutesByEntity?.get(getEntityKey('task', task.id)) || 0);
    requiredTaskMinutes += required;
    scheduledTaskMinutes += scheduled;
    if (scheduled <= 0) unscheduledTasks += 1;
  }

  const storyShortfallMinutes = Math.max(0, requiredStoryMinutes - scheduledStoryMinutes);
  const taskShortfallMinutes = Math.max(0, requiredTaskMinutes - scheduledTaskMinutes);
  return {
    candidateStories: storyList.length,
    candidateTasks: taskList.length,
    requiredStoryMinutes,
    scheduledStoryMinutes,
    requiredTaskMinutes,
    scheduledTaskMinutes,
    storyShortfallMinutes,
    taskShortfallMinutes,
    shortfallMinutes: storyShortfallMinutes + taskShortfallMinutes,
    unscheduledStories,
    unscheduledTasks,
  };
}

async function writePlannerStats({
  db,
  userId,
  source,
  windowStart,
  windowEnd,
  result,
  coverage,
}) {
  try {
    await db.collection('planner_stats').doc(userId).set({
      lastRunAt: Date.now(),
      source: source || 'planner',
      windowDays: windowStart && windowEnd
        ? Math.max(1, Math.round(windowEnd.startOf('day').diff(windowStart.startOf('day'), 'days').days) + 1)
        : 7,
      windowStart: windowStart?.toISO?.() || null,
      windowEnd: windowEnd?.toISO?.() || null,
      created: Number(result?.created || 0),
      blocked: Number(result?.blocked || 0),
      rescheduled: Number(result?.rescheduled || 0),
      replaced: Number(result?.replaced || 0),
      totalMovable: Number(result?.totalMovable || 0),
      gcalLinksCount: Array.isArray(result?.gcalLinks) ? result.gcalLinks.length : 0,
      candidateStories: Number(coverage?.candidateStories || 0),
      candidateTasks: Number(coverage?.candidateTasks || 0),
      requiredStoryMinutes: Number(coverage?.requiredStoryMinutes || 0),
      scheduledStoryMinutes: Number(coverage?.scheduledStoryMinutes || 0),
      requiredTaskMinutes: Number(coverage?.requiredTaskMinutes || 0),
      scheduledTaskMinutes: Number(coverage?.scheduledTaskMinutes || 0),
      storyShortfallMinutes: Number(coverage?.storyShortfallMinutes || 0),
      taskShortfallMinutes: Number(coverage?.taskShortfallMinutes || 0),
      shortfallMinutes: Number(coverage?.shortfallMinutes || 0),
      unscheduledStories: Number(coverage?.unscheduledStories || 0),
      unscheduledTasks: Number(coverage?.unscheduledTasks || 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('[planner_stats] write failed', userId, err?.message || err);
  }
}

async function materializePlannerThemeBlocks({
  db,
  userId,
  windowStart,
  windowEnd,
  themeAllocations,
  existingBlocks,
  fitnessBlocksAutoCreate = true,
}) {
  const results = { created: 0, skipped: 0, total: 0 };
  const isWorkShiftTheme = (value) => {
    if (value == null) return false;
    if (typeof value === 'number' && Number.isFinite(value)) return value === 12;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return false;
    if (raw === '12') return true;
    if (raw.includes('main gig')) return true;
    if (raw.includes('work shift')) return true;
    if (raw === 'work' || raw.startsWith('work ') || raw.endsWith(' work') || raw.includes('work (')) return true;
    return false;
  };
  const themePlan = normalizeThemeAllocationPlan(themeAllocations);
  const hasAnyAllocations = themePlan.allocations.length > 0 || Object.keys(themePlan.weeklyOverrides).length > 0;
  if (!hasAnyAllocations) return results;

  const existingPlannerKeys = new Set();
  existingBlocks.forEach((block) => {
    const sourceType = String(block.sourceType || block.source || '').toLowerCase();
    const entityType = String(block.entityType || '').toLowerCase();
    const category = String(block.category || '').toLowerCase();
    if (!sourceType.includes('theme_allocation') && !['health', 'work_shift'].includes(entityType) && !category.includes('work shift')) return;
    const startMs = toMillis(block.start);
    const endMs = toMillis(block.end);
    if (!startMs || !endMs) return;
    const label = String(block.subTheme || block.title || '').toLowerCase();
    if (!label) return;
    existingPlannerKeys.add(`${startMs}:${endMs}:${label}`);
  });

  const toMinutes = (hhmm) => {
    const [h = '0', m = '0'] = String(hhmm || '0:0').split(':');
    return Number(h) * 60 + Number(m);
  };

  const hasOverlap = (candidate, existing) => {
    const cand = Interval.fromDateTimes(candidate.start, candidate.end);
    return existing.some((block) => {
      const s = toDateTime(block.start, { defaultValue: null });
      const e = toDateTime(block.end, { defaultValue: null });
      if (!s || !e) return false;
      return cand.overlaps(Interval.fromDateTimes(s, e));
    });
  };

  const daysSpan = Math.max(1, Math.round(windowEnd.diff(windowStart, 'days').days) + 1);
  const processAllocation = async (alloc, kind, day, dayKey) => {
    const allocDay = Number(alloc.dayOfWeek);
    if (!Number.isFinite(allocDay) || allocDay !== dayKey) return;
    const startMinutes = toMinutes(alloc.startTime);
    const endMinutes = toMinutes(alloc.endTime);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) return;

    const start = day.set({
      hour: Math.floor(startMinutes / 60),
      minute: startMinutes % 60,
      second: 0,
      millisecond: 0,
    });
    const end = day.set({
      hour: Math.floor(endMinutes / 60),
      minute: endMinutes % 60,
      second: 0,
      millisecond: 0,
    });
    if (end <= start) return;

    const rawLabel = kind === 'health'
      ? String(alloc.subTheme || '').trim()
      : String(alloc.subTheme || alloc.theme || 'Work (Main Gig)').trim();
    if (!rawLabel) return;
    results.total += 1;

    const startMs = start.toMillis();
    const endMs = end.toMillis();
    const key = `${startMs}:${endMs}:${rawLabel.toLowerCase()}`;
    if (existingPlannerKeys.has(key)) {
      results.skipped += 1;
      return;
    }
    const overlapsExisting = hasOverlap({ start, end }, existingBlocks);
    // Work (Main Gig) allocations are hard constraints in smart mode.
    // Do not skip creating them just because another event overlaps.
    // If they are skipped here, personal scheduling has no work-window guardrail.
    if (overlapsExisting && kind !== 'work_shift') {
      results.skipped += 1;
      return;
    }

    const themeLabel = alloc.theme || (kind === 'health' ? 'Health & Fitness' : 'Work (Main Gig)');
    const payload = {
      ownerUid: userId,
      start: startMs,
      end: endMs,
      title: rawLabel,
      theme: themeLabel,
      category: kind === 'health' ? 'Fitness' : 'Work (Main Gig)',
      subTheme: kind === 'health' ? rawLabel : null,
      entityType: kind === 'health' ? 'health' : 'work_shift',
      sourceType: kind === 'health' ? 'health_allocation' : 'work_shift_allocation',
      source: 'theme_allocation',
      persona: kind === 'work_shift' ? 'work' : 'personal',
      flexibility: kind === 'work_shift' ? 'hard' : 'soft',
      conflictStatus: overlapsExisting ? 'overlap_with_existing' : null,
      status: 'planned',
      aiGenerated: true,
      rationale: `Weekly theme plan: ${themeLabel}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const blockRef = db.collection('calendar_blocks').doc();
    await blockRef.set(payload);
    existingBlocks.push({ id: blockRef.id, ...payload });
    existingPlannerKeys.add(key);
    results.created += 1;
  };

  for (let offset = 0; offset < daysSpan; offset += 1) {
    const day = windowStart.plus({ days: offset });
    const dayKey = day.weekday % 7;
    const dayAllocations = resolveThemeAllocationsForDate(themePlan, day, day.zoneName);
    const healthAllocations = dayAllocations.filter((alloc) => {
      const themeName = String(alloc?.theme || '').toLowerCase();
      const subTheme = String(alloc?.subTheme || '').trim();
      return themeName.includes('health') && subTheme;
    });
    const workShiftAllocations = dayAllocations.filter((alloc) => isWorkShiftTheme(alloc?.theme) || isWorkShiftTheme(alloc?.subTheme));
    if (fitnessBlocksAutoCreate) {
      for (const alloc of healthAllocations) {
        await processAllocation(alloc, 'health', day, dayKey);
      }
    }
    for (const alloc of workShiftAllocations) {
      await processAllocation(alloc, 'work_shift', day, dayKey);
    }
  }

  return results;
}

async function dedupePlannerBlocksForUser({ db, userId, windowStart, windowEnd }) {
  if (!userId) return { blocks: [], removed: 0, groups: 0 };
  const windowStartMs = windowStart?.toMillis ? windowStart.toMillis() : toMillis(windowStart);
  const windowEndMs = windowEnd?.toMillis ? windowEnd.toMillis() : toMillis(windowEnd);
  const snap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('start', '>=', windowStartMs)
    .where('start', '<=', windowEndMs)
    .get()
    .catch(() => ({ docs: [] }));

  const entries = snap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));
  const isPlannerCandidate = (data) => {
    const source = String(data.source || data.sourceType || '').toLowerCase();
    const entityType = String(data.entityType || data.category || '').toLowerCase();
    const isAi = data.aiGenerated === true || data.isAiGenerated === true || data.createdBy === 'ai';
    const isPlanner = source.includes('theme_allocation') || source.includes('health_allocation') || source.includes('work_shift_allocation');
    const isExternal = source === 'gcal' || source === 'google_calendar' || data.createdBy === 'google';
    if (isExternal) return false;
    return isAi || isPlanner || ['health', 'work_shift', 'task', 'story'].includes(entityType);
  };
  const buildKey = (data) => {
    const start = toMillis(data.start) || 0;
    const end = toMillis(data.end) || 0;
    const title = String(data.title || '').trim().toLowerCase();
    const entityType = String(data.entityType || data.category || '').trim().toLowerCase();
    const sourceType = String(data.sourceType || data.source || '').trim().toLowerCase();
    const persona = String(data.persona || '').trim().toLowerCase();
    const taskId = data.taskId || '';
    const storyId = data.storyId || '';
    const goalId = data.goalId || '';
    return [start, end, title, entityType, sourceType, persona, taskId, storyId, goalId].join('|');
  };

  const groups = new Map();
  const keptBlocks = [];

  entries.forEach((entry) => {
    if (!isPlannerCandidate(entry.data)) {
      keptBlocks.push({ id: entry.id, ...(entry.data || {}) });
      return;
    }
    const key = buildKey(entry.data);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  const deletions = [];
  let removed = 0;
  let groupsWithDupes = 0;
  groups.forEach((group) => {
    if (group.length === 1) {
      keptBlocks.push({ id: group[0].id, ...(group[0].data || {}) });
      return;
    }
    groupsWithDupes += 1;
    group.sort((a, b) => {
      const aTime = toMillis(a.data?.createdAt) || toMillis(a.data?.updatedAt) || toMillis(a.data?.start) || 0;
      const bTime = toMillis(b.data?.createdAt) || toMillis(b.data?.updatedAt) || toMillis(b.data?.start) || 0;
      return aTime - bTime;
    });
    const [keep, ...dupes] = group;
    keptBlocks.push({ id: keep.id, ...(keep.data || {}) });
    dupes.forEach((dup) => {
      deletions.push(dup.ref.delete());
      removed += 1;
    });
  });

  if (deletions.length) {
    await Promise.allSettled(deletions);
  }

  return { blocks: keptBlocks, removed, groups: groupsWithDupes };
}

async function replanExistingBlocksForUser({
  db,
  userId,
  profile,
  windowStart,
  windowEnd,
  themeAllocations,
  existingBlocks,
  reason = 'calendar_replan',
  days = 7,
  allowInsertion = false,
}) {
  if (!userId) return { rescheduled: 0, blocked: 0, totalMovable: 0, busy: [], capCounts: new Map() };
  const store = db || ensureFirestore();
  const profileSnap = profile
    ? { exists: true, data: () => profile }
    : await store.collection('profiles').doc(userId).get().catch(() => null);
  const profileData = profileSnap && profileSnap.exists ? (profileSnap.data() || {}) : {};
  const zone = resolveTimezone(profileData, 'Europe/London');
  const nowLocal = DateTime.now().setZone(coerceZone(zone));

  const normalizeDateTime = (value, fallback) => {
    if (!value) return fallback;
    if (DateTime.isDateTime(value)) return value.setZone(coerceZone(zone));
    if (value instanceof Date) return DateTime.fromJSDate(value, { zone: coerceZone(zone) });
    if (typeof value === 'number') return DateTime.fromMillis(value, { zone: coerceZone(zone) });
    return fallback;
  };

  const windowStartDt = normalizeDateTime(windowStart, nowLocal.startOf('day'));
  const windowEndDt = normalizeDateTime(
    windowEnd,
    windowStartDt.plus({ days: Math.max(1, Math.min(Number(days) || 7, 14)) }).endOf('day'),
  );

  let allocations = themeAllocations;
  if (!allocations) {
    try {
      const allocDoc = await store.collection('theme_allocations').doc(userId).get();
      if (allocDoc.exists) allocations = allocDoc.data() || {};
    } catch {
      allocations = {};
    }
  }
  const { pickSlots } = buildPickSlots(allocations);

  let blocks = existingBlocks;
  if (!blocks) {
    const blocksSnap = await store.collection('calendar_blocks')
      .where('ownerUid', '==', userId)
      .where('start', '>=', windowStartDt.toMillis())
      .where('start', '<=', windowEndDt.toMillis())
      .get()
      .catch(() => ({ docs: [] }));
    blocks = blocksSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  }

  const isChoreLike = (block) => {
    const type = String(block.entityType || block.category || '').toLowerCase();
    return ['chore', 'routine', 'habit'].includes(type);
  };

  const isMovable = (block) => {
    const entityType = String(block.entityType || '').toLowerCase();
    const isStoryTask = ['story', 'task'].includes(entityType) || block.storyId || block.taskId;
    if (!isStoryTask) return false;
    const ai = block.aiGenerated === true || block.isAiGenerated === true || block.createdBy === 'ai';
    if (!ai) return false;
    const flex = String(block.flexibility || '').toLowerCase();
    if (flex === 'hard') return false;
    const status = String(block.status || '').toLowerCase();
    if (['committed', 'done', 'completed'].includes(status)) return false;
    const startMs = toMillis(block.start);
    if (!startMs) return false;
    if (startMs < nowLocal.toMillis() + 15 * 60 * 1000) return false;
    return true;
  };

  const fixedBlocks = [];
  const movableBlocks = [];
  blocks.forEach((block) => {
    if (isMovable(block)) movableBlocks.push(block);
    else fixedBlocks.push(block);
  });

  const busyPersonal = [];
  const busyWork = [];
  const mainGigBlocks = []; // Track main gig planner blocks separately  
  const capCounts = new Map();
  const addBusy = (list, startMs, endMs) => {
    if (!startMs || !endMs) return;
    list.push({ start: startMs, end: endMs });
  };
  const addBusyPersonal = (startMs, endMs) => addBusy(busyPersonal, startMs, endMs);
  const addBusyWork = (startMs, endMs) => addBusy(busyWork, startMs, endMs);
  const addCap = (startMs) => {
    if (!startMs) return;
    const dayKey = DateTime.fromMillis(startMs, { zone: nowLocal.zoneName }).toISODate();
    capCounts.set(dayKey, (capCounts.get(dayKey) || 0) + 1);
  };

  fixedBlocks.forEach((block) => {
    if (isChoreLike(block)) return;
    const startMs = toMillis(block.start);
    const endMs = toMillis(block.end);
    if (!startMs || !endMs) return;
    const blockTheme = block.theme || block.category || '';
    if (isMainGigBlock(block)) {
      mainGigBlocks.push({ start: startMs, end: endMs, theme: blockTheme });
      addBusyPersonal(startMs, endMs);
    } else {
      addBusyPersonal(startMs, endMs);
      addBusyWork(startMs, endMs);
    }
    
    const entityType = String(block.entityType || '').toLowerCase();
    if (block.storyId || block.taskId || ['story', 'task'].includes(entityType)) {
      addCap(startMs);
    }
  });

  const findGapInSlot = ({ slotStartMs, slotEndMs, durationMs, busyList }) => {
    if (slotEndMs - slotStartMs < durationMs) return null;
    const overlaps = (busyList || [])
      .filter((b) => b.end > slotStartMs && b.start < slotEndMs)
      .sort((a, b) => a.start - b.start);
    let cursor = slotStartMs;
    for (const b of overlaps) {
      if (b.end <= cursor) continue;
      if (b.start - cursor >= durationMs) {
        return { start: cursor, end: cursor + durationMs };
      }
      cursor = Math.max(cursor, b.end);
      if (cursor + durationMs > slotEndMs) return null;
    }
    if (cursor + durationMs <= slotEndMs) {
      return { start: cursor, end: cursor + durationMs };
    }
    return null;
  };

  const findSlotForBlock = (block, durationMinutes) => {
    const durationMs = durationMinutes * 60000;
    const isWorkPersona = String(block?.persona || '').toLowerCase() === 'work';
    const busyList = isWorkPersona ? busyWork : busyPersonal;
    const blockStart = toDateTime(block.start, { defaultValue: null });
    const blockDay = blockStart ? blockStart.setZone(nowLocal.zoneName).startOf('day') : windowStartDt;
    const totalDays = Math.max(1, Math.round(windowEndDt.diff(windowStartDt, 'days').days) + 1);
    const startOffset = Math.max(0, Math.floor(blockDay.diff(windowStartDt, 'days').days));
    const themeLabel = resolveThemeLabel(block.theme || block.theme_id || block.category || null);

    if (isWorkPersona) {
      if (!mainGigBlocks.length) return null;
      const sortedMainGig = mainGigBlocks
        .filter((mg) => mg.start && mg.end)
        .sort((a, b) => a.start - b.start);
      for (const mg of sortedMainGig) {
        const slotStart = DateTime.fromMillis(mg.start, { zone: nowLocal.zoneName });
        const slotEnd = DateTime.fromMillis(mg.end, { zone: nowLocal.zoneName });
        if (slotEnd <= slotStart) continue;
        const slotStartMs = slotStart.toMillis();
        const slotEndMs = slotEnd.toMillis();
        if (slotEndMs - slotStartMs < durationMs) continue;

        const gap = findGapInSlot({
          slotStartMs,
          slotEndMs,
          durationMs,
          busyList,
        });
        if (gap) return gap;
      }
      return null;
    }

    for (let offset = startOffset; offset < totalDays; offset += 1) {
      const day = windowStartDt.plus({ days: offset });
      const dayKey = day.toISODate();
      if ((capCounts.get(dayKey) || 0) >= 3) continue;

      const slots = pickSlots(themeLabel, day);
      for (const slot of slots) {
        // Skip main gig blocks for tasks/stories
        const isMainGigSlot = isMainGigLabel(slot.label);
        if (isMainGigSlot) continue;
        
        const slotDays = slot.days || [1, 2, 3, 4, 5, 6, 7];
        if (!slotDays.includes(day.weekday)) continue;
        const slotStart = day.set({
          hour: Math.floor(slot.start),
          minute: Math.round((slot.start % 1) * 60),
          second: 0,
          millisecond: 0,
        });
        const slotEnd = day.set({
          hour: Math.floor(slot.end),
          minute: Math.round((slot.end % 1) * 60),
          second: 0,
          millisecond: 0,
        });
        if (slotEnd <= slotStart) continue;

        const slotInterval = Interval.fromDateTimes(slotStart, slotEnd);
        if (slotInterval.length('minutes') < durationMinutes) continue;
        const sleepInterval = Interval.fromDateTimes(day.set({ hour: 22, minute: 0 }), day.plus({ days: 1 }).set({ hour: 5, minute: 0 }));
        if (slotInterval.overlaps(sleepInterval)) continue;

        let effectiveStart = slotStart;
        if (day.hasSame(nowLocal, 'day')) {
          const minStart = nowLocal.plus({ minutes: 15 });
          if (minStart > effectiveStart) effectiveStart = minStart;
        }
        const gap = findGapInSlot({
          slotStartMs: effectiveStart.toMillis(),
          slotEndMs: slotEnd.toMillis(),
          durationMs,
          busyList,
        });
        if (gap) return gap;
      }
    }
    return null;
  };

  const sortedMovable = movableBlocks
    .slice()
    .sort((a, b) => toMillis(a.start) - toMillis(b.start));

  let rescheduled = 0;
  let blocked = 0;
  let created = 0;
  for (const block of sortedMovable) {
    const startMs = toMillis(block.start);
    const endMs = toMillis(block.end);
    if (!startMs || !endMs) continue;
    const durationMinutes = Math.max(15, Math.round((endMs - startMs) / 60000));
    const startDt = DateTime.fromMillis(startMs, { zone: nowLocal.zoneName });
    const endDt = DateTime.fromMillis(endMs, { zone: nowLocal.zoneName });
    const isWorkPersona = String(block?.persona || '').toLowerCase() === 'work';
    const busyList = isWorkPersona ? busyWork : busyPersonal;

    if (!hasOverlap({ start: startDt, end: endDt }, busyList)) {
      addBusyPersonal(startMs, endMs);
      addBusyWork(startMs, endMs);
      addCap(startMs);
      continue;
    }

    const slot = findSlotForBlock(block, durationMinutes);
    if (slot) {
      const blockRef = store.collection('calendar_blocks').doc(block.id);
      const reasonParts = [];
      if (block.placementReason) reasonParts.push(block.placementReason);
      else if (block.rationale) reasonParts.push(block.rationale);
      reasonParts.push('Rescheduled around calendar conflicts');
      const patch = {
        start: slot.start,
        end: slot.end,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rescheduledAt: admin.firestore.FieldValue.serverTimestamp(),
        rescheduledFromStart: startMs,
        rescheduledFromEnd: endMs,
        placementReason: reasonParts.filter(Boolean).join(' · '),
        conflictStatus: null,
      };
      await blockRef.set(patch, { merge: true });
      addBusyPersonal(slot.start, slot.end);
      addBusyWork(slot.start, slot.end);
      addCap(slot.start);
      rescheduled += 1;

      const fromLabel = `${startDt.toISODate()} ${startDt.toFormat('HH:mm')}-${endDt.toFormat('HH:mm')}`;
      const toLabel = `${DateTime.fromMillis(slot.start, { zone: nowLocal.zoneName }).toISODate()} ${DateTime.fromMillis(slot.start, { zone: nowLocal.zoneName }).toFormat('HH:mm')}-${DateTime.fromMillis(slot.end, { zone: nowLocal.zoneName }).toFormat('HH:mm')}`;
      await store.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: block.storyId || block.taskId || block.id,
        entityType: block.storyId ? 'story' : 'task',
        activityType: 'calendar_reschedule',
        description: `Calendar block moved (${fromLabel} → ${toLabel})`,
        metadata: { blockId: block.id, from: { start: startMs, end: endMs }, to: { start: slot.start, end: slot.end }, reason },
      }));
    } else {
      const blockRef = store.collection('calendar_blocks').doc(block.id);
      await blockRef.set({
        conflictStatus: 'blocked',
        rescheduleAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      addBusyPersonal(startMs, endMs);
      addBusyWork(startMs, endMs);
      addCap(startMs);
      blocked += 1;
    }
  }

  // Optional insertion of new entries (tasks/stories) into free slots
  // Insertion during replan is currently disabled to avoid duplicate planner logic; created remains 0.

  return {
    rescheduled,
    blocked,
    created,
    totalMovable: movableBlocks.length,
    busy: busyPersonal,
    busyWork,
    capCounts,
    windowStart: windowStartDt.toISO(),
    windowEnd: windowEndDt.toISO(),
    timezone: zone,
    gcalLinks: [],
  };
}

// ===== 01:00 Auto-pointing (missing points only)
async function runAutoPointingJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));

  for (const prof of profiles.docs) {
    const userId = prof.id;
    const userSnap = await db.collection('users').doc(userId).get().catch(() => null);
    if (userSnap && userSnap.exists && userSnap.data()?.sizingEnabled === false) continue;

    const sprintsSnap = await db.collection('sprints')
      .where('ownerUid', '==', userId)
      .get()
      .catch(() => ({ docs: [] }));
    const activeSprintIds = new Set(
      sprintsSnap.docs
        .filter((doc) => {
          const status = String(doc.data()?.status || '').toLowerCase();
          return ['active', 'current', 'planning', 'in-progress', 'inprogress', '1', '0', 'true'].includes(status);
        })
        .map((doc) => doc.id),
    );

    const storiesSnap = await db.collection('stories')
      .where('ownerUid', '==', userId)
      .get()
      .catch(() => ({ docs: [] }));
    const stories = storiesSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));
    const activeStoryIds = new Set(
      stories
        .filter((story) => {
          if (isStoryDoneStatus(story.data.status)) return false;
          if (!story.data.sprintId) return false;
          return activeSprintIds.has(story.data.sprintId);
        })
        .map((story) => story.id),
    );

    const tasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', userId)
      .get()
      .catch(() => ({ docs: [] }));
    const tasks = tasksSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));

    // All non-done tasks without points (expanded from active-sprint-only)
    const taskCandidates = tasks.filter(({ data }) => {
      if (data.deleted || isTaskDoneStatus(data.status)) return false;
      const hasPoints = Number.isFinite(Number(data.points)) && Number(data.points) > 0;
      return !hasPoints;
    });

    for (const task of taskCandidates) {
      const data = task.data || {};
      const type = String(data.type || data.task_type || '').toLowerCase();
      const isRoutine = ['chore', 'routine', 'habit', 'habitual'].includes(type) || isRoutineChoreHabit(data);

      let pts = null;
      let proposedTimeOfDay = null;
      if (isRoutine) {
        const estimateMinutes = Number(data.estimateMin || data.estimatedMinutes || data.estimateMinutes || data.durationMinutes || 0);
        const fallbackMinutes = Number.isFinite(estimateMinutes) && estimateMinutes > 0 ? estimateMinutes : 15;
        pts = clampTaskPoints(fallbackMinutes / 60) || 0.25;
      } else {
        const estimate = await callLLMJsonSafe({
          system: 'Estimate agile story points (0.25–8, 0.25 increments) and suggest time of day for this task. Return {"points":number,"timeOfDay":"morning"|"afternoon"|"evening"|null}. Use morning for deep/creative work, afternoon for reviews/meetings, evening for light/admin tasks.',
          user: buildSizingPrompt(data, 'Task'),
          purpose: 'autoPoint_task',
          userId,
        });
        pts = clampTaskPoints(estimate?.points);
        const tod = String(estimate?.timeOfDay || '').toLowerCase();
        if (['morning', 'afternoon', 'evening'].includes(tod)) proposedTimeOfDay = tod;
      }
      if (!pts) continue;

      const fieldUpdate = { points: pts, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (proposedTimeOfDay && !data.timeOfDay) fieldUpdate.timeOfDay = proposedTimeOfDay;
      await task.ref.set(fieldUpdate, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: task.id,
        entityType: 'task',
        activityType: 'auto_point',
        description: `Auto-pointed task at ${pts} pts${proposedTimeOfDay ? `, suggested timeOfDay: ${proposedTimeOfDay}` : ''}`,
        metadata: { run: '01:00_auto_point', points: pts, timeOfDay: proposedTimeOfDay, source: isRoutine ? 'derived_minutes' : 'llm' },
      }));
    }

    // Tasks that already have points but no timeOfDay (non-routine)
    const noTimeOfDayTasks = tasks.filter(({ data }) => {
      if (data.deleted || isTaskDoneStatus(data.status)) return false;
      if (data.timeOfDay) return false;
      const hasPoints = Number.isFinite(Number(data.points)) && Number(data.points) > 0;
      if (!hasPoints) return false; // will be handled above
      const type = String(data.type || data.task_type || '').toLowerCase();
      return !['chore', 'routine', 'habit', 'habitual'].includes(type) && !isRoutineChoreHabit(data);
    });

    for (const task of noTimeOfDayTasks) {
      const data = task.data || {};
      const estimate = await callLLMJsonSafe({
        system: 'Suggest the best time of day for this task. Return {"timeOfDay":"morning"|"afternoon"|"evening"}. Use morning for deep/creative work, afternoon for reviews/meetings, evening for light/admin tasks.',
        user: buildSizingPrompt(data, 'Task'),
        purpose: 'autoTimeOfDay_task',
        userId,
      });
      const tod = String(estimate?.timeOfDay || '').toLowerCase();
      if (!['morning', 'afternoon', 'evening'].includes(tod)) continue;
      await task.ref.set({ timeOfDay: tod, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: task.id,
        entityType: 'task',
        activityType: 'auto_time_of_day',
        description: `Proposed timeOfDay: ${tod}`,
        metadata: { run: '01:00_auto_time_of_day', timeOfDay: tod },
      }));
    }

    // All non-done stories without points
    const storyCandidates = stories.filter(({ data }) => {
      if (isStoryDoneStatus(data.status)) return false;
      const hasPoints = Number.isFinite(Number(data.points)) && Number(data.points) > 0;
      return !hasPoints;
    });

    for (const story of storyCandidates) {
      const data = story.data || {};
      const estimate = await callLLMJsonSafe({
        system: 'Estimate agile story points (0.25–8, 0.25 increments) and suggest time of day. Return {"points":number,"timeOfDay":"morning"|"afternoon"|"evening"|null}.',
        user: buildSizingPrompt(data, 'Story'),
        purpose: 'autoPoint_story',
        userId,
      });
      const pts = clampTaskPoints(estimate?.points);
      if (!pts) continue;
      const tod = String(estimate?.timeOfDay || '').toLowerCase();
      const proposedTimeOfDay = ['morning', 'afternoon', 'evening'].includes(tod) ? tod : null;
      const fieldUpdate = { points: pts, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (proposedTimeOfDay && !data.timeOfDay) fieldUpdate.timeOfDay = proposedTimeOfDay;
      await story.ref.set(fieldUpdate, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: story.id,
        entityType: 'story',
        activityType: 'auto_point',
        description: `Auto-pointed story at ${pts} pts${proposedTimeOfDay ? `, suggested timeOfDay: ${proposedTimeOfDay}` : ''}`,
        metadata: { run: '01:00_auto_point', points: pts, timeOfDay: proposedTimeOfDay },
      }));
    }

    // Stories that have points but no timeOfDay
    const noTimeOfDayStories = stories.filter(({ data }) => {
      if (isStoryDoneStatus(data.status)) return false;
      if (data.timeOfDay) return false;
      const hasPoints = Number.isFinite(Number(data.points)) && Number(data.points) > 0;
      return hasPoints;
    });

    for (const story of noTimeOfDayStories) {
      const data = story.data || {};
      const estimate = await callLLMJsonSafe({
        system: 'Suggest the best time of day for this story. Return {"timeOfDay":"morning"|"afternoon"|"evening"}.',
        user: buildSizingPrompt(data, 'Story'),
        purpose: 'autoTimeOfDay_story',
        userId,
      });
      const tod = String(estimate?.timeOfDay || '').toLowerCase();
      if (!['morning', 'afternoon', 'evening'].includes(tod)) continue;
      await story.ref.set({ timeOfDay: tod, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: story.id,
        entityType: 'story',
        activityType: 'auto_time_of_day',
        description: `Proposed timeOfDay: ${tod}`,
        metadata: { run: '01:00_auto_time_of_day', timeOfDay: tod },
      }));
    }
  }
}

exports.runAutoPointing = onSchedule({
  schedule: '0 1 * * *',
  timeZone: 'Europe/London',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
  memory: '512MiB',
  region: 'europe-west2',
}, runAutoPointingJob);

// ===== 02:00 Bi-directional conversion
async function runAutoConversionsJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));

  for (const prof of profiles.docs) {
    const userId = prof.id;

    // Task -> Story (explicit request or points > 4)
    // Convert tasks marked for story conversion first (hashtags/tags)
    const forcedStoryTasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', userId)
      .where('convertedToStoryId', '==', null)
      .limit(50)
      .get()
      .catch(() => ({ docs: [] }));

    const shouldForceStory = (task) => {
      const title = (task.title || '').toString().toLowerCase();
      const tags = Array.isArray(task.tags) ? task.tags.map((t) => (t || '').toString().toLowerCase()) : [];
      return task.forceStoryConversion === true ||
        title.includes('#story') ||
        tags.includes('story');
    };

    for (const doc of forcedStoryTasksSnap.docs) {
      const task = doc.data() || {};
      if (!shouldForceStory(task)) continue;
      const storyRef = db.collection('stories').doc();
      const storyRefValue = task.ref ? `ST-${String(task.ref).replace(/^TK-?/i, '')}` : storyRef.id.slice(-8).toUpperCase();
      await storyRef.set({
        ref: storyRefValue,
        title: task.title || 'Story created from task',
        description: task.description || '',
        points: task.points || 1,
        ownerUid: userId,
        goalId: task.goalId || null,
        sprintId: task.sprintId || null,
        theme: task.theme || null,
        status: clampStoryStatus(task.status),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        convertedFromTaskId: doc.id,
      }, { merge: true });

      await appendToDescription(doc.ref, task.description, `Converted to a story (${storyRefValue}) [forced]`);
      await doc.ref.set({
        status: 'done',
        convertedToStoryId: storyRef.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        forceStoryConversion: admin.firestore.FieldValue.delete(),
      }, { merge: true });

      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: doc.id,
        entityType: 'task',
        activityType: 'task_to_story_conversion',
        description: `Forced conversion to story ${storyRefValue}`,
        metadata: { storyId: storyRef.id, storyRef: storyRefValue, reason: 'force_story' },
      }));
    }

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
  region: 'europe-west2',
}, runAutoConversionsJob);

// ===== 03:00 Prioritisation (0-100) + To-do promotion
async function runPriorityScoringJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));

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
        title: gd.title || gd.name || null,
      });
    });

    const sprintMap = new Map();
    const activeSprintIds = new Set();
    const sprintSnap = await db.collection('sprints').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] }));
    sprintSnap.docs.forEach((d) => {
      const sd = d.data() || {};
      const end = sd.endDate || sd.end || null;
      const start = sd.startDate || sd.start || null;
      const nowMs = Date.now();
      const endMs = end ? toDateTime(end, { defaultValue: null })?.toMillis() : null;
      const startMs = start ? toDateTime(start, { defaultValue: null })?.toMillis() : null;
      const status = String(sd.status || '').toLowerCase();
      const inWindow = startMs && endMs ? (nowMs >= startMs && nowMs <= endMs) : false;
      const isActiveStatus = ['active', 'current', 'in-progress', 'inprogress', '1', 'true'].includes(status);
      if (isActiveStatus || inWindow) activeSprintIds.add(d.id);
      sprintMap.set(d.id, { endDateMs: endMs, startDateMs: startMs, status });
    });

    // ========== CLEAR ALL TOP 3 TAGS BEFORE RE-PRIORITIZATION ==========
    // This ensures only fresh Top 3 items are tagged, preventing stale tags
    console.log(`[Priority] Clearing all Top 3 tags for user ${userId}...`);

    let clearedCount = 0;
    const [tasksWithTop3, storiesWithTop3] = await Promise.all([
      collectOwnerDocsByFilter(db, 'tasks', userId, {
        field: 'aiTop3ForDay',
        op: '==',
        value: true,
      }),
      collectOwnerDocsByFilter(db, 'stories', userId, {
        field: 'aiTop3ForDay',
        op: '==',
        value: true,
      }),
    ]);
    const clearTop3Writer = db.bulkWriter();

    // Clear Top 3 from all tasks
    tasksWithTop3.forEach((doc) => {
      const patch = {
        aiTop3ForDay: false,
        aiTop3Date: admin.firestore.FieldValue.delete(),
        aiTop3Reason: admin.firestore.FieldValue.delete(),
        aiFlaggedTop: false,
        aiPriorityRank: admin.firestore.FieldValue.delete(),
        syncState: 'dirty',
      };
      clearedCount++;

      const data = doc.data() || {};
      const tags = Array.isArray(data.tags) ? data.tags : [];
      const newTags = stripTop3Tags(tags);
      if (newTags.length !== tags.length) {
        patch.tags = newTags;
      }
      clearTop3Writer.set(doc.ref, patch, { merge: true });
    });

    // Clear Top 3 from all stories
    storiesWithTop3.forEach((doc) => {
      const patch = {
        aiTop3ForDay: false,
        aiTop3Date: admin.firestore.FieldValue.delete(),
        aiTop3Reason: admin.firestore.FieldValue.delete(),
        aiFocusStoryRank: admin.firestore.FieldValue.delete(),
        syncState: 'dirty',
      };
      clearedCount++;

      const data = doc.data() || {};
      const tags = Array.isArray(data.tags) ? data.tags : [];
      const newTags = stripTop3Tags(tags);
      if (newTags.length !== tags.length) {
        patch.tags = newTags;
      }
      clearTop3Writer.set(doc.ref, patch, { merge: true });
    });

    await clearTop3Writer.close();
    if (clearedCount > 0) {
      console.log(`[Priority] Cleared Top 3 tags from ${clearedCount} items`);
    } else {
      console.log(`[Priority] No stale Top 3 tags to clear`);
    }
    // ========== END TOP 3 CLEARING ==========

    const fetchActiveTasks = async () => {
      const base = db.collection('tasks').where('ownerUid', '==', userId);
      const numericStatuses = [0, 1];
      const stringStatusesLower = ['backlog', 'todo', 'to do', 'in-progress', 'in progress', 'open', 'active', 'pending', '0', '1'];
      const stringStatusesUpper = ['Backlog', 'To Do', 'In Progress', 'Open', 'Active', 'Pending', 'Todo', 'In-Progress', '0', '1'];
      const queries = [
        base.where('status', 'in', numericStatuses),
        base.where('status', 'in', stringStatusesLower),
        base.where('status', 'in', stringStatusesUpper),
        base.where('status', '==', null),
      ];
      const snaps = await Promise.all(queries.map((q) => q.get().catch(() => ({ docs: [] }))));
      const seen = new Map();
      snaps.forEach((snap) => snap.docs.forEach((doc) => {
        if (!seen.has(doc.id)) seen.set(doc.id, doc);
      }));
      return Array.from(seen.values());
    };

    const isDueInActiveSprint = (dueMs) => {
      if (!dueMs) return false;
      for (const sprintId of activeSprintIds) {
        const sprint = sprintMap.get(sprintId);
        if (!sprint) continue;
        const start = sprint.startDateMs;
        const end = sprint.endDateMs;
        if (start && end && dueMs >= start && dueMs <= end) {
          return true;
        }
      }
      return false;
    };

    const activeSprintList = Array.from(activeSprintIds);

    const taskDocs = await fetchActiveTasks();
    let storiesSnap = { docs: [] };
    try {
      if (activeSprintList.length > 0 && activeSprintList.length <= 10) {
        storiesSnap = await db.collection('stories')
          .where('ownerUid', '==', userId)
          .where('sprintId', 'in', activeSprintList)
          .get();
      } else {
        storiesSnap = await db.collection('stories')
          .where('ownerUid', '==', userId)
          .get();
      }
    } catch {
      storiesSnap = { docs: [] };
    }

    const storyMetaMap = new Map();
    const activeStoryIds = new Set();
    storiesSnap.docs.forEach((d) => {
      const st = d.data() || {};
      const goal = st.goalId ? goalMap.get(st.goalId) || {} : {};
      storyMetaMap.set(d.id, {
        theme: st.theme || null,
        goalId: st.goalId || null,
        goalTheme: goal.theme || null,
        sprintId: st.sprintId || null,
      });
      if (st.sprintId && activeSprintIds.has(st.sprintId)) {
        activeStoryIds.add(d.id);
      }
    });

    const resolveTaskTheme = (entity) => {
      const storyMeta = entity.storyId ? (storyMetaMap.get(entity.storyId) || {}) : {};
      return entity.theme || storyMeta.theme || storyMeta.goalTheme || (entity.goalId ? goalMap.get(entity.goalId)?.theme : null);
    };

    const llmCandidates = [];
    const addCandidate = (candidate) => {
      if (!candidate) return;
      llmCandidates.push(candidate);
    };

    taskDocs.forEach((doc) => {
      const data = doc.data() || {};
      const statusRaw = data.status;
      const isDone = isTaskDoneStatus(statusRaw);
      if (isDone || data.deleted) return;
      const isEntityActiveSprint = data.sprintId ? activeSprintIds.has(data.sprintId) : false;
      const isLinkedActiveSprint = data.storyId ? activeStoryIds.has(data.storyId) : false;
      if (hasRecurrence(data)) return;
      const dueMs = toDateTime(data.dueDate || data.targetDate, { defaultValue: null })?.toMillis() || null;
      if (isRoutineChoreHabit(data) && !isTodayOrOverdue(dueMs)) return;

      const goal = data.goalId ? goalMap.get(data.goalId) : null;
      const createdMs = toDateTime(data.createdAt || data.serverCreatedAt, { defaultValue: null })?.toMillis() || null;
      const ageDays = createdMs ? (Date.now() - createdMs) / 86400000 : null;
      const priorityLevel = normalizeUserPriority(data.userPriority || data.priority || data.priorityLabel);
      const { boost: priorityBoost } = priorityBoostFor(priorityLevel);
      let bonus = 0;
      bonus += 10;
      if (priorityBoost > 0) bonus += priorityBoost;
      const oldUnlinked = !data.storyId && ageDays != null && ageDays >= 90;
      if (oldUnlinked) bonus += 15;

      const effectiveTheme = resolveTaskTheme(data);
      const baseScore = computeCriticalityScore({
        dueDateMs: dueMs,
        createdAtMs: createdMs,
        goalDueMs: goal?.dueDateMs || null,
        theme: effectiveTheme,
        points: data.points,
        taskType: data.type,
      });
      const preScore = Math.min(100, baseScore + bonus);
      const persona = String(data.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';
      const dueInDays = dueMs ? Math.round((dueMs - Date.now()) / 86400000) : null;
      addCandidate({
        id: doc.id,
        kind: 'task',
        ref: data.ref || data.reference || data.displayId || null,
        title: data.title || 'Task',
        description: data.description || data.notes || data.details || '',
        acceptanceCriteria: normalizeAcceptanceCriteria(data),
        theme: effectiveTheme,
        goalTitle: goal?.title || null,
        preScore,
        persona,
        dueInDays,
        userPriority: priorityLevel,
      });
    });

    storiesSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const statusRaw = data.status;
      const isDone = isStoryDoneStatus(statusRaw);
      if (isDone) return;
      const goal = data.goalId ? goalMap.get(data.goalId) : null;
      const createdMs = toDateTime(data.createdAt || data.serverCreatedAt, { defaultValue: null })?.toMillis() || null;
      const dueMs = toDateTime(data.dueDate || data.targetDate, { defaultValue: null })?.toMillis() || null;
      const priorityLevel = normalizeUserPriority(data.userPriority || data.priority || data.priorityLabel);
      const { boost: priorityBoost } = priorityBoostFor(priorityLevel);
      let bonus = 10;
      if (priorityBoost > 0) bonus += priorityBoost;

      const theme = data.theme || goal?.theme || null;
      const baseScore = computeCriticalityScore({
        dueDateMs: dueMs,
        createdAtMs: createdMs,
        goalDueMs: goal?.dueDateMs || null,
        theme,
        points: data.points,
        taskType: 'story',
      });
      const preScore = Math.min(100, baseScore + bonus);
      const persona = String(data.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';
      const dueInDays = dueMs ? Math.round((dueMs - Date.now()) / 86400000) : null;
      addCandidate({
        id: doc.id,
        kind: 'story',
        ref: data.ref || null,
        title: data.title || 'Story',
        description: data.description || '',
        acceptanceCriteria: normalizeAcceptanceCriteria(data),
        theme,
        goalTitle: goal?.title || null,
        preScore,
        persona,
        dueInDays,
        userPriority: priorityLevel,
      });
    });

    llmCandidates.sort((a, b) => (b.preScore || 0) - (a.preScore || 0));
    const { scores: textSignals, model: textModel } = await scorePriorityWithLLM({ userId, items: llmCandidates });

    const taskScores = [];
    const storyScores = [];

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
      const isHobbyTheme = (() => {
        if (effectiveTheme === 6) return true; // Hobbies & Interests theme id
        const t = String(effectiveTheme || '').toLowerCase();
        return t.includes('hobby') || t.includes('hobbies');
      })();

      const ageDays = createdMs ? (Date.now() - createdMs) / 86400000 : null;
      const storyMetaForTask = entityType === 'task' && entity.storyId ? (storyMetaMap.get(entity.storyId) || {}) : {};
      const linkedSprintId = storyMetaForTask.sprintId || null;
      const isLinkedActiveSprint = linkedSprintId ? activeSprintIds.has(linkedSprintId) : false;
      const isEntityActiveSprint = entity.sprintId ? activeSprintIds.has(entity.sprintId) : false;
      const priorityLevel = normalizeUserPriority(entity.userPriority || entity.priority || entity.priorityLabel);
      const { boost: priorityBoost, label: priorityLabel } = priorityBoostFor(priorityLevel);

      let bonus = 0;
      const bonusReasons = [];
      if ((entityType === 'task' && (isEntityActiveSprint || isLinkedActiveSprint))
        || (entityType === 'story' && isEntityActiveSprint)) {
        bonus += 10;
        bonusReasons.push('Active sprint');
      }
      if (priorityBoost > 0 && priorityLabel) {
        bonus += priorityBoost;
        bonusReasons.push(`User priority: ${priorityLabel}`);
      }
      const oldUnlinked = entityType === 'task' && !entity.storyId && ageDays != null && ageDays >= 90;
      if (oldUnlinked) {
        bonus += 15;
        bonusReasons.push('Aged > 90 days and unlinked');
      }
      if (isHobbyTheme) {
        bonus -= 25;
        bonusReasons.push('Hobbies downweighted');
      }

      const baseScore = computeCriticalityScore({
        dueDateMs: dueMs,
        createdAtMs: createdMs,
        goalDueMs: goal?.dueDateMs || null,
        theme: effectiveTheme,
        points: entity.points,
        taskType: entity.type || entityType,
      });
      const textSignal = textSignals.get(ref.id);
      const textScore = textSignal ? clampTextScore(textSignal.score) : 0;
      const textReason = textSignal?.reason ? `Text signal: ${textSignal.reason} (+${textScore})` : '';
      let score = Math.min(99, baseScore + bonus + textScore);
      if (isHobbyTheme) {
        // Hard cap hobby items below other themes
        score = Math.min(score, 45);
      }
      const reason = buildCriticalityReason({
        dueDateMs: dueMs,
        goalDueMs: goal?.dueDateMs || null,
        theme: effectiveTheme,
        points: entity.points,
      }) + (bonusReasons.length ? ' · ' + bonusReasons.join(' · ') : '') + (textReason ? ` · ${textReason}` : '');
      const patch = {
        aiCriticalityScore: score,
        aiCriticalityReason: reason,
        aiPriorityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        aiPriorityScore: admin.firestore.FieldValue.delete(),
        aiTop3Reason: admin.firestore.FieldValue.delete(),
        aiPriorityReason: admin.firestore.FieldValue.delete(),
        aiPriorityTextScore: admin.firestore.FieldValue.delete(),
        aiPriorityTextReason: admin.firestore.FieldValue.delete(),
        aiPriorityTextUpdatedAt: admin.firestore.FieldValue.delete(),
        aiPriorityTextModel: admin.firestore.FieldValue.delete(),
      };
      if (textSignal) {
        patch.aiCriticalityTextScore = textScore;
        patch.aiCriticalityTextReason = textSignal.reason || null;
        patch.aiCriticalityTextUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
        patch.aiCriticalityTextModel = textModel;
      } else {
        patch.aiCriticalityTextScore = admin.firestore.FieldValue.delete();
        patch.aiCriticalityTextReason = admin.firestore.FieldValue.delete();
        patch.aiCriticalityTextUpdatedAt = admin.firestore.FieldValue.delete();
        patch.aiCriticalityTextModel = admin.firestore.FieldValue.delete();
      }
      if (entityType === 'task' && !entity.deepLink) {
        const refId = entity.ref || entity.reference || entity.displayId || ref.id;
        patch.deepLink = buildEntityUrl('task', ref.id, refId);
      }
      if (entityType === 'story' && !entity.deepLink) {
        patch.deepLink = buildEntityUrl('story', ref.id, ref.ref);
      }
      await ref.set(patch, { merge: true });
      await db.collection('activity_stream').add(activityPayload({
        ownerUid: userId,
        entityId: ref.id,
        entityType,
        activityType: 'ai_priority_score',
        description: `Criticality ${score}/100 · ${reason}`,
        metadata: { score, reason, textScore, textReason: textSignal?.reason || null, textModel: textModel || null, run: '03:00_priority' },
      }));

      if (entityType === 'story') {
        storyScores.push({ id: ref.id, score, data: entity, reason, dueMs, createdMs, refObj: ref, persona: entity.persona || 'personal' });
      }

      if (entityType === 'task') {
        taskScores.push({ id: ref.id, score, data: entity, reason, dueMs, refObj: ref, persona: entity.persona || 'personal' });
      }
    };

    const clearPriorityFields = async (ref, entityType) => {
      // Get current document to check for Top3 tag
      const doc = await ref.get();
      const data = doc.data() || {};
      const tags = Array.isArray(data.tags) ? data.tags : [];

      const patch = {
        aiCriticalityScore: admin.firestore.FieldValue.delete(),
        aiCriticalityReason: admin.firestore.FieldValue.delete(),
        aiPriorityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        aiCriticalityTextScore: admin.firestore.FieldValue.delete(),
        aiCriticalityTextReason: admin.firestore.FieldValue.delete(),
        aiCriticalityTextUpdatedAt: admin.firestore.FieldValue.delete(),
        aiCriticalityTextModel: admin.firestore.FieldValue.delete(),
        aiPriorityScore: admin.firestore.FieldValue.delete(),
        aiTop3Reason: admin.firestore.FieldValue.delete(),
        aiPriorityReason: admin.firestore.FieldValue.delete(),
        aiPriorityTextScore: admin.firestore.FieldValue.delete(),
        aiPriorityTextReason: admin.firestore.FieldValue.delete(),
        aiPriorityTextUpdatedAt: admin.firestore.FieldValue.delete(),
        aiPriorityTextModel: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Remove 'Top3' tag if present (for completed/deleted items)
      const strippedTags = stripTop3Tags(tags);
      if (strippedTags.length !== tags.length) {
        const newTags = strippedTags;
        patch.tags = newTags;
      }

      if (entityType === 'task') {
        patch.aiFlaggedTop = false;
        patch.aiPriorityRank = admin.firestore.FieldValue.delete();
        patch.aiTop3ForDay = false;
        patch.aiTop3Date = admin.firestore.FieldValue.delete();
        patch.aiPriorityLabel = admin.firestore.FieldValue.delete();
        patch.aiTop3Reason = admin.firestore.FieldValue.delete();
        patch.aiPriorityReason = admin.firestore.FieldValue.delete();
        patch.syncState = 'dirty';
      }
      if (entityType === 'story') {
        patch.aiFocusStoryRank = admin.firestore.FieldValue.delete();
        patch.aiFocusStoryAt = admin.firestore.FieldValue.delete();
        patch.aiTop3ForDay = false;
        patch.aiTop3Date = admin.firestore.FieldValue.delete();
        patch.aiPriorityLabel = admin.firestore.FieldValue.delete();
        patch.aiTop3Reason = admin.firestore.FieldValue.delete();
        patch.aiPriorityReason = admin.firestore.FieldValue.delete();
        patch.syncState = 'dirty';
      }
      await ref.set(patch, { merge: true });
    };

    for (const doc of taskDocs) {
      const data = doc.data() || {};
      const statusRaw = data.status;
      const isDone = isTaskDoneStatus(statusRaw);
      if (isDone || data.deleted) {
        await clearPriorityFields(doc.ref, 'task');
        continue;
      }
      // Never score recurring chores/routines/habits
      if (hasRecurrence(data) || isRoutineChoreHabit(data)) {
        await clearPriorityFields(doc.ref, 'task');
        continue;
      }
      const dueMs = toDateTime(data.dueDate || data.targetDate, { defaultValue: null })?.toMillis() || null;
      const storyMeta = data.storyId ? (storyMetaMap.get(data.storyId) || {}) : {};
      const inActiveSprint = (data.sprintId && activeSprintIds.has(data.sprintId))
        || (storyMeta.sprintId && activeSprintIds.has(storyMeta.sprintId));
      const mustScore = inActiveSprint || isDueInActiveSprint(dueMs);
      if (!mustScore && !isTaskOpenStatus(statusRaw)) {
        await clearPriorityFields(doc.ref, 'task');
        continue;
      }
      await applyScore(doc.ref, data, 'task');
    }

    for (const doc of storiesSnap.docs) {
      const data = doc.data() || {};
      const statusRaw = data.status;
      const isDone = isStoryDoneStatus(statusRaw);
      if (isDone) {
        await clearPriorityFields(doc.ref, 'story');
        continue;
      }
      const dueMs = toDateTime(data.dueDate || data.targetDate, { defaultValue: null })?.toMillis() || null;
      const inActiveSprint = data.sprintId && activeSprintIds.has(data.sprintId);
      const mustScore = inActiveSprint || isDueInActiveSprint(dueMs);
      if (!mustScore && !isStoryOpenStatus(statusRaw)) {
        await clearPriorityFields(doc.ref, 'story');
        continue;
      }
      await applyScore(doc.ref, data, 'story');
    }

    const nowLocal = DateTime.now();
    const todayIso = nowLocal.toISODate();
    const todayEnd = nowLocal.endOf('day').toMillis();
    const tomorrowEnd = nowLocal.plus({ days: 1 }).endOf('day').toMillis();
    const eveningCutoffHour = 17;
    const focusDueDate = (nowLocal.hour >= eveningCutoffHour) ? tomorrowEnd : todayEnd;

    const taskCandidates = taskScores
      .map((t) => ({
        ...t,
        createdMs: toDateTime(t.data.createdAt || t.data.serverCreatedAt, { defaultValue: null })?.toMillis() || null,
        persona: String(t.data.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal',
      }))
      .filter((t) => !isRoutineChoreHabit(t.data));

    const storyCandidates = storyScores
      .map((s) => ({
        ...s,
        createdMs: toDateTime(s.data.createdAt || s.data.serverCreatedAt, { defaultValue: null })?.toMillis() || null,
        persona: String(s.data.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal',
      }));

    const topTaskIdsByPersona = { personal: new Set(), work: new Set() };
    const topStoryIdsByPersona = { personal: new Set(), work: new Set() };

    for (const persona of ['personal', 'work']) {
      const personaTasks = taskCandidates.filter((t) => t.persona === persona);
      const personaStories = storyCandidates.filter((s) => s.persona === persona);

      const storyMap = new Map(personaStories.map((story) => [story.id, story]));
      const focusStories = selectTopStoriesFresh(personaStories);
      const focusTasks = selectTopTasksFresh(personaTasks, storyMap);

      topTaskIdsByPersona[persona] = new Set(focusTasks.map((t) => t.id));
      topStoryIdsByPersona[persona] = new Set(focusStories.map((s) => s.id));

      const taskBatch = db.batch();
      focusTasks.forEach((task, idx) => {
        const tags = withTop3Tag(task.data?.tags);
        const reason = [
          'Top 3 priority',
          `score=${Math.round(task.score || 0)}`,
          task.reason ? `why=${task.reason}` : null,
        ].filter(Boolean).join(' | ');
        const patch = {
          aiFlaggedTop: true,
          aiPriorityRank: idx + 1,
          aiTop3ForDay: true,
          aiTop3Date: todayIso,
          aiTop3Reason: reason,
          aiCriticalityScore: 100,
          aiPriorityReason: admin.firestore.FieldValue.delete(),
          tags,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          syncState: 'dirty',
        };
        if (!isTaskLocked(task.data)) {
          patch.dueDate = focusDueDate;
          patch.aiDueDateSetAt = admin.firestore.FieldValue.serverTimestamp();
          patch.dueDateReason = reason;
        }
        taskBatch.set(task.refObj, patch, { merge: true });

        db.collection('activity_stream').add(activityPayload({
          ownerUid: userId,
          entityId: task.id,
          entityType: 'task',
          activityType: 'ai_top3_selected',
          description: `Selected as top ${idx + 1}/3 (${persona}) · score ${Math.round(task.score || 0)}/100`,
          metadata: { persona, rank: idx + 1, score: task.score, reason: task.reason || null, run: '03:00_priority_top3' },
        })).catch(() => { });
      });
      await taskBatch.commit();

      const storyBatch = db.batch();
      focusStories.forEach((story, idx) => {
        const reason = [
          'Top 3 priority',
          `score=${Math.round(story.score || 0)}`,
          story.reason ? `why=${story.reason}` : null,
        ].filter(Boolean).join(' | ');
        const patch = {
          aiFocusStoryRank: idx + 1,
          aiFocusStoryAt: admin.firestore.FieldValue.serverTimestamp(),
          aiTop3ForDay: true,
          aiTop3Date: todayIso,
          aiTop3Reason: reason,
          aiCriticalityScore: 100,
          aiPriorityReason: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          syncState: 'dirty',
        };
        if (focusDueDate && !isStoryLocked(story.data)) {
          patch.dueDate = focusDueDate;
          patch.aiDueDateSetAt = admin.firestore.FieldValue.serverTimestamp();
          patch.dueDateReason = reason;
        }
        storyBatch.set(story.refObj, patch, { merge: true });

        db.collection('activity_stream').add(activityPayload({
          ownerUid: userId,
          entityId: story.id,
          entityType: 'story',
          activityType: 'ai_top3_selected',
          description: `Selected as top ${idx + 1}/3 (${persona}) · score ${Math.round(story.score || 0)}/100`,
          metadata: { persona, rank: idx + 1, score: story.score, reason: story.reason || null, run: '03:00_priority_top3' },
        })).catch(() => { });
      });
      await storyBatch.commit();
    }

    // Clear flags for tasks no longer in top 3 (per persona)
    const flaggedMap = await collectTaskTop3CandidateDocs(db, userId, 400);
    const clearTasksWriter = db.bulkWriter();
    flaggedMap.forEach((doc) => {
      const data = doc.data() || {};
      const persona = String(data.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';
      if (!topTaskIdsByPersona[persona].has(doc.id)) {
        const cleanedTags = stripTop3Tags(data.tags);
        clearTasksWriter.set(doc.ref, {
          aiFlaggedTop: false,
          aiPriorityRank: admin.firestore.FieldValue.delete(),
          aiTop3ForDay: false,
          aiTop3Date: admin.firestore.FieldValue.delete(),
          aiPriorityLabel: admin.firestore.FieldValue.delete(),
          aiTop3Reason: admin.firestore.FieldValue.delete(),
          aiPriorityReason: admin.firestore.FieldValue.delete(),
          ...(Array.isArray(data.tags) && cleanedTags.length !== data.tags.length ? { tags: cleanedTags } : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          syncState: 'dirty',
        }, { merge: true });
      }
    });
    await clearTasksWriter.close();

    // Clear/update story focus ranks and ensure non-top stories use sprint end date
    const storyClearWriter = db.bulkWriter();
    storiesSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (isStoryDoneStatus(data.status)) return;
      const persona = String(data.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';
      const isTop = topStoryIdsByPersona[persona].has(doc.id);
      const sprint = data.sprintId ? sprintMap.get(data.sprintId) : null;
      const sprintEnd = sprint?.endDateMs || null;
      const patch = {};
      if (isTop) {
        patch.aiTop3ForDay = true;
        patch.aiTop3Date = todayIso;
      } else {
        if (Number(data.aiFocusStoryRank || 0) > 0 || data.aiTop3ForDay) {
          patch.aiFocusStoryRank = admin.firestore.FieldValue.delete();
          patch.aiTop3ForDay = false;
          patch.aiTop3Date = admin.firestore.FieldValue.delete();
          patch.aiPriorityLabel = admin.firestore.FieldValue.delete();
          patch.aiTop3Reason = admin.firestore.FieldValue.delete();
          patch.aiPriorityReason = admin.firestore.FieldValue.delete();
        }
        if (Array.isArray(data.tags)) {
          const cleanedTags = stripTop3Tags(data.tags);
          if (cleanedTags.length !== data.tags.length) {
            patch.tags = cleanedTags;
          }
        }
        if (sprintEnd && !isStoryLocked(data)) {
          patch.dueDate = sprintEnd;
        }
      }
      if (Object.keys(patch).length) {
        patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        patch.syncState = 'dirty';
        storyClearWriter.set(doc.ref, patch, { merge: true });
      }
    });
    await storyClearWriter.close();

    // Compute Top 3 immediately after scoring so it's ready before calendar planning
    await recomputeTop3ForUser(db, userId).catch((err) => {
      console.warn(`[runPriorityScoringJob] recomputeTop3ForUser failed for ${userId}:`, err?.message);
    });
  }
}

exports.runPriorityScoring = onSchedule({
  schedule: '0 3 * * *',
  timeZone: 'Europe/London',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
  memory: '512MiB',
  region: 'europe-west2',
}, runPriorityScoringJob);

// ===== 05:30 Calendar insertion respecting theme windows and busy time
async function runCalendarPlannerJob() {
  const db = ensureFirestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));
  const now = DateTime.now();
  const MAX_PLANNING_DAYS = 21;

  for (const prof of profiles.docs) {
    const userId = prof.id;
    const profile = prof.data() || {};
    const zone = resolveTimezone(profile, 'Europe/London');
    const nowLocal = now.setZone(coerceZone(zone));
    const windowStart = nowLocal.startOf('day');
    let windowEnd = windowStart.plus({ days: 7 }).endOf('day');

    // User-defined weekly theme blocks
    let themeAllocations = [];
    try {
      const allocDoc = await db.collection('theme_allocations').doc(userId).get();
      if (allocDoc.exists) themeAllocations = allocDoc.data() || {};
    } catch { /* ignore */ }

    const { pickSlots } = buildPickSlots(themeAllocations);

    // Cache goals for theme inheritance
    const goalMetaMap = new Map();
    const sprintMetaMap = new Map();
    const activeSprintIds = new Set();
    try {
      const goalsSnap = await db.collection('goals').where('ownerUid', '==', userId).get();
      goalsSnap.docs.forEach((d) => {
        const gd = d.data() || {};
        goalMetaMap.set(d.id, { theme: gd.theme || null, tags: gd.tags || [], title: gd.title || '' });
      });
      const sprintSnap = await db.collection('sprints').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] }));
      sprintSnap.docs.forEach((d) => {
        const sd = d.data() || {};
        const status = String(sd.status || '').toLowerCase();
        const startMs = sd.startDate || sd.start || null;
        const endMs = sd.endDate || sd.end || null;
        const nowMs = Date.now();
        const isActiveStatus = ['active', 'current', 'in-progress', 'inprogress', '1', 'true'].includes(status);
        const inWindow = startMs && endMs ? (nowMs >= toMillis(startMs) && nowMs <= toMillis(endMs)) : false;
        if (isActiveStatus || inWindow) {
          activeSprintIds.add(d.id);
        }
        sprintMetaMap.set(d.id, {
          status: sd.status,
          start: sd.startDate || sd.start || null,
          end: sd.endDate || sd.end || null,
          name: sd.name || sd.title || d.id,
        });
      });
    } catch { /* ignore */ }

    const activeSprintEndMs = Array.from(activeSprintIds)
      .map((sprintId) => toMillis(sprintMetaMap.get(sprintId)?.end))
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    if (activeSprintEndMs.length > 0) {
      const latestSprintEndMs = Math.max(...activeSprintEndMs);
      const maxWindowEndMs = windowStart.plus({ days: MAX_PLANNING_DAYS - 1 }).endOf('day').toMillis();
      const boundedEndMs = Math.min(latestSprintEndMs, maxWindowEndMs);
      const boundedEnd = DateTime.fromMillis(boundedEndMs, { zone: windowStart.zoneName }).endOf('day');
      if (boundedEnd.toMillis() > windowEnd.toMillis()) {
        windowEnd = boundedEnd;
      }
    }
    const planningDays = Math.max(
      1,
      Math.min(
        MAX_PLANNING_DAYS,
        Math.floor(
          windowEnd.startOf('day').diff(windowStart.startOf('day'), 'days').days,
        ) + 1,
      ),
    );

    await recomputeTop3ForUser(db, userId).catch((err) => {
      console.warn('[calendar-planner] top3 refresh failed', userId, err?.message || err);
    });

    let storiesSnap = { docs: [] };
    try {
      const activeSprintList = Array.from(activeSprintIds);
      if (activeSprintList.length > 0 && activeSprintList.length <= 10) {
        storiesSnap = await db.collection('stories')
          .where('ownerUid', '==', userId)
          .where('sprintId', 'in', activeSprintList)
          .get();
      } else {
        storiesSnap = await db.collection('stories')
          .where('ownerUid', '==', userId)
          .get();
      }
    } catch {
      storiesSnap = { docs: [] };
    }

    const tasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', userId)
      .get()
      .catch(() => ({ docs: [] }));

    const dedupeResult = await dedupePlannerBlocksForUser({ db, userId, windowStart, windowEnd });
    if (dedupeResult.removed > 0) {
      console.log(`[calendar-planner] removed ${dedupeResult.removed} duplicate blocks for ${userId}`);
    }
    const existingBlocks = dedupeResult.blocks;

    const fitnessBlocksAutoCreate = profile?.fitnessBlocksAutoCreate !== false;
    const plannerBlockResult = await materializePlannerThemeBlocks({
      db,
      userId,
      windowStart,
      windowEnd,
      themeAllocations,
      existingBlocks,
      fitnessBlocksAutoCreate,
    });
    if (plannerBlockResult.created > 0) {
      console.log(`[calendar-planner] planner blocks created for ${userId}: ${plannerBlockResult.created}`);
    }

    const rescheduleResult = await replanExistingBlocksForUser({
      db,
      userId,
      profile,
      windowStart,
      windowEnd,
      themeAllocations,
      existingBlocks,
      reason: 'nightly_calendar_planner',
    });
    if (rescheduleResult.rescheduled > 0 || rescheduleResult.blocked > 0) {
      console.log(`[calendar-planner] rescheduled blocks for ${userId}: ${rescheduleResult.rescheduled}, blocked: ${rescheduleResult.blocked}`);
    }

    const busyPersonal = Array.isArray(rescheduleResult.busy) ? [...rescheduleResult.busy] : [];
    const busyWork = Array.isArray(rescheduleResult.busyWork) ? [...rescheduleResult.busyWork] : [];
    const scoreWithBonus = (priority, base) => (Number(priority) >= 4 ? Number(base || 0) + 500 : Number(base || 0));

    // Build sprint map for gating and metadata
    const sprintMap = new Map();
    sprintMetaMap.forEach((val, key) => sprintMap.set(key, val));

    const openStories = storiesSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((s) => !isStoryDoneStatus(s.status))
      .filter((s) => activeSprintIds.size === 0 || (s.sprintId && activeSprintIds.has(s.sprintId)));
    const openStoryIds = new Set(openStories.map((story) => story.id));

    const openTasks = tasksSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((t) => !isTaskDoneStatus(t.status) && !t.deleted)
      .filter((t) => !isRoutineChoreHabit(t))
      .filter((t) => {
        if (activeSprintIds.size === 0) return true;
        if (t.sprintId && activeSprintIds.has(t.sprintId)) return true;
        if (t.storyId && openStoryIds.has(t.storyId)) return true;
        return false;
      });

    const matchResult = await matchExternalCalendarEventsToEntities({
      db,
      userId,
      blocks: existingBlocks,
      openStories,
      openTasks,
    });
    if (matchResult.matchedStories > 0 || matchResult.matchedTasks > 0) {
      console.log(`[calendar-planner] matched external events for ${userId}: stories=${matchResult.matchedStories}, tasks=${matchResult.matchedTasks}`);
    }

    const todayIso = nowLocal.toISODate();
    const isTopTask = (t) => {
      if (t.aiTop3ForDay !== true) return false;
      if (t.aiTop3Date && String(t.aiTop3Date).slice(0, 10) !== todayIso) return false;
      return true;
    };
    const isTopStory = (s) => {
      if (s.aiTop3ForDay !== true) return false;
      if (s.aiTop3Date && String(s.aiTop3Date).slice(0, 10) !== todayIso) return false;
      return true;
    };
    const rankSort = (a, b, key) => {
      const ar = Number(a?.[key] || 0) || 99;
      const br = Number(b?.[key] || 0) || 99;
      if (ar !== br) return ar - br;
      const as = scoreWithBonus(a.priority, a.aiCriticalityScore);
      const bs = scoreWithBonus(b.priority, b.aiCriticalityScore);
      return bs - as;
    };

    const scoredStories = openStories.map((story) => ({
      ...story,
      aiScore: scoreWithBonus(story.priority, story.aiCriticalityScore),
    }));
    const storyMap = new Map(scoredStories.map((story) => [story.id, story]));
    const scoredTasks = openTasks.map((task) => ({
      ...task,
      aiScore: scoreWithBonus(task.priority, task.aiCriticalityScore),
    }));

    const storyQueue = ['personal', 'work']
      .flatMap((persona) => {
        const personaStories = scoredStories.filter((story) => resolvePersona(story.persona) === persona);
        return sortPlannerCandidates(personaStories, {
          rankKey: 'aiFocusStoryRank',
          isTopFn: isTopStory,
          extraPriorityFn: (story) => storyForcesTop3Tasks(story),
        });
      });

    const taskQueue = ['personal', 'work']
      .flatMap((persona) => {
        const personaTasks = scoredTasks.filter((task) => resolvePersona(task.persona) === persona);
        return sortPlannerCandidates(personaTasks, {
          rankKey: 'aiPriorityRank',
          isTopFn: isTopTask,
          extraPriorityFn: (task) => {
            const parentStory = task?.storyId ? storyMap.get(task.storyId) : null;
            return storyForcesTop3Tasks(parentStory);
          },
        });
      });

    const candidateIds = new Set([
      ...storyQueue.map((story) => getEntityKey('story', story.id)),
      ...taskQueue.map((task) => getEntityKey('task', task.id)),
    ]);

    // Remove AI blocks that are no longer in the top set, but preserve planner blocks
    const remainingBlocks = [];
    for (const block of existingBlocks) {
      const isAi = block.aiGenerated === true || block.createdBy === 'ai';
      const isPlannerBlock = block.source === 'theme_allocation' || 
                            block.sourceType === 'health_allocation' || 
                            block.sourceType === 'work_shift_allocation';
      const key = block.storyId ? `story:${block.storyId}` : block.taskId ? `task:${block.taskId}` : null;
      
      // Only delete AI-generated task/story blocks that are no longer in top set
      // Always preserve user-defined planner blocks
      if (isAi && !isPlannerBlock && key && !candidateIds.has(key)) {
        await db.collection('calendar_blocks').doc(block.id).delete().catch(() => { });
      } else {
        remainingBlocks.push(block);
      }
    }

    const scheduledMinutesByEntity = collectScheduledMinutesByEntity(remainingBlocks);

    const mainGigBlocks = []; // Track main gig planner blocks separately
    remainingBlocks.forEach((b) => {
      if (b.start && b.end) {
        const blockTheme = b.theme || b.category || '';
        if (isMainGigBlock(b)) {
          mainGigBlocks.push({ start: b.start, end: b.end, theme: blockTheme });
          busyPersonal.push({ start: b.start, end: b.end });
        } else {
          busyPersonal.push({ start: b.start, end: b.end });
          busyWork.push({ start: b.start, end: b.end });
        }
      }
    });

    const placementQueue = buildUnifiedPlacementQueue({
      stories: storyQueue,
      tasks: taskQueue,
      isTopStory,
      isTopTask,
      storyMap,
    });

    let created = 0;
    let blocked = 0;

    // Greedy multi-block scheduler: fills all available free time until total needed is covered
    const placeEntry = async (candidate, kind) => {
      const sprint = candidate.sprintId ? sprintMap.get(candidate.sprintId) : null;
      const sprintStart = sprint?.start ? toMillis(sprint.start) : null;
      const sprintEnd = sprint?.end ? toMillis(sprint.end) : null;
      const isWorkPersona = String(candidate?.persona || '').toLowerCase() === 'work';
      const busyList = isWorkPersona ? busyWork : busyPersonal;

      const totalNeededMs = estimateRequiredMinutes(candidate, kind) * 60000;
      const entityKey = getEntityKey(kind, candidate.id);
      const alreadyScheduledMs = (scheduledMinutesByEntity.get(entityKey) || 0) * 60000;
      let stillNeededMs = totalNeededMs - alreadyScheduledMs;
      if (stillNeededMs <= 0) return { created: 0, blocked: 0 };

      const MIN_BLOCK_MS = 30 * 60000;
      const title = candidate.title;
      const basePayload = {
        ownerUid: userId,
        title,
        entityType: kind,
        taskId: kind === 'task' ? candidate.id : null,
        storyId: kind === 'story' ? candidate.id : null,
        sprintId: candidate.sprintId || null,
        theme: candidate.theme || null,
        goalId: candidate.goalId || null,
        status: 'planned',
        aiGenerated: true,
        aiScore: candidate.aiScore || null,
        aiReason: candidate.aiCriticalityReason || null,
        placementReason: 'Nightly planner: greedy fill for remaining work',
        calendarMatchSource: 'calendar_event_created_via_planner',
        calendarMatchNote: 'Calendar event created via planner',
        deepLink: buildEntityUrl(kind === 'story' ? 'story' : 'task', candidate.id, candidate.ref || null),
        persona: candidate.persona || (isWorkPersona ? 'work' : 'personal'),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      let created = 0;

      if (isWorkPersona) {
        if (!mainGigBlocks.length) return { created: 0, blocked: 1 };
        const sortedMainGig = mainGigBlocks.filter((mg) => mg.start && mg.end).sort((a, b) => a.start - b.start);
        for (const mg of sortedMainGig) {
          if (stillNeededMs <= 0) break;
          if (sprintStart && mg.end < sprintStart) continue;
          if (sprintEnd && mg.start > sprintEnd) continue;
          const gaps = findFreeGapsInSlot(mg.start, mg.end, busyList, MIN_BLOCK_MS);
          for (const gap of gaps) {
            if (stillNeededMs <= 0) break;
            const blockMs = Math.min(gap.end - gap.start, stillNeededMs);
            if (blockMs < MIN_BLOCK_MS) continue;
            const blockRef = db.collection('calendar_blocks').doc();
            const payload = { ...basePayload, start: gap.start, end: gap.start + blockMs };
            await blockRef.set(payload);
            busyPersonal.push({ start: payload.start, end: payload.end });
            busyWork.push({ start: payload.start, end: payload.end });
            const minutesAdded = Math.round(blockMs / 60000);
            addScheduledMinutes(scheduledMinutesByEntity, kind, candidate.id, minutesAdded);
            stillNeededMs -= blockMs;
            created++;
            const slotDt = DateTime.fromMillis(gap.start, { zone: windowStart.zoneName });
            await db.collection('activity_stream').add(activityPayload({
              ownerUid: userId,
              entityId: candidate.id,
              entityType: kind,
              activityType: 'calendar_insertion',
              description: `Calendar block created (${slotDt.toISODate()} ${slotDt.toFormat('HH:mm')}–${DateTime.fromMillis(gap.start + blockMs, { zone: windowStart.zoneName }).toFormat('HH:mm')})`,
              metadata: { blockId: blockRef.id, reason: payload.placementReason, theme: payload.theme || null, goalId: payload.goalId || null },
            }));
          }
        }
        return { created, blocked: stillNeededMs > MIN_BLOCK_MS ? 1 : 0 };
      }

      for (let offset = 0; offset < planningDays && stillNeededMs > MIN_BLOCK_MS; offset++) {
        const day = windowStart.plus({ days: offset });
        const dayStartMs = day.toMillis();
        const dayEndMs = day.endOf('day').toMillis();
        if ((sprintStart && dayEndMs < sprintStart) || (sprintEnd && dayStartMs > sprintEnd)) continue;

        const allSlots = pickSlots(candidate.theme || candidate.goal || null, day);
        const slots = filterSlotsByTimeOfDay(allSlots, candidate.timeOfDay || null);
        for (const slot of slots) {
          if (stillNeededMs <= 0) break;
          if (isMainGigLabel(slot.label)) continue;
          const slotDays = slot.days || [1, 2, 3, 4, 5, 6, 7];
          if (!slotDays.includes(day.weekday)) continue;
          const slotStart = day.set({ hour: Math.floor(slot.start), minute: Math.round((slot.start % 1) * 60), second: 0, millisecond: 0 });
          const slotEnd = day.set({ hour: Math.floor(slot.end), minute: Math.round((slot.end % 1) * 60), second: 0, millisecond: 0 });
          if (sprintStart && slotEnd.toMillis() < sprintStart) continue;
          if (sprintEnd && slotStart.toMillis() > sprintEnd) continue;

          const gaps = findFreeGapsInSlot(slotStart.toMillis(), slotEnd.toMillis(), busyList, MIN_BLOCK_MS);
          for (const gap of gaps) {
            if (stillNeededMs <= 0) break;
            if (mainGigBlocks.some((mg) => mg.end > gap.start && mg.start < gap.end)) continue;
            const blockMs = Math.min(gap.end - gap.start, stillNeededMs);
            if (blockMs < MIN_BLOCK_MS) continue;
            const blockRef = db.collection('calendar_blocks').doc();
            const payload = { ...basePayload, start: gap.start, end: gap.start + blockMs };
            await blockRef.set(payload);
            busyPersonal.push({ start: payload.start, end: payload.end });
            busyWork.push({ start: payload.start, end: payload.end });
            const minutesAdded = Math.round(blockMs / 60000);
            addScheduledMinutes(scheduledMinutesByEntity, kind, candidate.id, minutesAdded);
            stillNeededMs -= blockMs;
            created++;
            const slotDt = DateTime.fromMillis(gap.start, { zone: windowStart.zoneName });
            await db.collection('activity_stream').add(activityPayload({
              ownerUid: userId,
              entityId: candidate.id,
              entityType: kind,
              activityType: 'calendar_insertion',
              description: `Calendar block created (${slotDt.toISODate()} ${slotDt.toFormat('HH:mm')}–${DateTime.fromMillis(gap.start + blockMs, { zone: windowStart.zoneName }).toFormat('HH:mm')})`,
              metadata: { blockId: blockRef.id, reason: payload.placementReason, theme: payload.theme || null, goalId: payload.goalId || null },
            }));
          }
        }
      }
      return { created, blocked: stillNeededMs > MIN_BLOCK_MS ? 1 : 0 };
    };

    for (const entry of placementQueue) {
      const { kind, candidate } = entry;
      const entityKey = getEntityKey(kind, candidate?.id);
      const totalNeededMs = estimateRequiredMinutes(candidate, kind) * 60000;
      const alreadyMs = (scheduledMinutesByEntity.get(entityKey) || 0) * 60000;
      if (alreadyMs >= totalNeededMs) continue; // fully covered
      const res = await placeEntry(candidate, kind);
      created += res.created || 0;
      blocked += res.blocked || 0;
    }

    const coverage = buildPlannerCoverageSummary({
      stories: storyQueue,
      tasks: taskQueue,
      scheduledMinutesByEntity,
    });

    await writePlannerStats({
      db,
      userId,
      source: 'nightly',
      windowStart,
      windowEnd,
      result: {
        created,
        blocked,
        rescheduled: rescheduleResult.rescheduled || 0,
        replaced: dedupeResult.removed || 0,
        totalMovable: rescheduleResult.totalMovable || 0,
      },
      coverage,
    });
  }
}

exports.runCalendarPlanner = onSchedule({
  schedule: '30 5 * * *',
  timeZone: 'Europe/London',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
  memory: '1GiB',
  timeoutSeconds: 540,
  region: 'europe-west2',
}, runCalendarPlannerJob);

async function recomputeTop3ForUser(db, userId) {
  for (const persona of ['personal', 'work']) {
    await _deltaTop3ForPersona(db, userId, persona);
  }
}

exports.materializeFitnessBlocksNow = onCall({
  timeZone: 'Europe/London',
  memory: '512MiB',
  timeoutSeconds: 120,
  region: 'europe-west2',
  invoker: 'public',
}, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new https.HttpsError('unauthenticated', 'Sign in required');
  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get().catch(() => null);
  const profile = profileSnap && profileSnap.exists ? (profileSnap.data() || {}) : {};
  const zone = resolveTimezone(profile, 'Europe/London');
  const requestedDays = Math.max(1, Math.min(Number(req?.data?.days || 7), 14));
  const MAX_PLANNING_DAYS = 21;
  const requestedStart = String(req?.data?.startDate || '').trim();
  const requestedStartDt = requestedStart
    ? DateTime.fromISO(requestedStart, { zone: coerceZone(zone) }).startOf('day')
    : null;
  const windowStart = requestedStartDt && requestedStartDt.isValid
    ? requestedStartDt
    : DateTime.now().setZone(coerceZone(zone)).startOf('day');
  let windowEnd = windowStart.plus({ days: requestedDays }).endOf('day');

  let themeAllocations = [];
  try {
    const allocDoc = await db.collection('theme_allocations').doc(uid).get();
    if (allocDoc.exists) themeAllocations = allocDoc.data() || {};
  } catch { /* ignore */ }

  const dedupeResult = await dedupePlannerBlocksForUser({ db, userId: uid, windowStart, windowEnd });
  if (dedupeResult.removed > 0) {
    console.log(`[calendar-planner] removed ${dedupeResult.removed} duplicate blocks for ${uid}`);
  }
  const existingBlocks = dedupeResult.blocks;

  const result = await materializePlannerThemeBlocks({
    db,
    userId: uid,
    windowStart,
    windowEnd,
    themeAllocations,
    existingBlocks,
  });

  return {
    ok: true,
    ...result,
    windowStart: windowStart.toISO(),
    windowEnd: windowEnd.toISO(),
  };
});

/**
 * Clear stale calendar instances before re-planning
 * Validates existing instances against current criteria:
 * - Item still exists and is active (not completed)
 * - Chores still meet placement heuristics
 */
/**
 * Roll over missed chore / routine / habit instances.
 *
 * For each scheduled_instance that:
 *  - belongs to a chore, routine, or habit source type
 *  - was planned for a past date
 *  - is still in 'planned' or 'unscheduled' status (i.e. not marked done)
 *
 * We:
 *  1. Mark the instance as 'missed'
 *  2. Flag the source document so routine-adherence views can surface the miss
 *     and the next planning run naturally schedules the next recurrence ASAP.
 *
 * Tasks are intentionally excluded — they have their own overdue handling.
 */
async function applyRolloverForMissedChoresRoutines(db, userId, zone) {
  if (!userId) return { rolled: 0 };
  const todayKey = DateTime.now().setZone(coerceZone(zone)).toISODate().replace(/-/g, ''); // yyyyMMdd
  const ROLLOVER_SOURCE_TYPES = new Set(['chore', 'routine', 'habit']);
  const PENDING_STATUSES = new Set(['planned', 'unscheduled', 'pending', '']);

  let instancesSnap;
  try {
    instancesSnap = await db.collection('scheduled_instances')
      .where('ownerUid', '==', userId)
      .where('occurrenceDate', '<', todayKey)
      .get();
  } catch (err) {
    console.warn('[Rollover] Failed to query scheduled_instances:', err?.message || err);
    return { rolled: 0 };
  }

  const toMark = []; // { ref, data }
  for (const doc of instancesSnap.docs) {
    const data = doc.data() || {};
    if (!ROLLOVER_SOURCE_TYPES.has(data.sourceType)) continue;
    const status = String(data.status || '').toLowerCase();
    if (!PENDING_STATUSES.has(status) && status !== 'missed') continue; // already done/committed — skip
    if (status === 'missed') continue; // already processed
    toMark.push({ ref: doc.ref, data });
  }

  if (!toMark.length) return { rolled: 0 };

  // Group by sourceId so we only write each source doc once
  const sourceUpdates = new Map(); // sourceId → { collection, missedCount, lastMissedDayKey }
  for (const { data } of toMark) {
    const sid = data.sourceId;
    if (!sid) continue;
    const col = data.sourceType === 'chore' ? 'chores'
      : data.sourceType === 'habit' ? 'habits'
      : 'routines';
    const existing = sourceUpdates.get(sid);
    // Keep the most-recent missed day for display
    const dayKey = data.dayKey || data.occurrenceDate || '';
    if (!existing || dayKey > existing.lastMissedDayKey) {
      sourceUpdates.set(sid, { collection: col, missedCount: (existing?.missedCount || 0) + 1, lastMissedDayKey: dayKey });
    } else {
      existing.missedCount += 1;
    }
  }

  // Batch-update instance status
  const instanceBatches = [];
  for (let i = 0; i < toMark.length; i += 500) {
    const batch = db.batch();
    toMark.slice(i, i + 500).forEach(({ ref }) => {
      batch.update(ref, {
        status: 'missed',
        missedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    instanceBatches.push(batch.commit());
  }

  // Batch-update source docs — flag for adherence display and priority boost
  const sourceBatches = [];
  const sourceEntries = Array.from(sourceUpdates.entries());
  for (let i = 0; i < sourceEntries.length; i += 500) {
    const batch = db.batch();
    sourceEntries.slice(i, i + 500).forEach(([sourceId, info]) => {
      const ref = db.collection(info.collection).doc(sourceId);
      batch.update(ref, {
        pendingRollover: true,
        lastMissedAt: admin.firestore.FieldValue.serverTimestamp(),
        missedCount: admin.firestore.FieldValue.increment(info.missedCount),
        // Slightly elevate priority so the next occurrence gets scheduled sooner
        schedulerPriority: admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    sourceBatches.push(batch.commit());
  }

  await Promise.allSettled([...instanceBatches, ...sourceBatches]);

  console.log(`[Rollover] Marked ${toMark.length} missed chore/routine instances, updated ${sourceUpdates.size} source docs`);
  return { rolled: toMark.length };
}

async function clearStaleCalendarInstances(db, userId, windowStart, windowEnd, currentOccurrences) {
  const dayKeyToOccurrenceDate = (dayKey) => dayKey.replace(/-/g, '');

  const instancesSnap = await db.collection('scheduled_instances')
    .where('ownerUid', '==', userId)
    .where('occurrenceDate', '>=', dayKeyToOccurrenceDate(windowStart.toISODate()))
    .where('occurrenceDate', '<=', dayKeyToOccurrenceDate(windowEnd.toISODate()))
    .get()
    .catch(() => ({ docs: [] }));

  if (instancesSnap.docs.length === 0) {
    console.log(`[ClearStale] No existing instances found for user ${userId}`);
    return { deleted: 0, kept: 0 };
  }

  const occurrenceMap = new Map();
  currentOccurrences.forEach(occ => {
    const key = `${occ.sourceType}:${occ.sourceId}:${occ.dayKey}`;
    occurrenceMap.set(key, occ);
  });

  const toDelete = [];

  for (const doc of instancesSnap.docs) {
    const instance = doc.data() || {};
    const key = `${instance.sourceType}:${instance.sourceId}:${instance.dayKey}`;
    const currentOcc = occurrenceMap.get(key);

    if (!currentOcc) {
      console.log(`[ClearStale] Removing "${instance.title}" - source no longer active`);
      toDelete.push({ ref: doc.ref, reason: 'source-deleted-or-completed' });
      continue;
    }

    // For chores/routines: validate against intelligent heuristics
    if (currentOcc.sourceType === 'chore' || currentOcc.sourceType === 'routine') {
      const blockSnap = await db.collection('calendar_blocks').doc(instance.blockId).get().catch(() => null);
      if (blockSnap && blockSnap.exists) {
        const block = blockSnap.data() || {};
        const title = (currentOcc.title || '').toLowerCase();
        const firstWindow = Array.isArray(block.windows) && block.windows.length > 0 ? block.windows[0] : null;
        const startTime = firstWindow ? firstWindow.startTime : '00:00';
        const endTime = firstWindow ? firstWindow.endTime : '23:59';
        const [startHour] = startTime.split(':').map(Number);
        const [endHour] = endTime.split(':').map(Number);

        // Check outdoor task heuristic
        const outdoorKeywords = ['car wash', 'lawn', 'mow', 'garden', 'outdoor', 'outside', 'yard', 'driveway'];
        const isOutdoorTask = outdoorKeywords.some(kw => title.includes(kw));
        if (isOutdoorTask && (startHour < 7 || endHour > 18)) {
          console.log(`[ClearStale] Removing outdoor chore "${instance.title}" - scheduled at night`);
          toDelete.push({ ref: doc.ref, reason: 'outdoor-task-nighttime' });
          continue;
        }

        // Check morning task heuristic
        const morningKeywords = ['morning', 'breakfast', 'wake'];
        const isMorningTask = morningKeywords.some(kw => title.includes(kw));
        if (isMorningTask && startHour > 10) {
          console.log(`[ClearStale] Removing morning chore "${instance.title}" - scheduled too late`);
          toDelete.push({ ref: doc.ref, reason: 'morning-task-too-late' });
          continue;
        }

        // Check evening task heuristic
        const eveningKeywords = ['evening', 'dinner', 'bedtime', 'night'];
        const isEveningTask = eveningKeywords.some(kw => title.includes(kw));
        if (isEveningTask && endHour < 17) {
          console.log(`[ClearStale] Removing evening chore "${instance.title}" - scheduled too early`);
          toDelete.push({ ref: doc.ref, reason: 'evening-task-too-early' });
          continue;
        }
      }
    }
  }

  // Batch delete stale instances
  if (toDelete.length > 0) {
    const batches = [];
    for (let i = 0; i < toDelete.length; i += 500) {
      const batch = db.batch();
      toDelete.slice(i, i + 500).forEach(({ ref }) => batch.delete(ref));
      batches.push(batch.commit());
    }
    await Promise.all(batches);

    const reasons = toDelete.reduce((acc, { reason }) => {
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});

    console.log(`[ClearStale] Deleted ${toDelete.length} stale instances:`, JSON.stringify(reasons));
  }

  return {
    deleted: toDelete.length,
    kept: instancesSnap.docs.length - toDelete.length
  };
}

exports.replanCalendarNow = onCall({
  timeZone: 'Europe/London',
  memory: '512MiB',
  timeoutSeconds: 120,
  region: 'europe-west2',
  invoker: 'public',
}, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new https.HttpsError('unauthenticated', 'Sign in required');
  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get().catch(() => null);
  const profile = profileSnap && profileSnap.exists ? (profileSnap.data() || {}) : {};
  const fitnessBlocksAutoCreate = req?.data?.fitnessBlocksAutoCreate !== false
    && profile?.fitnessBlocksAutoCreate !== false;
  const zone = resolveTimezone(profile, 'Europe/London');
  // planningMode: 'smart' (default) = only user GCal + work/fitness are hard-busy, everything else is fair game
  //               'strict'          = all planned blocks + user calendar are hard constraints
  const planningMode = (() => {
    const fromReq = String(req?.data?.planningMode || '').toLowerCase();
    const fromProfile = String(profile.plannerMode || '').toLowerCase();
    const resolved = fromReq || fromProfile;
    return resolved === 'strict' ? 'strict' : 'smart';
  })();
  const MAX_PLANNING_DAYS = 21;
  const days = Math.max(1, Math.min(Number(req?.data?.days || 7), 14));
  const requestedStart = String(req?.data?.startDate || '').trim();
  const requestedStartDt = requestedStart
    ? DateTime.fromISO(requestedStart, { zone: coerceZone(zone) }).startOf('day')
    : null;
  const windowStart = requestedStartDt && requestedStartDt.isValid
    ? requestedStartDt
    : DateTime.now().setZone(coerceZone(zone)).startOf('day');
  let windowEnd = windowStart.plus({ days }).endOf('day');

  let themeAllocations = [];
  try {
    const allocDoc = await db.collection('theme_allocations').doc(uid).get();
    if (allocDoc.exists) themeAllocations = allocDoc.data() || {};
  } catch { /* ignore */ }

  await recomputeTop3ForUser(db, uid).catch((err) => {
    console.warn('[replanCalendarNow] top3 refresh failed', uid, err?.message || err);
  });

  // Roll over any missed chore / routine / habit instances from past days
  await applyRolloverForMissedChoresRoutines(db, uid, zone).catch((err) => {
    console.warn('[replanCalendarNow] rollover failed', uid, err?.message || err);
  });

  // Load sprints for sprint window gating
  const sprintsSnap = await db.collection('sprints')
    .where('ownerUid', '==', uid)
    .get()
    .catch(() => ({ docs: [] }));
  const sprintMap = new Map();
  sprintsSnap.docs.forEach((d) => {
    const data = d.data() || {};
    sprintMap.set(d.id, {
      start: data.startDate || data.start || null,
      end: data.endDate || data.end || null,
      status: data.status,
    });
  });

  // Fetch open stories/tasks in active/planning sprints
  const activeSprintIds = Array.from(sprintMap.entries())
    .filter(([id, s]) => {
      const status = String(s.status || '').toLowerCase();
      return status === 'active' || status === 'planning' || status === '1' || status === '0';
    })
    .map(([id]) => id);

  const activeSprintEndMs = activeSprintIds
    .map((sprintId) => toMillis(sprintMap.get(sprintId)?.end))
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (activeSprintEndMs.length > 0) {
    const latestSprintEndMs = Math.max(...activeSprintEndMs);
    const maxWindowEndMs = windowStart.plus({ days: MAX_PLANNING_DAYS - 1 }).endOf('day').toMillis();
    const boundedEndMs = Math.min(latestSprintEndMs, maxWindowEndMs);
    const boundedEnd = DateTime.fromMillis(boundedEndMs, { zone: windowStart.zoneName }).endOf('day');
    if (boundedEnd.toMillis() > windowEnd.toMillis()) {
      windowEnd = boundedEnd;
    }
  }
  const planningDays = Math.max(
    1,
    Math.min(
      MAX_PLANNING_DAYS,
      Math.floor(
        windowEnd.startOf('day').diff(windowStart.startOf('day'), 'days').days,
      ) + 1,
    ),
  );

  const blocksSnap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', windowStart.toMillis())
    .where('start', '<=', windowEnd.toMillis())
    .get()
    .catch(() => ({ docs: [] }));
  const existingBlocks = blocksSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  let storiesSnap = { docs: [] };
  try {
    if (activeSprintIds.length > 0 && activeSprintIds.length <= 10) {
      storiesSnap = await db.collection('stories')
        .where('ownerUid', '==', uid)
        .where('sprintId', 'in', activeSprintIds)
        .get();
    } else if (activeSprintIds.length > 10) {
      storiesSnap = await db.collection('stories')
        .where('ownerUid', '==', uid)
        .get();
    }
  } catch {
    storiesSnap = { docs: [] };
  }

  const tasksSnap = await db.collection('tasks')
    .where('ownerUid', '==', uid)
    .get()
    .catch(() => ({ docs: [] }));

  const scoreWithBonus = (priority, base) => (Number(priority) >= 4 ? Number(base || 0) + 500 : Number(base || 0));
  const todayIso = DateTime.now().toISODate();
  const isTopTask = (t) => {
    if (t.aiTop3ForDay !== true) return false;
    if (t.aiTop3Date && String(t.aiTop3Date).slice(0, 10) !== todayIso) return false;
    return true;
  };
  const isTopStory = (s) => {
    if (s.aiTop3ForDay !== true) return false;
    if (s.aiTop3Date && String(s.aiTop3Date).slice(0, 10) !== todayIso) return false;
    return true;
  };
  const openStories = storiesSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((s) => !isStoryDoneStatus(s.status))
    .filter((s) => activeSprintIds.length === 0 || (s.sprintId && activeSprintIds.includes(s.sprintId)))
    // NEW: Skip locked stories (prevent rescheduling manual placements)
    .filter((s) => {
      if (s.orchestrationLocked === true) {
        console.log(`[Replan] Skipping locked story: ${s.id} (reason: ${s.orchestrationLockedReason})`);
        return false;
      }
      return true;
    });
  const openStoryIds = new Set(openStories.map((story) => story.id));
  const openTasks = tasksSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((t) => !isTaskDoneStatus(t.status))
    .filter((t) => !isRoutineChoreHabit(t))
    .filter((t) => {
      if (activeSprintIds.length === 0) return true;
      if (t.sprintId && activeSprintIds.includes(t.sprintId)) return true;
      if (t.storyId && openStoryIds.has(t.storyId)) return true;
      return false;
    })
    // NEW: Skip locked tasks (prevent rescheduling manual placements)
    .filter((t) => {
      if (t.orchestrationLocked === true) {
        console.log(`[Replan] Skipping locked task: ${t.id} (reason: ${t.orchestrationLockedReason})`);
        return false;
      }
      return true;
    });

  const scoredStories = openStories.map((story) => ({
    ...story,
    aiScore: scoreWithBonus(story.priority, story.aiCriticalityScore),
  }));
  const storyMap = new Map(scoredStories.map((story) => [story.id, story]));
  const scoredTasks = openTasks.map((task) => ({
    ...task,
    aiScore: scoreWithBonus(task.priority, task.aiCriticalityScore),
  }));

  const storyQueue = ['personal', 'work']
    .flatMap((persona) => {
      const personaStories = scoredStories.filter((story) => resolvePersona(story.persona) === persona);
      return sortPlannerCandidates(personaStories, {
        rankKey: 'aiFocusStoryRank',
        isTopFn: isTopStory,
        extraPriorityFn: (story) => storyForcesTop3Tasks(story),
      });
    });

  const taskQueue = ['personal', 'work']
    .flatMap((persona) => {
      const personaTasks = scoredTasks.filter((task) => resolvePersona(task.persona) === persona);
      return sortPlannerCandidates(personaTasks, {
        rankKey: 'aiPriorityRank',
        isTopFn: isTopTask,
        extraPriorityFn: (task) => {
          const parentStory = task?.storyId ? storyMap.get(task.storyId) : null;
          return storyForcesTop3Tasks(parentStory);
        },
      });
    });

  const placementQueue = buildUnifiedPlacementQueue({
    stories: storyQueue,
    tasks: taskQueue,
    isTopStory,
    isTopTask,
    storyMap,
  });

  const candidateIds = new Set([
    ...storyQueue.map((story) => getEntityKey('story', story.id)),
    ...taskQueue.map((task) => getEntityKey('task', task.id)),
  ]);

  // NEW: Check user setting for chore scheduling
  const scheduleChoresEnabled = profile?.scheduleChoresEnabled !== false;

  // Fetch chores/routines to include in valid occurrences
  const choresRoutines = tasksSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((t) => !isTaskDoneStatus(t.status))
    .filter((t) => isRoutineChoreHabit(t))
    // NEW: Skip if chore scheduling is disabled in user settings
    .filter((t) => {
      if (!scheduleChoresEnabled) {
        console.log(`[Replan] Skipping chore scheduling (disabled): ${t.id}`);
        return false;
      }
      // Also respect orchestration lock for chores
      if (t.orchestrationLocked === true) {
        console.log(`[Replan] Skipping locked chore: ${t.id}`);
        return false;
      }
      return true;
    });

  // Build list of current valid occurrences for calendar validation
  const currentOccurrences = [
    ...storyQueue.map((s) => ({ ...s, sourceType: 'story', sourceId: s.id })),
    ...taskQueue.map((t) => ({ ...t, sourceType: 'task', sourceId: t.id })),
    ...choresRoutines.map((c) => ({ ...c, sourceType: c.type || 'chore', sourceId: c.id })),
  ];

  // Clear stale calendar instances before scheduling new ones
  console.log(`[Replan] Clearing stale calendar instances... (scheduleChoresEnabled=${scheduleChoresEnabled})`);
  await clearStaleCalendarInstances(db, uid, windowStart, windowEnd, currentOccurrences);

  // Helpers for classifying blocks by mode
  const isAiPlannerBlock = (block) =>
    block.aiGenerated === true || block.createdBy === 'ai' ||
    block.source === 'theme_allocation' ||
    block.sourceType === 'health_allocation' ||
    block.sourceType === 'work_shift_allocation';

  const isUserGcalEvent = (block) => {
    const src = String(block.source || block.sourceType || '').toLowerCase();
    return src === 'gcal' || src === 'google_calendar' || block.createdBy === 'google';
  };

  const isFitnessBlock = (block) => {
    const label = String(block.theme || block.category || block.title || '').toLowerCase();
    return label.includes('health') || label.includes('fitness') || label.includes('gym') ||
      label.includes('workout') || label.includes('exercise') || label.includes('run') ||
      label.includes('swim') || label.includes('cycle') || label.includes('sport');
  };

  // A block that MUST be treated as busy regardless of mode
  const isHardBusy = (block) =>
    isUserGcalEvent(block) || isMainGigBlock(block) || isFitnessBlock(block);

  // Build busy map and prune AI entries
  const remainingBlocks = [];
  let replaced = 0;

  for (const block of existingBlocks) {
    const isAi = isAiPlannerBlock(block);
    const key = block.storyId ? getEntityKey('story', block.storyId) : block.taskId ? getEntityKey('task', block.taskId) : null;

    if (planningMode === 'smart') {
      // Smart mode: wipe ALL AI-created planner blocks — we replan everything fresh.
      // Hard events (user GCal, work, fitness) are kept and treated as immovable.
      if (isAi) {
        await db.collection('calendar_blocks').doc(block.id).delete().catch(() => { });
        replaced += 1;
      } else {
        remainingBlocks.push(block);
      }
    } else {
      // Strict mode: only remove AI blocks whose linked entity is no longer a candidate
      if (isAi && key && !candidateIds.has(key)) {
        await db.collection('calendar_blocks').doc(block.id).delete().catch(() => { });
        replaced += 1;
      } else {
        remainingBlocks.push(block);
      }
    }
  }

  // Materialize fitness/work theme blocks AFTER wiping stale AI blocks so they are always
  // recreated fresh and never skipped by the key-dedup check.
  await materializePlannerThemeBlocks({
    db,
    userId: uid,
    windowStart,
    windowEnd,
    themeAllocations,
    existingBlocks: remainingBlocks,
    fitnessBlocksAutoCreate,
  });

  const scheduledMinutesByEntity = collectScheduledMinutesByEntity(remainingBlocks);

  const busyPersonal = [];
  const busyWork = [];
  const mainGigBlocks = []; // Track main gig planner blocks separately
  const addBusyPersonal = (start, end) => {
    if (start && end) busyPersonal.push({ start, end });
  };
  const addBusyWork = (start, end) => {
    if (start && end) busyWork.push({ start, end });
  };

  remainingBlocks.forEach((b) => {
    // In smart mode only hard-busy blocks (user GCal / work / fitness) block time.
    // In strict mode every remaining block blocks time.
    if (planningMode === 'smart' && !isHardBusy(b)) return;

    if (isMainGigBlock(b)) {
      mainGigBlocks.push({ start: b.start, end: b.end, theme: b.theme || b.category || '' });
      addBusyPersonal(b.start, b.end);
    } else {
      addBusyPersonal(b.start, b.end);
      addBusyWork(b.start, b.end);
    }
  });

  const { pickSlots } = buildPickSlots(themeAllocations);

  /**
   * Schedule a candidate greedily across multiple free slots/days until the
   * total remaining time is covered.  Blocks fill all available free time in
   * each slot (no hard per-block cap), split across as many days as needed.
   */
  const placeEntry = async (candidate, kind) => {
    const sprint = candidate.sprintId ? sprintMap.get(candidate.sprintId) : null;
    const sprintStart = sprint?.start ? toMillis(sprint.start) : null;
    const sprintEnd = sprint?.end ? toMillis(sprint.end) : null;
    const isWorkPersona = String(candidate?.persona || '').toLowerCase() === 'work';
    const busyList = isWorkPersona ? busyWork : busyPersonal;

    const totalNeededMs = estimateRequiredMinutes(candidate, kind) * 60000;
    const entityKey = getEntityKey(kind, candidate.id);
    const alreadyScheduledMs = (scheduledMinutesByEntity.get(entityKey) || 0) * 60000;
    let stillNeededMs = totalNeededMs - alreadyScheduledMs;
    if (stillNeededMs <= 0) return { created: 0, blocked: 0 };

      // Skip low-scored items — only schedule if Top 3, critical priority, or score >= 40
      const rawScore = Number(candidate?.aiCriticalityScore || 0);
      const isCriticalPriority = Number(candidate?.priority || 0) >= 4;
      const isTop = candidate?.aiTop3ForDay === true;
      if (rawScore > 0 && rawScore < 40 && !isCriticalPriority && !isTop) {
        return { created: 0, blocked: 0 };
      }

    const MIN_BLOCK_MS = 30 * 60000; // 30-minute minimum useful block
    const title = candidate.title;
    const basePayload = {
      ownerUid: uid,
      title,
      entityType: kind,
      taskId: kind === 'task' ? candidate.id : null,
      storyId: kind === 'story' ? candidate.id : null,
      sprintId: candidate.sprintId || null,
      theme: candidate.theme || null,
      goalId: candidate.goalId || null,
      status: 'planned',
      aiGenerated: true,
      aiScore: candidate.aiScore || null,
      aiReason: candidate.aiCriticalityReason || null,
      placementReason: 'Replan: greedy fill for remaining work',
      deepLink: buildEntityUrl(kind === 'story' ? 'story' : 'task', candidate.id, candidate.ref || null),
      persona: candidate.persona || (isWorkPersona ? 'work' : 'personal'),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    let created = 0;

    if (isWorkPersona) {
      if (!mainGigBlocks.length) return { created: 0, blocked: 1 };
      const sortedMainGig = mainGigBlocks.filter((mg) => mg.start && mg.end).sort((a, b) => a.start - b.start);
      for (const mg of sortedMainGig) {
        if (stillNeededMs <= 0) break;
        if (sprintStart && mg.end < sprintStart) continue;
        if (sprintEnd && mg.start > sprintEnd) continue;
        const gaps = findFreeGapsInSlot(mg.start, mg.end, busyList, MIN_BLOCK_MS);
        for (const gap of gaps) {
          if (stillNeededMs <= 0) break;
          const blockMs = Math.min(gap.end - gap.start, stillNeededMs);
          if (blockMs < MIN_BLOCK_MS) continue;
          const blockRef = db.collection('calendar_blocks').doc();
          const payload = { ...basePayload, start: gap.start, end: gap.start + blockMs };
          await blockRef.set(payload);
          busyPersonal.push({ start: payload.start, end: payload.end });
          busyWork.push({ start: payload.start, end: payload.end });
          const minutesAdded = Math.round(blockMs / 60000);
          addScheduledMinutes(scheduledMinutesByEntity, kind, candidate.id, minutesAdded);
          stillNeededMs -= blockMs;
          created++;
        }
      }
      return { created, blocked: stillNeededMs > MIN_BLOCK_MS ? 1 : 0 };
    }

    for (let offset = 0; offset < planningDays && stillNeededMs > MIN_BLOCK_MS; offset++) {
      const day = windowStart.plus({ days: offset });
      const dayStartMs = day.toMillis();
      const dayEndMs = day.endOf('day').toMillis();
      if ((sprintStart && dayEndMs < sprintStart) || (sprintEnd && dayStartMs > sprintEnd)) continue;

      const allSlots = pickSlots(candidate.theme || candidate.goal || null, day);
      const slots = filterSlotsByTimeOfDay(allSlots, candidate.timeOfDay || null);
      for (const slot of slots) {
        if (stillNeededMs <= 0) break;
        if (isMainGigLabel(slot.label)) continue;
        const slotDays = slot.days || [1, 2, 3, 4, 5, 6, 7];
        if (!slotDays.includes(day.weekday)) continue;
        const slotStart = day.set({ hour: Math.floor(slot.start), minute: Math.round((slot.start % 1) * 60), second: 0, millisecond: 0 });
        const slotEnd = day.set({ hour: Math.floor(slot.end), minute: Math.round((slot.end % 1) * 60), second: 0, millisecond: 0 });
        if (sprintStart && slotEnd.toMillis() < sprintStart) continue;
        if (sprintEnd && slotStart.toMillis() > sprintEnd) continue;

        const gaps = findFreeGapsInSlot(slotStart.toMillis(), slotEnd.toMillis(), busyList, MIN_BLOCK_MS);
        for (const gap of gaps) {
          if (stillNeededMs <= 0) break;
          // Never place in main gig overlap
          if (mainGigBlocks.some((mg) => mg.end > gap.start && mg.start < gap.start + Math.min(gap.end - gap.start, stillNeededMs))) continue;
          const blockMs = Math.min(gap.end - gap.start, stillNeededMs);
          if (blockMs < MIN_BLOCK_MS) continue;
          const blockRef = db.collection('calendar_blocks').doc();
          const payload = { ...basePayload, start: gap.start, end: gap.start + blockMs };
          await blockRef.set(payload);
          busyPersonal.push({ start: payload.start, end: payload.end });
          busyWork.push({ start: payload.start, end: payload.end });
          const minutesAdded = Math.round(blockMs / 60000);
          addScheduledMinutes(scheduledMinutesByEntity, kind, candidate.id, minutesAdded);
          stillNeededMs -= blockMs;
          created++;
        }
      }
    }
    return { created, blocked: stillNeededMs > MIN_BLOCK_MS ? 1 : 0 };
  };

  let created = 0;
  let blocked = 0;
  let gcalLinks = [];

  for (const entry of placementQueue) {
    const { kind, candidate } = entry;
    const entityKey = getEntityKey(kind, candidate?.id);
    const totalNeededMs = estimateRequiredMinutes(candidate, kind) * 60000;
    const alreadyMs = (scheduledMinutesByEntity.get(entityKey) || 0) * 60000;
    if (alreadyMs >= totalNeededMs) continue; // fully covered already
    const res = await placeEntry(candidate, kind);
    created += res.created || 0;
    blocked += res.blocked || 0;
  }

  const coverage = buildPlannerCoverageSummary({
    stories: storyQueue,
    tasks: taskQueue,
    scheduledMinutesByEntity,
  });

  const result = {
    created,
    blocked,
    rescheduled: 0,
    replaced,
    gcalLinks,
    ...coverage,
  };

  await writePlannerStats({
    db,
    userId: uid,
    source: 'replan',
    windowStart,
    windowEnd,
    result,
    coverage,
  });

  // PHASE 1: Wire scheduled_instances (NEW MODEL)
  // In future, this will be populated by planSchedule() from scheduler/engine.js
  // For now, we're demonstrating the bridge for calendar_blocks → scheduled_instances
  try {
    const tasksByStory = await groupTasksByStory(db, uid);
    
    // Convert calendar_blocks to scheduled_instances
    const blocksSnap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', uid)
      .where('start', '>=', windowStart.toMillis())
      .where('start', '<=', windowEnd.toMillis())
      .get()
      .catch(() => ({ docs: [] }));

    const scheduledInstances = blocksSnap.docs.map(doc => {
      const block = doc.data();
      return {
        id: `scheduled-${doc.id}`,
        ownerUid: uid,
        sourceType: block.entityType || 'story',
        sourceId: block.taskId || block.storyId,
        title: block.title,
        blockId: block.blockId,
        theme: block.theme,
        plannedStart: new Date(block.start).toISOString(),
        plannedEnd: new Date(block.end).toISOString(),
        status: 'planned',
        deepLink: block.deepLink,
      };
    });

    const syncResult = await writeScheduledInstances(db, uid, scheduledInstances, {
      source: 'replan_calendar',
      sprint: { id: null },
    });

    // Write back actual scheduled times to source docs (tasks, stories, chores)
    const sourceTimesResult = await writeScheduledTimesToSources(db, uid, scheduledInstances);

    // Check day capacity warnings for planner alerts
    const planningDate = new Date();
    const capacityWarning = await getDayCapacityWarnings(db, uid, planningDate);
    
    if (capacityWarning.hasWarning) {
      console.log(`[replanCalendarNow] Capacity warning for ${uid} on ${capacityWarning.date}:`, capacityWarning);
      // Store warning for UI to display
      await db.collection('users').doc(uid).collection('planner_alerts').doc('capacity-warning').set({
        type: 'capacity',
        date: capacityWarning.date,
        shortfall: capacityWarning.shortfall,
        utilizationPercent: capacityWarning.utilizationPercent,
        blocks: capacityWarning.overCapacityBlocks,
        message: capacityWarning.recommendation,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // Update planner_stats
    await updatePlannerStats(db, uid, result);

    console.log(`[replanCalendarNow] Synced: ${syncResult.written} scheduled_instances, ${sourceTimesResult.updated} source times updated`);
  } catch (error) {
    console.warn('[replanCalendarNow] Sync to scheduled_instances failed:', error?.message);
  }

  return {
    ok: true,
    ...result,
  };
});

// Manual trigger to run the nightly chain (pointing → conversions → scoring+Top3 → calendar)
exports.runNightlyChainNow = onCall({
  timeZone: 'Europe/London',
  memory: '1GiB',
  timeoutSeconds: 540,
  secrets: [BOB_CLI_ACCESS],
  region: 'europe-west2',
  invoker: 'public',
}, async (req) => {
  const cliKey = BOB_CLI_ACCESS.value();
  const key = req.rawRequest?.get('x-api-key') || req.rawRequest?.query?.key;
  if (cliKey && key && key !== cliKey) {
    throw new https.HttpsError('permission-denied', 'unauthorized');
  }
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

// HTTP variant removed to keep callable signature stable
exports.runNightlyChainNowHttp = https.onRequest({
  timeZone: 'Europe/London',
  memory: '1GiB',
  timeoutSeconds: 540,
  secrets: [BOB_CLI_ACCESS],
  region: 'europe-west2',
}, async (req, res) => {
  const cliKey = BOB_CLI_ACCESS.value();
  const key = req.get('x-api-key') || req.query.key;
  if (cliKey && key && key !== cliKey) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const result = await exports.runNightlyChainNow({ rawRequest: req });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

exports.seedNextWeekPlannerOverridesWeekly = onSchedule({
  schedule: '0 18 * * 0',
  timeZone: 'Europe/London',
  region: 'europe-west2',
  memory: '256MiB',
  timeoutSeconds: 180,
}, async () => {
  const result = await seedPlannerWeekForAllUsers();
  console.log('[planner-seed-weekly]', JSON.stringify({
    total: result.total,
    seeded: result.seeded,
    skipped: result.skipped,
    errors: result.errors,
  }));
  return result;
});

exports.seedNextWeekPlannerOverridesNow = onCall({
  timeZone: 'Europe/London',
  memory: '256MiB',
  timeoutSeconds: 120,
  region: 'europe-west2',
  invoker: 'public',
}, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new https.HttpsError('unauthenticated', 'Sign in required');
  const targetWeekKey = String(req?.data?.targetWeekKey || '').trim() || null;
  const force = req?.data?.force === true;
  const db = ensureFirestore();
  const result = await seedPlannerWeekForUser({
    db,
    userId: uid,
    targetWeekKey,
    force,
  });
  return { ok: true, ...result };
});

// ===== Delta re-prioritization callable =====
// Lightweight function to rescore a single entity and rerun top3 selection
// Called from the frontend when user changes due date, priority, sprint, or status
exports.deltaPriorityRescore = onCall({
  memory: '256MiB',
  region: 'europe-west2',
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new https.HttpsError('unauthenticated', 'Login required');
  const { entityId, entityType } = request.data || {};
  if (!entityId || !entityType) throw new https.HttpsError('invalid-argument', 'entityId and entityType required');
  if (!['task', 'story'].includes(entityType)) throw new https.HttpsError('invalid-argument', 'entityType must be task or story');

  const db = ensureFirestore();
  const collectionName = entityType === 'task' ? 'tasks' : 'stories';
  const entityDoc = await db.collection(collectionName).doc(entityId).get();
  if (!entityDoc.exists) return { ok: false, reason: 'not_found' };
  const entity = entityDoc.data();
  if (entity.ownerUid !== uid) throw new https.HttpsError('permission-denied', 'Not your entity');

  const persona = String(entity.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';

  // Check if entity should be scored at all
  const statusRaw = entity.status;
  const isDoneTask = entityType === 'task' && isTaskDoneStatus(statusRaw);
  const isDoneStory = entityType === 'story' && isStoryDoneStatus(statusRaw);
  const isDeleted = !!entity.deleted;
  const isChore = isRoutineChoreHabit(entity) || hasRecurrence(entity);

  if (isDoneTask || isDoneStory || isDeleted || (entityType === 'task' && isChore)) {
    // Clear priority fields for this entity
    const tags = Array.isArray(entity.tags) ? entity.tags : [];
    const patch = {
      aiCriticalityScore: admin.firestore.FieldValue.delete(),
      aiCriticalityReason: admin.firestore.FieldValue.delete(),
      aiPriorityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      aiFlaggedTop: false,
      aiPriorityRank: admin.firestore.FieldValue.delete(),
      aiTop3ForDay: false,
      aiTop3Date: admin.firestore.FieldValue.delete(),
      aiTop3Reason: admin.firestore.FieldValue.delete(),
      userPriorityFlag: false,
      userPriorityFlagAt: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncState: 'dirty',
    };
    const cleanedTags = stripTop3Tags(tags);
    if (cleanedTags.length !== tags.length) {
      patch.tags = cleanedTags;
    }
    await entityDoc.ref.set(patch, { merge: true });
    // Rerun top3 for persona since we may have removed from top3
    await _deltaTop3ForPersona(db, uid, persona);
    return { ok: true, action: 'cleared', persona };
  }

  // Compute score
  const dueMs = toDateTime(entity.dueDate || entity.targetDate, { defaultValue: null })?.toMillis() || null;
  const createdMs = toDateTime(entity.createdAt || entity.serverCreatedAt, { defaultValue: null })?.toMillis() || null;
  const goalId = entity.goalId || (entityType === 'task' && entity.storyId ? (await db.collection('stories').doc(entity.storyId).get().then(s => s.data()?.goalId || null).catch(() => null)) : null);
  const goal = goalId ? await db.collection('goals').doc(goalId).get().then(g => g.exists ? g.data() : null).catch(() => null) : null;
  const goalDueMs = goal ? (toDateTime(goal.dueDate || goal.targetDate, { defaultValue: null })?.toMillis() || null) : null;

  // Resolve theme
  const themeValue = entity.theme ?? entity.themeId ?? entity.theme_id ?? goal?.theme ?? null;
  const effectiveTheme = normalizeTheme(themeValue);

  // Get active sprint IDs
  const sprintSnap = await db.collection('sprints').where('ownerUid', '==', uid).where('status', 'in', ['active', 1, '1']).limit(10).get();
  const activeSprintIds = new Set(sprintSnap.docs.map(d => d.id));

  // Priority boost
  const { boost: priorityBoost, label: priorityLabel } = priorityBoostFor(normalizeUserPriority(entity.userPriority || entity.priority || entity.priorityLabel));

  let bonus = 0;
  const bonusReasons = [];
  const isEntityActiveSprint = entity.sprintId && activeSprintIds.has(entity.sprintId);
  if (isEntityActiveSprint) {
    bonus += 10;
    bonusReasons.push('Active sprint');
  }
  if (priorityBoost > 0 && priorityLabel) {
    bonus += priorityBoost;
    bonusReasons.push(`User priority: ${priorityLabel}`);
  }

  const isHobbyTheme = effectiveTheme && String(effectiveTheme).toLowerCase().includes('hobb');

  // User #1 priority flag gives massive boost
  if (entity.userPriorityFlag === true) {
    bonus += 1000;
    bonusReasons.push('User #1 priority flag');
  }

  if (entityType === 'task' && !entity.storyId) {
    const ageDays = createdMs ? (Date.now() - createdMs) / 86400000 : 0;
    if (ageDays >= 90) {
      bonus += 15;
      bonusReasons.push('Aged > 90 days and unlinked');
    }
  }
  if (isHobbyTheme) {
    bonus -= 25;
    bonusReasons.push('Hobbies downweighted');
  }

  const baseScore = computeCriticalityScore({ dueDateMs: dueMs, createdAtMs: createdMs, goalDueMs, theme: effectiveTheme, points: entity.points, taskType: entity.type || entityType });
  let score = Math.min(99, baseScore + bonus);
  if (isHobbyTheme) score = Math.min(score, 45);

  const reason = buildCriticalityReason({ dueDateMs: dueMs, goalDueMs, theme: effectiveTheme, points: entity.points })
    + (bonusReasons.length ? ' · ' + bonusReasons.join(' · ') : '');

  const patch = {
    aiCriticalityScore: score,
    aiCriticalityReason: reason,
    aiPriorityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    syncState: 'dirty',
  };
  await entityDoc.ref.set(patch, { merge: true });

  // Rerun top3 selection for this persona
  await _deltaTop3ForPersona(db, uid, persona);

  return { ok: true, action: 'rescored', score, reason, persona };
});

// Helper: recompute top3 for a single persona after a delta change
async function _deltaTop3ForPersona(db, userId, persona) {
  const nowLocal = DateTime.now();
  const todayIso = nowLocal.toISODate();
  const todayEnd = nowLocal.endOf('day').toMillis();
  const tomorrowEnd = nowLocal.plus({ days: 1 }).endOf('day').toMillis();
  const focusDueDate = (nowLocal.hour >= 17) ? tomorrowEnd : todayEnd;

  const [taskSnap, storySnap] = await Promise.all([
    db.collection('tasks')
      .where('ownerUid', '==', userId)
      .limit(1000)
      .get()
      .catch(() => ({ docs: [] })),
    db.collection('stories')
      .where('ownerUid', '==', userId)
      .limit(1000)
      .get()
      .catch(() => ({ docs: [] })),
  ]);

  const taskCandidates = [];
  for (const doc of taskSnap.docs) {
    const data = doc.data() || {};
    const score = Number(data.aiCriticalityScore || 0);
    if (!(score > 0)) continue;
    if (resolvePersona(data.persona) !== persona) continue;
    if (data.deleted || isRoutineChoreHabit(data) || hasRecurrence(data)) continue;
    if (isTaskDoneStatus(data.status)) continue;
    const createdMs = toDateTime(data.createdAt || data.serverCreatedAt, { defaultValue: null })?.toMillis() || null;
    taskCandidates.push({ id: doc.id, score, data, createdMs, refObj: doc.ref });
  }

  const storyCandidates = [];
  for (const doc of storySnap.docs) {
    const data = doc.data() || {};
    const score = Number(data.aiCriticalityScore || 0);
    if (!(score > 0)) continue;
    if (resolvePersona(data.persona) !== persona) continue;
    if (isStoryDoneStatus(data.status)) continue;
    const createdMs = toDateTime(data.createdAt || data.serverCreatedAt, { defaultValue: null })?.toMillis() || null;
    storyCandidates.push({ id: doc.id, score, data, createdMs, refObj: doc.ref });
  }

  const storyMap = new Map(storyCandidates.map((story) => [story.id, story]));
  const topStories = selectTopStoriesFresh(storyCandidates);
  const topTasks = selectTopTasksFresh(taskCandidates, storyMap);
  const topTaskIds = new Set(topTasks.map((task) => task.id));
  const topStoryIds = new Set(topStories.map((story) => story.id));

  const promoteTaskBatch = db.batch();
  topTasks.forEach((task, idx) => {
    const reason = ['Top 3 priority', `score=${Math.round(task.score || 0)}`].filter(Boolean).join(' | ');
    const patch = {
      aiFlaggedTop: true,
      aiPriorityRank: idx + 1,
      aiTop3ForDay: true,
      aiTop3Date: todayIso,
      aiTop3Reason: reason,
      aiCriticalityScore: 100,
      tags: withTop3Tag(task.data.tags),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncState: 'dirty',
    };
    if (!isTaskLocked(task.data)) {
      patch.dueDate = focusDueDate;
      patch.aiDueDateSetAt = admin.firestore.FieldValue.serverTimestamp();
      patch.dueDateReason = reason;
    }
    promoteTaskBatch.set(task.refObj, patch, { merge: true });
  });
  if (topTasks.length > 0) await promoteTaskBatch.commit();

  const demoteTaskMap = await collectTaskTop3CandidateDocs(db, userId, 200);
  const demoteTaskWriter = db.bulkWriter();
  demoteTaskMap.forEach((doc) => {
    if (topTaskIds.has(doc.id)) return;
    const data = doc.data() || {};
    if (resolvePersona(data.persona) !== persona) return;
    const cleanedTags = stripTop3Tags(data.tags);
    const patch = {
      aiFlaggedTop: false,
      aiPriorityRank: admin.firestore.FieldValue.delete(),
      aiTop3ForDay: false,
      aiTop3Date: admin.firestore.FieldValue.delete(),
      aiTop3Reason: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncState: 'dirty',
    };
    if (Array.isArray(data.tags) && cleanedTags.length !== data.tags.length) {
      patch.tags = cleanedTags;
    }
    demoteTaskWriter.set(doc.ref, patch, { merge: true });
  });
  await demoteTaskWriter.close();

  const promoteStoryBatch = db.batch();
  topStories.forEach((story, idx) => {
    const reason = ['Top 3 priority', `score=${Math.round(story.score || 0)}`].filter(Boolean).join(' | ');
    const patch = {
      aiFocusStoryRank: idx + 1,
      aiFocusStoryAt: admin.firestore.FieldValue.serverTimestamp(),
      aiTop3ForDay: true,
      aiTop3Date: todayIso,
      aiTop3Reason: reason,
      aiCriticalityScore: 100,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncState: 'dirty',
    };
    if (focusDueDate && !isStoryLocked(story.data)) {
      patch.dueDate = focusDueDate;
      patch.aiDueDateSetAt = admin.firestore.FieldValue.serverTimestamp();
      patch.dueDateReason = reason;
    }
    promoteStoryBatch.set(story.refObj, patch, { merge: true });
  });
  if (topStories.length > 0) await promoteStoryBatch.commit();

  const demoteStoryMap = await collectStoryTop3CandidateDocs(db, userId, 200);
  const demoteStoryWriter = db.bulkWriter();
  demoteStoryMap.forEach((doc) => {
    if (topStoryIds.has(doc.id)) return;
    const data = doc.data() || {};
    if (resolvePersona(data.persona) !== persona) return;
    const cleanedTags = stripTop3Tags(data.tags);
    const patch = {
      aiFocusStoryRank: admin.firestore.FieldValue.delete(),
      aiFocusStoryAt: admin.firestore.FieldValue.delete(),
      aiTop3ForDay: false,
      aiTop3Date: admin.firestore.FieldValue.delete(),
      aiTop3Reason: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncState: 'dirty',
    };
    if (Array.isArray(data.tags) && cleanedTags.length !== data.tags.length) {
      patch.tags = cleanedTags;
    }
    demoteStoryWriter.set(doc.ref, patch, { merge: true });
  });
  await demoteStoryWriter.close();
}

// Internal job exports to enable manual orchestration/testing without scheduler
exports._runAutoPointingJob = runAutoPointingJob;
exports._runAutoConversionsJob = runAutoConversionsJob;
exports._runPriorityScoringJob = runPriorityScoringJob;
exports._runCalendarPlannerJob = runCalendarPlannerJob;
exports._replanExistingBlocksForUser = replanExistingBlocksForUser;
exports._deltaTop3ForPersona = _deltaTop3ForPersona;
