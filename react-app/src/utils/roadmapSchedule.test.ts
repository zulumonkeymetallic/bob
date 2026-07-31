import {
  quarterMidTimestamp,
  goalDurationMs,
  rescheduleGoalToQuarter,
  DEFAULT_GOAL_DURATION_MS,
  roadmapColumnOrder,
  computeMonthKey,
  monthOrdinal,
  rescheduleGoalToPeriod,
  roadmapPeriodOrder,
  ROADMAP_ROW_AXIS,
  computeSprintKey,
  roadmapSprintOrder,
  periodLabel,
} from './roadmapSchedule';

const q = (key: string) => new Date(quarterMidTimestamp(key)!);

describe('quarterMidTimestamp', () => {
  it('lands in the middle month of each quarter', () => {
    // Months are 0-indexed: Feb=1, May=4, Aug=7, Nov=10.
    expect(q('2026-Q1').getMonth()).toBe(1);
    expect(q('2026-Q2').getMonth()).toBe(4);
    expect(q('2026-Q3').getMonth()).toBe(7);
    expect(q('2026-Q4').getMonth()).toBe(10);
  });

  it('uses local noon so no timezone shifts the day', () => {
    expect(q('2026-Q2').getDate()).toBe(15);
    expect(q('2026-Q2').getHours()).toBe(12);
  });

  it('is inside the quarter it names, unlike the end-date anchor', () => {
    // The pre-existing helper anchors to the quarter's LAST month because the roadmap cell is
    // keyed off endDate. A start date must not inherit that.
    const start = q('2026-Q3');
    expect(start.getMonth()).toBeGreaterThanOrEqual(6);
    expect(start.getMonth()).toBeLessThanOrEqual(8);
  });

  it('rejects anything that is not a quarter key', () => {
    ['', 'unscheduled', '2026', '2026-Q5', '2026-Q0', 'Q1-2026'].forEach((k) => {
      expect(quarterMidTimestamp(k)).toBeNull();
    });
  });
});

describe('goalDurationMs', () => {
  const day = 24 * 60 * 60 * 1000;

  it('preserves the goal’s existing span', () => {
    expect(goalDurationMs(1_000_000, 1_000_000 + 30 * day)).toBe(30 * day);
  });

  it('falls back to a quarter when either date is missing', () => {
    // The roadmap has been writing endDate alone, so start is very often absent.
    expect(goalDurationMs(null, 1_000_000)).toBe(DEFAULT_GOAL_DURATION_MS);
    expect(goalDurationMs(1_000_000, undefined)).toBe(DEFAULT_GOAL_DURATION_MS);
    expect(goalDurationMs(null, null)).toBe(DEFAULT_GOAL_DURATION_MS);
  });

  it('falls back when the dates are inverted or zero-length', () => {
    expect(goalDurationMs(2_000_000, 1_000_000)).toBe(DEFAULT_GOAL_DURATION_MS);
    expect(goalDurationMs(1_000_000, 1_000_000)).toBe(DEFAULT_GOAL_DURATION_MS);
  });

  it('ignores non-numeric junk rather than producing NaN', () => {
    expect(goalDurationMs('nonsense', {})).toBe(DEFAULT_GOAL_DURATION_MS);
  });
});

