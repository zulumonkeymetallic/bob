/**
 * roadmapSchedule — date maths for dragging a goal between quarters on the roadmap.
 *
 * Why this exists: the roadmap and the Gantt disagreed about what a drag means. The Gantt
 * writes a goal's startDate AND endDate; the roadmap wrote only endDate and never touched
 * startDate. Nothing on either view moves stories directly — stories are realigned overnight,
 * server-side, by functions/alignStoriesToGoalSprints.js, which keys off the goal's dates. So a
 * goal moved on the roadmap reached that job with a stale or absent start, and its stories
 * could land in different sprints than the identical move made on the Gantt.
 *
 * The rule, matching how the Gantt behaves: the goal starts in the middle of the quarter it was
 * dropped into, and keeps the duration it already had.
 */

/** Middle of a quarter: the 15th of its SECOND month, local noon. */
export function quarterMidTimestamp(key: string): number | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  // q1 -> Feb, q2 -> May, q3 -> Aug, q4 -> Nov. Noon avoids any timezone edge flipping the day.
  return new Date(year, q * 3 - 2, 15, 12, 0, 0).getTime();
}

/** A quarter, near enough, for goals that have never had both dates set. */
export const DEFAULT_GOAL_DURATION_MS = 91 * 24 * 60 * 60 * 1000;

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Duration to preserve across a move. Falls back to a quarter when the goal has no usable
 * pair of dates — which is common, since the roadmap has been writing endDate alone.
 */
export function goalDurationMs(prevStart: unknown, prevEnd: unknown): number {
  const s = finite(prevStart);
  const e = finite(prevEnd);
  if (s == null || e == null) return DEFAULT_GOAL_DURATION_MS;
  const d = e - s;
  return d > 0 ? d : DEFAULT_GOAL_DURATION_MS;
}

export interface RescheduledDates {
  startDate: number;
  endDate: number;
}

/**
 * New start/end for a goal dropped into `quarterKey`, preserving its existing duration.
 * Returns null for an unparseable quarter so the caller can decline to write anything.
 */
export function rescheduleGoalToQuarter(
  quarterKey: string,
  prevStart: unknown,
  prevEnd: unknown,
): RescheduledDates | null {
  // The END date is anchored to the dropped quarter, and the start is derived backwards from
  // the duration. This is the opposite of what it first looks like it should be, and it
  // matters: the roadmap places a goal in the column matching its endDate, so anchoring the
  // START here made a goal dropped on Q1 2027 render in whatever later quarter its end landed
  // in. Anchoring the end means a goal lands exactly where it was dropped, and existing goals
  // — which are positioned by endDate already — do not shift.
  const end = quarterMidTimestamp(quarterKey);
  if (end == null) return null;
  return { startDate: end - goalDurationMs(prevStart, prevEnd), endDate: end };
}

/** Sort key for a `YYYY-Qn` string. Lexical sort works, but only by luck of zero-padding. */
export function quarterOrdinal(key: string): number | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  return m ? Number(m[1]) * 4 + (Number(m[2]) - 1) : null;
}

export const UNSCHEDULED_COLUMN = 'unscheduled';

/**
 * Column order for the roadmap grid: [Unscheduled, Q(n-1), Q(n), Q(n+1), ...].
 *
 * Unscheduled leads, immediately after the theme label, because it is the pile you drag OUT
 * of — putting it first means the source is always in the same place and never scrolls away.
 * One quarter of history is kept after it; anything older is finished with and only pushes the
 * quarters you actually plan into off the right edge.
 */
