export const parseIdListParam = (value: string | null | undefined): string[] => (
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
);

export const parseNumberListParam = (value: string | null | undefined): number[] => (
  parseIdListParam(value)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
);

export const parseBooleanParam = (value: string | null | undefined): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};
