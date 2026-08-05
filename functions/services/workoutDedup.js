'use strict';

/**
 * Cross-provider workout reconciliation.
 *
 * ## The problem this exists for
 *
 * The same session reaches BOB twice, as two unrelated documents with different ids: once
 * from Strava (`{uid}_{activityId}`) and once from HealthKit via the phone
 * (`{uid}_hk_{uuid}`). Nothing joins them.
 *
 * iOS does guard against it — `pushUnseenWorkouts` checks Firestore for a workout of the
 * same activity starting within 30 minutes and declines to push. But that guard is
 * **one-sided**: it only fires when Strava got there first. HealthKit has the session the
 * moment it ends; Strava has it when the watch app uploads. Sync in that gap and both rows
 * land, and every consumer sums both — weekly mileage, KPI progress, the trend charts,
 * `metric_values`. A doubled distance is worse than a missing one, because it looks
 * plausible.
 *
 * Until 2026-08-05 this was theoretical: no HealthKit workout had ever reached Firestore
 * (it was written to a collection with no rule, see WS1 R1), so the feed was 100% Strava.
 * It stops being theoretical the moment the iOS build ships.
 *
 * ## Marked, not deleted
 *
 * Duplicates are flagged `isDuplicate` and `supersededBy`, never removed. Deleting is
 * irreversible and a mis-matched pair would silently destroy a real session; a flag can be
 * cleared. Consumers filter on it.
 *
 * ## Precedence
 *
 * Strava is canonical for distance and GPS — it has the corrected track and the elevation.
 * HealthKit is canonical for heart-rate zones (WS1 D2), because it sees pool swims, gym
 * work and turbo sessions that never reach Strava at all, and because on-device sampling
 * does not depend on Strava exposing a stream.
 *
 * So the survivor is the Strava row, and anything it lacks that its HealthKit twin has —
 * zone time above all — is merged onto it before the twin is set aside.
 */

const admin = require('firebase-admin');
const { activityFromWorkout } = require('../utils/activityTaxonomy');

/**
 * Two records of the same session start within a minute or two of each other. Thirty
 * minutes absorbs timezone and upload skew without swallowing two genuinely separate
 * sessions of the same sport — the same window `HealthKitSyncService` uses, deliberately,
 * so the device-side and server-side guards agree on what "the same session" means.
 */
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

/** Higher wins. Strava carries the corrected distance and the GPS track. */
const PROVIDER_RANK = { strava: 3, parkrun: 2, healthkit: 1 };

function providerOf(workout) {
  return String(workout.provider || workout.source || '').toLowerCase();
}

function rankOf(workout) {
  return PROVIDER_RANK[providerOf(workout)] ?? 0;
}

function startOf(workout) {
  return Number(workout.startDate || 0) || 0;
}

function hasZones(workout) {
  return !!(workout.hrZones && workout.hrZones.z1Time_s != null);
}

/**
 * Pair records that are the same session seen by **different** providers.
 *
 * ## Same-provider records are never duplicates of each other
 *
 * This is the whole safety property, and the first version of this file got it wrong. It
 * clustered on time and activity alone, and a dry run against Jim's real feed flagged 16
 * "duplicates" — every one of them a Strava/Strava pair. Looking at them: a 0.42km jog and
 * a 5.02km parkrun twenty minutes later; four short efforts on one November afternoon that
 * are plainly interval legs; a 0.27km warm-up before a 6.37km run. All real, all distinct,
 * and marking the shorter one a duplicate would have quietly deleted that distance from
 * every total.
 *
 * Two records from one provider are two sessions *that provider already considers
 * distinct* — Strava dedupes its own uploads. The failure this function exists for is
 * strictly cross-provider: one session, two systems, two ids, no join.
 *
 * So the rule is narrow and provable: a record is a duplicate only when a record of the
 * same canonical activity, from a **different and higher-ranked** provider, starts within
 * the window. Nothing else is ever touched.
 *
 * Returns `[{ canonical, duplicates: [...] }]`. Exported for testing — this is where the
 * judgement is.
 */
function pairAcrossProviders(workouts) {
  const byActivity = new Map();
  for (const w of workouts) {
    if (!startOf(w)) continue;
    const activity = activityFromWorkout(w);
    if (!byActivity.has(activity)) byActivity.set(activity, []);
    byActivity.get(activity).push(w);
  }

  const pairs = [];
  for (const group of byActivity.values()) {
    group.sort((a, b) => startOf(a) - startOf(b));
    const claimed = new Set();

    for (const candidate of group) {
      // Only a lower-ranked record can be superseded, so iterate those and look upward.
      if (claimed.has(candidate)) continue;
      const better = group.find((other) => other !== candidate
        && !claimed.has(other)
        && providerOf(other) !== providerOf(candidate)
        && rankOf(other) > rankOf(candidate)
        && Math.abs(startOf(other) - startOf(candidate)) <= DEDUP_WINDOW_MS);
      if (!better) continue;

      claimed.add(candidate);
      const existing = pairs.find((p) => p.canonical === better);
      if (existing) existing.duplicates.push(candidate);
      else pairs.push({ canonical: better, duplicates: [candidate] });
    }
  }
  return pairs;
}

