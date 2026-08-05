'use strict';

/**
 * Evening catch-up — WS6 R1.
 *
 * Runs once each evening. If the step target will be missed, it reserves a walk sized to
 * the gap and says so, rather than only observing at bedtime that the day was short.
 *
 * ## Why it places a block and not just a notification
 *
 * Jim's ask: *"if I'm not meeting my daily targets like steps, put that into my calendar in
 * the evening and remind me."* A notification competes with everything else in an evening;
 * a block holds the time. The walk is a real `calendar_blocks` entry in the same family as
 * every other session, so it reaches the phone by the same route and can be moved or
 * deleted like anything else.
 *
 * ## The freeze horizon does not apply
 *
 * WS5 R3.2 freezes the next 24 hours against automated re-planning. This is the deliberate
 * exception — acting inside today is the entire point. It is also additive: it never moves
 * or cancels anything, so there is nothing for a freeze to protect.
 *
 * ## What it will not do
 *
 * Place a block it knows cannot be walked. If there is no room before the cut-off, it says
 * how far behind the day is and stops. A reservation the athlete cannot act on is worse
 * than none, because it teaches him to ignore them.
 */

const admin = require('firebase-admin');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const httpsV2 = require('firebase-functions/v2/https');
const { DateTime } = require('luxon');

const TZ = 'Europe/London';
const REGION = 'europe-west2';

/** Latest a catch-up walk may start. Past this it is a nudge, not a plan. */
const LATEST_START_HOUR = 21;

/** Steps per minute at an ordinary walking pace. 100/min is the usual cadence figure. */
const STEPS_PER_MINUTE = 100;

/** Below this the gap is noise, not a deficit worth reserving time for. */
const MIN_DEFICIT_STEPS = 1500;

/** Nobody is walking three hours at nine at night; cap what gets reserved. */
const MAX_WALK_MINUTES = 75;
const MIN_WALK_MINUTES = 10;

function db() {
  return admin.firestore();
}

/**
 * Today's step count, from the per-day document rather than the profile mirror.
 *
 * `profiles.healthkitStepsToday` is overwritten by whichever sync ran last and carries no
 * date, so at any given moment it may hold yesterday's total — it read the same 5,675 on
 * three consecutive days. The dated document cannot lie about which day it describes.
 *
 * Note the field rename: the device sends `stepsToday` and `logHealthMetric` stores it as
 * `healthkitStepsToday`.
 */
async function stepsToday(uid, dateKey) {
  const snap = await db().collection('health_metrics').doc(`${uid}_${dateKey}`).get().catch(() => null);
  if (!snap?.exists) return { steps: null, reason: 'no_health_metrics_document' };
  const data = snap.data() || {};
  const steps = data.healthkitStepsToday ?? data.stepsToday ?? null;
  return steps === null
    ? { steps: null, reason: 'document_has_no_step_count' }
    : { steps: Number(steps), reason: null };
}

/** Blocks already occupying this evening, so the walk lands in a real gap. */
async function eveningBusy(uid, from, to) {
  const snap = await db().collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', from.toMillis())
    .where('start', '<=', to.toMillis())
    .get()
    .catch(() => ({ docs: [] }));
  return snap.docs
    .map((d) => d.data())
    .filter((b) => b.isDeleted !== true)
    .map((b) => ({ start: Number(b.start), end: Number(b.end) }))
    .sort((a, b) => a.start - b.start);
}

/** First gap of at least `minutes`, or null. */
function findGap(busy, from, to, minutes) {
  const needed = minutes * 60000;
  let cursor = from.toMillis();
  const limit = to.toMillis();
  for (const block of busy) {
    if (block.start - cursor >= needed) return DateTime.fromMillis(cursor).setZone(TZ);
    cursor = Math.max(cursor, block.end);
  }
  return (limit - cursor >= needed) ? DateTime.fromMillis(cursor).setZone(TZ) : null;
}

