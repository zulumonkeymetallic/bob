'use strict';

/**
 * Aggregate `metrics_workouts` into `metric_values`.
 *
 * ## Why this exists
 *
 * `metric_values` was designed, schema'd, given a reader and a writer — and never
 * written. `upsertMetricValue` in `react-app/src/utils/metricValues.ts` is referenced
 * exactly once in the whole repository: at its own declaration.
 *
 * That matters because `resolveObservationSource` (`kpiResolver.ts:70`) is the **primary**
 * path for every `healthkit` and `strava` KPI, and it reads `metric_values` — not
 * `metrics_workouts`. With the collection empty it always returned null, so every fitness
 * KPI fell through to `resolveProfileSource`, which can only read scalar fields on
 * `profiles`: steps today, body fat, protein today. The consequence is blunt — **no
 * distance-based fitness KPI could resolve at all.** Not weekly swim km, not weekly run
 * km, not any of the volume targets on the phase goals.
 *
 * This is the missing aggregation step. See
 * docs/requirements/fitness-coach-2026-08/WS1-data-spine.md R6.5.
 *
 * ## One row per source, carrying the combined figure
 *
 * A week's running distance may draw on Strava and HealthKit at once, but the resolver
 * asks for a row matching one specific `source` from the KPI's `sourcePriority`. Emitting
 * provider-segmented rows would mean a KPI preferring `healthkit` silently reported only
 * the sessions the Watch happened to record.
 *
 * So the combined figure is written under each contributing source, and `meta.providers`
 * records what actually went into it. Whichever source a KPI asks for, it gets the true
 * total — and can see that the total is not provider-specific.
 */

const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const { activityFromWorkout, groupFor } = require('../utils/activityTaxonomy');

const TZ = 'Europe/London';

/** Every granularity a KPI's `timeframe` can request. Mirrors `toPeriodKey`. */
const TIMEFRAMES = ['daily', 'weekly', 'monthly', 'sprint', 'quarterly', 'annual'];

/**
 * Period key for a timestamp, matching `react-app/src/utils/metricValues.ts:22` exactly.
 * The two must agree or the resolver looks up a key that was never written.
 *
 * `sprint` shares the weekly key deliberately — that is what the client does.
 */
function toPeriodKey(timeframe, ms) {
  const dt = DateTime.fromMillis(ms).setZone(TZ);
  if (timeframe === 'daily') return dt.toFormat('yyyy-MM-dd');
  if (timeframe === 'weekly' || timeframe === 'sprint') {
    return dt.startOf('week').toFormat('yyyy-MM-dd');   // Luxon weeks start Monday
  }
  if (timeframe === 'monthly') return dt.toFormat('yyyy-MM');
  if (timeframe === 'quarterly') return `${dt.year}-Q${dt.quarter}`;
  return String(dt.year);
}

/** Seconds of moving time, however the provider named it. */
function durationSeconds(workout) {
  return Number(workout.movingTime_s || workout.elapsedTime_s || 0) || 0;
}

/** Distance in kilometres. */
function distanceKm(workout) {
  return (Number(workout.distance_m || 0) || 0) / 1000;
}

/**
 * The metric keys one workout contributes to, and by how much.
 *
 * Keys match the ids in `react-app/src/utils/kpiDesignerCatalog.ts`, because `KPIDesigner`
 * writes `metricKey: metricId` and the resolver looks the value up by that key. A metric
 * emitted under a name the catalogue does not offer is a value no KPI can ever ask for.
 */
function contributionsFor(workout) {
  const activity = activityFromWorkout(workout);
  const group = groupFor(activity);
  const km = distanceKm(workout);
  const seconds = durationSeconds(workout);

  const out = [];
  const add = (metricKey, value, unit) => {
    if (!Number.isFinite(value) || value === 0) return;
    out.push({ metricKey, value, unit });
  };

  // Catalogue metrics, so existing KPIs resolve without being redesigned.
  if (group === 'run') add('running_distance', km, 'km');
  if (group === 'cycle') add('cycling_distance', km, 'km');
  if (group === 'swim') add('swimming_distance', km, 'km');
  add('workout_count', 1, 'workouts');
  add('workout_minutes_daily', seconds / 60, 'minutes');

  // Per-activity keys for the activities the catalogue has no curated metric for —
  // walking and hiking distance, and the duration-measured ones (indoor bike, strength,
  // climbing) where a distance is meaningless or absent.
  add(`${activity}_distance`, km, 'km');
  add(`${activity}_duration`, seconds / 60, 'minutes');
  add(`${activity}_sessions`, 1, 'sessions');

  // Zone time, and the Z2+Z3 share the training bias is judged against.
  const zones = workout.hrZones || {};
  let zoneTotal = 0;
  for (let z = 1; z <= 5; z += 1) {
    const zoneSeconds = Number(zones[`z${z}Time_s`] || 0) || 0;
    zoneTotal += zoneSeconds;
    add(`zone${z}_minutes`, zoneSeconds / 60, 'minutes');
  }
  if (zoneTotal > 0) {
    const z2z3 = (Number(zones.z2Time_s || 0) || 0) + (Number(zones.z3Time_s || 0) || 0);
    // Emitted as minutes rather than a percentage: percentages cannot be summed across
    // workouts. The share is computed at read time from these two totals.
    add('zone_recorded_minutes', zoneTotal / 60, 'minutes');
    add('zone2_3_minutes', z2z3 / 60, 'minutes');
  }

  return out;
}

