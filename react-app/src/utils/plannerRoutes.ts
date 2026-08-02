export type UnifiedPlannerLevel =
  | 'roadmap'
  | 'gantt'
  | 'year'
  | 'quarter'
  | 'sprint'
  | 'week'
  | 'calendar';

const VALID_LEVELS = new Set<UnifiedPlannerLevel>([
  'roadmap',
  'gantt',
  'year',
  'quarter',
  'sprint',
  'week',
  'calendar',
]);

export const DEFAULT_PLANNER_LEVEL: UnifiedPlannerLevel = 'calendar';

/**
 * The roadmap's detail level — which time axis its grid uses. A separate param from `level`
 * because it is a property of the roadmap, not another planner surface: `?level=roadmap` alone
 * still has to mean something, and `?level=week` is the older SprintWeekPlanner page.
 */
export type RoadmapDetail = 'year' | 'quarter' | 'sprint' | 'week';

const VALID_DETAILS = new Set<RoadmapDetail>(['year', 'quarter', 'sprint', 'week']);

export const DEFAULT_ROADMAP_DETAIL: RoadmapDetail = 'quarter';

/**
 * NOT `detail` — that param is already owned app-wide by the entity detail pane
 * (useDetailPaneUrlSync), which parses it as `<type>:<ref>` and strips anything else from the
 * URL on the first render. A roadmap level parked on `detail` therefore vanished as soon as
 * the page loaded. This is the param name; do not "simplify" it back.
 */
export const ROADMAP_DETAIL_PARAM = 'detailLevel';

/** Case-insensitive, so a hand-typed `?detailLevel=Quarter` works. */
export function normalizePlannerDetail(value: string | null | undefined): RoadmapDetail {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_DETAILS.has(normalized as RoadmapDetail)
    ? (normalized as RoadmapDetail)
    : DEFAULT_ROADMAP_DETAIL;
}

export function normalizePlannerLevel(value: string | null | undefined): UnifiedPlannerLevel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'month') return 'quarter';
  if (VALID_LEVELS.has(normalized as UnifiedPlannerLevel)) {
    return normalized as UnifiedPlannerLevel;
  }
  return DEFAULT_PLANNER_LEVEL;
}

/**
 * Parse a planner query string, repairing the `?a=1?b=2` form.
 *
 * Only the FIRST `?` separates path from query — every later one is a literal character in the
 * value, so `?level=roadmap?detailLevel=week` parses as one param, level="roadmap?detailLevel=week",
 * and silently falls back to the calendar. That URL shape is easy to type and easy to paste
 * around, and there is no legitimate planner param whose value contains a `?`, so treating the
 * extra ones as separators costs nothing and makes the obvious link work.
 */
export function parsePlannerSearch(search: string | null | undefined): URLSearchParams {
  const raw = String(search || '');
  return new URLSearchParams((raw.startsWith('?') ? raw.slice(1) : raw).replace(/\?/g, '&'));
}

export function plannerLevelLabel(level: UnifiedPlannerLevel): string {
  switch (level) {
    case 'roadmap':
      return 'Roadmap';
    case 'gantt':
      return 'Gantt chart';
    case 'year':
      return 'Year Planner';
    case 'quarter':
      return 'Quarter Planner';
    case 'sprint':
      return 'Multi Sprint Planner';
    case 'week':
      return 'Weekly Plan';
    case 'calendar':
    default:
      return 'Calendar';
  }
}

export function buildPlannerPath(
  level: UnifiedPlannerLevel,
  params?: URLSearchParams | string | Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams();
  search.set('level', level);

  if (params instanceof URLSearchParams) {
    params.forEach((value, key) => {
      if (key === 'level') return;
      search.set(key, value);
    });
  } else if (typeof params === 'string') {
    const next = new URLSearchParams(params.startsWith('?') ? params.slice(1) : params);
    next.forEach((value, key) => {
      if (key === 'level') return;
      search.set(key, value);
    });
  } else if (params && typeof params === 'object') {
    Object.entries(params).forEach(([key, value]) => {
      if (key === 'level' || value == null || value === '') return;
      search.set(key, String(value));
    });
  }

  return `/planner?${search.toString()}`;
}
