const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const { normalizeThemeAllocationPlan, resolveThemeAllocationsForDate } = require('../lib/themeAllocations');
const { inferItemPoints, startOfDayMs, toMillis } = require('./capacityService');

const DEFAULT_ZONE = 'Europe/London';
const MIN_BLOCK_MS = 15 * 60 * 1000;
const DEFAULT_SEARCH_DAYS = 14;

const THEME_RULES = [
  { match: ['growth'], slots: [{ days: [1, 2, 3, 4, 5], start: 7, end: 9, label: 'Growth AM' }, { days: [1, 2, 3, 4, 5], start: 17, end: 19, label: 'Growth PM' }] },
  { match: ['finance', 'wealth'], slots: [{ days: [1, 2, 3, 4, 5], start: 18, end: 21, label: 'Wealth weekday evening' }, { days: [6, 7], start: 9, end: 12, label: 'Wealth weekend AM' }, { days: [6, 7], start: 13, end: 17, label: 'Wealth weekend PM' }] },
  { match: ['side gig', 'side-gig', 'sidegig'], slots: [{ days: [1, 2, 3, 4, 5], start: 18, end: 22, label: 'Side gig evenings' }, { days: [6, 7], start: 10, end: 16, label: 'Side gig weekend' }] },
  { match: ['hobby', 'hobbies'], slots: [{ days: [1, 2, 3, 4, 5, 6, 7], start: 18, end: 22, label: 'Hobbies evenings' }] },
  { match: ['game', 'gaming', 'tv'], slots: [{ days: [5, 6], start: 19, end: 23, label: 'Gaming/TV Fri/Sat evening' }] },
  { match: ['health'], slots: [{ days: [1, 2, 3, 4, 5], start: 6, end: 20, label: 'Health focus' }] },
  { match: ['learning', 'spiritual'], slots: [{ days: [1, 2, 3, 4, 5], start: 6, end: 20, label: 'Growth/Learning' }] },
];

const FALLBACK_SLOTS = [
  { days: [1, 2, 3, 4, 5, 6, 7], start: 8, end: 12, label: 'Fallback AM' },
  { days: [1, 2, 3, 4, 5, 6, 7], start: 13, end: 17, label: 'Fallback PM' },
  { days: [1, 2, 3, 4, 5, 6, 7], start: 18, end: 22, label: 'Fallback evening' },
];
const FREE_SLOT_SLOTS = [
  { days: [1, 2, 3, 4, 5, 6, 7], start: 5, end: 13, label: 'Free slot AM' },
  { days: [1, 2, 3, 4, 5, 6, 7], start: 13, end: 19, label: 'Free slot PM' },
  { days: [1, 2, 3, 4, 5, 6, 7], start: 19, end: 22, label: 'Free slot evening' },
];

function getManualPriorityRank(entity) {
  const explicit = Number(entity?.userPriorityRank);
  if (explicit === 1 || explicit === 2 || explicit === 3) return explicit;
  return entity?.userPriorityFlag === true ? 1 : null;
}

function resolvePlanningMode(profile, requestedMode) {
  const fromReq = String(requestedMode || '').toLowerCase();
  const fromProfile = String(profile?.plannerMode || '').toLowerCase();
  return (fromReq || fromProfile) === 'strict' ? 'strict' : 'smart';
}

function resolveConstraintMode(entity, requestedMode) {
  const explicit = String(requestedMode || '').trim().toLowerCase();
  if (explicit === 'override' || explicit === 'free_slot' || explicit === 'theme_block') return explicit;
  const rank = getManualPriorityRank(entity);
  // Manual Top 1/2/3 should bypass planner theme blocks and search true free
  // time on the calendar.
  if (rank) return 'override';
  // AI-ranked Top 3 (aiTop3ForDay) also needs to bypass theme allocations in
  // smart mode — otherwise a 10h Top 3 story is gated to its theme's weekly
  // hours and silently dropped on days where that theme isn't allocated. The
  // user requirement: top items always get scheduled, even if only 30 mins
  // are free on a given day, splitting across days until the duration is met.
  if (entity?.aiTop3ForDay === true) return 'override';
  return 'theme_block';
}

function normalizeBucket(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'morning' || raw === 'afternoon' || raw === 'evening' || raw === 'anytime' ? raw : null;
}

function inferBucketFromHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return 'anytime';
  if (h >= 5 && h < 13) return 'morning';
  if (h >= 13 && h < 19) return 'afternoon';
  return 'evening';
}

function toMinutes(hhmm) {
  const [h = '0', m = '0'] = String(hhmm || '0:0').split(':');
  return (Number(h) * 60) + Number(m);
}

function isMainGigLabel(value) {
  const raw = String(value || '').toLowerCase();
  if (!raw) return false;
  if (raw.includes('workout')) return false;
  if (raw.includes('main gig') || raw.includes('work shift')) return true;
  return /\bwork\b/.test(raw);
}

function isMainGigBlock(block) {
  if (!block) return false;
  if (block.entityType === 'work_shift' || block.sourceType === 'work_shift_allocation') return true;
  const label = block.theme || block.category || block.title || '';
  return isMainGigLabel(label);
}

function isUserGcalEvent(block) {
  const source = String(block?.source || block?.sourceType || '').toLowerCase();
  return source === 'gcal' || source === 'google_calendar' || block?.createdBy === 'google';
}

// Structured training sessions Jim actually trains for — protected even from Top3/pinned
// displacement in smart mode. Deliberately narrower than isFitnessBlock below: a casual
// "Walk" or "Meditate" GCal entry should NOT match this, because those ARE meant to be
// movable/deletable to make room for a pinned item (per Jim, 2026-07-21) — only real
// training sessions (run, swim, strength training, crossfit, gym) are off-limits.
function isProtectedTrainingEvent(block) {
  const label = String(block?.title || block?.theme || block?.category || '').toLowerCase();
  return label.includes('run') || label.includes('swim') || label.includes('strength')
    || label.includes('crossfit') || label.includes('gym') || label.includes('training');
}

function isFitnessBlock(block) {
  const label = String(block?.theme || block?.category || block?.title || '').toLowerCase();
  return label.includes('health') || label.includes('fitness') || label.includes('gym')
    || label.includes('workout') || label.includes('exercise') || label.includes('run')
    || label.includes('swim') || label.includes('cycle') || label.includes('sport');
}

