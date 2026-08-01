import {
  quarterOptionsIncluding,
  buildQuarterOptions,
  currentQuarterKey,
  dateInputToQuarterKey,
  quarterKeyLabel,
  quarterKeyToDateInputs,
  quarterKeyToMidpointMs,
} from './quarters';

describe('currentQuarterKey', () => {
  it('maps each month to its quarter', () => {
    expect(currentQuarterKey(new Date(2026, 0, 15))).toBe('2026-Q1');  // Jan
    expect(currentQuarterKey(new Date(2026, 2, 31))).toBe('2026-Q1');  // Mar
    expect(currentQuarterKey(new Date(2026, 3, 1))).toBe('2026-Q2');   // Apr
    expect(currentQuarterKey(new Date(2026, 11, 31))).toBe('2026-Q4'); // Dec
  });
});

describe('buildQuarterOptions', () => {
  it('starts at the quarter containing the given date', () => {
    expect(buildQuarterOptions(3, new Date(2026, 7, 1))[0]).toBe('2026-Q3');
  });

  it('rolls over the year rather than producing a Q5', () => {
    expect(buildQuarterOptions(3, new Date(2026, 10, 1))).toEqual(['2026-Q4', '2027-Q1', '2027-Q2']);
  });
});

describe('quarterKeyToDateInputs', () => {
  it('returns the first and last day of the quarter', () => {
    expect(quarterKeyToDateInputs('2026-Q1')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(quarterKeyToDateInputs('2026-Q4')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });

  it('handles the leap-year quarter end', () => {
    expect(quarterKeyToDateInputs('2028-Q1')?.end).toBe('2028-03-31');
  });

  /**
   * The reason this formats from local date parts rather than toISOString(): anywhere behind
   * UTC, converting midnight-local to UTC lands on the previous day, so a quarter's first day
   * would come back as the last day of the quarter before it.
   */
  it('does not shift the start date across a timezone boundary', () => {
    expect(quarterKeyToDateInputs('2026-07-01' as any)).toBeNull();
    expect(quarterKeyToDateInputs('2026-Q3')?.start).toBe('2026-07-01');
  });

  it('returns null for an unparseable key', () => {
    expect(quarterKeyToDateInputs('nonsense')).toBeNull();
    expect(quarterKeyToDateInputs('2026-Q5')).toBeNull();
  });
});

describe('dateInputToQuarterKey', () => {
  it('round-trips with quarterKeyToDateInputs', () => {
    for (const key of ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1']) {
      const bounds = quarterKeyToDateInputs(key)!;
      expect(dateInputToQuarterKey(bounds.start)).toBe(key);
      expect(dateInputToQuarterKey(bounds.end)).toBe(key);
    }
  });

  it('returns empty string for blank or malformed input', () => {
    expect(dateInputToQuarterKey('')).toBe('');
    expect(dateInputToQuarterKey('not-a-date')).toBe('');
  });
});

describe('quarterKeyToMidpointMs', () => {
  it('falls inside the quarter it names', () => {
    const mid = quarterKeyToMidpointMs('2026-Q3')!;
    expect(mid).toBeGreaterThan(new Date(2026, 6, 1).getTime());
    expect(mid).toBeLessThan(new Date(2026, 9, 1).getTime());
  });

  it('returns null for an unparseable key', () => {
    expect(quarterKeyToMidpointMs('2026-Q9')).toBeNull();
  });
});

describe('quarterKeyLabel', () => {
  it('reads as a human would say it', () => {
    expect(quarterKeyLabel('2026-Q3')).toBe('Q3 2026');
  });
});

describe('quarterOptionsIncluding', () => {
  const from = new Date(2026, 7, 1); // Q3 2026

  it('surfaces a past quarter so an existing goal shows its own value', () => {
    const opts = quarterOptionsIncluding('2026-Q1', 4, from);
    expect(opts).toContain('2026-Q1');
    expect(opts[0]).toBe('2026-Q1'); // sorted, so the past quarter leads
  });

  it('does not duplicate a quarter already in range', () => {
    const opts = quarterOptionsIncluding('2026-Q4', 4, from);
    expect(opts.filter((k) => k === '2026-Q4')).toHaveLength(1);
  });

  it('ignores a malformed selection', () => {
    expect(quarterOptionsIncluding('', 4, from)).toEqual(buildQuarterOptions(4, from));
    expect(quarterOptionsIncluding('2026-Q7', 4, from)).toEqual(buildQuarterOptions(4, from));
  });

  it('stays in chronological order across a year boundary', () => {
    const opts = quarterOptionsIncluding('2025-Q2', 4, from);
    expect(opts).toEqual(['2025-Q2', '2026-Q3', '2026-Q4', '2027-Q1', '2027-Q2']);
  });
});
