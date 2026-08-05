/**
 * Shared filters for the `metrics_workouts` feed.
 *
 * ## Why duplicates exist at all
 *
 * The same session reaches BOB twice, as two unrelated documents with different ids: from
 * Strava as `{uid}_{activityId}` and from HealthKit via the phone as `{uid}_hk_{uuid}`.
 * Nothing in the write path joins them — the iOS guard only fires when Strava got there
 * first, and a watch that syncs before its upload lands produces both.
 *
 * `functions/services/workoutDedup.js` reconciles them nightly, marking the loser
 * `isDuplicate` and merging anything it uniquely held (zone time, above all) onto the
 * survivor. It marks rather than deletes, because a mis-matched pair would otherwise
 * destroy a real session and a flag can be cleared.
 *
 * The consequence for readers: **every surface that sums distance, duration or counts must
 * exclude them**, or the mileage doubles. A doubled figure is worse than a missing one,
 * because it looks plausible.
 *
 * This is applied client-side rather than in the Firestore query deliberately — a
 * `where('isDuplicate','!=',true)` would exclude every document that has never been
 * through the dedup pass and so carries no such field at all.
 */
export function excludeDuplicateWorkouts<T>(workouts: T[]): T[] {
  // Unconstrained in T, and the flag read through a cast, so this composes with every
  // shape the call sites already use — the raw `{ id, ...data() }` spread as well as the
  // typed `WorkoutDoc`. A `T extends { isDuplicate?: boolean }` bound looks tidier and
  // rejects both, because TypeScript requires a structural type to share at least one
  // property with its constraint.
  return workouts.filter((w) => (w as { isDuplicate?: boolean } | null)?.isDuplicate !== true);
}