function findFreeGapsInSlot(slotStartMs, slotEndMs, busyList, minGapMs = MIN_BLOCK_MS) {
  const overlaps = busyList
    .filter((b) => b.end > slotStartMs && b.start < slotEndMs)
    .sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = slotStartMs;
  for (const overlap of overlaps) {
    if (overlap.start > cursor && overlap.start - cursor >= minGapMs) {
      gaps.push({ start: cursor, end: Math.min(overlap.start, slotEndMs) });
    }
    cursor = Math.max(cursor, overlap.end);
    if (cursor >= slotEndMs) break;
  }
  if (slotEndMs - cursor >= minGapMs) {
    gaps.push({ start: cursor, end: slotEndMs });
  }
  return gaps;
}

function buildPickSlots(themeAllocationPlan) {
  const getUserSlots = (themeLabel, day) => {
    const label = String(themeLabel || '').trim().toLowerCase();
    if (!label) return [];
    const dayAllocations = resolveThemeAllocationsForDate(themeAllocationPlan, day, day.zoneName);
    const matches = dayAllocations.filter((allocation) => {
      if (allocation.dayOfWeek !== day.weekday % 7) return false;
      const allocationTheme = String(allocation.theme || '').trim().toLowerCase();
      return allocationTheme && (allocationTheme === label || label.includes(allocationTheme) || allocationTheme.includes(label));
    });
    return matches.map((allocation) => {
      const startMinutes = toMinutes(allocation.startTime);
      const endMinutes = toMinutes(allocation.endTime);
      return {
        days: [day.weekday],
        start: startMinutes / 60,
        end: endMinutes / 60,
        label: `Theme block: ${allocation.theme}`,
      };
    });
  };

  const pickSlots = (themeLabel, day) => {
    const userSlots = getUserSlots(themeLabel, day);
    if (userSlots.length) return userSlots;
    const key = String(themeLabel || '').trim().toLowerCase();
    for (const rule of THEME_RULES) {
      if (rule.match.some((match) => key.includes(match))) return rule.slots;
    }
    return FALLBACK_SLOTS;
  };

  return { pickSlots };
}

function filterSlotsByTimeOfDay(slots, timeOfDay) {
  const normalized = normalizeBucket(timeOfDay);
  if (!normalized || normalized === 'anytime') return slots;
  const filtered = slots.filter((slot) => {
    const hour = Number(slot.start);
    if (normalized === 'morning') return hour >= 5 && hour < 13;
    if (normalized === 'afternoon') return hour >= 13 && hour < 19;
    if (normalized === 'evening') return hour >= 19 || hour < 5;
    return true;
  });
  return filtered.length ? filtered : slots;
}

function inferDurationMinutes(itemType, entity, existingBlock, requestedMinutes) {
  const requested = Number(requestedMinutes || 0);
  if (Number.isFinite(requested) && requested >= 15) return Math.round(requested);
  const blockDuration = Number(existingBlock?.end || 0) - Number(existingBlock?.start || 0);
  if (Number.isFinite(blockDuration) && blockDuration >= MIN_BLOCK_MS) {
    return Math.max(15, Math.round(blockDuration / 60000));
  }
  const estimateMin = Number(entity?.estimateMin || 0);
  if (Number.isFinite(estimateMin) && estimateMin > 0) return Math.max(15, Math.round(estimateMin));
  return Math.max(15, Math.round(inferItemPoints(itemType, entity) * 60));
}

function isPlannerThemeBlock(block) {
  const st = String(block?.sourceType || '');
  return st === 'work_shift_allocation' || st === 'health_allocation' || block?.source === 'theme_allocation';
}

// Returns { busy, displaceable }. `displaceable` collects real user GCal events that are
// NOT protected training sessions and NOT Work (Main Gig) — only populated when
// `allowDisplaceMovableGcal` is set (smart mode + a Top3/pinned item being placed, per
// Jim, 2026-07-21: "if we have smart enabled then the top 3 items should be able to
// remove items from gcal unless it looks fitness... if its Walk or meditate or chores...
// it can be moved or deleted by the planner"). Work (Main Gig) stays hard-busy with zero
// exceptions regardless of this flag — that guarantee (fixed 2026-07-17, see below) is
// never up for negotiation, pinned items or not.
function buildBusyIntervals(blocks, { planningMode, persona, excludedBlockIds, constraintMode, allowDisplaceMovableGcal = false }) {
  const busy = [];
  const displaceable = [];
  blocks.forEach((block) => {
    const blockId = String(block?.id || '').trim();
    if (blockId && excludedBlockIds.has(blockId)) return;
    const start = Number(block?.start || 0);
    const end = Number(block?.end || 0);
    if (!(start > 0) || !(end > start)) return;
    if (planningMode === 'strict') {
      busy.push({ start, end });
      return;
    }
    // Real user calendar events are hard-busy by default — never let a title/theme match
    // (e.g. a GCal meeting titled "Work sync") make a genuine calendar event transparent
    // to the placer. The one deliberate exception: a Top3/pinned item in smart mode may
    // displace a non-training personal GCal entry rather than being blocked by it.
    if (isUserGcalEvent(block)) {
      if (allowDisplaceMovableGcal && !isProtectedTrainingEvent(block)) {
        displaceable.push({ start, end, block });
        return;
      }
      busy.push({ start, end });
      return;
    }
    // Work (Main Gig) is always hard-busy, no exceptions — it represents the whole
    // work day as reserved, so nothing gets planned inside it, not even a Top 3 item
    // and not even a work-persona item. Confirmed live 2026-07-17: Top 3/manually-
    // pinned items were writing straight through this block via the override
    // bypass below — exactly the "planning on top of work" behaviour that's
    // unacceptable. Checked before the override branch so it can never be bypassed.
    if (isMainGigBlock(block)) {
      busy.push({ start, end });
      return;
    }
    // P1 override: treat other theme blocks (e.g. fitness) as transparent so the
    // item can be placed inside or alongside them.
    if (constraintMode === 'override' && isPlannerThemeBlock(block)) return;
    busy.push({ start, end });
  });
  return { busy, displaceable };
}

