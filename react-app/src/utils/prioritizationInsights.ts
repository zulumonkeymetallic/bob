import type { Goal, Story, Task } from '../types';
import { getGoalAncestors } from './goalHierarchy';

export interface CapacitySummaryLike {
  total?: number;
  allocated?: number;
  free?: number;
  utilization?: number;
}

export interface SprintLike {
  id: string;
  name?: string;
  startDate?: number | string | null;
}

export interface DeferRecommendation {
  id: string;
  type: 'task' | 'story';
  title: string;
  effortHours: number;
  keepScore: number;
  rationale: string;
  nextSprintId?: string | null;
  nextSprintStartMs?: number | null;
  alignedToFocus: boolean;
}

const isDone = (value: any, type: 'task' | 'story'): boolean => {
  if (typeof value === 'number') {
    return type === 'task' ? value === 2 || value >= 4 : value >= 4;
  }
  const normalized = String(value || '').trim().toLowerCase();
  return ['done', 'complete', 'completed', 'closed', 'finished', 'archived'].includes(normalized);
};

const toMs = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') {
    try {
      return Number(value.toMillis());
    } catch {
      return null;
    }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const estimateHours = (entity: Task | Story): number => {
  const estimateMin = Number((entity as any).estimateMin || 0);
  if (Number.isFinite(estimateMin) && estimateMin > 0) return Math.max(0.25, estimateMin / 60);
  const points = Number((entity as any).points || 0);
  if (Number.isFinite(points) && points > 0) return Math.max(0.5, points * 2);
  return 1;
};

const priorityBoost = (priority: any): number => {
  const value = Number(priority || 0);
  if (value >= 4) return 25;
  if (value === 3) return 18;
  if (value === 2) return 10;
  if (value === 1) return 4;
  return 0;
};

const keepScoreFor = (entity: Task | Story, focusGoalIds: Set<string>, goalMap: Map<string, Goal>): { keepScore: number; rationaleBits: string[] } => {
  const aiScore = Number((entity as any).aiCriticalityScore || 0);
  const dueMs = toMs((entity as any).dueDate ?? (entity as any).targetDate);
  const nowMs = Date.now();
  const dueSoonBoost = dueMs && dueMs <= nowMs + (2 * 24 * 60 * 60 * 1000) ? 15 : 0;
  const overdueBoost = dueMs && dueMs < nowMs ? 18 : 0;
  const top3Boost = (entity as any).aiTop3ForDay === true ? 35 : 0;
  const inProgressBoost = Number((entity as any).status || 0) === 1 || Number((entity as any).status || 0) === 2 ? 8 : 0;
  const goalId = String((entity as any).goalId || '').trim();
  const alignedToFocus = !!goalId && (
    focusGoalIds.has(goalId)
    || getGoalAncestors(goalId, Array.from(goalMap.values())).some((goal) => focusGoalIds.has(goal.id))
  );
  const focusBoost = alignedToFocus ? 25 : 0;
  const goal = goalId ? goalMap.get(goalId) : null;
  const goalStoryBoost = goal && Number(goal.status || 0) === 1 ? 4 : 0;

  const keepScore = aiScore + priorityBoost((entity as any).priority) + dueSoonBoost + overdueBoost + top3Boost + inProgressBoost + focusBoost + goalStoryBoost;
  const rationaleBits = [
    alignedToFocus ? 'Focus-aligned work should stay' : 'Not linked to an active focus goal',
    aiScore > 0 ? `AI score ${Math.round(aiScore)}` : 'No AI score boost',
    dueSoonBoost > 0 || overdueBoost > 0 ? 'Due soon' : 'No near-term due pressure',
    top3Boost > 0 ? 'Already in Top 3' : null,
  ].filter(Boolean) as string[];

  return { keepScore, rationaleBits };
};

