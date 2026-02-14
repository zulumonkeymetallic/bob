#!/usr/bin/env node
/*
 Backfill aiTop3Reason from legacy aiPriorityReason for tasks and stories.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
   node scripts/backfill-ai-top3-reason.js [--project bob20250810] [--uid <ownerUid>] [--dry-run]
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

async function backfillCollection(db, name, targetUid, dryRun) {
  let q = db.collection(name);
  if (targetUid) q = q.where('ownerUid', '==', targetUid);
  const snap = await q.get();

  const updates = [];
  for (const d of snap.docs) {
    const data = d.data() || {};
    const legacy = data.aiPriorityReason;
    const current = data.aiTop3Reason;
    if (legacy && !current) {
      updates.push({ ref: d.ref, legacy });
    }
  }

  console.log(`  ${name}: ${updates.length} to update`);
  if (dryRun || updates.length === 0) return;

  const batchSize = 400;
  let committed = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + batchSize)) {
      batch.set(u.ref, {
        aiTop3Reason: u.legacy,
        aiPriorityReason: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    committed += Math.min(batchSize, updates.length - i);
    console.log(`    committed ${committed}/${updates.length}`);
  }
}

async function main() {
  init();
  const db = admin.firestore();
  const targetUid = arg('uid', null);
  const dryRun = arg('dry-run', false) === true || String(arg('dry-run', false)).toLowerCase() === 'true';

  console.log(`🔧 Backfill aiTop3Reason (dryRun=${!!dryRun}, ownerUid=${targetUid || 'ALL'})`);
  await backfillCollection(db, 'tasks', targetUid, dryRun);
  await backfillCollection(db, 'stories', targetUid, dryRun);
  console.log('✅ Backfill complete.');
}

main().catch((e) => {
  console.error('Backfill failed:', e?.message || e);
  process.exit(1);
});
