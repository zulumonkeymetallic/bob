/**
 * Backfill ownerUid on Monzo collections to satisfy Firestore rules.
 *
 * Usage:
 *   node scripts/backfill-monzo-ownerUid.js
 *
 * Uses the local service account:
 *   /Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json
 */

const path = require('path');
const admin = require('firebase-admin');

const serviceAccountPath = '/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json';
const projectId = 'bob20250810';

const app = admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  projectId,
});

const db = admin.firestore();

const collections = [
  'monzo_transactions',
  'monzo_pots',
  'monzo_accounts',
  'monzo_budget_summary',
  'monzo_goal_alignment',
];

function deriveUidFromId(id) {
  if (!id) return null;
  const parts = String(id).split('_');
  return parts[0] || null;
}

async function backfillCollection(colName) {
  const snap = await db.collection(colName).where('ownerUid', '==', null).get();
  console.log(`[${colName}] found ${snap.size} docs missing ownerUid`);
  if (snap.empty) return 0;
  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const uid = data.ownerUid || deriveUidFromId(doc.id);
    if (!uid) {
      console.warn(`[${colName}] skip ${doc.id} - cannot derive ownerUid`);
      continue;
    }
    await doc.ref.set({ ownerUid: uid }, { merge: true });
    updated += 1;
  }
  console.log(`[${colName}] updated ${updated}`);
  return updated;
}

async function main() {
  let total = 0;
  for (const col of collections) {
    total += await backfillCollection(col);
  }
  console.log(`Backfill complete. Updated ${total} documents.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed', err);
  process.exit(1);
});