export function buildSprintDeferRecommendations(options: {
  goals: Goal[];
  stories: Story[];
  tasks: Task[];
  activeFocusGoalIds?: Set<string>;
  selectedSprintId?: string | null;
  nextSprint?: SprintLike | null;
  capacitySummary?: CapacitySummaryLike | null;
}): {
  overCapacityHours: number;
  recommended: DeferRecommendation[];
  totalCandidateHours: number;
} {
  const {
    goals,
    stories,
    tasks,
    activeFocusGoalIds = new Set<string>(),
    selectedSprintId = null,
    nextSprint = null,
    capacitySummary = null,
  } = options;

  const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
  const overCapacityHours = Math.max(0, Number(capacitySummary?.allocated || 0) - Number(capacitySummary?.total || 0));
  const nextSprintStartMs = toMs(nextSprint?.startDate ?? null);

  const storyCandidates = stories
    .filter((story) => !isDone(story.status, 'story'))
    .filter((story) => !selectedSprintId || String(story.sprintId || '') === String(selectedSprintId))
    .map((story) => {
      const effortHours = estimateHours(story);
      const { keepScore, rationaleBits } = keepScoreFor(story, activeFocusGoalIds, goalMap);
      return {
        id: story.id,
        type: 'story' as const,
        title: story.title,
        effortHours,
        keepScore,
        rationale: `${rationaleBits.join(' · ')} · frees ~${effortHours.toFixed(1)}h`,
        nextSprintId: nextSprint?.id || null,
        nextSprintStartMs,
        alignedToFocus: !!String(story.goalId || '').trim() && (
          activeFocusGoalIds.has(String(story.goalId || '').trim())
          || getGoalAncestors(String(story.goalId || '').trim(), goals).some((goal) => activeFocusGoalIds.has(goal.id))
        ),
      };
    });

  const standaloneTaskCandidates = tasks
    .filter((task) => !isDone(task.status, 'task'))
    .filter((task) => !['habit', 'routine', 'chore'].includes(String(task.type || '').toLowerCase()))
    .filter((task) => !String(task.storyId || '').trim())
    .filter((task) => !selectedSprintId || String(task.sprintId || '') === String(selectedSprintId))
    .map((task) => {
      const effortHours = estimateHours(task);
      const { keepScore, rationaleBits } = keepScoreFor(task, activeFocusGoalIds, goalMap);
      return {
        id: task.id,
        type: 'task' as const,
        title: task.title,
        effortHours,
        keepScore,
        rationale: `${rationaleBits.join(' · ')} · frees ~${effortHours.toFixed(1)}h`,
        nextSprintId: nextSprint?.id || null,
        nextSprintStartMs,
        alignedToFocus: !!String(task.goalId || '').trim() && (
          activeFocusGoalIds.has(String(task.goalId || '').trim())
          || getGoalAncestors(String(task.goalId || '').trim(), goals).some((goal) => activeFocusGoalIds.has(goal.id))
        ),
      };
    });

  const candidates = [...storyCandidates, ...standaloneTaskCandidates]
    .sort((a, b) => {
      if (a.alignedToFocus !== b.alignedToFocus) return Number(a.alignedToFocus) - Number(b.alignedToFocus);
      const aDensity = a.keepScore / Math.max(a.effortHours, 0.25);
      const bDensity = b.keepScore / Math.max(b.effortHours, 0.25);
      if (aDensity !== bDensity) return aDensity - bDensity;
      return a.keepScore - b.keepScore;
    });

  const targetHours = overCapacityHours > 0 ? overCapacityHours : 3;
  const recommended: DeferRecommendation[] = [];
  let recovered = 0;
  for (const candidate of candidates) {
    recommended.push(candidate);
    recovered += candidate.effortHours;
    if (recovered >= targetHours && recommended.length >= 2) break;
    if (recommended.length >= 4) break;
  }

  return {
    overCapacityHours,
    recommended,
    totalCandidateHours: candidates.reduce((sum, candidate) => sum + candidate.effortHours, 0),
  };
}
