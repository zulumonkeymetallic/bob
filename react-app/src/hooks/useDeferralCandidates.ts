import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { useFocusGoals } from './useFocusGoals';
import { getActiveFocusLeafGoalIds } from '../utils/goalHierarchy';
import { deriveSprintCapacityPoints } from '../utils/plannerCapacity';
import type { CalendarBlock } from '../types';

export interface DeferralCandidate {
  id: string;
  type: 'story' | 'task';
  title: string;
  reasonCodes: string[];
  reasonSummary: string;
  protectedBy: string | null;
  /**
   * next_sprint       — move story to next sprint
   * next_sprint_pending — next sprint doesn't exist yet
   * next_free_day     — defer task to first available capacity slot
   * set_due_date      — focus-aligned story: set dueDate so nightly planner schedules it
   */
  recommendedAction: 'next_sprint' | 'next_sprint_pending' | 'next_free_day' | 'set_due_date';
  targetDateMs: number | null;
  targetSprintId: string | null;
  exactTargetStartMs: null;
  exactTargetEndMs: null;
  targetBucket: null;
  focusAligned: boolean;
  manualPriorityRank: number | null;
  aiTop3: boolean;
  effortHours: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOK_AHEAD_DAYS = 14;
const RECURRING_TYPES = new Set(['chore', 'routine', 'habit']);

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function todayIso(): string {
  return isoDate(Date.now());
}

function countWorkingDays(startMs: number, endMs: number): number {
  let count = 0;
  let cur = startOfDayMs(startMs);
  const end = startOfDayMs(endMs);
  while (cur <= end) {
    const dow = new Date(cur).getDay();
    if (dow >= 1 && dow <= 5) count++;
    cur += DAY_MS;
  }
  return Math.max(1, count);
}

function buildDayLoadHoursMap(blocks: CalendarBlock[], fromMs: number, toMs: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const block of blocks) {
    if (block.status === 'superseded') continue;
    if (block.start < fromMs || block.start >= toMs) continue;
    const key = isoDate(block.start);
    const hours = Math.max(0, (block.end - block.start) / (60 * 60 * 1000));
    map.set(key, (map.get(key) ?? 0) + hours);
  }
  return map;
}

/**
 * First working day from tomorrow where booked + effort fits within daily capacity.
 * Caps search at sprintEndMs (for focus stories scheduled within the sprint).
 * Pass sprintEndMs = 0 to search the full LOOK_AHEAD_DAYS window (for tasks).
 */
function findNextFreeDay(
  effortHours: number,
  dayLoadMap: Map<string, number>,
  dailyCapacityHours: number,
  sprintEndMs = 0,
): number {
  const tomorrow = startOfDayMs(Date.now()) + DAY_MS;
  const horizonMs = sprintEndMs > tomorrow
    ? startOfDayMs(sprintEndMs)
    : tomorrow + LOOK_AHEAD_DAYS * DAY_MS;

  let cur = tomorrow;
  while (cur <= horizonMs) {
    const dow = new Date(cur).getDay();
    if (dow >= 1 && dow <= 5) {
      const booked = dayLoadMap.get(isoDate(cur)) ?? 0;
      if (booked + effortHours <= dailyCapacityHours) return cur;
    }
    cur += DAY_MS;
  }
  // Fallback: last working day at or before horizon
  cur = horizonMs;
  while (cur >= tomorrow) {
    if (new Date(cur).getDay() >= 1 && new Date(cur).getDay() <= 5) return cur;
    cur -= DAY_MS;
  }
  return tomorrow;
}

function getManualPriorityRank(entity: any): number | null {
  const explicit = Number(entity?.userPriorityRank);
  if (explicit === 1 || explicit === 2 || explicit === 3) return explicit;
  return entity?.userPriorityFlag === true ? 1 : null;
}

function isAiTop3Today(entity: any): boolean {
  return (
    entity?.aiTop3ForDay === true &&
    (!entity?.aiTop3Date || String(entity.aiTop3Date || '').slice(0, 10) === todayIso())
  );
}

function isRecurring(entity: any): boolean {
  const freq = String(
    entity?.repeatFrequency || entity?.recurrence?.frequency || entity?.recurrence?.freq || '',
  ).toLowerCase();
  return freq.length > 0;
}

function inferEffortHours(entity: any, entityType: 'story' | 'task'): number {
  if (entityType === 'task') {
    const direct = Number(entity?.points);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const mins = Number(entity?.estimateMin);
    if (Number.isFinite(mins) && mins > 0) return Math.max(0.25, mins / 60);
    return 1;
  }
  const direct = Number(entity?.points);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 2;
}

/**
 * Returns why a story is protected (excluded from candidates), or null if it should appear.
 *
 * Focus-aligned stories that already have a due date are excluded — the nightly planner
 * already has scheduling guidance for them.
 *
 * Focus-aligned stories WITHOUT a due date are NOT excluded — they become set_due_date
 * candidates so the nightly planner can slot them after top-3 / manual items.
 */
