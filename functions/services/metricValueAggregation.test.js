const { toPeriodKey, contributionsFor, TIMEFRAMES } = require('./metricValueAggregation');

// 2026-08-04 is a Tuesday; its week anchors on Monday 2026-08-03.
const TUESDAY = Date.UTC(2026, 7, 4, 9, 30);

describe('toPeriodKey', () => {
  it('matches the client shapes in react-app/src/utils/metricValues.ts', () => {
    expect(toPeriodKey('daily', TUESDAY)).toBe('2026-08-04');
    expect(toPeriodKey('weekly', TUESDAY)).toBe('2026-08-03');
    expect(toPeriodKey('monthly', TUESDAY)).toBe('2026-08');
    expect(toPeriodKey('quarterly', TUESDAY)).toBe('2026-Q3');
    expect(toPeriodKey('annual', TUESDAY)).toBe('2026');
  });

  it('gives sprint the same key as weekly, as the client does', () => {
    expect(toPeriodKey('sprint', TUESDAY)).toBe(toPeriodKey('weekly', TUESDAY));
  });

  it('collapses the six timeframes to five distinct keys', () => {
    // The reason aggregation must deduplicate: iterating timeframes rather than the
    // distinct keys they produce doubles every weekly total.
    const keys = new Set(TIMEFRAMES.map((t) => toPeriodKey(t, TUESDAY)));
    expect(keys.size).toBe(5);
  });
});

describe('contributionsFor', () => {
  const find = (rows, key) => rows.find((r) => r.metricKey === key);

  it('credits a run to running_distance, not a hike', () => {
    const run = contributionsFor({ type: 'Run', distance_m: 10000, movingTime_s: 3000 });
    expect(find(run, 'running_distance').value).toBe(10);

    const hike = contributionsFor({ type: 'Hike', distance_m: 12000, movingTime_s: 9000 });
    // The bug this taxonomy replaced: .hiking mapped to "run", so a 12km hike counted
    // against a 30km/week *running* target.
    expect(find(hike, 'running_distance')).toBeUndefined();
    expect(find(hike, 'hike_distance').value).toBe(12);
  });

  it('does not credit a walk to running distance', () => {
    const walk = contributionsFor({ type: 'Walk', distance_m: 4000, movingTime_s: 2700 });
    expect(find(walk, 'running_distance')).toBeUndefined();
    expect(find(walk, 'walk_distance').value).toBe(4);
  });

  it('separates indoor from outdoor cycling while both count as cycling distance', () => {
    const turbo = contributionsFor({ type: 'VirtualRide', distance_m: 30000, movingTime_s: 3600 });
    expect(find(turbo, 'cycling_distance').value).toBe(30);
    expect(find(turbo, 'bike_indoor_duration').value).toBe(60);
    expect(find(turbo, 'bike_outdoor_duration')).toBeUndefined();
  });

  it('treats a trainer-flagged Ride as indoor', () => {
    const rows = contributionsFor({ type: 'Ride', isTrainer: true, movingTime_s: 1800 });
    expect(find(rows, 'bike_indoor_duration').value).toBe(30);
  });

  it('counts a strength session, which has no distance at all', () => {
    const rows = contributionsFor({ type: 'WeightTraining', movingTime_s: 2700 });
    expect(find(rows, 'strength_sessions').value).toBe(1);
    expect(find(rows, 'strength_duration').value).toBe(45);
    expect(find(rows, 'strength_distance')).toBeUndefined();
  });

  it('emits zone minutes and the Z2+Z3 band as summable totals', () => {
    const rows = contributionsFor({
      type: 'Run',
      distance_m: 8000,
      movingTime_s: 2400,
      hrZones: { z1Time_s: 300, z2Time_s: 900, z3Time_s: 600, z4Time_s: 300, z5Time_s: 0 },
    });
    expect(find(rows, 'zone2_minutes').value).toBe(15);
    expect(find(rows, 'zone_recorded_minutes').value).toBe(35);
    // 900 + 600 seconds = 25 minutes in the target band.
    expect(find(rows, 'zone2_3_minutes').value).toBe(25);
  });

  it('emits no zone rows for a workout with no heart rate', () => {
    const rows = contributionsFor({ type: 'Run', distance_m: 5000, movingTime_s: 1500 });
    expect(find(rows, 'zone_recorded_minutes')).toBeUndefined();
    expect(find(rows, 'zone2_3_minutes')).toBeUndefined();
  });

  it('prefers an explicitly written activity over the sport string', () => {
    // The iOS app knows the HealthKit type and the indoor flag; inference does not.
    const rows = contributionsFor({ activity: 'bike_indoor', type: 'Ride', movingTime_s: 3600 });
    expect(find(rows, 'bike_indoor_duration').value).toBe(60);
  });
});
