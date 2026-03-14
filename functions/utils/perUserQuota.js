/**
 * Per-User Daily AI Call Quota
 *
 * Tracks and enforces daily limits on AI (LLM) function calls per user.
 * Uses a Firestore transaction to atomically increment usage and compare
 * against the user's tier limit before the AI call is made.
 *
 * Usage:
 *   const { checkAndIncrementQuota } = require('./utils/perUserQuota');
 *   const check = await checkAndIncrementQuota(uid, 'priority_now');
 *   if (!check.allowed) throw new HttpsError('resource-exhausted', check.message);
 *
 * Tiers and limits are stored on user_quotas/{uid}_{date}.tier.
 * Admins can override by setting tier = 'admin' or tier = 'paid' on that doc.
 */

const admin = require('firebase-admin');

// Daily AI call limits per tier (in quota units, not raw calls)
const QUOTA_LIMITS = {
  free:  30,   // sensible default for a new free user (~10 priority runs/day)
  paid:  200,  // paid / beta users during rollout
  admin: 2000, // admins and the primary account owner
};

// How many quota units each operation type consumes.
// Heavier LLM operations cost more to prevent someone burning
// all quota with a single expensive call.
const OPERATION_COSTS = {
  priority_now:          2,  // loads ~400 tasks + Gemini call
  replan_day:            5,  // multi-step Gemini replan
  planner_llm:           5,  // full calendar planner LLM
  auto_enrich_tasks:     2,  // one Gemini call per task, but called in batch
  enhance_new_task:      1,  // single task enrichment
  task_story_conversion: 2,  // suggest + optional conversion
  default:               1,
};

const QUOTA_COLLECTION = 'user_quotas';

/**
 * Returns YYYY-MM-DD string for today (UTC).
 */
function todayKey() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Checks the user's daily AI quota and, if allowed, increments it atomically.
 *
 * @param {string} uid - Firebase UID
 * @param {string} [operation='default'] - Operation key from OPERATION_COSTS
 * @returns {Promise<{allowed: boolean, tier: string, currentUsage: number, limit: number, message?: string}>}
 */
async function checkAndIncrementQuota(uid, operation = 'default') {
  if (!uid) return { allowed: false, reason: 'no_uid', message: 'Authentication required' };

  let db;
  try {
    db = admin.firestore();
  } catch {
    // Fail open if Firestore is not available (should not happen in prod)
    console.warn('[quota] Firestore unavailable — failing open');
    return { allowed: true, tier: 'unknown', currentUsage: 0, limit: 0 };
  }

  const cost = OPERATION_COSTS[operation] || OPERATION_COSTS.default;
  const dateKey = todayKey();
  const docId = `${uid}_${dateKey}`;
  const quotaRef = db.collection(QUOTA_COLLECTION).doc(docId);

  try {
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(quotaRef);
      const data = snap.exists ? (snap.data() || {}) : {};
      const currentUsage = Number(data.aiCalls || 0);
      const tier = String(data.tier || 'free');
      const limit = QUOTA_LIMITS[tier] ?? QUOTA_LIMITS.free;

      if (currentUsage + cost > limit) {
        return {
          allowed: false,
          tier,
          currentUsage,
          limit,
          message: `Daily AI quota exceeded (${tier} tier: ${limit} units/day). Try again tomorrow.`,
        };
      }

      const update = {
        uid,
        date: dateKey,
        aiCalls: admin.firestore.FieldValue.increment(cost),
        tier: data.tier || 'free',
        lastOperation: operation,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!snap.exists) {
        update.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
      txn.set(quotaRef, update, { merge: true });

      return { allowed: true, tier, currentUsage: currentUsage + cost, limit };
    });

    return result;
  } catch (err) {
    // Fail open on transaction error — log and continue so a Firestore blip
    // doesn't block all AI calls.
    console.warn('[quota] transaction failed, failing open:', err?.message || err);
    return { allowed: true, tier: 'unknown', currentUsage: 0, limit: 0 };
  }
}

/**
 * Returns the current quota usage for a user without incrementing.
 * Useful for display in admin dashboards.
 */
async function getQuotaUsage(uid) {
  if (!uid) return null;
  try {
    const db = admin.firestore();
    const dateKey = todayKey();
    const snap = await db.collection(QUOTA_COLLECTION).doc(`${uid}_${dateKey}`).get();
    if (!snap.exists) return { aiCalls: 0, tier: 'free', limit: QUOTA_LIMITS.free, date: dateKey };
    const data = snap.data() || {};
    const tier = String(data.tier || 'free');
    return {
      aiCalls: Number(data.aiCalls || 0),
      tier,
      limit: QUOTA_LIMITS[tier] ?? QUOTA_LIMITS.free,
      date: dateKey,
    };
  } catch {
    return null;
  }
}

/**
 * Sets the tier for a user (admin operation — call from trusted server code only).
 */
async function setUserTier(uid, tier) {
  if (!uid || !QUOTA_LIMITS[tier]) throw new Error(`Invalid tier: ${tier}`);
  const db = admin.firestore();
  const dateKey = todayKey();
  await db.collection(QUOTA_COLLECTION).doc(`${uid}_${dateKey}`).set(
    { uid, tier, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

module.exports = { checkAndIncrementQuota, getQuotaUsage, setUserTier, QUOTA_LIMITS, OPERATION_COSTS };
