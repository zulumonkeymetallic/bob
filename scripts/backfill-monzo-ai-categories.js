/**
 * Flag Monzo transactions for AI categorisation backfill.
 *
 * Usage:
 *   node scripts/backfill-monzo-ai-categories.js --uid <UID> --days 365 --limit 1000
 *
 * Service account path is expected to be local only (not committed).
 */

const admin = require('firebase-admin');

const serviceAccountPath = '/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json';
const projectId = 'bob20250810';

const args = process.argv.slice(2);
const argVal = (flag, fallback) => {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
};

const uid = argVal('--uid', '');
const days = Number(argVal('--days', '365'));
const limit = Number(argVal('--limit', '1000'));

if (!uid) {
  console.error('Missing --uid <firebase-auth-uid>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  projectId,
});

const db = admin.firestore();

async function main() {
  const start = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const startTs = admin.firestore.Timestamp.fromDate(start);
  const snap = await db.collection('monzo_transactions')
    .where('ownerUid', '==', uid)
    .where('createdAt', '>=', startTs)
    .orderBy('createdAt', 'desc')
    .limit(Math.max(1, Math.min(limit, 5000)))
    .get();

  console.log(`Found ${snap.size} transactions in last ${days} days`);
  if (snap.empty) return;

  const batch = db.batch();
  let updated = 0;
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.aiCategoryKey || data.needsAiCategorization) return;
    batch.update(doc.ref, { needsAiCategorization: true });
    updated += 1;
  });

  if (updated > 0) {
    await batch.commit();
  }

  console.log(`Flagged ${updated} transactions for AI categorisation.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Backfill failed', err);
  process.exit(1);
});
