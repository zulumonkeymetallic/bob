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