async function runCheckpointForUser(uid, profile, options = {}) {
  const now = options.now || DateTime.now().setZone(TZ);
  const dateKey = now.toISODate();
  const target = Number(profile.targetStepsPerDay ?? profile.dailyStepTarget
    ?? profile.healthTargetStepsPerDay ?? 12000);

  const { steps, reason } = await stepsToday(uid, dateKey);
  if (steps === null) {
    // Unknown is not the same as behind. Prescribing a walk because the phone has not
    // synced would be inventing a deficit.
    return { uid, action: 'skipped', reason, target };
  }

  const deficit = Math.max(0, target - steps);
  if (deficit < MIN_DEFICIT_STEPS) {
    return { uid, action: 'none', steps, target, deficit };
  }

  const walkMinutes = Math.min(
    MAX_WALK_MINUTES,
    Math.max(MIN_WALK_MINUTES, Math.round(deficit / STEPS_PER_MINUTE)),
  );
  const windowEnd = now.set({ hour: LATEST_START_HOUR, minute: 0, second: 0, millisecond: 0 });
  if (now >= windowEnd) {
    return { uid, action: 'notify_only', steps, target, deficit, reason: 'past_cutoff' };
  }

  const busy = await eveningBusy(uid, now, windowEnd.plus({ hours: 2 }));
  const slot = findGap(busy, now, windowEnd, walkMinutes);
  if (!slot) {
    return { uid, action: 'notify_only', steps, target, deficit, reason: 'no_free_slot' };
  }

  // Idempotent: one catch-up walk per day, however often this runs.
  const blockId = `catchup_walk_${uid}_${dateKey}`;
  const ref = db().collection('calendar_blocks').doc(blockId);
  if ((await ref.get()).exists) {
    return { uid, action: 'already_placed', steps, target, deficit };
  }

  await ref.set({
    ownerUid: uid,
    title: `🚶 Catch-up walk — ${deficit.toLocaleString()} steps short`,
    start: slot.toMillis(),
    end: slot.plus({ minutes: walkMinutes }).toMillis(),
    source: 'coach_catchup',
    entityType: 'fitness',
    theme: 'health',
    activity: 'walk',
    aiGenerated: true,
    // Assumption stated on the record rather than buried: the duration is derived from a
    // cadence estimate, not measured.
    rationale: `${steps.toLocaleString()} of ${target.toLocaleString()} steps at ${now.toFormat('HH:mm')}. `
      + `${walkMinutes} min at ~${STEPS_PER_MINUTE} steps/min closes the gap.`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Telegram, reusing the orchestrator's existing wiring rather than standing up a second
  // one. Carried over from `_checkAfternoonStepsForUser`, which this replaces.
  try {
    const { _sendTelegram: sendTelegram, _getTelegramChatId: getTelegramChatId } = require('./coachOrchestrator');
    const chatId = await getTelegramChatId(uid);
    if (chatId) {
      await sendTelegram(chatId,
        `🚶 Step catch-up\n`
        + `${steps.toLocaleString()} of ${target.toLocaleString()} at ${now.toFormat('HH:mm')} — `
        + `${deficit.toLocaleString()} short.\n`
        + `${walkMinutes} min walk added at ${slot.toFormat('HH:mm')}.`);
    }
  } catch (e) {
    // A nudge that fails must not lose the block that was already written.
    console.warn(`[eveningCheckpoint] telegram nudge failed uid=${uid}: ${e?.message}`);
  }

  // The phone reads coach_daily to decide what to notify about; recording the deficit here
  // keeps one source of truth rather than a second notification pathway.
  await db().collection('coach_daily').doc(`${uid}_${dateKey}`).set({
    stepCatchUp: {
      steps,
      target,
      deficit,
      walkMinutes,
      startsAt: slot.toMillis(),
      placedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  return { uid, action: 'placed', steps, target, deficit, walkMinutes, startsAt: slot.toISO() };
}

async function runCheckpoint(onlyUid = null) {
  const firestore = db();
  const profiles = onlyUid
    ? [await firestore.collection('profiles').doc(onlyUid).get()]
    : (await firestore.collection('profiles').get()).docs;

  const results = [];
  for (const doc of profiles) {
    if (!doc?.exists) continue;
    try {
      results.push(await runCheckpointForUser(doc.id, doc.data() || {}));
    } catch (e) {
      console.error(`[eveningCheckpoint] failed uid=${doc.id}:`, e?.message || e);
      results.push({ uid: doc.id, action: 'error', error: e?.message || String(e) });
    }
  }
  return results;
}

exports.eveningStepCheckpoint = schedulerV2.onSchedule(
  { schedule: '0 18 * * *', timeZone: TZ, region: REGION, memory: '512MiB', timeoutSeconds: 300 },
  async () => {
    const results = await runCheckpoint();
    const placed = results.filter((r) => r.action === 'placed').length;
    console.log(`[eveningCheckpoint] ${results.length} users, ${placed} catch-up walks placed`);
  }
);

exports.triggerEveningCheckpoint = httpsV2.onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 300 },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
    const [result] = await runCheckpoint(uid);
    return { ok: true, ...result };
  }
);

module.exports.runCheckpointForUser = runCheckpointForUser;
module.exports.findGap = findGap;
module.exports.STEPS_PER_MINUTE = STEPS_PER_MINUTE;
module.exports.MIN_DEFICIT_STEPS = MIN_DEFICIT_STEPS;
