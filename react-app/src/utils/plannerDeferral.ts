import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { schedulePlannerItem, type PlannerConstraintMode, type SchedulePlannerItemResponse } from './plannerScheduling';
import { nextDueAt } from './recurrence';

type PlannerEntityType = 'task' | 'story';
type PlannerBucket = 'morning' | 'afternoon' | 'evening' | 'anytime' | null | undefined;

type PlannerEntityLike = {
  id: string;
  title?: string | null;
  timeOfDay?: string | null;
  estimateMin?: number | null;
  points?: number | null;
};

type RecurringTaskLike = PlannerEntityLike & {
  type?: string | null;
  rrule?: string | null;
  repeatFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  repeatInterval?: number | null;
  dueDate?: number | null;
  dueDateMs?: number | null;
};

const RECURRING_TYPES = new Set(['chore', 'routine', 'habit']);

function isRecurringTask(task: RecurringTaskLike): boolean {
  return RECURRING_TYPES.has(String(task.type || '')) || Boolean(task.rrule || task.repeatFrequency);
}

function computeNextDueMs(task: RecurringTaskLike, afterMs: number): number | null {
  if (task.rrule) {
    const dtstart = task.dueDate ?? task.dueDateMs ?? undefined;
    return nextDueAt(task.rrule, dtstart, afterMs);
  }

  if (!task.repeatFrequency) return null;

  const interval = Math.max(1, Number(task.repeatInterval || 1));
  const base = new Date(afterMs);

  switch (task.repeatFrequency) {
    case 'daily':
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + interval).getTime();
    case 'weekly':
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + interval * 7).getTime();
    case 'monthly':
      return new Date(base.getFullYear(), base.getMonth() + interval, base.getDate()).getTime();
    case 'yearly':
      return new Date(base.getFullYear() + interval, base.getMonth(), base.getDate()).getTime();
    default:
      return null;
  }
}

function halfIntervalMs(freq: string, interval: number, fromMs: number): number {
  switch (freq) {
    case 'daily':
      return fromMs + interval * 12 * 60 * 60 * 1000;
    case 'weekly':
      return fromMs + Math.floor(interval * 3.5) * 24 * 60 * 60 * 1000;
    case 'monthly':
      return fromMs + interval * 15 * 24 * 60 * 60 * 1000;
    case 'yearly': {
      const d = new Date(fromMs);
      return new Date(d.getFullYear(), d.getMonth() + interval * 6, d.getDate()).getTime();
    }
    default:
      return fromMs;
  }
}

function computeQuickDeferMs(task: RecurringTaskLike, fromMs: number): number | null {
  if (task.rrule) {
    const freqMatch = task.rrule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i);
    if (freqMatch) {
      const intervalMatch = task.rrule.match(/INTERVAL=(\d+)/i);
      const freq = freqMatch[1].toLowerCase();
      const interval = intervalMatch ? Math.max(1, parseInt(intervalMatch[1], 10)) : 1;
      return halfIntervalMs(freq, interval, fromMs);
    }
    // No FREQ in rrule — fall back to full next occurrence
    return computeNextDueMs(task, fromMs);
  }

  if (!task.repeatFrequency) return null;

  const interval = Math.max(1, Number(task.repeatInterval || 1));
  return halfIntervalMs(task.repeatFrequency, interval, fromMs);
}

export interface ChoreQuickDeferResult {
  ok: boolean;
  nextDueMs: number | null;
}

/**
 * Client-side defer for chores, routines, and habits.
 * Skips the schedulePlannerItem cloud function entirely — computes next
 * occurrence locally from rrule or repeatFrequency/repeatInterval and
 * writes straight to Firestore. Fast path for high-frequency recurring tasks.
 */
export async function applyChoreQuickDefer(
  task: RecurringTaskLike,
  source: string,
  rationale?: string | null,
): Promise<ChoreQuickDeferResult> {
  const now = Date.now();
  const nextDueMs = computeQuickDeferMs(task, now);
  const ref = doc(db, 'tasks', task.id);

  await updateDoc(ref, {
    ...(nextDueMs != null ? { dueDate: nextDueMs, dueDateMs: nextDueMs } : {}),
    deferredUntil: nextDueMs ?? now,
    deferredReason: rationale || 'quick_defer',
    deferredBy: source || 'chore_quick_defer',
    deferredAt: now,
    updatedAt: serverTimestamp(),
  });

  return { ok: true, nextDueMs };
}

export { isRecurringTask };

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
  sprintStartMs?: number;
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
  try {
    return await schedulePlannerItem({
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
      constraintMode: payload.constraintMode || 'free_slot',
      exactTargetStartMs: payload.exactTargetStartMs || null,
      exactTargetEndMs: payload.exactTargetEndMs || null,
      allowSplit: true,
      searchDays: 21,
    });
  } catch (err: any) {
    const code = String(err?.code || '').replace(/^functions\//, '');
    // Cloud function couldn't find a free slot — fall back to a direct Firestore write
    // so the user's intent is captured even without a calendar placement.
    if (code === 'failed-precondition' || code === 'internal') {
      const coll = itemType === 'story' ? 'stories' : 'tasks';
      const ref = doc(db, coll, item.id);
      await updateDoc(ref, {
        deferredUntil: payload.dateMs,
        deferredReason: payload.rationale || null,
        deferredBy: payload.source || sourceFallback || 'planner_defer',
        updatedAt: serverTimestamp(),
      });
      return {
        ok: true,
        planningMode: 'smart',
        appliedStartMs: payload.dateMs,
        appliedEndMs: payload.dateMs,
        appliedDayMs: payload.dateMs,
        appliedBucket: payload.targetBucket ?? null,
        sprintId: targetSprintId,
        blockId: null,
      };
    }
    throw err;
  }
}

export async function applyStoryDueDate(storyId: string, dueDateMs: number): Promise<void> {
  await updateDoc(doc(db, 'stories', storyId), {
    dueDate: dueDateMs,
    updatedAt: Date.now(),
  });
}

/**
 * Move a story or task to a specific sprint via a direct Firestore update.
 * Does NOT call schedulePlannerItem — that Cloud Function tries to find a
 * calendar slot which is both unnecessary for sprint reassignment and
 * fails when the calendar is fully booked (400 failed-precondition).
 */
export async function applyPlannerMoveToSprint({
  itemType,
  item,
  sprintId,
  rationale,
  source,
}: ApplyPlannerMoveToSprintArgs): Promise<SchedulePlannerItemResponse> {
  const collection = itemType === 'story' ? 'stories' : 'tasks';
  const ref = doc(db, collection, item.id);
  await updateDoc(ref, {
    sprintId,
    deferredUntil: null,
    deferredReason: rationale || null,
    deferredBy: source || 'planner_move',
    updatedAt: serverTimestamp(),
  });
  return {
    ok: true,
    planningMode: 'smart',
    appliedStartMs: Date.now(),
    appliedEndMs: Date.now(),
    appliedDayMs: Date.now(),
    appliedBucket: null,
    sprintId,
    blockId: null,
  };
}
