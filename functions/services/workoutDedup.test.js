const {
  clusterSessions,
  chooseCanonical,
  buildMergePatch,
  DEDUP_WINDOW_MS,
} = require('./workoutDedup');

const T = Date.UTC(2026, 7, 5, 7, 0);
const mins = (n) => n * 60 * 1000;

const strava = (over = {}) => ({
  _id: 'uid_123', provider: 'strava', type: 'Run',
  distance_m: 10000, movingTime_s: 3000, startDate: T, ...over,
});
const healthkit = (over = {}) => ({
  _id: 'uid_hk_abc', provider: 'healthkit', type: 'run', activity: 'run',
  distance_m: 9950, movingTime_s: 3010, startDate: T + mins(2), ...over,
});

describe('clusterSessions', () => {
  it('clusters the same run from both providers', () => {
    const clusters = clusterSessions([strava(), healthkit()]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('keeps genuinely separate sessions apart', () => {
    // A double day: morning run and an evening run.
    const clusters = clusterSessions([strava(), strava({ _id: 'pm', startDate: T + mins(600) })]);
    expect(clusters).toHaveLength(2);
  });

  it('does not merge a run and a walk that finish together', () => {
    const clusters = clusterSessions([
      strava(),
      healthkit({ _id: 'walk', type: 'walk', activity: 'walk' }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('does not merge an indoor and an outdoor ride at the same time', () => {
    const clusters = clusterSessions([
      strava({ _id: 'road', type: 'Ride' }),
      strava({ _id: 'turbo', type: 'VirtualRide', startDate: T + mins(3) }),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('treats the window as inclusive at its edge', () => {
    const inside = clusterSessions([strava(), healthkit({ startDate: T + DEDUP_WINDOW_MS })]);
    const outside = clusterSessions([strava(), healthkit({ startDate: T + DEDUP_WINDOW_MS + 1 })]);
    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(2);
  });

  it('ignores records with no start time rather than clustering them together', () => {
    const clusters = clusterSessions([strava(), healthkit({ startDate: 0 })]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(1);
  });
});

describe('chooseCanonical', () => {
  it('prefers Strava, which carries the corrected distance and the track', () => {
    expect(chooseCanonical([healthkit(), strava()])._id).toBe('uid_123');
  });

  it('prefers parkrun over HealthKit', () => {
    const pr = { _id: 'pr', provider: 'parkrun', type: 'Run', distance_m: 5000, startDate: T };
    expect(chooseCanonical([healthkit(), pr])._id).toBe('pr');
  });

  it('between two of the same provider, keeps the fuller record', () => {
    const fragment = strava({ _id: 'frag', distance_m: 400, movingTime_s: 120 });
    expect(chooseCanonical([fragment, strava()])._id).toBe('uid_123');
  });
});

describe('buildMergePatch', () => {
  const zones = { z1Time_s: 300, z2Time_s: 900, z3Time_s: 600, z4Time_s: 0, z5Time_s: 0 };

  it('takes zone time from the HealthKit twin when Strava has none', () => {
    const patch = buildMergePatch(strava(), [healthkit({ hrZones: zones, maxHrUsed: 186 })]);
    expect(patch.hrZones).toEqual(zones);
    expect(patch.maxHrUsed).toBe(186);
    expect(patch.zoneSource).toBe('healthkit');
  });

  it('never overwrites zone time the survivor already has', () => {
    const canonical = strava({ hrZones: zones, maxHrUsed: 186 });
    const patch = buildMergePatch(canonical, [healthkit({ hrZones: { z1Time_s: 1 }, maxHrUsed: 190 })]);
    expect(patch.hrZones).toBeUndefined();
    expect(patch.maxHrUsed).toBeUndefined();
  });

  it('never overwrites the distance — Strava is canonical for it', () => {
    const patch = buildMergePatch(strava(), [healthkit({ distance_m: 12000 })]);
    expect(patch.distance_m).toBeUndefined();
  });

  it('fills a missing duration from the twin', () => {
    const patch = buildMergePatch(strava({ movingTime_s: 0, elapsedTime_s: 0 }), [healthkit()]);
    expect(patch.movingTime_s).toBe(3010);
    expect(patch.elapsedTime_s).toBe(3010);
  });

  it('produces no patch when the survivor is already complete', () => {
    const canonical = strava({ hrZones: zones, avgHeartrate: 142 });
    expect(buildMergePatch(canonical, [healthkit()])).toEqual({});
  });
});