export function roadmapColumnOrder(quarterKeys: string[], currentKey: string | null): string[] {
  const cur = currentKey ? quarterOrdinal(currentKey) : null;

  const sorted = [...new Set(quarterKeys)]
    .filter((k) => quarterOrdinal(k) != null)
    .sort((a, b) => quarterOrdinal(a)! - quarterOrdinal(b)!);

  if (cur == null) return [UNSCHEDULED_COLUMN, ...sorted];

  const kept = sorted.filter((k) => quarterOrdinal(k)! >= cur - 1);
  // The current quarter always gets a column, even with nothing scheduled in it.
  if (currentKey && !kept.includes(currentKey)) {
    kept.push(currentKey);
    kept.sort((a, b) => quarterOrdinal(a)! - quarterOrdinal(b)!);
  }

  return [UNSCHEDULED_COLUMN, ...kept];
}

// ── Granularity ──────────────────────────────────────────────────────────────

/**
 * How wide a roadmap column is, and — deliberately coupled — what a ROW means.
 *
 * The row axis changes with the time axis because that is how planning horizon actually
 * works: across a quarter you are balancing themes against each other, across a month you are
 * asking which goals land when. A fixed row axis makes one of those two views useless.
 *
 * It stops at month. Days belong to the Calendar, which already has Google sync, real events
 * and time-of-day placement; rebuilding that here would duplicate the strongest surface in the
 * app with a worse version.
 */
export function computeQuarterKey(ts: number | null | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
}

export function quarterLabel(key: string): string {
  if (key === UNSCHEDULED_COLUMN) return 'Unscheduled';
  const [year, q] = key.split('-');
  return `${q} ${year}`;
}

export type RoadmapGranularity = 'quarter' | 'month';

export const ROADMAP_ROW_AXIS: Record<RoadmapGranularity, 'theme' | 'goal'> = {
  quarter: 'theme',
  month: 'goal',
};

export function computeMonthKey(ts: number | null | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-M${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthOrdinal(key: string): number | null {
  const m = /^(\d{4})-M(0[1-9]|1[0-2])$/.exec(key);
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
}

export function monthLabel(key: string): string {
  const m = /^(\d{4})-M(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

/** Period key for a timestamp at the given granularity. */
export function computePeriodKey(ts: number | null | undefined, g: RoadmapGranularity): string | null {
  return g === 'month' ? computeMonthKey(ts) : computeQuarterKey(ts);
}

export function periodLabel(key: string, g: RoadmapGranularity): string {
  if (key === UNSCHEDULED_COLUMN) return 'Unscheduled';
  return g === 'month' ? monthLabel(key) : quarterLabel(key);
}

/** Mid-period timestamp — the anchor a dropped goal's end date takes. */
export function periodMidTimestamp(key: string, g: RoadmapGranularity): number | null {
  if (g !== 'month') return quarterMidTimestamp(key);
  const m = /^(\d{4})-M(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 15, 12, 0, 0).getTime();
}

/** Granularity-aware sibling of rescheduleGoalToQuarter. Same end-anchored rule. */
export function rescheduleGoalToPeriod(
  key: string, g: RoadmapGranularity, prevStart: unknown, prevEnd: unknown,
): RescheduledDates | null {
  const end = periodMidTimestamp(key, g);
  if (end == null) return null;
  return { startDate: end - goalDurationMs(prevStart, prevEnd), endDate: end };
}

/** Column order at either granularity: [Unscheduled, P(n-1), P(n), P(n+1), ...]. */
export function roadmapPeriodOrder(
  keys: string[], currentKey: string | null, g: RoadmapGranularity,
): string[] {
  if (g !== 'month') return roadmapColumnOrder(keys, currentKey);

  const ord = monthOrdinal;
  const cur = currentKey ? ord(currentKey) : null;
  const sorted = [...new Set(keys)].filter((k) => ord(k) != null).sort((a, b) => ord(a)! - ord(b)!);
  if (cur == null) return [UNSCHEDULED_COLUMN, ...sorted];

  const kept = sorted.filter((k) => ord(k)! >= cur - 1);
  if (currentKey && !kept.includes(currentKey)) {
    kept.push(currentKey);
    kept.sort((a, b) => ord(a)! - ord(b)!);
  }
  return [UNSCHEDULED_COLUMN, ...kept];
}
