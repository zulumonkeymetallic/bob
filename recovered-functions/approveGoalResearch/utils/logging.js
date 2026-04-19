const admin = require("firebase-admin");

const LOG_RETENTION_DAYS = 30;

const createExpiryTimestamp = (days = LOG_RETENTION_DAYS) => {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return admin.firestore.Timestamp.fromDate(expiresAt);
};

async function recordIntegrationLog(uid, integration, status, message, metadata = {}) {
  try {
    const db = admin.firestore();
    const ref = db.collection('integration_logs').doc();
    const level = status === 'error' ? 'error' : (status === 'warning' ? 'warning' : 'info');
    const expiresAt = createExpiryTimestamp();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      id: ref.id,
      ownerUid: uid,
      integration,
      status,
      level,
      source: integration,
      message,
      metadata,
      createdAt: now,
      ts: now,
      expiresAt,
    });
  } catch (error) {
    console.error('Failed to write integration log', { integration, status, message, metadata, error });
  }
}

async function recordAiLog(uid, event, status, message, metadata = {}) {
  try {
    const db = admin.firestore();
    const ref = db.collection('ai_logs').doc();
    const level = status === 'error' ? 'error' : (status === 'warning' ? 'warning' : 'info');
    const expiresAt = createExpiryTimestamp();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      id: ref.id,
      ownerUid: uid,
      event,
      status,
      level,
      message,
      metadata,
      createdAt: now,
      ts: now,
      expiresAt,
    });
  } catch (error) {
    console.error('Failed to write AI log', { event, status, message, metadata, error });
  }
}

module.exports = { recordIntegrationLog, recordAiLog };
