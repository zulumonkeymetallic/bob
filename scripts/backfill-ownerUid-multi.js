#!/usr/bin/env node
/*
 Backfill ownerUid from userId across key collections.
 Usage:
   node scripts/backfill-ownerUid-multi.js --serviceAccount=/absolute/path/to/serviceAccount.json [--batchSize=400]
*/
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { batchSize: 400 };
  for (const a of args) {
    const [k, v] = a.split('=');
    if (k === '--serviceAccount') out.serviceAccount = v;
    if (k === '--batchSize') out.batchSize = Number(v || 400) || 400;
  }
  return out;
}

async function initAdmin(saPath) {
  if (saPath) {
    const absolute = path.resolve(saPath);
    if (!fs.existsSync(absolute)) throw new Error(`Service account file not found: ${absolute}`);
    const creds = require(absolute);
    admin.initializeApp({ credential: admin.credential.cert(creds) });
  } else {
    // Fallback to ADC if configured
    admin.initializeApp();
  }
  return admin.firestore();
}

async function backfillCollection(db, coll, batchSize) {
  console.log(`\n[${coll}] scanning…`);
  let processed = 0;
  let updated = 0;
  let lastDoc = null;
  let page = 0;
  do {
    let q = db.collection(coll).orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
    if (lastDoc) q = q.startAfter(lastDoc.id);
    const snap = await q.get();
    page++;
    if (snap.empty) break;
    const batch = db.batch();
    let writes = 0;
    snap.docs.forEach((d) => {
      processed++;
      const data = d.data() || {};
      if (!data.ownerUid && data.userId) {
        batch.set(d.ref, { ownerUid: data.userId }, { merge: true });
        writes++;
      }
    });
    if (writes) {
      await batch.commit();
      updated += writes;
      console.log(`[${coll}] page ${page}: committed ${writes} updates (processed ${processed})`);
    } else {
      console.log(`[${coll}] page ${page}: no updates (processed ${processed})`);
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  } while (true);
  console.log(`[${coll}] done. processed=${processed}, updated=${updated}`);
  return { processed, updated };
}

(async () => {
  try {
    const { serviceAccount, batchSize } = parseArgs();
    const db = await initAdmin(serviceAccount);
    const targets = [
      'planning_jobs',
      'ai_usage_logs',
      'daily_summaries',
      'data_quality_reports',
    ];
    const results = {};
    for (const coll of targets) {
      results[coll] = await backfillCollection(db, coll, batchSize);
    }
    console.log('\nBackfill complete:', results);
    process.exit(0);
  } catch (e) {
    console.error('Backfill failed:', e?.message || e);
    process.exit(1);
  }
})();

