import type { FocusGoal, Goal } from '../types';

export const normalizeGoalId = (value: unknown): string => String(value || '').trim();

export const buildGoalIndex = (goals: Goal[]): Map<string, Goal> => {
  const index = new Map<string, Goal>();
  (goals || []).forEach((goal) => {
    const id = normalizeGoalId(goal?.id);
    if (id) index.set(id, goal);
  });
  return index;
};

export const getGoalChildrenMap = (goals: Goal[]): Map<string, Goal[]> => {
  const map = new Map<string, Goal[]>();
  (goals || []).forEach((goal) => {
    const parentId = normalizeGoalId(goal?.parentGoalId);
    if (!parentId) return;
    const existing = map.get(parentId) || [];
    existing.push(goal);
    map.set(parentId, existing);
  });
  return map;
};

export const getGoalAncestors = (goalId: string, goals: Goal[]): Goal[] => {
  const index = buildGoalIndex(goals);
  const ancestors: Goal[] = [];
  const visited = new Set<string>();
  let currentId = normalizeGoalId(goalId);
  while (currentId) {
    const current = index.get(currentId);
    const parentId = normalizeGoalId(current?.parentGoalId);
    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);
    const parent = index.get(parentId);
    if (!parent) break;
    ancestors.push(parent);
    currentId = parentId;
  }
  return ancestors;
};

export const getGoalDescendants = (goalId: string, goals: Goal[]): Goal[] => {
  const childrenMap = getGoalChildrenMap(goals);
  const descendants: Goal[] = [];
  const queue = [...(childrenMap.get(normalizeGoalId(goalId)) || [])];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    const id = normalizeGoalId(next.id);
    if (!id || visited.has(id)) continue;
    visited.add(id);
    descendants.push(next);
    const children = childrenMap.get(id) || [];
    children.forEach((child) => queue.push(child));
  }
  return descendants;
};

export const isLeafGoal = (goalId: string, goals: Goal[]): boolean => {
  const childrenMap = getGoalChildrenMap(goals);
  return (childrenMap.get(normalizeGoalId(goalId)) || []).length === 0;
};

export type LeafGoalSelectionReason =
  | 'none'
  | 'missing'
  | 'leaf'
  | 'auto_descendant'
  | 'ambiguous_parent';

export interface LeafGoalSelectionResult {
  goalId: string | null;
  leafGoal: Goal | null;
  reason: LeafGoalSelectionReason;
  candidateLeafGoals: Goal[];
}

export const getLeafGoals = (goals: Goal[], selectedGoalIds?: Iterable<string>): Goal[] => {
  const selected = selectedGoalIds ? new Set(Array.from(selectedGoalIds, (id) => normalizeGoalId(id)).filter(Boolean)) : null;
  return (goals || []).filter((goal) => {
    const id = normalizeGoalId(goal?.id);
    if (!id) return false;
    if (selected && !selected.has(id)) return false;
    return isLeafGoal(id, goals);
  });
};

export const getLeafGoalOptions = (goals: Goal[], selectedGoalIds?: Iterable<string>): Goal[] => (
  getLeafGoals(goals, selectedGoalIds)
    .slice()
    .sort((a, b) => getGoalDisplayPath(normalizeGoalId(a?.id), goals).localeCompare(getGoalDisplayPath(normalizeGoalId(b?.id), goals)))
);

export const resolveLeafGoalSelection = (goalId: string | null | undefined, goals: Goal[]): LeafGoalSelectionResult => {
  const normalized = normalizeGoalId(goalId);
  if (!normalized) {
    return {
      goalId: null,
      leafGoal: null,
      reason: 'none',
      candidateLeafGoals: [],
    };
  }

  const index = buildGoalIndex(goals);
  const goal = index.get(normalized) || null;
  if (!goal) {
    return {
      goalId: null,
      leafGoal: null,
      reason: 'missing',
      candidateLeafGoals: [],
    };
  }

  if (isLeafGoal(normalized, goals)) {
    return {
      goalId: normalized,
      leafGoal: goal,
      reason: 'leaf',
      candidateLeafGoals: [goal],
    };
  }

  const descendants = getGoalDescendants(normalized, goals).filter((entry) => isLeafGoal(normalizeGoalId(entry?.id), goals));
  if (descendants.length === 1) {
    return {
      goalId: normalizeGoalId(descendants[0]?.id),
      leafGoal: descendants[0] || null,
      reason: 'auto_descendant',
      candidateLeafGoals: descendants,
    };
  }

  return {
    goalId: null,
    leafGoal: null,
    reason: 'ambiguous_parent',
    candidateLeafGoals: descendants,
  };
};

