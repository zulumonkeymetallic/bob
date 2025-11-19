#!/usr/bin/env node
/**
 * Backfill or clamp task.points values.
 *
 * Usage:
 *   node scripts/backfill-task-points.js --serviceAccount=/abs/path/to/serviceAccount.json [--batchSize=400] [--dryRun]
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { clampTaskPoints, deriveTaskPoints } = require('../functions/utils/taskPoints');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { batchSize: 400, dryRun: false };
  for (const arg of args) {
    if (arg.startsWith('--serviceAccount=')) parsed.serviceAccount = arg.split('=')[1];
    else if (arg.startsWith('--batchSize=')) parsed.batchSize = Number(arg.split('=')[1]) || 400;
    else if (arg === '--dryRun') parsed.dryRun = true;
  }
  return parsed;
}

function initAdmin(serviceAccountPath) {
  if (serviceAccountPath) {
    const absolute = path.resolve(serviceAccountPath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Service account file not found: ${absolute}`);
    }
    const creds = require(absolute);
    admin.initializeApp({ credential: admin.credential.cert(creds) });
  } else {
    admin.initializeApp();
  }
  return admin.firestore();
}

async function backfillPoints(db, { batchSize, dryRun }) {
  console.log(`Scanning tasks… batchSize=${batchSize} dryRun=${dryRun}`);
  let processed = 0;
  let updated = 0;
  let lastDoc = null;

  while (true) {
    let q = db.collection('tasks').orderBy(admin.firestore.FieldPath.documentId()).limit(batchSize);
    if (lastDoc) q = q.startAfter(lastDoc.id);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let writesInBatch = 0;
    for (const docSnap of snap.docs) {
      processed++;
      const data = docSnap.data() || {};
      const normalized = clampTaskPoints(data.points);
      const desired = (normalized != null ? normalized : deriveTaskPoints(data));
      const existing = Number(data.points);

      if (!Number.isFinite(desired)) continue;
      if (Number.isFinite(existing) && existing === desired) continue;

      updated++;
      console.log(`- ${docSnap.id}: ${existing || '∅'} → ${desired}`);
      if (!dryRun) {
        batch.set(docSnap.ref, {
          points: desired,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        writesInBatch++;
      }
    }

    if (!dryRun && writesInBatch) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < batchSize) break;
  }

  return { processed, updated, dryRun };
}

(async () => {
  try {
    const args = parseArgs();
    const db = initAdmin(args.serviceAccount);
    const result = await backfillPoints(db, args);
    console.log('\nBackfill complete:', result);
    process.exit(0);
  } catch (err) {
    console.error('Backfill failed:', err?.message || err);
    process.exit(1);
  }
})();