describe('rescheduleGoalToQuarter', () => {
  const day = 24 * 60 * 60 * 1000;

  it('lands the goal in the quarter it was dropped on', () => {
    // The regression this replaces: the START was anchored to the target quarter, but the grid
    // positions a goal by its END, so a goal dropped on Q1 2027 appeared in a later quarter.
    const r = rescheduleGoalToQuarter('2027-Q1', null, null)!;
    const end = new Date(r.endDate);
    expect(end.getFullYear()).toBe(2027);
    expect(Math.ceil((end.getMonth() + 1) / 3)).toBe(1);
  });

  it('keeps the end inside the target quarter for every quarter', () => {
    (['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'] as const).forEach((key, i) => {
      const r = rescheduleGoalToQuarter(key, null, null)!;
      expect(Math.ceil((new Date(r.endDate).getMonth() + 1) / 3)).toBe(i + 1);
    });
  });

  it('derives the start backwards from the duration', () => {
    const day = 24 * 60 * 60 * 1000;
    const prevStart = new Date(2026, 0, 1).getTime();
    const r = rescheduleGoalToQuarter('2026-Q4', prevStart, prevStart + 30 * day)!;
    expect(r.endDate - r.startDate).toBe(30 * day);
    expect(r.startDate).toBeLessThan(r.endDate);
  });

  it('keeps the duration the goal already had', () => {
    const prevStart = new Date(2026, 0, 1).getTime();
    const prevEnd = prevStart + 45 * day;
    const r = rescheduleGoalToQuarter('2026-Q4', prevStart, prevEnd)!;
    expect(r.endDate - r.startDate).toBe(45 * day);
  });

  it('always produces an end after the start', () => {
    const r = rescheduleGoalToQuarter('2027-Q1', undefined, undefined)!;
    expect(r.endDate).toBeGreaterThan(r.startDate);
  });

  it('writes BOTH dates — the whole point of this change', () => {
    // Previously only endDate was written, so the nightly story realignment saw a stale start.
    const r = rescheduleGoalToQuarter('2026-Q2', null, null)!;
    expect(typeof r.startDate).toBe('number');
    expect(typeof r.endDate).toBe('number');
  });

  it('declines an unparseable quarter instead of writing garbage', () => {
    expect(rescheduleGoalToQuarter('unscheduled', null, null)).toBeNull();
  });
});

