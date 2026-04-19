import { Goal } from '../types';

export type GoalCostType = 'none' | 'one_off' | 'recurring';

const normalize = (value: unknown): string => String(value || '').trim().toLowerCase();

export const normalizeGoalCostType = (value: unknown): GoalCostType | null => {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (normalized === 'none') return 'none';
  if (normalized === 'one_off' || normalized === 'one-off' || normalized === 'oneoff') return 'one_off';
  if (normalized === 'recurring') return 'recurring';
  return null;
};

export const getGoalLinkedPotId = (goal: Goal | Record<string, any> | null | undefined): string | null => {
  if (!goal) return null;
  const raw = (goal as any).linkedPotId || (goal as any).potId || null;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed || null;
};

export const goalHasCostRequirement = (goal: Goal | Record<string, any> | null | undefined): boolean => {
  if (!goal) return false;
  const costType = normalizeGoalCostType((goal as any).costType);
  if (costType === 'none') return false;
  if (costType === 'one_off' || costType === 'recurring') return true;
  const estimated = Number((goal as any).estimatedCost || 0);
  return Number.isFinite(estimated) && estimated > 0;
};

export const goalNeedsLinkedPot = (goal: Goal | Record<string, any> | null | undefined): boolean => {
  if (!goalHasCostRequirement(goal)) return false;
  return !getGoalLinkedPotId(goal);
};
