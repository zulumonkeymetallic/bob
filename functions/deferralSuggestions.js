const httpsV2 = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const {
  DAY_MS,
  buildDayLoadPointsMap,
  inferItemPoints,
  startOfDayMs,
  summarizeCapacity,
  toDayKey,
  toMillis,
} = require('./services/capacityService');

if (!admin.apps.length) {
  admin.initializeApp();
}

function titleForDay(ms) {
  return new Date(ms).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function normaliseRecurringFrequency(data) {
  const direct = String(data?.repeatFrequency || data?.recurrence?.frequency || data?.recurrence?.freq || '').trim().toLowerCase();
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(direct)) return direct;
  const rrule = String(data?.rrule || '').toUpperCase();
  if (rrule.includes('DAILY')) return 'daily';
  if (rrule.includes('WEEKLY')) return 'weekly';
  if (rrule.includes('MONTHLY')) return 'monthly';
  if (rrule.includes('YEARLY') || rrule.includes('ANNUAL')) return 'yearly';
  return null;
}

function recurrenceAwareDeferDays(data) {
  const frequency = normaliseRecurringFrequency(data);
  if (!frequency) return null;
  const interval = Math.max(1, Number(data?.repeatInterval || data?.recurrence?.interval || 1) || 1);
  if (frequency === 'daily') return interval;
  if (frequency === 'weekly') return 7 * interval;
  if (frequency === 'monthly') return 14 * interval;
  if (frequency === 'yearly') return 60 * interval;
  return null;
}

function buildFocusCapacityNote(focusContext) {
  if (!focusContext || focusContext.isFocusAligned !== false) return '';
  const goals = Array.isArray(focusContext.activeFocusGoals) ? focusContext.activeFocusGoals : [];
  if (goals.length === 0) return '';
  const titles = goals
    .map((goal) => String(goal?.title || '').trim())
    .filter(Boolean)
    .slice(0, 2);
  if (titles.length === 0) {
    return ' This also frees capacity for active focus work.';
  }
  const summary = titles.join(' and ');
  const suffix = goals.length > 2 ? ' and other active focus goals' : '';
  return ` This also frees capacity for ${summary}${suffix}.`;
}

function capacityLabel(rank, projectedUtilization) {
  if (projectedUtilization > 100) {
    return rank === 0 ? 'Least overloaded day' : 'Still over capacity';
  }
  if (projectedUtilization > 80) {
    return rank === 0 ? 'Best fit day' : 'Near-capacity day';
  }
  return rank === 0 ? 'Best capacity day' : 'Low load day';
}

function capacityRationale(candidate, itemPoints, focusCapacityNote) {
  const projectedPoints = candidate.projectedPoints;
  const projectedUtilization = candidate.projectedUtilization;
  const base = `${titleForDay(candidate.dayMs)} would be about ${projectedUtilization}% utilization after moving this item (${projectedPoints.toFixed(1)} pts planned).`;
  if (projectedUtilization > 100) {
    return `${base} It is still over capacity, but is the least overloaded option in the near term.${focusCapacityNote}`;
  }
  if (projectedUtilization > 80) {
    return `${base} This keeps the day close to capacity without overbooking it.${focusCapacityNote}`;
  }
  return `${base} This keeps the day comfortably within capacity.${focusCapacityNote}`;
}