describe('roadmapColumnOrder', () => {
  const CUR = '2026-Q3';

  it('leads with Unscheduled, then one quarter of history, then now', () => {
    expect(roadmapColumnOrder(['2026-Q2', '2026-Q3', '2026-Q4'], CUR))
      .toEqual(['unscheduled', '2026-Q2', '2026-Q3', '2026-Q4']);
  });

  it('puts Unscheduled first so the drag source never scrolls away', () => {
    const cols = roadmapColumnOrder(['2026-Q2', '2026-Q3', '2027-Q1'], CUR);
    expect(cols[0]).toBe('unscheduled');
  });

  it('drops quarters older than the one before the current', () => {
    const cols = roadmapColumnOrder(
      ['2025-Q1', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'], CUR);
    expect(cols).not.toContain('2025-Q1');
    expect(cols).not.toContain('2026-Q1');
    expect(cols).toContain('2026-Q2');   // n-1 is kept
  });

  it('crosses a year boundary correctly', () => {
    expect(roadmapColumnOrder(['2025-Q3', '2025-Q4', '2026-Q1'], '2026-Q1'))
      .toEqual(['unscheduled', '2025-Q4', '2026-Q1']);
  });

  it('always gives the current quarter a column, in the right position', () => {
    const cols = roadmapColumnOrder(['2026-Q4'], CUR);
    expect(cols).toEqual(['unscheduled', '2026-Q3', '2026-Q4']);
  });

  it('keeps future quarters ascending', () => {
    expect(roadmapColumnOrder(['2027-Q2', '2026-Q4', '2026-Q3'], CUR))
      .toEqual(['unscheduled', '2026-Q3', '2026-Q4', '2027-Q2']);
  });

  it('ignores junk keys and de-duplicates', () => {
    expect(roadmapColumnOrder(['2026-Q3', '2026-Q3', 'nonsense', ''], CUR))
      .toEqual(['unscheduled', '2026-Q3']);
  });

  it('still returns something usable when the current quarter is unknown', () => {
    expect(roadmapColumnOrder(['2026-Q1', '2026-Q2'], null))
      .toEqual(['unscheduled', '2026-Q1', '2026-Q2']);
  });
});

describe('month granularity', () => {
  it('pads the month so the ordinal sorts correctly', () => {
    // '2026-M9' would sort after '2026-M10' lexically; the ordinal is what makes it right.
    expect(computeMonthKey(new Date(2026, 8, 15).getTime())).toBe('2026-M09');
    expect(monthOrdinal('2026-M09')! < monthOrdinal('2026-M10')!).toBe(true);
  });

  it('crosses a year boundary in order', () => {
    expect(monthOrdinal('2026-M12')! < monthOrdinal('2027-M01')!).toBe(true);
  });

  it('rejects an impossible month', () => {
    expect(monthOrdinal('2026-M13')).toBeNull();
    expect(monthOrdinal('2026-M00')).toBeNull();
  });

  it('anchors a dropped goal inside the target month', () => {
    const r = rescheduleGoalToPeriod('2027-M03', 'month', null, null)!;
    const end = new Date(r.endDate);
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(2);       // March
    expect(r.startDate).toBeLessThan(r.endDate);
  });

  it('keeps the duration across a month move, like the quarter version', () => {
    const day = 86_400_000;
    const s = new Date(2026, 0, 1).getTime();
    const r = rescheduleGoalToPeriod('2026-M08', 'month', s, s + 20 * day)!;
    expect(r.endDate - r.startDate).toBe(20 * day);
  });

  it('orders month columns with Unscheduled first and one month of history', () => {
    const cols = roadmapPeriodOrder(
      ['2026-M05', '2026-M06', '2026-M07', '2026-M08'], '2026-M07', 'month');
    expect(cols).toEqual(['unscheduled', '2026-M06', '2026-M07', '2026-M08']);
  });

  it('delegates to the quarter ordering when granularity is quarter', () => {
    expect(roadmapPeriodOrder(['2026-Q2', '2026-Q3'], '2026-Q3', 'quarter'))
      .toEqual(['unscheduled', '2026-Q2', '2026-Q3']);
  });

  it('pairs each granularity with the row axis that suits it', () => {
    expect(ROADMAP_ROW_AXIS.quarter).toBe('theme');
    expect(ROADMAP_ROW_AXIS.month).toBe('goal');
  });
});

describe('sprint granularity', () => {
  const day = 86_400_000;
  // Anchored on the real clock, not a fixed date: roadmapSprintOrder defaults to Date.now(),
  // so a hardcoded fixture silently rots as time passes it.
  const base = Date.now();
  const sprints = [
    { id: 's1', name: 'S46', startDate: base - 30 * day, endDate: base - 16 * day },
    { id: 's2', name: 'S47', startDate: base - 15 * day, endDate: base - day },
    { id: 's3', name: 'S48', startDate: base, endDate: base + 14 * day },   // contains "now"
    { id: 's4', name: 'S49', startDate: base + 15 * day, endDate: base + 29 * day },
  ];
  const now = base + 2 * day;

  it('finds the sprint whose window contains the date', () => {
    expect(computeSprintKey(base + 5 * day, sprints)).toBe('s3');
    expect(computeSprintKey(base - 20 * day, sprints)).toBe('s1');
  });

  it('returns null outside every sprint rather than guessing', () => {
    expect(computeSprintKey(base + 500 * day, sprints)).toBeNull();
    expect(computeSprintKey(null, sprints)).toBeNull();
  });

  it('ignores sprints with unusable dates', () => {
    expect(computeSprintKey(base, [{ id: 'x', startDate: null, endDate: undefined }])).toBeNull();
  });

  it('orders columns Unscheduled, previous, current, future', () => {
    expect(roadmapSprintOrder(sprints, now)).toEqual(['unscheduled', 's2', 's3', 's4']);
  });

  it('keeps a sprint column even when no goal lands in it', () => {
    // The column comes from the sprint list, not from the data — you must be able to drag INTO
    // an empty sprint.
    expect(roadmapPeriodOrder([], null, 'sprint', sprints)).toContain('s3');
  });

  it('anchors a dropped goal to the middle of the target sprint', () => {
    const r = rescheduleGoalToPeriod('s3', 'sprint', null, null, sprints)!;
    expect(r.endDate).toBeGreaterThanOrEqual(base);
    expect(r.endDate).toBeLessThanOrEqual(base + 14 * day);
  });

  it('preserves duration across a sprint move, like every other granularity', () => {
    const s = new Date(2026, 0, 1).getTime();
    const r = rescheduleGoalToPeriod('s4', 'sprint', s, s + 20 * day, sprints)!;
    expect(r.endDate - r.startDate).toBe(20 * day);
  });

  it('declines to write when the sprint has no dates', () => {
    expect(rescheduleGoalToPeriod('nope', 'sprint', null, null, sprints)).toBeNull();
  });

  it('labels a column with the sprint name', () => {
    expect(periodLabel('s3', 'sprint', sprints)).toBe('S48');
    expect(periodLabel('unscheduled', 'sprint', sprints)).toBe('Unscheduled');
  });

  it('falls forward to the next unfinished sprint when none contains today', () => {
    const past = sprints.slice(0, 2);
    expect(roadmapSprintOrder(past, base - 40 * day)).toEqual(['unscheduled', 's1', 's2']);
  });

  it('uses theme rows, not goal rows — a sprint grid with 100+ rows is unusable', () => {
    expect(ROADMAP_ROW_AXIS.sprint).toBe('theme');
  });
});
