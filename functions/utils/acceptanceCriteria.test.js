const {
  rejectGenericCriteria,
  isAllGenericCriteria,
} = require('./acceptanceCriteria');

// The exact three lines the retired task→story fallback wrote, which 213 stories carried.
const RETIRED_FALLBACK = [
  'Define clear “done” outcome and validation steps.',
  'Include success metrics or completion signal.',
  'Address dependencies and blockers before sign-off.',
];

describe('rejectGenericCriteria', () => {
  it('drops the retired fallback entirely, curly or straight quotes', () => {
    expect(rejectGenericCriteria(RETIRED_FALLBACK)).toEqual([]);
    expect(rejectGenericCriteria([
      'Define clear "done" outcome and validation steps.',
    ])).toEqual([]);
  });

  it('keeps real criteria that merely mention dependencies or metrics', () => {
    const real = [
      'Blocked until the Monzo pot mapping lands; confirm before starting.',
      'Body fat measured under 20% on the Withings scale.',
      'Success metrics agreed with the client before the workshop.',
    ];
    expect(rejectGenericCriteria(real)).toEqual(real);
  });

  it('strips filler mixed in with real criteria and keeps the rest', () => {
    const mixed = [
      'Visa application submitted to the Chinese consulate.',
      'Include success metrics or completion signal.',
      'Passport returned before 1 September.',
    ];
    expect(rejectGenericCriteria(mixed)).toEqual([
      'Visa application submitted to the Chinese consulate.',
      'Passport returned before 1 September.',
    ]);
  });

  it('drops the placeholders a model reaches for on a thin prompt', () => {
    expect(rejectGenericCriteria([
      'TBD',
      'n/a',
      'Acceptance criteria to be defined.',
      'The task is complete.',
    ])).toEqual([]);
  });

  it('trims, drops blanks, and survives non-array or nullish input', () => {
    expect(rejectGenericCriteria(['  Sauna wired to its own circuit.  ', '', null]))
      .toEqual(['Sauna wired to its own circuit.']);
    expect(rejectGenericCriteria(null)).toEqual([]);
    expect(rejectGenericCriteria(undefined)).toEqual([]);
    expect(rejectGenericCriteria('not an array')).toEqual([]);
  });
});

describe('isAllGenericCriteria', () => {
  it('is true for the retired fallback and for an empty array', () => {
    expect(isAllGenericCriteria(RETIRED_FALLBACK)).toBe(true);
    expect(isAllGenericCriteria([])).toBe(true);
  });

  it('is false as soon as one line says something specific', () => {
    expect(isAllGenericCriteria([...RETIRED_FALLBACK, 'Flights booked to Chengdu.']))
      .toBe(false);
  });
});
