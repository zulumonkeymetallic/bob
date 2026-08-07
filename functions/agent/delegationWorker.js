'use strict';

/**
 * delegationWorker.js
 *
 * Firestore-triggered notifications for AI-delegated goals, stories and tasks.
 * Fires when aiDelegationStatus enters the review state, whichever engine produced it.
 *
 * Either Hermes executes the work locally and writes Firestore via bob_firestore_mutation.py,
 * or the cloud cycle in ../aiDelegation.js does. This function handles:
 *   - Email to Jim, naming the engine and carrying what the run actually produced
 *   - Activity stream entry
 *   - Copying aiDelegationDocumentLink → documentLink (surfaces in Edit modal)
 *
 * THE SUMMARY WAS ALWAYS EMPTY. This file read `aiDelegationNote`, which neither engine has
 * ever written — both write `aiOutput`. So every email that did fire carried a bare document
 * link and nothing describing the work. See summaryFor() for the fallback that fixes it.
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

const ENTITY_PATHS = { story: 'stories', task: 'tasks', goal: 'goals' };

/**
 * Which engine produced this, for the reader.
 *
 * The email used to say "Hermes AI completed…" unconditionally, which has been wrong for every
 * cloud-cycle completion since aiDelegationEngine existed. Knowing which engine ran it matters:
 * a Hermes result means the Mac was awake, and a rerun behaves differently between the two.
 */
function engineLabel(data) {
  const engine = String(data.aiDelegationEngine || '').trim().toLowerCase();
  const model = String(data.aiDelegationModel || '').trim();
  const name = engine === 'hermes' ? 'Hermes (Mac)' : 'BOB cloud';
  return model ? `${name}, ${model}` : name;
}

/**
 * The part of the delegation output worth putting in an email.
 *
 * `aiDelegationNote` is read first because it is the field this file has always documented, but
 * NEITHER engine writes it — aiDelegation.js and run_delegation_cycle.py both write `aiOutput`.
 * That is why every completion email so far has carried a document link and no summary at all.
 *
 * Both engines build `aiOutput` to the same shape:
 *
 *     Completed via AI delegation ({model}).
 *     Google Doc: {url}
 *
 *     {first 500 chars of the document}
 *
 * The first two lines are boilerplate the email already states in its own words, so they are
 * dropped and the document excerpt is what gets shown. If the shape ever changes, the whole
 * string is used rather than nothing — a slightly noisy summary beats a missing one.
 */
function summaryFor(data) {
  const note = String(data.aiDelegationNote || '').trim();
  if (note) return note;

  const output = String(data.aiOutput || '').trim();
  if (!output) return '';

  const body = output
    .split('\n')
    .filter((line) => !/^Completed via AI delegation\b/i.test(line.trim()))
    .filter((line) => !/^Google Doc:\s*http/i.test(line.trim()))
    .join('\n')
    .trim();

  return body || output;
}

/** Model output goes into an HTML email, so it cannot be interpolated raw. */
const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Shared notification logic
// ---------------------------------------------------------------------------

async function notifyDelegationComplete(data, entityType, docId) {
  const ownerUid = data.ownerUid;
  if (!ownerUid) return;

  const title = data.title || `Untitled ${entityType}`;
  const ref = data.ref || docId;
  const docLink = data.aiDelegationDocumentLink || null;
  const note = summaryFor(data);
  const engine = engineLabel(data);
  const entityPath = ENTITY_PATHS[entityType] || 'tasks';
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
    `AI delegation complete (${engine})`,
    // The activity stream is a scannable list, so the summary is trimmed here even though the
    // email carries it in full.
    note ? `— ${note.length > 220 ? `${note.slice(0, 219)}…` : note}` : '',
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
          ? `<p><strong>Document:</strong> <a href="${escapeHtml(docLink)}">${escapeHtml(docLink)}</a></p>`
          : '';
        // white-space: pre-wrap because the excerpt is markdown straight from the model — it
        // carries its own line breaks, and collapsing them turns a structured brief into a wall.
        const noteSection = note
          ? `<p><strong>What it produced:</strong></p>
             <div style="white-space: pre-wrap; border-left: 3px solid #d0d7de; padding-left: 12px; color: #333;">${escapeHtml(note)}</div>`
          : '<p><em>No summary was recorded for this run.</em></p>';
        const html = `
          <h2>AI delegation complete: ${escapeHtml(entityType)}</h2>
          <p><strong>${escapeHtml(ref)}: ${escapeHtml(title)}</strong></p>
          <p style="color: #666;">Produced by ${escapeHtml(engine)}.</p>
          ${noteSection}
          ${docSection}
          <p>It is awaiting your review — nothing has been marked done.</p>
          <p><a href="${escapeHtml(bobLink)}">Open in BOB</a></p>
        `;
        await sendEmail({
          to: email,
          subject: `AI delegation complete: ${ref} — ${title}`,
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

/**
 * One handler shape for all three collections.
 *
 * Written once rather than three times because the story and task copies had already drifted
 * from each other's intent in comments, and a goal copy pasted from either would inherit
 * whichever bug was in the one that got copied.
 */
const onDelegationComplete = (collection, entityType) => onDocumentUpdated(
  { document: `${collection}/{docId}`, region: REGION },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after || before?.aiDelegationStatus === after?.aiDelegationStatus) return;
    if (!isReviewState(after.aiDelegationStatus)) return;
    await notifyDelegationComplete(after, entityType, event.params.docId);
  },
);

exports.onStoryDelegationComplete = onDelegationComplete('stories', 'story');
exports.onTaskDelegationComplete = onDelegationComplete('tasks', 'task');

// Goals were the missing third: findFlaggedItems in ../aiDelegation.js has always processed
// them, so a delegated goal produced a document and then completed in silence — no email, no
// activity entry, and documentLink left unset.
exports.onGoalDelegationComplete = onDelegationComplete('goals', 'goal');

// Exported for tests: the summary fallback and engine naming are the two things most likely to
// regress silently, because both fail by producing a plausible-looking email rather than an error.
exports._internal = { summaryFor, engineLabel, escapeHtml };
