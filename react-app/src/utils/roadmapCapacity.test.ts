import {
  clockMinutes,
  columnWindow,
  computeColumnCapacity,
  formatCapacity,
  pointsToHours,
  summariseCapacity,
  weeklyHoursByTheme,
  windowWeeks,
  type ThemeAllocationRow,
} from './roadmapCapacity';

const row = (theme: string, startTime: string, endTime: string, subTheme?: string): ThemeAllocationRow =>
  ({ dayOfWeek: 1, startTime, endTime, theme, subTheme: subTheme ?? null });

describe('clockMinutes', () => {
  it('parses HH:mm', () => {
    expect(clockMinutes('09:30')).toBe(570);
    expect(clockMinutes('9:05')).toBe(545);
    expect(clockMinutes('00:00')).toBe(0);
  });

  it('rejects anything that is not a time, rather than returning NaN', () => {
    ['', null, undefined, 'noon', '25:00', '10:70', '10'].forEach((v) => {
      expect(clockMinutes(v)).toBeNull();
    });
  });
});

describe('weeklyHoursByTheme', () => {
  it('sums the plan into hours per week', () => {
    const hours = weeklyHoursByTheme([
      row('Work (Main Gig)', '09:00', '17:30'),
      row('Work (Main Gig)', '09:00', '17:00'),
      row('Chores', '18:00', '19:30'),
    ]);
    expect(hours.get('Work (Main Gig)')).toBeCloseTo(16.5);
    expect(hours.get('Chores')).toBeCloseTo(1.5);
  });

  it('rolls sub-themes into their PARENT theme', () => {
    // The plan splits Health & Fitness into Run/Bike/Swim/S&C/Walk, but stories are themed
    // "Health & Fitness". Keying on subTheme would report zero capacity for the theme.
    const hours = weeklyHoursByTheme([
      row('Health & Fitness', '06:00', '07:00', 'Run'),
      row('Health & Fitness', '06:00', '08:00', 'Bike'),
      row('Health & Fitness', '07:00', '08:00', 'Swim'),
    ]);
    expect(hours.get('Health & Fitness')).toBeCloseTo(4);
    expect(hours.has('Run')).toBe(false);
  });

  it('skips rows with unusable or inverted times instead of going negative', () => {
    const hours = weeklyHoursByTheme([
      row('Work (Main Gig)', '17:00', '09:00'),
      row('Work (Main Gig)', '09:00', '09:00'),
      row('Work (Main Gig)', 'x', 'y'),
      row('Work (Main Gig)', '09:00', '10:00'),
    ]);
    expect(hours.get('Work (Main Gig)')).toBeCloseTo(1);
  });

  it('survives a missing or malformed plan', () => {
    expect(weeklyHoursByTheme(null).size).toBe(0);
    expect(weeklyHoursByTheme(undefined).size).toBe(0);
    expect(weeklyHoursByTheme([{ ...row('', '09:00', '10:00') }]).size).toBe(0);
  });
});

describe('columnWindow', () => {
  it('spans a whole calendar year', () => {
    const w = columnWindow('2026', 'year')!;
    expect(new Date(w.start).getFullYear()).toBe(2026);
    expect(new Date(w.start).getMonth()).toBe(0);
    expect(new Date(w.end).getFullYear()).toBe(2027);
    expect(Math.round(windowWeeks(w))).toBe(52);
  });

  it('spans the right three months for each quarter', () => {
    expect(new Date(columnWindow('2026-Q1', 'quarter')!.start).getMonth()).toBe(0);
    expect(new Date(columnWindow('2026-Q3', 'quarter')!.start).getMonth()).toBe(6);
    expect(new Date(columnWindow('2026-Q4', 'quarter')!.end).getFullYear()).toBe(2027);
    expect(Math.round(windowWeeks(columnWindow('2026-Q3', 'quarter')!))).toBe(13);
  });

  it('uses the sprint’s own dates', () => {
    const start = new Date(2026, 6, 8).getTime();
    const end = start + 14 * 24 * 60 * 60 * 1000;
    const sprints = [{ id: 's1', startDate: start, endDate: end }];
    expect(windowWeeks(columnWindow('s1', 'sprint', sprints))).toBeCloseTo(2);
  });

  it('has no window for the Backlog column — unscheduled work has no capacity', () => {
    expect(columnWindow('unscheduled', 'quarter')).toBeNull();
    expect(columnWindow('unscheduled', 'sprint', [])).toBeNull();
    expect(windowWeeks(null)).toBe(0);
  });

  it('declines junk keys and sprints with unusable dates', () => {
    expect(columnWindow('20xx', 'year')).toBeNull();
    expect(columnWindow('2026-Q9', 'quarter')).toBeNull();
    expect(columnWindow('nope', 'sprint', [{ id: 'nope' }])).toBeNull();
    expect(columnWindow('back', 'sprint', [{ id: 'back', startDate: 100, endDate: 50 }])).toBeNull();
  });
});

