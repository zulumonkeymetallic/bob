const {
  pairAcrossProviders,
  unmarkedDuplicateIds,
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

describe('pairAcrossProviders', () => {
  it('pairs the same run seen by Strava and HealthKit', () => {
    const pairs = pairAcrossProviders([strava(), healthkit()]);
    expect(pairs).toHaveLength(1);
    // HealthKit survives; the Strava copy is set aside.
    expect(pairs[0].canonical._id).toBe('uid_hk_abc');
    expect(pairs[0].duplicates.map((d) => d._id)).toEqual(['uid_123']);
  });

  it('NEVER pairs two records from the same provider', () => {
    // The case that made the first version of this dangerous. A dry run against Jim's
    // real feed flagged 16 "duplicates", every one a Strava/Strava pair: a 0.42km jog
    // before a 5.02km parkrun, four interval legs on one afternoon, a 0.27km warm-up
    // before a 6.37km run. All real, all distinct. Marking the shorter one would have
    // silently deleted that distance from every total.
    const warmup = strava({ _id: 'warmup', distance_m: 420, startDate: T });
    const parkrun = strava({ _id: 'parkrun', distance_m: 5020, startDate: T + mins(20) });
    expect(pairAcrossProviders([warmup, parkrun])).toHaveLength(0);
  });

  it('leaves four same-provider interval legs entirely alone', () => {
    const legs = [640, 410, 700, 2640].map((d, i) => strava({
      _id: `leg${i}`, distance_m: d, startDate: T + mins(i * 5),
    }));
    expect(pairAcrossProviders(legs)).toHaveLength(0);
  });

  it('prefers HealthKit over Strava as the survivor', () => {
    // HealthKit is the primary source: the watch records every session, and Strava is
    // usually a copy of that same recording. Preferring Strava discards the original for
    // a derivative — and when its authorisation lapses, for nothing.
    const pairs = pairAcrossProviders([healthkit(), strava()]);
    expect(pairs[0].canonical.provider).toBe('healthkit');
  });

  it('prefers parkrun over everything — it is an officially timed result', () => {
    const pr = { _id: 'pr', provider: 'parkrun', type: 'Run', distance_m: 5000, startDate: T };
    expect(pairAcrossProviders([healthkit(), pr])[0].canonical._id).toBe('pr');
    expect(pairAcrossProviders([strava(), pr])[0].canonical._id).toBe('pr');
  });

  it('keeps genuinely separate sessions apart', () => {
    const pairs = pairAcrossProviders([strava(), healthkit({ startDate: T + mins(600) })]);
    expect(pairs).toHaveLength(0);
  });

  it('does not pair a run with a walk that finished at the same moment', () => {
    const pairs = pairAcrossProviders([
      strava(),
      healthkit({ _id: 'walk', type: 'walk', activity: 'walk' }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('does not pair an indoor with an outdoor ride at the same time', () => {
    const pairs = pairAcrossProviders([
      strava({ _id: 'road', type: 'Ride' }),
      healthkit({ _id: 'turbo', type: 'cycling', activity: 'bike_indoor', startDate: T + mins(3) }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('treats the window as inclusive at its edge', () => {
    const inside = pairAcrossProviders([strava(), healthkit({ startDate: T + DEDUP_WINDOW_MS })]);
    const outside = pairAcrossProviders([strava(), healthkit({ startDate: T + DEDUP_WINDOW_MS + 1 })]);
    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(0);
  });

  it('claims each duplicate once, even with several candidates in the window', () => {
    // Both Strava rows fall to the higher-ranked HealthKit one, and neither is claimed
    // twice — the guard that stops a record being counted as a duplicate of two survivors.
    const pairs = pairAcrossProviders([
      strava({ _id: 's1', startDate: T }),
      strava({ _id: 's2', startDate: T + mins(10) }),
      healthkit({ _id: 'hk', startDate: T + mins(5) }),
    ]);
    const claimed = pairs.flatMap((p) => p.duplicates.map((d) => d._id));
    expect(claimed.sort()).toEqual(['s1', 's2']);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('ignores records with no start time', () => {
    expect(pairAcrossProviders([strava(), healthkit({ startDate: 0 })])).toHaveLength(0);
  });
});

describe('unmarkedDuplicateIds', () => {
  it('names the loser so the overview can skip it before the nightly pass runs', () => {
    // The window this closes: a HealthKit workout pushed from the phone at lunchtime sits
    // beside its Strava twin unmarked until 03:00, and every total sums both. The mileage
    // reads double all afternoon and then silently halves overnight.
    const ids = unmarkedDuplicateIds([strava(), healthkit()]);
    expect([...ids]).toEqual(['uid_123']);
  });

  it('reads `id` as well as `_id` — index.js maps documents the other way', () => {
    const ids = unmarkedDuplicateIds([
      { id: 's', provider: 'strava', type: 'Run', distance_m: 10000, startDate: T },
      { id: 'h', provider: 'healthkit', type: 'run', activity: 'run', startDate: T + mins(2) },
    ]);
    expect([...ids]).toEqual(['s']);
  });

  it('is empty when nothing is paired', () => {
    expect(unmarkedDuplicateIds([strava(), healthkit({ startDate: T + mins(600) })]).size).toBe(0);
  });
});

describe('buildMergePatch', () => {
  const zones = { z1Time_s: 300, z2Time_s: 900, z3Time_s: 600, z4Time_s: 0, z5Time_s: 0 };

  it('takes zone time from a twin when the survivor has none', () => {
    const patch = buildMergePatch(strava(), [healthkit({ hrZones: zones, maxHrUsed: 186 })]);
    expect(patch.hrZones).toEqual(zones);
    expect(patch.maxHrUsed).toBe(186);
    expect(patch.zoneSource).toBe('healthkit');
  });

  it('takes a distance from the twin when the survivor has none', () => {
    const patch = buildMergePatch(healthkit({ distance_m: 0 }), [strava({ distance_m: 10000 })]);
    expect(patch.distance_m).toBe(10000);
  });

  it('never overwrites a distance the survivor already has', () => {
    // A strength session has no distance and must not acquire one from a mismatched twin.
    const patch = buildMergePatch(healthkit({ distance_m: 9950 }), [strava({ distance_m: 10000 })]);
    expect(patch.distance_m).toBeUndefined();
  });

  it('never overwrites zone time the survivor already has', () => {
    const canonical = strava({ hrZones: zones, maxHrUsed: 186 });
    const patch = buildMergePatch(canonical, [healthkit({ hrZones: { z1Time_s: 1 }, maxHrUsed: 190 })]);
    expect(patch.hrZones).toBeUndefined();
    expect(patch.maxHrUsed).toBeUndefined();
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
