/**
 * featureFlags.js
 *
 * Lightweight feature-flag system backed by Firestore:
 *   feature_flags/{uid}  — per-user flag overrides
 *   feature_flags/_global — global defaults (no auth required to read from backend)
 *
 * Flags follow the convention: all false by default unless explicitly enabled.
 * Adding a flag here auto-documents what's available.
 *
 * Flag catalogue (name → description):
 *   monzo_goal_cost      – Show Monzo pot balance + funded% on Focus Goal banner
 *   finance_guardrail    – Show discretionary-spend warning on Focus Goal banner
 *   gcal_linker          – Surface "Planned" badge on kanban story cards
 *   intent_broker        – Enable Intent Broker FAB + suggestion flow
 *   capacity_deferral    – Enable capacity deferral suggestions UI
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const DEFAULT_FLAGS = {
  monzo_goal_cost: true,
  finance_guardrail: true,
  gcal_linker: true,
  intent_broker: true,
  capacity_deferral: true,
};

/**
 * getFeatureFlags — callable
 * Returns the resolved flag map for the authenticated user,
 * merging global defaults with per-user overrides.
 */
const getFeatureFlags = onCall({ region: 'europe-west2' }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  const uid = req.auth.uid;
  const db = admin.firestore();

  const [globalSnap, userSnap] = await Promise.all([
    db.collection('feature_flags').doc('_global').get(),
    db.collection('feature_flags').doc(uid).get(),
  ]);

  const globalOverrides = globalSnap.exists ? (globalSnap.data() || {}) : {};
  const userOverrides = userSnap.exists ? (userSnap.data() || {}) : {};

  // Strip Firestore metadata fields
  const strip = (obj) => {
    const copy = { ...obj };
    delete copy.updatedAt;
    delete copy.createdAt;
    delete copy.ownerUid;
    return copy;
  };

  const resolved = {
    ...DEFAULT_FLAGS,
    ...strip(globalOverrides),
    ...strip(userOverrides),
  };

  return { flags: resolved, source: { global: !!globalSnap.exists, userOverride: !!userSnap.exists } };
});

/**
 * setFeatureFlag — callable (admin or self only)
 * Writes a single flag override to feature_flags/{uid} or feature_flags/_global.
 * Scope 'global' requires the caller to have an admin claim (role == 'admin').
 */
const setFeatureFlag = onCall({ region: 'europe-west2' }, async (req) => {
  if (!req.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const { flagName, value, scope = 'user' } = req.data || {};
  if (!flagName || typeof flagName !== 'string') {
    throw new HttpsError('invalid-argument', 'flagName is required');
  }
  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', 'value must be a boolean');
  }

  const db = admin.firestore();

  if (scope === 'global') {
    // Only admins may set global flags
    const token = req.auth.token || {};
    if (token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin role required to set global flags');
    }
    await db.collection('feature_flags').doc('_global').set(
      { [flagName]: value, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { flagName, value, scope: 'global' };
  }

  // User-scoped: can only modify own flags
  const uid = req.auth.uid;
  await db.collection('feature_flags').doc(uid).set(
    { [flagName]: value, ownerUid: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { flagName, value, scope: 'user' };
});

module.exports = { getFeatureFlags, setFeatureFlag, DEFAULT_FLAGS };