function formatTimeString(ms, zone) {
  return DateTime.fromMillis(ms, { zone }).toFormat('HH:mm');
}

function plannerWeekStartMs(ms, zone) {
  return DateTime.fromMillis(ms, { zone }).startOf('week').startOf('day').toMillis();
}

function plannerWeekKey(ms, zone) {
  return DateTime.fromMillis(ms, { zone }).startOf('week').toISODate();
}

async function loadCalendarBlocksForWindow(db, userId, startMs, endMs) {
  try {
    const snap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', userId)
      .where('start', '<=', endMs)
      .get();
    return snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
      .filter((row) => {
        const start = Number(row.start || 0);
        const end = Number(row.end || 0);
        return Number.isFinite(start) && Number.isFinite(end) && end >= startMs && start <= endMs;
      });
  } catch (_) {
    const fallback = await db.collection('calendar_blocks')
      .where('ownerUid', '==', userId)
      .get()
      .catch(() => ({ docs: [] }));
    return fallback.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
      .filter((row) => {
        const start = Number(row.start || 0);
        return Number.isFinite(start) && start >= startMs && start <= endMs;
      });
  }
}

async function loadRelatedBlocks(db, userId, itemType, itemId) {
  const field = itemType === 'task' ? 'taskId' : 'storyId';
  try {
    const snap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', userId)
      .where(field, '==', itemId)
      .get();
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, ...(docSnap.data() || {}) }));
  } catch (_) {
    const fallback = await db.collection('calendar_blocks')
      .where('ownerUid', '==', userId)
      .get()
      .catch(() => ({ docs: [] }));
    return fallback.docs
      .map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, ...(docSnap.data() || {}) }))
      .filter((row) => String(row[field] || '').trim() === itemId);
  }
}

async function resolveSprintIdForDate(db, userId, dateMs) {
  const snap = await db.collection('sprints').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] }));
  const exact = snap.docs.find((docSnap) => {
    const data = docSnap.data() || {};
    const start = toMillis(data.startDate || data.start);
    const end = toMillis(data.endDate || data.end);
    return Number.isFinite(start) && Number.isFinite(end) && start <= dateMs && end >= dateMs;
  });
  return exact?.id || null;
}

function resolvePlannerDateMs(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') {
    const dateValue = value.toDate();
    return dateValue instanceof Date ? dateValue.getTime() : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value?.seconds === 'number') {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return null;
}

function resolveExactDueStartMs(dateMs, dueTime, zone) {
  const raw = String(dueTime || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return DateTime.fromMillis(dateMs, { zone }).startOf('day').set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  }).toMillis();
}

// "End of working day" fallback hour used only when a task has no theme that maps to a
// THEME_RULES slot. Deliberately NOT midnight-ish (23:59) — see resolveThemeTimeOfDay below.
const DEFAULT_DUE_TIME_HOUR = 18;

/**
 * Pick a believable clock time (hour/minute, local to `zone`) for a due date, based on the
 * item's theme — reusing THEME_RULES rather than inventing a new heuristic. This is a
 * lightweight, single-day lookup (no busy-interval/calendar conflict search, no multi-day
 * search) intended for bulk due-date maintenance jobs that must keep the target *date*
 * fixed and only need a real hour instead of endOf('day') (23:59:59.999).
 *
 * For conflict-aware placement that may also choose the day, use schedulePlannerItemMutation.
 *
 * @param {string|null} themeLabel - task/story theme or category
 * @param {import('luxon').DateTime} day - the (already-decided) local day the item is due on
 * @returns {{ hour: number, minute: number }}
 */
function resolveThemeTimeOfDay(themeLabel, day) {
  const key = String(themeLabel || '').trim().toLowerCase();
  const rule = key ? THEME_RULES.find((r) => r.match.some((match) => key.includes(match))) : null;
  const slots = rule ? rule.slots : null;
  if (slots && slots.length) {
    const weekday = day && Number.isFinite(day.weekday) ? day.weekday : null;
    const slot = (weekday
      ? slots.find((s) => !Array.isArray(s.days) || s.days.length === 0 || s.days.includes(weekday))
      : null) || slots[0];
    const startHourFloat = Number(slot?.start ?? DEFAULT_DUE_TIME_HOUR);
    const hour = Math.min(23, Math.max(0, Math.floor(startHourFloat)));
    const minute = Math.min(59, Math.max(0, Math.round((startHourFloat % 1) * 60)));
    return { hour, minute };
  }
  return { hour: DEFAULT_DUE_TIME_HOUR, minute: 0 };
}

function resolveManualScheduleOverride(itemType, entity, zone, durationMinutes) {
  if (!entity) return null;
  const isLocked = entity.dueDateLocked || entity.lockDueDate || entity.immovable === true || entity.status === 'immovable';
  if (!isLocked) return null;

  const rawDate = itemType === 'task'
    ? (entity.dueDate ?? entity.dueDateMs ?? entity.targetDate ?? null)
    : (entity.targetDate ?? entity.dueDate ?? entity.plannedStartDate ?? null);
  const resolvedDateMs = resolvePlannerDateMs(rawDate);
  if (!Number.isFinite(resolvedDateMs)) return null;

  const day = DateTime.fromMillis(resolvedDateMs, { zone }).startOf('day');
  const exactStartMs = resolveExactDueStartMs(resolvedDateMs, entity.dueTime, zone);
  const effectiveDurationMs = Math.max(MIN_BLOCK_MS, Math.round(durationMinutes) * 60 * 1000);

  if (Number.isFinite(exactStartMs)) {
    return {
      exactTargetStartMs: exactStartMs,
      exactTargetEndMs: exactStartMs + effectiveDurationMs,
      targetDateMs: exactStartMs,
      targetBucket: normalizeBucket(entity.timeOfDay) || inferBucketFromHour(DateTime.fromMillis(exactStartMs, { zone }).hour),
      maxTargetDateMs: exactStartMs + effectiveDurationMs,
      reason: 'locked_due_time',
    };
  }

  return {
    exactTargetStartMs: null,
    exactTargetEndMs: null,
    targetDateMs: day.toMillis(),
    targetBucket: normalizeBucket(entity.timeOfDay),
    maxTargetDateMs: day.endOf('day').toMillis(),
    reason: 'locked_due_date',
  };
}

