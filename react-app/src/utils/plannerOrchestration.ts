import { httpsCallable, type Functions } from 'firebase/functions';

type ReplanPayload = {
  days?: number;
  startDate?: string;
  planningMode?: 'smart' | 'strict';
  fitnessBlocksAutoCreate?: boolean;
};

type ReplanResult = {
  created?: number;
  rescheduled?: number;
  blocked?: number;
  shortfallMinutes?: number;
  unscheduledStories?: number;
  unscheduledTasks?: number;
};

type NightlyResult = {
  results?: Array<{ step?: string; status?: string }>;
};

export const normalizePlannerCallableError = (error: unknown, fallbackMessage: string) => {
  const err = error as { code?: string; message?: string };
  const rawCode = String(err?.code || '').toLowerCase();
  const code = rawCode.includes('/') ? rawCode.split('/').pop() : rawCode;

  if (code === 'deadline-exceeded') {
    return 'Planner request timed out. Orchestration may still be running. Retry shortly and verify planner stats.';
  }
  if (code === 'unavailable') {
    return 'Planner service is temporarily unavailable. Please retry in a moment.';
  }
  if (code === 'permission-denied') {
    return 'Permission denied while calling planner orchestration. Please sign out/in and retry.';
  }
  if (code === 'failed-precondition') {
    return 'Planner preconditions are not met (missing profile/integration state). Please verify settings and retry.';
  }

  return err?.message || fallbackMessage;
};

export const callDeltaReplan = async (firebaseFunctions: Functions, payload: ReplanPayload = {}) => {
  const callable = httpsCallable<ReplanPayload, ReplanResult>(firebaseFunctions, 'replanCalendarNow', { timeout: 180000 });
  const response = await callable(payload);
  return response.data || {};
};

export const callFullReplan = async (firebaseFunctions: Functions, payload: ReplanPayload = {}) => {
  const callable = httpsCallable<ReplanPayload, NightlyResult>(firebaseFunctions, 'runNightlyChainNow', { timeout: 540000 });
  const response = await callable(payload);
  return response.data || {};
};

export const formatDeltaReplanSummary = (payload: ReplanResult) => {
  const parts: string[] = [];
  if (payload?.created) parts.push(`${payload.created} created`);
  if (payload?.rescheduled) parts.push(`${payload.rescheduled} moved`);
  if (payload?.blocked) parts.push(`${payload.blocked} blocked`);
  if (payload?.shortfallMinutes) {
    const shortfallHours = Math.round((payload.shortfallMinutes / 60) * 10) / 10;
    parts.push(`${shortfallHours}h short`);
  }
  if (payload?.unscheduledStories) parts.push(`${payload.unscheduledStories} stories unscheduled`);
  if (payload?.unscheduledTasks) parts.push(`${payload.unscheduledTasks} tasks unscheduled`);
  return parts;
};

export const formatFullReplanSummary = (payload: NightlyResult) => {
  const total = payload?.results?.length || 0;
  const ok = (payload?.results || []).filter((item) => item.status === 'ok').length;
  return { total, ok };
};
