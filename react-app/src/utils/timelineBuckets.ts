export type TimelineBucket = 'morning' | 'afternoon' | 'evening' | 'anytime';
export const bucketOrder: TimelineBucket[] = ['morning', 'afternoon', 'evening', 'anytime'];

const normalizeTimeOfDay = (value: string | null | undefined): TimelineBucket | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'morning' || normalized === 'afternoon' || normalized === 'evening') {
    return normalized;
  }
  return null;
};

export const bucketLabel = (bucket: TimelineBucket): string => {
  if (bucket === 'morning') return 'Morning';
  if (bucket === 'afternoon') return 'Afternoon';
  if (bucket === 'evening') return 'Evening';
  return 'Anytime';
};

export const bucketFromTime = (
  ms: number | null | undefined,
  timeOfDay?: string | null,
  fallback: TimelineBucket = 'morning',
): TimelineBucket => {
  const explicit = normalizeTimeOfDay(timeOfDay);
  if (!ms || !Number.isFinite(ms)) return explicit || fallback;
  const date = new Date(ms);
  const minute = date.getHours() * 60 + date.getMinutes();
  // Real scheduled times should win over stale bucket flags, except when the stored timestamp is date-only midnight.
  if (minute === 0 && explicit) return explicit;
  if (minute >= 300 && minute <= 779) return 'morning';
  if (minute >= 780 && minute <= 1139) return 'afternoon';
  if (minute >= 1140 || minute < 300) return 'evening';
  return explicit || fallback;
};

export const bucketPseudoTime = (dayStartMs: number, bucket: TimelineBucket): number => {
  if (bucket === 'morning') return dayStartMs + (9 * 60 * 60 * 1000);
  if (bucket === 'afternoon') return dayStartMs + (14 * 60 * 60 * 1000);
  if (bucket === 'evening') return dayStartMs + (19.5 * 60 * 60 * 1000);
  return dayStartMs + (12 * 60 * 60 * 1000);
};

export const formatBucketBackfillLabel = (
  startMs: number | null | undefined,
  endMs?: number | null,
  timeOfDay?: string | null,
): string => {
  if (!startMs || !Number.isFinite(startMs)) {
    return `Unscheduled (${bucketLabel(bucketFromTime(null, timeOfDay))})`;
  }
  const start = new Date(startMs);
  const startLabel = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (endMs && Number.isFinite(endMs)) {
    const end = new Date(endMs);
    const endLabel = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${startLabel} - ${endLabel}`;
  }
  return startLabel;
};