/**
 * Rebuild `metric_values` for one user from their workout history.
 *
 * Rows are rebuilt rather than incremented, so a re-run is idempotent and a corrected or
 * deleted workout cannot leave a stale total behind. `lookbackDays` bounds the work; a
 * period only partly inside the window would be understated, so periods whose start falls
 * before the window are skipped rather than written wrong.
 */
async function aggregateMetricValuesForUser(userId, options = {}) {
  const db = admin.firestore();
  const lookbackDays = Number(options.lookbackDays || 400);
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  // Bounded in the query, not in memory. Fetching the whole collection and filtering
  // afterwards is what OOM'd `enrichRecentStravaHr` at 256MiB during the 2026-08-05
  // backfill; this function was written with the same shape and would have grown into the
  // same wall. The composite index (ownerUid, startDate DESC) already exists.
  const snap = await db.collection('metrics_workouts')
    .where('ownerUid', '==', userId)
    .where('startDate', '>=', since)
    .orderBy('startDate', 'desc')
    .get();

  // Duplicates are excluded, not summed. The same session reaches BOB from Strava and
  // from HealthKit as two unrelated documents; `workoutDedup` marks the loser rather than
  // deleting it, and every consumer that adds distances must skip it or the mileage
  // doubles. See services/workoutDedup.js.
  const workouts = snap.docs.map((d) => d.data()).filter((w) => w.isDuplicate !== true);

  if (workouts.length === 0) {
    return { written: 0, workouts: 0, providers: [] };
  }

  // bucket key -> { value, unit, observedAt, providers:Set }
  const buckets = new Map();
  const providersSeen = new Set();

  for (const workout of workouts) {
    const startMs = Number(workout.startDate || 0);
    if (!startMs) continue;
    const provider = String(workout.provider || workout.source || 'strava').toLowerCase();
    providersSeen.add(provider);

    // Deduplicated, because `weekly` and `sprint` produce the *same* key by design —
    // `toPeriodKey` maps both to the Monday anchor. Iterating the timeframe list
    // directly would add every contribution to that one bucket twice, doubling every
    // weekly total. Buckets are keyed on the period key, so the distinct set is what
    // matters, not the timeframe that produced it.
    const periodKeys = new Set(TIMEFRAMES.map((timeframe) => toPeriodKey(timeframe, startMs)));

    for (const periodKey of periodKeys) {
      for (const { metricKey, value, unit } of contributionsFor(workout)) {
        const bucketKey = `${metricKey}__${periodKey}`;
        const bucket = buckets.get(bucketKey) || {
          metricKey, periodKey, value: 0, unit, observedAt: 0, providers: new Set(),
        };
        bucket.value += value;
        bucket.observedAt = Math.max(bucket.observedAt, startMs);
        bucket.providers.add(provider);
        buckets.set(bucketKey, bucket);
      }
    }
  }

  const batchWrites = [];
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const bucket of buckets.values()) {
    const providers = Array.from(bucket.providers).sort();
    for (const source of providers) {
      const id = [userId, bucket.metricKey, source, bucket.periodKey, 'default'].join('__');
      batchWrites.push({
        id,
        data: {
          ownerUid: userId,
          metricKey: bucket.metricKey,
          source,
          sourceId: null,
          observedAt: bucket.observedAt,
          periodKey: bucket.periodKey,
          value: Number(bucket.value.toFixed(3)),
          unit: bucket.unit || null,
          dataType: 'number',
          isManual: false,
          staleAfterAt: null,
          // What actually contributed. The value is the combined figure across every
          // provider, written under each of them — see the note at the top of this file.
          meta: { providers, combined: providers.length > 1, aggregatedFrom: 'metrics_workouts' },
          syncedAt: now,
          updatedAt: now,
        },
      });
    }
  }

  let written = 0;
  for (let i = 0; i < batchWrites.length; i += 400) {
    const batch = db.batch();
    for (const row of batchWrites.slice(i, i + 400)) {
      batch.set(db.collection('metric_values').doc(row.id), row.data, { merge: true });
    }
    await batch.commit();
    written += Math.min(400, batchWrites.length - i);
  }

  return { written, workouts: workouts.length, providers: Array.from(providersSeen) };
}

module.exports = {
  TIMEFRAMES,
  toPeriodKey,
  contributionsFor,
  aggregateMetricValuesForUser,
};
