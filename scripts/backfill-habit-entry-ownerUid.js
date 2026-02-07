#!/usr/bin/env node
/*
 Backfill ownerUid on habits/{habitId}/habitEntries/{entryId}.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
   node scripts/backfill-habit-entry-ownerUid.js [--project bob20250810] [--uid <ownerUid>] [--dry-run]
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

  console.log(`🔧 Backfill habitEntries.ownerUid (dryRun=${!!dryRun}, ownerUid=${targetUid || 'ALL'})`);

  let q = db.collection('habits');
  if (targetUid) q = q.where('ownerUid', '==', targetUid);
  const habitsSnap = await q.get();

  let scanned = 0;
  let updates = 0;
  let skipped = 0;

  for (const habitDoc of habitsSnap.docs) {
    const habit = habitDoc.data() || {};
    const ownerUid = habit.ownerUid || null;
    if (!ownerUid) {
      skipped++;
      continue;
    }

    const entriesSnap = await habitDoc.ref.collection('habitEntries').get();
    if (entriesSnap.empty) continue;

    const batchSize = 400;
    const toUpdate = [];

    for (const entryDoc of entriesSnap.docs) {
      scanned++;
      const entry = entryDoc.data() || {};
      if (entry.ownerUid === ownerUid) continue;
      toUpdate.push({ ref: entryDoc.ref, ownerUid });
    }

    if (!toUpdate.length) continue;
    updates += toUpdate.length;

    if (!dryRun) {
      for (let i = 0; i < toUpdate.length; i += batchSize) {
        const batch = db.batch();
        for (const item of toUpdate.slice(i, i + batchSize)) {
          batch.set(item.ref, {
            ownerUid: item.ownerUid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        await batch.commit();
      }
    }
  }

  console.log(`Scanned ${scanned} habit entries, updates=${updates}, skippedHabits=${skipped}`);
  if (dryRun) console.log('Dry run complete.');
  else console.log('✅ Backfill complete.');
}

main().catch((e) => {
  console.error('Backfill failed:', e?.message || e);
  process.exit(1);
});
