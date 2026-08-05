import { compareTimestamps, formatTimestampCell, toMillis } from './timestamps';

/**
 * The same createdAt field reaches the Modern* tables in four shapes depending on which page
 * mounted them, and the sort comparators these replace handled only one each. A Timestamp put
 * through `new Date(value)` is Invalid Date, which ties every row and leaves the column
 * looking like sorting is broken.
 */

const firestoreTimestamp = (millis: number) => ({
  seconds: Math.floor(millis / 1000),
  nanoseconds: (millis % 1000) * 1e6,
  toMillis: () => millis,
  toDate: () => new Date(millis),
});

const MILLIS = Date.UTC(2026, 6, 27, 9, 41, 51);

describe('toMillis', () => {
  it('reads every shape a Firestore timestamp arrives in', () => {
    expect(toMillis(MILLIS)).toBe(MILLIS);
    expect(toMillis(new Date(MILLIS))).toBe(MILLIS);
    expect(toMillis(firestoreTimestamp(MILLIS))).toBe(MILLIS);
    expect(toMillis(new Date(MILLIS).toISOString())).toBe(MILLIS);
  });

  it('reads a plain {seconds, nanoseconds} object with no methods on it', () => {
    // What a Timestamp becomes once it has been through JSON.
    expect(toMillis({ seconds: Math.floor(MILLIS / 1000), nanoseconds: 0 })).toBe(
      Math.floor(MILLIS / 1000) * 1000,
    );
  });

  it('returns null rather than NaN for anything unreadable', () => {
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis('')).toBeNull();
    expect(toMillis('not a date')).toBeNull();
    expect(toMillis(new Date('nonsense'))).toBeNull();
    expect(toMillis(Number.NaN)).toBeNull();
  });
});

describe('formatTimestampCell', () => {
  it('renders a date and time, not a raw epoch number', () => {
    expect(formatTimestampCell(MILLIS)).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
  });

  it('formats the Timestamp, Date and millis forms identically', () => {
    const fromMillis = formatTimestampCell(MILLIS);
    expect(formatTimestampCell(new Date(MILLIS))).toBe(fromMillis);
    expect(formatTimestampCell(firestoreTimestamp(MILLIS))).toBe(fromMillis);
  });

  it('is empty for a missing timestamp', () => {
    expect(formatTimestampCell(null)).toBe('');
    expect(formatTimestampCell(undefined)).toBe('');
  });
});

describe('compareTimestamps', () => {
  const older = firestoreTimestamp(MILLIS - 86_400_000);
  const newer = firestoreTimestamp(MILLIS);

  it('orders Timestamps ascending and descending', () => {
    expect(compareTimestamps(older, newer, 1)).toBe(-1);
    expect(compareTimestamps(newer, older, 1)).toBe(1);
    expect(compareTimestamps(older, newer, -1)).toBe(1);
    expect(compareTimestamps(newer, older, -1)).toBe(-1);
  });

  it('compares across mixed shapes', () => {
    expect(compareTimestamps(new Date(MILLIS - 1000), MILLIS, 1)).toBe(-1);
    expect(compareTimestamps(new Date(MILLIS).toISOString(), older, 1)).toBe(1);
  });

  it('ties equal timestamps', () => {
    expect(compareTimestamps(MILLIS, new Date(MILLIS), 1)).toBe(0);
  });

  it('sorts rows with no timestamp last in both directions', () => {
    expect(compareTimestamps(null, newer, 1)).toBe(1);
    expect(compareTimestamps(null, newer, -1)).toBe(1);
    expect(compareTimestamps(newer, null, 1)).toBe(-1);
    expect(compareTimestamps(newer, null, -1)).toBe(-1);
    expect(compareTimestamps(null, null, 1)).toBe(0);
  });

  it('actually reorders a list that the old new Date(value) comparator left untouched', () => {
    const rows = [
      { id: 'b', createdAt: firestoreTimestamp(MILLIS) },
      { id: 'a', createdAt: firestoreTimestamp(MILLIS - 86_400_000) },
      { id: 'c', createdAt: null },
    ];
    const ascending = [...rows].sort((x, y) => compareTimestamps(x.createdAt, y.createdAt, 1));
    expect(ascending.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
