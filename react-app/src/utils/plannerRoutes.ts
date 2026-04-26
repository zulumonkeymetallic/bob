export type UnifiedPlannerLevel =
  | 'gantt'
  | 'year'
  | 'quarter'
  | 'sprint'
  | 'week'
  | 'calendar';

const VALID_LEVELS = new Set<UnifiedPlannerLevel>([
  'gantt',
  'year',
  'quarter',
  'sprint',
  'week',
  'calendar',
]);

export const DEFAULT_PLANNER_LEVEL: UnifiedPlannerLevel = 'calendar';

export function normalizePlannerLevel(value: string | null | undefined): UnifiedPlannerLevel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'month') return 'quarter';
  if (VALID_LEVELS.has(normalized as UnifiedPlannerLevel)) {
    return normalized as UnifiedPlannerLevel;
  }
  return DEFAULT_PLANNER_LEVEL;
}

export function plannerLevelLabel(level: UnifiedPlannerLevel): string {
  switch (level) {
    case 'gantt':
      return 'Gannt chart';
    case 'year':
      return 'Year Planner';
    case 'quarter':
      return 'Quarter Planner';
    case 'sprint':
      return 'Multi Sprint Planner';
    case 'week':
      return '4-Day Planner';
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
