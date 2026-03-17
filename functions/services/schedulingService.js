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

function resolvePlanningMode(profile, requestedMode) {
  const fromReq = String(requestedMode || '').toLowerCase();
  const fromProfile = String(profile?.plannerMode || '').toLowerCase();
  return (fromReq || fromProfile) === 'strict' ? 'strict' : 'smart';
}

function normalizeBucket(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'morning' || raw === 'afternoon' || raw === 'evening' || raw === 'anytime' ? raw : null;
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

function buildBusyIntervals(blocks, { planningMode, persona, excludedBlockIds }) {
  const busy = [];
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
    if (persona === 'work' && isMainGigBlock(block)) return;
    busy.push({ start, end });
  });
  return busy;
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
}) {
  const baseDay = DateTime.fromMillis(targetDateMs, { zone }).startOf('day');
  const durationMs = Math.max(MIN_BLOCK_MS, Math.round(durationMinutes) * 60 * 1000);
  const requestedBucket = normalizeBucket(targetBucket);

  for (let offset = 0; offset < searchDays; offset += 1) {
    const day = baseDay.plus({ days: offset });
    if (Number.isFinite(maxTargetDateMs) && day.toMillis() > Number(maxTargetDateMs)) break;
    const slots = filterSlotsByTimeOfDay(pickSlots(themeLabel, day), targetBucket);
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
}) {
  const baseDay = DateTime.fromMillis(targetDateMs, { zone }).startOf('day');
  let remainingMs = Math.max(MIN_BLOCK_MS, Math.round(durationMinutes) * 60 * 1000);
  const placements = [];
  const mutableBusy = Array.isArray(busyIntervals) ? [...busyIntervals] : [];
  const requestedBucket = normalizeBucket(targetBucket);

  for (let offset = 0; offset < searchDays && remainingMs > 0; offset += 1) {
    const day = baseDay.plus({ days: offset });
    if (Number.isFinite(maxTargetDateMs) && day.toMillis() > Number(maxTargetDateMs)) break;
    const slots = filterSlotsByTimeOfDay(pickSlots(themeLabel, day), targetBucket);
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
      const gaps = findFreeGapsInSlot(slotStart, slotEnd, mutableBusy, MIN_BLOCK_MS);
      for (const gap of gaps) {
        if (remainingMs <= 0) break;
        const gapMs = gap.end - gap.start;
        if (gapMs < MIN_BLOCK_MS) continue;
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
  console.info('[schedulePlannerItemMutation] start', {
    ...logContext,
    entityPersona: entity.persona || null,
    entityTheme: entity.theme || entity.category || null,
    entityGoalId: entity.goalId || null,
    entitySprintId: entity.sprintId || null,
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
  const busyIntervals = buildBusyIntervals(allBlocks, { planningMode: effectivePlanningMode, persona, excludedBlockIds });
  const placements = allowSplit
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
        });
        return single ? [single] : [];
      })();

  if (!placements.length) {
    console.warn('[schedulePlannerItemMutation] no-placement', {
      ...logContext,
      effectivePlanningMode,
      busyIntervals: busyIntervals.length,
      relatedBlocks: relatedBlocks.length,
      durationMinutes: effectiveDurationMinutes,
      persona,
      themeLabel,
    });
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
  const oldSprintId = String(entity.sprintId || '');
  const splitGroupId = db.collection('_').doc().id;
  const reusableBlocks = [primaryBlock, ...relatedBlocks.filter((block) => !primaryBlock || block.id !== primaryBlock.id)].filter(Boolean);

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
  };
}

module.exports = {
  schedulePlannerItemMutation,
};
