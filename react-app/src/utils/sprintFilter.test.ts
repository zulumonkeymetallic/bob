import { isPlanningSprint, planningSprints, pickDefaultPlanningSprintId, visibleSprintWindow } from './sprintFilter';
import type { Sprint } from '../types';

const sprint = (over: Partial<Sprint> & { id: string }): Sprint =>
  ({ name: over.id, status: 0, startDate: 0, endDate: 0, ...over } as unknown as Sprint);

const day = 86_400_000;

describe('planningSprints ordering', () => {
  /**
   * The dropdown previously rendered Firestore's own order, which is descending, so the sprint
   * the user was actually IN sorted last — below ten planned sprints running into 2028. This
   * is the shape of the real data that exposed it.
   */
  const realistic = [
    sprint({ id: 'S56', status: 0, startDate: 10 * day }),
    sprint({ id: 'S48', status: 0, startDate: 3 * day }),
    sprint({ id: 'S47', status: 0, startDate: 2 * day }),
    sprint({ id: 'S49', status: 0, startDate: 4 * day }),
    sprint({ id: 'S46', status: 1, startDate: 1 * day }), // the active one, last in source order
  ];

  it('puts the active sprint first', () => {
    expect(planningSprints(realistic)[0].id).toBe('S46');
  });

  it('orders the rest by soonest start, so "the next one" is the next row', () => {
    expect(planningSprints(realistic).map((s) => s.id)).toEqual(['S46', 'S47', 'S48', 'S49', 'S56']);
  });

  it('keeps the active sprint first even when it starts later than a planned one', () => {
    const odd = [
      sprint({ id: 'planned-early', status: 0, startDate: 1 * day }),
      sprint({ id: 'active-late', status: 1, startDate: 9 * day }),
    ];
    expect(planningSprints(odd).map((s) => s.id)).toEqual(['active-late', 'planned-early']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...realistic];
    planningSprints(input);
    expect(input.map((s) => s.id)).toEqual(['S56', 'S48', 'S47', 'S49', 'S46']);
  });

  it('falls back to name when two sprints start on the same day', () => {
    const tied = [
      sprint({ id: 'B', name: 'B', status: 0, startDate: day }),
      sprint({ id: 'A', name: 'A', status: 0, startDate: day }),
    ];
    expect(planningSprints(tied).map((s) => s.id)).toEqual(['A', 'B']);
  });
});

describe('planningSprints filtering', () => {
  it('keeps only planned and active sprints', () => {
    const mixed = [
      sprint({ id: 'planned', status: 0 }),
      sprint({ id: 'active', status: 1 }),
      sprint({ id: 'complete', status: 2 }),
      sprint({ id: 'cancelled', status: 3 }),
    ];
    expect(planningSprints(mixed).map((s) => s.id).sort()).toEqual(['active', 'planned']);
  });

  it('tolerates an empty or missing list', () => {
    expect(planningSprints([])).toEqual([]);
    expect(planningSprints(undefined as unknown as Sprint[])).toEqual([]);
  });

  it('treats a missing status as planned rather than dropping the sprint', () => {
    expect(isPlanningSprint({ id: 'x' } as unknown as Sprint)).toBe(true);
  });
});

describe('pickDefaultPlanningSprintId', () => {
  it('prefers the active sprint', () => {
    const list = [sprint({ id: 'p', status: 0, startDate: day }), sprint({ id: 'a', status: 1, startDate: 5 * day })];
    expect(pickDefaultPlanningSprintId(list)).toBe('a');
  });

  it('falls back to the soonest planned sprint when nothing is active', () => {
    const list = [sprint({ id: 'later', status: 0, startDate: 9 * day }), sprint({ id: 'sooner', status: 0, startDate: day })];
    expect(pickDefaultPlanningSprintId(list)).toBe('sooner');
  });

  it('returns an empty string when there is nothing to pick', () => {
    expect(pickDefaultPlanningSprintId([])).toBe('');
  });
});

describe('visibleSprintWindow', () => {
  const many = Array.from({ length: 11 }, (_, i) =>
    sprint({ id: `S${i}`, status: i === 0 ? 1 : 0, startDate: i * day }));

  it('shows the current sprint and the next three by default', () => {
    expect(visibleSprintWindow(many, 'S0', false).map((s) => s.id)).toEqual(['S0', 'S1', 'S2', 'S3']);
  });

  it('reveals everything when expanded', () => {
    expect(visibleSprintWindow(many, 'S0', true)).toHaveLength(11);
  });

  it('never hides the selected sprint, even past the cut-off', () => {
    // Selecting a far-future sprint then reopening the menu must still show it as ticked.
    const ids = visibleSprintWindow(many, 'S9', false).map((s) => s.id);
    expect(ids).toContain('S9');
    expect(ids).toEqual(['S0', 'S1', 'S2', 'S3', 'S9']);
  });

  it('does not duplicate the selected sprint when it is already in the window', () => {
    expect(visibleSprintWindow(many, 'S2', false).map((s) => s.id)).toEqual(['S0', 'S1', 'S2', 'S3']);
  });

  it('leaves short lists alone, so no toggle appears for a handful of sprints', () => {
    const few = many.slice(0, 3);
    expect(visibleSprintWindow(few, 'S0', false)).toHaveLength(3);
  });

  it('tolerates no selection and an empty list', () => {
    expect(visibleSprintWindow(many, undefined, false).map((s) => s.id)).toEqual(['S0', 'S1', 'S2', 'S3']);
    expect(visibleSprintWindow([], undefined, false)).toEqual([]);
  });
});
