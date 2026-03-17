import type { Sprint, Task } from '../types';
import type { PlannerItem } from './plannerItems';
import type { TimelineBucket } from './timelineBuckets';
import { bucketLabel } from './timelineBuckets';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlannerRecommendation {
  action: 'keep_week' | 'move_day' | 'next_sprint' | 'next_recurrence';
  label: string;
  rationale: string;
  targetDateMs?: number | null;
  targetBucket?: TimelineBucket | null;
}

const startOfDayMs = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const titleForDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const normaliseRecurringFrequency = (data: any) => {
  const direct = String(data?.repeatFrequency || data?.recurrence?.frequency || data?.recurrence?.freq || '').trim().toLowerCase();
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(direct)) return direct;
  const rrule = String(data?.rrule || '').toUpperCase();
  if (rrule.includes('DAILY')) return 'daily';
  if (rrule.includes('WEEKLY')) return 'weekly';
  if (rrule.includes('MONTHLY')) return 'monthly';
  if (rrule.includes('YEARLY') || rrule.includes('ANNUAL')) return 'yearly';
  return null;
};

export const recurrenceAwareDeferDays = (data: Task | any) => {
  const frequency = normaliseRecurringFrequency(data);
  if (!frequency) return null;
  const interval = Math.max(1, Number(data?.repeatInterval || data?.recurrence?.interval || 1) || 1);
  if (frequency === 'daily') return interval;
  if (frequency === 'weekly') return 7 * interval;
  if (frequency === 'monthly') return 14 * interval;
  if (frequency === 'yearly') return 60 * interval;
  return null;
};

interface BuildParams {
  item: PlannerItem;
  weekStartMs: number;
  weekEndMs: number;
  dailyLoadHours: Map<string, number>;
  nextSprint: Sprint | null;
  dailyCapacityHours?: number;
}

export const buildPlannerRecommendation = ({
  item,
  weekStartMs,
  weekEndMs,
  dailyLoadHours,
  nextSprint,
  dailyCapacityHours = 8,
}: BuildParams): PlannerRecommendation => {
  const parsedDayMs = Date.parse(`${item.dayKey}T12:00:00`);
  const itemDayMs = startOfDayMs(item.dueAt ?? (Number.isNaN(parsedDayMs) ? weekStartMs : parsedDayMs));
  const thisDayKey = new Date(itemDayMs).toISOString().slice(0, 10);
  const thisDayLoad = Number(dailyLoadHours.get(thisDayKey) || 0);
  const weekLoads: Array<{ dayMs: number; dayKey: string; load: number }> = [];
  for (let cursor = weekStartMs; cursor <= weekEndMs; cursor += DAY_MS) {
    const dayMs = startOfDayMs(cursor);
    const dayKey = new Date(dayMs).toISOString().slice(0, 10);
    weekLoads.push({ dayMs, dayKey, load: Number(dailyLoadHours.get(dayKey) || 0) });
  }
  const lowestLoad = [...weekLoads].sort((a, b) => {
    if (a.load !== b.load) return a.load - b.load;
    return a.dayMs - b.dayMs;
  })[0] || null;
  const isOverCapacity = thisDayLoad > dailyCapacityHours;

  if (item.kind === 'chore' && item.rawTask) {
    const recurrenceDays = recurrenceAwareDeferDays(item.rawTask);
    if (recurrenceDays != null) {
      const targetDateMs = itemDayMs + recurrenceDays * DAY_MS;
      return {
        action: 'next_recurrence',
        label: 'Defer to next recurrence',
        rationale: `Matches the ${String(item.rawTask.type || 'recurring').toLowerCase()} cadence and keeps the schedule aligned.`,
        targetDateMs,
        targetBucket: item.timeOfDay,
      };
    }
  }

  if (!item.isFocusAligned && !item.isTop3 && nextSprint?.startDate) {
    return {
      action: 'next_sprint',
      label: `Move to next sprint`,
      rationale: 'Outside active focus goals and this protects current sprint capacity.',
      targetDateMs: Number(nextSprint.startDate),
      targetBucket: item.timeOfDay,
    };
  }

  if (lowestLoad && (isOverCapacity || lowestLoad.dayKey !== thisDayKey) && lowestLoad.load + 1 < thisDayLoad) {
    const targetBucket = item.timeOfDay || 'morning';
    return {
      action: 'move_day',
      label: `Move to ${titleForDay(lowestLoad.dayMs)} ${bucketLabel(targetBucket).toLowerCase()}`,
      rationale: `Best low-load day is ${titleForDay(lowestLoad.dayMs)} at about ${lowestLoad.load.toFixed(1)} planned hours.`,
      targetDateMs: lowestLoad.dayMs,
      targetBucket,
    };
  }

  return {
    action: 'keep_week',
    label: 'Keep this week',
    rationale: item.isFocusAligned
      ? 'Aligned to an active focus goal and fits this week.'
      : 'Current week capacity can absorb this item.',
    targetDateMs: itemDayMs,
    targetBucket: item.timeOfDay,
  };
};
