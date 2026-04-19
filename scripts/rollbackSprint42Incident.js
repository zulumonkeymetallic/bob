#!/usr/bin/env node

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'bob20250810' });
}

const db = admin.firestore();

function toMillis(value) {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeSprintId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered === 'null' || lowered === 'none' || lowered === '__none__') return null;
  return raw;
}

async function fetchCandidateStories({ sprintId, actorUid, pivotMs, windowMinutes }) {
  const start = pivotMs - windowMinutes * 60 * 1000;
  const end = pivotMs + windowMinutes * 60 * 1000;
  const snap = await db.collection('stories').where('sprintId', '==', sprintId).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }))
    .filter((row) => {
      const updatedMs = toMillis(row.data.updatedAt);
      if (updatedMs == null || updatedMs < start || updatedMs > end) return false;
      return true;
    });
}

async function fetchSecondPassCandidates({ incidentKey }) {
  const snap = await db
    .collection('stories')
    .where('incidentRollback.key', '==', incidentKey)
    .get();

  return snap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }))
    .filter((row) => normalizeSprintId(row.data.sprintId) == null);
}

async function fetchPriorSprintMap({ sprintId, actorUid, pivotMs, windowMinutes }) {
  const start = new Date(pivotMs - windowMinutes * 60 * 1000);
  const end = new Date(pivotMs + windowMinutes * 60 * 1000);

  let events = [];
  try {
    const q = await db
      .collection('activity_stream')
      .where('timestamp', '>=', start)
      .where('timestamp', '<=', end)
      .orderBy('timestamp', 'asc')
      .limit(20000)
      .get();
    events = q.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    const q = await db.collection('activity_stream').limit(40000).get();
    events = q.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const map = new Map();
  for (const ev of events) {
    const ts = toMillis(ev.timestamp);
    if (ts == null || ts < start.getTime() || ts > end.getTime()) continue;

    const entityType = String(ev.entityType || '').toLowerCase();
    if (entityType !== 'story') continue;

    const fieldName = String(ev.fieldName || '').toLowerCase();
    const activityType = String(ev.activityType || ev.action || '').toLowerCase();
    if (fieldName !== 'sprintid' && activityType !== 'updated') continue;

    const actor = ev.userId || ev.uid || ev.ownerUid || null;
    if (actorUid && String(actor || '') !== String(actorUid)) continue;

    const nextSprint = normalizeSprintId(ev.newValue);
    if (nextSprint !== sprintId) continue;

    const storyId = String(ev.entityId || '').trim();
    if (!storyId) continue;

    const prevSprint = normalizeSprintId(ev.oldValue);
    map.set(storyId, prevSprint);
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const modeArg = args.find((arg) => arg.startsWith('--mode='));

  const pivotIso = process.env.PIVOT_ISO || '2026-03-13T16:11:52.506Z';
  const sprintId = process.env.TARGET_SPRINT_ID || 'VA49ezr1Ck0ncRTPd7ev';
  const actorUid = process.env.ACTOR_UID || '3L3nnXSuTPfr08c8DTXG5zYX37A2';
  const windowMinutes = Number(process.env.WINDOW_MINUTES || 360);
  const incidentKey = process.env.INCIDENT_KEY || 'sprint42_2026_03_13';
  const mode = modeArg ? modeArg.split('=')[1] : (process.env.ROLLBACK_MODE || 'incident-window');

  const pivotMs = Date.parse(pivotIso);
  if (Number.isNaN(pivotMs)) {
    throw new Error(`Invalid pivot timestamp: ${pivotIso}`);
  }

  const priorSprintMap = await fetchPriorSprintMap({ sprintId, actorUid, pivotMs, windowMinutes });
  const candidates = mode === 'second-pass-activity'
    ? await fetchSecondPassCandidates({ incidentKey })
    : await fetchCandidateStories({ sprintId, actorUid, pivotMs, windowMinutes });

  const updates = [];
  for (const row of candidates) {
    const currentSprint = normalizeSprintId(row.data.sprintId);
    const priorSprint = priorSprintMap.has(row.id) ? priorSprintMap.get(row.id) : null;
    if (mode === 'second-pass-activity' && priorSprint == null) continue;
    if (currentSprint === priorSprint) continue;
    updates.push({
      id: row.id,
      ref: row.ref,
      currentSprint,
      rollbackSprint: priorSprint,
      updatedAt: toMillis(row.data.updatedAt),
      updatedBy: row.data.updatedBy || row.data.lastUpdatedBy || null,
    });
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    rollbackMode: mode,
    pivot: new Date(pivotMs).toISOString(),
    windowMinutes,
    sprintId,
    actorUid,
    incidentKey,
    candidates: candidates.length,
    withPriorSprintFromActivity: updates.filter((u) => u.rollbackSprint != null).length,
    toNullSprint: updates.filter((u) => u.rollbackSprint == null).length,
    updates: updates.length,
    sample: updates.slice(0, 20).map((u) => ({
      id: u.id,
      currentSprint: u.currentSprint,
      rollbackSprint: u.rollbackSprint,
      updatedAt: u.updatedAt ? new Date(u.updatedAt).toISOString() : null,
      updatedBy: u.updatedBy,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!apply) return;

  const writer = db.bulkWriter();
  for (const u of updates) {
    writer.set(u.ref, {
      sprintId: u.rollbackSprint,
      incidentRollback: {
        key: incidentKey,
        at: admin.firestore.FieldValue.serverTimestamp(),
        actorUid,
        mode,
      },
      syncState: 'dirty',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await writer.close();

  console.log(JSON.stringify({ applied: updates.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
