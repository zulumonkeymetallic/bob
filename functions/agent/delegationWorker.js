'use strict';

/**
 * delegationWorker.js
 *
 * Firestore-triggered notifications for AI-delegated tasks and stories.
 * Fires when aiDelegationStatus enters the review state, whichever engine produced it.
 *
 * Either Hermes executes the work locally and writes Firestore via bob_firestore_mutation.py,
 * or the cloud cycle in ../aiDelegation.js does. This function handles:
 *   - Email to Jim
 *   - Activity stream entry
 *   - Copying aiDelegationDocumentLink → documentLink (surfaces in Edit modal)
 *
 * WHY TWO ACCEPTED VALUES: this file only ever matched the literal 'review', but every
 * producer — aiDelegation.js, run_delegation_cycle.py, and the `aiDelegationStatus` union in
 * react-app/src/types.ts — writes 'human_review'. So the trigger has never fired for a real
 * delegation: no email, no activity entry, and documentLink left unset. 'human_review' is the
 * canonical value (it is the one CLAUDE.md documents and the one the UI clears); 'review' is
 * accepted so any legacy row already carrying it still notifies.
 */

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { sendEmail } = require('../lib/email');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const BOB_URL = 'https://bob.jc1.tech';
const REGION = 'europe-west2';

const REVIEW_STATES = new Set(['human_review', 'review']);
const isReviewState = (value) => REVIEW_STATES.has(String(value || ''));

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
  const collection = entityPath;

  const ops = [];

  // Copy aiDelegationDocumentLink → documentLink so it shows in the Edit modal
  if (docLink) {
    ops.push(
      db.collection(collection).doc(docId).update({ documentLink: docLink })
        .catch(err => console.warn('[delegationWorker] documentLink update failed', err?.message))
    );
  }

  // Activity stream entry
  const activityRef = db.collection('activity_stream').doc();
  const description = [
    `Hermes AI completed delegation`,
    note ? `— ${note}` : '',
    docLink ? `📄 ${docLink}` : '',
  ].filter(Boolean).join(' ');

  ops.push(
    activityRef.set({
      id: activityRef.id,
      entityId: docId,
      entityType,
      activityType: 'automation_activity',
      userId: ownerUid,
      ownerUid,
      description,
      referenceNumber: ref,
      source: 'ai',
      persona: data.persona || 'personal',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.warn('[delegationWorker] activity stream write failed', err?.message))
  );

  // Email notification
  const emailOp = (async () => {
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
  })();

  await Promise.all([...ops, emailOp]);
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
    if (!isReviewState(after.aiDelegationStatus)) return;
    await notifyDelegationComplete(after, 'story', event.params.docId);
  },
);

exports.onTaskDelegationComplete = onDocumentUpdated(
  { document: 'tasks/{docId}', region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after || before?.aiDelegationStatus === after?.aiDelegationStatus) return;
    if (!isReviewState(after.aiDelegationStatus)) return;
    await notifyDelegationComplete(after, 'task', event.params.docId);
  },
);
