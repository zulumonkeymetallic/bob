const admin = require('firebase-admin');

function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

const MAX_READS = Number(process.env.FUNCTIONS_MAX_READS || 10000);
const MAX_WRITES = Number(process.env.FUNCTIONS_MAX_WRITES || 10000);

async function ensureBudget(db, scope = 'global', estimate = { reads: 0, writes: 0 }) {
  const key = `${scope}__${dayKey()}`;
  const ref = db.collection('function_usage').doc(key);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let reads = 0, writes = 0, currentDay = dayKey();
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.dayKey === currentDay) { reads = Number(d.reads || 0); writes = Number(d.writes || 0); }
    }
    const nextReads = reads + Number(estimate.reads || 0);
    const nextWrites = writes + Number(estimate.writes || 0);
    if (nextReads > MAX_READS || nextWrites > MAX_WRITES) {
      const err = new Error('resource-exhausted: function daily budget exceeded');
      err.code = 'resource-exhausted';
      throw err;
    }
    tx.set(ref, {
      id: key,
      scope,
      dayKey: currentDay,
      reads: nextReads,
      writes: nextWrites,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function increment(db, scope = 'global', delta = { reads: 0, writes: 0 }) {
  const key = `${scope}__${dayKey()}`;
  const ref = db.collection('function_usage').doc(key);
  await ref.set({
    id: key,
    scope,
    dayKey: dayKey(),
    reads: admin.firestore.FieldValue.increment(Number(delta.reads || 0)),
    writes: admin.firestore.FieldValue.increment(Number(delta.writes || 0)),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = { dayKey, ensureBudget, increment, MAX_READS, MAX_WRITES };

