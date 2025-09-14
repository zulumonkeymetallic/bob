import { RRule, RRuleSet, rrulestr } from 'rrule';

/**
 * Compute the next occurrence time (epoch millis) for a given RFC5545 RRULE string.
 * Optionally provide a DTSTART (epoch millis). If not provided, now is used as a baseline.
 * Returns null if no future occurrence is found.
 */
export function nextDueAt(rruleText: string, dtstart?: number, from?: number): number | null {
  if (!rruleText) return null;

  const base = new Date(typeof from === 'number' ? from : Date.now());

  // If DTSTART not embedded in the rruleText and provided separately, inject it.
  let rule: RRule | RRuleSet;
  try {
    // Prepend DTSTART if supplied and not present in the string already
    const hasDtstart = /DTSTART/i.test(rruleText);
    const text = !hasDtstart && dtstart
      ? `DTSTART:${new Date(dtstart).toISOString().replace(/[-:]/g, '').split('.')[0]}Z\n${rruleText}`
      : rruleText;

    rule = rrulestr(text);
  } catch (e) {
    console.error('[recurrence] Invalid RRULE:', rruleText, e);
    return null;
  }

  const next = rule.after(base, true);
  return next ? next.getTime() : null;
}

/**
 * Generate a deterministic planId for a user and date.
 * planId = `${yyyymmdd}-${userId}`
 */
export function makePlanId(userId: string, date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}${m}${d}-${userId}`;
}

/**
 * Create a stable assignment id from parts to ensure idempotency.
 */
export function makeAssignmentId(parts: {
  planId: string;
  itemType: string;
  itemId: string;
}): string {
  const raw = `${parts.planId}:${parts.itemType}:${parts.itemId}`;
  // Simple stable hash -> base36 string
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * Format a Date to yyyymmdd string
 */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}${m}${d}`;
}

