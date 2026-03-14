#!/usr/bin/env node
/**
 * Backfill or clamp story.points values to numeric quarter-step points.
 *
 * Usage:
 *   node scripts/backfill-story-points.js --serviceAccount=/abs/path/to/serviceAccount.json [--batchSize=400] [--dryRun]
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const POINTS_MIN = 0.25;
const POINTS_MAX = 13;
const POINTS_STEP = 0.25;

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

function clampStoryPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const bounded = Math.max(POINTS_MIN, Math.min(POINTS_MAX, numeric));
  const snapped = Math.round(bounded / POINTS_STEP) * POINTS_STEP;
  return Number(snapped.toFixed(2));
}

function deriveStoryPoints(payload = {}) {
  const estimateMin = Number(payload.estimateMin || payload.estimatedMinutes || 0);
  if (Number.isFinite(estimateMin) && estimateMin > 0) {
    return clampStoryPoints(estimateMin / 60) ?? 1;
  }
  const estimatedHours = Number(payload.estimatedHours || payload.estimated_hours || 0);
  if (Number.isFinite(estimatedHours) && estimatedHours > 0) {
    return clampStoryPoints(estimatedHours) ?? 1;
  }
  const effort = String(payload.effort || '').trim().toUpperCase();
  if (effort === 'XS') return 0.5;
  if (effort === 'S') return 1;
  if (effort === 'M') return 2;
  if (effort === 'L') return 4;
  if (effort === 'XL') return 6;
  return 1;
}

async function backfillPoints(db, { batchSize, dryRun }) {
  console.log(`Scanning stories… batchSize=${batchSize} dryRun=${dryRun}`);
  let processed = 0;
  let updated = 0;
  let lastDoc = null;

  while (true) {
    let q = db.collection('stories').orderBy(admin.firestore.FieldPath.documentId()).limit(batchSize);
    if (lastDoc) q = q.startAfter(lastDoc.id);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let writesInBatch = 0;

    for (const docSnap of snap.docs) {
      processed++;
      const data = docSnap.data() || {};
      const normalized = clampStoryPoints(data.points);
      const desired = normalized != null ? normalized : deriveStoryPoints(data);
      const existing = Number(data.points);
      const storedAsNumber = typeof data.points === 'number' && Number.isFinite(data.points);

      if (!Number.isFinite(desired)) continue;
      if (storedAsNumber && Number.isFinite(existing) && existing === desired) continue;

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
