import type { KpiDataSource } from '../types/KpiTypes';

export const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export const toMillis = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') {
    try {
      return Number(value.toMillis());
    } catch {
      return null;
    }
  }
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().getTime();
    } catch {
      return null;
    }
  }
  if (typeof value?.seconds === 'number') return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

export const isFreshTimestamp = (value: any, freshnessWindowHours = 24): boolean => {
  const ms = toMillis(value);
  if (ms == null) return false;
  return Date.now() - ms <= (freshnessWindowHours * 60 * 60 * 1000);
};

/**
 * Newest of several candidate timestamps, ignoring nulls.
 *
 * Freshness used to be read as `a || b` — first non-null wins. A sync field that stops
 * being written then permanently vetoes a live one: `healthkitLastSyncAt` sat at
 * 2026-06-06 for eight weeks while health_metrics was being written daily, so every
 * HealthKit KPI read as stale. Taking the max means a dead heartbeat can only ever be
 * ignored, never believed over a live one.
 */
export const newestTimestamp = (...values: any[]): number | null => {
  const stamps = values.map(toMillis).filter((ms): ms is number => ms != null);
  return stamps.length ? Math.max(...stamps) : null;
};

/**
 * Device sync is intermittent — a phone that did not sync is not a body that stopped
 * existing. 24h is far too tight for anything wearable-derived, and marks healthy data
 * stale on any day the app was not opened. Windows are per-signal because they decay at
 * genuinely different rates: HRV is a daily reading worth distrusting quickly, body
 * composition barely moves week to week.
 */
export const DEFAULT_FRESHNESS_WINDOW_HOURS: Record<string, number> = {
  hrv: 72,
  sleep: 72,
  steps: 48,
  workout: 240,      // 10 days — a genuine rest week must not read as a broken pipe
  weight: 336,       // 14 days
  bodyfat: 336,
};

/** Window for a metric key, falling back to a sync-tolerant default rather than 24h. */
export const freshnessWindowFor = (metricKey?: string | null, explicitHours?: number | null): number => {
  if (explicitHours != null && Number.isFinite(explicitHours)) return Number(explicitHours);
  const key = String(metricKey || '').toLowerCase();
  const match = Object.keys(DEFAULT_FRESHNESS_WINDOW_HOURS).find((k) => key.includes(k));
  return match ? DEFAULT_FRESHNESS_WINDOW_HOURS[match] : 72;
};

export const getSourceFreshnessLabel = (options: {
  source: KpiDataSource;
  automatedTimestamp?: any;
  manualObservedAt?: any;
  freshnessWindowHours?: number;
}) => {
  const { automatedTimestamp, manualObservedAt, freshnessWindowHours = 24 } = options;
  if (isFreshTimestamp(automatedTimestamp, freshnessWindowHours)) return 'Fresh automated';
  if (manualObservedAt != null) return 'Stale automated, using manual';
  return 'No current-period data';
};
