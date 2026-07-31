import {
  goalMatchesRoadmapFilters,
  isInGoalHierarchy,
  hasActiveRoadmapFilters,
  EMPTY_ROADMAP_FILTERS,
  type RoadmapFilterContext,
} from './roadmapFilters';
import type { Goal, Sprint } from '../types';

const goal = (over: Partial<Goal> & { id: string }): Goal =>
  ({ title: over.id, theme: 1, ...over } as unknown as Goal);

const ctx = (over: Partial<RoadmapFilterContext> = {}): RoadmapFilterContext => ({
  storyCountByGoal: {},
  sprintIdsByGoal: {},
  focusGoalIds: new Set<string>(),
  selectedSprint: null,
  allGoals: [],
  ...over,
});

const f = (over: Partial<typeof EMPTY_ROADMAP_FILTERS> = {}) => ({ ...EMPTY_ROADMAP_FILTERS, ...over });
const day = 86_400_000;

describe('nothing selected', () => {
  it('keeps every goal', () => {
    expect(goalMatchesRoadmapFilters(goal({ id: 'a' }), f(), ctx())).toBe(true);
  });

  it('reports no active filters', () => {
    expect(hasActiveRoadmapFilters(f())).toBe(false);
    expect(hasActiveRoadmapFilters(f({ focusOnly: true }))).toBe(true);
    expect(hasActiveRoadmapFilters(f({ search: '  ' }))).toBe(false);   // whitespace is not a filter
  });
});

describe('goals with stories', () => {
  it('keeps only goals that have stories', () => {
    const c = ctx({ storyCountByGoal: { a: 3 } });
    expect(goalMatchesRoadmapFilters(goal({ id: 'a' }), f({ withStoriesOnly: true }), c)).toBe(true);
    expect(goalMatchesRoadmapFilters(goal({ id: 'b' }), f({ withStoriesOnly: true }), c)).toBe(false);
  });

  it('treats a zero count as no stories', () => {
    const c = ctx({ storyCountByGoal: { a: 0 } });
    expect(goalMatchesRoadmapFilters(goal({ id: 'a' }), f({ withStoriesOnly: true }), c)).toBe(false);
  });
});

describe('focus goals only', () => {
  const tree = [
    goal({ id: 'focus' }),
    goal({ id: 'child', parentGoalId: 'focus' } as any),
    goal({ id: 'grandchild', parentGoalId: 'child' } as any),
    goal({ id: 'unrelated' }),
  ];
  const c = ctx({ focusGoalIds: new Set(['focus']), allGoals: tree });

  it('keeps descendants of a focus goal, not just the goal itself', () => {
    // Matching on id alone would hide every phase under a focus goal.
    expect(goalMatchesRoadmapFilters(tree[1], f({ focusOnly: true }), c)).toBe(true);
    expect(goalMatchesRoadmapFilters(tree[2], f({ focusOnly: true }), c)).toBe(true);
  });

  it('drops goals outside the focus tree', () => {
    expect(goalMatchesRoadmapFilters(tree[3], f({ focusOnly: true }), c)).toBe(false);
  });

  it('is inert when no focus goals exist, rather than hiding everything', () => {
    const none = ctx({ focusGoalIds: new Set<string>(), allGoals: tree });
    expect(goalMatchesRoadmapFilters(tree[3], f({ focusOnly: true }), none)).toBe(true);
  });

  it('survives a parent cycle in the data instead of hanging', () => {
    const cyclic = [
      goal({ id: 'x', parentGoalId: 'y' } as any),
      goal({ id: 'y', parentGoalId: 'x' } as any),
    ];
    expect(isInGoalHierarchy('x', cyclic, new Set(['nope']))).toBe(false);
  });
});

