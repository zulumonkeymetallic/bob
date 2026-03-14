import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Container, ListGroup } from 'react-bootstrap';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { CalendarPlus, Check, Clock3, Target } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Story, Task } from '../types';
import { isRecurringDueOnDate, resolveTaskDueMs } from '../utils/recurringTaskDue';
import DeferItemModal from './DeferItemModal';
import EditTaskModal from './EditTaskModal';
import EditStoryModal from './EditStoryModal';
import NewCalendarEventModal, { BlockFormState, toInputValue } from './planner/NewCalendarEventModal';
import { useFocusGoals } from '../hooks/useFocusGoals';
import { getActiveFocusLeafGoalIds, getGoalAncestors, getGoalDisplayPath } from '../utils/goalHierarchy';
import { isFreshTimestamp } from '../utils/kpiFreshness';

type TimelineBucket = 'morning' | 'afternoon' | 'evening';
type TimelineFilter = 'task' | 'story' | 'chore' | 'event' | 'top3' | 'review' | null;

type TimelineItem = {
  id: string;
  kind: 'task' | 'story' | 'chore' | 'event';
  title: string;
  ref: string | null;
  timeLabel: string;
  sortMs: number | null;
  bucket: TimelineBucket;
  sourceId?: string;
  isTop3?: boolean;
  deferredUntilMs?: number | null;
  goalTitle: string | null;
  goalTheme: string | null;
  isFocusAligned: boolean;
  rawTask: Task | null;
  rawStory: Story | null;
  scheduledBlockStart: number | null;
  scheduledBlockEnd: number | null;
};

type CalendarBlockRow = {
  id: string;
  title?: string;
  start?: number;
  end?: number;
  taskId?: string | null;
  storyId?: string | null;
  linkedStoryId?: string | null;
};

type ScheduledInstanceRow = {
  id: string;
  ownerUid: string;
  sourceType?: string | null;
  sourceId?: string | null;
  occurrenceDate?: string | null;
  status?: string | null;
  updatedAt?: number | null;
};

const bucketOrder: TimelineBucket[] = ['morning', 'afternoon', 'evening'];

const bucketLabel = (bucket: TimelineBucket) => (
  bucket === 'morning' ? 'Morning' : bucket === 'afternoon' ? 'Afternoon' : 'Evening'
);

const toMs = (value: any): number | null => {
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

const isDoneStatus = (value: any): boolean => {
  if (typeof value === 'number') return value >= 2;
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'done' || raw === 'complete' || raw === 'completed' || raw === 'archived';
};

const normalizeStoryStatus = (value: any): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'done' || raw === 'complete' || raw === 'completed') return 4;
  if (raw === 'testing' || raw === 'qa' || raw === 'review') return 3;
  if (raw === 'in progress' || raw === 'in-progress' || raw === 'active' || raw === 'doing' || raw === 'blocked') return 2;
  if (raw === 'planned' || raw === 'ready') return 1;
  return 0;
};

const getChoreKind = (task: Task): 'chore' | 'routine' | 'habit' | null => {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
  return null;
};

const bucketFromTime = (ms: number | null | undefined, timeOfDay?: string | null): TimelineBucket => {
  const tod = String(timeOfDay || '').toLowerCase().trim();
  if (tod === 'morning' || tod === 'afternoon' || tod === 'evening') return tod as TimelineBucket;
  if (!ms || !Number.isFinite(ms)) return 'morning';
  const date = new Date(ms);
  const minute = date.getHours() * 60 + date.getMinutes();
  if (minute >= 300 && minute <= 779) return 'morning';
  if (minute >= 780 && minute <= 1139) return 'afternoon';
  return 'evening';
};

const bucketPseudoTime = (dayStartMs: number, bucket: TimelineBucket) => {
  if (bucket === 'morning') return dayStartMs + (9 * 60 * 60 * 1000);
  if (bucket === 'afternoon') return dayStartMs + (14 * 60 * 60 * 1000);
  return dayStartMs + (19.5 * 60 * 60 * 1000);
};

