/**
 * The canonical activity taxonomy. One list, mirrored by
 * `functions/utils/activityTaxonomy.js` and
 * `bob-ios/BOB/Sources/Models/ActivityType.swift`.
 *
 * ## Why this exists
 *
 * BOB had six of these and none of them agreed. The consequences were not cosmetic: a
 * 12km hike counted toward a 30km/week *running* target, and so did every walk — which
 * matters more now that walking carries a 12,000-step daily target of its own. Strength
 * and climbing fell into "other" and so into no metric at all. Indoor and outdoor cycling
 * were indistinguishable, though both HealthKit and Strava distinguish them.
 *
 * See docs/requirements/fitness-coach-2026-08/WS1-data-spine.md.
 */

export type ActivityKey =
  | 'run'
  | 'walk'
  | 'bike_outdoor'
  | 'bike_indoor'
  | 'swim'
  | 'strength'
  | 'climb'
  | 'hike'
  | 'sauna'
  | 'other';

/** Coarse grouping used by weekly volume targets. Both bike variants collapse to `cycle`. */
export type ActivityGroup =
  | 'run' | 'walk' | 'hike' | 'swim' | 'cycle' | 'strength' | 'climb' | 'sauna' | 'other';

export type ActivityPrimaryMetric = 'distance' | 'duration' | 'habit_occurrence';

interface ActivityDefinition {
  group: ActivityGroup;
  metric: ActivityPrimaryMetric;
  /** Whether the scheduler must leave a block of this activity alone. */
  protectedTraining: boolean;
  label: string;
}

export const ACTIVITIES: Record<ActivityKey, ActivityDefinition> = {
  run:          { group: 'run',      metric: 'distance', protectedTraining: true,  label: 'Run' },
  walk:         { group: 'walk',     metric: 'distance', protectedTraining: false, label: 'Walk' },
  bike_outdoor: { group: 'cycle',    metric: 'distance', protectedTraining: true,  label: 'Bike' },
  bike_indoor:  { group: 'cycle',    metric: 'duration', protectedTraining: true,  label: 'Bike (indoor)' },
  swim:         { group: 'swim',     metric: 'distance', protectedTraining: true,  label: 'Swim' },
  strength:     { group: 'strength', metric: 'duration', protectedTraining: true,  label: 'Strength' },
  climb:        { group: 'climb',    metric: 'duration', protectedTraining: true,  label: 'Climb' },
  hike:         { group: 'hike',     metric: 'distance', protectedTraining: true,  label: 'Hike' },
  // No HealthKit workout type exists for a sauna and the Watch cannot record one. It is a
  // calendar block plus a habit tick, never a derived metric.
  sauna:        { group: 'sauna',    metric: 'habit_occurrence', protectedTraining: false, label: 'Sauna' },
  other:        { group: 'other',    metric: 'duration', protectedTraining: false, label: 'Other' },
};

/**
 * A provider's sport string, or a block title, to a canonical activity.
 *
 * Order matters: `VirtualRide` must be tested before the generic ride/bike check, or an
 * indoor session reads as a road ride.
 */
export function activityFromSport(raw: string | null | undefined): ActivityKey {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return 'other';

  if (s.includes('virtual') && (s.includes('ride') || s.includes('cycl') || s.includes('bike'))) {
    return 'bike_indoor';
  }
  if (s.includes('turbo') || s.includes('zwift') || s.includes('peloton')) return 'bike_indoor';
  if (s.includes('swim')) return 'swim';
  if (s.includes('hike') || s.includes('hiking')) return 'hike';
  if (s.includes('walk')) return 'walk';
  if (s.includes('run')) return 'run';
  if (s.includes('cycl') || s.includes('ride') || s.includes('bike')) return 'bike_outdoor';
  if (s.includes('strength') || s.includes('weight') || s.includes('gym')
      || s.includes('crossfit') || s.includes('resistance')) return 'strength';
  if (s.includes('climb') || s.includes('bould')) return 'climb';
  if (s.includes('sauna')) return 'sauna';
  return 'other';
}

/** Canonical activity for a `metrics_workouts` document. */
export function activityFromWorkout(workout: any): ActivityKey {
  if (!workout) return 'other';
  if (workout.provider === 'parkrun') return 'run';
  // Written directly by the iOS app, which knows the HealthKit type and the indoor flag —
  // strictly better than inferring from a sport string.
  if (workout.activity && workout.activity in ACTIVITIES) return workout.activity as ActivityKey;
  const activity = activityFromSport(workout.sportType || workout.type || workout.name);
  // Strava marks turbo sessions with `isTrainer` even when the type is a plain "Ride".
  if (activity === 'bike_outdoor' && workout.isTrainer === true) return 'bike_indoor';
  return activity;
}

export function groupFor(activity: ActivityKey): ActivityGroup {
  return (ACTIVITIES[activity] || ACTIVITIES.other).group;
}

export function primaryMetricFor(activity: ActivityKey): ActivityPrimaryMetric {
  return (ACTIVITIES[activity] || ACTIVITIES.other).metric;
}

export function isProtectedTrainingActivity(activity: ActivityKey): boolean {
  return (ACTIVITIES[activity] || ACTIVITIES.other).protectedTraining;
}

export function labelFor(activity: ActivityKey): string {
  return (ACTIVITIES[activity] || ACTIVITIES.other).label;
}
