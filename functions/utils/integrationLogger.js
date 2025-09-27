const admin = require('firebase-admin');

/**
 * Write a structured integration log entry to Firestore.
 * Fields: ownerUid, source, level, step, message, meta, ts, correlationId
 */
async function logIntegration({ uid, source, level = 'info', step, message, meta = null, correlationId = null }) {
  try {
    const db = admin.firestore();
    const doc = {
      ownerUid: uid || null,
      source: String(source || 'unknown').toLowerCase(),
      level: String(level || 'info').toLowerCase(),
      step: step || null,
      message: message || null,
      meta: meta || null,
      correlationId: correlationId || null,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('integration_logs').add(doc);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[integrationLogger] failed', e);
  }
}

module.exports = { logIntegration };

