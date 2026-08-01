/**
 * deviceOrchestrationClaim — how the iOS app claims a night's orchestration so the
 * server's nightly chain stands down instead of redoing the same work.
 *
 * The device runs its nightly BGProcessingTask at ~02:00 UTC; the server chain runs at
 * 04:00 Europe/London. Both fall on the same London calendar day in GMT and in BST, which
 * is why the claim is keyed on a London date rather than a rolling time window — the two
 * ends never have to agree on a duration, only on which night it is.
 *
 * WHAT A CLAIM SUPPRESSES, AND WHAT IT DOES NOT
 *
 * Only the steps the device actually performs: priority scoring and Top-3 selection. The
 * rest of the chain is server-only work the phone cannot do — LLM auto-pointing, chore
 * conversion, fuzzy task/story-goal linking — plus the calendar planner, which the device
 * deliberately does not touch (LocalOrchestrationService's own header: "Calendar blocks
 * are NOT created locally — they come exclusively from Firestore"). Suppressing the whole
 * chain on a claim would leave a phone-run account with no calendar blocks at all.
 *
 * THIS IS THE SECOND ATTEMPT. The first (removed 2026-07-28, see the note in
 * BackgroundSyncOrchestrator.swift) wrote `orchestration_flags/{uid}_{date}` that no
 * Cloud Function ever read: the device wrote a flag, the server scored anyway, and the
 * device's 6-hour staleness guard then made it defer to the server's numbers — the
 * phone's work was discarded and the write bought nothing. Two rules fall out of that:
 *
 *   1. Both ends ship together. A writer with no reader is worse than nothing.
 *   2. Only the nightly background task claims. The old flag was also written by the
 *      foreground path, so a 09:00 app launch told the chain to skip scoring for the rest
 *      of the day.
 */

'use strict';

const { DateTime } = require('luxon');

const CLAIM_COLLECTION = 'orchestration_runs';
const DEFAULT_ZONE = 'Europe/London';

/** The night being claimed, as a London (or user-zone) ISO date. Must match the Swift side. */
function claimDateKey({ zone = DEFAULT_ZONE, atMs = Date.now() } = {}) {
  return DateTime.fromMillis(atMs).setZone(zone).toISODate();
}

/** Deterministic doc id so the device's write and the server's read need no query. */
function claimDocId(uid, dateKey) {
  return `${uid}_${dateKey}`;
}

/**
 * Has a device already completed tonight's orchestration for this user?
 *
 * Fails OPEN: any error, missing doc, or unsuccessful run means the server proceeds. A
 * false negative costs one redundant scoring pass; a false positive means nobody scores
 * that user at all that day, which is silent and only visible as a stale Top 3.
 */
async function hasDeviceClaimedTonight(db, uid, { zone = DEFAULT_ZONE, atMs = Date.now() } = {}) {
  if (!uid) return false;
  const dateKey = claimDateKey({ zone, atMs });
  try {
    const snap = await db.collection(CLAIM_COLLECTION).doc(claimDocId(uid, dateKey)).get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    // A run that started and failed halfway leaves scores half-written, which is precisely
    // when the server most needs to run.
    if (data.succeeded !== true) return false;
    // Guards against a device with a badly wrong clock writing a future-dated claim that
    // then suppresses the server for a day that has not happened yet.
    return String(data.dateKey || '') === dateKey;
  } catch (err) {
    console.warn('[device-claim] lookup failed, running server-side anyway', uid, err?.message || err);
    return false;
  }
}

module.exports = {
  CLAIM_COLLECTION,
  DEFAULT_ZONE,
  claimDateKey,
  claimDocId,
  hasDeviceClaimedTonight,
};
