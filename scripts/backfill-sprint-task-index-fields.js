#!/usr/bin/env node
/*
 Backfill sprint_task_index with task type/recurrence fields.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
   node scripts/backfill-sprint-task-index-fields.js [--project bob20250810] [--uid <ownerUid>] [--dry-run]
*/

const admin = require('firebase-admin');

function init() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || undefined,
    });
  }
}

function arg(name, def = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

async function main() {
  init();
  const db = admin.firestore();
  const targetUid = arg('uid', null);
  const dryRun = arg('dry-run', false) === true || String(arg('dry-run', false)).toLowerCase() === 'true';

  console.log(`🔧 Backfill sprint_task_index fields (dryRun=${!!dryRun}, ownerUid=${targetUid || 'ALL'})`);

  let q = db.collection('tasks');
  if (targetUid) q = q.where('ownerUid', '==', targetUid);

  const snap = await q.get();
  const updates = [];

  for (const d of snap.docs) {
    const data = d.data() || {};
    updates.push({
      id: d.id,
      data: {
        type: data.type ?? null,
        repeatFrequency: data.repeatFrequency ?? null,
        repeatInterval: data.repeatInterval ?? null,
        daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [],
        lastDoneAt: data.lastDoneAt || null,
        snoozedUntil: data.snoozedUntil || null,
        aiTop3Reason: data.aiTop3Reason ?? data.aiPriorityReason ?? null,
        updatedAt: Date.now(),
      },
    });
  }

  console.log(`Found ${updates.length} tasks to sync.`);
  if (dryRun || updates.length === 0) {
    console.log('Dry run complete.');
    return;
  }

  const batchSize = 400;
  let committed = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + batchSize)) {
      batch.set(db.collection('sprint_task_index').doc(u.id), u.data, { merge: true });
    }
    await batch.commit();
    committed += Math.min(batchSize, updates.length - i);
    console.log(`  committed ${committed}/${updates.length}`);
  }

  console.log('✅ Backfill complete.');
}

main().catch((e) => {
  console.error('Backfill failed:', e?.message || e);
  process.exit(1);
});
