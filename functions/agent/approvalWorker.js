'use strict';

/**
 * approvalWorker.js
 *
 * Approval execution and expiry management for the BOB Agent Integration Layer.
 *
 * Exports:
 *   executeApprovedActions(db, approval, approvalId)  — run approved action list
 *   sweepExpiredApprovals                             — scheduled Cloud Function (every 5 min)
 *
 * Action types supported:
 *   defer_task       — update task dueDate (and optionally deferredUntil)
 *   deprioritise_task — lower task priority to 1 (Low)
 *   create_task      — create a new task document
 *   update_task      — merge-patch an existing task
 *   create_calendar_block  — write a new calendar_blocks document
 *   delete_calendar_block  — soft-delete a calendar_blocks document
 */

const { defineSecret } = require('firebase-functions/params');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

// Declare locally so sweepExpiredApprovals can call the Telegram edit API
// without importing telegramWebhook.js (circular dep + wrong secret context).
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');

const APPROVALS_COLLECTION = 'pending_approvals';
const TELEGRAM_SESSIONS_COLLECTION = 'telegram_sessions';

// ---------------------------------------------------------------------------
// Scheduled sweep — mark expired proposals and optionally edit Telegram messages
// ---------------------------------------------------------------------------

exports.sweepExpiredApprovals = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'UTC',
    region: 'europe-west2',
    memory: '256MiB',
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const expiredSnap = await db.collection(APPROVALS_COLLECTION)
      .where('status', '==', 'pending')
      .where('expiresAt', '<', now)
      .limit(50)
      .get()
      .catch((e) => {
        console.error('[approvalWorker] sweep query failed:', e?.message);
        return { docs: [] };
      });

    if (!expiredSnap.docs.length) return;

    console.log(`[approvalWorker] Expiring ${expiredSnap.docs.length} approval(s)`);

    const batch = db.batch();
    for (const doc of expiredSnap.docs) {
      batch.update(doc.ref, {
        status: 'expired',
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        decidedBy: 'timeout',
      });
    }
    await batch.commit().catch((e) => console.error('[approvalWorker] batch commit error:', e?.message));

    // Best-effort: edit Telegram messages to remove inline keyboard
    for (const doc of expiredSnap.docs) {
      const approval = doc.data();
      if (approval.telegramChatId && approval.telegramMessageId) {
        await _editTelegramMessage(
          approval.telegramChatId,
          approval.telegramMessageId,
          `~~${approval.proposalSummary}~~\n_This proposal expired._`,
        ).catch(() => { /* non-fatal */ });
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Action executor — called after user approves via Telegram or API
// ---------------------------------------------------------------------------

/**
 * Execute the approved actions from a pending_approvals document.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} approval   - The pending_approvals document data
 * @param {string} approvalId - The document ID
 * @returns {Promise<{ok, appliedActions, failedActions}>}
 */
async function executeApprovedActions(db, approval, approvalId) {
  const actions = Array.isArray(approval.actions) ? approval.actions : [];
  const appliedActions = [];
  const failedActions = [];

  for (const action of actions) {
    try {
      await _executeOne(db, action, approval.ownerUid);
      appliedActions.push(action.type);
    } catch (err) {
      console.error(`[approvalWorker] action ${action.type} failed:`, err?.message);
      failedActions.push({ type: action.type, error: err?.message });
    }
  }

  // Mark approval as completed
  await db.collection(APPROVALS_COLLECTION).doc(approvalId).update({
    status: 'completed',
    decidedAt: admin.firestore.FieldValue.serverTimestamp(),
    decidedBy: 'user',
  }).catch((e) => console.error('[approvalWorker] status update failed:', e?.message));

  return {
    ok: failedActions.length === 0,
    appliedActions,
    failedActions,
  };
}

exports.executeApprovedActions = executeApprovedActions;

// ---------------------------------------------------------------------------
// Individual action handlers
// ---------------------------------------------------------------------------

async function _executeOne(db, action, ownerUid) {
  const { type, payload = {} } = action;

  switch (type) {
    case 'defer_task':
      return _deferTask(db, payload, ownerUid);

    case 'deprioritise_task':
      return _deprioritiseTask(db, payload, ownerUid);

    case 'update_task':
      return _updateTask(db, payload, ownerUid);

    case 'create_task':
      return _createTask(db, payload, ownerUid);

    case 'create_calendar_block':
      return _createCalendarBlock(db, payload, ownerUid);

    case 'delete_calendar_block':
      return _deleteCalendarBlock(db, payload, ownerUid);

    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

async function _deferTask(db, { taskId, targetDateIso }, ownerUid) {
  if (!taskId) throw new Error('taskId required for defer_task');
  if (!targetDateIso) throw new Error('targetDateIso required for defer_task');

  const ref = db.collection('tasks').doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Task ${taskId} not found`);
  if (snap.data()?.ownerUid !== ownerUid) throw new Error(`Task ${taskId} does not belong to user`);

  const targetDate = admin.firestore.Timestamp.fromDate(new Date(targetDateIso));

  await ref.update({
    dueDate: targetDate,
    deferredUntil: targetDate,
    deferredReason: 'agent_triage',
    syncState: 'dirty',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function _deprioritiseTask(db, { taskId }, ownerUid) {
  if (!taskId) throw new Error('taskId required for deprioritise_task');

  const ref = db.collection('tasks').doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Task ${taskId} not found`);
  if (snap.data()?.ownerUid !== ownerUid) throw new Error(`Task ${taskId} does not belong to user`);

  await ref.update({
    priority: 1, // Low
    syncState: 'dirty',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function _updateTask(db, { taskId, patch }, ownerUid) {
  if (!taskId) throw new Error('taskId required for update_task');
  if (!patch || typeof patch !== 'object') throw new Error('patch object required for update_task');

  const ref = db.collection('tasks').doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Task ${taskId} not found`);
  if (snap.data()?.ownerUid !== ownerUid) throw new Error(`Task ${taskId} does not belong to user`);

  // Sanitise patch: prevent overwriting ownership fields
  const safePatch = { ...patch };
  delete safePatch.ownerUid;
  delete safePatch.id;
  delete safePatch.ref;
  safePatch.syncState = 'dirty';
  safePatch.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await ref.update(safePatch);
}

async function _createTask(db, { title, description, priority, theme, storyId, dueDateIso }, ownerUid) {
  if (!title) throw new Error('title required for create_task');

  const { v4: uuidv4 } = require('uuid');
  const taskId = uuidv4();

  const doc = {
    id: taskId,
    ownerUid,
    title,
    description: description || '',
    status: 0, // To Do
    priority: priority || 2, // Medium
    theme: theme || null,
    parentId: storyId || null,
    parentType: storyId ? 'story' : null,
    source: 'ai',
    syncState: 'dirty',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (dueDateIso) {
    doc.dueDate = admin.firestore.Timestamp.fromDate(new Date(dueDateIso));
  }

  await db.collection('tasks').doc(taskId).set(doc);
  return { id: taskId };
}

async function _createCalendarBlock(db, { title, startIso, endIso, theme }, ownerUid) {
  if (!title || !startIso || !endIso) throw new Error('title, startIso, endIso required for create_calendar_block');

  const { v4: uuidv4 } = require('uuid');
  const blockId = uuidv4();

  await db.collection('calendar_blocks').doc(blockId).set({
    id: blockId,
    ownerUid,
    title,
    start: admin.firestore.Timestamp.fromDate(new Date(startIso)),
    end: admin.firestore.Timestamp.fromDate(new Date(endIso)),
    theme: theme || null,
    source: 'agent',
    syncState: 'dirty',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: blockId };
}

async function _deleteCalendarBlock(db, { blockId }, ownerUid) {
  if (!blockId) throw new Error('blockId required for delete_calendar_block');

  const ref = db.collection('calendar_blocks').doc(blockId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Calendar block ${blockId} not found`);
  if (snap.data()?.ownerUid !== ownerUid) throw new Error(`Block ${blockId} does not belong to user`);

  await ref.update({
    deleted: true,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    syncState: 'dirty',
  });
}

// ---------------------------------------------------------------------------
// Telegram helper (for expiry sweep — edits existing messages)
// ---------------------------------------------------------------------------

async function _editTelegramMessage(chatId, messageId, text) {
  let token;
  try { token = TELEGRAM_BOT_TOKEN.value(); } catch (e) { return; }
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, 4096),
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] }, // remove buttons
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn('[approvalWorker] editMessageText failed:', response.status, body);
  }
}
