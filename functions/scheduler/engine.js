const { DateTime, Interval } = require('luxon');
const { rrulestr } = require('rrule');
const { createHash } = require('crypto');

const DEFAULT_ZONE = 'Europe/London';

const MINUTE = 60 * 1000;

const isoDate = (dt) => dt.toISODate();
const isoDateTime = (dt) => dt.toUTC().toISO();

const makeInstanceId = ({ userId, sourceType, sourceId, occurrenceDate }) =>
  createHash('sha1').update(`${userId}:${sourceType}:${sourceId}:${occurrenceDate}`).digest('hex');

const coerceZone = (timezone) => timezone || DEFAULT_ZONE;

function toDateTime(value, zone) {
  if (!value) return null;
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: coerceZone(zone) });
  if (typeof value === 'number') return DateTime.fromMillis(value, { zone: coerceZone(zone) });
  return DateTime.fromISO(String(value), { zone: coerceZone(zone) });
}

function expandRecurrence(definition, windowStart, windowEnd) {
  if (!definition || !definition.rrule) return [];
  const zone = coerceZone(definition.timezone);
  const dtstart = toDateTime(definition.dtstart || windowStart, zone) || DateTime.fromJSDate(windowStart, { zone });
  try {
    const text = `DTSTART:${dtstart.toUTC().toFormat('yyyyMMdd\'T\'HHmmss\'Z\'')}\nRRULE:${definition.rrule}`;
    const rule = rrulestr(text, { tzid: zone });
    const occurrences = rule.between(windowStart.toJSDate(), windowEnd.toJSDate(), true);
    let filtered = occurrences.map((occ) => DateTime.fromJSDate(occ, { zone }));
    if (Array.isArray(definition.exdates) && definition.exdates.length) {
      const exSet = new Set(definition.exdates.map((d) => d.slice(0, 10)));
      filtered = filtered.filter((dt) => !exSet.has(dt.toISODate()));
    }
    return filtered;
  } catch (err) {
    console.warn('[scheduler] Invalid RRULE', err?.message || err);
    return [];
  }
}

