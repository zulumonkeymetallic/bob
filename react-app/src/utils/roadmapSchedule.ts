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
 * It stops at sprint. Days belong to the Calendar, which already has Google sync, real events
 * and time-of-day placement, and story-level sprint capacity belongs to /planner?level=sprint —
 * rebuilding either here would duplicate a stronger surface with a worse version.
 */
export function computeQuarterKey(ts: number | null | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
}

export function quarterLabel(key: string): string {
  if (key === UNSCHEDULED_COLUMN) return 'Backlog';
  const [year, q] = key.split('-');
  return `${q} ${year}`;
}

export type RoadmapGranularity = 'quarter' | 'sprint';

export const ROADMAP_ROW_AXIS: Record<RoadmapGranularity, 'theme' | 'goal'> = {
  // Quarter is the strategic horizon: themes as rows, because the question is balance
  // between them.
  quarter: 'theme',
  // Sprint is the execution horizon: goals as rows, because the question is which goals are
  // actually in flight. Row counts stay sane here in a way they never did at month, since the
  // sprint filters and a handful of columns naturally narrow it.
  sprint: 'goal',
};

/** Period key for a timestamp at the given granularity. */
export function computePeriodKey(
  ts: number | null | undefined, g: RoadmapGranularity, sprints: RoadmapSprint[] = [],
): string | null {
  return g === 'sprint' ? computeSprintKey(ts, sprints) : computeQuarterKey(ts);
}

export function periodLabel(key: string, g: RoadmapGranularity, sprints: RoadmapSprint[] = []): string {
  if (key === UNSCHEDULED_COLUMN) return 'Backlog';
  return g === 'sprint' ? sprintLabel(key, sprints) : quarterLabel(key);
}

/** Mid-period timestamp — the anchor a dropped goal's end date takes. */
export function periodMidTimestamp(
  key: string, g: RoadmapGranularity, sprints: RoadmapSprint[] = [],
): number | null {
  return g === 'sprint' ? sprintMidTimestamp(key, sprints) : quarterMidTimestamp(key);
}

/** Granularity-aware sibling of rescheduleGoalToQuarter. Same end-anchored rule. */
export function rescheduleGoalToPeriod(
  key: string, g: RoadmapGranularity, prevStart: unknown, prevEnd: unknown,
  sprints: RoadmapSprint[] = [],
): RescheduledDates | null {
  const end = periodMidTimestamp(key, g, sprints);
  if (end == null) return null;
  return { startDate: end - goalDurationMs(prevStart, prevEnd), endDate: end };
}

/** Column order at either granularity: [Unscheduled, P(n-1), P(n), P(n+1), ...]. */
export function roadmapPeriodOrder(
  keys: string[], currentKey: string | null, g: RoadmapGranularity,
  sprints: RoadmapSprint[] = [],
): string[] {
  // Sprint columns come from the sprint list, not from the keys present in the data — an empty
  // sprint still needs a column to drag INTO.
  if (g === 'sprint') return roadmapSprintOrder(sprints);
  return roadmapColumnOrder(keys, currentKey);
}

// ── Sprint granularity ───────────────────────────────────────────────────────

/**
 * Sprints as roadmap columns.
 *
 * Unlike quarters and months, a sprint is NOT derivable from a timestamp — it is a named,
 * user-defined, irregular window. So every sprint-aware helper takes the sprint list, and the
 * column key is the sprint's document id rather than an encoded date. That is the whole reason
 * sprint could not just be another case in the existing period functions.
 *
 * This is the goal-level view of a sprint. The story-level capacity board at
 * /planner?level=sprint (points, free capacity, over-commitment) is a different altitude and is
 * deliberately NOT reproduced here.
 */
export interface RoadmapSprint {
  id: string;
  name?: string;
  ref?: string;
  startDate?: unknown;
  endDate?: unknown;
}

const sprintWindow = (s: RoadmapSprint): { start: number; end: number } | null => {
  const start = finite(s.startDate);
  const end = finite(s.endDate);
  return start != null && end != null && end >= start ? { start, end } : null;
};

/** The sprint whose window contains ts. Overlapping sprints resolve to the earliest start. */
export function computeSprintKey(ts: number | null | undefined, sprints: RoadmapSprint[]): string | null {
  const t = finite(ts);
  if (t == null) return null;
  const hit = sprints
    .map((s) => ({ s, w: sprintWindow(s) }))
    .filter((x) => x.w && t >= x.w.start && t <= x.w.end)
    .sort((a, b) => a.w!.start - b.w!.start)[0];
  return hit ? hit.s.id : null;
}

export function sprintLabel(key: string, sprints: RoadmapSprint[]): string {
  if (key === UNSCHEDULED_COLUMN) return 'Backlog';
  const s = sprints.find((x) => x.id === key);
  return s?.name || s?.ref || 'Sprint';
}

/** Mid-sprint — the anchor a dropped goal's end date takes, matching the quarter/month rule. */
export function sprintMidTimestamp(key: string, sprints: RoadmapSprint[]): number | null {
  const w = sprints.find((x) => x.id === key);
  const win = w ? sprintWindow(w) : null;
  return win ? win.start + (win.end - win.start) / 2 : null;
}

/**
 * Sprint columns in date order: [Unscheduled, previous, current, future...].
 *
 * Same one-period-of-history rule as quarters and months, but "current" is found by date
 * window rather than computed, and sprints with no usable dates are dropped — they cannot be
 * placed on a time axis at all.
 */
export function roadmapSprintOrder(sprints: RoadmapSprint[], nowTs: number = Date.now()): string[] {
  const dated = sprints
    .map((s) => ({ id: s.id, w: sprintWindow(s) }))
    .filter((x): x is { id: string; w: { start: number; end: number } } => x.w != null)
    .sort((a, b) => a.w.start - b.w.start);

  const curIdx = dated.findIndex((x) => nowTs >= x.w.start && nowTs <= x.w.end);
  // No sprint contains today: fall back to the first that has not yet ended, so the columns
  // still open on what is next rather than on ancient history.
  const anchor = curIdx >= 0 ? curIdx : dated.findIndex((x) => x.w.end >= nowTs);
  const from = anchor > 0 ? anchor - 1 : 0;

  return [UNSCHEDULED_COLUMN, ...dated.slice(anchor < 0 ? Math.max(0, dated.length - 1) : from).map((x) => x.id)];
}
