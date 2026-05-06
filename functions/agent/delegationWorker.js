'use strict';

/**
 * delegationWorker.js
 *
 * Firestore-triggered notifications for AI-delegated tasks and stories.
 * Fires when aiDelegationStatus changes to 'review' (Hermes completed work).
 *
 * Hermes executes the work locally and updates Firestore directly via
 * bob_firestore_mutation.py. This function only handles notifications:
 *   - Email to Jim
 *   - Telegram (via existing telegram_sessions / telegramWebhook)
 */

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { sendEmail } = require('../lib/email');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const BOB_URL = 'https://bob.jc1.tech';
const REGION = 'europe-west2';

// ---------------------------------------------------------------------------
// Shared notification logic
// ---------------------------------------------------------------------------

async function notifyDelegationComplete(data, entityType, docId) {
  const ownerUid = data.ownerUid;
  if (!ownerUid) return;

  const title = data.title || `Untitled ${entityType}`;
  const ref = data.ref || docId;
  const docLink = data.aiDelegationDocumentLink || null;
  const note = data.aiDelegationNote || null;
  const entityPath = entityType === 'story' ? 'stories' : 'tasks';
  const bobLink = `${BOB_URL}/${entityPath}/${docId}`;

  try {
    const profileSnap = await db.collection('users').doc(ownerUid).get();
    const email = profileSnap.data()?.email;
    if (email) {
      const docSection = docLink
        ? `<p><strong>Document:</strong> <a href="${docLink}">${docLink}</a></p>`
        : '';
      const noteSection = note
        ? `<p><strong>Summary:</strong> ${note}</p>`
        : '';
      const html = `
        <h2>Hermes AI completed a delegated ${entityType}</h2>
        <p><strong>${ref}: ${title}</strong></p>
        ${noteSection}
        ${docSection}
        <p>The ${entityType} has been moved to <em>review</em> status and is awaiting your sign-off.</p>
        <p><a href="${bobLink}">Open in BOB</a></p>
      `;
      await sendEmail({
        to: email,
        subject: `Hermes complete: ${ref} — ${title}`,
        html,
      });
    }
  } catch (err) {
    console.warn('[delegationWorker] email failed', err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// Firestore triggers
// ---------------------------------------------------------------------------

exports.onStoryDelegationComplete = onDocumentUpdated(
  { document: 'stories/{docId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after || before?.aiDelegationStatus === after?.aiDelegationStatus) return;
    if (after.aiDelegationStatus !== 'review') return;
    await notifyDelegationComplete(after, 'story', event.params.docId);
  },
);

exports.onTaskDelegationComplete = onDocumentUpdated(
  { document: 'tasks/{docId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after || before?.aiDelegationStatus === after?.aiDelegationStatus) return;
    if (after.aiDelegationStatus !== 'review') return;
    await notifyDelegationComplete(after, 'task', event.params.docId);
  },
);
