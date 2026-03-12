#!/usr/bin/env node
/* eslint-disable no-console */
const admin = require('firebase-admin');

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    const m = token.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function toMs(value) {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value.seconds != null) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtAge(ms) {
  if (!ms) return 'never';
  const delta = Date.now() - ms;
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

async function resolveUid(auth, args) {
  if (args.uid) return args.uid;
  if (!args.email) throw new Error('Provide --uid=<uid> or --email=<email>');
  const user = await auth.getUserByEmail(args.email);
  return user.uid;
}

async function readSnapshot(db, uid) {
  const profileSnap = await db.collection('profiles').doc(uid).get();
  const p = profileSnap.exists ? profileSnap.data() : {};

  const profile = {
    healthkitStatus: p.healthkitStatus || null,
    healthkitLastSyncAtMs: toMs(p.healthkitLastSyncAt),
    healthkitStepsToday: p.healthkitStepsToday ?? null,
    healthkitCaloriesTodayKcal: p.healthkitCaloriesTodayKcal ?? null,
    healthkitProteinTodayG: p.healthkitProteinTodayG ?? null,
    healthkitFatTodayG: p.healthkitFatTodayG ?? null,
    healthkitCarbsTodayG: p.healthkitCarbsTodayG ?? null,
    healthkitReadinessScore: p.healthkitReadinessScore ?? null,
    healthkitSleepMinutes: p.healthkitSleepMinutes ?? null,
    healthkitWeightKg: p.healthkitWeightKg ?? null,
    healthkitBodyFatPct: p.healthkitBodyFatPct ?? null,
  };

  let metrics = [];
  try {
    const snap = await db.collection('metrics_hrv')
      .where('ownerUid', '==', uid)
      .orderBy('date', 'desc')
      .limit(5)
      .get();
    metrics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await db.collection('metrics_hrv')
      .where('ownerUid', '==', uid)
      .limit(10)
      .get();
    metrics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const latestMetric = metrics
    .sort((a, b) => (toMs(b.updatedAt) || toMs(b.createdAt) || 0) - (toMs(a.updatedAt) || toMs(a.createdAt) || 0))[0] || null;

  let activityRows = [];
  try {
    const act = await db.collection('activity_stream')
      .where('ownerUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    activityRows = act.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const act = await db.collection('activity_stream')
      .where('ownerUid', '==', uid)
      .limit(80)
      .get();
    activityRows = act.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const iosActivity = activityRows
    .filter((row) => String(row.source || '').toLowerCase().includes('ios'))
    .sort((a, b) => (toMs(b.createdAt) || toMs(b.timestamp) || 0) - (toMs(a.createdAt) || toMs(a.timestamp) || 0))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      action: row.action || row.type || null,
      direction: row.direction || null,
      createdAtMs: toMs(row.createdAt) || toMs(row.timestamp),
      source: row.source || null,
      metadata: row.metadata || null,
      message: row.message || null,
    }));

  return {
    profile,
    latestMetric: latestMetric
      ? {
          id: latestMetric.id,
          date: latestMetric.date || null,
          updatedAtMs: toMs(latestMetric.updatedAt),
          createdAtMs: toMs(latestMetric.createdAt),
          steps: latestMetric.steps ?? null,
          caloriesTodayKcal: latestMetric.caloriesTodayKcal ?? null,
          proteinTodayG: latestMetric.proteinTodayG ?? null,
          source: latestMetric.source || null,
        }
      : null,
    metricCount: metrics.length,
    iosActivity,
  };
}

(async function main() {
  const args = parseArgs(process.argv);
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const auth = admin.auth();
  const db = admin.firestore();

  const uid = await resolveUid(auth, args);
  const watchSeconds = Number(args.watchSeconds || 0);
  const intervalSeconds = Number(args.intervalSeconds || 10);

  console.log(`Verifying HealthKit sync for uid=${uid}`);
  const first = await readSnapshot(db, uid);
  console.log(JSON.stringify({
    nowMs: Date.now(),
    profile: {
      ...first.profile,
      healthkitLastSyncAtAge: fmtAge(first.profile.healthkitLastSyncAtMs),
    },
    latestMetric: first.latestMetric
      ? {
          ...first.latestMetric,
          updatedAtAge: fmtAge(first.latestMetric.updatedAtMs || first.latestMetric.createdAtMs),
        }
      : null,
    metricCount: first.metricCount,
    iosActivity: first.iosActivity.map((row) => ({
      action: row.action,
      direction: row.direction,
      age: fmtAge(row.createdAtMs),
      source: row.source,
      message: row.message,
      metadata: row.metadata,
    })),
  }, null, 2));

  if (!watchSeconds || watchSeconds <= 0) return;

  const start = Date.now();
  const baseline = first.profile.healthkitLastSyncAtMs || 0;
  while ((Date.now() - start) < watchSeconds * 1000) {
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
    const next = await readSnapshot(db, uid);
    const nextMs = next.profile.healthkitLastSyncAtMs || 0;
    const changed = nextMs > baseline;
    const latestIosActivity = next.iosActivity[0] || null;
    console.log(JSON.stringify({
      nowMs: Date.now(),
      changed,
      healthkitLastSyncAtMs: nextMs,
      healthkitLastSyncAtAge: fmtAge(nextMs),
      status: next.profile.healthkitStatus || null,
      steps: next.profile.healthkitStepsToday,
      calories: next.profile.healthkitCaloriesTodayKcal,
      macrosPresent: [next.profile.healthkitProteinTodayG, next.profile.healthkitFatTodayG, next.profile.healthkitCarbsTodayG].some((v) => v != null),
      metricCount: next.metricCount,
      latestIosActivity: latestIosActivity
        ? {
            action: latestIosActivity.action,
            direction: latestIosActivity.direction,
            age: fmtAge(latestIosActivity.createdAtMs),
            source: latestIosActivity.source,
            message: latestIosActivity.message,
            metadata: latestIosActivity.metadata,
          }
        : null,
    }));
    if (changed) {
      console.log('Detected fresh HealthKit sync write.');
      break;
    }
  }
})();
