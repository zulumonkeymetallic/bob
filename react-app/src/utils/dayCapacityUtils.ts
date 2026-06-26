/**
 * Waking-window capacity model.
 *
 * Available hours per day = waking window (05:00–21:00, 16 h)
 *   minus hard GCal commitments  (source='gcal')
 *   minus theme-allocation blocks (source='theme_allocation').
 *
 * sprint_forward_plan blocks are intentionally excluded from the busy
 * calculation — they are the output of the scheduling process, not a constraint.
 */

import type { CalendarBlock } from '../types';

export const WAKING_START_HOUR   = 5;    // 05:00
export const WAKING_END_HOUR     = 21;   // 21:00
export const WAKING_MINS_PER_DAY = (WAKING_END_HOUR - WAKING_START_HOUR) * 60; // 960

type BlockWithSource = CalendarBlock & { source?: string };

export interface DayCapacity {
  dateIso: string;
  totalMins: number;        // WAKING_MINS_PER_DAY (constant)
  gcalMins: number;         // committed from GCal imports / external events
  themeAllocMins: number;   // committed from theme_allocation blocks
  busyMins: number;         // gcalMins + themeAllocMins
  availableMins: number;    // totalMins - busyMins (clamped ≥ 0)
  availableHours: number;   // availableMins / 60
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Compute available capacity for a single calendar day.
 * Block durations are clipped to the waking window before summing.
 */
export function computeDayCapacity(
  dateIso: string,
  calendarBlocks: BlockWithSource[],
): DayCapacity {
  const base       = new Date(dateIso + 'T00:00:00');
  const wakingStart = new Date(base).setHours(WAKING_START_HOUR, 0, 0, 0);
  const wakingEnd   = new Date(base).setHours(WAKING_END_HOUR,   0, 0, 0);

  let gcalMins = 0;
  let themeAllocMins = 0;

  for (const block of calendarBlocks) {
    if (block.status === 'superseded') continue;
    const src = (block.source ?? '') as string;
    if (src !== 'gcal' && src !== 'theme_allocation') continue;

    const bStart = Math.max(block.start, wakingStart);
    const bEnd   = Math.min(block.end ?? (block.start + 3_600_000), wakingEnd);
    if (bEnd <= bStart) continue;

    const mins = (bEnd - bStart) / 60_000;
    if (src === 'gcal')              gcalMins       += mins;
    else                             themeAllocMins += mins;
  }

  const busyMins      = gcalMins + themeAllocMins;
  const availableMins = Math.max(0, WAKING_MINS_PER_DAY - busyMins);

  return {
    dateIso,
    totalMins: WAKING_MINS_PER_DAY,
    gcalMins,
    themeAllocMins,
    busyMins,
    availableMins,
    availableHours: availableMins / 60,
  };
}

/**
 * Build a per-day capacity map for the given date range (inclusive).
 * All `calendarBlocks` are passed in full; the function picks out only
 * those relevant to each day.
 */
export function buildCapacityMap(
  fromMs: number,
  toMs: number,
  calendarBlocks: BlockWithSource[],
): Map<string, DayCapacity> {
  const map    = new Map<string, DayCapacity>();
  const DAY_MS = 86_400_000;
  let cur = startOfDayMs(fromMs);
  while (cur <= toMs) {
    const iso = toIso(cur);
    // Filter to only blocks that start on this day (avoids re-scanning all blocks per day
    // for typical datasets; for large ranges a pre-grouped index would be faster).
    const dayBlocks = calendarBlocks.filter((b) => toIso(b.start) === iso);
    map.set(iso, computeDayCapacity(iso, dayBlocks));
    cur += DAY_MS;
  }
  return map;
}

/**
 * Return the first day on or after tomorrow where available capacity
 * is at least `effortHours`.  Searches up to `sprintEndMs` or 14 days,
 * whichever horizon is further.  Falls back to tomorrow if no ideal slot exists.
 */
export function findNextFreeDay(
  effortHours: number,
  capacityMap: Map<string, DayCapacity>,
  sprintEndMs = 0,
): number {
  const DAY_MS     = 86_400_000;
  const LOOK_AHEAD = 30;
  const today      = startOfDayMs(Date.now()); // include today as a candidate
  const horizonMs  = sprintEndMs > today
    ? startOfDayMs(sprintEndMs)
    : today + LOOK_AHEAD * DAY_MS;

  let cur = today;
  while (cur <= horizonMs) {
    const detail = capacityMap.get(toIso(cur));
    // If no entry (day beyond map range), treat as fully available
    if (!detail || detail.availableHours >= effortHours) return cur;
    cur += DAY_MS;
  }
  return today;
}

/**
 * Sum capacity totals across a date range.
 * Useful for sprint-level and week-level metric widgets.
 */
export function sumCapacityRange(
  capacityMap: Map<string, DayCapacity>,
  fromMs: number,
  toMs: number,
): Omit<DayCapacity, 'dateIso'> {
  const DAY_MS = 86_400_000;
  let totalMins = 0, gcalMins = 0, themeAllocMins = 0, busyMins = 0, availableMins = 0;
  let cur = startOfDayMs(fromMs);
  while (cur <= toMs) {
    const d = capacityMap.get(toIso(cur));
    if (d) {
      totalMins      += d.totalMins;
      gcalMins       += d.gcalMins;
      themeAllocMins += d.themeAllocMins;
      busyMins       += d.busyMins;
      availableMins  += d.availableMins;
    }
    cur += DAY_MS;
  }
  return { totalMins, gcalMins, themeAllocMins, busyMins, availableMins, availableHours: availableMins / 60 };
}
