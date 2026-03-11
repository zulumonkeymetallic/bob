const httpsV2 = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

function toDeferDate(daysAhead = 1) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(1, Number(daysAhead) || 1));
  return d;
}

const applyCapacityDeferrals = httpsV2.onCall({ region: 'europe-west2', memory: '512MiB' }, async (req) => {
  if (!req.auth?.uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = req.auth.uid;
  const items = Array.isArray(req.data?.items) ? req.data.items : [];
  const reason = String(req.data?.reason || 'capacity_overbooked');
  const daysAhead = Number(req.data?.daysAhead || 1);
  const dryRun = req.data?.dryRun === true;

  if (!items.length) {
    throw new httpsV2.HttpsError('invalid-argument', 'items array is required');
  }

  const deferDate = toDeferDate(daysAhead);
  const deferTs = admin.firestore.Timestamp.fromDate(deferDate);
  const db = admin.firestore();

  let updated = 0;
  const skipped = [];

  for (const item of items) {
    const sourceType = String(item?.sourceType || '').toLowerCase();
    const sourceId = String(item?.sourceId || '').trim();
    if (!sourceId) continue;

    const collection = sourceType === 'story' ? 'stories' : (sourceType === 'task' ? 'tasks' : null);
    if (!collection) {
      skipped.push({ sourceType, sourceId, reason: 'unsupported_type' });
      continue;
    }

    const ref = db.collection(collection).doc(sourceId);
    const snap = await ref.get();
    if (!snap.exists) {
      skipped.push({ sourceType, sourceId, reason: 'missing_doc' });
      continue;
    }
    const data = snap.data() || {};
    if (String(data.ownerUid || '') !== uid) {
      skipped.push({ sourceType, sourceId, reason: 'owner_mismatch' });
      continue;
    }

    if (!dryRun) {
      await ref.set({
        deferredUntil: deferTs,
        deferredReason: reason,
        deferredBy: 'capacity_engine',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    updated += 1;
  }

  await db.collection('capacity_deferral_runs').add({
    ownerUid: uid,
    itemsRequested: items.length,
    itemsUpdated: updated,
    itemsSkipped: skipped.length,
    skipped,
    reason,
    deferUntil: deferTs,
    dryRun,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    updated,
    skipped,
    deferUntilIso: deferDate.toISOString(),
  };
});

module.exports = {
  applyCapacityDeferrals,
};
