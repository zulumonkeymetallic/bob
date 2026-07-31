import {
  quarterMidTimestamp,
  goalDurationMs,
  rescheduleGoalToQuarter,
  DEFAULT_GOAL_DURATION_MS,
  roadmapColumnOrder,
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

  it('drops quarters older than the one before the current', () => {
    const cols = roadmapColumnOrder(
      ['2025-Q1', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'], CUR);
    expect(cols).not.toContain('2025-Q1');
    expect(cols).not.toContain('2026-Q1');
    expect(cols).toContain('2026-Q2');   // n-1 is kept
  });

  it('puts Unscheduled immediately before the current quarter', () => {
    const cols = roadmapColumnOrder(['2026-Q2', '2026-Q3', '2026-Q4'], CUR);
    expect(cols).toEqual(['2026-Q2', 'unscheduled', '2026-Q3', '2026-Q4']);
    expect(cols.indexOf('unscheduled')).toBe(cols.indexOf(CUR) - 1);
  });

  it('leads with Unscheduled when there is no previous quarter to show', () => {
    const cols = roadmapColumnOrder(['2026-Q3', '2026-Q4'], CUR);
    expect(cols[0]).toBe('unscheduled');
    expect(cols[1]).toBe(CUR);
  });

  it('crosses a year boundary correctly', () => {
    const cols = roadmapColumnOrder(['2025-Q3', '2025-Q4', '2026-Q1'], '2026-Q1');
    expect(cols).toEqual(['2025-Q4', 'unscheduled', '2026-Q1']);
  });

  it('always gives the current quarter a column, even when nothing is in it', () => {
    const cols = roadmapColumnOrder(['2026-Q4'], CUR);
    expect(cols).toContain(CUR);
    expect(cols.indexOf(CUR)).toBeLessThan(cols.indexOf('2026-Q4'));
  });

  it('keeps future quarters ascending', () => {
    const cols = roadmapColumnOrder(['2027-Q2', '2026-Q4', '2026-Q3'], CUR);
    expect(cols).toEqual(['unscheduled', '2026-Q3', '2026-Q4', '2027-Q2']);
  });

  it('ignores junk keys and de-duplicates', () => {
    const cols = roadmapColumnOrder(['2026-Q3', '2026-Q3', 'nonsense', ''], CUR);
    expect(cols).toEqual(['unscheduled', '2026-Q3']);
  });

  it('still returns something usable when the current quarter is unknown', () => {
    const cols = roadmapColumnOrder(['2026-Q1', '2026-Q2'], null);
    expect(cols).toEqual(['2026-Q1', '2026-Q2', 'unscheduled']);
  });
});
