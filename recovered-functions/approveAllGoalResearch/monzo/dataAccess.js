const admin = require('firebase-admin');

async function loadIncomeOverrides(db, uid) {
  try {
    const snap = await db.collection('monzo_income_overrides').doc(uid).get();
    if (!snap.exists) return {};
    const data = snap.data() || {};
    return data.sources || {};
  } catch (error) {
    console.warn('Failed to load income overrides', { uid, error: error?.message || error });
    return {};
  }
}

async function saveIncomeSourcesSnapshot(db, uid, sources) {
  try {
    await db.collection('monzo_income_sources').doc(uid).set({
      ownerUid: uid,
      sources,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.warn('Failed to write income sources snapshot', { uid, error: error?.message || error });
  }
}

async function loadSubscriptionOverrides(db, uid) {
  try {
    const snap = await db.collection('monzo_subscription_overrides').doc(uid).get();
    if (!snap.exists) return {};
    const data = snap.data() || {};
    return data.overrides || {};
  } catch (error) {
    console.warn('Failed to load subscription overrides', { uid, error: error?.message || error });
    return {};
  }
}

async function saveSubscriptionRecommendations(db, uid, recommendations) {
  try {
    await db.collection('monzo_subscription_recommendations').doc(uid).set({
      ownerUid: uid,
      recommendations,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.warn('Failed to write subscription recommendations', { uid, error: error?.message || error });
  }
}

module.exports = {
  loadIncomeOverrides,
  saveIncomeSourcesSnapshot,
  loadSubscriptionOverrides,
  saveSubscriptionRecommendations,
};
