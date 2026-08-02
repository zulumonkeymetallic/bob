/**
 * roadmapCapacity — how much time a roadmap column actually has, and how much is committed.
 *
 * The roadmap could always tell you WHEN work was planned and never whether it FITS. Capacity
 * is genuinely knowable here: `theme_allocations` is a recurring weekly plan of how the user
 * intends to spend their time, so a column's capacity is that plan multiplied by the number of
 * weeks the column spans. Nothing needs estimating.
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG
 *
 * 1. Capacity is PER THEME, and only the totals are safe to add up. A quarter with 461h of
 *    "Work (Main Gig)" and 156h of "Health & Fitness" has 617h in total, but 500h of Work
 *    stories does not fit in it — the Health hours cannot do Work. So every figure here is
 *    computed per theme first and only then summed, and the summary carries the list of themes
 *    that are individually over. A single total, on its own, hides exactly the problem you
 *    opened the roadmap to find.
 *
 * 2. Sleep is not subtracted, because it was never added. A week is 168h; a fully specified
 *    allocation plan comes to roughly 88h. The other 80h IS sleep plus unallocated slack.
 *    Capacity is the allocated hours, full stop — treating the day as 24h and deducting sleep
 *    would double-count it.
 */
import {
  UNSCHEDULED_COLUMN,
  type RoadmapGranularity,
  type RoadmapSprint,
} from './roadmapSchedule';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One story point is one hour.
 *
 * Not invented here — it is the conversion the scheduler already applies
 * (`inferPlannerDurationMinutes` books `points * 60` minutes) and the one the sprint close
 * report already uses. Capacity that disagreed with the thing doing the scheduling would be
 * worse than no capacity at all.
 */
export const HOURS_PER_POINT = 1;

/** A row of the recurring weekly plan, as stored in `theme_allocations`. */
export interface ThemeAllocationRow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  theme: string;
  subTheme?: string | null;
}

export interface PeriodWindow {
  start: number;
  end: number;
}