const suggestDeferralOptions = httpsV2.onCall({ region: 'europe-west2', memory: '512MiB' }, async (req) => {
  if (!req.auth?.uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = req.auth.uid;
  const horizonDays = Math.max(7, Math.min(42, Number(req.data?.horizonDays || 21)));
  const dailyCapacityHours = Math.max(2, Math.min(16, Number(req.data?.dailyCapacityHours || 8)));
  const focusCapacityNote = buildFocusCapacityNote(req.data?.focusContext || null);

  const db = admin.firestore();
  const nowMs = Date.now();
  const todayMs = startOfDayMs(nowMs);
  const horizonEndMs = todayMs + horizonDays * DAY_MS;
  const itemType = String(req.data?.itemType || '').trim().toLowerCase();
  const itemId = String(req.data?.itemId || '').trim();

  const [sprintsSnap] = await Promise.all([
    db.collection('sprints').where('ownerUid', '==', uid).get().catch(() => ({ docs: [] })),
  ]);

  const sprints = (sprintsSnap.docs || []).map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      title: String(data.title || data.name || 'Sprint'),
      startMs: toMillis(data.startDate || data.start),
      endMs: toMillis(data.endDate || data.end),
      status: String(data.status || '').toLowerCase(),
    };
  }).filter((s) => s.startMs != null && s.endMs != null);

  const nextSprint = sprints
    .filter((s) => (s.startMs || 0) > nowMs)
    .sort((a, b) => (a.startMs || 0) - (b.startMs || 0))[0] || null;

  let recurrenceAwareOption = null;
  let itemData = null;
  if (itemId && (itemType === 'task' || itemType === 'story')) {
    try {
      const itemSnap = await db.collection(itemType === 'task' ? 'tasks' : 'stories').doc(itemId).get();
      if (itemSnap.exists) {
        const item = itemSnap.data() || {};
        itemData = item;
        const inferredTaskType = String(item?.type || '').trim().toLowerCase();
        const recurrenceDays = recurrenceAwareDeferDays(item);
        if (itemType === 'task' && recurrenceDays != null && ['chore', 'routine', 'habit'].includes(inferredTaskType)) {
          const recurrenceMs = todayMs + (recurrenceDays * DAY_MS);
          recurrenceAwareOption = {
            key: 'recurrence_aware',
            dateMs: recurrenceMs,
            label: 'Next sensible recurrence defer',
            rationale: `This ${inferredTaskType} repeats ${normaliseRecurringFrequency(item)}${Number(item?.repeatInterval || 1) > 1 ? ` every ${Number(item?.repeatInterval || 1)}` : ''}, so deferring it to ${titleForDay(recurrenceMs)} keeps the schedule aligned with its cadence.${focusCapacityNote}`,
            source: 'recurrence_interval',
          };
        }
      }
    } catch (error) {
      console.warn('[suggestDeferralOptions] recurrence-aware task lookup failed', error?.message || error);
    }
  }
  const itemPoints = inferItemPoints(itemType, itemData);

  const dayLoadPoints = await buildDayLoadPointsMap(db, uid, todayMs, horizonEndMs);

  const candidates = [];
  for (let offset = 1; offset <= Math.min(21, horizonDays); offset += 1) {
    const dayMs = todayMs + offset * DAY_MS;
    const dayKey = toDayKey(dayMs);
    const loadPoints = Number(dayLoadPoints.get(dayKey) || 0);
    const baseSummary = summarizeCapacity(loadPoints, dailyCapacityHours);
    const projectedPoints = loadPoints + itemPoints;
    const projectedSummary = summarizeCapacity(projectedPoints, dailyCapacityHours);
    candidates.push({
      dayMs,
      dayKey,
      loadPoints,
      utilization: baseSummary.utilizationPct,
      projectedPoints,
      projectedUtilization: projectedSummary.utilizationPct,
    });
  }

  const lowUtilOptions = candidates
    .sort((a, b) => {
      if (a.projectedUtilization !== b.projectedUtilization) return a.projectedUtilization - b.projectedUtilization;
      if (a.utilization !== b.utilization) return a.utilization - b.utilization;
      return a.dayMs - b.dayMs;
    })
    .slice(0, 8)
    .map((c, idx) => ({
      key: `capacity_${idx + 1}`,
      dateMs: c.dayMs,
      label: capacityLabel(idx, c.projectedUtilization),
      rationale: capacityRationale(c, itemPoints, focusCapacityNote),
      source: 'capacity_forecast',
      utilizationPercent: c.projectedUtilization,
      rank: idx + 1,
    }));

  const options = [];
  if (recurrenceAwareOption) {
    options.push(recurrenceAwareOption);
  }
  if (nextSprint && nextSprint.startMs) {
    options.push({
      key: 'next_sprint',
      dateMs: nextSprint.startMs,
      label: `Move to next sprint (${nextSprint.title})`,
      rationale: `Shifting to ${titleForDay(nextSprint.startMs)} keeps this out of the current sprint load and lines up with the next sprint window.${focusCapacityNote}`,
      source: 'sprint_window',
    });
  }

  options.push(...lowUtilOptions);

  if (!options.length) {
    const fallbackMs = todayMs + DAY_MS;
    options.push({
      key: 'tomorrow',
      dateMs: fallbackMs,
      label: 'Tomorrow',
      rationale: `No forecast data found, so this uses a simple one-day defer fallback.${focusCapacityNote}`,
      source: 'fallback',
    });
  }

  const topOptions = options.slice(0, 3);
  const moreOptions = options.slice(3);

  return {
    ok: true,
    generatedAtMs: Date.now(),
    dailyCapacityHours,
    topOptions,
    moreOptions,
    options,
  };
});

module.exports = {
  suggestDeferralOptions,
};
