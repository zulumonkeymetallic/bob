import type { Goal, Story, Task } from '../types';
import { getGoalAncestors, getGoalDisplayPath } from './goalHierarchy';
import { isRecurringDueOnDate, resolveTaskDueMs } from './recurringTaskDue';
import { storyStatusText, taskStatusText } from './storyCardFormatting';
import {
  bucketFromTime,
  bucketPseudoTime,
  formatBucketBackfillLabel,
  type TimelineBucket,
} from './timelineBuckets';

export type PlannerItemKind = 'task' | 'story' | 'chore' | 'event';

export interface PlannerCalendarBlockRow {
  id: string;
  title?: string;
  start?: number;
  end?: number;
  taskId?: string | null;
  storyId?: string | null;
  linkedStoryId?: string | null;
  source?: string | null;
  entry_method?: string | null;
  entityType?: string | null;
  category?: string | null;
  sourceInstanceId?: string | null;
  sourceInstanceIds?: string[] | null;
  choreId?: string | null;
  routineId?: string | null;
  habitId?: string | null;
  items?: Array<Record<string, any>> | null;
  itemCount?: number | null;
}

export interface PlannerScheduledInstanceRow {
  id: string;
  ownerUid: string;
  sourceType?: string | null;
  sourceId?: string | null;
  occurrenceDate?: string | null;
  status?: string | null;
  updatedAt?: number | null;
  dayKey?: string | null;
  blockId?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  timeOfDay?: string | null;
  durationMinutes?: number | null;
  title?: string | null;
  goalId?: string | null;
  storyId?: string | null;
}

export interface PlannerSummaryEvent {
  id: string;
  title: string;
  startMs: number | null;
  endMs: number | null;
}

export interface PlannerItem {
  id: string;
  kind: PlannerItemKind;
  title: string;
  ref: string | null;
  dayKey: string;
  timeOfDay: TimelineBucket;
  timeLabel: string;
  sortMs: number | null;
  bucket: TimelineBucket;
  sourceId?: string;
  isTop3?: boolean;
  deferredUntilMs?: number | null;
  dueAt?: number | null;
  statusLabel?: string | null;
  progressPct?: number | null;
  scheduledSourceLabel?: string | null;
  goalId?: string | null;
  goalTitle: string | null;
  goalTheme: string | null;
  isFocusAligned: boolean;
  rawTask: Task | null;
  rawStory: Story | null;
  scheduledBlockStart: number | null;
  scheduledBlockEnd: number | null;
  scheduledBlockId?: string | null;
  scheduledInstanceId?: string | null;
  childItems?: PlannerItem[];
}

interface PlannerBuildParams {
  tasks: Task[];
  stories: Story[];
  goals: Goal[];
  calendarBlocks: PlannerCalendarBlockRow[];
  scheduledInstances: PlannerScheduledInstanceRow[];
  activeFocusGoalIds: Set<string>;
  rangeStartMs: number;
  rangeEndMs: number;
  selectedSprintId?: string | null;
  summaryEvents?: PlannerSummaryEvent[];
  includeUnscheduledTasks?: boolean;
}

export const toMs = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().getTime();
    } catch {
      return null;
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const startOfDayMs = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const toDayKey = (value: number | Date) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
};

export const isDoneStatus = (value: any): boolean => {
  if (typeof value === 'number') return value >= 2;
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'done' || raw === 'complete' || raw === 'completed' || raw === 'archived';
};

export const normalizeStoryStatus = (value: any): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'done' || raw === 'complete' || raw === 'completed') return 4;
  if (raw === 'testing' || raw === 'qa' || raw === 'review') return 3;
  if (raw === 'in progress' || raw === 'in-progress' || raw === 'active' || raw === 'doing' || raw === 'blocked') return 2;
  if (raw === 'planned' || raw === 'ready') return 1;
  return 0;
};

const isTop3ForToday = (value: any): boolean => {
  if (value?.aiTop3ForDay !== true) return false;
  const top3Date = String(value?.aiTop3Date || '').trim();
  if (!top3Date) return true;
  return top3Date.slice(0, 10) === new Date().toISOString().slice(0, 10);
};

export const getChoreKind = (task: Task): 'chore' | 'routine' | 'habit' | null => {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
  return null;
};

export const resolveTaskRef = (task: Task) => task.ref || `TK-${task.id.slice(-6).toUpperCase()}`;
export const resolveStoryRef = (story: Story) => ((story as any).referenceNumber || story.ref || `ST-${story.id.slice(-6).toUpperCase()}`);

