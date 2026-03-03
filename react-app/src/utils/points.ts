export const POINTS_MIN = 0.25;
export const TASK_POINTS_MAX = 8;
export const STORY_POINTS_MAX = 13;
export const POINTS_STEP = 0.25;

export interface NormalizePointsOptions {
  min?: number;
  max?: number;
  step?: number;
  fallback?: number;
}

const roundToStep = (value: number, step: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Number((Math.round(value / step) * step).toFixed(2));
};

export const parsePointsValue = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return null;
  return parsed;
};

export const normalizePointsValue = (
  value: unknown,
  options: NormalizePointsOptions = {},
): number => {
  const {
    min = POINTS_MIN,
    max = TASK_POINTS_MAX,
    step = POINTS_STEP,
    fallback = 1,
  } = options;
  const parsed = parsePointsValue(value);
  if (parsed == null) return roundToStep(fallback, step);
  const bounded = Math.max(min, Math.min(max, parsed));
  return roundToStep(bounded, step);
};
