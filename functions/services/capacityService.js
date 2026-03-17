const { DateTime } = require('luxon');

const DAY_MS = 24 * 60 * 60 * 1000;

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function startOfDayMs(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toDayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function inferItemPoints(itemType, data) {
  const normalizedType = String(itemType || '').trim().toLowerCase();
  if (normalizedType === 'task') {
    const direct = Number(data?.points || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const estimateMin = Number(data?.estimateMin || 0);
    if (Number.isFinite(estimateMin) && estimateMin > 0) return Math.max(0.25, estimateMin / 60);
    return 1;
  }
  if (normalizedType === 'story') {
    const direct = Number(data?.points || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const estimateMin = Number(data?.estimateMin || 0);
    if (Number.isFinite(estimateMin) && estimateMin > 0) return Math.max(0.5, estimateMin / 60);
    return 2;
  }
  return 1;
}

function summarizeCapacity(plannedPoints, capacityPoints) {
  const safeCapacity = Math.max(1, Number(capacityPoints || 0) || 1);
  const planned = Number(plannedPoints || 0);
  const remainingPoints = safeCapacity - planned;
  const utilizationPct = Math.round((planned / safeCapacity) * 100);
  return {
    capacityPoints: safeCapacity,
    plannedPoints: planned,
    remainingPoints,
    utilizationPct,
    overCapacity: remainingPoints < 0,
  };
}

async function buildDayLoadPointsMap(db, userId, startMs, endMs) {
  const map = new Map();
  const snap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('start', '>=', startMs)
    .where('start', '<=', endMs)
    .get()
    .catch(() => ({ docs: [] }));
  for (const doc of (snap.docs || [])) {
    const data = doc.data() || {};
    const start = Number(data.start || 0);
    const end = Number(data.end || 0);
    if (!(start > 0) || !(end > start)) continue;
    const key = toDayKey(start);
    const points = Math.max(0.25, (end - start) / (60 * 60 * 1000));
    map.set(key, (map.get(key) || 0) + points);
  }
  return map;
}

function nextWeekendDateByCapacity(nowLocal, dayLoadPoints = new Map(), maxPoints = 6) {
  const base = (nowLocal || DateTime.now()).startOf('day');
  let fallback = null;
  for (let offset = 1; offset <= 56; offset += 1) {
    const candidate = base.plus({ days: offset });
    if (![6, 7].includes(candidate.weekday)) continue;
    if (!fallback) fallback = candidate;
    const key = candidate.toISODate();
    const load = Number(dayLoadPoints.get(key) || 0);
    if (load < maxPoints) {
      return candidate.endOf('day').toMillis();
    }
  }
  return (fallback || base.plus({ days: 6 })).endOf('day').toMillis();
}

function deriveSprintCapacityPoints(sprint, weeklyCapacityPoints = 20) {
  const explicit = Number(sprint?.capacityPoints || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const startMs = toMillis(sprint?.startDate || sprint?.start);
  const endMs = toMillis(sprint?.endDate || sprint?.end);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
    const sprintWeeks = Math.max(1, Math.ceil((endMs - startMs + DAY_MS) / (7 * DAY_MS)));
    return sprintWeeks * weeklyCapacityPoints;
  }
  return weeklyCapacityPoints;
}

module.exports = {
  DAY_MS,
  toMillis,
  startOfDayMs,
  toDayKey,
  inferItemPoints,
  summarizeCapacity,
  buildDayLoadPointsMap,
  nextWeekendDateByCapacity,
  deriveSprintCapacityPoints,
};
