import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Container, Form, Modal } from 'react-bootstrap';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { bucketLabel, bucketOrder, type TimelineBucket } from '../utils/timelineBuckets';
import { useLocation, useNavigate } from 'react-router-dom';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { useSidebar } from '../contexts/SidebarContext';
import type { Goal, Sprint, Story, Task } from '../types';
import { ChoiceHelper } from '../config/choices';
import DeferItemModal from './DeferItemModal';
import EditStoryModal from './EditStoryModal';
import EditTaskModal from './EditTaskModal';
import NewCalendarEventModal, { type BlockFormState, toInputValue } from './planner/NewCalendarEventModal';
import PlannerWorkCard from './planner/PlannerWorkCard';
import { useFocusGoals } from '../hooks/useFocusGoals';
import {
  buildPlannerItems,
  normalizeStoryStatus,
  toDayKey,
  toMs,
  type PlannerCalendarBlockRow,
  type PlannerItem,
  type PlannerScheduledInstanceRow,
  type PlannerSummaryEvent,
} from '../utils/plannerItems';
import { getActiveFocusLeafGoalIds } from '../utils/goalHierarchy';
import { isFreshTimestamp } from '../utils/kpiFreshness';
import { buildPlannerRecommendation, type PlannerRecommendation } from '../utils/plannerRecommendations';
import CheckInDaily from './checkins/CheckInDaily';
import { buildDayCapacityMap, plannerItemPoints } from '../utils/plannerCapacity';
import { schedulePlannerItem as schedulePlannerItemMutation } from '../utils/plannerScheduling';

type TimelineFilter = 'task' | 'story' | 'chore' | 'focus' | 'review' | 'top3' | null;
type DailyPlanMode = 'list' | 'plan' | 'review' | 'checkin';

type DeferTarget = {
  type: 'task' | 'story';
  id: string;
  title: string;
  isFocusAligned: boolean;
};

const dayStartMs = (date: Date | number) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
};

const createPlannerActionId = (prefix: 'move' | 'defer') => (
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

const nextSprintForDate = (sprints: Sprint[], afterMs: number) =>
  [...sprints]
    .filter((sprint) => Number(sprint.startDate || 0) > afterMs)
    .sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0))[0] || null;

const extractSummaryEvents = (summary: any): PlannerSummaryEvent[] => {
  const candidates = [summary?.calendar?.events, summary?.eventsToday, summary?.upcomingEvents, summary?.calendarEvents, summary?.dailyBrief?.calendar];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const mapped = candidate
      .map((item: any, index: number) => {
        const title = String(item?.title || item?.summary || item?.name || '').trim();
        if (!title) return null;
        return {
          id: String(item?.id || item?.eventId || `${title}-${index}`),
          title,
          startMs: toMs(item?.start ?? item?.startAt ?? item?.startDate ?? item?.when),
          endMs: toMs(item?.end ?? item?.endAt ?? item?.endDate),
        };
      })
      .filter(Boolean) as PlannerSummaryEvent[];
    if (mapped.length > 0) return mapped;
  }
  return [];
};

const getAutoMode = ({
  isMobile,
  reviewDone,
  reviewCount,
  hour,
}: {
  isMobile: boolean;
  reviewDone: boolean;
  reviewCount: number;
  hour: number;
}): DailyPlanMode => {
  if (hour >= 19) return 'checkin';
  if (!reviewDone && reviewCount > 0 && hour < 13) return 'review';
  return isMobile ? 'list' : 'plan';
};

const DailyPlanPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId, sprints } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);
  const { showSidebar } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<PlannerCalendarBlockRow[]>([]);
  const [scheduledInstances, setScheduledInstances] = useState<PlannerScheduledInstanceRow[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [deferTarget, setDeferTarget] = useState<DeferTarget | null>(null);
  const [pageMessage, setPageMessage] = useState<{ variant: 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editStory, setEditStory] = useState<Story | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<PlannerItem | null>(null);
  const [activeKindFilter, setActiveKindFilter] = useState<TimelineFilter>(null);
  const [morningReviewDone, setMorningReviewDone] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [isMobileLayout, setIsMobileLayout] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [userSelectedMode, setUserSelectedMode] = useState(false);
  const [mode, setMode] = useState<DailyPlanMode>(() => {
    if (typeof window === 'undefined') return 'plan';
    const params = new URLSearchParams(window.location.search);
    const forcedTab = params.get('tab');
    if (forcedTab === 'checkin') return 'checkin';
    return getAutoMode({
      isMobile: window.innerWidth < 768,
      reviewDone: false,
      reviewCount: 0,
      hour: new Date().getHours(),
    });
  });
  const [moveModal, setMoveModal] = useState<{ item: PlannerItem; recommendation: PlannerRecommendation | null } | null>(null);

  const todayStartMs = useMemo(() => dayStartMs(new Date()), []);
  const todayEndMs = useMemo(() => todayStartMs + (24 * 60 * 60 * 1000) - 1, [todayStartMs]);
  const todayIso = useMemo(() => new Date(todayStartMs).toISOString().slice(0, 10), [todayStartMs]);
  const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(activeFocusGoals), [activeFocusGoals]);
  const nextSprint = useMemo(() => nextSprintForDate(sprints as Sprint[], todayEndMs), [sprints, todayEndMs]);
  const reviewStateId = useMemo(
    () => (currentUser?.uid ? `${currentUser.uid}_${currentPersona || 'personal'}_${todayIso}` : null),
    [currentUser?.uid, currentPersona, todayIso],
  );

  useEffect(() => {
    const update = () => {
      const mobile = window.innerWidth < 768;
      setIsMobileLayout(mobile);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'checkin' && mode !== 'checkin') {
      setMode('checkin');
      setUserSelectedMode(false);
    }
  }, [location.search, mode]);

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
    if (!reviewStateId) {
      setMorningReviewDone(false);
      return;
    }
    const unsub = onSnapshot(doc(db, 'daily_plan_state', reviewStateId), (snap) => {
      const data = snap.data() as any;
      setMorningReviewDone(!!(data?.reviewCompletedAt || data?.reviewCompletedAtMs));
    }, (error) => {
      console.warn('DailyPlanPage: daily_plan_state listener denied/failed', error?.message || error);
      setMorningReviewDone(false);
    });
    return () => unsub();
  }, [reviewStateId]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setTasks([]);
      return;
    }
    const q = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
      rows = rows.filter((task: any) => currentPersona === 'work' ? task.persona === 'work' : task.persona == null || task.persona === 'personal');
      setTasks(rows);
    }, (error) => {
      console.warn('DailyPlanPage: tasks listener denied/failed', error?.message || error);
      setTasks([]);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setStories([]);
      return;
    }
    const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[];
      rows = rows.filter((story: any) => currentPersona === 'work' ? story.persona === 'work' : story.persona == null || story.persona === 'personal');
      setStories(rows);
    }, (error) => {
      console.warn('DailyPlanPage: stories listener denied/failed', error?.message || error);
      setStories([]);
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
    }, (error) => {
      console.warn('DailyPlanPage: goals listener denied/failed', error?.message || error);
      setGoals([]);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setCalendarBlocks([]);
      return;
    }
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', todayStartMs),
      where('start', '<=', todayEndMs),
    );
    const unsub = onSnapshot(q, (snap) => {
      setCalendarBlocks(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as PlannerCalendarBlockRow[]);
    }, (error) => {
      console.warn('DailyPlanPage: calendar_blocks listener denied/failed', error?.message || error);
      setCalendarBlocks([]);
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
      setScheduledInstances(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as PlannerScheduledInstanceRow[]);
    }, (error) => {
      console.warn('DailyPlanPage: scheduled_instances listener denied/failed', error?.message || error);
      setScheduledInstances([]);
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
    }, (error) => {
      console.warn('DailyPlanPage: daily_summaries listener denied/failed', error?.message || error);
      setSummary(null);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  const timelineItems = useMemo(
    () =>
      buildPlannerItems({
        tasks,
        stories,
        goals,
        calendarBlocks,
        scheduledInstances,
        activeFocusGoalIds,
        rangeStartMs: todayStartMs,
        rangeEndMs: todayEndMs,
        selectedSprintId,
        includeUnscheduledTasks: true,
        summaryEvents: extractSummaryEvents(summary),
      }),
    [tasks, stories, goals, calendarBlocks, scheduledInstances, activeFocusGoalIds, todayStartMs, todayEndMs, selectedSprintId, summary],
  );

  const timelineWorkItems = useMemo(() => timelineItems.filter((item) => item.kind !== 'event'), [timelineItems]);

  const dailyLoadHours = useMemo(() => {
    const map = new Map<string, number>();
    timelineWorkItems.forEach((item) => {
      map.set(item.dayKey, (map.get(item.dayKey) || 0) + plannerItemPoints(item));
    });
    return map;
  }, [timelineWorkItems]);

  const dayCapacity = useMemo(() => buildDayCapacityMap([todayIso], timelineWorkItems, 8).get(todayIso) || null, [timelineWorkItems, todayIso]);

  const reviewItems = useMemo(
    () =>
      timelineWorkItems.filter(
        (item) =>
          (item.kind === 'task' || item.kind === 'story')
          && !item.isTop3
          && !item.isFocusAligned
          && !(item.deferredUntilMs && item.deferredUntilMs > Date.now()),
      ),
    [timelineWorkItems],
  );

  const recommendationByItemId = useMemo(() => {
    const next = new Map<string, PlannerRecommendation>();
    reviewItems.forEach((item) => {
      next.set(item.id, buildPlannerRecommendation({
        item,
        weekStartMs: todayStartMs,
        weekEndMs: todayEndMs,
        dailyLoadHours,
        nextSprint,
      }));
    });
    return next;
  }, [reviewItems, todayStartMs, todayEndMs, dailyLoadHours, nextSprint]);

  const reviewItemIds = useMemo(() => new Set(reviewItems.map((item) => item.id)), [reviewItems]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'checkin') return;
    if (userSelectedMode) return;
    setMode(getAutoMode({
      isMobile: isMobileLayout,
      reviewDone: morningReviewDone,
      reviewCount: reviewItems.length,
      hour: new Date().getHours(),
    }));
  }, [isMobileLayout, location.search, morningReviewDone, reviewItems.length, userSelectedMode]);

  const todoSummary = useMemo(() => ({
    tasksCount: timelineWorkItems.filter((item) => item.kind === 'task').length,
    storiesCount: timelineWorkItems.filter((item) => item.kind === 'story').length,
    choresCount: timelineWorkItems.filter((item) => item.kind === 'chore').length,
    eventsCount: timelineItems.filter((item) => item.kind === 'event').length,
    top3Count: timelineWorkItems.filter((item) => (item.kind === 'task' || item.kind === 'story') && item.isTop3).length,
    focusCount: timelineWorkItems.filter((item) => item.isFocusAligned).length,
    reviewCount: reviewItems.length,
    overdueCount: timelineWorkItems.filter((item) => item.dueAt != null && item.dueAt < Date.now()).length,
  }), [timelineItems, timelineWorkItems, reviewItems]);

  const filteredTimelineItems = useMemo(() => {
    const source = mode === 'review' ? reviewItems : mode === 'plan' ? timelineItems : timelineWorkItems;
    if (!activeKindFilter) return source;
    if (activeKindFilter === 'focus') return source.filter((item) => item.isFocusAligned);
    if (activeKindFilter === 'review') return reviewItems;
    if (activeKindFilter === 'top3') return source.filter((item) => item.isTop3);
    return source.filter((item) => item.kind === activeKindFilter);
  }, [timelineItems, timelineWorkItems, reviewItems, activeKindFilter, mode]);

  const scheduleStories = useMemo(() => {
    if (!scheduleTarget) return [] as Story[];
    if (scheduleTarget.rawStory) return [scheduleTarget.rawStory];
    if (scheduleTarget.rawTask && (scheduleTarget.rawTask as any).storyId) {
      const parent = stories.find((story) => story.id === (scheduleTarget.rawTask as any).storyId);
      return parent ? [parent] : [];
    }
    return [] as Story[];
  }, [scheduleTarget, stories]);

  const scheduleInitialValues = useMemo(() => {
    if (!scheduleTarget) return undefined;
    const rawTask = scheduleTarget.rawTask;
    const rawStory = scheduleTarget.rawStory;
    const base = new Date();
    base.setMinutes(0, 0, 0);
    base.setHours(base.getHours() + 1);
    const startMs = scheduleTarget.scheduledBlockStart || scheduleTarget.sortMs || null;
    const start = startMs ? new Date(startMs) : base;
    const durationMin = Math.max(15, Math.min(240, Math.round(Number((rawTask as any)?.estimateMin || 0) || (Number((rawTask as any)?.points || (rawStory as any)?.points || 0) * 60) || 60)));
    const end = scheduleTarget.scheduledBlockEnd ? new Date(scheduleTarget.scheduledBlockEnd) : new Date(start.getTime() + durationMin * 60 * 1000);
    return {
      title: scheduleTarget.title,
      start: toInputValue(start),
      end: toInputValue(end),
      syncToGoogle: true,
      rationale: 'Scheduled from Daily Plan',
      persona: ((rawTask as any)?.persona || (rawStory as any)?.persona || currentPersona || 'personal') as 'personal' | 'work',
      theme: String((rawStory as any)?.theme || (rawTask as any)?.theme || 'General'),
      category: ((rawTask as any)?.category || 'Wellbeing') as any,
      storyId: rawStory?.id || (rawTask as any)?.storyId || undefined,
      taskId: rawTask?.id,
      aiScore: Number.isFinite(Number((rawTask as any)?.aiCriticalityScore || (rawStory as any)?.aiCriticalityScore)) ? Number((rawTask as any)?.aiCriticalityScore || (rawStory as any)?.aiCriticalityScore) : null,
      aiReason: String((rawTask as any)?.aiReason || (rawTask as any)?.aiPriorityReason || (rawStory as any)?.aiReason || (rawStory as any)?.aiPriorityReason || '').trim() || null,
    } as Partial<BlockFormState>;
  }, [scheduleTarget, currentPersona]);

  const markMorningReviewDone = () => {
    if (!currentUser?.uid || !reviewStateId) return;
    void setDoc(doc(db, 'daily_plan_state', reviewStateId), {
      ownerUid: currentUser.uid,
      persona: currentPersona || 'personal',
      dayKey: todayIso,
      reviewCompletedAt: serverTimestamp(),
      reviewCompletedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setMorningReviewDone(true);
    setActiveKindFilter(null);
    setMode(isMobileLayout ? 'list' : 'plan');
  };

  const selectMode = (nextMode: DailyPlanMode) => {
    setUserSelectedMode(true);
    setMode(nextMode);
    if (nextMode === 'checkin') {
      if (location.search !== '?tab=checkin') {
        navigate('/daily-plan?tab=checkin', { replace: true });
      }
      return;
    }
    if (location.search) {
      navigate('/daily-plan', { replace: true });
    }
  };

  const updateTaskQuick = async (task: Task, patch: Record<string, any>) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error('Failed to update task from daily plan', error);
      setPageMessage({ variant: 'danger', text: error?.message || 'Failed to update this task.' });
    }
  };

  const updateStoryQuick = async (story: Story, patch: Record<string, any>) => {
    try {
      await updateDoc(doc(db, 'stories', story.id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error('Failed to update story from daily plan', error);
      setPageMessage({ variant: 'danger', text: error?.message || 'Failed to update this story.' });
    }
  };

  const cycleTaskStatus = (task: Task) => {
    const options = ChoiceHelper.getOptions('task', 'status').map((opt) => opt.value);
    const current = Number((task as any)?.status ?? 0);
    const currentIndex = Math.max(0, options.indexOf(current));
    const next = options[(currentIndex + 1) % options.length] ?? 0;
    void updateTaskQuick(task, { status: next });
  };

  const cycleStoryStatus = (story: Story) => {
    const options = ChoiceHelper.getOptions('story', 'status').map((opt) => opt.value);
    const current = normalizeStoryStatus((story as any)?.status);
    const currentIndex = Math.max(0, options.indexOf(current));
    const next = options[(currentIndex + 1) % options.length] ?? 0;
    void updateStoryQuick(story, { status: next });
  };

  const cycleTaskPriority = (task: Task) => {
    const options = [0, ...ChoiceHelper.getOptions('task', 'priority').map((opt) => opt.value)];
    const current = Number((task as any)?.priority ?? 0);
    const currentIndex = Math.max(0, options.indexOf(current));
    const next = options[(currentIndex + 1) % options.length] ?? 0;
    void updateTaskQuick(task, { priority: next });
  };

  const cycleStoryPriority = (story: Story) => {
    const options = [0, ...ChoiceHelper.getOptions('story', 'priority').map((opt) => opt.value)];
    const current = Number((story as any)?.priority ?? 0);
    const currentIndex = Math.max(0, options.indexOf(current));
    const next = options[(currentIndex + 1) % options.length] ?? 0;
    void updateStoryQuick(story, { priority: next });
  };

  const buildTargetTiming = (targetDateMs: number, targetBucket: TimelineBucket, durationMinutes: number) => {
    const startHour = targetBucket === 'morning' ? 9 : targetBucket === 'afternoon' ? 14 : targetBucket === 'evening' ? 19 : 12;
    const startMs = dayStartMs(targetDateMs) + startHour * 60 * 60 * 1000;
    const safeDurationMinutes = Math.max(15, durationMinutes || 30);
    return {
      startMs,
      endMs: startMs + safeDurationMinutes * 60 * 1000,
    };
  };

  const updateScheduledInstanceTiming = async (item: PlannerItem, targetDateMs: number, targetBucket: TimelineBucket) => {
    if (!item.scheduledInstanceId) return;
    const durationMinutes = Math.max(
      15,
      Math.round((((item.scheduledBlockEnd || 0) - (item.scheduledBlockStart || 0)) / 60000) || Number((item.rawTask as any)?.estimateMin || 0) || 30),
    );
    const { startMs, endMs } = buildTargetTiming(targetDateMs, targetBucket, durationMinutes);
    await updateDoc(doc(db, 'scheduled_instances', item.scheduledInstanceId), {
      occurrenceDate: toDayKey(targetDateMs),
      dayKey: toDayKey(targetDateMs),
      timeOfDay: targetBucket,
      plannedStart: new Date(startMs).toISOString(),
      plannedEnd: new Date(endMs).toISOString(),
      updatedAt: Date.now(),
    });
  };

  const updateGroupTiming = async (item: PlannerItem, targetDateMs: number, targetBucket: TimelineBucket) => {
    const children = Array.isArray(item.childItems) ? item.childItems : [];
    await Promise.all(children.map((child) => updateScheduledInstanceTiming(child, targetDateMs, targetBucket)));
  };

  const handleItemDone = async (item: PlannerItem) => {
    setApplyingKey(item.id);
    try {
      if (item.scheduledInstanceId) {
        await updateDoc(doc(db, 'scheduled_instances', item.scheduledInstanceId), {
          status: 'completed',
          statusUpdatedAt: Date.now(),
          updatedAt: Date.now(),
        });
        const taskType = String((item.rawTask as any)?.type || '').toLowerCase();
        if (['chore', 'routine', 'habit', 'habitual'].includes(taskType) && item.rawTask?.id) {
          const callable = httpsCallable(functions, 'completeChoreTask');
          await callable({ taskId: item.rawTask.id });
        }
        setPageMessage({ variant: 'success', text: `${item.title} marked complete for today.` });
      } else if (item.rawTask) {
        await updateDoc(doc(db, 'tasks', item.rawTask.id), { status: 2, updatedAt: serverTimestamp() });
        setPageMessage({ variant: 'success', text: `${item.title} marked done.` });
      } else if (item.rawStory) {
        const nextStatus = Math.min(4, normalizeStoryStatus((item.rawStory as any).status) + 1);
        await updateDoc(doc(db, 'stories', item.rawStory.id), { status: nextStatus, updatedAt: serverTimestamp() });
        setPageMessage({ variant: 'success', text: `${item.title} advanced to the next story stage.` });
      }
    } catch (error: any) {
      console.error('Failed to mark planner item done', error);
      setPageMessage({ variant: 'danger', text: error?.message || 'Failed to update this item.' });
    } finally {
      setApplyingKey(null);
    }
  };

  const applyMove = async (item: PlannerItem, targetDateMs: number, targetBucket: TimelineBucket, recommendation?: PlannerRecommendation | null) => {
    setApplyingKey(item.id);
    const debugRequestId = createPlannerActionId('move');
    console.info('[DailyPlanPage] move_confirmed', {
      debugRequestId,
      itemId: item.id,
      itemKind: item.kind,
      sourceId: item.sourceId || null,
      targetDateMs,
      targetBucket,
      recommendation: recommendation || null,
    });
    try {
      if (item.childItems?.length) {
        await updateGroupTiming(item, targetDateMs, targetBucket);
      } else if (item.scheduledInstanceId) {
        await updateScheduledInstanceTiming(item, targetDateMs, targetBucket);
      } else if (item.rawTask) {
        const result = await schedulePlannerItemMutation({
          itemType: 'task',
          itemId: item.rawTask.id,
          targetDateMs,
          targetBucket,
          intent: recommendation?.action === 'next_sprint' ? 'defer' : 'move',
          source: 'daily_plan',
          rationale: recommendation?.rationale || null,
          linkedBlockId: item.scheduledBlockId || null,
          targetSprintId: recommendation?.action === 'next_sprint' ? (nextSprint?.id || null) : null,
          durationMinutes: Math.max(
            15,
            Math.round((((item.scheduledBlockEnd || 0) - (item.scheduledBlockStart || 0)) / 60000) || Number((item.rawTask as any)?.estimateMin || 0) || 30),
          ),
          debugRequestId,
        });
        setPageMessage({
          variant: 'success',
          text: `${item.title} moved to ${new Date(result.appliedStartMs).toLocaleDateString()} ${bucketLabel((result.appliedBucket || targetBucket) as TimelineBucket).toLowerCase()}.`,
        });
      } else if (item.rawStory) {
        const result = await schedulePlannerItemMutation({
          itemType: 'story',
          itemId: item.rawStory.id,
          targetDateMs,
          targetBucket,
          intent: recommendation?.action === 'next_sprint' ? 'defer' : 'move',
          source: 'daily_plan',
          rationale: recommendation?.rationale || null,
          linkedBlockId: item.scheduledBlockId || null,
          targetSprintId: recommendation?.action === 'next_sprint' ? (nextSprint?.id || null) : null,
          durationMinutes: Math.max(
            15,
            Math.round((((item.scheduledBlockEnd || 0) - (item.scheduledBlockStart || 0)) / 60000) || Number((item.rawStory as any)?.estimateMin || 0) || 60),
          ),
          debugRequestId,
        });
        setPageMessage({
          variant: 'success',
          text: `${item.title} moved to ${new Date(result.appliedStartMs).toLocaleDateString()} ${bucketLabel((result.appliedBucket || targetBucket) as TimelineBucket).toLowerCase()}.`,
        });
      } else {
        setPageMessage({
          variant: 'success',
          text: `${item.title} moved to ${new Date(targetDateMs).toLocaleDateString()} ${bucketLabel(targetBucket).toLowerCase()}.`,
        });
      }
      setMoveModal(null);
    } catch (error: any) {
      console.error('[DailyPlanPage] move_failed', { debugRequestId, error });
      setPageMessage({ variant: 'danger', text: error?.message || 'Failed to move this item.' });
    } finally {
      setApplyingKey(null);
    }
  };

  const applyRecommendation = async (item: PlannerItem, recommendation: PlannerRecommendation) => {
    if (recommendation.action === 'keep_week') {
      setPageMessage({ variant: 'success', text: `${item.title} kept in today’s plan.` });
      return;
    }
    if (recommendation.targetDateMs == null || recommendation.targetBucket == null) {
      setPageMessage({ variant: 'warning', text: 'No actionable recommendation was available.' });
      return;
    }
    if (recommendation.action === 'next_recurrence') {
      setApplyingKey(item.id);
      try {
        if (item.childItems?.length) {
          await updateGroupTiming(item, recommendation.targetDateMs, recommendation.targetBucket || item.timeOfDay);
        } else if (item.scheduledInstanceId) {
          await updateScheduledInstanceTiming(item, recommendation.targetDateMs, recommendation.targetBucket || item.timeOfDay);
        } else if (item.rawTask) {
          await updateDoc(doc(db, 'tasks', item.rawTask.id), {
            deferredUntil: recommendation.targetDateMs,
            deferredReason: recommendation.rationale,
            deferredBy: 'daily_plan',
            deferredAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        setPageMessage({ variant: 'success', text: `${item.title} deferred to its next sensible recurrence.` });
      } catch (error: any) {
        console.error('Failed to defer recurring item', error);
        setPageMessage({ variant: 'danger', text: error?.message || 'Failed to defer this recurring item.' });
      } finally {
        setApplyingKey(null);
      }
      return;
    }
    await applyMove(item, recommendation.targetDateMs, recommendation.targetBucket, recommendation);
  };

  const openItemEditor = (item: PlannerItem) => {
    if (item.rawTask) {
      setEditTask(item.rawTask);
      return;
    }
    if (item.rawStory) setEditStory(item.rawStory);
  };

  const renderPlannerCard = (item: PlannerItem) => {
    const recommendation = recommendationByItemId.get(item.id) || null;
    return (
      <PlannerWorkCard
        item={item}
        context="daily"
        isMobileLayout={isMobileLayout}
        applyingKey={applyingKey}
        showDoneControl={mode !== 'review'}
        doneAsCheckbox={mode === 'list'}
        showInlineRecommendation={!!recommendation && (mode === 'review' || reviewItemIds.has(item.id))}
        recommendation={recommendation}
        expanded={!!expandedGroups[item.id]}
        onToggleExpanded={(nextItem) => setExpandedGroups((prev) => ({ ...prev, [nextItem.id]: !prev[nextItem.id] }))}
        onToggleDone={(nextItem) => { void handleItemDone(nextItem); }}
        onOpenActivity={(nextItem) => showSidebar(nextItem.rawTask ? nextItem.rawTask as any : nextItem.rawStory as any, nextItem.rawTask ? 'task' : 'story')}
        onOpenEditor={openItemEditor}
        onSchedule={setScheduleTarget}
        onMove={(nextItem) => {
          console.info('[DailyPlanPage] move_clicked', {
            itemId: nextItem.id,
            itemKind: nextItem.kind,
            sourceId: nextItem.sourceId || null,
          });
          const fallbackRecommendation = nextItem.kind === 'chore'
            ? buildPlannerRecommendation({
              item: nextItem,
              weekStartMs: todayStartMs,
              weekEndMs: todayEndMs,
              dailyLoadHours,
              nextSprint,
            })
            : null;
          const nextRecommendation = recommendationByItemId.get(nextItem.id) || fallbackRecommendation || null;
          console.info('[DailyPlanPage] move_modal_opened', {
            itemId: nextItem.id,
            itemKind: nextItem.kind,
            recommendation: nextRecommendation || null,
          });
          setMoveModal({ item: nextItem, recommendation: nextRecommendation });
          if (nextItem.kind === 'chore' && nextRecommendation?.targetDateMs != null) {
            setPageMessage({
              variant: 'success',
              text: `${nextItem.title} move defaults were prefilled using its recurrence and current load.`,
            });
          }
        }}
        onDefer={(nextItem) => {
          console.info('[DailyPlanPage] defer_clicked', {
            itemId: nextItem.id,
            itemKind: nextItem.kind,
            sourceId: nextItem.sourceId || null,
          });
          if (nextItem.kind === 'event' || nextItem.childItems?.length) return;
          const recurringRecommendation = nextItem.kind === 'chore'
            ? buildPlannerRecommendation({
              item: nextItem,
              weekStartMs: todayStartMs,
              weekEndMs: todayEndMs,
              dailyLoadHours,
              nextSprint,
            })
            : null;
          if (recurringRecommendation?.action === 'next_recurrence') {
            void applyRecommendation(nextItem, recurringRecommendation);
            return;
          }
          setDeferTarget({ type: nextItem.kind === 'story' ? 'story' : 'task', id: nextItem.sourceId || '', title: nextItem.title, isFocusAligned: nextItem.isFocusAligned });
        }}
        onAcceptRecommendation={(nextItem) => {
          const nextRecommendation = recommendationByItemId.get(nextItem.id);
          if (nextRecommendation) void applyRecommendation(nextItem, nextRecommendation);
        }}
        onCycleStatus={(nextItem) => {
          if (nextItem.rawTask) cycleTaskStatus(nextItem.rawTask);
          else if (nextItem.rawStory) cycleStoryStatus(nextItem.rawStory);
        }}
        onCyclePriority={(nextItem) => {
          if (nextItem.rawTask) cycleTaskPriority(nextItem.rawTask);
          else if (nextItem.rawStory) cycleStoryPriority(nextItem.rawStory);
        }}
        onStatusChange={(nextItem, nextStatus) => {
          if (nextItem.rawTask) updateTaskQuick(nextItem.rawTask, { status: nextStatus as any });
          else if (nextItem.rawStory) updateStoryQuick(nextItem.rawStory, { status: nextStatus as any });
        }}
        onPriorityChange={(nextItem, nextPriority) => {
          if (nextItem.rawTask) updateTaskQuick(nextItem.rawTask, { priority: nextPriority as any });
          else if (nextItem.rawStory) updateStoryQuick(nextItem.rawStory, { priority: nextPriority as any });
        }}
      />
    );
  };

  const filterButtons: Array<{ key: TimelineFilter; label: string; count: number; variant: string }> = [
    { key: 'task', label: 'Tasks', count: todoSummary.tasksCount, variant: 'primary' },
    { key: 'story', label: 'Stories', count: todoSummary.storiesCount, variant: 'info' },
    { key: 'chore', label: 'Chores', count: todoSummary.choresCount, variant: 'success' },
    { key: 'top3', label: 'Top 3', count: todoSummary.top3Count, variant: 'danger' },
    { key: 'focus', label: 'Focus', count: todoSummary.focusCount, variant: 'success' },
    { key: 'review', label: 'Review', count: todoSummary.reviewCount, variant: 'warning' },
  ];

  return (
    <Container fluid="sm" className={isMobileLayout ? 'py-2 px-2' : 'py-3'}>
      <Card className="border-0 shadow-sm">
        <Card.Header className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <div className="fw-semibold">Daily Plan</div>
            <div className="text-muted small">Overview stays the home page; this is the daily operating surface.</div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Badge bg="secondary">Open {timelineWorkItems.length}</Badge>
            <Badge bg="warning" text="dark">Review {todoSummary.reviewCount}</Badge>
            <Badge bg="danger">Overdue {todoSummary.overdueCount}</Badge>
          </div>
        </Card.Header>
        <Card.Body>
          {pageMessage && (
            <Alert variant={pageMessage.variant} dismissible className="py-2" onClose={() => setPageMessage(null)}>
              {pageMessage.text}
            </Alert>
          )}

          <div className="d-flex gap-2 flex-wrap mb-3">
            <Button size="sm" variant={mode === 'list' ? 'primary' : 'outline-primary'} onClick={() => selectMode('list')}>
              Today
            </Button>
            <Button size="sm" variant={mode === 'plan' ? 'primary' : 'outline-primary'} onClick={() => selectMode('plan')}>
              Schedule
            </Button>
            <Button size="sm" variant={mode === 'review' ? 'primary' : 'outline-primary'} onClick={() => selectMode('review')}>
              Triage
            </Button>
            <Button size="sm" variant={mode === 'checkin' ? 'primary' : 'outline-primary'} onClick={() => selectMode('checkin')}>
              Check-in
            </Button>
          </div>

          <div className="text-muted small mb-3">
            {mode === 'list' && 'Today: actionable work only, best for checking things off.'}
            {mode === 'plan' && 'Schedule: your day laid out by morning, afternoon, evening, and standalone events.'}
            {mode === 'review' && 'Triage: items outside today’s focus or capacity, with defer recommendations.'}
            {mode === 'checkin' && 'Check-in: update progress, comments, and completion so nightly planning uses the latest state.'}
          </div>

          {mode !== 'checkin' && (
            <div className="d-flex flex-wrap gap-2 mb-3">
              {filterButtons.map((filter) => (
                <Button
                  key={filter.key || 'all'}
                  size="sm"
                  variant={activeKindFilter === filter.key ? filter.variant : `outline-${filter.variant}`}
                  className="rounded-pill"
                  onClick={() => setActiveKindFilter((prev) => (prev === filter.key ? null : filter.key))}
                >
                  {filter.label} {filter.count}
                </Button>
              ))}
            </div>
          )}

          {mode === 'plan' && dayCapacity && (
            <Alert variant={dayCapacity.overCapacity ? 'danger' : dayCapacity.remainingPoints <= 2 ? 'warning' : 'light'} className="py-2 px-3">
              <div className="fw-semibold">Today capacity</div>
              <div className="small text-muted">
                {dayCapacity.plannedPoints.toFixed(1)}/{dayCapacity.capacityPoints.toFixed(1)} pts planned · {dayCapacity.remainingPoints.toFixed(1)} pts free · {dayCapacity.utilizationPct}% used
              </div>
            </Alert>
          )}

          {mode !== 'checkin' && !morningReviewDone && reviewItems.length > 0 && (
            <Alert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap py-2 px-3">
              <div>
                <div className="fw-semibold">Morning review</div>
                <div className="small">
                  {todoSummary.reviewCount} items are outside your Top 3 and active focus goals. Triage them before the day fills up.
                </div>
              </div>
              <div className={`d-flex gap-2 ${isMobileLayout ? 'w-100 flex-column' : ''}`}>
                <Button size="sm" variant="outline-dark" className={isMobileLayout ? 'w-100' : undefined} onClick={() => selectMode('review')}>
                  Open review
                </Button>
                <Button size="sm" variant="primary" className={isMobileLayout ? 'w-100' : undefined} onClick={markMorningReviewDone}>
                  Mark reviewed
                </Button>
              </div>
            </Alert>
          )}

          {mode === 'checkin' ? (
            <CheckInDaily embedded fixedDate={new Date(todayStartMs)} />
          ) : mode === 'review' ? (
            filteredTimelineItems.length === 0 ? (
              <Alert variant="light" className="mb-0">No review items waiting.</Alert>
            ) : (
              <div className="d-flex flex-column gap-2">
                {filteredTimelineItems.map((item) => renderPlannerCard(item))}
              </div>
            )
          ) : mode === 'list' ? (
            filteredTimelineItems.length === 0 ? (
              <Alert variant="light" className="mb-0">No items in the current list view.</Alert>
            ) : (
              <div className="d-flex flex-column gap-2">
                {filteredTimelineItems.map((item) => renderPlannerCard(item))}
              </div>
            )
          ) : filteredTimelineItems.length === 0 ? (
            <Alert variant="light" className="mb-0">No items in today’s plan.</Alert>
          ) : (
            bucketOrder.map((bucket) => {
              const items = filteredTimelineItems.filter((item) => item.bucket === bucket);
              if (items.length === 0) return null;
              const bucketPoints = items.reduce((sum, item) => sum + plannerItemPoints(item), 0);
              return (
                <div key={bucket} className="mb-3">
                  <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                    <div className="text-uppercase text-muted small fw-semibold">{bucketLabel(bucket)}</div>
                    <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                      {bucketPoints.toFixed(1)} pts in bucket{dayCapacity ? ` · ${dayCapacity.remainingPoints.toFixed(1)} pts free today` : ''}
                    </div>
                  </div>
                  <div className="d-flex flex-column gap-2">
                    {items.map((item) => renderPlannerCard(item))}
                  </div>
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
          focusContext={{
            isFocusAligned: deferTarget.isFocusAligned,
            activeFocusGoals: activeFocusGoals.map((focusGoal) => ({
              id: focusGoal.id,
              title: focusGoal.title || null,
              focusRootGoalIds: Array.isArray(focusGoal.focusRootGoalIds) ? focusGoal.focusRootGoalIds : [],
              focusLeafGoalIds: Array.isArray(focusGoal.focusLeafGoalIds) ? focusGoal.focusLeafGoalIds : [],
              goalIds: Array.isArray(focusGoal.goalIds) ? focusGoal.goalIds : [],
            })),
          }}
          onApply={async (payload) => {
            if (!deferTarget) return;
            const affectedItem = timelineWorkItems.find((item) => item.sourceId === deferTarget.id && item.kind === deferTarget.type) || null;
            const debugRequestId = createPlannerActionId('defer');
            console.info('[DailyPlanPage] defer_confirmed', {
              debugRequestId,
              itemType: deferTarget.type,
              itemId: deferTarget.id,
              title: deferTarget.title,
              payload,
              affectedItemId: affectedItem?.id || null,
              linkedBlockId: affectedItem?.scheduledBlockId || null,
            });
            const result = await schedulePlannerItemMutation({
              itemType: deferTarget.type,
              itemId: deferTarget.id,
              targetDateMs: payload.dateMs,
              targetBucket: affectedItem?.timeOfDay || null,
              intent: 'defer',
              source: payload.source || 'daily_plan',
              rationale: payload.rationale,
              linkedBlockId: affectedItem?.scheduledBlockId || null,
              durationMinutes: affectedItem
                ? Math.max(
                    15,
                    Math.round((((affectedItem.scheduledBlockEnd || 0) - (affectedItem.scheduledBlockStart || 0)) / 60000)
                      || Number((affectedItem.rawTask as any)?.estimateMin || (affectedItem.rawStory as any)?.estimateMin || 0)
                      || 30),
                  )
                : null,
              debugRequestId,
            });
            setPageMessage({ variant: 'success', text: `${deferTarget.title} deferred to ${new Date(result.appliedStartMs).toLocaleDateString()}.` });
            setDeferTarget(null);
          }}
        />
      )}

      {moveModal && (
        <Modal show={!!moveModal} onHide={() => setMoveModal(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title style={{ fontSize: 16 }}>Move item</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="fw-semibold mb-2">{moveModal.item.title}</div>
            <div className="text-muted small mb-3">{moveModal.recommendation?.rationale || 'Pick a bucket for this item.'}</div>
            <Form.Group className="mb-3">
              <Form.Label className="small text-muted">Date</Form.Label>
              <Form.Control
                type="date"
                value={format(new Date(moveModal.recommendation?.targetDateMs || todayStartMs), 'yyyy-MM-dd')}
                onChange={(e) => {
                  const parsed = Date.parse(`${e.target.value}T12:00:00`);
                  setMoveModal({
                    ...moveModal,
                    recommendation: {
                      ...(moveModal.recommendation || { action: 'move_day', label: 'Move day', rationale: '' }),
                      targetDateMs: parsed,
                      targetBucket: moveModal.recommendation?.targetBucket || 'morning',
                    },
                  });
                }}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small text-muted">Time of day</Form.Label>
              <Form.Select
                value={moveModal.recommendation?.targetBucket || 'morning'}
                onChange={(e) => {
                  setMoveModal({
                    ...moveModal,
                    recommendation: {
                      ...(moveModal.recommendation || { action: 'move_day', label: 'Move day', rationale: '' }),
                      targetDateMs: moveModal.recommendation?.targetDateMs || todayStartMs,
                      targetBucket: e.target.value as TimelineBucket,
                    },
                  });
                }}
              >
                {bucketOrder.map((bucket) => (
                  <option key={bucket} value={bucket}>{bucketLabel(bucket)}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setMoveModal(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!moveModal.recommendation?.targetDateMs || !moveModal.recommendation?.targetBucket}
              onClick={() => moveModal.recommendation?.targetDateMs != null && moveModal.recommendation?.targetBucket != null
                ? void applyMove(moveModal.item, moveModal.recommendation.targetDateMs, moveModal.recommendation.targetBucket, moveModal.recommendation)
                : undefined}
            >
              Save move
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      <EditTaskModal show={!!editTask} task={editTask} onHide={() => setEditTask(null)} onUpdated={() => setEditTask(null)} />
      <EditStoryModal show={!!editStory} onHide={() => setEditStory(null)} story={editStory} goals={goals} onStoryUpdated={() => setEditStory(null)} />
      <NewCalendarEventModal
        show={!!scheduleTarget}
        onHide={() => setScheduleTarget(null)}
        initialValues={scheduleInitialValues}
        stories={scheduleStories}
        onSaved={() => {
          const scheduledTitle = scheduleTarget?.title || 'Item';
          setScheduleTarget(null);
          setPageMessage({ variant: 'success', text: `${scheduledTitle} added to your calendar.` });
        }}
      />
    </Container>
  );
};

export default DailyPlanPage;
