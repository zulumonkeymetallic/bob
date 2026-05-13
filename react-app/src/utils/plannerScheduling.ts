import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export type PlannerScheduleIntent = 'move' | 'defer';
export type PlannerConstraintMode = 'free_slot' | 'theme_block' | 'auto';

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
  exactTargetStartMs?: number | null;
  exactTargetEndMs?: number | null;
  previewOnly?: boolean;
  constraintMode?: PlannerConstraintMode | null;
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
  scheduledByPolicy?: 'manual_priority_override' | 'theme_window';
  manualPriorityRank?: number | null;
  plannerConstraintMode?: 'free_slot' | 'theme_block' | null;
}

export interface PlannerScheduleErrorInfo {
  code: string;
  rawMessage: string;
  message: string;
}

export function normalizePlannerSchedulingError(error: any): PlannerScheduleErrorInfo {
  const rawCode = String(error?.code || '').replace(/^functions\//, '').trim();
  const rawMessage = String(error?.message || '').trim();
  const details = (error?.details && typeof error.details === 'object') ? error.details : {};
  const reason = String(details?.reason || '').trim();
  const detailsMessage = String(details?.message || (typeof error?.details === 'string' ? error.details : '') || '').trim();
  const lowerMessage = rawMessage.toLowerCase();
  const lowerDetails = detailsMessage.toLowerCase();
  const code = rawCode || 'unknown';

  // CORS / not deployed — network-level failures before the function even runs
  if (
    lowerMessage.includes('preflight')
    || lowerMessage.includes('access control checks')
    || lowerMessage.includes('failed to fetch')
    || lowerMessage.includes('cors')
    || lowerDetails.includes('preflight')
    || lowerDetails.includes('access control checks')
    || lowerDetails.includes('failed to fetch')
    || lowerDetails.includes('cors')
  ) {
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: 'The planner scheduling service is not reachable. The function may not be deployed yet or is failing CORS checks.',
    };
  }

  // Structured reason from server details (preferred path post-enhancement)
  if (reason === 'no_feasible_slot') {
    return {
      code,
      rawMessage,
      message: 'No available slot was found for that date. Try a different date, adjust the time bucket, or use defer.',
    };
  }

  if (reason === 'entity_not_found') {
    return {
      code,
      rawMessage,
      message: 'This item no longer exists. Refresh the page and try again.',
    };
  }

  if (reason === 'permission_denied') {
    return {
      code,
      rawMessage,
      message: 'You do not have permission to move or defer this item.',
    };
  }

  if (reason === 'invalid_argument') {
    return {
      code,
      rawMessage,
      message: 'The scheduling request was malformed. Refresh the page and try again.',
    };
  }

  if (reason === 'unexpected_error') {
    return {
      code,
      rawMessage,
      message: rawMessage || 'An unexpected server error occurred. Check Firebase logs for details.',
    };
  }

  // Fallback: use HTTP code
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

  if (code === 'permission-denied') {
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: 'You do not have permission to edit this item.',
    };
  }

  if (code === 'not-found') {
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: 'This item no longer exists. Refresh the page and try again.',
    };
  }

  if (code === 'internal') {
    // Unexpected crash — surface the raw message if it's meaningful
    const surfaced = rawMessage && !['internal', 'unknown'].includes(rawMessage.toLowerCase())
      ? rawMessage
      : 'An unexpected server error occurred. Check Firebase logs for details.';
    return { code, rawMessage, message: surfaced };
  }

  if (code === 'failed-precondition') {
    // Surface the server message if it's specific (not a generic fallback string)
    const isGeneric = !rawMessage || ['internal', 'unknown', 'failed-precondition'].includes(rawMessage.toLowerCase());
    return {
      code,
      rawMessage: rawMessage || detailsMessage,
      message: isGeneric
        ? 'The planner could not place this item. The date may conflict with existing blocks or sprint limits.'
        : rawMessage,
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