/**
 * What the canonical record should absorb from the ones being set aside.
 *
 * Only fields it is *missing*. A merge must never overwrite a value the survivor already
 * has, or Strava's corrected distance would be replaced by the watch's raw one.
 */
function buildMergePatch(canonical, others) {
  const patch = {};
  if (!hasZones(canonical)) {
    const donor = others.find(hasZones);
    if (donor) {
      patch.hrZones = donor.hrZones;
      patch.maxHrUsed = donor.maxHrUsed ?? null;
      patch.zoneSource = donor.zoneSource || providerOf(donor) || 'healthkit';
      // Whatever marked it unavailable no longer applies — a zone breakdown now exists.
      patch.hrZonesUnavailable = admin.firestore.FieldValue.delete();
      patch.hrZonesUnavailableReason = admin.firestore.FieldValue.delete();
    }
  }
  if (canonical.avgHeartrate == null) {
    const donor = others.find((w) => w.avgHeartrate != null);
    if (donor) patch.avgHeartrate = donor.avgHeartrate;
  }
  if (!Number(canonical.movingTime_s || canonical.elapsedTime_s || 0)) {
    const donor = others.find((w) => Number(w.movingTime_s || w.elapsedTime_s || 0) > 0);
    if (donor) {
      const seconds = Number(donor.movingTime_s || donor.elapsedTime_s);
      patch.movingTime_s = seconds;
      patch.elapsedTime_s = seconds;
    }
  }
  return patch;
}

/**
 * Reconcile one user's workout feed.
 *
 * Idempotent: a cluster that is already reconciled produces no writes, and a record
 * previously marked a duplicate that is now alone in its cluster has the mark cleared —
 * so deleting the Strava copy resurrects the HealthKit one rather than losing the session
 * entirely.
 */
async function dedupeWorkoutsForUser(userId, options = {}) {
  const db = admin.firestore();
  const lookbackDays = Number(options.lookbackDays || 400);
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const dryRun = options.dryRun === true;

  const snap = await db.collection('metrics_workouts')
    .where('ownerUid', '==', userId)
    .where('startDate', '>=', since)
    .orderBy('startDate', 'desc')
    .get();

  const workouts = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  const pairs = pairAcrossProviders(workouts);

  const writes = [];
  let duplicatesFound = 0;
  let zonesMerged = 0;
  let unmarked = 0;

  const nowDuplicates = new Set();
  for (const { canonical, duplicates } of pairs) {
    duplicatesFound += duplicates.length;

    const patch = buildMergePatch(canonical, duplicates);
    if (patch.hrZones) zonesMerged += 1;
    if (canonical.isDuplicate === true) {
      patch.isDuplicate = admin.firestore.FieldValue.delete();
      patch.supersededBy = admin.firestore.FieldValue.delete();
    }
    if (Object.keys(patch).length > 0) {
      writes.push({ id: canonical._id, data: patch });
    }

    for (const other of duplicates) {
      nowDuplicates.add(other._id);
      if (other.isDuplicate === true && other.supersededBy === canonical._id) continue;
      writes.push({
        id: other._id,
        data: {
          isDuplicate: true,
          supersededBy: canonical._id,
          dedupedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    }
  }

  // Marked on a previous run but no longer paired — its twin has been deleted. Restore it
  // rather than leaving a real session excluded from every total for ever.
  for (const w of workouts) {
    if (w.isDuplicate === true && !nowDuplicates.has(w._id)) {
      unmarked += 1;
      writes.push({
        id: w._id,
        data: {
          isDuplicate: admin.firestore.FieldValue.delete(),
          supersededBy: admin.firestore.FieldValue.delete(),
          dedupedAt: admin.firestore.FieldValue.delete(),
        },
      });
    }
  }

  if (!dryRun) {
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const write of writes.slice(i, i + 400)) {
        batch.set(db.collection('metrics_workouts').doc(write.id), write.data, { merge: true });
      }
      await batch.commit();
    }
  }

  return {
    workouts: workouts.length,
    pairs: pairs.length,
    duplicatesFound,
    zonesMerged,
    unmarked,
    writes: writes.length,
    dryRun,
  };
}

module.exports = {
  DEDUP_WINDOW_MS,
  pairAcrossProviders,
  buildMergePatch,
  dedupeWorkoutsForUser,
};