const formatTimeLabel = (startMs: number | null | undefined, endMs?: number | null, timeOfDay?: string | null): string => {
  if (!startMs || !Number.isFinite(startMs)) {
    return `Unscheduled (${bucketLabel(bucketFromTime(null, timeOfDay))})`;
  }
  const start = new Date(startMs);
  const startLabel = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (endMs && Number.isFinite(endMs)) {
    const end = new Date(endMs);
    const endLabel = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${startLabel} - ${endLabel}`;
  }
  return startLabel;
};

const resolveTaskRef = (task: Task) => task.ref || `TK-${task.id.slice(-6).toUpperCase()}`;
const resolveStoryRef = (story: Story) => ((story as any).referenceNumber || story.ref || `ST-${story.id.slice(-6).toUpperCase()}`);

const DailyPlanPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlockRow[]>([]);
  const [scheduledInstances, setScheduledInstances] = useState<ScheduledInstanceRow[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [deferTarget, setDeferTarget] = useState<{ type: 'task' | 'story'; id: string; title: string } | null>(null);
  const [morningReviewDone, setMorningReviewDone] = useState(false);
  const [activeKindFilter, setActiveKindFilter] = useState<TimelineFilter>(null);
  const [pageMessage, setPageMessage] = useState<{ variant: 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editStory, setEditStory] = useState<Story | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<TimelineItem | null>(null);

  const today = useMemo(() => new Date(), []);
  const todayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const todayEndMs = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (!currentUser?.uid) return;
    getDoc(doc(db, 'profiles', currentUser.uid))
      .then((snap) => {
        if (!snap.exists()) return;
        const profile = snap.data() as any;
        const automatedTimestamp = profile.healthkitLastSyncAt || profile.updatedAt || null;
        const automatedActive = String(profile.healthkitStatus || '').toLowerCase() === 'synced';
        if (automatedActive && !isFreshTimestamp(automatedTimestamp, 24)) {
          setPageMessage({
            variant: 'warning',
            text: 'Stale Data: automated health progress is older than 24 hours. Manual entries will be used where available.',
          });
        }
      })
      .catch(() => undefined);
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setTasks([]);
      return;
    }
    const q = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
      const persona = currentPersona || 'personal';
      rows = rows.filter((task: any) => {
        if (persona === 'work') return task.persona === 'work';
        return task.persona == null || task.persona === 'personal';
      });
      setTasks(rows);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setStories([]);
      return;
    }
    const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[];
      const persona = currentPersona || 'personal';
      rows = rows.filter((story: any) => {
        if (persona === 'work') return story.persona === 'work';
        return story.persona == null || story.persona === 'personal';
      });
      setStories(rows);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setGoals([]);
      return;
    }
    const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      setGoals(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Goal[]);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setCalendarBlocks([]);
      return;
    }
    const q = query(collection(db, 'calendar_blocks'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((row: any) => {
          const startMs = toMs(row.start);
          return startMs != null && startMs >= todayStartMs && startMs <= todayEndMs;
        }) as CalendarBlockRow[];
      setCalendarBlocks(rows);
    });
    return () => unsub();
  }, [currentUser?.uid, todayStartMs, todayEndMs]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setScheduledInstances([]);
      return;
    }
    const q = query(
      collection(db, 'scheduled_instances'),
      where('ownerUid', '==', currentUser.uid),
      where('occurrenceDate', '==', todayIso),
    );
    const unsub = onSnapshot(q, (snap) => {
      setScheduledInstances(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as ScheduledInstanceRow[]);
    });
    return () => unsub();
  }, [currentUser?.uid, todayIso]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setSummary(null);
      return;
    }
    const q = query(collection(db, 'daily_summaries'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const sorted = [...snap.docs].sort((a, b) => (toMs(b.data()?.generatedAt) || 0) - (toMs(a.data()?.generatedAt) || 0));
      const row = sorted[0]?.data() as any;
      setSummary(row?.summary || null);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setMorningReviewDone(false);
      return;
    }
    const key = `dailyPlanMorningReview:${currentUser.uid}:${todayIso}`;
    setMorningReviewDone(window.localStorage.getItem(key) === '1');
  }, [currentUser?.uid, todayIso]);

  const storyMap = useMemo(() => new Map(stories.map((story) => [story.id, story])), [stories]);
  const goalMap = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);
  const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(activeFocusGoals), [activeFocusGoals]);

  const isGoalAlignedToFocus = useMemo(() => (
    (goalId: string | null | undefined) => {
      const normalized = String(goalId || '').trim();
      if (!normalized) return false;
      if (activeFocusGoalIds.has(normalized)) return true;
      return getGoalAncestors(normalized, goals).some((goal) => activeFocusGoalIds.has(goal.id));
    }
  ), [activeFocusGoalIds, goals]);

  const overviewCalendarEvents = useMemo(() => {
    const candidates = [summary?.calendar?.events, summary?.eventsToday, summary?.upcomingEvents, summary?.calendarEvents, summary?.dailyBrief?.calendar];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || candidate.length === 0) continue;
      const mapped = candidate
        .map((item: any, index: number) => {
          const title = String(item?.title || item?.summary || item?.name || '').trim();
          if (!title) return null;
          const startMs = toMs(item?.start ?? item?.startAt ?? item?.startDate ?? item?.when);
          const endMs = toMs(item?.end ?? item?.endAt ?? item?.endDate);
          return { id: String(item?.id || item?.eventId || `${title}-${index}`), title, startMs, endMs };
        })
        .filter(Boolean) as Array<{ id: string; title: string; startMs: number | null; endMs: number | null }>;
      if (mapped.length > 0) return mapped;
    }
    return [] as Array<{ id: string; title: string; startMs: number | null; endMs: number | null }>;
  }, [summary]);

  const scheduledInstanceBySourceKey = useMemo(() => {
    const map = new Map<string, ScheduledInstanceRow>();
    scheduledInstances.forEach((instance) => {
      const sourceType = String(instance.sourceType || '').trim().toLowerCase();
      const sourceId = String(instance.sourceId || '').trim();
      if (!sourceType || !sourceId) return;
      map.set(`${sourceType}:${sourceId}`, instance);
    });
    return map;
  }, [scheduledInstances]);

  const timelineItems = useMemo(() => {
    const rows: TimelineItem[] = [];
    const seen = new Set<string>();
    const blockByTaskId = new Map<string, CalendarBlockRow>();
    const blockByStoryId = new Map<string, CalendarBlockRow>();

    calendarBlocks.forEach((block) => {
      const taskId = String(block.taskId || '').trim();
      const storyId = String(block.storyId || block.linkedStoryId || '').trim();
      if (taskId) blockByTaskId.set(taskId, block);
      if (storyId) blockByStoryId.set(storyId, block);
    });

    const push = (row: TimelineItem, dedupeKey = row.id) => {
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      rows.push(row);
    };

    const buildTaskRow = (task: Task, kind: 'task' | 'chore') => {
      const choreKind = getChoreKind(task);
      const instanceSourceTypes = choreKind === 'habit'
        ? ['habit', 'routine', 'chore']
        : choreKind
          ? [choreKind]
          : ['task'];
      const matchingInstance = instanceSourceTypes
        .map((sourceType) => scheduledInstanceBySourceKey.get(`${sourceType}:${task.id}`) || null)
        .find(Boolean) || null;
      const instanceStatus = String(matchingInstance?.status || '').trim().toLowerCase();
      if (matchingInstance && ['completed', 'missed', 'skipped', 'cancelled'].includes(instanceStatus)) {
        return;
      }
      const linkedBlock = blockByTaskId.get(task.id) || null;
      const parentStory = (task as any).storyId ? storyMap.get((task as any).storyId) || null : null;
      const goalId = String((task as any).goalId || (parentStory as any)?.goalId || '').trim() || null;
      const goal = goalId ? goalMap.get(goalId) || null : null;
      const dueMs = linkedBlock ? toMs(linkedBlock.start) : resolveTaskDueMs(task);
      const endMs = linkedBlock ? toMs(linkedBlock.end) : null;
      const bucket = bucketFromTime(dueMs, (task as any).timeOfDay);
      const include = !!linkedBlock || !dueMs || dueMs <= todayEndMs;
      if (!include) return;
      push({
        id: `${kind}-${task.id}`,
        kind,
        title: task.title || (kind === 'chore' ? 'Chore' : 'Task'),
        ref: resolveTaskRef(task),
        timeLabel: formatTimeLabel(dueMs, endMs, (task as any).timeOfDay),
        sortMs: dueMs ?? bucketPseudoTime(todayStartMs, bucket),
        bucket,
        sourceId: task.id,
        isTop3: !!((task as any).aiTop3ForDay && String((task as any).aiTop3Date || '').slice(0, 10) === todayIso),
        deferredUntilMs: toMs((task as any).deferredUntil),
        goalTitle: goalId ? getGoalDisplayPath(goalId, goals) : (goal?.title || null),
        goalTheme: goal ? String((goal as any).theme || '') || null : null,
        isFocusAligned: isGoalAlignedToFocus(goalId),
        rawTask: task,
        rawStory: null,
        scheduledBlockStart: linkedBlock ? toMs(linkedBlock.start) : null,
        scheduledBlockEnd: linkedBlock ? toMs(linkedBlock.end) : null,
      });
    };

    tasks.filter((task) => !isDoneStatus((task as any).status)).filter((task) => !getChoreKind(task)).forEach((task) => buildTaskRow(task, 'task'));
    tasks
      .filter((task) => !isDoneStatus((task as any).status))
      .filter((task) => !!getChoreKind(task))
      .filter((task) => !!blockByTaskId.get(task.id) || isRecurringDueOnDate(task, today, todayStartMs) || !!resolveTaskDueMs(task))
      .forEach((task) => buildTaskRow(task, 'chore'));

    stories
      .filter((story) => !isDoneStatus((story as any).status))
      .filter((story) => (selectedSprintId ? String((story as any).sprintId || '') === String(selectedSprintId) : true))
      .forEach((story) => {
        const linkedBlock = blockByStoryId.get(story.id) || null;
        const dueMs = linkedBlock ? toMs(linkedBlock.start) : toMs((story as any).targetDate || (story as any).dueDate || (story as any).plannedStartDate);
        const endMs = linkedBlock ? toMs(linkedBlock.end) : null;
        const bucket = bucketFromTime(dueMs, (story as any).timeOfDay);
        const include = !!linkedBlock || !dueMs || dueMs <= todayEndMs;
        if (!include) return;
        const goalId = String((story as any).goalId || '').trim() || null;
        const goal = goalId ? goalMap.get(goalId) || null : null;
        push({
          id: `story-${story.id}`,
          kind: 'story',
          title: story.title || 'Story',
          ref: resolveStoryRef(story),
          timeLabel: formatTimeLabel(dueMs, endMs, (story as any).timeOfDay),
          sortMs: dueMs ?? bucketPseudoTime(todayStartMs, bucket),
          bucket,
          sourceId: story.id,
          isTop3: !!((story as any).aiTop3ForDay && String((story as any).aiTop3Date || '').slice(0, 10) === todayIso),
          deferredUntilMs: toMs((story as any).deferredUntil),
          goalTitle: goalId ? getGoalDisplayPath(goalId, goals) : (goal?.title || null),
          goalTheme: goal ? String((goal as any).theme || '') || null : null,
          isFocusAligned: isGoalAlignedToFocus(goalId),
          rawTask: null,
          rawStory: story,
          scheduledBlockStart: linkedBlock ? toMs(linkedBlock.start) : null,
          scheduledBlockEnd: linkedBlock ? toMs(linkedBlock.end) : null,
        });
      });

    calendarBlocks.filter((block) => !String(block.taskId || '').trim() && !String(block.storyId || block.linkedStoryId || '').trim()).forEach((block) => {
      const startMs = toMs(block.start);
      const endMs = toMs(block.end);
      const bucket = bucketFromTime(startMs);
      const timeLabel = formatTimeLabel(startMs, endMs);
      const dedupeKey = `event:${String(block.title || '').toLowerCase()}:${timeLabel}`;
      push({
        id: `event-block-${block.id}`,
        kind: 'event',
        title: String(block.title || 'Calendar event').trim() || 'Calendar event',
        ref: null,
        timeLabel,
        sortMs: startMs ?? bucketPseudoTime(todayStartMs, bucket),
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

    overviewCalendarEvents.forEach((event) => {
      if (event.startMs && (event.startMs < todayStartMs || event.startMs > todayEndMs)) return;
      const bucket = bucketFromTime(event.startMs);
      const timeLabel = formatTimeLabel(event.startMs, event.endMs);
      const dedupeKey = `event:${event.title.toLowerCase()}:${timeLabel}`;
      push({
        id: `event-summary-${event.id}`,
        kind: 'event',
        title: event.title,
        ref: null,
        timeLabel,
        sortMs: event.startMs ?? bucketPseudoTime(todayStartMs, bucket),
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
  }, [tasks, stories, selectedSprintId, overviewCalendarEvents, today, todayStartMs, todayEndMs, todayIso, goalMap, storyMap, activeFocusGoalIds, calendarBlocks, scheduledInstanceBySourceKey, goals, isGoalAlignedToFocus]);

  const todoSummary = useMemo(() => {
    const tasksCount = timelineItems.filter((item) => item.kind === 'task').length;
    const storiesCount = timelineItems.filter((item) => item.kind === 'story').length;
    const choresCount = timelineItems.filter((item) => item.kind === 'chore').length;
    const eventsCount = timelineItems.filter((item) => item.kind === 'event').length;
    const top3Count = timelineItems.filter((item) => (item.kind === 'task' || item.kind === 'story') && item.isTop3).length;
    const deferCandidates = timelineItems.filter((item) =>
      (item.kind === 'task' || item.kind === 'story')
      && !item.isTop3
      && !item.isFocusAligned
      && !(item.deferredUntilMs && item.deferredUntilMs > Date.now())
    );
    return { tasksCount, storiesCount, choresCount, eventsCount, top3Count, deferCandidates };
  }, [timelineItems]);

  const filteredTimelineItems = useMemo(() => {
    if (!activeKindFilter) return timelineItems;
    if (activeKindFilter === 'top3') {
      return timelineItems.filter((item) => (item.kind === 'task' || item.kind === 'story') && item.isTop3);
    }
    if (activeKindFilter === 'review') {
      return timelineItems.filter((item) =>
        (item.kind === 'task' || item.kind === 'story')
        && !item.isTop3
        && !item.isFocusAligned
        && !(item.deferredUntilMs && item.deferredUntilMs > Date.now())
      );
    }
    return timelineItems.filter((item) => item.kind === activeKindFilter);
  }, [timelineItems, activeKindFilter]);

  const empty = filteredTimelineItems.length === 0;

  const scheduleStories = useMemo(() => {
    if (!scheduleTarget) return [] as Story[];
    if (scheduleTarget.rawStory) return [scheduleTarget.rawStory];
    if (scheduleTarget.rawTask && (scheduleTarget.rawTask as any).storyId) {
      const parent = storyMap.get((scheduleTarget.rawTask as any).storyId);
      return parent ? [parent] : [];
    }
    return [] as Story[];
  }, [scheduleTarget, storyMap]);

  const scheduleInitialValues = useMemo(() => {
    if (!scheduleTarget) return undefined;
    const rawTask = scheduleTarget.rawTask;
    const rawStory = scheduleTarget.rawStory;
    const parentStory = rawTask && (rawTask as any).storyId ? storyMap.get((rawTask as any).storyId) || null : null;
    const base = new Date();
    base.setMinutes(0, 0, 0);
    base.setHours(base.getHours() + 1);
    const startMs = scheduleTarget.scheduledBlockStart || (scheduleTarget.sortMs && !scheduleTarget.timeLabel.startsWith('Unscheduled') ? scheduleTarget.sortMs : null);
    const start = startMs ? new Date(startMs) : base;
    const durationMin = Math.max(15, Math.min(240, Math.round(Number((rawTask as any)?.estimateMin || 0) || (Number((rawTask as any)?.points || (rawStory as any)?.points || 0) * 60) || 60)));
    const end = scheduleTarget.scheduledBlockEnd ? new Date(scheduleTarget.scheduledBlockEnd) : new Date(start.getTime() + durationMin * 60 * 1000);
    return {
      title: scheduleTarget.title,
      start: toInputValue(start),
      end: toInputValue(end),
      syncToGoogle: true,
      rationale: 'Scheduled from Daily Plan',
      persona: ((rawTask as any)?.persona || (rawStory as any)?.persona || (parentStory as any)?.persona || currentPersona || 'personal') as 'personal' | 'work',
      theme: String((rawStory as any)?.theme || (parentStory as any)?.theme || (rawTask as any)?.theme || 'General'),
      category: ((rawTask as any)?.category || 'Wellbeing') as any,
      storyId: rawStory?.id || parentStory?.id,
      taskId: rawTask?.id,
      aiScore: Number.isFinite(Number((rawTask as any)?.aiCriticalityScore || (rawStory as any)?.aiCriticalityScore)) ? Number((rawTask as any)?.aiCriticalityScore || (rawStory as any)?.aiCriticalityScore) : null,
      aiReason: String((rawTask as any)?.aiReason || (rawTask as any)?.aiPriorityReason || (rawStory as any)?.aiReason || (rawStory as any)?.aiPriorityReason || '').trim() || null,
    } as Partial<BlockFormState>;
  }, [scheduleTarget, storyMap, currentPersona]);

  const markMorningReviewDone = () => {
    if (!currentUser?.uid) return;
    const key = `dailyPlanMorningReview:${currentUser.uid}:${todayIso}`;
    window.localStorage.setItem(key, '1');
    setMorningReviewDone(true);
  };

  const applyDefer = async (payload: { dateMs: number; rationale: string; source: string }) => {
    if (!deferTarget) return;
    const collectionName = deferTarget.type === 'story' ? 'stories' : 'tasks';
    await updateDoc(doc(db, collectionName, deferTarget.id), {
      deferredUntil: payload.dateMs,
      deferredReason: payload.rationale,
      deferredBy: payload.source,
      deferredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const handleItemDone = async (item: TimelineItem, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (item.rawTask) {
      const choreKind = getChoreKind(item.rawTask);
      if (choreKind) {
        const candidateSourceTypes = choreKind === 'habit'
          ? ['habit', 'routine', 'chore']
          : [choreKind];
        const matchingInstance = candidateSourceTypes
          .map((sourceType) => scheduledInstanceBySourceKey.get(`${sourceType}:${item.rawTask!.id}`) || null)
          .find(Boolean) || null;
        if (matchingInstance) {
          await updateDoc(doc(db, 'scheduled_instances', matchingInstance.id), {
            status: 'completed',
            statusUpdatedAt: Date.now(),
            updatedAt: Date.now(),
          });
          return;
        }
        setPageMessage({
          variant: 'warning',
          text: 'Could not find today\'s scheduled instance for this recurring item, so the parent reminder was left unchanged.',
        });
        return;
      }
      await updateDoc(doc(db, 'tasks', item.rawTask.id), { status: 2, updatedAt: serverTimestamp() });
      return;
    }
    if (item.rawStory) {
      const nextStatus = Math.min(4, normalizeStoryStatus((item.rawStory as any).status) + 1);
      await updateDoc(doc(db, 'stories', item.rawStory.id), { status: nextStatus, updatedAt: serverTimestamp() });
    }
  };

  const openItemEditor = (item: TimelineItem) => {
    if (item.rawTask) {
      setEditTask(item.rawTask);
      return;
    }
    if (item.rawStory) setEditStory(item.rawStory);
  };

  const filterButtons: Array<{ key: TimelineFilter; label: string; count: number; variant: string; }> = [
    { key: 'task', label: 'Tasks', count: todoSummary.tasksCount, variant: 'primary' },
    { key: 'story', label: 'Stories', count: todoSummary.storiesCount, variant: 'info' },
    { key: 'chore', label: 'Chores', count: todoSummary.choresCount, variant: 'success' },
    { key: 'event', label: 'Events', count: todoSummary.eventsCount, variant: 'secondary' },
    { key: 'top3', label: 'Top 3', count: todoSummary.top3Count, variant: 'danger' },
    { key: 'review', label: 'Review', count: todoSummary.deferCandidates.length, variant: 'warning' },
  ];

  return (
    <Container fluid="sm" className="py-3">
      <Card className="border-0 shadow-sm">
        <Card.Header className="d-flex align-items-center justify-content-between">
          <div className="fw-semibold">Daily Plan</div>
          <Badge bg={empty ? 'secondary' : 'info'} pill>{filteredTimelineItems.length}</Badge>
        </Card.Header>
        <Card.Body>
          {pageMessage && (
            <Alert variant={pageMessage.variant} className="py-2 px-3" dismissible onClose={() => setPageMessage(null)}>
              {pageMessage.text}
            </Alert>
          )}
          <div className="text-muted small mb-3">
            Review today in one place: open items inline, finish them quickly, and schedule or defer without leaving the page.
          </div>

          <div className="d-flex flex-wrap gap-2 mb-3">
            {filterButtons.map((filter) => {
              const active = activeKindFilter === filter.key;
              return (
                <Button
                  key={filter.key || 'all'}
                  size="sm"
                  variant={active ? filter.variant : `outline-${filter.variant}`}
                  className="rounded-pill"
                  onClick={() => setActiveKindFilter((prev) => (prev === filter.key ? null : filter.key))}
                >
                  {filter.label} {filter.count}
                </Button>
              );
            })}
          </div>

          {!morningReviewDone && timelineItems.length > 0 && (
            <Alert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap py-2 px-3">
              <div>
                <div className="fw-semibold">Morning check-in</div>
                <div className="small">
                  Today: {todoSummary.tasksCount} tasks, {todoSummary.storiesCount} stories, {todoSummary.choresCount} chores, {todoSummary.eventsCount} events. Top 3 protected: {todoSummary.top3Count}. Review non-focus, non-Top 3 work first.
                </div>
              </div>
              <Button size="sm" variant="primary" onClick={markMorningReviewDone}>
                Mark reviewed
              </Button>
            </Alert>
          )}

          {empty ? (
            <Alert variant="light" className="mb-0">
              {activeKindFilter ? 'No items match the current filter.' : 'No items scheduled for today.'}
            </Alert>
          ) : (
            bucketOrder.map((bucket) => {
              const items = filteredTimelineItems.filter((item) => item.bucket === bucket);
              if (items.length === 0) return null;
              return (
                <div key={bucket} className="mb-3">
                  <div className="text-uppercase text-muted small fw-semibold mb-1">{bucketLabel(bucket)}</div>
                  <ListGroup variant="flush">
                    {items.map((item) => {
                      const editable = item.kind !== 'event';
                      const variant = item.kind === 'story' ? 'info' : item.kind === 'chore' ? 'success' : item.kind === 'event' ? 'secondary' : 'primary';
                      const kindLabel = item.kind === 'story' ? 'Story' : item.kind === 'chore' ? 'Chore' : item.kind === 'event' ? 'Event' : 'Task';
                      return (
                        <ListGroup.Item
                          key={item.id}
                          className="d-flex align-items-start gap-2 py-2 px-0 border-0 border-bottom"
                          role={editable ? 'button' : undefined}
                          tabIndex={editable ? 0 : undefined}
                          onClick={() => editable && openItemEditor(item)}
                          onKeyDown={(event) => {
                            if (!editable) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openItemEditor(item);
                            }
                          }}
                          style={{ cursor: editable ? 'pointer' : 'default' }}
                        >
                          {editable && (
                            <Button
                              size="sm"
                              variant="outline-success"
                              className="rounded-circle d-inline-flex align-items-center justify-content-center p-1 mt-1"
                              title={item.kind === 'chore' ? 'Mark instance done' : 'Mark done'}
                              onClick={(event) => void handleItemDone(item, event)}
                            >
                              <Check size={14} />
                            </Button>
                          )}

                          <div className="flex-grow-1 min-w-0">
                            <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
                              <div className="fw-semibold text-truncate small">{item.title}</div>
                              <Badge bg={variant}>{kindLabel}</Badge>
                              {item.isTop3 && <Badge bg="danger">Top 3</Badge>}
                              {item.isFocusAligned && <Badge bg="success">Focus</Badge>}
                              {item.deferredUntilMs && item.deferredUntilMs > Date.now() && <Badge bg="warning" text="dark">Deferred</Badge>}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.74rem' }}>
                              {[item.ref, item.timeLabel].filter(Boolean).join(' · ')}
                            </div>
                            {item.goalTitle && (
                              <div className="d-flex align-items-center gap-1 mt-1" style={{ fontSize: '0.72rem', opacity: 0.8 }}>
                                <Target size={12} />
                                <span>{item.goalTitle}</span>
                              </div>
                            )}
                          </div>

                          {editable && (
                            <div className="d-flex align-items-center gap-1 ms-2">
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                title="Schedule now"
                                className="d-inline-flex align-items-center justify-content-center p-1"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setScheduleTarget(item);
                                }}
                              >
                                <CalendarPlus size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-warning"
                                title="Defer intelligently"
                                className="d-inline-flex align-items-center justify-content-center p-1"
                                disabled={!item.sourceId || (!!item.isTop3 && item.kind !== 'chore')}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (!item.sourceId) return;
                                  setDeferTarget({ type: item.kind === 'story' ? 'story' : 'task', id: item.sourceId, title: item.title });
                                }}
                              >
                                <Clock3 size={14} />
                              </Button>
                            </div>
                          )}
                        </ListGroup.Item>
                      );
                    })}
                  </ListGroup>
                </div>
              );
            })
          )}
        </Card.Body>
      </Card>

      {deferTarget && (
        <DeferItemModal
          show={!!deferTarget}
          onHide={() => setDeferTarget(null)}
          itemType={deferTarget.type}
          itemId={deferTarget.id}
          itemTitle={deferTarget.title}
          onApply={applyDefer}
        />
      )}

      <EditTaskModal show={!!editTask} task={editTask} onHide={() => setEditTask(null)} onUpdated={() => setEditTask(null)} />
      <EditStoryModal show={!!editStory} onHide={() => setEditStory(null)} story={editStory} goals={goals} onStoryUpdated={() => setEditStory(null)} />
      <NewCalendarEventModal show={!!scheduleTarget} onHide={() => setScheduleTarget(null)} initialValues={scheduleInitialValues} stories={scheduleStories} onSaved={() => setScheduleTarget(null)} />
    </Container>
  );
};

export default DailyPlanPage;