function shouldPersistWeeklyPlannerManualLock({ source, exactTargetStartMs }) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  const exactStart = Number(exactTargetStartMs);
  return normalizedSource === 'weekly_planner' && Number.isFinite(exactStart) && exactStart > 0;
}

function choosePlacement({
  targetDateMs,
  targetBucket,
  durationMinutes,
  busyIntervals,
  pickSlots,
  themeLabel,
  zone,
  searchDays,
  maxTargetDateMs = null,
  constraintMode = 'theme_block',
}) {
  const baseDay = DateTime.fromMillis(targetDateMs, { zone }).startOf('day');
  const durationMs = Math.max(MIN_BLOCK_MS, Math.round(durationMinutes) * 60 * 1000);
  const requestedBucket = normalizeBucket(targetBucket);

  for (let offset = 0; offset < searchDays; offset += 1) {
    const day = baseDay.plus({ days: offset });
    if (Number.isFinite(maxTargetDateMs) && day.toMillis() > Number(maxTargetDateMs)) break;
    const baseSlots = (constraintMode === 'free_slot' || constraintMode === 'override') ? FREE_SLOT_SLOTS : pickSlots(themeLabel, day);
    const slots = filterSlotsByTimeOfDay(baseSlots, targetBucket);
    for (const slot of slots) {
      const slotDays = Array.isArray(slot.days) && slot.days.length ? slot.days : [1, 2, 3, 4, 5, 6, 7];
      if (!slotDays.includes(day.weekday)) continue;
      const slotStart = day.set({
        hour: Math.floor(Number(slot.start || 0)),
        minute: Math.round((Number(slot.start || 0) % 1) * 60),
        second: 0,
        millisecond: 0,
      }).toMillis();
      const slotEnd = day.set({
        hour: Math.floor(Number(slot.end || 0)),
        minute: Math.round((Number(slot.end || 0) % 1) * 60),
        second: 0,
        millisecond: 0,
      }).toMillis();
      const gaps = findFreeGapsInSlot(slotStart, slotEnd, busyIntervals, durationMs);
      const chosenGap = gaps.find((gap) => gap.end - gap.start >= durationMs);
      if (!chosenGap) continue;
      let appliedBucket = requestedBucket;
      if (!appliedBucket) {
        const lowerLabel = String(slot.label || '').toLowerCase();
        if (lowerLabel.includes('evening')) appliedBucket = 'evening';
        else if (lowerLabel.includes('afternoon') || lowerLabel.includes('pm')) appliedBucket = 'afternoon';
        else if (lowerLabel.includes('morning') || lowerLabel.includes('am')) appliedBucket = 'morning';
        else appliedBucket = 'anytime';
      }
      return {
        appliedStartMs: chosenGap.start,
        appliedEndMs: chosenGap.start + durationMs,
        appliedBucket,
      };
    }
  }

  return null;
}

function chooseSplitPlacements({
  targetDateMs,
  targetBucket,
  durationMinutes,
  busyIntervals,
  pickSlots,
  themeLabel,
  zone,
  searchDays,
  maxTargetDateMs = null,
  constraintMode = 'theme_block',
  minBlockMs = MIN_BLOCK_MS,
}) {
  const baseDay = DateTime.fromMillis(targetDateMs, { zone }).startOf('day');
  let remainingMs = Math.max(minBlockMs, Math.round(durationMinutes) * 60 * 1000);
  const placements = [];
  const mutableBusy = Array.isArray(busyIntervals) ? [...busyIntervals] : [];
  const requestedBucket = normalizeBucket(targetBucket);

  for (let offset = 0; offset < searchDays && remainingMs > 0; offset += 1) {
    const day = baseDay.plus({ days: offset });
    if (Number.isFinite(maxTargetDateMs) && day.toMillis() > Number(maxTargetDateMs)) break;
    const baseSlots = (constraintMode === 'free_slot' || constraintMode === 'override') ? FREE_SLOT_SLOTS : pickSlots(themeLabel, day);
    const slots = filterSlotsByTimeOfDay(baseSlots, targetBucket);
    for (const slot of slots) {
      if (remainingMs <= 0) break;
      const slotDays = Array.isArray(slot.days) && slot.days.length ? slot.days : [1, 2, 3, 4, 5, 6, 7];
      if (!slotDays.includes(day.weekday)) continue;
      const slotStart = day.set({
        hour: Math.floor(Number(slot.start || 0)),
        minute: Math.round((Number(slot.start || 0) % 1) * 60),
        second: 0,
        millisecond: 0,
      }).toMillis();
      const slotEnd = day.set({
        hour: Math.floor(Number(slot.end || 0)),
        minute: Math.round((Number(slot.end || 0) % 1) * 60),
        second: 0,
        millisecond: 0,
      }).toMillis();
      const gaps = findFreeGapsInSlot(slotStart, slotEnd, mutableBusy, minBlockMs);
      for (const gap of gaps) {
        if (remainingMs <= 0) break;
        const gapMs = gap.end - gap.start;
        if (gapMs < minBlockMs) continue;
        const blockMs = Math.min(gapMs, remainingMs);
        let appliedBucket = requestedBucket;
        if (!appliedBucket) {
          const lowerLabel = String(slot.label || '').toLowerCase();
          if (lowerLabel.includes('evening')) appliedBucket = 'evening';
          else if (lowerLabel.includes('afternoon') || lowerLabel.includes('pm')) appliedBucket = 'afternoon';
          else if (lowerLabel.includes('morning') || lowerLabel.includes('am')) appliedBucket = 'morning';
          else appliedBucket = 'anytime';
        }
        placements.push({
          appliedStartMs: gap.start,
          appliedEndMs: gap.start + blockMs,
          appliedBucket,
        });
        mutableBusy.push({ start: gap.start, end: gap.start + blockMs });
        remainingMs -= blockMs;
      }
    }
  }

  return placements;
}

