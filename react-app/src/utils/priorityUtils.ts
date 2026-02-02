export const normalizePriorityValue = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value).trim();
  if (!normalized) return 0;
  const lower = normalized.toLowerCase();
  if (['4', 'critical', 'p0', 'p1', 'prioritize', 'urgent'].includes(lower)) return 4;
  if (['3', 'high', 'p2', 'p-1', 'p+1'].includes(lower)) return 3;
  if (['2', 'medium', 'mid', 'p3', 'p-2'].includes(lower)) return 2;
  if (['1', 'low', 'p4', 'p-3'].includes(lower)) return 1;
  if (['0', 'none', 'n/a', 'na'].includes(lower)) return 0;
  if (lower.includes('crit')) return 4;
  if (lower.includes('high')) return 3;
  if (lower.includes('med')) return 2;
  if (lower.includes('low')) return 1;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isCriticalPriority = (priority: unknown): boolean => normalizePriorityValue(priority) >= 4;