describe('limit to selected sprint', () => {
  const sprint = { id: 's1', startDate: 100 * day, endDate: 110 * day } as unknown as Sprint;

  it('keeps a goal whose window overlaps the sprint', () => {
    const g = goal({ id: 'a', startDate: 105 * day, endDate: 120 * day } as any);
    expect(goalMatchesRoadmapFilters(g, f({ limitToSprint: true }), ctx({ selectedSprint: sprint }))).toBe(true);
  });

  it('drops a goal entirely outside the sprint', () => {
    const g = goal({ id: 'a', startDate: 200 * day, endDate: 210 * day } as any);
    expect(goalMatchesRoadmapFilters(g, f({ limitToSprint: true }), ctx({ selectedSprint: sprint }))).toBe(false);
  });

  it('keeps a non-overlapping goal that has a story in the sprint', () => {
    // A goal can be worked this sprint without its own dates saying so.
    const g = goal({ id: 'a', startDate: 200 * day, endDate: 210 * day } as any);
    const c = ctx({ selectedSprint: sprint, sprintIdsByGoal: { a: new Set(['s1']) } });
    expect(goalMatchesRoadmapFilters(g, f({ limitToSprint: true }), c)).toBe(true);
  });

  it('is inert when no sprint is selected', () => {
    const g = goal({ id: 'a', startDate: 200 * day, endDate: 210 * day } as any);
    expect(goalMatchesRoadmapFilters(g, f({ limitToSprint: true }), ctx())).toBe(true);
  });
});

describe('years', () => {
  it('matches on the end date year', () => {
    const g = goal({ id: 'a', endDate: new Date(2027, 5, 1).getTime() } as any);
    expect(goalMatchesRoadmapFilters(g, f({ years: [2027] }), ctx())).toBe(true);
    expect(goalMatchesRoadmapFilters(g, f({ years: [2026] }), ctx())).toBe(false);
  });

  it('falls back to targetDate when there is no end date', () => {
    const g = goal({ id: 'a', targetDate: new Date(2028, 0, 1).getTime() } as any);
    expect(goalMatchesRoadmapFilters(g, f({ years: [2028] }), ctx())).toBe(true);
  });

  it('keeps undated goals so the year filter does not hide the backlog', () => {
    expect(goalMatchesRoadmapFilters(goal({ id: 'a' }), f({ years: [2026] }), ctx())).toBe(true);
  });

  it('accepts several years at once', () => {
    const g = goal({ id: 'a', endDate: new Date(2027, 5, 1).getTime() } as any);
    expect(goalMatchesRoadmapFilters(g, f({ years: [2026, 2027, 2028] }), ctx())).toBe(true);
  });
});

describe('theme and search', () => {
  it('filters by theme id', () => {
    const g = goal({ id: 'a', theme: 3 } as any);
    expect(goalMatchesRoadmapFilters(g, f({ themeIds: [3] }), ctx())).toBe(true);
    expect(goalMatchesRoadmapFilters(g, f({ themeIds: [1, 2] }), ctx())).toBe(false);
  });

  it('searches the title case-insensitively', () => {
    const g = goal({ id: 'a', title: 'Complete an Ironman' } as any);
    expect(goalMatchesRoadmapFilters(g, f({ search: 'IRONMAN' }), ctx())).toBe(true);
    expect(goalMatchesRoadmapFilters(g, f({ search: 'marathon' }), ctx())).toBe(false);
  });
});

describe('filters combine', () => {
  it('requires every active filter to pass', () => {
    const g = goal({ id: 'a', theme: 1, endDate: new Date(2027, 0, 1).getTime() } as any);
    const c = ctx({ storyCountByGoal: { a: 2 } });
    expect(goalMatchesRoadmapFilters(g, f({ themeIds: [1], years: [2027], withStoriesOnly: true }), c)).toBe(true);
    // One failing filter is enough to exclude it.
    expect(goalMatchesRoadmapFilters(g, f({ themeIds: [1], years: [2026], withStoriesOnly: true }), c)).toBe(false);
  });
});
