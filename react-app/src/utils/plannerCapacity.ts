import type { Goal, Sprint, Story, Task } from '../types';
import type { PlannerItem } from './plannerItems';
import { isGoalInHierarchySet } from './goalHierarchy';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CapacitySummary {
  capacityPoints: number;
  plannedPoints: number;
  remainingPoints: number;
  utilizationPct: number;
  overCapacity: boolean;
  focusAlignedPoints: number;
  nonFocusPoints: number;
}

const clampCapacity = (value: number, fallback: number) => {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Number(value));
};

export const taskPoints = (task: Task | any): number => {
  const direct = Number(task?.points || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const mins = Number(task?.estimateMin || 0);
  if (Number.isFinite(mins) && mins > 0) return Math.max(0.25, mins / 60);
  return 1;
};

export const storyPoints = (story: Story | any): number => {
  const direct = Number(story?.points || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 1;
};

export const plannerItemPoints = (item: PlannerItem): number => {
  if (Array.isArray(item.childItems) && item.childItems.length > 0) {
    return item.childItems.reduce((sum, child) => sum + plannerItemPoints(child), 0);
  }
  if (item.scheduledBlockStart && item.scheduledBlockEnd && item.scheduledBlockEnd > item.scheduledBlockStart) {
    return Math.max(0.25, (item.scheduledBlockEnd - item.scheduledBlockStart) / (60 * 60 * 1000));
  }
  if (item.rawTask) return taskPoints(item.rawTask);
  if (item.rawStory) return storyPoints(item.rawStory);
  return item.kind === 'story' ? 2 : 1;
};

export const summarizeCapacity = (
  points: number[],
  capacityPoints: number,
  focusPoints: number[] = [],
): CapacitySummary => {
  const plannedPoints = points.reduce((sum, value) => sum + value, 0);
  const focusAlignedPoints = focusPoints.reduce((sum, value) => sum + value, 0);
  const safeCapacity = clampCapacity(capacityPoints, 1);
  const remainingPoints = safeCapacity - plannedPoints;
  const utilizationPct = Math.round((plannedPoints / safeCapacity) * 100);
  return {
    capacityPoints: safeCapacity,
    plannedPoints,
    remainingPoints,
    utilizationPct,
    overCapacity: remainingPoints < 0,
    focusAlignedPoints,
    nonFocusPoints: Math.max(0, plannedPoints - focusAlignedPoints),
  };
};

export const buildDayCapacityMap = (
  dayKeys: string[],
  items: PlannerItem[],
  capacityPointsPerDay = 8,
) => {
  const grouped = new Map<string, PlannerItem[]>();
  dayKeys.forEach((dayKey) => grouped.set(dayKey, []));
  items.forEach((item) => {
    const existing = grouped.get(item.dayKey) || [];
    existing.push(item);
    grouped.set(item.dayKey, existing);
  });
  const summary = new Map<string, CapacitySummary>();
  dayKeys.forEach((dayKey) => {
    const dayItems = grouped.get(dayKey) || [];
    summary.set(
      dayKey,
      summarizeCapacity(
        dayItems.map((item) => plannerItemPoints(item)),
        capacityPointsPerDay,
        dayItems.filter((item) => item.isFocusAligned).map((item) => plannerItemPoints(item)),
      ),
    );
  });
  return summary;
};

export const deriveSprintCapacityPoints = (
  sprint: Sprint | null | undefined,
  weeklyCapacityPoints = 20,
) => {
  const explicit = Number((sprint as any)?.capacityPoints || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const startMs = Number((sprint as any)?.startDate || 0);
  const endMs = Number((sprint as any)?.endDate || 0);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
    const sprintWeeks = Math.max(1, Math.ceil((endMs - startMs + DAY_MS) / (7 * DAY_MS)));
    return sprintWeeks * weeklyCapacityPoints;
  }
  return weeklyCapacityPoints;
};

export const buildSprintCapacitySummary = ({
  sprint,
  stories,
  goals,
  activeFocusGoalIds,
  weeklyCapacityPoints = 20,
}: {
  sprint: Sprint | null | undefined;
  stories: Story[];
  goals: Goal[];
  activeFocusGoalIds: Set<string>;
  weeklyCapacityPoints?: number;
}) => {
  const focusPoints = stories
    .filter((story) => {
      const goalId = String(story.goalId || '').trim();
      return !!goalId && isGoalInHierarchySet(goalId, goals, activeFocusGoalIds);
    })
    .map((story) => storyPoints(story));
  return summarizeCapacity(
    stories.map((story) => storyPoints(story)),
    deriveSprintCapacityPoints(sprint, weeklyCapacityPoints),
    focusPoints,
  );
};

export const findSprintForDate = (sprints: Sprint[], dateMs: number): Sprint | null => {
  const exact = sprints.find((sprint) => {
    const startMs = Number((sprint as any)?.startDate || 0);
    const endMs = Number((sprint as any)?.endDate || 0);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && dateMs >= startMs && dateMs <= endMs;
  });
  if (exact) return exact;
  return [...sprints]
    .filter((sprint) => Number((sprint as any)?.startDate || 0) >= dateMs)
    .sort((a, b) => Number((a as any)?.startDate || 0) - Number((b as any)?.startDate || 0))[0] || null;
};
