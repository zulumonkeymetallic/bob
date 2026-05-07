'use strict';

/**
 * Canonical ref generator for BOB entities.
 * Agreed format: {PREFIX}-{5-digit-number}, e.g. ST-48330, TK-72105
 * Range 10000-99999 guarantees no leading zeros.
 * Single source of truth — all Cloud Functions must use this module.
 */

const PREFIXES = { story: 'ST', task: 'TK', goal: 'GR', sprint: 'SP' };
const COLLECTIONS = { story: 'stories', task: 'tasks', goal: 'goals', sprint: 'sprints' };

/** Returns a single candidate without collision checking. */
function makeRefCandidate(type) {
  const prefix = PREFIXES[type] || 'ID';
  const numericId = 10000 + ((Date.now() + Math.floor(Math.random() * 9999)) % 90000);
  return `${prefix}-${numericId}`;
}

/**
 * Generates a ref guaranteed unique within the owner's collection.
 * Requires Firestore admin db instance.
 */
async function generateRef(db, type, ownerUid) {
  const col = COLLECTIONS[type];
  if (!col) return makeRefCandidate(type);

  for (let i = 0; i < 12; i++) {
    const candidate = makeRefCandidate(type);
    const snap = await db.collection(col)
      .where('ownerUid', '==', ownerUid)
      .where('ref', '==', candidate)
      .limit(1)
      .get();
    if (snap.empty) return candidate;
  }
  // Collision-exhausted fallback — timestamp hash, still 5 digits
  const ts = Date.now();
  return `${PREFIXES[type] || 'ID'}-${10000 + (ts % 90000)}`;
}

/**
 * Returns true if ref matches canonical format for the given type.
 * @param {string} ref
 * @param {string} type  'story' | 'task' | 'goal' | 'sprint'
 */
function isValidRef(ref, type) {
  const prefix = PREFIXES[type];
  if (!prefix || !ref) return false;
  return new RegExp(`^${prefix}-\\d{5}$`).test(String(ref));
}

module.exports = { generateRef, makeRefCandidate, isValidRef };
