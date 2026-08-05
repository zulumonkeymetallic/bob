const {
  toPeriodKey,
  weeklySnapshotKey,
  freshnessWindowFor,
  newestTimestamp,
  computeProgressPct,
} = require('./kpiResolution');

// 2026-08-05 is a Wednesday; its week anchors on Monday 2026-08-03.
const WED = Date.UTC(2026, 7, 5, 9, 0);

describe('toPeriodKey', () => {
  it('agrees with metricValueAggregation and the client', () => {
    expect(toPeriodKey('daily', WED)).toBe('2026-08-05');
    expect(toPeriodKey('weekly', WED)).toBe('2026-08-03');
    expect(toPeriodKey('monthly', WED)).toBe('2026-08');
    expect(toPeriodKey('quarterly', WED)).toBe('2026-Q3');
    expect(toPeriodKey('annual', WED)).toBe('2026');
  });

  it('gives sprint the weekly key, as both other implementations do', () => {
    expect(toPeriodKey('sprint', WED)).toBe(toPeriodKey('weekly', WED));
  });
});

describe('weeklySnapshotKey', () => {
  it('is an ISO week key', () => {
    expect(weeklySnapshotKey(WED)).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('pads the week number so keys sort', () => {
    const early = weeklySnapshotKey(Date.UTC(2026, 0, 8));
    expect(early).toBe('2026-W02');
  });
});

describe('newestTimestamp', () => {
  it('takes the newest, never the first non-null', () => {
    // The whole point: healthkitLastSyncAt sat at 2026-06-06 for eight weeks while
    // health_metrics was written daily. `a || b` believed the dead field.
    const dead = Date.UTC(2026, 5, 6);
    const live = Date.UTC(2026, 7, 5);
    expect(newestTimestamp(dead, live)).toBe(live);
    expect(newestTimestamp(live, dead)).toBe(live);
  });

  it('ignores nulls rather than treating them as zero', () => {
    expect(newestTimestamp(null, undefined, 1234)).toBe(1234);
  });

  it('returns null when nothing is usable', () => {
    expect(newestTimestamp(null, undefined)).toBeNull();
  });
});

describe('freshnessWindowFor', () => {
  it('is per-signal, not a flat 24 hours', () => {
    // A rest week must not read as a broken pipe.
    expect(freshnessWindowFor('running_distance_workout')).toBe(240);
    expect(freshnessWindowFor('hrv_daily')).toBe(72);
    expect(freshnessWindowFor('steps_daily')).toBe(48);
    expect(freshnessWindowFor('body_fat_bodyfat')).toBe(336);
  });

  it('defaults sync-tolerantly for an unknown signal', () => {
    expect(freshnessWindowFor('something_unrecognised')).toBe(72);
  });

  it('lets an explicit window win', () => {
    expect(freshnessWindowFor('hrv', 12)).toBe(12);
  });
});

describe('computeProgressPct', () => {
  it('scores progress toward a target', () => {
    expect(computeProgressPct(15, 30)).toBe(50);
  });

  it('inverts when lower is better', () => {
    // Body fat 31% against an 18% target is not 172% achieved.
    expect(computeProgressPct(31, 18, true)).toBeLessThan(100);
    expect(computeProgressPct(18, 18, true)).toBe(100);
  });

  it('caps at 200 rather than reporting a runaway multiple', () => {
    expect(computeProgressPct(500, 10)).toBe(200);
  });

  it('returns null for a missing value or a zero target', () => {
    expect(computeProgressPct(null, 30)).toBeNull();
    expect(computeProgressPct(15, 0)).toBeNull();
    expect(computeProgressPct(15, null)).toBeNull();
  });
});
