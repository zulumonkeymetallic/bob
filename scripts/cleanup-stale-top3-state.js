#!/usr/bin/env node
/*
 Cleanup stale Top 3 state so only current-day Top 3 items keep top3 fields/tags.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
   node scripts/cleanup-stale-top3-state.js [--project bob20250810] [--uid <ownerUid>] [--dry-run]
*/

const admin = require('firebase-admin');

function arg(name, def = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const value = process.argv[idx + 1];
  return (value && !value.startsWith('--')) ? value : true;
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (value === true) return true;
  const lowered = String(value).trim().toLowerCase();
  if (!lowered) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(lowered);
}

function init(projectId) {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: projectId || undefined });
  }
}

function toIsoDate(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const v = value.trim();
    if (!v) return null;
    return v.slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const d = value.toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

const TOP3_TOKENS = new Set(['top3', '#top3']);

function stripTop3Tags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return [];
  return tags.filter((tag) => !TOP3_TOKENS.has(String(tag || '').trim().toLowerCase()));
}

function isCurrentTop3(data, todayIso) {
  if (!data || data.aiTop3ForDay !== true) return false;
  const top3Date = toIsoDate(data.aiTop3Date);
  if (!top3Date) return true;
  return top3Date === todayIso;
}

async function listOwnerUids(db, targetUid) {
  if (targetUid) return [targetUid];
  const profilesSnap = await db.collection('profiles').get().catch(() => ({ docs: [] }));
  return profilesSnap.docs.map((doc) => doc.id).filter(Boolean);
}

async function scanOwnerDocs(db, collectionName, ownerUid, pageSize = 1000) {
  const docs = [];
  let cursor = null;
  while (true) {
    let q = db.collection(collectionName)
      .where('ownerUid', '==', ownerUid)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get().catch(() => ({ docs: [] }));
    const pageDocs = snap?.docs || [];
    if (!pageDocs.length) break;
    docs.push(...pageDocs);
    cursor = pageDocs[pageDocs.length - 1].id;
    if (pageDocs.length < pageSize) break;
  }
  return docs;
}

function buildTaskPatch(data, todayIso) {
  const patch = {};
  const keepTop3 = isCurrentTop3(data, todayIso);
  if (!keepTop3) {
    if (data.aiTop3ForDay === true) patch.aiTop3ForDay = false;
    if (data.aiFlaggedTop === true) patch.aiFlaggedTop = false;
    if (data.aiPriorityRank !== undefined && data.aiPriorityRank !== null) {
      patch.aiPriorityRank = admin.firestore.FieldValue.delete();
    }
    if (data.aiTop3Date !== undefined) patch.aiTop3Date = admin.firestore.FieldValue.delete();
    if (data.aiTop3Reason !== undefined) patch.aiTop3Reason = admin.firestore.FieldValue.delete();
    if (data.aiPriorityReason !== undefined) patch.aiPriorityReason = admin.firestore.FieldValue.delete();
    if (data.aiPriorityLabel !== undefined) patch.aiPriorityLabel = admin.firestore.FieldValue.delete();
  }

  const tags = Array.isArray(data.tags) ? data.tags : [];
  const cleanedTags = stripTop3Tags(tags);
  if (cleanedTags.length !== tags.length) {
    patch.tags = cleanedTags;
  }

  if (!Object.keys(patch).length) return null;
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  patch.syncState = 'dirty';
  return patch;
}

function buildStoryPatch(data, todayIso) {
  const patch = {};
  const keepTop3 = isCurrentTop3(data, todayIso);
  if (!keepTop3) {
    if (data.aiTop3ForDay === true) patch.aiTop3ForDay = false;
    if (data.aiFocusStoryRank !== undefined && data.aiFocusStoryRank !== null) {
      patch.aiFocusStoryRank = admin.firestore.FieldValue.delete();
    }
    if (data.aiFocusStoryAt !== undefined) {
      patch.aiFocusStoryAt = admin.firestore.FieldValue.delete();
    }
    if (data.aiTop3Date !== undefined) patch.aiTop3Date = admin.firestore.FieldValue.delete();
    if (data.aiTop3Reason !== undefined) patch.aiTop3Reason = admin.firestore.FieldValue.delete();
    if (data.aiPriorityReason !== undefined) patch.aiPriorityReason = admin.firestore.FieldValue.delete();
    if (data.aiPriorityLabel !== undefined) patch.aiPriorityLabel = admin.firestore.FieldValue.delete();
  }

  const tags = Array.isArray(data.tags) ? data.tags : [];
  const cleanedTags = stripTop3Tags(tags);
  if (cleanedTags.length !== tags.length) {
    patch.tags = cleanedTags;
  }

  if (!Object.keys(patch).length) return null;
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  patch.syncState = 'dirty';
  return patch;
}

async function cleanupOwner(db, ownerUid, { dryRun = false, todayIso }) {
  const [taskDocs, storyDocs] = await Promise.all([
    scanOwnerDocs(db, 'tasks', ownerUid),
    scanOwnerDocs(db, 'stories', ownerUid),
  ]);

  let taskUpdates = 0;
  let storyUpdates = 0;
  const writer = db.bulkWriter();

  taskDocs.forEach((doc) => {
    const patch = buildTaskPatch(doc.data() || {}, todayIso);
    if (!patch) return;
    taskUpdates += 1;
    if (!dryRun) writer.set(doc.ref, patch, { merge: true });
  });

  storyDocs.forEach((doc) => {
    const patch = buildStoryPatch(doc.data() || {}, todayIso);
    if (!patch) return;
    storyUpdates += 1;
    if (!dryRun) writer.set(doc.ref, patch, { merge: true });
  });

  await writer.close();

  return {
    ownerUid,
    scannedTasks: taskDocs.length,
    scannedStories: storyDocs.length,
    taskUpdates,
    storyUpdates,
  };
}

async function main() {
  const projectArg = arg('project', process.env.FIREBASE_PROJECT || process.env.GCLOUD_PROJECT || 'bob20250810');
  const uid = arg('uid', null);
  const dryRun = parseBool(arg('dry-run', false), false);
  const todayIso = new Date().toISOString().slice(0, 10);

  init(projectArg);
  const db = admin.firestore();

  console.log(`Cleanup stale Top 3 state (project=${projectArg}, uid=${uid || 'ALL'}, dryRun=${dryRun}, today=${todayIso})`);

  const ownerUids = await listOwnerUids(db, uid);
  if (!ownerUids.length) {
    console.log('No users found. Nothing to do.');
    return;
  }

  let totals = {
    users: ownerUids.length,
    scannedTasks: 0,
    scannedStories: 0,
    taskUpdates: 0,
    storyUpdates: 0,
  };

  for (const ownerUid of ownerUids) {
    const result = await cleanupOwner(db, ownerUid, { dryRun, todayIso });
    totals.scannedTasks += result.scannedTasks;
    totals.scannedStories += result.scannedStories;
    totals.taskUpdates += result.taskUpdates;
    totals.storyUpdates += result.storyUpdates;
    if (result.taskUpdates || result.storyUpdates) {
      console.log(`  ${ownerUid}: tasks ${result.taskUpdates}/${result.scannedTasks}, stories ${result.storyUpdates}/${result.scannedStories}`);
    }
  }

  console.log('Cleanup complete.');
  console.log(JSON.stringify(totals, null, 2));
}

main().catch((error) => {
  console.error('Cleanup failed:', error?.message || error);
  process.exit(1);
});
