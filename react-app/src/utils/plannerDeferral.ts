import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { schedulePlannerItem, type PlannerConstraintMode, type SchedulePlannerItemResponse } from './plannerScheduling';

type PlannerEntityType = 'task' | 'story';
type PlannerBucket = 'morning' | 'afternoon' | 'evening' | 'anytime' | null | undefined;

type PlannerEntityLike = {
  id: string;
  title?: string | null;
  timeOfDay?: string | null;
  estimateMin?: number | null;
  points?: number | null;
};

export interface PlannerDeferPayload {
  dateMs: number;
  rationale: string;
  source: string;
  targetBucket?: PlannerBucket;
  constraintMode?: PlannerConstraintMode | null;
  exactTargetStartMs?: number | null;
  exactTargetEndMs?: number | null;
}

interface ApplyPlannerDeferArgs {
  itemType: PlannerEntityType;
  item: PlannerEntityLike;
  payload: PlannerDeferPayload;
  sourceFallback: string;
  linkedBlockId?: string | null;
  targetSprintId?: string | null;
  durationMinutes?: number | null;
}

interface ApplyPlannerMoveToSprintArgs {
  itemType: PlannerEntityType;
  item: PlannerEntityLike;
  sprintId: string;
  sprintStartMs: number;
  rationale: string;
  source: string;
  durationMinutes?: number | null;
}

export function inferPlannerDurationMinutes(itemType: PlannerEntityType, item: PlannerEntityLike | null | undefined, fallbackMinutes?: number | null): number {
  const directFallback = Number(fallbackMinutes || 0);
  if (Number.isFinite(directFallback) && directFallback >= 15) return Math.round(directFallback);

  const estimateMin = Number(item?.estimateMin || 0);
  if (Number.isFinite(estimateMin) && estimateMin >= 15) return Math.round(estimateMin);

  const points = Number(item?.points || 0);
  if (Number.isFinite(points) && points > 0) {
    return Math.max(15, Math.round(points * 60));
  }

  return itemType === 'story' ? 60 : 30;
}

export async function applyPlannerDefer({
  itemType,
  item,
  payload,
  sourceFallback,
  linkedBlockId = null,
  targetSprintId = null,
  durationMinutes = null,
}: ApplyPlannerDeferArgs): Promise<SchedulePlannerItemResponse> {
  return schedulePlannerItem({
    itemType,
    itemId: item.id,
    targetDateMs: payload.dateMs,
    targetBucket: payload.targetBucket ?? (item.timeOfDay as PlannerBucket) ?? null,
    intent: 'defer',
    source: payload.source || sourceFallback,
    rationale: payload.rationale || null,
    linkedBlockId,
    targetSprintId,
    durationMinutes: inferPlannerDurationMinutes(itemType, item, durationMinutes),
    constraintMode: payload.constraintMode || null,
    exactTargetStartMs: payload.exactTargetStartMs || null,
    exactTargetEndMs: payload.exactTargetEndMs || null,
  });
}

/**
 * Sets dueDate on a focus-aligned story so the nightly planner schedules it
 * at Tier 5 (after top-3 and manual priority items).
 */
export async function applyStoryDueDate(storyId: string, dueDateMs: number): Promise<void> {
  await updateDoc(doc(db, 'stories', storyId), {
    dueDate: dueDateMs,
    updatedAt: Date.now(),
  });
}

export async function applyPlannerMoveToSprint({
  itemType,
  item,
  sprintId,
  sprintStartMs,
  rationale,
  source,
  durationMinutes = null,
}: ApplyPlannerMoveToSprintArgs): Promise<SchedulePlannerItemResponse> {
  return schedulePlannerItem({
    itemType,
    itemId: item.id,
    targetDateMs: sprintStartMs,
    targetBucket: (item.timeOfDay as PlannerBucket) ?? null,
    intent: 'defer',
    source,
    rationale,
    targetSprintId: sprintId,
    durationMinutes: inferPlannerDurationMinutes(itemType, item, durationMinutes),
  });
}
