export const MISSING_INFO_CELL_BG = 'rgba(239, 68, 68, 0.14)';
export const MISSING_INFO_CELL_BG_HOVER = 'rgba(239, 68, 68, 0.22)';

export const isBlankText = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
};

export const hasLinkedId = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length > 0;
  return value != null;
};

export const isMissingPoints = (value: unknown): boolean => {
  if (value == null || value === '') return true;
  const parsed = typeof value === 'number' ? value : Number(value);
  return !Number.isFinite(parsed) || parsed <= 0;
};