export const expandFocusGoalIdsToLeafGoalIds = (goalIds: Iterable<string>, goals: Goal[]): string[] => {
  const index = buildGoalIndex(goals);
  const expanded = new Set<string>();
  Array.from(goalIds || []).forEach((rawId) => {
    const id = normalizeGoalId(rawId);
    if (!id || !index.has(id)) return;
    if (isLeafGoal(id, goals)) {
      expanded.add(id);
      return;
    }
    const descendants = getGoalDescendants(id, goals).filter((goal) => isLeafGoal(goal.id, goals));
    if (descendants.length === 0) {
      expanded.add(id);
      return;
    }
    descendants.forEach((goal) => expanded.add(normalizeGoalId(goal.id)));
  });
  return Array.from(expanded);
};

export const getGoalDisplayPath = (goalId: string, goals: Goal[]): string => {
  const index = buildGoalIndex(goals);
  const node = index.get(normalizeGoalId(goalId));
  if (!node) return normalizeGoalId(goalId);
  const ancestors = getGoalAncestors(goalId, goals).reverse();
  return [...ancestors.map((goal) => goal.title || goal.id), node.title || node.id].filter(Boolean).join(' > ');
};

export const isGoalInHierarchySet = (
  goalId: string,
  goals: Goal[],
  goalIds: Iterable<string>,
): boolean => {
  const normalized = normalizeGoalId(goalId);
  if (!normalized) return false;
  const idSet = goalIds instanceof Set
    ? goalIds
    : new Set(Array.from(goalIds || [], (id) => normalizeGoalId(id)).filter(Boolean));
  if (idSet.has(normalized)) return true;
  if (getGoalAncestors(normalized, goals).some((goal) => idSet.has(normalizeGoalId(goal.id)))) return true;
  if (getGoalDescendants(normalized, goals).some((goal) => idSet.has(normalizeGoalId(goal.id)))) return true;
  return false;
};

export const getProtectedFocusGoalIds = (focusGoal: FocusGoal): string[] => {
  const ids = new Set<string>();
  const rootIds = Array.isArray(focusGoal?.focusRootGoalIds) ? focusGoal.focusRootGoalIds : [];
  const leafIds = Array.isArray(focusGoal?.focusLeafGoalIds) ? focusGoal.focusLeafGoalIds : [];
  const fallbackIds = Array.isArray(focusGoal?.goalIds) ? focusGoal.goalIds : [];
  [...rootIds, ...leafIds, ...fallbackIds].forEach((id) => {
    const normalized = normalizeGoalId(id);
    if (normalized) ids.add(normalized);
  });
  return Array.from(ids);
};

export const getActiveFocusLeafGoalIds = (focusGoals: FocusGoal[]): Set<string> => {
  const ids = new Set<string>();
  (focusGoals || []).forEach((focusGoal) => {
    const leafIds = Array.isArray(focusGoal?.focusLeafGoalIds) && focusGoal.focusLeafGoalIds.length > 0
      ? focusGoal.focusLeafGoalIds
      : Array.isArray(focusGoal?.goalIds)
        ? focusGoal.goalIds
        : [];
    leafIds.forEach((id) => {
      const normalized = normalizeGoalId(id);
      if (normalized) ids.add(normalized);
    });
  });
  return ids;
};

export const getActiveFocusRootGoalIds = (focusGoals: FocusGoal[]): Set<string> => {
  const ids = new Set<string>();
  (focusGoals || []).forEach((focusGoal) => {
    const rootIds = Array.isArray(focusGoal?.focusRootGoalIds) && focusGoal.focusRootGoalIds.length > 0
      ? focusGoal.focusRootGoalIds
      : Array.isArray(focusGoal?.goalIds)
        ? focusGoal.goalIds
        : [];
    rootIds.forEach((id) => {
      const normalized = normalizeGoalId(id);
      if (normalized) ids.add(normalized);
    });
  });
  return ids;
};
