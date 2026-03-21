'use strict';

/**
 * agentAudit.js
 *
 * Shared audit and idempotency helpers for the BOB Agent Integration Layer.
 *
 * Collections written:
 *   agent_action_log/{actionId}  — one document per agent tool call
 *   agent_idempotency_keys/{key} — deduplication index (TTL-deleted after 24h)
 *
 * All writes use the Admin SDK and are NOT accessible via Firestore client rules.
 */

const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const ACTION_LOG_COLLECTION = 'agent_action_log';
const IDEMPOTENCY_COLLECTION = 'agent_idempotency_keys';

/**
 * @typedef {Object} AgentActionParams
 * @property {string}  ownerUid         - Firebase UID of the user this action affects
 * @property {'telegram'|'api'|'scheduled'} source - Where the action originated
 * @property {string}  tool             - Tool name, e.g. 'capture_task'
 * @property {string|null} [intent]     - Matched natural language intent (Telegram free text)
 * @property {object}  [requestPayload] - Sanitised request parameters (no secrets)
 * @property {'ok'|'error'|'pending_approval'|'rejected'|'expired'} responseStatus
 * @property {object}  [responsePayload] - Sanitised tool output
 * @property {string|null} [approvalId] - Links to pending_approvals document if relevant
 * @property {'approved'|'rejected'|'expired'|null} [approvalDecision]
 * @property {number|null} [llmTokensUsed]
 * @property {number}  durationMs       - Wall-clock time for the tool call in ms
 * @property {number|null} [telegramChatId]
 * @property {number|null} [telegramMessageId]
 * @property {string|null} [idempotencyKey]
 * @property {string|null} [errorMessage]
 */

/**
 * Write a structured entry to agent_action_log.
 *
 * Returns the new document ID so callers can reference the log entry in
 * downstream operations (e.g. linking an approval to its originating action).
 *
 * @param {AgentActionParams} params
 * @returns {Promise<string>} actionId
 */
async function logAgentAction(params) {
  const db = admin.firestore();
  const actionId = uuidv4();

  const doc = {
    ownerUid:         params.ownerUid         || null,
    source:           params.source            || 'api',
    tool:             params.tool              || 'unknown',
    intent:           params.intent            || null,
    requestPayload:   _sanitise(params.requestPayload),
    responseStatus:   params.responseStatus    || 'ok',
    responsePayload:  _sanitise(params.responsePayload),
    approvalId:       params.approvalId        || null,
    approvalDecision: params.approvalDecision  || null,
    llmTokensUsed:    params.llmTokensUsed     || null,
    durationMs:       params.durationMs        || 0,
    telegramChatId:   params.telegramChatId    || null,
    telegramMessageId:params.telegramMessageId || null,
    idempotencyKey:   params.idempotencyKey    || null,
    errorMessage:     params.errorMessage      || null,
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await db.collection(ACTION_LOG_COLLECTION).doc(actionId).set(doc);
  } catch (err) {
    // Audit logging must never throw — log to Cloud Logging only.
    console.error('[agentAudit] Failed to write agent_action_log:', err?.message || err);
  }

  return actionId;
}

/**
 * Check whether an idempotency key has already been resolved.
 *
 * If it has, return { isDuplicate: true, resolvedActionId }.
 * If it has not, reserve it atomically and return { isDuplicate: false }.
 *
 * The key document is set to expire after 24 hours via Firestore TTL policy
 * on the `expiresAt` field (must be configured in Firebase console).
 *
 * @param {string} key        - The idempotency key provided by the caller
 * @param {string} ownerUid   - Firebase UID (prevents cross-user key collisions)
 * @param {string} tool       - Tool name
 * @returns {Promise<{isDuplicate: boolean, resolvedActionId?: string}>}
 */
async function resolveIdempotency(key, ownerUid, tool) {
  if (!key) return { isDuplicate: false };

  const db = admin.firestore();
  // Namespace the key by ownerUid to prevent cross-user collision.
  const docId = `${ownerUid}_${key}`;
  const ref = db.collection(IDEMPOTENCY_COLLECTION).doc(docId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        return { isDuplicate: true, resolvedActionId: snap.data().resolvedActionId };
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h
      tx.set(ref, {
        key,
        ownerUid,
        tool,
        resolvedActionId: null, // filled in after action completes
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      });

      return { isDuplicate: false };
    });

    return result;
  } catch (err) {
    console.error('[agentAudit] resolveIdempotency error:', err?.message || err);
    // On error, allow the operation through (fail open to avoid blocking the user).
    return { isDuplicate: false };
  }
}

/**
 * After an action completes, backfill the resolvedActionId onto the
 * idempotency key document so future duplicate checks can surface it.
 *
 * @param {string} key
 * @param {string} ownerUid
 * @param {string} actionId
 */
async function commitIdempotencyKey(key, ownerUid, actionId) {
  if (!key) return;
  const db = admin.firestore();
  const docId = `${ownerUid}_${key}`;
  try {
    await db.collection(IDEMPOTENCY_COLLECTION).doc(docId).update({ resolvedActionId: actionId });
  } catch (err) {
    console.error('[agentAudit] commitIdempotencyKey error:', err?.message || err);
  }
}

/**
 * Sanitise a payload object before storing in Firestore:
 * - Truncate string values longer than 500 characters
 * - Remove keys that look like secrets (token, secret, key, password)
 * - Return empty object if input is null/undefined
 */
function _sanitise(obj) {
  if (!obj || typeof obj !== 'object') return {};

  const SECRET_KEYS = /^(token|secret|key|password|api_key|auth|credential)$/i;
  const result = {};

  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) continue;
    if (typeof v === 'string' && v.length > 500) {
      result[k] = v.slice(0, 500) + '…';
    } else {
      result[k] = v;
    }
  }

  return result;
}

module.exports = { logAgentAction, resolveIdempotency, commitIdempotencyKey };
