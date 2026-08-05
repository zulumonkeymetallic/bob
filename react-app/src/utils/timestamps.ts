/**
 * One reader for the several shapes a Firestore timestamp arrives in.
 *
 * The same `createdAt` field reaches the tables as a Firestore `Timestamp`, a plain
 * `Date` (the list pages call `.toDate()` when mapping the snapshot), raw millis, or an
 * ISO string (the local snapshot serialises it that way). `new Date(value)` silently
 * yields Invalid Date for the first shape, which is why the sort comparators that used
 * it put every Timestamp-valued row in the same NaN bucket.
 */
export const toMillis = (value: unknown): number | null => {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof (value as any)?.toMillis === 'function') {
    try {
      const millis = Number((value as any).toMillis());
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  if (typeof (value as any)?.toDate === 'function') {
    try {
      const date = (value as any).toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
    } catch {
      return null;
    }
  }
  if (typeof (value as any)?.seconds === 'number') {
    const nanos = typeof (value as any)?.nanoseconds === 'number' ? (value as any).nanoseconds : 0;
    return ((value as any).seconds * 1000) + Math.round(nanos / 1e6);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

/** Date + time, UK order, for a table cell. Empty string when there is no timestamp. */
export const formatTimestampCell = (value: unknown): string => {
  const millis = toMillis(value);
  if (millis == null) return '';
  return new Date(millis).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Comparator for a timestamp column. Rows with no timestamp sort last in both
 * directions — a missing date is not "the oldest".
 */
export const compareTimestamps = (a: unknown, b: unknown, directionFactor: 1 | -1): number => {
  const millisA = toMillis(a);
  const millisB = toMillis(b);
  if (millisA == null && millisB == null) return 0;
  if (millisA == null) return 1;
  if (millisB == null) return -1;
  if (millisA === millisB) return 0;
  return millisA > millisB ? directionFactor : -directionFactor;
};
