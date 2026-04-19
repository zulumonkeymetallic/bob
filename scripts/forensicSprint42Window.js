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

async function resolveSprint42Doc() {
  const candidates = [];

  const fields = ['sprintNumber', 'number', 'index'];
  for (const f of fields) {
    const q = await db.collection('sprints').where(f, '==', 42).limit(10).get();
    q.docs.forEach((d) => candidates.push(d));
  }

  if (candidates.length > 0) return candidates[0];

  const scan = await db.collection('sprints').limit(200).get();
  for (const doc of scan.docs) {
    const d = doc.data() || {};
    const txt = `${d.name || ''} ${d.title || ''}`.toLowerCase();
    if (txt.includes('42')) return doc;
  }
  return null;
}

async function findStory(ref) {
  const fields = ['ref', 'referenceNumber', 'refNumber'];
  for (const f of fields) {
    const q = await db.collection('stories').where(f, '==', ref).limit(1).get();
    if (!q.empty) return q.docs[0];
  }
  return null;
}

async function recentStoriesForSprint(sprintId, start, end) {
  let docs = [];
  try {
    const q = await db
      .collection('stories')
      .where('sprintId', '==', sprintId)
      .where('updatedAt', '>=', start)
      .where('updatedAt', '<=', end)
      .get();
    docs = q.docs;
  } catch (error) {
    // Fallback when composite index is missing: fetch by sprintId and filter timestamps in memory.
    const q = await db
      .collection('stories')
      .where('sprintId', '==', sprintId)
      .get();
    docs = q.docs;
  }

  const rows = docs
    .map((doc) => {
    const d = doc.data() || {};
    const updatedAtIso = toDate(d.updatedAt)?.toISOString() || null;
    return {
      id: doc.id,
      ref: d.ref || d.referenceNumber || d.refNumber || null,
      title: d.title || null,
      sprintId: d.sprintId || null,
      updatedAt: updatedAtIso,
      createdAt: toDate(d.createdAt)?.toISOString() || null,
      entry_method: d.entry_method || d.entryMethod || null,
      updatedBy: d.updatedBy || d.lastModifiedBy || d.ownerUid || null,
      dueDate: d.dueDate || d.targetDate || null,
    };
  })
    .filter((row) => {
      const u = row.updatedAt ? new Date(row.updatedAt) : null;
      return u && u >= start && u <= end;
    });

  const byEntry = {};
  for (const r of rows) {
    const key = String(r.entry_method || 'none');
    byEntry[key] = (byEntry[key] || 0) + 1;
  }

  return {
    count: rows.length,
    byEntry,
    sample: rows.slice(0, 30),
  };
}

async function main() {
  const ref = process.argv[2] || 'ST-IFPQNV';

  const storyDoc = await findStory(ref);
  if (!storyDoc) {
    console.log(JSON.stringify({ error: 'story_not_found', ref }, null, 2));
    return;
  }
  const story = storyDoc.data() || {};
  const storyUpdatedAt = toDate(story.updatedAt) || new Date();

  const sprint42 = await resolveSprint42Doc();
  const sprintFromStory = await db.collection('sprints').doc(String(story.sprintId || '')).get();

  const storySprintId = String(story.sprintId || '');
  const pivot = storyUpdatedAt;

  const start6h = new Date(pivot.getTime() - 6 * 60 * 60 * 1000);
  const end6h = new Date(pivot.getTime() + 6 * 60 * 60 * 1000);
  const start24h = new Date(pivot.getTime() - 24 * 60 * 60 * 1000);
  const end24h = new Date(pivot.getTime() + 24 * 60 * 60 * 1000);

  const storySprint6h = await recentStoriesForSprint(storySprintId, start6h, end6h);
  const storySprint24h = await recentStoriesForSprint(storySprintId, start24h, end24h);

  const out = {
    story: {
      id: storyDoc.id,
      ref: story.ref || story.referenceNumber || story.refNumber || ref,
      title: story.title || null,
      sprintId: storySprintId || null,
      updatedAt: storyUpdatedAt.toISOString(),
      entry_method: story.entry_method || story.entryMethod || null,
    },
    sprintFromStory: {
      id: sprintFromStory.exists ? sprintFromStory.id : null,
      data: sprintFromStory.exists ? sprintFromStory.data() : null,
    },
    sprint42Candidate: {
      id: sprint42 ? sprint42.id : null,
      data: sprint42 ? sprint42.data() : null,
    },
    sameSprintWindow: {
      plusMinus6h: storySprint6h,
      plusMinus24h: storySprint24h,
    },
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
