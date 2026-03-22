import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { addDays, format } from 'date-fns';
import { Clock3, MoveRight, Sparkles } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useFocusGoals } from '../../hooks/useFocusGoals';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { GLOBAL_THEMES, type GlobalTheme } from '../../constants/globalThemes';
import type { Goal, Sprint, Story, Task } from '../../types';
import DeferItemModal from '../DeferItemModal';
import PlannerWorkCard from './PlannerWorkCard';
import {
  buildPlannerItems,
  type PlannerCalendarBlockRow,
  type PlannerItem,
  type PlannerScheduledInstanceRow,
  toDayKey,
} from '../../utils/plannerItems';
import { bucketLabel, bucketOrder, type TimelineBucket } from '../../utils/timelineBuckets';
import { getActiveFocusLeafGoalIds } from '../../utils/goalHierarchy';
import { buildPlannerRecommendation, type PlannerRecommendation } from '../../utils/plannerRecommendations';
import { buildDayCapacityMap, plannerItemPoints } from '../../utils/plannerCapacity';
import { schedulePlannerItem as schedulePlannerItemMutation } from '../../utils/plannerScheduling';

type WeeklyPlannerView = 'table' | 'planner';

interface WeeklyPlannerSurfaceProps {
  weekStart: Date;
  embedded?: boolean;
  title?: string;
  storageScope?: 'weekly_checkin' | 'standalone';
  onPlanningSaved?: (summary: {
    acceptedMoves: number;
    acceptedDefers: number;
    weekKey: string;
  }) => void;
}

type MoveTarget = {
  item: PlannerItem;
  recommendation: PlannerRecommendation | null;
};

type ThemeAllocation = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  theme: string;
  subTheme?: string | null;
};

const dayStartMs = (date: Date | number) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
};

const nextSprintForDate = (sprints: Sprint[], afterMs: number) =>
  [...sprints]
    .filter((sprint) => Number(sprint.startDate || 0) > afterMs)
    .sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0))[0] || null;

const formatOccurrenceKey = (existingValue: string | null | undefined, targetDateMs: number) => {
  const target = new Date(targetDateMs);
  if (/^\d{8}$/.test(String(existingValue || '').trim())) {
    return format(target, 'yyyyMMdd');
  }
  return format(target, 'yyyy-MM-dd');
};

const buildTargetTiming = (targetDateMs: number, targetBucket: TimelineBucket, durationMinutes: number) => {
  const startHour = targetBucket === 'morning' ? 9 : targetBucket === 'afternoon' ? 14 : targetBucket === 'evening' ? 19 : 12;
  const startMs = dayStartMs(targetDateMs) + startHour * 60 * 60 * 1000;
  return {
    startMs,
    endMs: startMs + Math.max(15, durationMinutes || 30) * 60 * 1000,
  };
};

const allocationToMinutes = (value: string | null | undefined) => {
  const [hours = '0', minutes = '0'] = String(value || '0:0').split(':');
  return Number(hours) * 60 + Number(minutes);
};

const bucketForMinutes = (minutes: number): TimelineBucket => {
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 17 * 60) return 'afternoon';
  if (minutes < 21 * 60) return 'evening';
  return 'anytime';
};

const normalizeThemeKey = (value: unknown, themes: GlobalTheme[]) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    const theme = themes.find((entry) => Number(entry.id) === numeric);
    if (theme) return String(theme.name || theme.label || theme.id).trim().toLowerCase();
  }
  const lower = raw.toLowerCase();
  const direct = themes.find((entry) => {
    const candidates = [
      String(entry.id ?? '').trim().toLowerCase(),
      String(entry.name || '').trim().toLowerCase(),
      String(entry.label || '').trim().toLowerCase(),
    ];
    return candidates.includes(lower);
  });
  if (direct) return String(direct.name || direct.label || direct.id).trim().toLowerCase();
  return lower;
};

