import { Sprint, Story, Task } from '../types';

type SparseTask = Partial<Task> & { id: string };

const toMillis = (value: any): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'seconds' in value) {
    const seconds = Number((value as any).seconds) || 0;
    const nanos = Number((value as any).nanoseconds ?? 0);
    return seconds * 1000 + Math.round(nanos / 1e6);
  }
  return null;
};

export const findSprintForDate = (sprints: Sprint[], dueDate: number | null): Sprint | null => {
  if (!dueDate) return null;
  return sprints.find((s) => {
    const start = toMillis(s.startDate);
    const end = toMillis(s.endDate);
    if (!start || !end) return false;
    return dueDate >= start && dueDate <= end;
  }) || null;
};

export interface SprintDerivationInput {
  task: SparseTask;
  updates?: Partial<Task>;
  stories: Story[];
  sprints: Sprint[];
}

export interface SprintDerivationResult {
  sprintId: string | null;
  story: Story | undefined;
  dueDateMs: number | null;
}

export const deriveTaskSprint = ({ task, updates = {}, stories, sprints }: SprintDerivationInput): SprintDerivationResult => {
  const storyId = updates.storyId ??
    (updates.parentType === 'story' ? updates.parentId : undefined) ??
    (task.storyId || (task.parentType === 'story' ? task.parentId : undefined));

  const story = storyId ? stories.find((s) => s.id === storyId) : undefined;
  const dueDateMs = toMillis((updates.dueDate as any) ?? task.dueDate ?? null);

  let sprintId: string | null = story?.sprintId ?? (updates.sprintId ?? task.sprintId ?? null) ?? null;

  if (!sprintId && dueDateMs) {
    const matched = findSprintForDate(sprints, dueDateMs);
    if (matched) sprintId = matched.id;
  }

  return { sprintId, story, dueDateMs };
};

export const isDueDateWithinStorySprint = (dueDateMs: number | null, story: Story | undefined, sprints: Sprint[]): boolean => {
  if (!dueDateMs || !story?.sprintId) return true;
  const sprint = sprints.find((s) => s.id === story.sprintId);
  if (!sprint) return true;
  const start = toMillis(sprint.startDate);
  const end = toMillis(sprint.endDate);
  if (!start || !end) return true;
  return dueDateMs >= start && dueDateMs <= end;
};

export const effectiveSprintId = (task: Task, stories: Story[], sprints: Sprint[]): string | null => {
  const story = task.storyId ? stories.find((s) => s.id === task.storyId) : undefined;
  if (story?.sprintId) return story.sprintId;
  if (task.sprintId) return task.sprintId;
  const dueDateMs = toMillis(task.dueDate ?? null);
  const matched = findSprintForDate(sprints, dueDateMs);
  return matched?.id ?? null;
};

export const sprintNameForId = (sprints: Sprint[], sprintId: string | null | undefined): string => {
  if (!sprintId) return '';
  const sprint = sprints.find((s) => s.id === sprintId);
  return sprint?.name || '';
};