async function logSchedulingActivity({
  db,
  ownerUid,
  entityId,
  entityType,
  referenceNumber,
  persona,
  description,
  metadata,
  oldSprintId,
  newSprintId,
}) {
  await db.collection('activity_stream').add({
    entityId,
    entityType,
    activityType: oldSprintId !== newSprintId ? 'sprint_changed' : 'updated',
    ownerUid,
    userId: ownerUid,
    actor: 'planner_schedule_service',
    description,
    persona: persona || null,
    referenceNumber: referenceNumber || null,
    source: 'function',
    sourceDetails: 'schedulePlannerItem',
    metadata,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function schedulePlannerItemMutation({
  db,
  userId,
  itemType,
  itemId,
  targetDateMs,
  targetBucket,
  intent = 'move',
  source = 'planner',
  rationale = null,
  linkedBlockId = null,
  targetSprintId = null,
  durationMinutes = null,
  planningMode = null,
  searchDays = null,
  maxTargetDateMs = null,
  allowSplit = false,
  debugRequestId = null,
  exactTargetStartMs = null,
  exactTargetEndMs = null,
  previewOnly = false,
  constraintMode = null,
}) {
  const logContext = {
    debugRequestId: debugRequestId || null,
    userId,
    itemType,
    itemId,
    intent,
    source,
    targetDateMs,
    targetBucket: normalizeBucket(targetBucket),
    linkedBlockId: linkedBlockId || null,
    targetSprintId: targetSprintId || null,
    planningMode: planningMode || null,
    searchDays: searchDays || null,
    maxTargetDateMs: maxTargetDateMs || null,
    allowSplit: allowSplit === true,
    exactTargetStartMs: Number.isFinite(Number(exactTargetStartMs)) ? Number(exactTargetStartMs) : null,
    exactTargetEndMs: Number.isFinite(Number(exactTargetEndMs)) ? Number(exactTargetEndMs) : null,
  };
  const normalizedType = String(itemType || '').trim().toLowerCase();
  if (normalizedType !== 'task' && normalizedType !== 'story') {
    throw new Error('schedulePlannerItem only supports tasks and stories in this slice.');
  }
  const targetMs = Number(targetDateMs || 0);
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    throw new Error('A valid targetDateMs is required.');
  }

  const profileSnap = await db.collection('profiles').doc(userId).get().catch(() => null);
  const profile = profileSnap && profileSnap.exists ? (profileSnap.data() || {}) : {};
  const zone = String(profile?.timezone || profile?.timeZone || DEFAULT_ZONE);
  const effectivePlanningMode = resolvePlanningMode(profile, planningMode);

  const entityRef = db.collection(normalizedType === 'task' ? 'tasks' : 'stories').doc(itemId);
  const entitySnap = await entityRef.get();
  if (!entitySnap.exists) throw new Error(`${normalizedType} not found.`);
  const entity = entitySnap.data() || {};
  if (String(entity.ownerUid || '') !== userId) throw new Error('Permission denied for this item.');
  const manualPriorityRank = getManualPriorityRank(entity);
  const resolvedConstraintMode = resolveConstraintMode(entity, constraintMode);
  console.info('[schedulePlannerItemMutation] start', {
    ...logContext,
    entityPersona: entity.persona || null,
    entityTheme: entity.theme || entity.category || null,
    entityGoalId: entity.goalId || null,
    entitySprintId: entity.sprintId || null,
    previewOnly: previewOnly === true,
    manualPriorityRank,
    constraintMode: resolvedConstraintMode,
  });

  const relatedBlocks = await loadRelatedBlocks(db, userId, normalizedType, itemId);
  const explicitBlock = linkedBlockId ? relatedBlocks.find((block) => block.id === linkedBlockId) || null : null;
  const primaryBlock = explicitBlock || relatedBlocks
    .slice()
    .sort((a, b) => Math.abs(Number(a.start || 0) - targetMs) - Math.abs(Number(b.start || 0) - targetMs))[0] || null;

  const effectiveDurationMinutes = inferDurationMinutes(normalizedType, entity, primaryBlock, durationMinutes);
  const windowStartMs = startOfDayMs(targetMs);
  const windowEndMs = windowStartMs + (DEFAULT_SEARCH_DAYS * 24 * 60 * 60 * 1000) - 1;
  const allBlocks = await loadCalendarBlocksForWindow(db, userId, windowStartMs, windowEndMs);
  const excludedBlockIds = new Set(relatedBlocks.map((block) => block.id).filter(Boolean));
  const persona = String(entity.persona || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';
  const themeLabel = entity.theme || entity.category || null;
  const themePlanSnap = await db.collection('theme_allocations').doc(userId).get().catch(() => null);
  const themePlan = normalizeThemeAllocationPlan(themePlanSnap && themePlanSnap.exists ? (themePlanSnap.data() || {}) : {});
  const { pickSlots } = buildPickSlots(themePlan);
  const normalizedSearchDays = Math.max(1, Math.min(Number(searchDays || DEFAULT_SEARCH_DAYS), 84));
  const forcedStartMs = Number(exactTargetStartMs);
  const forcedEndMs = Number(exactTargetEndMs);
  const forcedDurationMs = Math.max(MIN_BLOCK_MS, Math.round(effectiveDurationMinutes) * 60 * 1000);
  const persistWeeklyPlannerManualLock = shouldPersistWeeklyPlannerManualLock({ source, exactTargetStartMs });
  const oldSprintId = String(entity.sprintId || '');
  // Top-priority items (manual rank or AI Top 3) should be split into ≥30-min
  // chunks rather than 15-min slivers. Smart mode also gets a free-slot fallback
  // below if theme-block placement comes up empty.
  const isTopPriorityEntity = Boolean(manualPriorityRank) || entity?.aiTop3ForDay === true;
  const topItemMinBlockMs = 30 * 60 * 1000;
  // Smart mode + a Top3/pinned item may displace non-training personal GCal events
  // rather than being blocked by them — see buildBusyIntervals for the exact rule.
  const allowDisplaceMovableGcal = isTopPriorityEntity && effectivePlanningMode === 'smart';
  const { busy: busyIntervals, displaceable: displaceableGcalEvents } = buildBusyIntervals(allBlocks, {
    planningMode: effectivePlanningMode,
    persona,
    excludedBlockIds,
    constraintMode: resolvedConstraintMode,
    allowDisplaceMovableGcal,
  });

  let placements = Number.isFinite(forcedStartMs) && forcedStartMs > 0
    ? [{
        appliedStartMs: forcedStartMs,
        appliedEndMs: (Number.isFinite(forcedEndMs) && forcedEndMs > forcedStartMs)
          ? forcedEndMs
          : (forcedStartMs + forcedDurationMs),
        appliedBucket: normalizeBucket(targetBucket) || inferBucketFromHour(DateTime.fromMillis(forcedStartMs, { zone }).hour),
      }]
    : allowSplit
    ? chooseSplitPlacements({
        targetDateMs: targetMs,
        targetBucket,
        durationMinutes: effectiveDurationMinutes,
        busyIntervals,
        pickSlots,
        themeLabel,
        zone,
        searchDays: normalizedSearchDays,
        maxTargetDateMs: Number.isFinite(Number(maxTargetDateMs)) ? Number(maxTargetDateMs) : null,
        constraintMode: resolvedConstraintMode,
        minBlockMs: isTopPriorityEntity ? topItemMinBlockMs : MIN_BLOCK_MS,
      })
    : (() => {
        const single = choosePlacement({
          targetDateMs: targetMs,
          targetBucket,
          durationMinutes: effectiveDurationMinutes,
          busyIntervals,
          pickSlots,
          themeLabel,
          zone,
          searchDays: normalizedSearchDays,
          maxTargetDateMs: Number.isFinite(Number(maxTargetDateMs)) ? Number(maxTargetDateMs) : null,
          constraintMode: resolvedConstraintMode,
        });
        return single ? [single] : [];
      })();

  // Smart-mode free-slot fallback for top items: if the theme-window pass
  // returned nothing (typically because the user's theme allocation for this
  // theme doesn't cover the search window, or every slot is already busy),
  // retry across the wider FREE_SLOT_SLOTS (5am–10pm any day). Top items must
  // always get scheduled — even if that means a 30-min chunk on each day
  // until the duration is met. Only kicks in for smart planning + allowSplit.
  if (
    !placements.length
    && allowSplit
    && isTopPriorityEntity
    && effectivePlanningMode === 'smart'
    && resolvedConstraintMode !== 'override'
  ) {
    placements = chooseSplitPlacements({
      targetDateMs: targetMs,
      targetBucket,
      durationMinutes: effectiveDurationMinutes,
      busyIntervals,
      pickSlots,
      themeLabel,
      zone,
      searchDays: normalizedSearchDays,
      maxTargetDateMs: Number.isFinite(Number(maxTargetDateMs)) ? Number(maxTargetDateMs) : null,
      constraintMode: 'free_slot',
      minBlockMs: topItemMinBlockMs,
    });
    if (placements.length) {
      console.info('[schedulePlannerItemMutation] free-slot-fallback-applied', {
        ...logContext,
        entityId: itemId,
        manualPriorityRank,
        aiTop3ForDay: entity?.aiTop3ForDay === true,
        placementCount: placements.length,
      });
    }
  }

  if (!placements.length) {
    console.warn('[schedulePlannerItemMutation] no-placement', {
      ...logContext,
      effectivePlanningMode,
      busyIntervals: busyIntervals.length,
      relatedBlocks: relatedBlocks.length,
      durationMinutes: effectiveDurationMinutes,
      persona,
      themeLabel,
      manualPriorityRank,
      constraintMode: resolvedConstraintMode,
    });
    if (intent === 'defer' && previewOnly !== true) {
      const appliedDayMs = startOfDayMs(targetMs);
      const appliedWeekStartMs = plannerWeekStartMs(appliedDayMs, zone);
      const appliedWeekKey = plannerWeekKey(appliedDayMs, zone);
      const resolvedSprintId = targetSprintId || await resolveSprintIdForDate(db, userId, appliedDayMs);
      const fallbackBucket = normalizeBucket(targetBucket) || normalizeBucket(entity.timeOfDay);
      const entityPatch = normalizedType === 'task'
        ? {
            dueDate: appliedDayMs,
            dueDateMs: appliedDayMs,
            scheduledTime: null,
            actualScheduledStart: null,
            timeOfDay: fallbackBucket || null,
            plannedWeekKey: appliedWeekKey,
            plannedWeekStart: appliedWeekStartMs,
            sprintId: resolvedSprintId || null,
            deferredUntil: appliedDayMs,
            deferredReason: rationale || null,
            deferredBy: source || 'planner',
            deferredAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }
        : {
            targetDate: appliedDayMs,
            dueDate: appliedDayMs,
            plannedStartDate: null,
            plannedTime: null,
            actualScheduledStart: null,
            timeOfDay: fallbackBucket || null,
            plannedWeekKey: appliedWeekKey,
            plannedWeekStart: appliedWeekStartMs,
            sprintId: resolvedSprintId || null,
            deferredUntil: appliedDayMs,
            deferredReason: rationale || null,
            deferredBy: source || 'planner',
            deferredAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };

      const batch = db.batch();
      batch.set(entityRef, entityPatch, { merge: true });
      relatedBlocks
        .filter((block) => block.aiGenerated === true || String(block.source || '').includes('planner') || String(block.source || '').includes('scheduler'))
        .forEach((block) => {
          batch.delete(db.collection('calendar_blocks').doc(block.id));
        });
      await batch.commit();

      console.info('[schedulePlannerItemMutation] deferred-without-placement', {
        ...logContext,
        appliedDayMs,
        appliedWeekKey,
        resolvedSprintId: resolvedSprintId || null,
        manualPriorityRank,
        constraintMode: resolvedConstraintMode,
      });

      await logSchedulingActivity({
        db,
        ownerUid: userId,
        entityId: itemId,
        entityType: normalizedType,
        referenceNumber: entity.ref || entity.referenceNumber || null,
        persona,
        description: `Deferred to ${DateTime.fromMillis(appliedDayMs, { zone }).toFormat('dd LLL yyyy')} (date-only fallback) via ${source}.`,
        metadata: {
          source,
          rationale: rationale || null,
          planningMode: effectivePlanningMode,
          requestedTargetDateMs: targetMs,
          requestedBucket: normalizeBucket(targetBucket),
          appliedStartMs: appliedDayMs,
          appliedEndMs: appliedDayMs,
          appliedBucket: fallbackBucket || null,
          appliedWeekKey,
          appliedWeekStartMs,
          blockCount: 0,
          scheduledMinutes: 0,
          splitGroupId: null,
          sprintId: resolvedSprintId || null,
          scheduledByPolicy: 'theme_window',
          manualPriorityRank: manualPriorityRank || null,
          plannerConstraintMode: resolvedConstraintMode,
          placementFallback: 'date_only_defer',
        },
        oldSprintId,
        newSprintId: resolvedSprintId || '',
      });

      return {
        ok: true,
        debugRequestId: debugRequestId || null,
        planningMode: effectivePlanningMode,
        appliedStartMs: appliedDayMs,
        appliedEndMs: appliedDayMs,
        appliedDayMs,
        appliedBucket: fallbackBucket || null,
        appliedWeekKey,
        appliedWeekStartMs,
        scheduledMinutes: 0,
        blockCount: 0,
        sprintId: resolvedSprintId || null,
        blockId: null,
        scheduledByPolicy: 'theme_window',
        manualPriorityRank,
        plannerConstraintMode: resolvedConstraintMode,
      };
    }
    throw new Error('No feasible slot was available without conflicting with current calendar constraints.');
  }

  const firstPlacement = placements[0];
  const lastPlacement = placements[placements.length - 1];
  const totalScheduledMinutes = placements.reduce((sum, placement) => (
    sum + Math.max(0, Math.round((placement.appliedEndMs - placement.appliedStartMs) / 60000))
  ), 0);
  const appliedDayMs = startOfDayMs(firstPlacement.appliedStartMs);
  const appliedWeekStartMs = plannerWeekStartMs(appliedDayMs, zone);
  const appliedWeekKey = plannerWeekKey(appliedDayMs, zone);
  const resolvedSprintId = targetSprintId || await resolveSprintIdForDate(db, userId, appliedDayMs);
  const timeString = formatTimeString(firstPlacement.appliedStartMs, zone);
  const splitGroupId = db.collection('_').doc().id;
  const reusableBlocks = [primaryBlock, ...relatedBlocks.filter((block) => !primaryBlock || block.id !== primaryBlock.id)].filter(Boolean);

  if (previewOnly === true) {
    return {
      ok: true,
      debugRequestId: debugRequestId || null,
      planningMode: effectivePlanningMode,
      appliedStartMs: firstPlacement.appliedStartMs,
      appliedEndMs: lastPlacement.appliedEndMs,
      appliedDayMs,
      appliedBucket: firstPlacement.appliedBucket,
      appliedWeekKey,
      appliedWeekStartMs,
      scheduledMinutes: totalScheduledMinutes,
      blockCount: placements.length,
      sprintId: resolvedSprintId || null,
      blockId: primaryBlock?.id || null,
      scheduledByPolicy: manualPriorityRank ? 'manual_priority_override' : 'theme_window',
      plannerConstraintMode: resolvedConstraintMode,
      manualPriorityRank,
    };
  }

  const entityPatch = normalizedType === 'task'
    ? {
        dueDate: lastPlacement.appliedEndMs,
        dueDateMs: lastPlacement.appliedEndMs,
        scheduledTime: timeString,
        actualScheduledStart: firstPlacement.appliedStartMs,
        timeOfDay: firstPlacement.appliedBucket,
        plannedWeekKey: appliedWeekKey,
        plannedWeekStart: appliedWeekStartMs,
        sprintId: resolvedSprintId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
    : {
        targetDate: lastPlacement.appliedEndMs,
        dueDate: lastPlacement.appliedEndMs,
        plannedStartDate: firstPlacement.appliedStartMs,
        plannedTime: timeString,
        actualScheduledStart: firstPlacement.appliedStartMs,
        timeOfDay: firstPlacement.appliedBucket,
        plannedWeekKey: appliedWeekKey,
        plannedWeekStart: appliedWeekStartMs,
        sprintId: resolvedSprintId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

  if (intent === 'defer') {
    entityPatch.deferredUntil = appliedDayMs;
    entityPatch.deferredReason = rationale || null;
    entityPatch.deferredBy = source || 'planner';
    entityPatch.deferredAt = admin.firestore.FieldValue.serverTimestamp();
  } else {
    entityPatch.deferredUntil = null;
    entityPatch.deferredReason = null;
    entityPatch.deferredBy = null;
  }

  if (persistWeeklyPlannerManualLock) {
    entityPatch.orchestrationLocked = true;
    entityPatch.orchestrationLockedReason = 'manual_weekly_planner_placement';
    entityPatch.orchestrationLockedSource = source || 'weekly_planner';
    entityPatch.orchestrationLockedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  // Sources where the user explicitly moved the task — these override the
  // mac_sync lock because the user's planner action takes precedence.
  const USER_DRIVEN_SOURCES = new Set(['weekly_planner', 'planner', 'replan_calendar']);
  const userDriven = USER_DRIVEN_SOURCES.has(source);

  // Guard requires both the source tag and at least one lock boolean, so a stale
  // dueDateLockSource after explicit unlock (dueDateLocked: false) doesn't block.
  const macSyncDueDateLocked = entity.dueDateLockSource === 'mac_sync'
    && (entity.dueDateLocked === true || entity.lockDueDate === true);

  if (macSyncDueDateLocked && !userDriven) {
    // Automated scheduler cannot move a date the user set in Reminders.
    delete entityPatch.dueDate;
    delete entityPatch.dueDateMs;
    delete entityPatch.targetDate;
  } else {
    entityPatch.dueDateUpdatedBy = 'scheduler';
    entityPatch.dueDateUpdatedSource = source || 'planner';
    entityPatch.dueDateUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
    entityPatch.serverUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
    if (macSyncDueDateLocked && userDriven) {
      // User explicitly moved the task in the planner — release the Reminders lock.
      entityPatch.dueDateLocked = false;
      entityPatch.lockDueDate = false;
      entityPatch.dueDateLockSource = admin.firestore.FieldValue.delete();
      entityPatch.dueDateLockedAt = admin.firestore.FieldValue.delete();
      entityPatch.dueDateReason = admin.firestore.FieldValue.delete();
    }
  }

  const batch = db.batch();
  const usedBlockIds = new Set();
  placements.forEach((placement, index) => {
    const reusable = reusableBlocks[index] || null;
    const blockRef = reusable?.ref || db.collection('calendar_blocks').doc();
    const blockPayload = {
      ownerUid: userId,
      title: String(entity.title || reusable?.title || normalizedType).trim(),
      start: placement.appliedStartMs,
      end: placement.appliedEndMs,
      entityType: normalizedType,
      sourceType: normalizedType,
      source: reusable?.source || 'planner_schedule_service',
      status: 'planned',
      aiGenerated: reusable?.aiGenerated !== false,
      taskId: normalizedType === 'task' ? itemId : null,
      storyId: normalizedType === 'story' ? itemId : null,
      goalId: entity.goalId || reusable?.goalId || null,
      theme: entity.theme || reusable?.theme || null,
      persona,
      rationale: rationale || null,
      syncToGoogle: true,
      splitGroupId,
      splitIndex: index,
      splitCount: placements.length,
      scheduledByPolicy: manualPriorityRank ? 'manual_priority_override' : 'theme_window',
      manualPriorityRank: manualPriorityRank || null,
      userPriorityPinned: manualPriorityRank === 1,
      plannerConstraintMode: resolvedConstraintMode,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: reusable?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    };
    batch.set(blockRef, blockPayload, { merge: true });
    usedBlockIds.add(blockRef.id);
  });
  batch.set(entityRef, entityPatch, { merge: true });

  relatedBlocks
    .filter((block) => !usedBlockIds.has(block.id))
    .filter((block) => block.aiGenerated === true || String(block.source || '').includes('planner') || String(block.source || '').includes('scheduler'))
    .forEach((block) => {
      batch.delete(db.collection('calendar_blocks').doc(block.id));
    });

  await batch.commit();

  // Delete any non-training personal GCal events the final placement actually landed on
  // top of — only the ones genuinely overlapped, not every candidate that was merely
  // eligible (chooseSplitPlacements may well have found gaps that avoided them entirely).
  if (Array.isArray(displaceableGcalEvents) && displaceableGcalEvents.length && previewOnly !== true) {
    const displacedNow = displaceableGcalEvents.filter((candidate) =>
      placements.some((p) => candidate.start < p.appliedEndMs && candidate.end > p.appliedStartMs));
    for (const candidate of displacedNow) {
      const eventId = candidate.block?.googleEventId || null;
      if (!eventId) continue;
      const calendarSync = require('../calendarSync');
      const result = await calendarSync.deleteGoogleCalendarEvent(userId, eventId);
      if (result?.ok) {
        await logSchedulingActivity({
          db,
          ownerUid: userId,
          entityId: itemId,
          entityType: normalizedType,
          referenceNumber: entity.ref || entity.referenceNumber || null,
          persona,
          description: `Displaced personal calendar event "${candidate.block?.title || 'Untitled'}" to make room for a pinned Top3 item.`,
          metadata: {
            displacedEventId: eventId,
            displacedTitle: candidate.block?.title || null,
            displacedStartMs: candidate.start,
            displacedEndMs: candidate.end,
          },
          oldSprintId,
          newSprintId: resolvedSprintId || oldSprintId,
        });
      }
    }
  }

    console.info('[schedulePlannerItemMutation] committed', {
    ...logContext,
    effectivePlanningMode,
    durationMinutes: effectiveDurationMinutes,
    persona,
    themeLabel,
    placementCount: placements.length,
    placements: placements.map((placement) => ({
      appliedStartMs: placement.appliedStartMs,
      appliedEndMs: placement.appliedEndMs,
      appliedBucket: placement.appliedBucket,
    })),
    usedBlockIds: Array.from(usedBlockIds),
    splitGroupId,
    resolvedSprintId: resolvedSprintId || null,
    forcedPlacement: Number.isFinite(forcedStartMs) && forcedStartMs > 0,
    manualPriorityRank,
    constraintMode: resolvedConstraintMode,
  });

  const activityPlacement = firstPlacement;
  const description = intent === 'defer'
    ? `Deferred to ${DateTime.fromMillis(activityPlacement.appliedStartMs, { zone }).toFormat('dd LLL yyyy HH:mm')} (${activityPlacement.appliedBucket}) via ${source}.`
    : `Moved to ${DateTime.fromMillis(activityPlacement.appliedStartMs, { zone }).toFormat('dd LLL yyyy HH:mm')} (${activityPlacement.appliedBucket}) via ${source}.`;
  await logSchedulingActivity({
    db,
    ownerUid: userId,
    entityId: itemId,
    entityType: normalizedType,
    referenceNumber: entity.ref || entity.referenceNumber || null,
    persona,
    description,
    metadata: {
      source,
      rationale: rationale || null,
      planningMode: effectivePlanningMode,
      requestedTargetDateMs: targetMs,
      requestedBucket: normalizeBucket(targetBucket),
      appliedStartMs: firstPlacement.appliedStartMs,
      appliedEndMs: lastPlacement.appliedEndMs,
      appliedBucket: firstPlacement.appliedBucket,
      appliedWeekKey,
      appliedWeekStartMs,
      blockCount: placements.length,
      scheduledMinutes: totalScheduledMinutes,
      splitGroupId,
      sprintId: resolvedSprintId || null,
      scheduledByPolicy: manualPriorityRank ? 'manual_priority_override' : 'theme_window',
      manualPriorityRank: manualPriorityRank || null,
      plannerConstraintMode: resolvedConstraintMode,
    },
    oldSprintId,
    newSprintId: resolvedSprintId || '',
  });

  return {
    ok: true,
    debugRequestId: debugRequestId || null,
    planningMode: effectivePlanningMode,
    appliedStartMs: firstPlacement.appliedStartMs,
    appliedEndMs: lastPlacement.appliedEndMs,
    appliedDayMs,
    appliedBucket: firstPlacement.appliedBucket,
    appliedWeekKey,
    appliedWeekStartMs,
    scheduledMinutes: totalScheduledMinutes,
    blockCount: placements.length,
    sprintId: resolvedSprintId || null,
    blockId: Array.from(usedBlockIds)[0] || null,
    scheduledByPolicy: manualPriorityRank ? 'manual_priority_override' : 'theme_window',
    manualPriorityRank,
    plannerConstraintMode: resolvedConstraintMode,
  };
}

module.exports = {
  resolveManualScheduleOverride,
  resolveThemeTimeOfDay,
  schedulePlannerItemMutation,
};
