/**
 * useDailyPlanTimeline — shared "today's plan" derivation, extracted from MobileHome.tsx's
 * daily_plan tab so the desktop dashboard can render the same unified list (tasks + chores +
 * stories due/GCal-matched today + raw GCal event rows, bucketed into morning/afternoon/evening).
 *
 * Two usage modes:
 *  - Controlled mode (MobileHome.tsx): pass already-fetched `tasksDueToday` / `choresDueToday` /
 *    `storyCandidates` / `summary` (MobileHome already subscribes to these for other tabs) plus
 *    the existing shared-filter predicates. This is a pure derivation — zero new Firestore reads.
 *  - Self-fetch mode (DailyPlanWidget on the desktop dashboard): pass `uid` (and optionally
 *    `persona`) and omit the data props; the hook subscribes to tasks/stories/daily_summaries
 *    itself, mirroring the queries MobileHome already runs, and exposes simple completion
 *    actions (`completeTask` / `completeChore`) for the widget's checkboxes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, limit, updateDoc, deleteDoc, serverTimestamp, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { Story, Task } from '../types';
import { isRecurringDueOnDate, resolveRecurringDueMs, resolveTaskDueMs } from '../utils/recurringTaskDue';
import { isTop3Story, isTop3Task, top3DateForToday } from '../utils/top3';

export type DailyPlanBucket = 'morning' | 'afternoon' | 'evening';

export interface DailyPlanTimelineItem {
  id: string;
  kind: 'task' | 'story' | 'chore' | 'event';
  title: string;
  timeLabel: string;
  sortMs: number | null;
  bucket: DailyPlanBucket;
  task?: Task;
  story?: Story;
  /**
   * Optional/additive — true when this task or story is currently flagged as a Top 3 priority
   * (human-pinned manual rank, or BOB's aiTop3ForDay flag for today; see utils/top3.ts, the same
   * source Dashboard.tsx's standalone Top 3 widget and MobileHome's Top 3 section both use).
   * Not set for chore/event rows. Consumers that don't care (e.g. MobileHome) can ignore it.
   */
  isTop3?: boolean;
}

export interface DailyPlanCalendarEvent {
  id: string;
  title: string;
  startMs: number | null;
  endMs: number | null;
}

export interface DailyPlanSharedFilters {
  top3: boolean;
  chores: boolean;
  focusAligned: boolean;
}

const DEFAULT_SHARED_FILTERS: DailyPlanSharedFilters = { top3: false, chores: false, focusAligned: false };

// 05:00–12:59 morning, 13:00–18:59 afternoon, else evening. Timestamps before 05:00 (including the
// midnight fallback used by date-only due dates / recurring tasks with no time set) are treated as
// "no real time set" and bucketed into morning rather than falling through to evening.
export const bucketFromTime = (ms: number | null | undefined, timeOfDay?: string | null): DailyPlanBucket => {
  const tod = String(timeOfDay || '').toLowerCase().trim();
  if (tod === 'morning' || tod === 'afternoon' || tod === 'evening') return tod as DailyPlanBucket;
  if (!ms || !Number.isFinite(ms)) return 'morning';
  const d = new Date(ms);
  const minute = d.getHours() * 60 + d.getMinutes();
  if (minute < 300) return 'morning';
  if (minute <= 779) return 'morning';
  if (minute <= 1139) return 'afternoon';
  return 'evening';
};

const resolveDateValue = (candidate: any): number | null => {
  if (!candidate) return null;
  if (typeof candidate === 'number') return candidate;
  if (typeof candidate === 'object' && typeof candidate.toDate === 'function') {
    return candidate.toDate().getTime();
  }
  const parsed = Date.parse(String(candidate));
  return Number.isNaN(parsed) ? null : parsed;
};

