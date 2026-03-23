export const MOBILE_STORY_PROGRESS_OPTIONS = [0, 10, 25, 50, 75, 90, 100] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeStoryPoints = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
};

export const normalizeProgressPct = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(Math.round(numeric), 0, 100);
};

export const computePointsRemaining = (points: unknown, progressPct: unknown): number => {
  const total = normalizeStoryPoints(points);
  if (total <= 0) return 0;
  const pct = normalizeProgressPct(progressPct);
  return Math.max(0, Math.ceil((total * (1 - pct / 100)) * 10) / 10);
};

export const deriveProgressPctFromPointsRemaining = (points: unknown, pointsRemaining: unknown): number => {
  const total = normalizeStoryPoints(points);
  if (total <= 0) return 0;
  const remainingRaw = Number(pointsRemaining);
  const remaining = Number.isFinite(remainingRaw) ? clamp(remainingRaw, 0, total) : total;
  const done = total - remaining;
  return clamp(Math.round((done / total) * 100), 0, 100);
};

export const buildStoryProgressUpdate = ({
  points,
  progressPct,
  pointsRemaining,
}: {
  points: unknown;
  progressPct?: unknown;
  pointsRemaining?: unknown;
}) => {
  const total = normalizeStoryPoints(points);
  const resolvedProgressPct = pointsRemaining != null && pointsRemaining !== ''
    ? deriveProgressPctFromPointsRemaining(total, pointsRemaining)
    : normalizeProgressPct(progressPct);
  const resolvedPointsRemaining = computePointsRemaining(total, resolvedProgressPct);
  return {
    progressPct: resolvedProgressPct,
    progressPctUpdatedAt: Date.now(),
    pointsRemaining: resolvedPointsRemaining,
    pointsRemainingAsOfDateKey: new Date().toISOString().slice(0, 10),
    pointsRemainingUpdatedAt: Date.now(),
  };
};

export const formatStoryProgressLabel = (points: unknown, progressPct: unknown): string => {
  const resolvedProgressPct = normalizeProgressPct(progressPct);
  const remaining = computePointsRemaining(points, resolvedProgressPct);
  return `${resolvedProgressPct}% · ${remaining} pts left`;
};