const scheduledSourceLabelForBlock = (block: PlannerCalendarBlockRow | null): string | null => {
  const source = String(block?.source || '').toLowerCase();
  const entryMethod = String(block?.entry_method || '').toLowerCase();
  const fromGcal = source === 'gcal' || entryMethod === 'google_calendar';
  if (fromGcal) return 'linked from gcal';
  if (source === 'bob' || source === 'manual' || entryMethod.includes('manual')) return 'manual';
  if (source.includes('ai') || entryMethod.includes('auto')) return 'auto-planned';
  return null;
};

const isGoalAlignedToFocus = (goalId: string | null | undefined, goals: Goal[], activeFocusGoalIds: Set<string>) => {
  const normalized = String(goalId || '').trim();
  if (!normalized) return false;
  if (activeFocusGoalIds.has(normalized)) return true;
  return getGoalAncestors(normalized, goals).some((goal) => activeFocusGoalIds.has(goal.id));
};

const instanceDayKey = (value: string | null | undefined) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
};

const dayKeyToMs = (dayKey: string) => {
  const parsed = Date.parse(`${dayKey}T12:00:00`);
  return Number.isNaN(parsed) ? null : startOfDayMs(parsed);
};

export const buildPlannerItems = ({
  tasks,
  stories,
  goals,
  calendarBlocks,
  scheduledInstances,
  activeFocusGoalIds,
  rangeStartMs,
  rangeEndMs,
  selectedSprintId,
  summaryEvents = [],
  includeUnscheduledTasks = false,
}: PlannerBuildParams): PlannerItem[] => {
  const rows: PlannerItem[] = [];
  const seen = new Set<string>();
  const storyMap = new Map(stories.map((story) => [story.id, story]));
  const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const blockByTaskId = new Map<string, PlannerCalendarBlockRow>();
  const blockByStoryId = new Map<string, PlannerCalendarBlockRow>();
  const calendarBlockById = new Map<string, PlannerCalendarBlockRow>();
  const blockByInstanceId = new Map<string, PlannerCalendarBlockRow>();
  const instanceMap = new Map<string, PlannerScheduledInstanceRow[]>();
  const instanceById = new Map<string, PlannerScheduledInstanceRow>();
  const groupedRecurringBlockIds = new Set<string>();
  const groupedRecurringInstanceIds = new Set<string>();
  const rangeEndDayMs = startOfDayMs(rangeEndMs);
  const isSingleDayRange = startOfDayMs(rangeStartMs) === startOfDayMs(rangeEndMs);

  calendarBlocks.forEach((block) => {
    const blockStart = toMs(block.start);
    calendarBlockById.set(block.id, block);
    if (blockStart == null || blockStart < rangeStartMs || blockStart > rangeEndMs) return;
    const taskId = String(block.taskId || '').trim();
    const storyId = String(block.storyId || block.linkedStoryId || '').trim();
    if (taskId) blockByTaskId.set(taskId, block);
    if (storyId) blockByStoryId.set(storyId, block);
    const sourceInstanceId = String(block.sourceInstanceId || '').trim();
    if (sourceInstanceId) blockByInstanceId.set(sourceInstanceId, block);
    const sourceInstanceIds = Array.isArray(block.sourceInstanceIds) ? block.sourceInstanceIds : [];
    sourceInstanceIds.forEach((instanceId) => {
      const normalized = String(instanceId || '').trim();
      if (normalized) blockByInstanceId.set(normalized, block);
    });
    const blockEntity = String(block.entityType || block.category || '').toLowerCase();
    const hasRecurringItems = !!(block.choreId || block.routineId || block.habitId)
      || blockEntity.includes('chore')
      || blockEntity.includes('routine')
      || blockEntity.includes('habit')
      || ((Array.isArray(block.items) ? block.items : []).some((item) => {
        const sourceType = String(item?.sourceType || item?.entityType || '').toLowerCase();
        return ['chore', 'routine', 'habit'].includes(sourceType);
      }));
    if (hasRecurringItems && sourceInstanceIds.length > 1) {
      groupedRecurringBlockIds.add(block.id);
      sourceInstanceIds.forEach((instanceId) => {
        const normalized = String(instanceId || '').trim();
        if (normalized) groupedRecurringInstanceIds.add(normalized);
      });
    }
  });

  scheduledInstances.forEach((instance) => {
    const sourceType = String(instance.sourceType || '').trim().toLowerCase();
    const sourceId = String(instance.sourceId || '').trim();
    const dayKey = instanceDayKey(instance.occurrenceDate);
    if (!sourceType || !sourceId || !dayKey) return;
    instanceById.set(instance.id, instance);
    const ms = dayKeyToMs(dayKey);
    if (ms == null || ms < startOfDayMs(rangeStartMs) || ms > startOfDayMs(rangeEndMs)) return;
    const key = `${sourceType}:${sourceId}`;
    const existing = instanceMap.get(key) || [];
    existing.push(instance);
    instanceMap.set(key, existing);
  });

  const push = (row: PlannerItem, dedupeKey = row.id) => {
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    rows.push(row);
  };

  const addRecurringRows = (task: Task) => {
    const choreKind = getChoreKind(task);
    if (!choreKind) return false;
      const candidateSourceTypes = choreKind === 'habit' ? ['habit', 'routine', 'chore'] : [choreKind];
      const matchingInstances = candidateSourceTypes.flatMap((sourceType) => instanceMap.get(`${sourceType}:${task.id}`) || []);
    if (matchingInstances.length === 0) return false;

    matchingInstances.forEach((instance) => {
      if (groupedRecurringInstanceIds.has(instance.id)) return;
      const status = String(instance.status || '').trim().toLowerCase();
      if (['completed', 'missed', 'skipped', 'cancelled'].includes(status)) return;
      const dayKey = instanceDayKey(instance.occurrenceDate);
      if (!dayKey) return;
      const dayMs = dayKeyToMs(dayKey);
      if (dayMs == null) return;
      const linkedBlock = blockByInstanceId.get(instance.id) || (instance.blockId ? calendarBlockById.get(String(instance.blockId)) || null : null);
      const startMs = linkedBlock ? toMs(linkedBlock.start) : toMs(instance.plannedStart);
      const endMs = linkedBlock ? toMs(linkedBlock.end) : toMs(instance.plannedEnd);
      const goalId = String((task as any).goalId || '').trim() || null;
      const goal = goalId ? goalMap.get(goalId) || null : null;
      const bucket = bucketFromTime(startMs ?? dayMs, instance.timeOfDay || (task as any).timeOfDay, 'morning');
      const sortMs = startMs ?? bucketPseudoTime(dayMs, bucket);
      push({
        id: `instance-${instance.id}`,
        kind: 'chore',
        title: task.title || 'Recurring item',
        ref: resolveTaskRef(task),
        dayKey,
        timeOfDay: bucket,
        timeLabel: formatBucketBackfillLabel(startMs, endMs, instance.timeOfDay || (task as any).timeOfDay),
        sortMs,
        bucket,
        sourceId: task.id,
        isTop3: false,
        deferredUntilMs: toMs((task as any).deferredUntil),
        dueAt: startMs ?? sortMs,
        statusLabel: taskStatusText((task as any).status),
        progressPct: Number.isFinite(Number((task as any).progressPct)) ? Number((task as any).progressPct) : null,
        scheduledSourceLabel: linkedBlock ? scheduledSourceLabelForBlock(linkedBlock) : 'recurring schedule',
        goalId,
        goalTitle: goalId ? getGoalDisplayPath(goalId, goals) : (goal?.title || null),
        goalTheme: goal ? String((goal as any).theme || '') || null : null,
        isFocusAligned: isGoalAlignedToFocus(goalId, goals, activeFocusGoalIds),
        rawTask: task,
        rawStory: null,
        scheduledBlockStart: startMs,
        scheduledBlockEnd: endMs,
        scheduledBlockId: linkedBlock?.id || String(instance.blockId || '') || null,
        scheduledInstanceId: instance.id,
      });
    });

    return matchingInstances.length > 0;
  };

  groupedRecurringBlockIds.forEach((blockId) => {
    const block = calendarBlockById.get(blockId);
    if (!block) return;
    const instanceIds = Array.isArray(block.sourceInstanceIds)
      ? block.sourceInstanceIds.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const childItems = instanceIds
      .map((instanceId) => {
        const instance = instanceById.get(instanceId);
        if (!instance) return null;
        const status = String(instance.status || '').trim().toLowerCase();
        if (['completed', 'missed', 'skipped', 'cancelled'].includes(status)) return null;
        const task = taskMap.get(String(instance.sourceId || '').trim());
        if (!task) return null;
        const dayKey = instanceDayKey(instance.occurrenceDate) || toDayKey(toMs(block.start) || rangeStartMs);
        const startMs = toMs(block.start) || toMs(instance.plannedStart);
        const endMs = toMs(block.end) || toMs(instance.plannedEnd);
        const goalId = String((task as any).goalId || '').trim() || null;
        const goal = goalId ? goalMap.get(goalId) || null : null;
        const bucket = bucketFromTime(startMs, instance.timeOfDay || (task as any).timeOfDay, 'morning');
        return {
          id: `instance-${instance.id}`,
          kind: 'chore' as const,
          title: task.title || instance.title || 'Recurring item',
          ref: resolveTaskRef(task),
          dayKey,
          timeOfDay: bucket,
          timeLabel: formatBucketBackfillLabel(startMs, endMs, instance.timeOfDay || (task as any).timeOfDay),
          sortMs: startMs ?? bucketPseudoTime(dayKeyToMs(dayKey) || rangeStartMs, bucket),
          bucket,
          sourceId: task.id,
          isTop3: false,
          deferredUntilMs: toMs((task as any).deferredUntil),
          dueAt: startMs,
          statusLabel: taskStatusText((task as any).status),
          progressPct: Number.isFinite(Number((task as any).progressPct)) ? Number((task as any).progressPct) : null,
          scheduledSourceLabel: scheduledSourceLabelForBlock(block),
          goalId,
          goalTitle: goalId ? getGoalDisplayPath(goalId, goals) : (goal?.title || null),
          goalTheme: goal ? String((goal as any).theme || '') || null : null,
          isFocusAligned: isGoalAlignedToFocus(goalId, goals, activeFocusGoalIds),
          rawTask: task,
          rawStory: null,
          scheduledBlockStart: startMs,
          scheduledBlockEnd: endMs,
          scheduledBlockId: block.id,
          scheduledInstanceId: instance.id,
        } satisfies PlannerItem;
      })
      .filter(Boolean) as PlannerItem[];

    if (childItems.length === 0) return;
    const earliestStart = childItems.reduce((min, child) => {
      const value = child.scheduledBlockStart ?? child.sortMs ?? rangeStartMs;
      return Math.min(min, value);
    }, Number.MAX_SAFE_INTEGER);
    const latestEnd = childItems.reduce((max, child) => {
      const value = child.scheduledBlockEnd ?? child.scheduledBlockStart ?? child.sortMs ?? rangeStartMs;
      return Math.max(max, value);
    }, 0);
    const bucket = bucketFromTime(earliestStart, childItems[0]?.timeOfDay, 'morning');
    push({
      id: `chore-group-${block.id}`,
      kind: 'chore',
      title: String(block.title || 'Chore block').trim() || 'Chore block',
      ref: null,
      dayKey: toDayKey(earliestStart),
      timeOfDay: bucket,
      timeLabel: formatBucketBackfillLabel(earliestStart, latestEnd),
      sortMs: earliestStart,
      bucket,
      sourceId: block.id,
      isTop3: false,
      deferredUntilMs: null,
      dueAt: earliestStart,
      statusLabel: null,
      progressPct: null,
      scheduledSourceLabel: scheduledSourceLabelForBlock(block),
      goalId: null,
      goalTitle: null,
      goalTheme: null,
      isFocusAligned: childItems.some((child) => child.isFocusAligned),
      rawTask: null,
      rawStory: null,
      scheduledBlockStart: earliestStart,
      scheduledBlockEnd: latestEnd || null,
      scheduledBlockId: block.id,
      childItems,
    });
  });

  tasks
    .filter((task) => !isDoneStatus((task as any).status))
    .forEach((task) => {
      const choreKind = getChoreKind(task);
      if (choreKind && addRecurringRows(task)) return;

      if (choreKind) {
        const fallbackDate = new Date(rangeStartMs);
        fallbackDate.setHours(0, 0, 0, 0);
        const dueOnFallback = isRecurringDueOnDate(task, fallbackDate, fallbackDate.getTime());
        if (!dueOnFallback && !blockByTaskId.get(task.id)) return;
      }

      const linkedBlock = blockByTaskId.get(task.id) || null;
      const parentStory = (task as any).storyId ? storyMap.get((task as any).storyId) || null : null;
      const goalId = String((task as any).goalId || (parentStory as any)?.goalId || '').trim() || null;
      const goal = goalId ? goalMap.get(goalId) || null : null;
      const deferredUntilMs = toMs((task as any).deferredUntil);
      if (deferredUntilMs != null && startOfDayMs(deferredUntilMs) > rangeEndDayMs) return;
      const top3ForToday = isTop3ForToday(task);
      const dueMs = linkedBlock ? toMs(linkedBlock.start) : resolveTaskDueMs(task);
      const endMs = linkedBlock ? toMs(linkedBlock.end) : null;
      const include = linkedBlock
        ? true
        : (isSingleDayRange && top3ForToday)
          ? true
        : dueMs == null
          ? includeUnscheduledTasks
          : (dueMs >= rangeStartMs && dueMs <= rangeEndMs);
      if (!include) return;

      const forceIntoSingleDayPlan = isSingleDayRange && top3ForToday && !linkedBlock && !(dueMs != null && dueMs >= rangeStartMs && dueMs <= rangeEndMs);
      const plannerBaseMs = forceIntoSingleDayPlan ? startOfDayMs(rangeStartMs) : (dueMs ?? startOfDayMs(rangeStartMs));
      const bucket = forceIntoSingleDayPlan
        ? bucketFromTime(null, (task as any).timeOfDay, 'morning')
        : bucketFromTime(dueMs, (task as any).timeOfDay, 'morning');
      const sortMs = forceIntoSingleDayPlan ? bucketPseudoTime(plannerBaseMs, bucket) : (dueMs ?? bucketPseudoTime(startOfDayMs(plannerBaseMs), bucket));
      const dayKey = toDayKey(sortMs ?? rangeStartMs);

      push({
        id: `${choreKind ? 'chore' : 'task'}-${task.id}`,
        kind: choreKind ? 'chore' : 'task',
        title: task.title || (choreKind ? 'Chore' : 'Task'),
        ref: resolveTaskRef(task),
        dayKey,
        timeOfDay: bucket,
        timeLabel: forceIntoSingleDayPlan
          ? formatBucketBackfillLabel(null, null, (task as any).timeOfDay)
          : formatBucketBackfillLabel(dueMs, endMs, (task as any).timeOfDay),
        sortMs,
        bucket,
        sourceId: task.id,
        isTop3: top3ForToday,
        deferredUntilMs,
        dueAt: dueMs,
        statusLabel: taskStatusText((task as any).status),
        progressPct: Number.isFinite(Number((task as any).progressPct)) ? Number((task as any).progressPct) : null,
        scheduledSourceLabel: linkedBlock ? scheduledSourceLabelForBlock(linkedBlock) : null,
        goalId,
        goalTitle: goalId ? getGoalDisplayPath(goalId, goals) : (goal?.title || null),
        goalTheme: goal ? String((goal as any).theme || '') || null : null,
        isFocusAligned: isGoalAlignedToFocus(goalId, goals, activeFocusGoalIds),
        rawTask: task,
        rawStory: null,
        scheduledBlockStart: linkedBlock ? toMs(linkedBlock.start) : null,
        scheduledBlockEnd: linkedBlock ? toMs(linkedBlock.end) : null,
        scheduledBlockId: linkedBlock?.id || null,
      });
    });

  stories
    .filter((story) => !isDoneStatus((story as any).status))
    .filter((story) => (selectedSprintId ? String((story as any).sprintId || '') === String(selectedSprintId) : true))
    .forEach((story) => {
      const linkedBlock = blockByStoryId.get(story.id) || null;
      const deferredUntilMs = toMs((story as any).deferredUntil);
      if (deferredUntilMs != null && startOfDayMs(deferredUntilMs) > rangeEndDayMs) return;
      const top3ForToday = isTop3ForToday(story);
      const dueMs = linkedBlock ? toMs(linkedBlock.start) : toMs((story as any).targetDate || (story as any).dueDate || (story as any).plannedStartDate);
      const endMs = linkedBlock ? toMs(linkedBlock.end) : null;
      const include = linkedBlock
        ? true
        : (isSingleDayRange && top3ForToday)
          ? true
        : dueMs == null
          ? includeUnscheduledTasks
          : (dueMs >= rangeStartMs && dueMs <= rangeEndMs);
      if (!include) return;

      const forceIntoSingleDayPlan = isSingleDayRange && top3ForToday && !linkedBlock && !(dueMs != null && dueMs >= rangeStartMs && dueMs <= rangeEndMs);
      const plannerBaseMs = forceIntoSingleDayPlan ? startOfDayMs(rangeStartMs) : (dueMs ?? startOfDayMs(rangeStartMs));
      const bucket = forceIntoSingleDayPlan
        ? bucketFromTime(null, (story as any).timeOfDay, 'morning')
        : bucketFromTime(dueMs, (story as any).timeOfDay, 'morning');
      const sortMs = forceIntoSingleDayPlan ? bucketPseudoTime(plannerBaseMs, bucket) : (dueMs ?? bucketPseudoTime(startOfDayMs(plannerBaseMs), bucket));
      const dayKey = toDayKey(sortMs ?? rangeStartMs);
      const goalId = String((story as any).goalId || '').trim() || null;
      const goal = goalId ? goalMap.get(goalId) || null : null;

      push({
        id: `story-${story.id}`,
        kind: 'story',
        title: story.title || 'Story',
        ref: resolveStoryRef(story),
        dayKey,
        timeOfDay: bucket,
        timeLabel: forceIntoSingleDayPlan
          ? formatBucketBackfillLabel(null, null, (story as any).timeOfDay)
          : formatBucketBackfillLabel(dueMs, endMs, (story as any).timeOfDay),
        sortMs,
        bucket,
        sourceId: story.id,
        isTop3: top3ForToday,
        deferredUntilMs,
        dueAt: dueMs,
        statusLabel: storyStatusText((story as any).status),
        progressPct: Number.isFinite(Number((story as any).progressPct)) ? Number((story as any).progressPct) : null,
        scheduledSourceLabel: linkedBlock ? scheduledSourceLabelForBlock(linkedBlock) : null,
        goalId,
        goalTitle: goalId ? getGoalDisplayPath(goalId, goals) : (goal?.title || null),
        goalTheme: goal ? String((goal as any).theme || '') || null : null,
        isFocusAligned: isGoalAlignedToFocus(goalId, goals, activeFocusGoalIds),
        rawTask: null,
        rawStory: story,
        scheduledBlockStart: linkedBlock ? toMs(linkedBlock.start) : null,
        scheduledBlockEnd: linkedBlock ? toMs(linkedBlock.end) : null,
        scheduledBlockId: linkedBlock?.id || null,
      });
    });

  calendarBlocks
    .filter((block) => !String(block.taskId || '').trim() && !String(block.storyId || block.linkedStoryId || '').trim())
    .forEach((block) => {
      const startMs = toMs(block.start);
      if (startMs == null || startMs < rangeStartMs || startMs > rangeEndMs) return;
      const endMs = toMs(block.end);
      const bucket = bucketFromTime(startMs, null, 'morning');
      const timeLabel = formatBucketBackfillLabel(startMs, endMs);
      const dedupeKey = `event:${String(block.title || '').toLowerCase()}:${timeLabel}`;
      push({
        id: `event-block-${block.id}`,
        kind: 'event',
        title: String(block.title || 'Calendar event').trim() || 'Calendar event',
        ref: null,
        dayKey: toDayKey(startMs),
        timeOfDay: bucket,
        timeLabel,
        sortMs: startMs ?? bucketPseudoTime(startOfDayMs(rangeStartMs), bucket),
        bucket,
        goalTitle: null,
        goalTheme: null,
        isFocusAligned: false,
        rawTask: null,
        rawStory: null,
        scheduledBlockStart: startMs,
        scheduledBlockEnd: endMs,
      }, dedupeKey);
    });

  summaryEvents.forEach((event) => {
    if (event.startMs != null && (event.startMs < rangeStartMs || event.startMs > rangeEndMs)) return;
    const anchorMs = event.startMs ?? rangeStartMs;
    const bucket = bucketFromTime(event.startMs, null, 'anytime');
    const timeLabel = formatBucketBackfillLabel(event.startMs, event.endMs);
    const dedupeKey = `event:${event.title.toLowerCase()}:${timeLabel}`;
    push({
      id: `event-summary-${event.id}`,
      kind: 'event',
      title: event.title,
      ref: null,
      dayKey: toDayKey(anchorMs),
      timeOfDay: bucket,
      timeLabel,
      sortMs: event.startMs ?? bucketPseudoTime(startOfDayMs(anchorMs), bucket),
      bucket,
      goalTitle: null,
      goalTheme: null,
      isFocusAligned: false,
      rawTask: null,
      rawStory: null,
      scheduledBlockStart: event.startMs,
      scheduledBlockEnd: event.endMs,
    }, dedupeKey);
  });

  return rows.sort((a, b) => {
    const aMs = a.sortMs ?? Number.MAX_SAFE_INTEGER;
    const bMs = b.sortMs ?? Number.MAX_SAFE_INTEGER;
    if (aMs !== bMs) return aMs - bMs;
    return a.title.localeCompare(b.title);
  });
};