const WeeklyPlannerSurface: React.FC<WeeklyPlannerSurfaceProps> = ({
  weekStart,
  embedded = false,
  title = 'Weekly Planner',
  storageScope = 'standalone',
  onPlanningSaved,
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);
  const { themes: customThemes } = useGlobalThemes();
  const themePalette = useMemo(() => (customThemes && customThemes.length ? customThemes : GLOBAL_THEMES), [customThemes]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<PlannerCalendarBlockRow[]>([]);
  const [scheduledInstances, setScheduledInstances] = useState<PlannerScheduledInstanceRow[]>([]);
  const [themeAllocations, setThemeAllocations] = useState<ThemeAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [activeView, setActiveView] = useState<WeeklyPlannerView>('planner');
  const [isMobileLayout, setIsMobileLayout] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [deferTarget, setDeferTarget] = useState<PlannerItem | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [plannerFilter, setPlannerFilter] = useState<'all' | 'focus' | 'top3' | 'stories'>('all');
  const [planningSummary, setPlanningSummary] = useState<{ acceptedMoves: number; acceptedDefers: number }>({
    acceptedMoves: 0,
    acceptedDefers: 0,
  });

  const weekStartMs = useMemo(() => dayStartMs(weekStart), [weekStart]);
  const weekEndMs = useMemo(() => dayStartMs(addDays(weekStart, 6)) + (24 * 60 * 60 * 1000) - 1, [weekStart]);
  const weekKey = useMemo(() => format(weekStart, "yyyy-'W'II"), [weekStart]);
  const dayColumns = useMemo(
    () => Array.from({ length: 7 }, (_, index) => new Date(dayStartMs(addDays(weekStart, index)))),
    [weekStart],
  );
  const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(activeFocusGoals), [activeFocusGoals]);
  const nextSprint = useMemo(() => nextSprintForDate(sprints as Sprint[], weekEndMs), [sprints, weekEndMs]);

  useEffect(() => {
    const update = () => setIsMobileLayout(window.innerWidth < 768);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setTasks([]);
      setStories([]);
      setGoals([]);
      return;
    }

    const taskQuery = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(400));
    const storyQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(400));
    const goalQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));

    const unsubTasks = onSnapshot(taskQuery, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
      rows = rows.filter((task: any) => currentPersona === 'work' ? task.persona === 'work' : task.persona == null || task.persona === 'personal');
      setTasks(rows);
    });
    const unsubStories = onSnapshot(storyQuery, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[];
      rows = rows.filter((story: any) => currentPersona === 'work' ? story.persona === 'work' : story.persona == null || story.persona === 'personal');
      setStories(rows);
    });
    const unsubGoals = onSnapshot(goalQuery, (snap) => {
      setGoals(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Goal[]);
    });

    return () => {
      unsubTasks();
      unsubStories();
      unsubGoals();
    };
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    let cancelled = false;
    const loadWeekData = async () => {
      if (!currentUser?.uid) {
        setCalendarBlocks([]);
        setScheduledInstances([]);
        setThemeAllocations([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [blocksSnap, instancesSnap, themeAllocationsSnap] = await Promise.all([
          getDocs(query(collection(db, 'calendar_blocks'), where('ownerUid', '==', currentUser.uid))),
          getDocs(query(collection(db, 'scheduled_instances'), where('ownerUid', '==', currentUser.uid))),
          getDoc(doc(db, 'theme_allocations', currentUser.uid)),
        ]);
        const blockRows = blocksSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((row: any) => {
            const start = Number(row.start || 0);
            return Number.isFinite(start) && start >= weekStartMs && start <= weekEndMs;
          }) as PlannerCalendarBlockRow[];

        const instanceRows = instancesSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((row: any) => {
            const raw = String(row.occurrenceDate || '').trim();
            if (!raw) return false;
            const normalized = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
            return normalized >= format(weekStart, 'yyyy-MM-dd') && normalized <= format(addDays(weekStart, 6), 'yyyy-MM-dd');
          }) as PlannerScheduledInstanceRow[];

        const themeAllocationsData = themeAllocationsSnap.exists() ? (themeAllocationsSnap.data() as any) : null;
        const weeklyOverrides = (themeAllocationsData?.weeklyOverrides && typeof themeAllocationsData.weeklyOverrides === 'object')
          ? themeAllocationsData.weeklyOverrides
          : {};
        const weekAllocations = Array.isArray(weeklyOverrides?.[format(weekStart, 'yyyy-MM-dd')])
          ? weeklyOverrides[format(weekStart, 'yyyy-MM-dd')]
          : Array.isArray(themeAllocationsData?.allocations)
            ? themeAllocationsData.allocations
            : [];

        const checkinDoc = await getDoc(doc(db, 'weekly_checkins', `${currentUser.uid}_${weekKey}`));
        const summary = (checkinDoc.data() as any)?.nextWeekPlanning || null;
        if (!cancelled) {
          setCalendarBlocks(blockRows);
          setScheduledInstances(instanceRows);
          setThemeAllocations(weekAllocations as ThemeAllocation[]);
          if (summary) {
            setPlanningSummary({
              acceptedMoves: Number(summary.acceptedMoves || 0),
              acceptedDefers: Number(summary.acceptedDefers || 0),
            });
            if (summary.view === 'planner' || summary.view === 'table') setActiveView(summary.view);
          } else {
            setPlanningSummary({ acceptedMoves: 0, acceptedDefers: 0 });
            setActiveView('planner');
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          console.error('Failed to load weekly planner data', error);
          setFeedback({ variant: 'danger', text: error?.message || 'Failed to load weekly planner data.' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadWeekData();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid, weekStart, weekStartMs, weekEndMs, weekKey]);

  const weekAssignedItems = useMemo(
    () =>
      buildPlannerItems({
        tasks,
        stories,
        goals,
        calendarBlocks,
        scheduledInstances,
        activeFocusGoalIds,
        rangeStartMs: weekStartMs,
        rangeEndMs: weekEndMs,
        includeUnscheduledTasks: true,
      }).filter((item) => item.kind !== 'event'),
    [tasks, stories, goals, calendarBlocks, scheduledInstances, activeFocusGoalIds, weekStartMs, weekEndMs],
  );

  const reviewCandidates = useMemo(
    () =>
      buildPlannerItems({
        tasks,
        stories,
        goals,
        calendarBlocks,
        scheduledInstances,
        activeFocusGoalIds,
        rangeStartMs: weekStartMs,
        rangeEndMs: weekEndMs,
        includeUnscheduledTasks: true,
      }).filter((item) => item.kind !== 'event'),
    [tasks, stories, goals, calendarBlocks, scheduledInstances, activeFocusGoalIds, weekStartMs, weekEndMs],
  );

  const dailyLoadHours = useMemo(() => {
    const map = new Map<string, number>();
    weekAssignedItems.forEach((item) => {
      const dayKey = item.dayKey;
      map.set(dayKey, (map.get(dayKey) || 0) + plannerItemPoints(item));
    });
    return map;
  }, [weekAssignedItems]);

  const dayCapacityByKey = useMemo(
    () => buildDayCapacityMap(dayColumns.map((date) => toDayKey(date)), weekAssignedItems, 8),
    [dayColumns, weekAssignedItems],
  );

  const filteredPlannerItems = useMemo(() => {
    return weekAssignedItems.filter((item) => {
      if (plannerFilter === 'focus') return item.isFocusAligned;
      if (plannerFilter === 'top3') return !!item.isTop3;
      if (plannerFilter === 'stories') return item.kind === 'story';
      return true;
    });
  }, [weekAssignedItems, plannerFilter]);

  const groupedPlannerItems = useMemo(() => {
    const grouped = new Map<string, Map<TimelineBucket, PlannerItem[]>>();
    dayColumns.forEach((date) => {
      grouped.set(toDayKey(date), new Map(bucketOrder.map((bucket) => [bucket, []])));
    });
    filteredPlannerItems.forEach((item) => {
      const dayKey = item.dayKey;
      if (!grouped.has(dayKey)) grouped.set(dayKey, new Map(bucketOrder.map((bucket) => [bucket, []])));
      const bucketMap = grouped.get(dayKey)!;
      const list = bucketMap.get(item.bucket) || [];
      list.push(item);
      bucketMap.set(item.bucket, list);
    });
    return grouped;
  }, [dayColumns, filteredPlannerItems]);

  const bucketLoadByDay = useMemo(() => {
    const grouped = new Map<string, Map<TimelineBucket, number>>();
    dayColumns.forEach((date) => grouped.set(toDayKey(date), new Map(bucketOrder.map((bucket) => [bucket, 0]))));
    weekAssignedItems.forEach((item) => {
      const dayKey = item.dayKey;
      if (!grouped.has(dayKey)) grouped.set(dayKey, new Map(bucketOrder.map((bucket) => [bucket, 0])));
      const bucketMap = grouped.get(dayKey)!;
      bucketMap.set(item.bucket, Number(bucketMap.get(item.bucket) || 0) + plannerItemPoints(item));
    });
    return grouped;
  }, [dayColumns, weekAssignedItems]);

  const themeAllocationByDay = useMemo(() => {
    const grouped = new Map<string, Map<string, Map<TimelineBucket, number>>>();
    dayColumns.forEach((date) => grouped.set(toDayKey(date), new Map()));
    themeAllocations.forEach((allocation) => {
      const day = dayColumns.find((date) => date.getDay() === Number(allocation.dayOfWeek));
      if (!day) return;
      const dayKey = toDayKey(day);
      const themeKey = normalizeThemeKey(allocation.theme, themePalette);
      if (!themeKey) return;
      const startMinutes = allocationToMinutes(allocation.startTime);
      const endMinutes = Math.max(startMinutes + 30, allocationToMinutes(allocation.endTime));
      const themeMap = grouped.get(dayKey) || new Map<string, Map<TimelineBucket, number>>();
      const bucketMap = themeMap.get(themeKey) || new Map<TimelineBucket, number>(bucketOrder.map((bucket) => [bucket, 0]));
      for (let cursor = startMinutes; cursor < endMinutes; cursor += 30) {
        const bucket = bucketForMinutes(cursor);
        bucketMap.set(bucket, Number(bucketMap.get(bucket) || 0) + 30);
      }
      themeMap.set(themeKey, bucketMap);
      grouped.set(dayKey, themeMap);
    });
    return grouped;
  }, [dayColumns, themeAllocations, themePalette]);

  function resolveItemThemeKey(item: PlannerItem) {
    return normalizeThemeKey(
      item.goalTheme
        ?? (item.rawStory as any)?.theme
        ?? (item.rawStory as any)?.themeId
        ?? (item.rawTask as any)?.theme
        ?? (item.rawTask as any)?.themeId
        ?? null,
      themePalette,
    );
  }

  function deriveAutoPlacement(item: PlannerItem, preferredDayMs?: number | null): PlannerRecommendation {
    const baseRecommendation = buildPlannerRecommendation({
      item,
      weekStartMs,
      weekEndMs,
      dailyLoadHours,
      nextSprint,
    });
    if (!preferredDayMs && (baseRecommendation.action === 'next_sprint' || baseRecommendation.action === 'next_recurrence')) {
      return baseRecommendation;
    }

    const itemPoints = plannerItemPoints(item);
    const itemThemeKey = resolveItemThemeKey(item);
    const preferredDayKey = preferredDayMs != null ? toDayKey(preferredDayMs) : null;
    const daysToInspect = preferredDayKey
      ? dayColumns.filter((date) => toDayKey(date) === preferredDayKey)
      : dayColumns;

    let best: { dayMs: number; bucket: TimelineBucket; score: number; themeMinutes: number; remaining: number } | null = null;

    daysToInspect.forEach((date, dayIndex) => {
      const dayKey = toDayKey(date);
      const dayCapacity = dayCapacityByKey.get(dayKey);
      const bucketLoad = bucketLoadByDay.get(dayKey) || new Map<TimelineBucket, number>(bucketOrder.map((bucket) => [bucket, 0]));
      const currentItemPoints = item.dayKey === dayKey ? itemPoints : 0;
      const projectedPoints = (dayCapacity?.plannedPoints || 0) - currentItemPoints + itemPoints;
      const remaining = (dayCapacity?.capacityPoints || 8) - projectedPoints;

      let targetBucket: TimelineBucket = item.timeOfDay || 'morning';
      let themeMinutes = 0;
      if (itemThemeKey) {
        const themeBuckets = themeAllocationByDay.get(dayKey)?.get(itemThemeKey) || null;
        if (themeBuckets) {
          let bestBucket: TimelineBucket | null = null;
          let bestMinutes = -1;
          bucketOrder.forEach((bucket) => {
            const minutes = Number(themeBuckets.get(bucket) || 0);
            if (minutes > bestMinutes) {
              bestMinutes = minutes;
              bestBucket = bucket;
            }
          });
          if (bestBucket) {
            targetBucket = bestBucket;
            themeMinutes = Math.max(0, bestMinutes);
          }
        }
      }
      if (!themeMinutes) {
        targetBucket = [...bucketOrder].sort((a, b) => Number(bucketLoad.get(a) || 0) - Number(bucketLoad.get(b) || 0))[0] || targetBucket;
      }

      const bucketLoadPoints = Number(bucketLoad.get(targetBucket) || 0) - (item.dayKey === dayKey && item.bucket === targetBucket ? itemPoints : 0);
      let score = 0;
      score += preferredDayKey ? 200 : Math.max(0, 40 - dayIndex * 4);
      score += Math.min(themeMinutes, 180);
      score += Math.max(0, 60 - bucketLoadPoints * 10);
      score += remaining >= 0 ? Math.min(remaining * 12, 90) : -220 - Math.abs(remaining) * 40;
      if (item.isFocusAligned) score += 15;

      if (!best || score > best.score) {
        best = {
          dayMs: dayStartMs(date),
          bucket: targetBucket,
          score,
          themeMinutes,
          remaining,
        };
      }
    });

    if (!best) return baseRecommendation;

    const dayLabel = format(new Date(best.dayMs), 'EEE d MMM');
    const rationaleParts = [];
    if (best.themeMinutes > 0 && itemThemeKey) rationaleParts.push(`closest ${itemThemeKey} allocation`);
    if (best.remaining >= 0) rationaleParts.push(`${Math.max(0, best.remaining).toFixed(1)} pts free after placement`);
    if (!rationaleParts.length) rationaleParts.push('best fit for day load');
    return {
      action: 'move_day' as const,
      label: `Place on ${dayLabel} ${bucketLabel(best.bucket).toLowerCase()}`,
      rationale: `Uses ${rationaleParts.join(' and ')}.`,
      targetDateMs: best.dayMs,
      targetBucket: best.bucket,
    };
  }

  const recommendationByItemId = useMemo(() => {
    const next = new Map<string, PlannerRecommendation>();
    reviewCandidates.forEach((item) => {
      next.set(item.id, deriveAutoPlacement(item));
    });
    return next;
  }, [reviewCandidates, weekStartMs, weekEndMs, dailyLoadHours, nextSprint, dayCapacityByKey, bucketLoadByDay, themeAllocationByDay, themePalette, dayColumns]);

  const persistPlanningSummary = async (updates?: Partial<{ acceptedMoves: number; acceptedDefers: number; view: WeeklyPlannerView }>) => {
    if (!currentUser?.uid) return;
    const acceptedMoves = updates?.acceptedMoves ?? planningSummary.acceptedMoves;
    const acceptedDefers = updates?.acceptedDefers ?? planningSummary.acceptedDefers;
    await setDoc(doc(db, 'weekly_checkins', `${currentUser.uid}_${weekKey}`), {
      ownerUid: currentUser.uid,
      weekKey,
      nextWeekPlanning: {
        completedAt: new Date(),
        acceptedMoves,
        acceptedDefers,
        view: updates?.view || activeView,
        storageScope,
        updatedAt: new Date(),
      },
      updatedAt: new Date(),
    }, { merge: true });
    const summary = { acceptedMoves, acceptedDefers, weekKey };
    setPlanningSummary({ acceptedMoves, acceptedDefers });
    onPlanningSaved?.(summary);
  };

  const updateScheduledInstanceTiming = async (item: PlannerItem, targetDateMs: number, targetBucket: TimelineBucket) => {
    if (!item.scheduledInstanceId) return;
    const existingOccurrence = scheduledInstances.find((instance) => instance.id === item.scheduledInstanceId)?.occurrenceDate;
    const durationMinutes = Math.max(
      15,
      Math.round((((item.scheduledBlockEnd || 0) - (item.scheduledBlockStart || 0)) / 60000) || Number((item.rawTask as any)?.estimateMin || 0) || 30),
    );
    const { startMs, endMs } = buildTargetTiming(targetDateMs, targetBucket, durationMinutes);
    await updateDoc(doc(db, 'scheduled_instances', item.scheduledInstanceId), {
      occurrenceDate: formatOccurrenceKey(existingOccurrence, targetDateMs),
      dayKey: toDayKey(targetDateMs),
      timeOfDay: targetBucket,
      plannedStart: new Date(startMs).toISOString(),
      plannedEnd: new Date(endMs).toISOString(),
      updatedAt: Date.now(),
    });
  };

  const updateGroupedTiming = async (item: PlannerItem, targetDateMs: number, targetBucket: TimelineBucket) => {
    const children = Array.isArray(item.childItems) ? item.childItems : [];
    await Promise.all(children.map((child) => updateScheduledInstanceTiming(child, targetDateMs, targetBucket)));
  };

  const shouldPromptIntelligentDefer = (item: PlannerItem, targetDateMs: number) => {
    if (item.childItems?.length) return false;
    if (!item.rawTask && !item.rawStory) return false;
    const targetDayKey = toDayKey(targetDateMs);
    const summary = dayCapacityByKey.get(targetDayKey);
    const points = plannerItemPoints(item);
    const currentPoints = item.dayKey === targetDayKey ? points : 0;
    const projectedPoints = (summary?.plannedPoints || 0) - currentPoints + points;
    const overCapacity = !!summary && projectedPoints > summary.capacityPoints + 0.01;
    const outsideFocus = activeFocusGoalIds.size > 0 && !item.isFocusAligned;
    if (!overCapacity && !outsideFocus) return false;
    const reasons: string[] = [];
    if (overCapacity && summary) {
      reasons.push(`${targetDayKey} would be ${projectedPoints.toFixed(1)}/${summary.capacityPoints.toFixed(1)} pts`);
    }
    if (outsideFocus) {
      reasons.push('this item is outside active focus goals');
    }
    setFeedback({
      variant: 'warning',
      text: `${item.title} should be deferred intelligently because ${reasons.join(' and ')}.`,
    });
    setMoveTarget(null);
    setDeferTarget(item);
    return true;
  };

  const applyMove = async (item: PlannerItem, targetDateMs: number, targetBucket: TimelineBucket, recommendation?: PlannerRecommendation | null) => {
    if (!currentUser?.uid) return;
    if ((recommendation?.action == null || recommendation.action === 'move_day') && shouldPromptIntelligentDefer(item, targetDateMs)) {
      return;
    }
    setApplyingKey(item.id);
    try {
      if (item.childItems?.length) {
        await updateGroupedTiming(item, targetDateMs, targetBucket);
        const acceptedMoves = planningSummary.acceptedMoves + 1;
        await persistPlanningSummary({ acceptedMoves });
        setFeedback({
          variant: 'success',
          text: recommendation?.rationale
            ? `${item.title} moved to ${new Date(targetDateMs).toLocaleDateString()} ${bucketLabel(targetBucket).toLowerCase()}. ${recommendation.rationale}`
            : `${item.title} moved to ${new Date(targetDateMs).toLocaleDateString()} ${bucketLabel(targetBucket).toLowerCase()}.`,
        });
      } else if (item.scheduledInstanceId) {
        await updateScheduledInstanceTiming(item, targetDateMs, targetBucket);
        const acceptedMoves = planningSummary.acceptedMoves + 1;
        await persistPlanningSummary({ acceptedMoves });
        setFeedback({
          variant: 'success',
          text: recommendation?.rationale
            ? `${item.title} moved to ${new Date(targetDateMs).toLocaleDateString()} ${bucketLabel(targetBucket).toLowerCase()}. ${recommendation.rationale}`
            : `${item.title} moved to ${new Date(targetDateMs).toLocaleDateString()} ${bucketLabel(targetBucket).toLowerCase()}.`,
        });
      } else if (item.rawTask) {
        const result = await schedulePlannerItemMutation({
          itemType: 'task',
          itemId: item.rawTask.id,
          targetDateMs,
          targetBucket,
          intent: recommendation?.action === 'next_sprint' ? 'defer' : 'move',
          source: 'weekly_planner',
          rationale: recommendation?.rationale || null,
          linkedBlockId: item.scheduledBlockId || null,
          targetSprintId: recommendation?.action === 'next_sprint' ? (nextSprint?.id || null) : null,
          durationMinutes: Math.max(
            15,
            Math.round((((item.scheduledBlockEnd || 0) - (item.scheduledBlockStart || 0)) / 60000) || Number((item.rawTask as any)?.estimateMin || 0) || 30),
          ),
        });
        const acceptedMoves = planningSummary.acceptedMoves + 1;
        await persistPlanningSummary({ acceptedMoves });
        setFeedback({
          variant: 'success',
          text: recommendation?.rationale
            ? `${item.title} moved to ${new Date(result.appliedStartMs).toLocaleDateString()} ${bucketLabel((result.appliedBucket || targetBucket) as TimelineBucket).toLowerCase()}. ${recommendation.rationale}`
            : `${item.title} moved to ${new Date(result.appliedStartMs).toLocaleDateString()} ${bucketLabel((result.appliedBucket || targetBucket) as TimelineBucket).toLowerCase()}.`,
        });
      } else if (item.rawStory) {
        const result = await schedulePlannerItemMutation({
          itemType: 'story',
          itemId: item.rawStory.id,
          targetDateMs,
          targetBucket,
          intent: recommendation?.action === 'next_sprint' ? 'defer' : 'move',
          source: 'weekly_planner',
          rationale: recommendation?.rationale || null,
          linkedBlockId: item.scheduledBlockId || null,
          targetSprintId: recommendation?.action === 'next_sprint' ? (nextSprint?.id || null) : null,
          durationMinutes: Math.max(
            15,
            Math.round((((item.scheduledBlockEnd || 0) - (item.scheduledBlockStart || 0)) / 60000) || Number((item.rawStory as any)?.estimateMin || 0) || 60),
          ),
        });
        const acceptedMoves = planningSummary.acceptedMoves + 1;
        await persistPlanningSummary({ acceptedMoves });
        setFeedback({
          variant: 'success',
          text: recommendation?.rationale
            ? `${item.title} moved to ${new Date(result.appliedStartMs).toLocaleDateString()} ${bucketLabel((result.appliedBucket || targetBucket) as TimelineBucket).toLowerCase()}. ${recommendation.rationale}`
            : `${item.title} moved to ${new Date(result.appliedStartMs).toLocaleDateString()} ${bucketLabel((result.appliedBucket || targetBucket) as TimelineBucket).toLowerCase()}.`,
        });
      } else {
        const acceptedMoves = planningSummary.acceptedMoves + 1;
        await persistPlanningSummary({ acceptedMoves });
        setFeedback({
          variant: 'success',
          text: recommendation?.rationale
            ? `${item.title} moved to ${new Date(targetDateMs).toLocaleDateString()} ${bucketLabel(targetBucket).toLowerCase()}. ${recommendation.rationale}`
            : `${item.title} moved to ${new Date(targetDateMs).toLocaleDateString()} ${bucketLabel(targetBucket).toLowerCase()}.`,
        });
      }
      setMoveTarget(null);
    } catch (error: any) {
      console.error('Failed to move planner item', error);
      setFeedback({ variant: 'danger', text: error?.message || 'Failed to move planner item.' });
    } finally {
      setApplyingKey(null);
    }
  };

  const applyDayAutoMove = async (item: PlannerItem, targetDateMs: number) => {
    const recommendation = deriveAutoPlacement(item, targetDateMs);
    if (recommendation.targetDateMs == null || recommendation.targetBucket == null) {
      setFeedback({ variant: 'warning', text: `No suitable placement was available for ${item.title}.` });
      return;
    }
    await applyMove(item, recommendation.targetDateMs, recommendation.targetBucket, recommendation);
  };

  const applyRecommendation = async (item: PlannerItem, recommendation: PlannerRecommendation) => {
    if (recommendation.action === 'keep_week') {
      const acceptedMoves = planningSummary.acceptedMoves + 1;
      await persistPlanningSummary({ acceptedMoves });
      setFeedback({ variant: 'success', text: `${item.title} kept in this week.` });
      return;
    }
    if (recommendation.targetDateMs == null || recommendation.targetBucket == null) {
      setFeedback({ variant: 'warning', text: 'No actionable recommendation was available.' });
      return;
    }
    if (recommendation.action === 'next_recurrence') {
      setApplyingKey(item.id);
      try {
        if (item.childItems?.length) {
          await updateGroupedTiming(item, recommendation.targetDateMs, recommendation.targetBucket || item.timeOfDay);
        } else if (item.scheduledInstanceId) {
          await updateScheduledInstanceTiming(item, recommendation.targetDateMs, recommendation.targetBucket || item.timeOfDay);
        } else if (item.rawTask) {
          await updateDoc(doc(db, 'tasks', item.rawTask.id), {
            deferredUntil: recommendation.targetDateMs,
            deferredReason: recommendation.rationale,
            deferredBy: 'weekly_planner',
            deferredAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        const acceptedDefers = planningSummary.acceptedDefers + 1;
        await persistPlanningSummary({ acceptedDefers });
        setFeedback({ variant: 'success', text: `${item.title} deferred to its next sensible recurrence.` });
      } catch (error: any) {
        console.error('Failed to apply recurring defer', error);
        setFeedback({ variant: 'danger', text: error?.message || 'Failed to defer recurring item.' });
      } finally {
        setApplyingKey(null);
      }
      return;
    }
    await applyMove(item, recommendation.targetDateMs, recommendation.targetBucket, recommendation);
  };

  const renderPlannerCard = (item: PlannerItem) => {
    const recommendation = recommendationByItemId.get(item.id) || null;
    const plannerMode = activeView === 'planner';
    return (
      <div
        key={item.id}
        draggable={!isMobileLayout && item.kind !== 'event'}
        onDragStart={() => setDragItemId(item.id)}
        onDragEnd={() => setDragItemId(null)}
      >
        <PlannerWorkCard
          item={item}
          context="weekly"
          isMobileLayout={isMobileLayout}
          applyingKey={applyingKey}
          showDoneControl={false}
          canEditState={false}
          showInlineRecommendation={!plannerMode && !!recommendation}
          recommendation={recommendation}
          canShowActions={!plannerMode || isMobileLayout}
          expanded={!!expandedGroups[item.id]}
          onToggleExpanded={(nextItem) => setExpandedGroups((prev) => ({ ...prev, [nextItem.id]: !prev[nextItem.id] }))}
          onMove={(nextItem) => setMoveTarget({ item: nextItem, recommendation: deriveAutoPlacement(nextItem) })}
          onDefer={(nextItem) => {
            if (nextItem.childItems?.length) return;
            const recurringRecommendation = nextItem.kind === 'chore'
              ? deriveAutoPlacement(nextItem)
              : null;
            if (recurringRecommendation?.action === 'next_recurrence') {
              void applyRecommendation(nextItem, recurringRecommendation);
              return;
            }
            setDeferTarget(nextItem);
          }}
          onAcceptRecommendation={(nextItem) => {
            const nextRecommendation = recommendationByItemId.get(nextItem.id);
            if (nextRecommendation) void applyRecommendation(nextItem, nextRecommendation);
          }}
        />
      </div>
    );
  };

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-3">
        <div>
          <div className="fw-semibold">{title}</div>
          <div className="text-muted small">
            {format(weekStart, 'dd MMM')} – {format(addDays(weekStart, 6), 'dd MMM yyyy')}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Badge bg="secondary">{reviewCandidates.length} items</Badge>
          <Badge bg="info">{planningSummary.acceptedMoves} planned</Badge>
          <Badge bg="warning" text="dark">{planningSummary.acceptedDefers} deferred</Badge>
        </div>
      </div>

      {feedback && (
        <Alert variant={feedback.variant} dismissible onClose={() => setFeedback(null)} className="py-2">
          {feedback.text}
        </Alert>
      )}

      <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
        <Button
          size="sm"
          variant={activeView === 'table' ? 'primary' : 'outline-primary'}
          onClick={() => {
            setActiveView('table');
            void persistPlanningSummary({ view: 'table' });
          }}
        >
          Table
        </Button>
        <Button
          size="sm"
          variant={activeView === 'planner' ? 'primary' : 'outline-primary'}
          onClick={() => {
            setActiveView('planner');
            void persistPlanningSummary({ view: 'planner' });
          }}
        >
          Planner
        </Button>
        {activeView === 'planner' && (
          <>
            <Button size="sm" variant={plannerFilter === 'all' ? 'dark' : 'outline-dark'} onClick={() => setPlannerFilter('all')}>
              All
            </Button>
            <Button size="sm" variant={plannerFilter === 'focus' ? 'success' : 'outline-success'} onClick={() => setPlannerFilter('focus')}>
              Focus
            </Button>
            <Button size="sm" variant={plannerFilter === 'top3' ? 'danger' : 'outline-danger'} onClick={() => setPlannerFilter('top3')}>
              Top 3
            </Button>
            <Button size="sm" variant={plannerFilter === 'stories' ? 'info' : 'outline-info'} onClick={() => setPlannerFilter('stories')}>
              Stories
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner size="sm" animation="border" /> Loading weekly planner…
        </div>
      ) : activeView === 'table' ? (
        isMobileLayout ? (
          <div className="d-flex flex-column gap-2">
            {reviewCandidates.map((item) => {
              const recommendation = recommendationByItemId.get(item.id) || null;
              return (
                <Card key={item.id} className="shadow-sm border">
                  <Card.Body className="p-3">
                    <div className="fw-semibold">{item.title}</div>
                    <div className="text-muted small mb-2">
                      {[item.ref, item.statusLabel, item.goalTitle || 'No linked goal'].filter(Boolean).join(' · ')}
                    </div>
                    {recommendation && (
                      <div className="small mb-2">
                        <div className="fw-semibold d-inline-flex align-items-center gap-1"><Sparkles size={13} /> {recommendation.label}</div>
                        <div className="text-muted">{recommendation.rationale}</div>
                      </div>
                    )}
                    <div className="d-flex gap-2 flex-wrap">
                      {recommendation && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={applyingKey === item.id}
                          onClick={() => void applyRecommendation(item, recommendation)}
                        >
                          {applyingKey === item.id ? 'Applying…' : 'Accept'}
                        </Button>
                      )}
                      <Button size="sm" variant="outline-secondary" onClick={() => setMoveTarget({ item, recommendation: deriveAutoPlacement(item) })}>
                        Move
                      </Button>
                      <Button size="sm" variant="outline-warning" onClick={() => setDeferTarget(item)}>
                        More options
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              );
            })}
          </div>
        ) : (
          <Table hover size="sm" className="align-middle">
            <thead>
              <tr>
                <th>Item</th>
                <th>Current</th>
                <th>Goal</th>
                <th>Recommendation</th>
                <th className="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {reviewCandidates.map((item) => {
                const recommendation = recommendationByItemId.get(item.id) || null;
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="fw-semibold small">{item.title}</div>
                      <div className="text-muted" style={{ fontSize: '0.74rem' }}>
                        {[item.ref, item.statusLabel].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="small text-muted">{item.timeLabel}</td>
                    <td className="small text-muted">{item.goalTitle || 'No linked goal'}</td>
                    <td>
                      {recommendation ? (
                        <>
                          <div className="fw-semibold small">{recommendation.label}</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>{recommendation.rationale}</div>
                        </>
                      ) : (
                        <span className="text-muted small">No recommendation</span>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="d-inline-flex gap-1">
                        {recommendation && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={applyingKey === item.id}
                            onClick={() => void applyRecommendation(item, recommendation)}
                          >
                            {applyingKey === item.id ? 'Applying…' : 'Accept'}
                          </Button>
                        )}
                        <Button size="sm" variant="outline-secondary" onClick={() => setMoveTarget({ item, recommendation: deriveAutoPlacement(item) })}>
                          <MoveRight size={14} />
                        </Button>
                        <Button size="sm" variant="outline-warning" onClick={() => setDeferTarget(item)}>
                          <Clock3 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )
      ) : (
        isMobileLayout ? (
          <div className="d-flex flex-column gap-3">
            {dayColumns.map((date) => {
              const dayKey = toDayKey(date);
              const bucketMap = groupedPlannerItems.get(dayKey);
              const items = bucketOrder.flatMap((bucket) => bucketMap?.get(bucket) || []);
              const capacity = dayCapacityByKey.get(dayKey);
              return (
                <Card key={dayKey} className="shadow-sm border">
                  <Card.Header className="d-flex align-items-center justify-content-between gap-2">
                    <span className="fw-semibold">{format(date, 'EEEE d MMM')}</span>
                    {capacity && (
                      <Badge bg={capacity.overCapacity ? 'danger' : capacity.remainingPoints <= 2 ? 'warning' : 'success'} text={capacity.remainingPoints <= 2 && !capacity.overCapacity ? 'dark' : undefined}>
                        {capacity.remainingPoints.toFixed(1)} pts free
                      </Badge>
                    )}
                  </Card.Header>
                  <Card.Body className="d-flex flex-column gap-2">
                    {items.length === 0 ? (
                      <div className="text-muted small">No items planned.</div>
                    ) : (
                      items.map((item) => renderPlannerCard(item))
                    )}
                  </Card.Body>
                </Card>
              );
            })}
          </div>
        ) : (
          <Row className="g-2">
            {dayColumns.map((date) => {
              const dayKey = toDayKey(date);
              const bucketMap = groupedPlannerItems.get(dayKey);
              const capacity = dayCapacityByKey.get(dayKey);
              const dayItems = bucketOrder.flatMap((bucket) => bucketMap?.get(bucket) || []);
              return (
                <Col key={dayKey}>
                  <Card className="shadow-sm border h-100">
                    <Card.Header className="d-flex flex-column gap-1">
                      <div className="d-flex align-items-start justify-content-between gap-2">
                        <div>
                          <div className="fw-semibold small">{format(date, 'EEE d MMM')}</div>
                          <div className="text-muted" style={{ fontSize: '0.68rem' }}>
                            {dayItems.length} items planned · drop on day to auto-place
                          </div>
                        </div>
                        {capacity && (
                          <div className="text-end" style={{ lineHeight: 1.1 }}>
                            <div className={`small fw-semibold text-${capacity.overCapacity ? 'danger' : capacity.remainingPoints <= 2 ? 'warning' : 'success'}`}>
                              {capacity.remainingPoints.toFixed(1)} pts free
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.68rem' }}>
                              {capacity.plannedPoints.toFixed(1)}/{capacity.capacityPoints.toFixed(1)} pts
                            </div>
                          </div>
                        )}
                      </div>
                    </Card.Header>
                    <Card.Body
                      className="p-2 d-flex flex-column gap-2"
                      onDragOver={(event) => {
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const item = weekAssignedItems.find((row) => row.id === dragItemId);
                        if (item) {
                          void applyDayAutoMove(item, dayStartMs(date));
                        }
                        setDragItemId(null);
                      }}
                    >
                      {bucketOrder.map((bucket) => {
                        const items = bucketMap?.get(bucket) || [];
                        return (
                          <div
                            key={`${dayKey}-${bucket}`}
                            className="border rounded p-2"
                            onDragOver={(event) => {
                              event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const item = weekAssignedItems.find((row) => row.id === dragItemId);
                              if (item) {
                                void applyMove(item, dayStartMs(date), bucket, null);
                              }
                              setDragItemId(null);
                            }}
                          >
                            <div className="text-uppercase text-muted fw-semibold mb-1" style={{ fontSize: '0.68rem' }}>
                              {bucketLabel(bucket)}
                            </div>
                            <div className="d-flex flex-column gap-1">
                              {items.length === 0 ? (
                                <div className="text-muted" style={{ fontSize: '0.72rem' }}>Drop here</div>
                              ) : (
                                items.map((item) => renderPlannerCard(item))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )
      )}

      <Modal show={!!moveTarget} onHide={() => setMoveTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 16 }}>Move planner item</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="fw-semibold mb-2">{moveTarget?.item.title}</div>
          <div className="text-muted small mb-3">
            {moveTarget?.recommendation?.rationale || 'Pick a day and time bucket for this item.'}
          </div>
          <Form.Group className="mb-3">
            <Form.Label className="small text-muted">Day</Form.Label>
            <Form.Select
              value={moveTarget?.recommendation?.targetDateMs != null ? format(new Date(moveTarget.recommendation.targetDateMs), 'yyyy-MM-dd') : format(weekStart, 'yyyy-MM-dd')}
              onChange={(e) => {
                if (!moveTarget) return;
                const parsed = Date.parse(`${e.target.value}T12:00:00`);
                const nextRecommendation = deriveAutoPlacement(moveTarget.item, parsed);
                setMoveTarget({
                  ...moveTarget,
                  recommendation: {
                    ...(moveTarget.recommendation || { action: 'move_day', label: 'Move day', rationale: '' }),
                    ...nextRecommendation,
                    targetDateMs: parsed,
                    targetBucket: nextRecommendation.targetBucket || moveTarget.recommendation?.targetBucket || 'morning',
                  },
                });
              }}
            >
              {dayColumns.map((date) => (
                <option key={toDayKey(date)} value={format(date, 'yyyy-MM-dd')}>
                  {format(date, 'EEEE d MMM')}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="small text-muted">Time of day</Form.Label>
            <Form.Select
              value={moveTarget?.recommendation?.targetBucket || 'morning'}
              onChange={(e) => {
                if (!moveTarget) return;
                setMoveTarget({
                  ...moveTarget,
                  recommendation: {
                    ...(moveTarget.recommendation || { action: 'move_day', label: 'Move day', rationale: '' }),
                    targetDateMs: moveTarget.recommendation?.targetDateMs || dayStartMs(weekStart),
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
          <Button variant="secondary" onClick={() => setMoveTarget(null)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!moveTarget?.recommendation?.targetDateMs || !moveTarget?.recommendation?.targetBucket || applyingKey === moveTarget?.item.id}
            onClick={() => moveTarget && moveTarget.recommendation?.targetDateMs != null && moveTarget.recommendation?.targetBucket != null
              ? void applyMove(moveTarget.item, moveTarget.recommendation.targetDateMs, moveTarget.recommendation.targetBucket, moveTarget.recommendation)
              : undefined}
          >
            {applyingKey === moveTarget?.item.id ? 'Moving…' : 'Save move'}
          </Button>
        </Modal.Footer>
      </Modal>

      {deferTarget && (
        <DeferItemModal
          show={!!deferTarget}
          onHide={() => setDeferTarget(null)}
          itemType={deferTarget.kind === 'story' ? 'story' : 'task'}
          itemId={deferTarget.sourceId || ''}
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
            setApplyingKey(deferTarget.id);
            try {
              const durationMinutes = Math.max(
                15,
                Math.round((((deferTarget.scheduledBlockEnd || 0) - (deferTarget.scheduledBlockStart || 0)) / 60000)
                  || Number((deferTarget.rawTask as any)?.estimateMin || (deferTarget.rawStory as any)?.estimateMin || 0)
                  || 30),
              );
              if (deferTarget.rawTask) {
                await schedulePlannerItemMutation({
                  itemType: 'task',
                  itemId: deferTarget.rawTask.id,
                  targetDateMs: payload.dateMs,
                  targetBucket: deferTarget.timeOfDay || null,
                  intent: 'defer',
                  source: payload.source || 'weekly_planner',
                  rationale: payload.rationale,
                  linkedBlockId: deferTarget.scheduledBlockId || null,
                  durationMinutes,
                });
              } else if (deferTarget.rawStory) {
                await schedulePlannerItemMutation({
                  itemType: 'story',
                  itemId: deferTarget.rawStory.id,
                  targetDateMs: payload.dateMs,
                  targetBucket: deferTarget.timeOfDay || null,
                  intent: 'defer',
                  source: payload.source || 'weekly_planner',
                  rationale: payload.rationale,
                  linkedBlockId: deferTarget.scheduledBlockId || null,
                  durationMinutes,
                });
              }
              const acceptedDefers = planningSummary.acceptedDefers + 1;
              await persistPlanningSummary({ acceptedDefers });
              setFeedback({ variant: 'success', text: `${deferTarget.title} deferred.` });
            } finally {
              setApplyingKey(null);
              setDeferTarget(null);
            }
          }}
        />
      )}
    </div>
  );
};

export default WeeklyPlannerSurface;
