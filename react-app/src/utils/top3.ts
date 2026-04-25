import type { Story, Task } from '../types';
import { getManualPriorityRank } from './manualPriority';

const normalizeRank = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 99;
};

const normalizeAiScore = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : -Infinity;
};

export const top3DateForToday = () => new Date().toISOString().slice(0, 10);

export const isCurrentTop3Flag = (value: any, todayIso: string = top3DateForToday()): boolean => {
  if (value?.aiTop3ForDay !== true) return false;
  const top3Date = String(value?.aiTop3Date || '').trim();
  if (!top3Date) return true;
  return top3Date.slice(0, 10) === todayIso;
};

export const getStoryTop3Rank = (story: Story): number => normalizeRank((story as any)?.aiFocusStoryRank);

export const getTaskTop3Rank = (task: Task): number => normalizeRank((task as any)?.aiPriorityRank);

export const getEntityAiScore = (entity: Story | Task): number => (
  normalizeAiScore(
    (entity as any)?.metadata?.aiScore
    ?? (entity as any)?.metadata?.aiCriticalityScore
    ?? (entity as any)?.aiCriticalityScore
    ?? (entity as any)?.aiPriorityScore
    ?? null,
  )
);

export const isTop3Story = (story: Story, todayIso: string = top3DateForToday()): boolean => {
  return Boolean(getManualPriorityRank(story)) || isCurrentTop3Flag(story, todayIso);
};

export const isTop3Task = (
  task: Task,
  getManualRank?: (task: Task) => number | null,
  todayIso: string = top3DateForToday(),
): boolean => {
  return Boolean(getManualRank ? getManualRank(task) : getManualPriorityRank(task)) || isCurrentTop3Flag(task, todayIso);
};

export const compareTop3Stories = (a: Story, b: Story): number => {
  const manualA = getManualPriorityRank(a) || 99;
  const manualB = getManualPriorityRank(b) || 99;
  if (manualA !== manualB) return manualA - manualB;
  const rankA = getStoryTop3Rank(a);
  const rankB = getStoryTop3Rank(b);
  if (rankA !== rankB) return rankA - rankB;
  const scoreA = getEntityAiScore(a);
  const scoreB = getEntityAiScore(b);
  if (scoreA !== scoreB) return scoreB - scoreA;
  return String(a.title || '').localeCompare(String(b.title || ''));
};

export const compareTop3Tasks = (
  a: Task,
  b: Task,
  getManualRank?: (task: Task) => number | null,
): number => {
  const manualA = (getManualRank ? getManualRank(a) : getManualPriorityRank(a)) || 99;
  const manualB = (getManualRank ? getManualRank(b) : getManualPriorityRank(b)) || 99;
  if (manualA !== manualB) return manualA - manualB;
  const rankA = getTaskTop3Rank(a);
  const rankB = getTaskTop3Rank(b);
  if (rankA !== rankB) return rankA - rankB;
  const scoreA = getEntityAiScore(a);
  const scoreB = getEntityAiScore(b);
  if (scoreA !== scoreB) return scoreB - scoreA;
  return String(a.title || '').localeCompare(String(b.title || ''));
};
