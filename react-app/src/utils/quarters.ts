/**
 * Quarter helpers for goal date fields.
 *
 * Goals get planned by quarter, not by day — "Q3 2026", not "14 August". These were written
 * inline in FloatingActionButton for its quick-add Goal form; extracted here so the Add Goal
 * and Edit Goal modals use one implementation rather than three that can drift on the edge
 * cases (quarter boundaries, year rollover, what "the middle of a quarter" means).
 */

/** `YYYY-Qn` for today. */
export function currentQuarterKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-Q${Math.ceil((date.getMonth() + 1) / 3)}`;
}

/** `count` quarter keys starting at the one containing today. */
export function buildQuarterOptions(count: number, from: Date = new Date()): string[] {
  const startQuarterIndex = Math.floor(from.getMonth() / 3);
  const startYear = from.getFullYear();
  const options: string[] = [];
  for (let i = 0; i < count; i++) {
    const qIdx = startQuarterIndex + i;
    options.push(`${startYear + Math.floor(qIdx / 4)}-Q${(qIdx % 4) + 1}`);
  }
  return options;
}

/** `2026-Q3` -> `Q3 2026`. */
export function quarterKeyLabel(key: string): string {
  const [year, q] = key.split('-');
  return `${q} ${year}`;
}

const quarterBounds = (key: string): { start: Date; end: Date } | null => {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const startMonth = (Number(m[2]) - 1) * 3;
  return {
    start: new Date(year, startMonth, 1, 0, 0, 0),
    // Day 0 of the month after the quarter = last day of the quarter.
    end: new Date(year, startMonth + 3, 0, 23, 59, 59),
  };
};

/** Midpoint of the quarter, in ms. What a goal dropped on a quarter takes as its date. */
export function quarterKeyToMidpointMs(key: string): number | null {
  const b = quarterBounds(key);
  return b ? Math.round((b.start.getTime() + b.end.getTime()) / 2) : null;
}

const toDateInput = (d: Date): string => {
  // Local parts, not toISOString(): that converts to UTC first, so anywhere behind UTC a
  // quarter's first day silently becomes the last day of the previous quarter.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** First and last day of the quarter as `yyyy-MM-dd`, for populating date inputs. */
export function quarterKeyToDateInputs(key: string): { start: string; end: string } | null {
  const b = quarterBounds(key);
  return b ? { start: toDateInput(b.start), end: toDateInput(b.end) } : null;
}

/** The quarter a `yyyy-MM-dd` input falls in, or '' if unparseable. */
export function dateInputToQuarterKey(value: string): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return '';
  return `${Number(m[1])}-Q${Math.ceil(Number(m[2]) / 3)}`;
}

/**
 * Options for a quarter picker that must be able to display `selectedKey`.
 *
 * buildQuarterOptions only looks forward from today, so an existing goal that started in a
 * past quarter had no matching <option> and the select rendered blank — as if the goal had no
 * quarter at all. Unions the selected key in and sorts, so editing an old goal shows its real
 * quarter instead of an empty box.
 */
export function quarterOptionsIncluding(selectedKey: string, count = 12, from: Date = new Date()): string[] {
  const options = new Set(buildQuarterOptions(count, from));
  if (/^\d{4}-Q[1-4]$/.test(selectedKey)) options.add(selectedKey);
  return [...options].sort((a, b) => {
    const [ay, aq] = a.split('-Q').map(Number);
    const [by, bq] = b.split('-Q').map(Number);
    return ay - by || aq - bq;
  });
}
