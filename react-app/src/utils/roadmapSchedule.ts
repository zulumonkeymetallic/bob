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
