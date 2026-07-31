/**
 * roadmapFilters — the filter predicate the roadmap shares with the Gantt (GoalRoadmapV6).
 *
 * Written as a pure function rather than inline in the component because three of these
 * filters are not simple field comparisons: "focus goals only" has to walk the parent chain,
 * "limit to selected sprint" is a date-range overlap OR a story membership, and the year filter
 * has to fall back from endDate to targetDate. Each has an edge case that silently returns the
 * wrong set rather than erroring.
 */
import type { Goal, Sprint } from '../types';

/** Matches ThemeMultiSelect's own TRAVEL_THEME_ID — kept in sync manually since that constant
 * lives in a component file this util shouldn't import from. */
const TRAVEL_THEME_ID = 7;

export interface RoadmapFilterState {
  search: string;
  /** Empty means all themes. */
  themeIds: number[];
  /** Empty means all years. */
  years: number[];
  withStoriesOnly: boolean;
  focusOnly: boolean;
  limitToSprint: boolean;
}

export const EMPTY_ROADMAP_FILTERS: RoadmapFilterState = {
  search: '',
  themeIds: [],
  years: [],
  withStoriesOnly: false,
  focusOnly: false,
  limitToSprint: false,
};

export interface RoadmapFilterContext {
  /** Story count per goal id — drives "goals with stories". */
  storyCountByGoal: Record<string, number>;
  /** Sprint ids each goal has a story in — the second half of the sprint-scope test. */
  sprintIdsByGoal: Record<string, Set<string>>;
  focusGoalIds: Set<string>;
  selectedSprint: Sprint | null;
  /** Needed to walk parentGoalId when testing focus membership. */
  allGoals: Goal[];
}

const ms = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const anyV = v as any;
  if (typeof anyV?.toMillis === 'function') { try { return Number(anyV.toMillis()); } catch { return null; } }
  if (anyV?.seconds != null) return Number(anyV.seconds) * 1000;
  const parsed = new Date(v as any).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * True when the goal, or any ancestor, is in `ids`. A phase goal under a focus goal counts as
 * focused; testing the id alone would hide every child of a focus goal.
 */
export function isInGoalHierarchy(goalId: string, allGoals: Goal[], ids: Set<string>): boolean {
  if (ids.has(goalId)) return true;
  const byId = new Map(allGoals.map((g) => [g.id, g]));
  const seen = new Set<string>();
  let current = byId.get(goalId);
  // `seen` guards against a parent cycle in the data, which would otherwise hang the render.
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const parentId = (current as any).parentGoalId;
    if (!parentId) return false;
    if (ids.has(parentId)) return true;
    current = byId.get(parentId);
  }
  return false;
}

export function goalMatchesRoadmapFilters(
  goal: Goal,
  filters: RoadmapFilterState,
  ctx: RoadmapFilterContext,
): boolean {
  const g = goal as any;

  if (filters.themeIds.length > 0) {
    if (!filters.themeIds.includes(Number(g.theme ?? 0))) return false;
  } else if (Number(g.theme ?? 0) === TRAVEL_THEME_ID) {
    // "All Themes" hides Travel & Adventure by default, matching the picker's own default —
    // ThemeMultiSelect already hides its checkbox behind a "+ Show travel" toggle, but until
    // now that only hid the checkbox, not the goals themselves, so Travel goals still rendered
    // under a filter state that claimed to show everything. Explicitly picking Travel in the
    // multi-select still shows it, same as picking any other single theme.
    return false;
  }

  if (filters.years.length > 0) {
    const end = ms(g.endDate) ?? ms(g.targetDate) ?? ms(g.dueDate);
    // A goal with no end date has no year. It is kept, matching the Gantt: the year filter
    // narrows what is scheduled, it does not hide the unscheduled backlog.
    if (end != null && !filters.years.includes(new Date(end).getFullYear())) return false;
  }

  if (filters.withStoriesOnly && !(ctx.storyCountByGoal[goal.id] > 0)) return false;

  if (filters.focusOnly && ctx.focusGoalIds.size > 0
      && !isInGoalHierarchy(goal.id, ctx.allGoals, ctx.focusGoalIds)) {
    return false;
  }

  if (filters.limitToSprint && ctx.selectedSprint) {
    const sprintStart = ms((ctx.selectedSprint as any).startDate);
    const sprintEnd = ms((ctx.selectedSprint as any).endDate);
    const gStart = ms(g.startDate) ?? ms(g.targetDate) ?? Date.now();
    const gEnd = ms(g.endDate) ?? ms(g.targetDate) ?? gStart;
    const overlaps = sprintStart != null && sprintEnd != null && gStart <= sprintEnd && gEnd >= sprintStart;
    // Either the goal's own window overlaps the sprint, or it has a story in it. A goal can be
    // worked on this sprint without its own dates saying so.
    const hasStoryInSprint = ctx.sprintIdsByGoal[goal.id]?.has(ctx.selectedSprint.id) ?? false;
    if (!overlaps && !hasStoryInSprint) return false;
  }

  const term = filters.search.trim().toLowerCase();
  if (term && !(goal.title || '').toLowerCase().includes(term)) return false;

  return true;
}

/** True when anything is narrowing the view — drives whether "Clear filters" is offered. */
export function hasActiveRoadmapFilters(f: RoadmapFilterState): boolean {
  return Boolean(
    f.search.trim() || f.themeIds.length || f.years.length
    || f.withStoriesOnly || f.focusOnly || f.limitToSprint,
  );
}
