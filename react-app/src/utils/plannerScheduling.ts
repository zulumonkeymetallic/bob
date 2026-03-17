import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export type PlannerScheduleIntent = 'move' | 'defer';

export interface SchedulePlannerItemRequest {
  itemType: 'task' | 'story';
  itemId: string;
  targetDateMs: number;
  targetBucket?: 'morning' | 'afternoon' | 'evening' | 'anytime' | null;
  intent?: PlannerScheduleIntent;
  source?: string;
  rationale?: string | null;
  linkedBlockId?: string | null;
  targetSprintId?: string | null;
  durationMinutes?: number | null;
  planningMode?: 'smart' | 'strict' | null;
  searchDays?: number | null;
  maxTargetDateMs?: number | null;
  allowSplit?: boolean;
  debugRequestId?: string | null;
}

export interface SchedulePlannerItemResponse {
  ok: boolean;
  debugRequestId?: string | null;
  planningMode: 'smart' | 'strict';
  appliedStartMs: number;
  appliedEndMs: number;
  appliedDayMs: number;
  appliedBucket: 'morning' | 'afternoon' | 'evening' | 'anytime' | null;
  appliedWeekKey?: string | null;
  appliedWeekStartMs?: number | null;
  scheduledMinutes?: number;
  blockCount?: number;
  sprintId: string | null;
  blockId: string | null;
}

export interface PlannerScheduleErrorInfo {
  code: string;
  rawMessage: string;
  message: string;
}

export function normalizePlannerSchedulingError(error: any): PlannerScheduleErrorInfo {
  const rawCode = String(error?.code || '').replace(/^functions\//, '').trim();
  const rawMessage = String(error?.message || '').trim();
  const detailsMessage = String(error?.details?.message || error?.details || '').trim();
  const lowerMessage = rawMessage.toLowerCase();
  const lowerDetails = detailsMessage.toLowerCase();
  const code = rawCode || 'unknown';

  if (rawMessage && rawMessage !== 'internal' && rawMessage !== 'unknown' && rawMessage !== rawCode) {
    return {
      code,
      rawMessage,
      message: rawMessage,
    };
  }

  if (detailsMessage && detailsMessage !== 'internal' && detailsMessage !== 'unknown') {
    return {
      code,
      rawMessage: detailsMessage,
      message: detailsMessage,
    };
  }

  if (code === 'permission-denied' || lowerMessage.includes('permission denied')) {
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: 'The planner could not update this item because you do not have permission to edit it.',
    };
  }

  if (code === 'unauthenticated') {
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: 'You need to sign in again before deferring or moving this item.',
    };
  }

  if (code === 'invalid-argument') {
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: 'The planner request was incomplete. Refresh the page and try again.',
    };
  }

  if (
    code === 'failed-precondition' ||
    code === 'internal' ||
    lowerMessage === 'internal' ||
    lowerMessage === 'unknown' ||
    lowerDetails === 'internal' ||
    lowerDetails === 'unknown'
  ) {
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: 'The planner could not place this item automatically. This usually means the suggested date conflicts with existing calendar blocks, sprint limits, or another scheduling constraint.',
    };
  }

  return {
    code,
    rawMessage: rawMessage || detailsMessage || code,
    message: rawMessage || detailsMessage || 'The planner could not update this item.',
  };
}

const createPlannerDebugRequestId = () => (
  `planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

export async function schedulePlannerItem(
  payload: SchedulePlannerItemRequest,
): Promise<SchedulePlannerItemResponse> {
  const callable = httpsCallable<SchedulePlannerItemRequest, SchedulePlannerItemResponse>(functions, 'schedulePlannerItem');
  const requestPayload: SchedulePlannerItemRequest = {
    ...payload,
    debugRequestId: payload.debugRequestId || createPlannerDebugRequestId(),
  };
  try {
    console.info('[plannerScheduling] request', {
      debugRequestId: requestPayload.debugRequestId,
      itemType: requestPayload.itemType,
      itemId: requestPayload.itemId,
      intent: requestPayload.intent || 'move',
      source: requestPayload.source || 'planner',
      targetDateMs: requestPayload.targetDateMs,
      targetBucket: requestPayload.targetBucket || null,
      linkedBlockId: requestPayload.linkedBlockId || null,
      targetSprintId: requestPayload.targetSprintId || null,
    });
    const response = await callable(requestPayload);
    console.info('[plannerScheduling] success', {
      debugRequestId: requestPayload.debugRequestId,
      itemType: requestPayload.itemType,
      itemId: requestPayload.itemId,
      result: response.data,
    });
    return {
      ...response.data,
      debugRequestId: response.data?.debugRequestId || requestPayload.debugRequestId || null,
    };
  } catch (error: any) {
    const normalized = normalizePlannerSchedulingError(error);
    console.error('[plannerScheduling] failure', {
      debugRequestId: requestPayload.debugRequestId,
      itemType: requestPayload.itemType,
      itemId: requestPayload.itemId,
      code: normalized.code,
      rawMessage: normalized.rawMessage,
      message: normalized.message,
      error,
    });
    const nextError = new Error(normalized.message);
    (nextError as any).code = normalized.code;
    (nextError as any).rawMessage = normalized.rawMessage;
    (nextError as any).debugRequestId = requestPayload.debugRequestId;
    throw nextError;
  }
}
