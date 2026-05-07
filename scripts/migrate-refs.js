#!/usr/bin/env node
'use strict';
/**
 * One-time migration: normalise story and task refs to canonical ST-NNNNN / TK-NNNNN format.
 * Usage:
 *   node scripts/migrate-refs.js            # dry run (no writes)
 *   node scripts/migrate-refs.js --write    # apply changes
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const DRY_RUN = !process.argv.includes('--write');
const SA_PATH = path.join(
  process.env.HOME,
  'Library/Mobile Documents/com~apple~CloudDocs/secret/bob/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json'
);

if (!fs.existsSync(SA_PATH)) {
  console.error('Service account not found:', SA_PATH);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
const db = admin.firestore();

const VALID_ST = /^ST-\d{5}$/;
const VALID_TK = /^TK-\d{5}$/;

function makeCandidate(prefix) {
  const n = 10000 + ((Date.now() + Math.floor(Math.random() * 9999)) % 90000);
  return `${prefix}-${n}`;
}

async function uniqueRef(prefix, collection, ownerUid, used) {
  for (let i = 0; i < 15; i++) {
    const c = makeCandidate(prefix);
    if (used.has(c)) continue;
    const snap = await db.collection(collection)
      .where('ownerUid', '==', ownerUid)
      .where('ref', '==', c)
      .limit(1)
      .get();
    if (snap.empty) { used.add(c); return c; }
  }
  const fallback = `${prefix}-${10000 + (Date.now() % 90000)}`;
  used.add(fallback);
  return fallback;
}

async function migrateCollection(colName, prefix, validPattern) {
  console.log(`\n--- ${colName.toUpperCase()} ---`);
  const usedRefs = new Set();

  const all = await db.collection(colName).get();
  const bad = all.docs.filter(d => !validPattern.test(d.data().ref || ''));
  console.log(`Total docs: ${all.size}  |  Non-canonical: ${bad.length}`);

  if (bad.length === 0) { console.log('Nothing to fix.'); return; }

  // Seed used set with all existing canonical refs to avoid collisions
  all.docs.forEach(d => { const r = d.data().ref; if (validPattern.test(r)) usedRefs.add(r); });

  let fixed = 0;
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;
  const log = [];

  for (const docSnap of bad) {
    const data = docSnap.data();
    const oldRef = data.ref || '(none)';
    const ownerUid = data.ownerUid || '';
    const newRef = await uniqueRef(prefix, colName, ownerUid, usedRefs);

    log.push({ id: docSnap.id, old: oldRef, new: newRef });
    console.log(`  ${docSnap.id.slice(0, 16)}  ${oldRef.padEnd(28)} → ${newRef}`);

    if (!DRY_RUN) {
      batch.update(docSnap.ref, {
        ref: newRef,
        refMigratedFrom: oldRef,
        refMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
        process.stdout.write('.');
      }
    }
    fixed++;
  }

  if (!DRY_RUN && batchCount > 0) await batch.commit();

  console.log(`\n${DRY_RUN ? '[DRY RUN] Would fix' : 'Fixed'} ${fixed} ${colName}.`);
}

(async () => {
  if (DRY_RUN) {
    console.log('=== DRY RUN — pass --write to apply ===');
  } else {
    console.log('=== WRITE MODE — applying changes ===');
  }

  await migrateCollection('stories', 'ST', VALID_ST);
  await migrateCollection('tasks',   'TK', VALID_TK);
  await migrateCollection('goals',   'GR', /^GR-\d{5}$/);

  console.log('\nDone.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