function computeDailyRange(windowStart, windowEnd) {
  const days = [];
  let cursor = windowStart.startOf('day');
  const inclusiveEnd = windowEnd.startOf('day');
  while (cursor <= inclusiveEnd) {
    days.push(cursor);
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

function normaliseBlock(block) {
  const zone = coerceZone(block?.recurrence?.timezone);
  return {
    ...block,
    recurrence: block.recurrence || { rrule: 'FREQ=DAILY', timezone: zone },
    windows: Array.isArray(block.windows) && block.windows.length ? block.windows : [
      { daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: '08:00', endTime: '18:00' },
    ],
    buffers: block.buffers || { before: 0, after: 0 },
    minDurationMinutes: block.minDurationMinutes || 5,
    maxDurationMinutes: block.maxDurationMinutes || 240,
    dailyCapacityMinutes: block.dailyCapacityMinutes || 480,
    priority: block.priority || 3,
    enabled: block.enabled !== false,
    constraints: block.constraints || {},
    zone,
  };
}

function computeEligibleBlocks(blocks, occurrence) {
  const required = occurrence.requiredBlockId
    ? blocks.filter((b) => b.id === occurrence.requiredBlockId)
    : blocks;
  const allowed = occurrence.eligibleBlockIds && occurrence.eligibleBlockIds.length
    ? required.filter((b) => occurrence.eligibleBlockIds.includes(b.id))
    : required;
  const locationFiltered = occurrence.location?.requiredLocation
    ? allowed.filter((b) => (b.constraints?.location || null) === occurrence.location.requiredLocation)
    : allowed;
  const tagFiltered = occurrence.tags && occurrence.tags.length
    ? locationFiltered.filter((b) => {
      const { requiredTags, excludedTags } = b.constraints || {};
      if (excludedTags && excludedTags.some((tag) => occurrence.tags.includes(tag))) return false;
      if (requiredTags && requiredTags.length > 0) {
        return requiredTags.some((tag) => occurrence.tags.includes(tag));
      }
      return true;
    })
    : locationFiltered.filter((b) => {
      const { excludedTags } = b.constraints || {};
      if (!excludedTags) return true;
      return !excludedTags.length;
    });
  return tagFiltered;
}

function splitQuietIntervals(interval, quietWindows, zone) {
  if (!quietWindows || !quietWindows.length) return [interval];
  const day = interval.start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  const fragments = [interval];
  for (const quiet of quietWindows) {
    const days = quiet.daysOfWeek && quiet.daysOfWeek.length ? quiet.daysOfWeek : [1, 2, 3, 4, 5, 6, 7];
    const dow = day.weekday; // 1-7
    if (!days.includes(dow)) continue;
    const quietStart = day.plus({ minutes: hhmmToMinutes(quiet.startTime) });
    const quietEnd = day.plus({ minutes: hhmmToMinutes(quiet.endTime) });

    const nextFragments = [];
    for (const frag of fragments) {
      if (!frag.overlaps(Interval.fromDateTimes(quietStart, quietEnd))) {
        nextFragments.push(frag);
        continue;
      }
      const before = Interval.fromDateTimes(frag.start, quietStart);
      const after = Interval.fromDateTimes(quietEnd, frag.end);
      if (before.length('minutes') > 0.5) nextFragments.push(before);
      if (after.length('minutes') > 0.5) nextFragments.push(after);
    }
    fragments.splice(0, fragments.length, ...nextFragments);
  }
  return fragments;
}

function hhmmToMinutes(hhmm) {
  const [h = '0', m = '0'] = String(hhmm || '00:00').split(':');
  return Number(h) * 60 + Number(m);
}

function buildDeepLink(occurrence) {
  switch (occurrence.sourceType) {
    case 'story':
      return `/stories/${occurrence.sourceId}`;
    case 'task':
      return `/tasks/${occurrence.sourceId}`;
    case 'chore':
      return `/chores/${occurrence.sourceId}`;
    case 'routine':
      return `/routines/${occurrence.sourceId}`;
    default:
      return null;
  }
}

function buildMobileCheckinLink(occurrence) {
  const deepLink = buildDeepLink(occurrence);
  if (!deepLink) return null;
  return `${deepLink}?occurrence=${encodeURIComponent(occurrence.dayKey)}`;
}

function overlapsBusy(candidateStart, candidateEnd, busyIntervals) {
  if (!busyIntervals || !busyIntervals.length) return false;
  const candidate = Interval.fromDateTimes(candidateStart, candidateEnd);
  return busyIntervals.some((busy) => candidate.overlaps(Interval.fromDateTimes(busy.start, busy.end)));
}

function buildBlockDaySlots(block, day, busyByDay) {
  const zone = block.zone || DEFAULT_ZONE;
  const dayStart = day.setZone(zone).startOf('day');
  const blockIntervals = [];
  for (const window of block.windows) {
    if (!window.daysOfWeek.includes(dayStart.weekday)) continue;
    if (window.startDate && DateTime.fromISO(window.startDate, { zone }).startOf('day') > dayStart) continue;
    if (window.endDate && DateTime.fromISO(window.endDate, { zone }).endOf('day') < dayStart) continue;
    const windowStart = dayStart.plus({ minutes: hhmmToMinutes(window.startTime) });
    const windowEnd = dayStart.plus({ minutes: hhmmToMinutes(window.endTime) });
    if (windowEnd <= windowStart) continue;
    blockIntervals.push(Interval.fromDateTimes(windowStart, windowEnd));
  }
  const quiet = block.constraints?.quietHours || [];
  const busyForDay = busyByDay[isoDate(dayStart)] || [];

  const carved = blockIntervals
    .flatMap((interval) => splitQuietIntervals(interval, quiet, zone))
    .flatMap((interval) => {
      if (!busyForDay.length) return [interval];
      const fragments = [interval];
      for (const busy of busyForDay) {
        const busyInterval = Interval.fromDateTimes(busy.start, busy.end);
        const nextFragments = [];
        for (const frag of fragments) {
          if (!frag.overlaps(busyInterval)) {
            nextFragments.push(frag);
            continue;
          }
          const before = Interval.fromDateTimes(frag.start, busyInterval.start);
          const after = Interval.fromDateTimes(busyInterval.end, frag.end);
          if (before.length('minutes') > 0.5) nextFragments.push(before);
          if (after.length('minutes') > 0.5) nextFragments.push(after);
        }
        fragments.splice(0, fragments.length, ...nextFragments);
      }
      return fragments;
    })
    .filter((interval) => interval.length('minutes') >= block.minDurationMinutes);

  return carved.map((interval) => ({
    blockId: block.id,
    block,
    day: isoDate(dayStart),
    interval,
    nextStart: interval.start.plus({ minutes: block.buffers.before }),
  }));
}

function computeBusyByDay(busyRaw, zone) {
  const busyByDay = {};
  for (const entry of busyRaw || []) {
    const start = DateTime.fromISO(entry.start, { zone });
    const end = DateTime.fromISO(entry.end, { zone });
    const dayKey = isoDate(start);
    if (!busyByDay[dayKey]) busyByDay[dayKey] = [];
    busyByDay[dayKey].push({ start, end });
  }
  return busyByDay;
}

function computeChoreRoutineOccurrences(chores, routines, windowStart, windowEnd) {
  const occurrences = [];
  for (const chore of chores) {
    const zone = coerceZone(chore?.recurrence?.timezone);
    const start = DateTime.fromJSDate(windowStart.toJSDate(), { zone });
    const end = DateTime.fromJSDate(windowEnd.toJSDate(), { zone });
    const dueDates = expandRecurrence(chore.recurrence, start, end);
    for (const dt of dueDates) {
      const dayKey = isoDate(dt);
      occurrences.push({
        sourceType: 'chore',
        sourceId: chore.id,
        ownerUid: chore.ownerUid,
        durationMinutes: chore.durationMinutes || 15,
        priority: chore.priority || 3,
        requiredBlockId: chore.requiredBlockId || null,
        eligibleBlockIds: chore.eligibleBlockIds || null,
        policy: chore.policy || { mode: 'roll_forward', graceWindowMinutes: 120 },
        location: chore.locationNeeds || null,
        tags: chore.tags || [],
        dayKey,
        title: chore.title,
      });
    }
  }
  for (const routine of routines) {
    const zone = coerceZone(routine?.recurrence?.timezone);
    const start = DateTime.fromJSDate(windowStart.toJSDate(), { zone });
    const end = DateTime.fromJSDate(windowEnd.toJSDate(), { zone });
    const dueDates = expandRecurrence(routine.recurrence, start, end);
    for (const dt of dueDates) {
      const dayKey = isoDate(dt);
      occurrences.push({
        sourceType: 'routine',
        sourceId: routine.id,
        ownerUid: routine.ownerUid,
        durationMinutes: routine.durationMinutes || 15,
        priority: routine.priority || 3,
        requiredBlockId: routine.requiredBlockId || null,
        eligibleBlockIds: routine.eligibleBlockIds || null,
        policy: routine.policy || { mode: 'roll_forward', graceWindowMinutes: 120 },
        location: routine.locationNeeds || null,
        tags: routine.tags || [],
        dayKey,
        title: routine.title,
      });
    }
  }
  return occurrences;
}

function clampDurationMinutes(value, { min = 15, max = 240 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function buildOccurrenceTags(baseTags, theme) {
  const tags = new Set(Array.isArray(baseTags) ? baseTags.map((tag) => String(tag)) : []);
  if (theme != null) tags.add(String(theme));
  return Array.from(tags);
}

function computeTaskOccurrences(tasks, windowStart, windowEnd, userId) {
  const occurrences = [];
  if (!Array.isArray(tasks) || !tasks.length) return occurrences;
  const startBoundary = windowStart.startOf('day');
  const endBoundary = windowEnd.endOf('day');

  for (const task of tasks) {
    if (!task) continue;
    const ownerUid = task.ownerUid || userId;
    if (!ownerUid) continue;
    const status = String(task.status ?? '').toLowerCase();
    if (status === 'done' || status === 'complete' || status === 'completed' || Number(task.status) === 2) continue;
    if (task.deleted) continue;
    if (task.autoConverted || task.convertedToStoryId) continue;

    const zone = task.timezone || task.timeZone || DEFAULT_ZONE;
    const scheduledStart = toDateTime(task.scheduledStart || task.startDate || task.plannedStart, { zone });
    const dueDt = toDateTime(task.dueDate || task.dueDateMs || task.targetDate, { zone });
    const baseDt = scheduledStart || dueDt;
    if (!baseDt) continue;
    if (baseDt < startBoundary || baseDt > endBoundary) continue;

    const estimateMinutes = task.estimateMin
      || (Number.isFinite(Number(task.estimatedHours)) ? Number(task.estimatedHours) * 60 : null)
      || (Number.isFinite(Number(task.points)) ? Number(task.points) * 45 : null);
    const durationMinutes = clampDurationMinutes(estimateMinutes || 60);
    const priority = task.isDueTodayMandatory ? 1
      : Number.isFinite(Number(task.schedulerPriority))
        ? Number(task.schedulerPriority)
        : Number.isFinite(Number(task.priority))
          ? Number(task.priority)
          : 3;

    const theme = task.theme || task.themeId || null;
    const tags = buildOccurrenceTags(task.tags, theme);
    const requiredBlockId = task.requiredBlockId || task.blockId || null;
    const eligibleBlockIds = Array.isArray(task.eligibleBlockIds)
      ? task.eligibleBlockIds.filter(Boolean)
      : Array.isArray(task.candidateBlockIds)
        ? task.candidateBlockIds.filter(Boolean)
        : [];
    const policy = task.schedulerPolicy || task.policy || { mode: 'roll_forward', graceWindowMinutes: 90 };
    const taskRef = task.ref || task.reference || task.displayId || null;

    occurrences.push({
      sourceType: 'task',
      sourceId: task.id,
      ownerUid,
      durationMinutes,
      priority,
      requiredBlockId,
      eligibleBlockIds,
      policy,
      location: task.locationNeeds || null,
      tags,
      dayKey: isoDate(baseDt),
      title: task.title || taskRef || 'Task',
      theme,
      goalId: task.goalId || null,
      storyId: task.storyId || null,
      sourceRef: taskRef,
      persona: task.persona || null,
    });
  }

  return occurrences;
}

function computeStoryOccurrences(stories, windowStart, windowEnd, userId) {
  const occurrences = [];
  if (!Array.isArray(stories) || !stories.length) return occurrences;
  const startBoundary = windowStart.startOf('day');
  const endBoundary = windowEnd.endOf('day');

  for (const story of stories) {
    if (!story) continue;
    const ownerUid = story.ownerUid || userId;
    if (!ownerUid) continue;
    const status = String(story.status ?? '').toLowerCase();
    if (status === 'done' || status === 'complete' || status === 'completed' || Number(story.status) === 3) continue;
    if (story.deleted) continue;

    const zone = story.timezone || story.timeZone || DEFAULT_ZONE;
    const plannedStart = toDateTime(story.plannedStartDate || story.startDate, { zone });
    const dueDt = toDateTime(story.sprintDueDate || story.targetDate, { zone });
    const baseDt = plannedStart || dueDt;
    if (!baseDt) continue;
    if (baseDt < startBoundary || baseDt > endBoundary) continue;

    const estimateMinutes = story.estimateMin
      || (Number.isFinite(Number(story.points)) ? Number(story.points) * 45 : null)
      || (Number.isFinite(Number(story.estimatedHours)) ? Number(story.estimatedHours) * 60 : null);
    const durationMinutes = clampDurationMinutes(estimateMinutes || 90, { min: 30, max: 360 });
    const priority = Number.isFinite(Number(story.schedulerPriority))
      ? Number(story.schedulerPriority)
      : Number.isFinite(Number(story.priority))
        ? Number(story.priority)
        : 3;

    const theme = story.theme || story.themeId || null;
    const tags = buildOccurrenceTags(story.tags, theme);
    const requiredBlockId = story.requiredBlockId || null;
    const eligibleBlockIds = Array.isArray(story.eligibleBlockIds)
      ? story.eligibleBlockIds.filter(Boolean)
      : [];
    const policy = story.schedulerPolicy || { mode: 'roll_forward', graceWindowMinutes: 120 };
    const storyRef = story.ref || story.reference || story.displayId || null;

    occurrences.push({
      sourceType: 'story',
      sourceId: story.id,
      ownerUid,
      durationMinutes,
      priority,
      requiredBlockId,
      eligibleBlockIds,
      policy,
      location: story.locationNeeds || null,
      tags,
      dayKey: isoDate(baseDt),
      title: story.title || storyRef || 'Story',
      theme,
      goalId: story.goalId || null,
      storyRef,
    });
  }

  return occurrences;
}

function sortOccurrences(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.sourceType === 'chore' && b.sourceType !== 'chore') return -1;
  if (a.sourceType !== 'chore' && b.sourceType === 'chore') return 1;
  return a.sourceId.localeCompare(b.sourceId);
}

function planOccurrences({
  blocks,
  occurrences,
  busyByDay,
  windowStart,
  windowEnd,
  existingInstances,
  solverRunId,
}) {
  const planningDays = computeDailyRange(windowStart, windowEnd);

  const slotIndex = new Map();
  const normalizedBlocks = blocks.map(normaliseBlock);
  for (const block of normalizedBlocks) {
    if (!block.enabled) continue;
    const occurrenceDates = expandRecurrence(block.recurrence, windowStart, windowEnd).map((dt) => dt.startOf('day'));
    const dateSet = new Set(occurrenceDates.map((dt) => dt.toISODate()));
    for (const day of planningDays) {
      if (dateSet.size && !dateSet.has(isoDate(day))) continue;
      const slots = buildBlockDaySlots(block, day.setZone(block.zone), busyByDay);
      if (!slots.length) continue;
      const key = `${block.id}__${isoDate(day)}`;
      slotIndex.set(key, {
        block,
        day: isoDate(day),
        capacityRemaining: block.dailyCapacityMinutes,
        slots,
      });
    }
  }

  const results = [];
  const unscheduled = [];
  const conflicts = [];

  const existingIndex = new Map();
  for (const inst of existingInstances || []) {
    existingIndex.set(`${inst.sourceType}:${inst.sourceId}:${inst.occurrenceDate}`, inst);
  }

  const sortedOccurrences = [...occurrences].sort(sortOccurrences);

  for (const occurrence of sortedOccurrences) {
    const key = `${occurrence.sourceType}:${occurrence.sourceId}:${occurrence.dayKey}`;
    if (existingIndex.has(key)) {
      // Preserve existing assignment but enrich metadata for the latest run
      const existing = existingIndex.get(key);
      const deepLink = buildDeepLink(occurrence);
      const mobileCheckinUrl = buildMobileCheckinLink(occurrence);
      const schedulingContext = {
        ...(existing && existing.schedulingContext ? existing.schedulingContext : {}),
        solverRunId,
      };
      if (occurrence.policy && Object.prototype.hasOwnProperty.call(occurrence.policy, 'mode')) {
        schedulingContext.policyMode = occurrence.policy.mode || null;
      } else if (typeof schedulingContext.policyMode === 'undefined') {
        schedulingContext.policyMode = null;
      }
      if (deepLink) {
        schedulingContext.deepLink = deepLink;
      }
      const updated = {
        ...existing,
        schedulingContext,
      };
      if (deepLink) {
        updated.deepLink = deepLink;
        updated.mobileCheckinUrl = mobileCheckinUrl;
      }
      results.push(updated);
      existingIndex.set(key, updated);
      continue;
    }

    const candidateBlocks = computeEligibleBlocks(normalizedBlocks, occurrence);

    const candidateSlots = [];
    for (const block of candidateBlocks) {
      const slotKey = `${block.id}__${occurrence.dayKey}`;
      if (!slotIndex.has(slotKey)) continue;
      const daySlots = slotIndex.get(slotKey);
      if (daySlots.capacityRemaining < occurrence.durationMinutes) continue;
      candidateSlots.push({ block, daySlots });
    }

    if (!candidateSlots.length) {
      const deepLink = buildDeepLink(occurrence);
      const mobileCheckinUrl = buildMobileCheckinLink(occurrence);
      unscheduled.push({
        sourceType: occurrence.sourceType,
        sourceId: occurrence.sourceId,
        title: occurrence.title,
        dayKey: occurrence.dayKey,
        reason: 'no-eligible-block',
        requiredBlockId: occurrence.requiredBlockId || null,
        candidateBlockIds: [],
        deepLink: deepLink || null,
        mobileCheckinUrl: mobileCheckinUrl || null,
        policyMode: occurrence.policy?.mode || null,
        sourceRef: occurrence.sourceRef || occurrence.storyRef || null,
        theme: occurrence.theme || null,
      });
      conflicts.push({
        dayKey: occurrence.dayKey,
        blockId: occurrence.requiredBlockId || undefined,
        reason: 'no-block',
        message: `No eligible block matched ${occurrence.title || occurrence.sourceId}.`,
        detail: occurrence.requiredBlockId ? `Required block ${occurrence.requiredBlockId} unavailable.` : undefined,
      });
      continue;
    }

    candidateSlots.sort((a, b) => {
      if (a.block.priority !== b.block.priority) return a.block.priority - b.block.priority;
      const aSlot = a.daySlots.slots[0]?.nextStart || DateTime.fromISO(`${occurrence.dayKey}T00:00:00`, { zone });
      const bSlot = b.daySlots.slots[0]?.nextStart || DateTime.fromISO(`${occurrence.dayKey}T00:00:00`, { zone });
      if (aSlot.toMillis() !== bSlot.toMillis()) return aSlot.toMillis() - bSlot.toMillis();
      return a.daySlots.slots.length - b.daySlots.slots.length;
    });

    let placed = false;
    for (const candidate of candidateSlots) {
      const { block, daySlots } = candidate;
      for (const slot of daySlots.slots) {
        const slotDuration = slot.interval.length('minutes');
        if (slotDuration < occurrence.durationMinutes) continue;
        let start = slot.nextStart;
        const end = start.plus({ minutes: occurrence.durationMinutes });
        const endWithBuffer = end.plus({ minutes: block.buffers.after });
        if (endWithBuffer > slot.interval.end) continue;
        if (overlapsBusy(start, endWithBuffer, busyByDay[occurrence.dayKey])) {
          // Move cursor past busy overlap
          slot.nextStart = endWithBuffer;
          continue;
        }
        const deepLink = buildDeepLink(occurrence);
        const mobileCheckinUrl = buildMobileCheckinLink(occurrence);
        const instance = {
          id: makeInstanceId({
            userId: occurrence.ownerUid,
            sourceType: occurrence.sourceType,
            sourceId: occurrence.sourceId,
            occurrenceDate: occurrence.dayKey,
          }),
          ownerUid: occurrence.ownerUid,
          userId: occurrence.ownerUid,
          sourceType: occurrence.sourceType,
          sourceId: occurrence.sourceId,
          title: occurrence.title,
          occurrenceDate: occurrence.dayKey,
          blockId: block.id,
          priority: occurrence.priority,
          plannedStart: isoDateTime(start),
          plannedEnd: isoDateTime(end),
          bufferBeforeMinutes: block.buffers.before,
          bufferAfterMinutes: block.buffers.after,
          durationMinutes: occurrence.durationMinutes,
          status: 'planned',
          schedulingContext: {
            blockPriority: block.priority,
            tieBreaker: 'blockPriority',
            solverRunId,
            policyMode: occurrence.policy?.mode || null,
          },
          requiredBlockId: occurrence.requiredBlockId || null,
          candidateBlockIds: candidateBlocks.map((b) => b.id),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        if (occurrence.sourceRef) instance.sourceRef = occurrence.sourceRef;
        if (occurrence.storyRef) instance.storyRef = occurrence.storyRef;
        if (occurrence.theme != null) instance.theme = occurrence.theme;
        if (occurrence.goalId) instance.goalId = occurrence.goalId;
        if (occurrence.storyId) instance.storyId = occurrence.storyId;
        if (occurrence.persona) instance.persona = occurrence.persona;
        if (Array.isArray(occurrence.tags) && occurrence.tags.length) instance.tags = occurrence.tags;
        if (deepLink) {
          instance.deepLink = deepLink;
          instance.mobileCheckinUrl = mobileCheckinUrl;
          instance.schedulingContext.deepLink = deepLink;
        }
        results.push(instance);
        daySlots.capacityRemaining -= occurrence.durationMinutes;
        slot.nextStart = end.plus({ minutes: block.buffers.after + block.buffers.before });
        placed = true;
        break;
      }
      if (placed) break;
    }

    if (!placed) {
      const blockIds = candidateSlots.map((c) => c.block.id);
      const deepLink = buildDeepLink(occurrence);
      const mobileCheckinUrl = buildMobileCheckinLink(occurrence);
      unscheduled.push({
        sourceType: occurrence.sourceType,
        sourceId: occurrence.sourceId,
        title: occurrence.title,
        dayKey: occurrence.dayKey,
        reason: 'no-available-slot',
        requiredBlockId: occurrence.requiredBlockId || null,
        candidateBlockIds: blockIds,
        deepLink: deepLink || null,
        mobileCheckinUrl: mobileCheckinUrl || null,
        policyMode: occurrence.policy?.mode || null,
        sourceRef: occurrence.sourceRef || occurrence.storyRef || null,
        theme: occurrence.theme || null,
      });
      for (const candidate of candidateSlots) {
        conflicts.push({
          dayKey: occurrence.dayKey,
          blockId: candidate.block.id,
          reason: 'capacity',
          message: `Block "${candidate.block.name || candidate.block.id}" has insufficient capacity for ${occurrence.title || occurrence.sourceId}.`,
          detail: `Needed ${occurrence.durationMinutes} min, remaining ${candidate.daySlots.capacityRemaining} min.`,
        });
      }
    }
  }

  return { results, unscheduled, conflicts };
}

async function planSchedule({
  db,
  userId,
  windowStart,
  windowEnd,
  busy,
}) {
  const solverRunId = createHash('md5')
    .update(`${userId}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 16);

  // Updated to use 'calendar_blocks' which seems to be the intended collection for AI blocks
  // The previous 'blocks' might have been for the old system or templates.
  // We need to be careful if 'blocks' are templates and 'calendar_blocks' are instances.
  // Based on aiPlanning.js, 'calendar_blocks' are specific instances (start/end).
  // However, the engine seems to expect 'blocks' to be templates (recurrence).
  // If we are moving to a fully instance-based system (Rolling 7-Day), 
  // we might need to treat 'calendar_blocks' as the "slots" available.

  // Let's assume 'blocks' are the recurring templates (Routine/Work/Sleep definitions)
  // and 'calendar_blocks' are the concrete instances generated from them OR manual overrides.
  // For this task, we will stick to 'blocks' as templates for now to avoid breaking existing logic,
  // BUT we need to respect the 'calendar_blocks' created by aiPlanning.js as "Fixed Constraints" or "Available Slots".

  // Actually, aiPlanning.js creates 'calendar_blocks' with 'start' and 'end'.
  // The engine's `buildBlockDaySlots` expands `blocks` (templates) into slots.
  // If we want to use the AI-generated blocks, we should probably treat them as "Available Time" 
  // OR as "Scheduled Items" depending on if they are empty containers or have content.

  // Requirement: "Story Block... represents Stories".
  // So a Story Block IS a scheduled item.

  // Let's fetch 'blocks' (templates) to generate the skeleton (Sleep, Work, etc).
  const blocksSnap = await db
    .collection('blocks')
    .where('ownerUid', '==', userId)
    .where('enabled', '==', true)
    .get();
  const blocks = blocksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  // Also fetch 'calendar_blocks' which might be manual/AI overrides or specific story blocks
  const calBlocksSnap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('start', '>=', windowStart.toMillis())
    .where('end', '<=', windowEnd.toMillis())
    .get();
  const calBlocks = calBlocksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // We need to merge these. If a calBlock exists, it might block time.
  // For now, let's just pass them through or use them to adjust 'busy'.
  // But wait, the AI generates 'calendar_blocks' for Stories. 
  // These should probably be treated as "Already Scheduled" items (existingInstances) 
  // so the engine doesn't double book them, OR they are the target slots.

  // If the AI generates a "Story Block", it's reserving time for that story.
  // So it effectively acts as a "Task" (occurrence) that is fixed.
  // Let's treat AI-generated calendar_blocks as 'existingInstances' so they consume capacity.

  const aiStoryBlocks = calBlocks.filter(b => b.storyId || b.aiGenerated);
  const aiInstances = aiStoryBlocks.map(b => ({
    id: b.id,
    sourceType: 'story_block',
    sourceId: b.storyId || b.id,
    ownerUid: b.ownerUid,
    occurrenceDate: isoDate(DateTime.fromMillis(b.start, { zone: DEFAULT_ZONE })),
    start: b.start,
    end: b.end,
    title: b.title,
    status: 'planned',
    isFixed: true // New flag to indicate this shouldn't be moved easily
  }));

  const choresSnap = await db
    .collection('chores')
    .where('ownerUid', '==', userId)
    .get();
  const chores = choresSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const routinesSnap = await db
    .collection('routines')
    .where('ownerUid', '==', userId)
    .get();
  const routines = routinesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const existingSnap = await db
    .collection('scheduled_instances')
    .where('ownerUid', '==', userId)
    .where('occurrenceDate', '>=', isoDate(windowStart))
    .where('occurrenceDate', '<=', isoDate(windowEnd))
    .get();
  const existingInstances = existingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  // Merge AI blocks into existing instances
  const allExisting = [...existingInstances, ...aiInstances];

  const tasksSnap = await db
    .collection('tasks')
    .where('ownerUid', '==', userId)
    .get();
  const tasks = tasksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const storiesSnap = await db
    .collection('stories')
    .where('ownerUid', '==', userId)
    .get();
  const stories = storiesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const busyByDay = computeBusyByDay(busy, DEFAULT_ZONE);
  const occurrences = [
    ...computeChoreRoutineOccurrences(chores, routines, windowStart, windowEnd),
    ...computeTaskOccurrences(tasks, windowStart, windowEnd, userId),
    ...computeStoryOccurrences(stories, windowStart, windowEnd, userId),
  ];

  // Filter out occurrences that are already covered by AI blocks to avoid duplication
  // e.g. if we have a Story Block for Story A, we might not want to schedule Story A again 
  // unless the block is just a container. 
  // For now, let's assume the AI block IS the schedule for that story.
  const coveredStoryIds = new Set(aiStoryBlocks.map(b => b.storyId).filter(Boolean));
  const filteredOccurrences = occurrences.filter(o => {
    if (o.sourceType === 'story' && coveredStoryIds.has(o.sourceId)) return false;
    return true;
  });

  const { results, unscheduled, conflicts } = planOccurrences({
    blocks,
    occurrences: filteredOccurrences,
    busyByDay,
    windowStart,
    windowEnd,
    existingInstances: allExisting,
    solverRunId,
  });

  return {
    solverRunId,
    planned: results,
    unscheduled,
    conflicts,
    existingIds: allExisting.map((inst) => inst.id),
  };
}

module.exports = {
  planSchedule,
  computeBusyByDay,
  makeInstanceId,
};