const resolveMsFromAny = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try { return value.toDate().getTime(); } catch { return null; }
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const timelineTimeLabel = (startMs: number | null | undefined, endMs?: number | null): string => {
  if (!startMs || !Number.isFinite(startMs)) return 'Anytime';
  const start = new Date(startMs);
  const startLabel = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (endMs && Number.isFinite(endMs)) {
    const end = new Date(endMs);
    const endLabel = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${startLabel} - ${endLabel}`;
  }
  return startLabel;
};

// Mirrors MobileHome's overviewCalendarEvents: reads raw GCal events from whichever field the
// daily summary doc happens to populate.
export const extractCalendarEventsFromSummary = (summary: any): DailyPlanCalendarEvent[] => {
  const candidates = [
    summary?.calendar?.events,
    summary?.eventsToday,
    summary?.upcomingEvents,
    summary?.calendarEvents,
    summary?.dailyBrief?.calendar,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const mapped = candidate
      .map((item: any, idx: number) => {
        const title = String(item?.title || item?.summary || item?.name || '').trim();
        if (!title) return null;
        const startMs = resolveMsFromAny(item?.start ?? item?.startAt ?? item?.startDate ?? item?.when);
        const endMs = resolveMsFromAny(item?.end ?? item?.endAt ?? item?.endDate);
        return { id: String(item?.id || item?.eventId || `${title}-${idx}`), title, startMs, endMs };
      })
      .filter(Boolean) as DailyPlanCalendarEvent[];
    if (mapped.length > 0) return mapped;
  }
  return [];
};

const getChoreKind = (task: Task): 'chore' | 'routine' | 'habit' | null => {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
  if (normalized) return null;
  const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
  const tagKeys = tags.map((tag: any) => String(tag || '').toLowerCase().replace(/^#/, ''));
  if (tagKeys.includes('chore')) return 'chore';
  if (tagKeys.includes('routine')) return 'routine';
  if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
  return null;
};

const getTaskLastDoneMs = (task: Task): number | null => {
  const raw: any = (task as any).lastDoneAt ?? (task as any).completedAt;
  if (!raw) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw.toDate === 'function') {
    const d = raw.toDate();
    return d instanceof Date ? d.getTime() : null;
  }
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (raw.seconds != null) return (raw.seconds * 1000) + Math.floor((raw.nanoseconds || 0) / 1e6);
  return null;
};

export interface UseDailyPlanTimelineParams {
  /** Self-fetch mode only: owner uid to subscribe with. */
  uid?: string | null;
  /** Self-fetch mode only: persona filter applied to the tasks/stories queries. */
  persona?: string | null;
  /** Controlled mode: tasks due today (already filtered/sorted by the caller). */
  tasksDueToday?: Task[];
  /** Controlled mode: chores/routines/habits due today (already filtered/sorted by the caller). */
  choresDueToday?: Task[];
  /** Controlled mode: candidate stories to check for a due-today/GCal-matched-today placement. */
  storyCandidates?: Story[];
  /** Controlled mode: the daily_summaries doc used to source raw GCal events. */
  summary?: any;
  sharedFilters?: DailyPlanSharedFilters;
  matchesTaskFilter?: (task: Task) => boolean;
  matchesStoryFilter?: (story: Story) => boolean;
}

export interface UseDailyPlanTimelineResult {
  items: DailyPlanTimelineItem[];
  bucketCounts: { morning: number; afternoon: number; evening: number };
  loading: boolean;
  choreCompletionBusy: Record<string, boolean>;
  itemActionBusy: Record<string, boolean>;
  completeTask: (task: Task) => Promise<void>;
  completeChore: (task: Task) => Promise<void>;
  completeStory: (story: Story) => Promise<void>;
  deleteItem: (item: DailyPlanTimelineItem) => Promise<void>;
}

export function useDailyPlanTimeline(params: UseDailyPlanTimelineParams = {}): UseDailyPlanTimelineResult {
  const {
    uid,
    persona,
    tasksDueToday: externalTasksDueToday,
    choresDueToday: externalChoresDueToday,
    storyCandidates: externalStoryCandidates,
    summary: externalSummary,
    sharedFilters = DEFAULT_SHARED_FILTERS,
    matchesTaskFilter,
    matchesStoryFilter,
  } = params;

  const selfContained =
    externalTasksDueToday === undefined &&
    externalChoresDueToday === undefined &&
    externalStoryCandidates === undefined;

  const [fetchedTasks, setFetchedTasks] = useState<Task[]>([]);
  const [fetchedStories, setFetchedStories] = useState<Story[]>([]);
  const [fetchedSummary, setFetchedSummary] = useState<any | null>(null);
  const [fetchLoading, setFetchLoading] = useState<boolean>(selfContained);
  const [choreCompletionBusy, setChoreCompletionBusy] = useState<Record<string, boolean>>({});
  const [itemActionBusy, setItemActionBusy] = useState<Record<string, boolean>>({});

  const todayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  useEffect(() => {
    if (!selfContained) return;
    if (!uid) { setFetchedTasks([]); setFetchLoading(false); return; }
    setFetchLoading(true);
    const q = persona
      ? query(collection(db, 'tasks'), where('ownerUid', '==', uid), where('persona', '==', persona))
      : query(collection(db, 'tasks'), where('ownerUid', '==', uid));
    const unsub = onSnapshot(q, (snap) => {
      setFetchedTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Task[]);
      setFetchLoading(false);
    }, () => { setFetchedTasks([]); setFetchLoading(false); });
    return () => unsub();
  }, [selfContained, uid, persona]);

  useEffect(() => {
    if (!selfContained) return;
    if (!uid) { setFetchedStories([]); return; }
    const q = persona
      ? query(collection(db, 'stories'), where('ownerUid', '==', uid), where('persona', '==', persona))
      : query(collection(db, 'stories'), where('ownerUid', '==', uid));
    const unsub = onSnapshot(q, (snap) => {
      setFetchedStories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Story[]);
    }, () => setFetchedStories([]));
    return () => unsub();
  }, [selfContained, uid, persona]);

  useEffect(() => {
    if (!selfContained) return;
    if (!uid) { setFetchedSummary(null); return; }
    const q = query(
      collection(db, 'daily_summaries'),
      where('ownerUid', '==', uid),
      orderBy('generatedAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      const doc0 = snap.docs[0]?.data() as any;
      setFetchedSummary(doc0?.summary || null);
    }, () => setFetchedSummary(null));
    return () => unsub();
  }, [selfContained, uid]);

  const selfTasksDueToday = useMemo(() => {
    if (!selfContained) return [];
    const today = new Date();
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setHours(23, 59, 59, 999);
    return fetchedTasks
      .filter((t) => !(t as any).deleted)
      .filter((t) => (t.status ?? 0) !== 2)
      .filter((t) => {
        const due = resolveRecurringDueMs(t, today, start.getTime()) ?? resolveTaskDueMs(t);
        return !!due && due >= start.getTime() && due <= end.getTime();
      });
  }, [selfContained, fetchedTasks]);

  const selfChoresDueToday = useMemo(() => {
    if (!selfContained) return [];
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const hasRecurrenceConfig = (t: any) =>
      !!t.repeatFrequency
      || (Array.isArray(t.daysOfWeek) && t.daysOfWeek.length > 0)
      || (Array.isArray(t.repeatDaysOfWeek) && t.repeatDaysOfWeek.length > 0);
    const rows = fetchedTasks
      .filter((t) => !(t as any).deleted)
      .filter((t) => {
        // A recurring chore's due-ness is decided by its recurrence pattern landing on today,
        // never by a stale one-off due-date stamp from a past cycle — that stamp typically
        // isn't cleared/rolled-forward once set, so "due <= todayEnd" stays true on every day
        // from then on regardless of the chore's actual schedule (e.g. daysOfWeek: ['sat']
        // showing up daily instead of Saturdays only).
        if (hasRecurrenceConfig(t)) return !!getChoreKind(t) && isRecurringDueOnDate(t, todayDate);
        const due = resolveTaskDueMs(t);
        if (due) return due <= todayEnd.getTime();
        return !!getChoreKind(t) && isRecurringDueOnDate(t, todayDate, due);
      })
      .filter((t) => (t.status ?? 0) !== 2)
      .filter((t) => !!getChoreKind(t))
      .filter((t) => {
        const lastDone = getTaskLastDoneMs(t);
        if (!lastDone) return true;
        return lastDone < todayDate.getTime() || lastDone > todayEnd.getTime();
      });
    rows.sort((a, b) => {
      const aDue = resolveRecurringDueMs(a, new Date(), todayStartMs) ?? 0;
      const bDue = resolveRecurringDueMs(b, new Date(), todayStartMs) ?? 0;
      return aDue - bDue;
    });
    return rows;
  }, [selfContained, fetchedTasks, todayStartMs]);

  const selfStoryCandidates = useMemo(() => {
    if (!selfContained) return [];
    return fetchedStories.filter((s) => s.status !== 4);
  }, [selfContained, fetchedStories]);

  // Top 3 is a ranking, not a due-today filter — a Top 3 story/task due tomorrow is still
  // Top 3 today. Self-fetch mode's tasksDueToday/storyCandidates are scoped to "due today", so
  // without this a Top 3 item due on any other date would silently disappear from the pinned
  // Top 3 section instead of showing up (this was reported live: the dashboard's Today's Plan
  // Top 3 didn't match the Calendar page's Top 3 priorities panel, which isn't due-date-scoped).
  const selfTop3Tasks = useMemo(() => {
    if (!selfContained) return [];
    const todayIso = top3DateForToday();
    return fetchedTasks
      .filter((t) => !(t as any).deleted)
      .filter((t) => (t.status ?? 0) !== 2)
      .filter((t) => isTop3Task(t, undefined, todayIso));
  }, [selfContained, fetchedTasks]);

  const items = useMemo<DailyPlanTimelineItem[]>(() => {
    const tasksDueToday = externalTasksDueToday ?? selfTasksDueToday;
    const chores = externalChoresDueToday ?? selfChoresDueToday;
    const storiesSrc = externalStoryCandidates ?? selfStoryCandidates;
    const summarySrc = externalSummary !== undefined ? externalSummary : fetchedSummary;
    const calendarEvents = extractCalendarEventsFromSummary(summarySrc);

    const today = new Date();
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setHours(23, 59, 59, 999);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const todayIso = top3DateForToday();

    const rows: DailyPlanTimelineItem[] = [];
    const seen = new Set<string>();
    const add = (row: DailyPlanTimelineItem) => {
      const key = `${row.kind}:${row.title.toLowerCase()}:${row.timeLabel}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };

    const dueTodayTaskIds = new Set(tasksDueToday.map((t) => t.id));
    // Top 3 tasks not otherwise due today (self-fetch mode only — see selfTop3Tasks) still need
    // to appear, pinned, even though they have no "due today" timestamp to bucket by.
    const extraTop3Tasks = selfTop3Tasks.filter((t) => !dueTodayTaskIds.has(t.id));

    // Declared up front (not just before the story loop) so both the task and story loops can
    // register a matched title before the raw-GCal-events pass runs below. Stories already fed
    // this; tasks never did, so a task matched to a GCal event could render twice — once as the
    // normal task row, once again as a separate shaded "calendar event" row for the same block.
    const gcalMatchedTitles = new Set<string>();

    tasksDueToday.forEach((task) => {
      const matchedStartMs = resolveDateValue((task as any).calendarMatchedStart);
      const matchedEndMs = resolveDateValue((task as any).calendarMatchedEnd);
      const dueMs = resolveRecurringDueMs(task, today, startMs) ?? resolveTaskDueMs(task);
      // A GCal-matched time is more precise than a date-only due date — same preference story
      // rows already give matchedStartMs over dueMs.
      const sortTime = matchedStartMs ?? dueMs;
      if (matchedStartMs !== null) gcalMatchedTitles.add(task.title.trim().toLowerCase());
      add({
        id: `task-${task.id}`,
        kind: 'task',
        title: task.title,
        timeLabel: timelineTimeLabel(sortTime, matchedStartMs !== null ? (matchedEndMs ?? undefined) : undefined),
        sortMs: sortTime,
        bucket: bucketFromTime(sortTime, (task as any).timeOfDay),
        task,
        isTop3: isTop3Task(task, undefined, todayIso),
      });
    });

    extraTop3Tasks.forEach((task) => {
      add({
        id: `task-${task.id}`,
        kind: 'task',
        title: task.title,
        timeLabel: 'Top 3 · not due today',
        sortMs: null,
        bucket: bucketFromTime(null, (task as any).timeOfDay),
        task,
        isTop3: true,
      });
    });

    chores.forEach((task) => {
      const dueMs = resolveRecurringDueMs(task, today, startMs) ?? resolveTaskDueMs(task);
      // Midnight/pre-dawn (00:00–05:00) = date-only assignment, not a scheduled block time.
      // Drop the time label and use timeOfDay preference for bucket placement.
      const isMidnightFallback = dueMs !== null && dueMs >= startMs && dueMs <= startMs + 5 * 3_600_000;
      const effectiveSortMs = isMidnightFallback ? null : dueMs;
      add({
        id: `chore-${task.id}`,
        kind: 'chore',
        title: task.title,
        timeLabel: isMidnightFallback ? '' : timelineTimeLabel(dueMs),
        sortMs: effectiveSortMs,
        bucket: bucketFromTime(effectiveSortMs, (task as any).timeOfDay),
        task,
      });
    });

    storiesSrc
      .filter((story) => story.status !== 4)
      .forEach((story) => {
        const dueMs = resolveDateValue((story as any).targetDate || story.dueDate);
        const matchedStartMs = resolveDateValue((story as any).calendarMatchedStart);
        const matchedEndMs = resolveDateValue((story as any).calendarMatchedEnd);
        const isToday = (ms: number | null) => ms !== null && ms >= startMs && ms <= endMs;
        const storyIsTop3 = isTop3Story(story, todayIso);
        // A Top 3 story is still Top 3 even when its own due date isn't today (see
        // selfTop3Tasks comment above for the same reasoning applied to tasks).
        if (!isToday(dueMs) && !isToday(matchedStartMs) && !storyIsTop3) return;
        const sortTime = matchedStartMs ?? dueMs;
        if (matchedStartMs !== null) gcalMatchedTitles.add(story.title.trim().toLowerCase());
        add({
          id: `story-${story.id}`,
          kind: 'story',
          title: story.title,
          timeLabel: sortTime !== null ? timelineTimeLabel(matchedStartMs ?? dueMs, matchedEndMs ?? undefined) : 'Top 3 · not due today',
          sortMs: sortTime,
          bucket: bucketFromTime(sortTime, (story as any).timeOfDay),
          story,
          isTop3: storyIsTop3,
        });
      });

    calendarEvents.forEach((event) => {
      if (!event.startMs || event.startMs < startMs || event.startMs > endMs) return;
      if (gcalMatchedTitles.has(event.title.trim().toLowerCase())) return;
      add({
        id: `event-${event.id}`,
        kind: 'event',
        title: event.title,
        timeLabel: timelineTimeLabel(event.startMs, event.endMs),
        sortMs: event.startMs,
        bucket: bucketFromTime(event.startMs),
      });
    });

    const hasActiveFilter = sharedFilters.top3 || sharedFilters.chores || sharedFilters.focusAligned;
    return rows
      .filter((item) => {
        if (!hasActiveFilter) return true;
        if (item.kind === 'event') return false;
        if (item.story) return matchesStoryFilter ? matchesStoryFilter(item.story) : true;
        if (item.task) return matchesTaskFilter ? matchesTaskFilter(item.task) : true;
        return false;
      })
      .sort((a, b) => {
        const aTime = a.sortMs ?? Number.MAX_SAFE_INTEGER;
        const bTime = b.sortMs ?? Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return a.title.localeCompare(b.title);
      });
  }, [
    externalTasksDueToday,
    externalChoresDueToday,
    externalStoryCandidates,
    externalSummary,
    selfTasksDueToday,
    selfChoresDueToday,
    selfStoryCandidates,
    selfTop3Tasks,
    fetchedSummary,
    sharedFilters,
    matchesTaskFilter,
    matchesStoryFilter,
  ]);

  const bucketCounts = useMemo(() => ({
    morning: items.filter((item) => item.bucket === 'morning').length,
    afternoon: items.filter((item) => item.bucket === 'afternoon').length,
    evening: items.filter((item) => item.bucket === 'evening').length,
  }), [items]);

  const completeTask = useCallback(async (task: Task) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), { status: 2, updatedAt: serverTimestamp() });
    } catch (err) {
      console.warn('useDailyPlanTimeline: failed to complete task', err);
    }
  }, []);

  // Mirrors DeferralCandidatesBanner's handleMarkComplete/handleDelete quick actions (green
  // check / red trash, no sidebar) so the same gesture works the same way everywhere.
  const completeStory = useCallback(async (story: Story) => {
    try {
      await updateDoc(doc(db, 'stories', story.id), { status: 4, updatedAt: serverTimestamp() });
    } catch (err) {
      console.warn('useDailyPlanTimeline: failed to complete story', err);
    }
  }, []);

  const deleteItem = useCallback(async (item: DailyPlanTimelineItem) => {
    const id = item.story?.id ?? item.task?.id;
    if (!id) return;
    if (itemActionBusy[id]) return;
    setItemActionBusy((prev) => ({ ...prev, [id]: true }));
    try {
      await deleteDoc(doc(db, item.story ? 'stories' : 'tasks', id));
    } catch (err) {
      console.warn('useDailyPlanTimeline: failed to delete item', err);
      setItemActionBusy((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, [itemActionBusy]);

  const completeChore = useCallback(async (task: Task) => {
    const taskId = task.id;
    if (!taskId || choreCompletionBusy[taskId]) return;
    setChoreCompletionBusy((prev) => ({ ...prev, [taskId]: true }));
    try {
      const fn = httpsCallable(functions, 'completeChoreTask');
      await fn({ taskId });
    } catch (err) {
      console.warn('useDailyPlanTimeline: failed to complete chore task', err);
      setChoreCompletionBusy((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      return;
    }
    setTimeout(() => {
      setChoreCompletionBusy((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }, 1500);
  }, [choreCompletionBusy]);

  return {
    items,
    bucketCounts,
    loading: selfContained ? fetchLoading : false,
    choreCompletionBusy,
    itemActionBusy,
    completeTask,
    completeChore,
    completeStory,
    deleteItem,
  };
}