describe('summariseCapacity', () => {
  it('turns amber before it is actually over, not after', () => {
    // 92% of allocated time leaves no slack for anything unplanned, which in practice is
    // already over.
    expect(summariseCapacity(100, 50).tone).toBe('ok');
    expect(summariseCapacity(100, 92).tone).toBe('tight');
    expect(summariseCapacity(100, 101).tone).toBe('over');
  });

  it('distinguishes "no allocation" from "nothing booked"', () => {
    expect(summariseCapacity(0, 0).tone).toBe('empty');
    expect(summariseCapacity(100, 0).tone).toBe('ok');
  });

  it('calls work booked against an unallocated theme over, not 0% used', () => {
    const s = summariseCapacity(0, 20);
    expect(s.tone).toBe('over');
    expect(s.utilizationPct).toBe(100);
  });

  it('does not produce NaN or negatives from junk', () => {
    const s = summariseCapacity(Number.NaN, -5);
    expect(s.utilizationPct).toBe(0);
    expect(s.committedHours).toBe(0);
  });
});

describe('computeColumnCapacity', () => {
  // Jim's real plan, rounded: the numbers below are the ones the roadmap will show.
  const weekly = new Map([
    ['Work (Main Gig)', 35.5],
    ['Health & Fitness', 12],
    ['Career & Professional', 10],
  ]);
  const quarter = columnWindow('2026-Q3', 'quarter');

  it('multiplies the weekly plan by the weeks in the column', () => {
    const cap = computeColumnCapacity(quarter, weekly, new Map());
    // 13.14 weeks in Q3 (92 days) x 35.5 h/wk
    expect(cap.byTheme.get('Work (Main Gig)')!.capacityHours).toBeCloseTo(35.5 * (92 / 7), 1);
    expect(cap.tone).toBe('ok');
  });

  it('flags the theme that is over even when the TOTAL looks fine', () => {
    // This is the whole point: 500h of Work does not fit in a quarter just because Health and
    // Career hours exist to pad the total.
    const committed = new Map([['Work (Main Gig)', 500]]);
    const cap = computeColumnCapacity(quarter, weekly, committed);
    expect(cap.themesOver).toEqual(['Work (Main Gig)']);
    expect(cap.byTheme.get('Work (Main Gig)')!.tone).toBe('over');
  });

  it('ranks the themes over by how far over they are', () => {
    const committed = new Map([
      ['Work (Main Gig)', 600],   // ~128%
      ['Career & Professional', 999],  // ~758%
    ]);
    const cap = computeColumnCapacity(quarter, weekly, committed);
    expect(cap.themesOver).toEqual(['Career & Professional', 'Work (Main Gig)']);
  });

  it('reports work booked against a theme with no allocation at all', () => {
    const cap = computeColumnCapacity(quarter, weekly, new Map([['Travel & Adventure', 8]]));
    expect(cap.byTheme.get('Travel & Adventure')!.tone).toBe('over');
    expect(cap.themesOver).toContain('Travel & Adventure');
  });

  it('omits themes with neither allocation nor commitment', () => {
    const cap = computeColumnCapacity(quarter, weekly, new Map());
    expect(cap.byTheme.has('Chores')).toBe(false);
  });

  it('gives the Backlog column no capacity rather than a false warning', () => {
    const cap = computeColumnCapacity(null, weekly, new Map([['Work (Main Gig)', 40]]));
    expect(cap.weeks).toBe(0);
    expect(cap.capacityHours).toBe(0);
    // Still honestly 'over': 40h of work is parked somewhere with no time behind it.
    expect(cap.tone).toBe('over');
  });
});

describe('points and formatting', () => {
  it('converts one point to one hour, matching the scheduler', () => {
    expect(pointsToHours(3)).toBe(3);
    expect(pointsToHours('5')).toBe(5);
  });

  it('treats missing or nonsense points as zero, not NaN', () => {
    [null, undefined, '', 'abc', -2, 0].forEach((v) => expect(pointsToHours(v)).toBe(0));
  });

  it('formats a slice compactly, and says so when nothing is allocated', () => {
    expect(formatCapacity(summariseCapacity(461, 412))).toBe('412 / 461h');
    expect(formatCapacity(summariseCapacity(0, 8))).toBe('8h · none allocated');
  });
});
