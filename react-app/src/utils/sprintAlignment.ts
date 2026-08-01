import { Goal, Sprint } from '../types';
import { isGoalInHierarchySet } from './goalHierarchy';

export type SprintAlignmentMode = 'warn' | 'strict';

export interface SprintAlignmentEvaluation {
  hasRule: boolean;
  mode: SprintAlignmentMode;
  /** Retained so existing callers keep compiling; nothing sets it true any more. */
  blocking: boolean;
  /** Strict mode: create the story but defer it, rather than refusing to create it. */
  deferOnCreate?: boolean;
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
  goals: Goal[] = [],
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

  const aligned = !!normalizedGoalId && (
    focusGoalIds.includes(normalizedGoalId)
    || isGoalInHierarchySet(normalizedGoalId, goals, focusGoalIds)
  );
  if (aligned) {
    return {
      hasRule: true,
      mode,
      blocking: false,
      aligned: true,
      message: '',
    };
  }

  // Neither mode refuses the work any more. Strict used to hard-block creation, which meant
  // the thought you were trying to capture was simply lost — you either abandoned it or
  // mislabelled its goal to get past the gate, and the second is worse than an unaligned
  // story. Confirmed by Jim, 2026-08-01: strict should still add it, deferred; warn should
  // add it to the sprint's backlog and say so.
  if (mode === 'strict') {
    return {
      hasRule: true,
      mode,
      blocking: false,
      deferOnCreate: true,
      aligned: false,
      message: 'This sprint is in strict focus mode and this goal is outside its focus goals. The story will be created and deferred, so it stays out of this sprint until you schedule it.',
    };
  }

  return {
    hasRule: true,
    mode,
    blocking: false,
    deferOnCreate: false,
    aligned: false,
    message: 'This goal is outside the sprint’s focus goals. The story will be created in the sprint’s backlog rather than the active plan.',
  };
};