function resolveStoryProtectedBy(story: any, focusGoalIds: Set<string>): string | null {
  if (isAiTop3Today(story)) return 'aiTop3';
  if (getManualPriorityRank(story)) return 'manual';
  const goalId = String(story?.goalId || '').trim();
  if (goalId && focusGoalIds.has(goalId)) {
    const hasDueDate = Boolean(story?.dueDate || story?.targetDate);
    return hasDueDate ? 'focus_dated' : null; // undated focus stories become candidates
  }
  return null;
}

function resolveTaskProtectedBy(task: any, parentStory: any | null, focusGoalIds: Set<string>): string | null {
  if (isAiTop3Today(task)) return 'aiTop3';
  if (getManualPriorityRank(task)) return 'manual';
  const goalId = String(task?.goalId || '').trim();
  if (goalId && focusGoalIds.has(goalId)) return 'focus';
  if (parentStory) {
    if (isAiTop3Today(parentStory)) return 'aiTop3';
    if (getManualPriorityRank(parentStory)) return 'manual';
    const parentGoalId = String(parentStory?.goalId || '').trim();
    if (parentGoalId && focusGoalIds.has(parentGoalId)) return 'focus';
  }
  return null;
}

function buildReasonCodes(entity: any, entityType: 'story' | 'task', parentStory: any | null): string[] {
  const codes: string[] = [];
  if (!getManualPriorityRank(entity) && !isAiTop3Today(entity)) codes.push('not_priority');
  if (entityType === 'story') {
    if (Number(entity?.points || 0) >= 3) codes.push('large_effort');
  }
  if (entityType === 'task') {
    if (inferEffortHours(entity, 'task') >= 2) codes.push('large_effort');
    if (!entity?.goalId && !parentStory?.goalId) codes.push('no_goal_link');
  }
  if (!codes.length) codes.push('low_relative_priority');
  return codes;
}

function buildReasonSummary(codes: string[]): string {
  const parts: string[] = [];
  if (codes.includes('not_priority')) parts.push('not in top priorities or focus goals');
  if (codes.includes('large_effort')) parts.push('high effort for current sprint');
  if (codes.includes('no_goal_link')) parts.push('no linked goal');
  if (codes.includes('low_relative_priority')) parts.push('lower relative priority');
  return parts.length ? parts.join('; ') : 'lower priority than available focus work';
}

