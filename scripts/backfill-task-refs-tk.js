#!/usr/bin/env node
/*
 Ensure all task refs use TK- prefix.

 What it does
 - If a task has no ref, set ref to TK-<last6(id) zero-padded>.
 - If a task has a non-TK prefix (e.g. TASK-…), rewrite to TK-…
 - Leaves existing TK- refs untouched.

 Usage:
   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json node scripts/backfill-task-refs-tk.js [--project bob20250810] [--uid <ownerUid>] [--dry-run]
*/

const admin = require('firebase-admin');

function init() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || undefined });
  }
}

function arg(name, def = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

function makeTkRefFromId(id) {
  const last6 = String(id).slice(-6).toUpperCase();
  const padded = last6.padStart(6, '0');
  return `TK-${padded}`;
}

async function main() {
  init();
  const db = admin.firestore();
  const targetUid = arg('uid', null);
  const dryRun = arg('dry-run', false) === true || String(arg('dry-run', false)).toLowerCase() === 'true';

  console.log(`🔧 Backfill task refs → TK- (dryRun=${!!dryRun}, ownerUid=${targetUid || 'ALL'})`);

  let q = db.collection('tasks');
  if (targetUid) q = q.where('ownerUid', '==', targetUid);
  const snap = await q.get();

  const updates = [];
  let alreadyOk = 0;
  for (const d of snap.docs) {
    const data = d.data() || {};
    const ref = (data.ref || data.reference || '').trim();
    if (ref.startsWith('TK-')) { alreadyOk++; continue; }
    let newRef = ref;
    if (!ref) {
      newRef = makeTkRefFromId(d.id);
    } else if (ref.startsWith('TASK-')) {
      const suffix = ref.slice('TASK-'.length).replace(/[^A-Z0-9]/g, '').toUpperCase();
      newRef = `TK-${suffix || String(d.id).slice(-6).toUpperCase().padStart(6, '0')}`;
    } else {
      // Any other format → normalize from id
      newRef = makeTkRefFromId(d.id);
    }
    if (newRef !== ref && newRef) {
      updates.push({ refDoc: d.ref, newRef });
    }
  }

  console.log(`Found ${updates.length} to update, ${alreadyOk} already TK-`);
  if (dryRun || updates.length === 0) {
    console.log('Dry run complete.');
    return;
  }

  const batchSize = 400;
  let committed = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const b = db.batch();
    for (const u of updates.slice(i, i + batchSize)) {
      b.set(u.refDoc, { ref: u.newRef, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    await b.commit();
    committed += Math.min(batchSize, updates.length - i);
    console.log(`  committed ${committed}/${updates.length}`);
  }

  console.log('✅ Backfill complete.');
}

main().catch((e) => {
  console.error('Backfill failed:', e?.message || e);
  process.exit(1);
});

