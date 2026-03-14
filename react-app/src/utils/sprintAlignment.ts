import { Sprint } from '../types';

export type SprintAlignmentMode = 'warn' | 'strict';

export interface SprintAlignmentEvaluation {
  hasRule: boolean;
  mode: SprintAlignmentMode;
  blocking: boolean;
  aligned: boolean;
  message: string;
}

const normalizeGoalIds = (value: any): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => String(id || '').trim())
    .filter((id) => !!id);
};

export const getSprintAlignmentMode = (sprint: Sprint | null | undefined): SprintAlignmentMode => {
  const normalized = String((sprint as any)?.alignmentMode || 'warn').trim().toLowerCase();
  return normalized === 'strict' ? 'strict' : 'warn';
};

export const getSprintFocusGoalIds = (sprint: Sprint | null | undefined): string[] => {
  return normalizeGoalIds((sprint as any)?.focusGoalIds);
};

export const evaluateStorySprintAlignment = (
  sprint: Sprint | null | undefined,
  goalId: string | null | undefined,
): SprintAlignmentEvaluation => {
  const focusGoalIds = getSprintFocusGoalIds(sprint);
  const mode = getSprintAlignmentMode(sprint);
  const normalizedGoalId = String(goalId || '').trim();

  if (!sprint || focusGoalIds.length === 0) {
    return {
      hasRule: false,
      mode,
      blocking: false,
      aligned: true,
      message: '',
    };
  }

  const aligned = !!normalizedGoalId && focusGoalIds.includes(normalizedGoalId);
  if (aligned) {
    return {
      hasRule: true,
      mode,
      blocking: false,
      aligned: true,
      message: '',
    };
  }

  if (mode === 'strict') {
    return {
      hasRule: true,
      mode,
      blocking: true,
      aligned: false,
      message: 'This sprint is in strict focus mode. Story goal must match one of the sprint focus goals.',
    };
  }

  return {
    hasRule: true,
    mode,
    blocking: false,
    aligned: false,
    message: 'This story is outside sprint focus goals. You can continue, but it will be tracked as unaligned.',
  };
};