export const useDeferralCandidates = () => {
  const { currentUser } = useAuth();
  const { sprints } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);

  const [stories, setStories] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlock[]>([]);
  const [storiesReady, setStoriesReady] = useState(false);
  const [tasksReady, setTasksReady] = useState(false);
  const [blocksReady, setBlocksReady] = useState(false);

  const currentSprint = useMemo(() => {
    const now = Date.now();
    const sorted = [...sprints].sort(
      (a, b) => Number((a as any).startDate || 0) - Number((b as any).startDate || 0),
    );
    const active = sorted.find((s) => {
      const status = String((s as any).status || '').toLowerCase();
      return ['active', 'current', 'in-progress', 'in progress'].includes(status);
    });
    if (active) return active;
    return (
      sorted.find((s) => {
        const start = Number((s as any).startDate || 0);
        const end = Number((s as any).endDate || 0);
        return start > 0 && end > 0 && now >= start && now <= end;
      }) ||
      sorted[0] ||
      null
    );
  }, [sprints]);

  const nextSprint = useMemo(() => {
    if (!currentSprint) return null;
    const sorted = [...sprints].sort(
      (a, b) => Number((a as any).startDate || 0) - Number((b as any).startDate || 0),
    );
    return (
      sorted.find(
        (s) => Number((s as any).startDate || 0) > Number((currentSprint as any).startDate || 0),
      ) || null
    );
  }, [currentSprint, sprints]);

  useEffect(() => {
    if (!currentUser?.uid || !currentSprint?.id) {
      setStories([]);
      setStoriesReady(true);
      return;
    }
    setStoriesReady(false);
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('sprintId', '==', currentSprint.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => { setStories(snap.docs.map((d) => ({ _id: d.id, ...d.data() }))); setStoriesReady(true); },
      () => { setStories([]); setStoriesReady(true); },
    );
    return () => unsub();
  }, [currentUser?.uid, currentSprint?.id]);

  useEffect(() => {
    if (!currentUser?.uid || !currentSprint?.id) {
      setTasks([]);
      setTasksReady(true);
      return;
    }
    setTasksReady(false);
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('sprintId', '==', currentSprint.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => { setTasks(snap.docs.map((d) => ({ _id: d.id, ...d.data() }))); setTasksReady(true); },
      () => { setTasks([]); setTasksReady(true); },
    );
    return () => unsub();
  }, [currentUser?.uid, currentSprint?.id]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setCalendarBlocks([]);
      setBlocksReady(true);
      return;
    }
    setBlocksReady(false);
    const fromMs = startOfDayMs(Date.now()) + DAY_MS;
    const toMs = fromMs + LOOK_AHEAD_DAYS * DAY_MS;
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', fromMs),
      where('start', '<', toMs),
    );
    const unsub = onSnapshot(
      q,
      (snap) => { setCalendarBlocks(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CalendarBlock[]); setBlocksReady(true); },
      () => { setCalendarBlocks([]); setBlocksReady(true); },
    );
    return () => unsub();
  }, [currentUser?.uid]);

  const sprintEndMs = useMemo(
    () => Number((currentSprint as any)?.endDate || 0),
    [currentSprint],
  );

  const dailyCapacityHours = useMemo(() => {
    const totalPoints = deriveSprintCapacityPoints(currentSprint as any);
    const startMs = Number((currentSprint as any)?.startDate || 0);
    if (startMs && sprintEndMs && sprintEndMs > startMs) {
      return totalPoints / countWorkingDays(startMs, sprintEndMs);
    }
    return 6;
  }, [currentSprint, sprintEndMs]);

  const dayLoadMap = useMemo(() => {
    const fromMs = startOfDayMs(Date.now()) + DAY_MS;
    const toMs = fromMs + LOOK_AHEAD_DAYS * DAY_MS;
    return buildDayLoadHoursMap(calendarBlocks, fromMs, toMs);
  }, [calendarBlocks]);

  const focusGoalIds = useMemo(
    () => getActiveFocusLeafGoalIds(activeFocusGoals),
    [activeFocusGoals],
  );

  const candidates = useMemo<DeferralCandidate[]>(() => {
    if (!currentSprint || !storiesReady || !tasksReady) return [];

    const storiesById = new Map<string, any>();
    const result: DeferralCandidate[] = [];

    for (const story of stories) {
      storiesById.set(story._id, story);
      const status = String(story.status || '').toLowerCase();
      if (status === 'done' || status === 'completed' || status === 'closed') continue;

      const protectedBy = resolveStoryProtectedBy(story, focusGoalIds);
      if (protectedBy) continue;

      const goalId = String(story.goalId || '').trim();
      const isFocusAligned = goalId ? focusGoalIds.has(goalId) : false;
      const codes = buildReasonCodes(story, 'story', null);

      let recommendedAction: DeferralCandidate['recommendedAction'];
      let targetDateMs: number | null;

      if (isFocusAligned) {
        // No due date yet — propose one based on capacity so nightly planner can slot it
        recommendedAction = 'set_due_date';
        targetDateMs = blocksReady
          ? findNextFreeDay(inferEffortHours(story, 'story'), dayLoadMap, dailyCapacityHours, sprintEndMs)
          : (sprintEndMs || startOfDayMs(Date.now()) + 7 * DAY_MS);
      } else {
        recommendedAction = nextSprint?.id ? 'next_sprint' : 'next_sprint_pending';
        targetDateMs = null;
      }

      result.push({
        id: story._id,
        type: 'story',
        title: String(story.title || 'Untitled story'),
        reasonCodes: codes,
        reasonSummary: buildReasonSummary(codes),
        protectedBy: null,
        recommendedAction,
        targetDateMs,
        targetSprintId: isFocusAligned ? null : (nextSprint?.id || null),
        exactTargetStartMs: null,
        exactTargetEndMs: null,
        targetBucket: null,
        focusAligned: isFocusAligned,
        manualPriorityRank: getManualPriorityRank(story),
        aiTop3: isAiTop3Today(story),
        effortHours: inferEffortHours(story, 'story'),
      });
    }

    for (const task of tasks) {
      const status = String(task.status || '').toLowerCase();
      if (status === 'done' || status === 'completed' || status === 'closed') continue;
      const taskType = String(task.type || '').toLowerCase();
      if (RECURRING_TYPES.has(taskType) && isRecurring(task)) continue;
      const parentStory = task.storyId ? storiesById.get(task.storyId) ?? null : null;
      if (resolveTaskProtectedBy(task, parentStory, focusGoalIds)) continue;
      const codes = buildReasonCodes(task, 'task', parentStory);
      const goalId = String(task.goalId || parentStory?.goalId || '').trim();
      const targetDateMs = blocksReady
        ? findNextFreeDay(inferEffortHours(task, 'task'), dayLoadMap, dailyCapacityHours)
        : startOfDayMs(Date.now()) + DAY_MS;
      result.push({
        id: task._id,
        type: 'task',
        title: String(task.title || 'Untitled task'),
        reasonCodes: codes,
        reasonSummary: buildReasonSummary(codes),
        protectedBy: null,
        recommendedAction: 'next_free_day',
        targetDateMs,
        targetSprintId: null,
        exactTargetStartMs: null,
        exactTargetEndMs: null,
        targetBucket: null,
        focusAligned: goalId ? focusGoalIds.has(goalId) : false,
        manualPriorityRank: getManualPriorityRank(task),
        aiTop3: isAiTop3Today(task),
        effortHours: inferEffortHours(task, 'task'),
      });
    }

    return result;
  }, [
    stories, tasks, currentSprint, nextSprint, focusGoalIds,
    dayLoadMap, dailyCapacityHours, blocksReady, storiesReady, tasksReady, sprintEndMs,
  ]);

  return {
    candidates,
    loading: !storiesReady || !tasksReady,
    currentSprint,
    nextSprint,
  };
};
