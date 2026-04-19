#!/usr/bin/env node

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'bob20250810' });
}

const db = admin.firestore();

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const pivotIso = process.argv[2] || '2026-03-13T16:11:52.506Z';
  const hours = Number(process.argv[3] || 1);
  const pivot = new Date(pivotIso);
  const start = new Date(pivot.getTime() - hours * 60 * 60 * 1000);
  const end = new Date(pivot.getTime() + hours * 60 * 60 * 1000);

  let docs = [];
  try {
    const q = await db
      .collection('activity_stream')
      .where('timestamp', '>=', start)
      .where('timestamp', '<=', end)
      .orderBy('timestamp', 'asc')
      .limit(10000)
      .get();
    docs = q.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    const q = await db.collection('activity_stream').limit(20000).get();
    docs = q.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const rows = docs
    .map((d) => ({
      id: d.id,
      timestamp: toDate(d.timestamp),
      entityType: d.entityType || null,
      entityId: d.entityId || null,
      activityType: d.activityType || d.action || null,
      fieldName: d.fieldName || null,
      oldValue: d.oldValue ?? null,
      newValue: d.newValue ?? null,
      userId: d.userId || d.uid || d.ownerUid || null,
      userEmail: d.userEmail || null,
      source: d.source || d.entryMethod || d.createdBy || d.service || null,
      description: d.description || d.message || null,
    }))
    .filter((r) => r.timestamp && r.timestamp >= start && r.timestamp <= end)
    .sort((a, b) => a.timestamp - b.timestamp);

  const byActivity = {};
  const byEntityType = {};
  const byActor = {};

  for (const r of rows) {
    const a = String(r.activityType || 'none');
    const e = String(r.entityType || 'none');
    const actor = r.userEmail || r.userId || r.source || 'unknown';
    byActivity[a] = (byActivity[a] || 0) + 1;
    byEntityType[e] = (byEntityType[e] || 0) + 1;
    byActor[actor] = (byActor[actor] || 0) + 1;
  }

  const interesting = rows.filter((r) => {
    const text = [r.activityType, r.fieldName, r.description, r.oldValue, r.newValue, r.entityType]
      .map((v) => String(v || '').toLowerCase())
      .join(' | ');
    return text.includes('sprint') || text.includes('replan') || text.includes('priority') || text.includes('story');
  });

  console.log(JSON.stringify({
    pivot: pivot.toISOString(),
    window: { start: start.toISOString(), end: end.toISOString() },
    totalEvents: rows.length,
    byActivity: Object.entries(byActivity).sort((a, b) => b[1] - a[1]).slice(0, 20),
    byEntityType: Object.entries(byEntityType).sort((a, b) => b[1] - a[1]).slice(0, 20),
    byActor: Object.entries(byActor).sort((a, b) => b[1] - a[1]).slice(0, 20),
    interestingSample: interesting.slice(0, 80).map((r) => ({
      timestamp: r.timestamp ? r.timestamp.toISOString() : null,
      entityType: r.entityType,
      entityId: r.entityId,
      activityType: r.activityType,
      fieldName: r.fieldName,
      oldValue: r.oldValue,
      newValue: r.newValue,
      actor: r.userEmail || r.userId,
      source: r.source,
      description: r.description,
    })),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