/** "HH:mm" to minutes past midnight, or null if it is not a time. */
export function clockMinutes(value: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Weekly hours per PARENT theme.
 *
 * Keyed on `theme`, never `subTheme`: the plan splits Health & Fitness into Run, Bike, Swim,
 * S&C and Walk, but a story is themed "Health & Fitness", so keying on the sub-theme would
 * leave every one of those hours unmatched and report zero capacity for the theme.
 */
export function weeklyHoursByTheme(rows: ThemeAllocationRow[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const start = clockMinutes(row?.startTime);
    const end = clockMinutes(row?.endTime);
    if (start == null || end == null || end <= start) continue;
    const theme = String(row?.theme ?? '').trim();
    if (!theme) continue;
    out.set(theme, (out.get(theme) ?? 0) + (end - start) / 60);
  }
  return out;
}

/**
 * The calendar window a roadmap column covers.
 *
 * Returns null for the Backlog column: unscheduled work has no window, so it has no capacity,
 * and showing it "0 / 0h · over" would be nonsense rather than a warning.
 */
export function columnWindow(
  key: string,
  granularity: RoadmapGranularity,
  sprints: RoadmapSprint[] = [],
): PeriodWindow | null {
  if (!key || key === UNSCHEDULED_COLUMN) return null;

  if (granularity === 'year') {
    if (!/^\d{4}$/.test(key)) return null;
    const year = Number(key);
    return { start: new Date(year, 0, 1).getTime(), end: new Date(year + 1, 0, 1).getTime() };
  }

  if (granularity === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    if (!m) return null;
    const year = Number(m[1]);
    const q = Number(m[2]);
    return {
      start: new Date(year, (q - 1) * 3, 1).getTime(),
      end: new Date(year, q * 3, 1).getTime(),
    };
  }

  const sprint = sprints.find((s) => s.id === key);
  const start = Number(sprint?.startDate);
  const end = Number(sprint?.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/** Weeks in a window, fractional — a 14-day sprint is exactly 2. */
export function windowWeeks(window: PeriodWindow | null): number {
  if (!window || window.end <= window.start) return 0;
  return (window.end - window.start) / WEEK_MS;
}

export type CapacityTone = 'empty' | 'ok' | 'tight' | 'over';

export interface CapacitySlice {
  capacityHours: number;
  committedHours: number;
  utilizationPct: number;
  tone: CapacityTone;
}

/**
 * Thresholds. `tight` exists so the bar turns amber BEFORE the column is over — a plan at 92%
 * of allocated time has no slack for anything unplanned, which in practice means it is already
 * over. `empty` is "no allocation for this theme", which is a different statement from "0%
 * used" and must not be drawn as healthy green.
 */
export function summariseCapacity(capacityHours: number, committedHours: number): CapacitySlice {
  const capacity = Number.isFinite(capacityHours) && capacityHours > 0 ? capacityHours : 0;
  const committed = Number.isFinite(committedHours) && committedHours > 0 ? committedHours : 0;

  if (capacity <= 0) {
    return {
      capacityHours: 0,
      committedHours: committed,
      // Work booked against a theme with no allocated time is infinitely over, not 0% used.
      utilizationPct: committed > 0 ? 100 : 0,
      tone: committed > 0 ? 'over' : 'empty',
    };
  }

  const pct = Math.round((committed / capacity) * 100);
  return {
    capacityHours: capacity,
    committedHours: committed,
    utilizationPct: pct,
    tone: pct > 100 ? 'over' : pct >= 85 ? 'tight' : 'ok',
  };
}

export interface ColumnCapacity extends CapacitySlice {
  /** Per-theme detail. The totals above are these summed — see the header comment. */
  byTheme: Map<string, CapacitySlice>;
  /** Themes individually over their own allocation, worst first. This is the real signal. */
  themesOver: string[];
  weeks: number;
}

/**
 * A column's capacity picture.
 *
 * `committedHoursByTheme` is supplied by the caller because what counts as committed differs
 * by detail level: at year and quarter the cells hold goals, so it is the goal's stories rolled
 * up; at sprint the cells hold the stories themselves.
 */
export function computeColumnCapacity(
  window: PeriodWindow | null,
  weeklyHours: Map<string, number>,
  committedHoursByTheme: Map<string, number>,
): ColumnCapacity {
  const weeks = windowWeeks(window);
  const byTheme = new Map<string, CapacitySlice>();

  const themes = new Set<string>([...weeklyHours.keys(), ...committedHoursByTheme.keys()]);
  let capacityTotal = 0;
  let committedTotal = 0;

  for (const theme of themes) {
    const capacity = (weeklyHours.get(theme) ?? 0) * weeks;
    const committed = committedHoursByTheme.get(theme) ?? 0;
    // A theme with neither allocation nor commitment is not a fact about this column.
    if (capacity <= 0 && committed <= 0) continue;
    byTheme.set(theme, summariseCapacity(capacity, committed));
    capacityTotal += capacity;
    committedTotal += committed;
  }

  const themesOver = [...byTheme.entries()]
    .filter(([, slice]) => slice.tone === 'over')
    .sort((a, b) => b[1].utilizationPct - a[1].utilizationPct)
    .map(([theme]) => theme);

  return {
    ...summariseCapacity(capacityTotal, committedTotal),
    byTheme,
    themesOver,
    weeks,
  };
}

/** Story/task points to hours, guarding the junk that reaches this from Firestore. */
export function pointsToHours(points: unknown): number {
  const n = Number(points);
  return Number.isFinite(n) && n > 0 ? n * HOURS_PER_POINT : 0;
}

/** Compact "412 / 461h" for a header or cell. */
export function formatCapacity(slice: CapacitySlice): string {
  const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
  return slice.capacityHours > 0
    ? `${round(slice.committedHours)} / ${round(slice.capacityHours)}h`
    : `${round(slice.committedHours)}h · none allocated`;
}
