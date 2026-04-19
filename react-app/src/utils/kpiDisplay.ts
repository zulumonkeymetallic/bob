export const toKpiNumber = (value: any): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatKpiValue = (value: number | null, unit: string): string => {
  if (value == null) return '—';
  if (unit === 'GBP') return `£${Math.round(value).toLocaleString()}`;
  if (unit === '%') return `${Math.round(value)}%`;
  if (unit === 'km' || unit === 'hours') return `${Number(value.toFixed(1))}`;
  return `${Math.round(value)}`;
};

export const getKpiStateLabel = (
  progressPct: number | null,
  healthy?: boolean | null,
  stale?: boolean | null,
): string => {
  if (stale === true || healthy === false) {
    return progressPct != null ? `Stale data · ${Math.round(progressPct)}% of target` : 'Stale data';
  }
  if (healthy === true) {
    return progressPct != null ? `Healthy · ${Math.round(progressPct)}% of target` : 'Healthy';
  }
  if (progressPct != null) {
    return `${Math.round(progressPct)}% of target`;
  }
  return 'Waiting for synced KPI metrics';
};

export const getKpiHealthRollupLabel = (healthy: number, total: number, stale = 0): string => {
  if (total === 0) return 'No KPIs';
  if (stale > 0) return `${healthy}/${total} healthy · ${stale} stale`;
  return `${healthy}/${total} healthy`;
};

export const getKpiStateBadge = (
  healthy?: boolean | null,
  stale?: boolean | null,
): { bg: 'success' | 'warning' | 'secondary'; label: string } => {
  if (stale === true || healthy === false) return { bg: 'warning', label: 'Stale' };
  if (healthy === true) return { bg: 'success', label: 'Healthy' };
  return { bg: 'secondary', label: 'Pending' };
};
