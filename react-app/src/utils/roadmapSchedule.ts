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
  const start = quarterMidTimestamp(quarterKey);
  if (start == null) return null;
  return { startDate: start, endDate: start + goalDurationMs(prevStart, prevEnd) };
}

/** Sort key for a `YYYY-Qn` string. Lexical sort works, but only by luck of zero-padding. */
export function quarterOrdinal(key: string): number | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  return m ? Number(m[1]) * 4 + (Number(m[2]) - 1) : null;
}

export const UNSCHEDULED_COLUMN = 'unscheduled';

/**
 * Column order for the roadmap grid.
 *
 * Two deliberate choices, both about making a drag short:
 *  - History is trimmed to a single quarter before the current one. Older quarters are done
 *    with, and keeping them pushes the columns you actually plan into off the right edge.
 *  - Unscheduled sits immediately BEFORE the current quarter rather than last. It is the pile
 *    you drag OUT of, and it was previously the furthest possible point from the target.
 *
 * Result: [Q(n-1), Unscheduled, Q(n), Q(n+1), ...].
 */
export function roadmapColumnOrder(quarterKeys: string[], currentKey: string | null): string[] {
  const cur = currentKey ? quarterOrdinal(currentKey) : null;

  const sorted = [...new Set(quarterKeys)]
    .filter((k) => quarterOrdinal(k) != null)
    .sort((a, b) => quarterOrdinal(a)! - quarterOrdinal(b)!);

  if (cur == null) return [...sorted, UNSCHEDULED_COLUMN];

  const kept = sorted.filter((k) => quarterOrdinal(k)! >= cur - 1);
  const previous = kept.filter((k) => quarterOrdinal(k)! < cur);
  const currentAndLater = kept.filter((k) => quarterOrdinal(k)! >= cur);

  // The current quarter always gets a column, even with nothing scheduled in it.
  if (currentKey && !currentAndLater.includes(currentKey)) currentAndLater.unshift(currentKey);

  return [...previous, UNSCHEDULED_COLUMN, ...currentAndLater];
}
