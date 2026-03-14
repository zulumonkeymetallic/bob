import type { Sprint, Story, Task } from '../../types';

const DAY_MS = 86400000;

export type PlannerZoomLevel = 'weeks' | 'months' | 'quarters' | 'years';

export interface GoalTimelineAffectedStory {
  id: string;
  ref: string;
  title: string;
  plannedSprintId?: string;
  plannedSprintName?: string;
  recommendedSprintId?: string;
  recommendedSprintName?: string;
  impactedTaskCount: number;
}

export interface GoalTimelineImpactPlan {
  affectedStories: GoalTimelineAffectedStory[];
  affectedTaskIds: string[];
}

function toMillis(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function quarterMedianMonthStart(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth + 1, 1);
}

export function snapPlannerGoalMoveRange(startDate: Date, endDate: Date, zoom: PlannerZoomLevel) {
  const safeStart = startOfDay(startDate);
  const safeEnd = startOfDay(endDate);
  const durationMs = Math.max(DAY_MS, safeEnd.getTime() - safeStart.getTime());

  if (zoom === 'months') {
    const snappedStart = startOfMonth(safeStart);
    return {
      start: snappedStart,
      end: new Date(snappedStart.getTime() + durationMs),
    };
  }

  if (zoom === 'quarters') {
    const snappedStart = quarterMedianMonthStart(safeStart);
    return {
      start: snappedStart,
      end: new Date(snappedStart.getTime() + durationMs),
    };
  }

  return {
    start: safeStart,
    end: safeEnd,
  };
}

function pickRecommendedSprint(sprints: Sprint[], targetStartMs: number, currentSprintId?: string) {
  const eligible = sprints
    .map((sprint) => ({
      sprint,
      startMs: toMillis(sprint.startDate),
      endMs: toMillis(sprint.endDate),
      status: Number((sprint as any)?.status ?? 0),
    }))
    .filter((item) => item.startMs != null && item.endMs != null && item.status !== 2 && item.status !== 3);

  if (!eligible.length) return null;

  const sorted = [...eligible].sort((a, b) => {
    const aFutureBias = (a.startMs as number) >= targetStartMs ? 0 : 1;
    const bFutureBias = (b.startMs as number) >= targetStartMs ? 0 : 1;
    if (aFutureBias !== bFutureBias) return aFutureBias - bFutureBias;
    const aDistance = Math.abs((a.startMs as number) - targetStartMs);
    const bDistance = Math.abs((b.startMs as number) - targetStartMs);
    return aDistance - bDistance;
  });

  const best = sorted[0]?.sprint ?? null;
  if (!best) return null;
  if (best.id === currentSprintId) return null;
  return best;
}

export function buildGoalTimelineImpactPlan(args: {
  goalId: string;
  newStartDate: Date;
  newEndDate: Date;
  stories: Story[];
  tasks: Task[];
  sprints: Sprint[];
}): GoalTimelineImpactPlan {
  const { goalId, newStartDate, newEndDate, stories, tasks, sprints } = args;
  const affectedTaskIds = new Set<string>();
  const affectedStories: GoalTimelineAffectedStory[] = [];

  const goalStories = stories.filter((story) => story.goalId === goalId);
  for (const story of goalStories) {
    const sprint = sprints.find((candidate) => candidate.id === story.sprintId);
    if (!sprint) continue;

    const sprintStartMs = toMillis(sprint.startDate);
    const sprintEndMs = toMillis(sprint.endDate);
    if (sprintStartMs == null || sprintEndMs == null) continue;

    const sprintStart = new Date(sprintStartMs);
    const sprintEnd = new Date(sprintEndMs);
    const stillFitsCurrentSprint = !(newStartDate > sprintEnd || newEndDate < sprintStart);
    if (stillFitsCurrentSprint) continue;

    const storyTasks = tasks.filter((task) => task.parentType === 'story' && task.parentId === story.id);
    storyTasks.forEach((task) => affectedTaskIds.add(task.id));

    const recommendedSprint = pickRecommendedSprint(sprints, newStartDate.getTime(), sprint.id);
    affectedStories.push({
      id: story.id,
      ref: String((story as any).ref || story.id),
      title: story.title,
      plannedSprintId: sprint.id,
      plannedSprintName: sprint.name,
      recommendedSprintId: recommendedSprint?.id,
      recommendedSprintName: recommendedSprint?.name,
      impactedTaskCount: storyTasks.length,
    });
  }

  return {
    affectedStories,
    affectedTaskIds: Array.from(affectedTaskIds),
  };
}