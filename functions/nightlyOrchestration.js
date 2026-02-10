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

const buildPickSlots = (themeAllocations) => {
  const getUserSlots = (themeLabel, day) => {
    const matches = (Array.isArray(themeAllocations) ? themeAllocations : []).filter((a) => {
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

const hasOverlap = (candidate, existing) => {
  const cand = Interval.fromDateTimes(candidate.start, candidate.end);
  return existing.some((block) => {
    const s = toDateTime(block.start, { defaultValue: null });
    const e = toDateTime(block.end, { defaultValue: null });
    if (!s || !e) return false;
    return cand.overlaps(Interval.fromDateTimes(s, e));
  });
};

// ===== Helpers
const PRIORITY_TEXT_MODEL = 'gemini-1.5-flash';

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
  if (Array.isArray(entity.acceptanceCriteria)) {
    return entity.acceptanceCriteria.filter(Boolean).map((c) => trimText(c, 140)).slice(0, LLM_PRIORITY_MAX_CRITERIA);
  }
  if (typeof entity.acceptanceCriteria === 'string') {
    return entity.acceptanceCriteria
      .split('\n')
      .map((line) => trimText(line, 140))
      .filter(Boolean)
      .slice(0, LLM_PRIORITY_MAX_CRITERIA);
  }
  return [];
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
  if (num != null) return num === 2;
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

async function materializePlannerThemeBlocks({
  db,
  userId,
  windowStart,
  windowEnd,
  themeAllocations,
  existingBlocks,
}) {
  const results = { created: 0, skipped: 0, total: 0 };
  const allocations = Array.isArray(themeAllocations) ? themeAllocations : [];
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
  const healthAllocations = allocations.filter((alloc) => {
    const themeName = String(alloc?.theme || '').toLowerCase();
    const subTheme = String(alloc?.subTheme || '').trim();
    return themeName.includes('health') && subTheme;
  });
  const workShiftAllocations = allocations.filter((alloc) => {
    return isWorkShiftTheme(alloc?.theme) || isWorkShiftTheme(alloc?.subTheme);
  });

  if (!healthAllocations.length && !workShiftAllocations.length) return results;

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
    if (hasOverlap({ start, end }, existingBlocks)) {
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
    for (const alloc of healthAllocations) {
      await processAllocation(alloc, 'health', day, dayKey);
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
      if (allocDoc.exists) allocations = allocDoc.data()?.allocations || [];
    } catch {
      allocations = [];
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
      const statusStr = String(statusRaw || '').toLowerCase();
      const isDone = statusStr === 'done' || statusStr === 'completed' || statusStr === 'complete' || Number(statusRaw) >= 2;
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
      const statusStr = String(statusRaw || '').toLowerCase();
      const isDone = statusStr === 'done' || statusStr === 'completed' || statusStr === 'complete' || Number(statusRaw) >= 4;
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
      const statusStr = String(statusRaw || '').toLowerCase();
      const isDone = statusStr === 'done' || statusStr === 'completed' || statusStr === 'complete' || Number(statusRaw) >= 2;
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
      const statusStr = String(statusRaw || '').toLowerCase();
      const isDone = statusStr === 'done' || statusStr === 'completed' || statusStr === 'complete' || Number(statusRaw) >= 4;
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

    const sortByScore = (a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return (a.createdMs || 0) - (b.createdMs || 0);
    };

    const pickTop = (items, { rankKey, flagKey }) => {
      const prev = items.filter((it) => {
        const rank = Number(it.data?.[rankKey] || 0);
        if (rank > 0) return true;
        if (flagKey && it.data?.[flagKey] === true) return true;
        return it.data?.aiTop3ForDay === true;
      });
      const prevSorted = prev
        .slice()
        .sort((a, b) => {
          const ar = Number(a.data?.[rankKey] || 0);
          const br = Number(b.data?.[rankKey] || 0);
          if (ar && br && ar !== br) return ar - br;
          return (a.createdMs || 0) - (b.createdMs || 0);
        });
      const prevIds = new Set(prevSorted.map((p) => p.id));
      const remaining = items.filter((it) => !prevIds.has(it.id)).sort(sortByScore);
      return [...prevSorted, ...remaining].slice(0, 3);
    };

    const topTaskIdsByPersona = { personal: new Set(), work: new Set() };
    const topStoryIdsByPersona = { personal: new Set(), work: new Set() };

    for (const persona of ['personal', 'work']) {
      const personaTasks = taskCandidates.filter((t) => t.persona === persona);
      const personaStories = storyCandidates.filter((s) => s.persona === persona);

      const focusTasks = pickTop(personaTasks, { rankKey: 'aiPriorityRank', flagKey: 'aiFlaggedTop' });
      const focusStories = pickTop(personaStories, { rankKey: 'aiFocusStoryRank' });

      topTaskIdsByPersona[persona] = new Set(focusTasks.map((t) => t.id));
      topStoryIdsByPersona[persona] = new Set(focusStories.map((s) => s.id));

      const taskBatch = db.batch();
      focusTasks.forEach((task, idx) => {
        const tags = Array.isArray(task.data?.tags) ? [...task.data.tags] : [];
        if (!tags.includes('Top3')) tags.push('Top3');
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
    const flaggedSnaps = await Promise.all([
      db.collection('tasks')
        .where('ownerUid', '==', userId)
        .where('aiFlaggedTop', '==', true)
        .limit(500)
        .get()
        .catch(() => ({ docs: [] })),
      db.collection('tasks')
        .where('ownerUid', '==', userId)
        .where('aiTop3ForDay', '==', true)
        .limit(500)
        .get()
        .catch(() => ({ docs: [] })),
      db.collection('tasks')
        .where('ownerUid', '==', userId)
        .where('aiPriorityRank', '>', 0)
        .limit(500)
        .get()
        .catch(() => ({ docs: [] })),
    ]);
    const flaggedMap = new Map();
    flaggedSnaps.forEach((snap) => {
      (snap?.docs || []).forEach((doc) => {
        if (!flaggedMap.has(doc.id)) flaggedMap.set(doc.id, doc);
      });
    });
    const clearTasksBatch = db.batch();
    flaggedMap.forEach((doc) => {
      const data = doc.data() || {};
      const persona = String(data.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';
      if (!topTaskIdsByPersona[persona].has(doc.id)) {
        clearTasksBatch.set(doc.ref, {
          aiFlaggedTop: false,
          aiPriorityRank: admin.firestore.FieldValue.delete(),
          aiTop3ForDay: false,
          aiTop3Date: admin.firestore.FieldValue.delete(),
          aiPriorityLabel: admin.firestore.FieldValue.delete(),
          aiTop3Reason: admin.firestore.FieldValue.delete(),
          aiPriorityReason: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          syncState: 'dirty',
        }, { merge: true });
      }
    });
    await clearTasksBatch.commit();

    // Clear/update story focus ranks and ensure non-top stories use sprint end date
    const storyClearBatch = db.batch();
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
        if (sprintEnd && !isStoryLocked(data)) {
          patch.dueDate = sprintEnd;
        }
      }
      if (Object.keys(patch).length) {
        patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        patch.syncState = 'dirty';
        storyClearBatch.set(doc.ref, patch, { merge: true });
      }
    });
    await storyClearBatch.commit();
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

  for (const prof of profiles.docs) {
    const userId = prof.id;
    const profile = prof.data() || {};
    const zone = resolveTimezone(profile, 'Europe/London');
    const nowLocal = now.setZone(coerceZone(zone));
    const windowStart = nowLocal.startOf('day');
    const windowEnd = windowStart.plus({ days: 7 }).endOf('day');

    // User-defined weekly theme blocks
    let themeAllocations = [];
    try {
      const allocDoc = await db.collection('theme_allocations').doc(userId).get();
      if (allocDoc.exists) themeAllocations = allocDoc.data()?.allocations || [];
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

    const plannerBlockResult = await materializePlannerThemeBlocks({
      db,
      userId,
      windowStart,
      windowEnd,
      themeAllocations,
      existingBlocks,
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
      .filter((s) => !isStoryDoneStatus(s.status));

    const openTasks = tasksSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((t) => !isTaskDoneStatus(t.status) && !t.deleted);

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

    const selectTop = (items, rankKey, filterFn) => {
      const flagged = items.filter(filterFn);
      const base = flagged.length ? flagged : items;
      return base.slice().sort((a, b) => rankSort(a, b, rankKey)).slice(0, 3);
    };

    const topStories = ['personal', 'work']
      .flatMap((persona) => {
        const personaStories = openStories.filter((s) => resolvePersona(s.persona) === persona);
        return selectTop(personaStories, 'aiFocusStoryRank', isTopStory);
      });

    const topTasks = ['personal', 'work']
      .flatMap((persona) => {
        const personaTasks = openTasks.filter((t) => resolvePersona(t.persona) === persona);
        return selectTop(personaTasks, 'aiPriorityRank', isTopTask);
      });

    const topIds = new Set([
      ...topStories.map((s) => `story:${s.id}`),
      ...topTasks.map((t) => `task:${t.id}`),
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
      if (isAi && !isPlannerBlock && key && !topIds.has(key)) {
        await db.collection('calendar_blocks').doc(block.id).delete().catch(() => { });
      } else {
        remainingBlocks.push(block);
      }
    }

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

    const placeEntry = async (candidate, kind) => {
      const sprint = candidate.sprintId ? sprintMap.get(candidate.sprintId) : null;
      const sprintStart = sprint?.start ? toMillis(sprint.start) : null;
      const sprintEnd = sprint?.end ? toMillis(sprint.end) : null;
      const isWorkPersona = String(candidate?.persona || '').toLowerCase() === 'work';
      const busyList = isWorkPersona ? busyWork : busyPersonal;

      const durationMinutesRaw = kind === 'task'
        ? (Number(candidate.points) * 60) || Number(candidate.estimateMin) || 60
        : (Number(candidate.points) * 60) || 90;
      const durationMinutes = Math.min(kind === 'task' ? 180 : 240, Math.max(kind === 'task' ? 30 : 60, durationMinutesRaw || 60));
      const durationMs = durationMinutes * 60000;

      if (isWorkPersona) {
        if (!mainGigBlocks.length) return { created: 0, blocked: 1 };
        const sortedMainGig = mainGigBlocks
          .filter((mg) => mg.start && mg.end)
          .sort((a, b) => a.start - b.start);

        for (const mg of sortedMainGig) {
          const slotStart = DateTime.fromMillis(mg.start, { zone: windowStart.zoneName });
          const slotEnd = DateTime.fromMillis(mg.end, { zone: windowStart.zoneName });
          if (slotEnd <= slotStart) continue;
          if (sprintStart && slotEnd.toMillis() < sprintStart) continue;
          if (sprintEnd && slotStart.toMillis() > sprintEnd) continue;
          if (slotEnd.toMillis() - slotStart.toMillis() < durationMs) continue;

          const overlaps = busyList
            .filter((b) => b.end > slotStart.toMillis() && b.start < slotEnd.toMillis())
            .sort((a, b) => a.start - b.start);
          let cursor = slotStart.toMillis();
          for (const o of overlaps) {
            if (o.start - cursor >= durationMs) break;
            cursor = Math.max(cursor, o.end);
            if (cursor + durationMs > slotEnd.toMillis()) cursor = null;
          }
          if (cursor == null || cursor + durationMs > slotEnd.toMillis()) continue;

          const blockRef = db.collection('calendar_blocks').doc();
          const payload = {
            ownerUid: userId,
            start: cursor,
            end: cursor + durationMs,
            title: candidate.ref ? `${candidate.ref}: ${candidate.title}` : candidate.title,
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
            placementReason: 'Nightly planner: top priority item',
            deepLink: buildEntityUrl(kind === 'story' ? 'story' : 'task', candidate.id, candidate.ref || null),
            persona: candidate.persona || 'work',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          await blockRef.set(payload);
          busyPersonal.push({ start: payload.start, end: payload.end });
          busyWork.push({ start: payload.start, end: payload.end });
          await db.collection('activity_stream').add(activityPayload({
            ownerUid: userId,
            entityId: candidate.id,
            entityType: kind,
            activityType: 'calendar_insertion',
            description: `Calendar block created (${slotStart.toISODate()} ${slotStart.toFormat('HH:mm')}–${slotEnd.toFormat('HH:mm')})`,
            metadata: { blockId: blockRef.id, reason: payload.placementReason, theme: payload.theme || null, goalId: payload.goalId || null },
          }));
          return { created: 1 };
        }
        return { created: 0, blocked: 1 };
      }

      for (let offset = 0; offset < 7; offset++) {
        const day = windowStart.plus({ days: offset });
        const dayStartMs = day.toMillis();
        const dayEndMs = day.endOf('day').toMillis();
        if ((sprintStart && dayEndMs < sprintStart) || (sprintEnd && dayStartMs > sprintEnd)) continue;

        const slots = pickSlots(candidate.theme || candidate.goal || null, day);
        for (const slot of slots) {
          // Skip main gig blocks for tasks/stories
          const isMainGigSlot = isMainGigLabel(slot.label);
          if (isMainGigSlot) continue;
          
          const slotDays = slot.days || [1, 2, 3, 4, 5, 6, 7];
          if (!slotDays.includes(day.weekday)) continue;
          const slotStart = day.set({ hour: Math.floor(slot.start), minute: Math.round((slot.start % 1) * 60), second: 0, millisecond: 0 });
          const slotEnd = day.set({ hour: Math.floor(slot.end), minute: Math.round((slot.end % 1) * 60), second: 0, millisecond: 0 });
          if (sprintStart && slotEnd.toMillis() < sprintStart) continue;
          if (sprintEnd && slotStart.toMillis() > sprintEnd) continue;
          if (slotEnd.toMillis() - slotStart.toMillis() < durationMs) continue;

          const overlaps = busyList
            .filter((b) => b.end > slotStart.toMillis() && b.start < slotEnd.toMillis())
            .sort((a, b) => a.start - b.start);
          let cursor = slotStart.toMillis();
          for (const o of overlaps) {
            if (o.start - cursor >= durationMs) break;
            cursor = Math.max(cursor, o.end);
            if (cursor + durationMs > slotEnd.toMillis()) cursor = null;
          }
          if (cursor == null || cursor + durationMs > slotEnd.toMillis()) continue;

          // CRITICAL: Never place tasks/stories in main gig blocks, even high priority ones
          const proposedStart = cursor;
          const proposedEnd = cursor + durationMs;
          const conflictsWithMainGig = mainGigBlocks.some((mgBlock) => 
            mgBlock.end > proposedStart && mgBlock.start < proposedEnd
          );
          if (conflictsWithMainGig) {
            console.log(`[calendar-planner] Skipping main gig block for ${kind} ${candidate.title}`);
            continue; // Skip this slot, find another
          }

          const blockRef = db.collection('calendar_blocks').doc();
          const payload = {
            ownerUid: userId,
            start: cursor,
            end: cursor + durationMs,
            title: candidate.ref ? `${candidate.ref}: ${candidate.title}` : candidate.title,
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
            placementReason: 'Nightly planner: top priority item',
            deepLink: buildEntityUrl(kind === 'story' ? 'story' : 'task', candidate.id, candidate.ref || null),
            persona: candidate.persona || 'personal',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          await blockRef.set(payload);
          busyPersonal.push({ start: payload.start, end: payload.end });
          busyWork.push({ start: payload.start, end: payload.end });
          await db.collection('activity_stream').add(activityPayload({
            ownerUid: userId,
            entityId: candidate.id,
            entityType: kind,
            activityType: 'calendar_insertion',
            description: `Calendar block created (${day.toISODate()} ${slotStart.toFormat('HH:mm')}–${slotEnd.toFormat('HH:mm')})`,
            metadata: { blockId: blockRef.id, reason: payload.placementReason, theme: payload.theme || null, goalId: payload.goalId || null },
          }));
          return { created: 1 };
        }
      }
      return { created: 0, blocked: 1 };
    };

    // Avoid duplicating if already covered
    const covered = new Set();
    remainingBlocks.forEach((b) => {
      if (b.taskId) covered.add(`task:${b.taskId}`);
      if (b.storyId) covered.add(`story:${b.storyId}`);
    });

    for (const s of topStories) {
      const key = `story:${s.id}`;
      if (covered.has(key)) continue;
      await placeEntry(s, 'story');
    }

    for (const t of topTasks) {
      const key = `task:${t.id}`;
      if (covered.has(key)) continue;
      await placeEntry(t, 'task');
    }
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
  const days = Math.max(1, Math.min(Number(req?.data?.days || 7), 14));
  const windowStart = DateTime.now().setZone(coerceZone(zone)).startOf('day');
  const windowEnd = windowStart.plus({ days }).endOf('day');

  let themeAllocations = [];
  try {
    const allocDoc = await db.collection('theme_allocations').doc(uid).get();
    if (allocDoc.exists) themeAllocations = allocDoc.data()?.allocations || [];
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
  const zone = resolveTimezone(profile, 'Europe/London');
  const days = Math.max(1, Math.min(Number(req?.data?.days || 7), 14));
  const windowStart = DateTime.now().setZone(coerceZone(zone)).startOf('day');
  const windowEnd = windowStart.plus({ days }).endOf('day');

  let themeAllocations = [];
  try {
    const allocDoc = await db.collection('theme_allocations').doc(uid).get();
    if (allocDoc.exists) themeAllocations = allocDoc.data()?.allocations || [];
  } catch { /* ignore */ }

  const blocksSnap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', windowStart.toMillis())
    .where('start', '<=', windowEnd.toMillis())
    .get()
    .catch(() => ({ docs: [] }));
  const existingBlocks = blocksSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  await materializePlannerThemeBlocks({
    db,
    userId: uid,
    windowStart,
    windowEnd,
    themeAllocations,
    existingBlocks,
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
    .filter((s) => !isStoryDoneStatus(s.status) && activeSprintIds.length > 0 && activeSprintIds.includes(s.sprintId));
  const openTasks = tasksSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((t) => !isTaskDoneStatus(t.status))
    .filter((t) => !t.sprintId || activeSprintIds.includes(t.sprintId));

  const scoredStories = openStories.map((s) => ({
    ...s,
    aiScore: scoreWithBonus(s.priority, s.aiCriticalityScore),
  }));
  const scoredTasks = openTasks.map((t) => ({
    ...t,
    aiScore: scoreWithBonus(t.priority, t.aiCriticalityScore),
  }));

  const flaggedStories = scoredStories.filter(isTopStory);
  const flaggedTasks = scoredTasks.filter(isTopTask);

  const topStories = (flaggedStories.length ? flaggedStories : scoredStories)
    .sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0))
    .slice(0, 3);

  const topTasks = (flaggedTasks.length ? flaggedTasks : scoredTasks)
    .sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0))
    .slice(0, 3);

  const topIds = new Set([
    ...topStories.map((s) => `story:${s.id}`),
    ...topTasks.map((t) => `task:${t.id}`),
  ]);

  // Build busy map and prune non-top AI entries
  const remainingBlocks = [];
  let replaced = 0;
  for (const block of existingBlocks) {
    const isAi = block.aiGenerated === true || block.createdBy === 'ai';
    const key = block.storyId ? `story:${block.storyId}` : block.taskId ? `task:${block.taskId}` : null;
    if (isAi && key && !topIds.has(key)) {
      await db.collection('calendar_blocks').doc(block.id).delete().catch(() => { });
      replaced += 1;
    } else {
      remainingBlocks.push(block);
    }
  }

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
    if (isMainGigBlock(b)) {
      mainGigBlocks.push({ start: b.start, end: b.end, theme: b.theme || b.category || '' });
      addBusyPersonal(b.start, b.end);
    } else {
      addBusyPersonal(b.start, b.end);
      addBusyWork(b.start, b.end);
    }
  });

  const { pickSlots } = buildPickSlots(themeAllocations);

  const placeEntry = async (candidate, kind) => {
    const sprint = candidate.sprintId ? sprintMap.get(candidate.sprintId) : null;
    const sprintStart = sprint?.start ? toMillis(sprint.start) : null;
    const sprintEnd = sprint?.end ? toMillis(sprint.end) : null;
    const isWorkPersona = String(candidate?.persona || '').toLowerCase() === 'work';
    const busyList = isWorkPersona ? busyWork : busyPersonal;

    const durationMinutesRaw = kind === 'task'
      ? (Number(candidate.points) * 60) || Number(candidate.estimateMin) || 60
      : (Number(candidate.points) * 60) || 90;
    const durationMinutes = Math.min(kind === 'task' ? 180 : 240, Math.max(kind === 'task' ? 30 : 60, durationMinutesRaw || 60));
    const durationMs = durationMinutes * 60000;

    if (isWorkPersona) {
      if (!mainGigBlocks.length) return { created: 0, blocked: 1 };
      const sortedMainGig = mainGigBlocks
        .filter((mg) => mg.start && mg.end)
        .sort((a, b) => a.start - b.start);
      for (const mg of sortedMainGig) {
        const slotStart = DateTime.fromMillis(mg.start, { zone: windowStart.zoneName });
        const slotEnd = DateTime.fromMillis(mg.end, { zone: windowStart.zoneName });
        if (slotEnd <= slotStart) continue;
        if (sprintStart && slotEnd.toMillis() < sprintStart) continue;
        if (sprintEnd && slotStart.toMillis() > sprintEnd) continue;
        if (slotEnd.toMillis() - slotStart.toMillis() < durationMs) continue;

        const overlaps = busyList
          .filter((b) => b.end > slotStart.toMillis() && b.start < slotEnd.toMillis())
          .sort((a, b) => a.start - b.start);
        let cursor = slotStart.toMillis();
        for (const o of overlaps) {
          if (o.start - cursor >= durationMs) break;
          cursor = Math.max(cursor, o.end);
          if (cursor + durationMs > slotEnd.toMillis()) cursor = null;
        }
        if (cursor == null || cursor + durationMs > slotEnd.toMillis()) continue;

        const blockRef = db.collection('calendar_blocks').doc();
        const payload = {
          ownerUid: uid,
          start: cursor,
          end: cursor + durationMs,
          title: candidate.ref ? `${candidate.ref}: ${candidate.title}` : candidate.title,
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
          placementReason: 'Replan: top priority item',
          deepLink: buildEntityUrl(kind === 'story' ? 'story' : 'task', candidate.id, candidate.ref || null),
          persona: candidate.persona || 'work',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await blockRef.set(payload);
        busyPersonal.push({ start: payload.start, end: payload.end });
        busyWork.push({ start: payload.start, end: payload.end });
        return { created: 1, gcalLink: payload.gcalEventUrl || null };
      }
      return { created: 0, blocked: 1 };
    }

    for (let offset = 0; offset < days; offset++) {
      const day = windowStart.plus({ days: offset });
      const dayStartMs = day.toMillis();
      const dayEndMs = day.endOf('day').toMillis();
      if ((sprintStart && dayEndMs < sprintStart) || (sprintEnd && dayStartMs > sprintEnd)) continue;

      const slots = pickSlots(candidate.theme || candidate.goal || null, day);
      for (const slot of slots) {
        // Skip main gig blocks for tasks/stories
        const isMainGigSlot = isMainGigLabel(slot.label);
        if (isMainGigSlot) continue;
        
        const slotDays = slot.days || [1, 2, 3, 4, 5, 6, 7];
        if (!slotDays.includes(day.weekday)) continue;
        const slotStart = day.set({ hour: Math.floor(slot.start), minute: Math.round((slot.start % 1) * 60), second: 0, millisecond: 0 });
        const slotEnd = day.set({ hour: Math.floor(slot.end), minute: Math.round((slot.end % 1) * 60), second: 0, millisecond: 0 });
        if (sprintStart && slotEnd.toMillis() < sprintStart) continue;
        if (sprintEnd && slotStart.toMillis() > sprintEnd) continue;
        if (slotEnd.toMillis() - slotStart.toMillis() < durationMs) continue;

        const overlaps = busyList.filter((b) => b.end > slotStart.toMillis() && b.start < slotEnd.toMillis()).sort((a, b) => a.start - b.start);
        let cursor = slotStart.toMillis();
        for (const o of overlaps) {
          if (o.start - cursor >= durationMs) break;
          cursor = Math.max(cursor, o.end);
          if (cursor + durationMs > slotEnd.toMillis()) cursor = null;
        }
        if (cursor == null || cursor + durationMs > slotEnd.toMillis()) continue;

        // CRITICAL: Never place tasks/stories in main gig blocks, even high priority ones
        const proposedStart = cursor;
        const proposedEnd = cursor + durationMs;
        const conflictsWithMainGig = mainGigBlocks.some((mgBlock) => 
          mgBlock.end > proposedStart && mgBlock.start < proposedEnd
        );
        if (conflictsWithMainGig) {
          console.log(`[replan-calendar] Skipping main gig block for ${kind} ${candidate.title}`);
          continue; // Skip this slot, find another
        }

        const blockRef = db.collection('calendar_blocks').doc();
        const payload = {
          ownerUid: uid,
          start: cursor,
          end: cursor + durationMs,
          title: candidate.ref ? `${candidate.ref}: ${candidate.title}` : candidate.title,
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
          placementReason: 'Replan: top priority item',
          deepLink: buildEntityUrl(kind === 'story' ? 'story' : 'task', candidate.id, candidate.ref || null),
          persona: candidate.persona || 'personal',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await blockRef.set(payload);
        busyPersonal.push({ start: payload.start, end: payload.end });
        busyWork.push({ start: payload.start, end: payload.end });
        return { created: 1, gcalLink: payload.gcalEventUrl || null };
      }
    }
    return { created: 0, blocked: 1 };
  };

  let created = 0;
  let blocked = 0;
  let gcalLinks = [];

  const alreadyCovered = new Set();
  remainingBlocks.forEach((b) => {
    if (b.taskId) alreadyCovered.add(`task:${b.taskId}`);
    if (b.storyId) alreadyCovered.add(`story:${b.storyId}`);
  });

  for (const s of topStories) {
    const key = `story:${s.id}`;
    if (alreadyCovered.has(key)) continue;
    const res = await placeEntry(s, 'story');
    created += res.created || 0;
    blocked += res.blocked || 0;
    if (res.gcalLink) gcalLinks.push(res.gcalLink);
  }

  for (const t of topTasks) {
    const key = `task:${t.id}`;
    if (alreadyCovered.has(key)) continue;
    const res = await placeEntry(t, 'task');
    created += res.created || 0;
    blocked += res.blocked || 0;
    if (res.gcalLink) gcalLinks.push(res.gcalLink);
  }

  const result = {
    created,
    blocked,
    rescheduled: 0,
    replaced,
    gcalLinks,
  };

  try {
    await db.collection('planner_stats').doc(uid).set({
      lastRunAt: Date.now(),
      source: 'replan',
      windowDays: days,
      created: result.created || 0,
      blocked: result.blocked || 0,
      rescheduled: result.rescheduled || 0,
      replaced: result.replaced || 0,
      totalMovable: result.totalMovable || 0,
      gcalLinksCount: Array.isArray(result.gcalLinks) ? result.gcalLinks.length : 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('[replanCalendarNow] planner_stats write failed', err?.message || err);
  }

  return {
    ok: true,
    ...result,
  };
});

// Manual trigger to run the nightly chain (pointing → conversions → priority → calendar)
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

// Internal job exports to enable manual orchestration/testing without scheduler
exports._runAutoPointingJob = runAutoPointingJob;
exports._runAutoConversionsJob = runAutoConversionsJob;
exports._runPriorityScoringJob = runPriorityScoringJob;
exports._runCalendarPlannerJob = runCalendarPlannerJob;
exports._replanExistingBlocksForUser = replanExistingBlocksForUser;
