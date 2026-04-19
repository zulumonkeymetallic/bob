#!/usr/bin/env node

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'bob20250810' });
}

const db = admin.firestore();

function tsToDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function findStoryByRef(ref) {
  const fields = ['ref', 'referenceNumber', 'refNumber'];
  for (const field of fields) {
    const snap = await db.collection('stories').where(field, '==', ref).limit(5).get();
    if (!snap.empty) return snap.docs[0];
  }

  // Fallback scan to catch unusual schemas
  const snap = await db.collection('stories').limit(4000).get();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (
      data.ref === ref ||
      data.referenceNumber === ref ||
      data.refNumber === ref ||
      String(data.title || '').includes(ref)
    ) {
      return doc;
    }
  }
  return null;
}

async function getStoryActivity(storyId) {
  let docs = [];
  try {
    const q = await db
      .collection('activity_stream')
      .where('entityType', '==', 'story')
      .where('entityId', '==', storyId)
      .orderBy('timestamp', 'desc')
      .limit(300)
      .get();
    docs = q.docs;
  } catch (e) {
    const q = await db
      .collection('activity_stream')
      .where('entityType', '==', 'story')
      .where('entityId', '==', storyId)
      .limit(600)
      .get();
    docs = q.docs;
  }

  return docs.map((d) => ({ id: d.id, ...d.data() }));
}

function isSprintChangeEvent(a) {
  const text = [a.activityType, a.action, a.fieldName, a.description, a.message, a.oldValue, a.newValue]
    .map((v) => String(v || '').toLowerCase())
    .join(' | ');
  return text.includes('sprint');
}

function isMoveTo42(a) {
  if (String(a.newValue) === '42') return true;
  const text = [a.activityType, a.action, a.fieldName, a.description, a.message, a.oldValue, a.newValue]
    .map((v) => String(v || '').toLowerCase())
    .join(' | ');
  return text.includes('to 42') || text.includes('-> 42') || text.includes('sprintid:42');
}

async function queryBulkMovesTo42(windowStart, windowEnd) {
  let docs = [];
  try {
    const q = await db
      .collection('activity_stream')
      .where('entityType', '==', 'story')
      .where('timestamp', '>=', windowStart)
      .where('timestamp', '<=', windowEnd)
      .orderBy('timestamp', 'asc')
      .limit(10000)
      .get();
    docs = q.docs;
  } catch (e) {
    const q = await db
      .collection('activity_stream')
      .where('entityType', '==', 'story')
      .limit(20000)
      .get();
    docs = q.docs;
  }

  const rows = docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .map((a) => {
      const t = tsToDate(a.timestamp);
      return {
        id: a.id,
        timestamp: t,
        entityId: a.entityId || null,
        activityType: a.activityType || a.action || null,
        fieldName: a.fieldName || null,
        oldValue: a.oldValue ?? null,
        newValue: a.newValue ?? null,
        userId: a.userId || a.uid || a.ownerUid || null,
        userEmail: a.userEmail || null,
        source: a.source || a.entryMethod || a.createdBy || a.service || null,
        description: a.description || a.message || null,
      };
    })
    .filter((a) => a.timestamp && a.timestamp >= windowStart && a.timestamp <= windowEnd)
    .filter((a) => isSprintChangeEvent(a) && isMoveTo42(a));

  const byActor = {};
  const byMinute = {};
  const uniqueStories = new Set();

  for (const row of rows) {
    const actor = row.userEmail || row.userId || row.source || 'unknown';
    byActor[actor] = (byActor[actor] || 0) + 1;

    if (row.timestamp) {
      const minute = new Date(Math.floor(row.timestamp.getTime() / 60000) * 60000).toISOString();
      byMinute[minute] = (byMinute[minute] || 0) + 1;
    }

    if (row.entityId) uniqueStories.add(String(row.entityId));
  }

  return {
    countEvents: rows.length,
    countStories: uniqueStories.size,
    byActor: Object.entries(byActor).sort((a, b) => b[1] - a[1]),
    byMinute: Object.entries(byMinute).sort((a, b) => b[1] - a[1]).slice(0, 20),
    sample: rows.slice(0, 50).map((r) => ({
      timestamp: r.timestamp ? r.timestamp.toISOString() : null,
      entityId: r.entityId,
      activityType: r.activityType,
      fieldName: r.fieldName,
      oldValue: r.oldValue,
      newValue: r.newValue,
      actor: r.userEmail || r.userId || null,
      source: r.source,
      description: r.description,
    })),
  };
}

async function main() {
  const ref = process.argv[2] || 'ST-IFPQNV';
  const storyDoc = await findStoryByRef(ref);

  if (!storyDoc) {
    console.log(JSON.stringify({ error: 'story_not_found', ref }, null, 2));
    return;
  }

  const data = storyDoc.data() || {};
  const updatedAt = tsToDate(data.updatedAt);
  const activity = await getStoryActivity(storyDoc.id);

  const sprintEvents = activity
    .filter(isSprintChangeEvent)
    .map((a) => ({
      id: a.id,
      timestamp: tsToDate(a.timestamp),
      activityType: a.activityType || a.action || null,
      fieldName: a.fieldName || null,
      oldValue: a.oldValue ?? null,
      newValue: a.newValue ?? null,
      userId: a.userId || a.uid || a.ownerUid || null,
      userEmail: a.userEmail || null,
      source: a.source || a.entryMethod || a.createdBy || a.service || null,
      description: a.description || a.message || null,
    }))
    .sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));

  const pivot = sprintEvents[0]?.timestamp || updatedAt || new Date();
  const windowStart = new Date(pivot.getTime() - 6 * 60 * 60 * 1000);
  const windowEnd = new Date(pivot.getTime() + 6 * 60 * 60 * 1000);

  const bulk = await queryBulkMovesTo42(windowStart, windowEnd);

  const out = {
    story: {
      id: storyDoc.id,
      ref: data.ref || data.referenceNumber || data.refNumber || ref,
      title: data.title || null,
      sprintId: data.sprintId ?? null,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      updatedBy: data.updatedBy || data.lastModifiedBy || null,
      entry_method: data.entry_method || null,
    },
    pivot: pivot.toISOString(),
    window: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
    },
    sprintEvents: sprintEvents.slice(0, 50).map((e) => ({
      id: e.id,
      timestamp: e.timestamp ? e.timestamp.toISOString() : null,
      activityType: e.activityType,
      fieldName: e.fieldName,
      oldValue: e.oldValue,
      newValue: e.newValue,
      actor: e.userEmail || e.userId || null,
      source: e.source,
      description: e.description,
    })),
    bulkToSprint42: bulk,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
