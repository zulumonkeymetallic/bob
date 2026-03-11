const httpsV2 = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

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

function titleForDay(ms) {
  return new Date(ms).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

const suggestDeferralOptions = httpsV2.onCall({ region: 'europe-west2', memory: '512MiB' }, async (req) => {
  if (!req.auth?.uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = req.auth.uid;
  const horizonDays = Math.max(7, Math.min(42, Number(req.data?.horizonDays || 21)));
  const dailyCapacityHours = Math.max(2, Math.min(16, Number(req.data?.dailyCapacityHours || 8)));

  const db = admin.firestore();
  const nowMs = Date.now();
  const todayMs = startOfDayMs(nowMs);
  const horizonEndMs = todayMs + horizonDays * DAY_MS;

  const [sprintsSnap, blocksSnap] = await Promise.all([
    db.collection('sprints').where('ownerUid', '==', uid).get().catch(() => ({ docs: [] })),
    db.collection('calendar_blocks')
      .where('ownerUid', '==', uid)
      .where('start', '>=', todayMs)
      .where('start', '<=', horizonEndMs)
      .get()
      .catch(() => ({ docs: [] })),
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

  const dayLoadHours = new Map();
  for (const doc of (blocksSnap.docs || [])) {
    const data = doc.data() || {};
    const startMs = toMillis(data.start);
    const endMs = toMillis(data.end);
    if (!startMs || !endMs || endMs <= startMs) continue;
    const dayKey = toDayKey(startMs);
    const hours = Math.max(0.25, (endMs - startMs) / (60 * 60 * 1000));
    dayLoadHours.set(dayKey, (dayLoadHours.get(dayKey) || 0) + hours);
  }

  const candidates = [];
  for (let offset = 1; offset <= Math.min(21, horizonDays); offset += 1) {
    const dayMs = todayMs + offset * DAY_MS;
    const dayKey = toDayKey(dayMs);
    const loadHours = Number(dayLoadHours.get(dayKey) || 0);
    const utilization = Math.round((loadHours / dailyCapacityHours) * 100);
    candidates.push({ dayMs, dayKey, loadHours, utilization });
  }

  const lowUtilOptions = candidates
    .sort((a, b) => {
      if (a.utilization !== b.utilization) return a.utilization - b.utilization;
      return a.dayMs - b.dayMs;
    })
    .slice(0, 8)
    .map((c, idx) => ({
      key: `capacity_${idx + 1}`,
      dateMs: c.dayMs,
      label: idx === 0 ? 'Best capacity day' : 'Low load day',
      rationale: `${titleForDay(c.dayMs)} is at about ${c.utilization}% utilization (${c.loadHours.toFixed(1)}h planned), so this avoids overbooking.`,
      source: 'capacity_forecast',
      utilizationPercent: c.utilization,
      rank: idx + 1,
    }));

  const options = [];
  if (nextSprint && nextSprint.startMs) {
    options.push({
      key: 'next_sprint',
      dateMs: nextSprint.startMs,
      label: `Move to next sprint (${nextSprint.title})`,
      rationale: `Shifting to ${titleForDay(nextSprint.startMs)} keeps this out of the current sprint load and lines up with the next sprint window.`,
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
      rationale: 'No forecast data found, so this uses a simple one-day defer fallback.',
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
