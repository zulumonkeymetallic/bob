import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format, startOfDay, endOfDay } from 'date-fns';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { schedulerCollections, type ScheduledInstanceModel } from '../../domain/scheduler/repository';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import type { Goal, Story, Task } from '../../types';
import EditTaskModal from '../EditTaskModal';
import EditStoryModal from '../EditStoryModal';

type CheckInItemType = 'block' | 'instance' | 'habit' | 'task' | 'chore' | 'routine';

interface DailyCheckInItem {
  key: string;
  type: CheckInItemType;
  title: string;
  theme?: string | null;
  sourceType?: string | null;
  start?: number | null;
  end?: number | null;
  durationMin?: number | null;
  storyId?: string | null;
  storyRef?: string | null;
  taskId?: string | null;
  taskRef?: string | null;
  habitId?: string | null;
  goalId?: string | null;
  goalTitle?: string | null;
  taskType?: string | null;
  sourceId?: string | null;
  completed: boolean;
  completedAt?: number | null;
  completedBy?: 'user' | 'mac_sync' | 'auto' | null;
  lastDoneAt?: number | null;
  note?: string;
  noteAt?: number | null;
  lastComment?: string;
  lastCommentAt?: number | null;
  progressPct?: number | null;
  points?: number | null;
  isOverdue?: boolean;
}

interface DailyCheckInDoc {
  id: string;
  ownerUid: string;
  dateKey: string;
  dateMs: number;
  items: DailyCheckInItem[];
  completedCount: number;
  plannedCount: number;
  createdAt?: any;
  updatedAt?: any;
}

const DAY_FORMAT = 'yyyyMMdd';

interface HealthSnapshot {
  // source flags
  healthkitStatus?: string;
  // steps
  healthkitStepsToday?: number;
  healthkitStepGoal?: number;
  manualStepsToday?: number;
  // distance and workout time
  healthkitDistanceKmToday?: number;
  manualDistanceKmToday?: number;
  healthkitWorkoutMinutesToday?: number;
  manualWorkoutMinutesToday?: number;
  // sleep
  healthkitSleepMinutes?: number;
  manualSleepMinutes?: number;
  // macros
  healthkitCaloriesTodayKcal?: number;
  healthkitProteinTodayG?: number;
  healthkitFatTodayG?: number;
  healthkitCarbsTodayG?: number;
  manualCaloriesKcal?: number;
  manualProteinG?: number;
  manualFatG?: number;
  manualCarbsG?: number;
  // body composition
  healthkitWeightKg?: number;
  manualWeightKg?: number;
  healthkitBodyFatPct?: number;
  manualBodyFatPct?: number;
  // readiness
  healthkitReadinessScore?: number;
  healthkitReadinessLabel?: string;
}

/** Keywords that indicate a routine item tracks a specific health metric */
const HEALTH_ROUTINE_KEYWORDS = {
  sleep: ['sleep', 'retainer', 'bed routine', 'bedtime', 'wind down'],
  steps: ['run', 'walk', 'step', '5k', 'parkrun', 'jog', 'cycling', 'cycle', 'swim'],
  macros: ['protein', 'macro', 'nutrition', 'diet', 'calorie', 'eating'],
};

function matchesHealthKeyword(title: string, category: keyof typeof HEALTH_ROUTINE_KEYWORDS): boolean {
  const lower = title.toLowerCase();
  return HEALTH_ROUTINE_KEYWORDS[category].some((kw) => lower.includes(kw));
}

/** Return yesterday's Date */
function getYesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

/** Default to yesterday when it's before 8 pm, otherwise today */
function getDefaultDate(): Date {
  return new Date().getHours() < 20 ? getYesterday() : new Date();
}

interface CheckInDailyProps {
  embedded?: boolean;
  fixedDate?: Date;
}

const CheckInDaily: React.FC<CheckInDailyProps> = ({ embedded = false, fixedDate }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [date, setDate] = useState<Date>(() => fixedDate || getDefaultDate());
  const [yesterdayWarning, setYesterdayWarning] = useState<string | null>(null);
  const [items, setItems] = useState<DailyCheckInItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialItemsRef = useRef<Map<string, DailyCheckInItem>>(new Map());

  // Health data state
  const [health, setHealth] = useState<HealthSnapshot>({});
  const [manualInputs, setManualInputs] = useState<Partial<{
    sleepH: string;
    steps: string;
    distanceKm: string;
    workoutMin: string;
    calories: string;
    protein: string;
    fat: string;
    carbs: string;
    weightKg: string;
    bodyFatPct: string;
  }>>({});
  const [healthSaving, setHealthSaving] = useState(false);
  const [healthSaved, setHealthSaved] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [quickEditTask, setQuickEditTask] = useState<Task | null>(null);
  const [quickEditStory, setQuickEditStory] = useState<Story | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);

  const getEffectiveType = (item: DailyCheckInItem): string => String(item.taskType || item.sourceType || item.type || '').toLowerCase();

  const supportsProgressForItem = (item: DailyCheckInItem): boolean => {
    const effectiveType = getEffectiveType(item);
    const isRecurringLike = ['chore', 'routine', 'habit'].includes(effectiveType);
    return !!(item.storyId || (item.taskId && !isRecurringLike));
  };

  const supportsCommentsForItem = (item: DailyCheckInItem): boolean => supportsProgressForItem(item);

  const hydrateLastComments = useCallback(async (sourceItems: DailyCheckInItem[]) => {
    if (!currentUser?.uid || !Array.isArray(sourceItems) || sourceItems.length === 0) return sourceItems;

    const entities = sourceItems
      .filter((item) => supportsCommentsForItem(item))
      .map((item) => ({
        entityId: String(item.storyId || item.taskId || '').trim(),
        entityType: item.storyId ? 'story' as const : 'task' as const,
      }))
      .filter((entry) => !!entry.entityId);

    if (!entities.length) return sourceItems;

    const latestMap = await ActivityStreamService.getLatestNotesForEntities(currentUser.uid, entities);

    return sourceItems.map((item) => {
      if (!supportsCommentsForItem(item)) return { ...item, lastComment: undefined, lastCommentAt: null };
      const entityId = String(item.storyId || item.taskId || '').trim();
      const latest = latestMap.get(entityId);
      if (!latest) return item;
      return {
        ...item,
        lastComment: latest.noteContent,
        lastCommentAt: latest.timestampMs,
      };
    });
  }, [currentUser]);

  const isIndexError = (err: any): boolean => {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('index') || msg.includes('failed_precondition');
  };
  const isPermissionDenied = (err: any): boolean => {
    const code = String(err?.code || '').toLowerCase();
    const msg = String(err?.message || err || '').toLowerCase();
    return code === 'permission-denied' || msg.includes('permission-denied') || msg.includes('insufficient permissions');
  };

  const resolveTimestampMs = (value: any): number | null => {
    if (!value) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') {
      const dateValue = value.toDate();
      return dateValue instanceof Date ? dateValue.getTime() : null;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (value.seconds != null) {
      return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
    }
    return null;
  };

  const dateKey = useMemo(() => format(date, DAY_FORMAT), [date]);
  const dayStart = useMemo(() => startOfDay(date), [date]);
  const dayEnd = useMemo(() => endOfDay(date), [date]);

  useEffect(() => {
    if (fixedDate) {
      setDate(fixedDate);
    }
  }, [fixedDate]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setGoals([]);
      return;
    }
    const goalQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      ...(currentPersona ? [where('persona', '==', currentPersona)] : []),
    );
    getDocs(goalQuery)
      .then((snap) => {
        setGoals(snap.docs.map((goalDoc) => ({ id: goalDoc.id, ...(goalDoc.data() as any) })) as Goal[]);
      })
      .catch(() => {
        setGoals([]);
      });
  }, [currentPersona, currentUser?.uid]);

  const openTaskEdit = useCallback(async (item: DailyCheckInItem) => {
    if (!item.taskId && !item.taskRef) return;

    try {
      if (item.taskId) {
        const snap = await getDoc(doc(db, 'tasks', item.taskId));
        if (snap.exists()) {
          setQuickEditTask({ id: snap.id, ...(snap.data() as any) } as Task);
          return;
        }
      }

      if (!currentUser?.uid || !item.taskRef) return;
      const byRef = await getDocs(query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('ref', '==', item.taskRef),
        limit(1),
      ));
      if (!byRef.empty) {
        const found = byRef.docs[0];
        setQuickEditTask({ id: found.id, ...(found.data() as any) } as Task);
        return;
      }

      const byReference = await getDocs(query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('reference', '==', item.taskRef),
        limit(1),
      ));
      if (!byReference.empty) {
        const found = byReference.docs[0];
        setQuickEditTask({ id: found.id, ...(found.data() as any) } as Task);
      }
    } catch (error) {
      console.warn('Failed to open task quick edit', error);
    }
  }, [currentUser?.uid]);

  const openStoryEdit = useCallback(async (item: DailyCheckInItem) => {
    if (!item.storyId && !item.storyRef) return;

    try {
      if (item.storyId) {
        const snap = await getDoc(doc(db, 'stories', item.storyId));
        if (snap.exists()) {
          setQuickEditStory({ id: snap.id, ...(snap.data() as any) } as Story);
          return;
        }
      }

      if (!currentUser?.uid || !item.storyRef) return;
      const byRef = await getDocs(query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('ref', '==', item.storyRef),
        limit(1),
      ));
      if (!byRef.empty) {
        const found = byRef.docs[0];
        setQuickEditStory({ id: found.id, ...(found.data() as any) } as Story);
      }
    } catch (error) {
      console.warn('Failed to open story quick edit', error);
    }
  }, [currentUser?.uid]);

  // Check if yesterday's check-in was completed and show red banner if not
  useEffect(() => {
    if (!currentUser?.uid) return;
    const yesterdayKey = format(getYesterday(), DAY_FORMAT);
    const docId = `${currentUser.uid}_${yesterdayKey}`;
    getDoc(doc(db, 'daily_checkins', docId)).then((snap) => {
      if (!snap.exists() || (snap.data()?.completedCount ?? 0) === 0) {
        setYesterdayWarning(
          `Yesterday's check-in (${yesterdayKey.slice(0,4)}-${yesterdayKey.slice(4,6)}-${yesterdayKey.slice(6)}) wasn't completed. ` +
          `You're currently viewing ${format(date, 'yyyy-MM-dd')}.`
        );
      } else {
        setYesterdayWarning(null);
      }
    }).catch(() => { /* non-fatal */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const loadHealthData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const snap = await getDoc(doc(db, 'profiles', currentUser.uid));
      if (snap.exists()) setHealth(snap.data() as HealthSnapshot);
    } catch { /* non-fatal */ }
  }, [currentUser]);

  useEffect(() => { loadHealthData(); }, [loadHealthData]);

  const effectiveSleepMinutes = health.healthkitSleepMinutes ?? health.manualSleepMinutes;
  const effectiveSteps = health.healthkitStepsToday ?? health.manualStepsToday;
  const effectiveDistanceKm = health.healthkitDistanceKmToday ?? health.manualDistanceKmToday;
  const effectiveWorkoutMinutes = health.healthkitWorkoutMinutesToday ?? health.manualWorkoutMinutesToday;
  const effectiveCalories = health.healthkitCaloriesTodayKcal ?? health.manualCaloriesKcal;
  const effectiveProtein = health.healthkitProteinTodayG ?? health.manualProteinG;
  const effectiveFat = health.healthkitFatTodayG ?? health.manualFatG;
  const effectiveCarbs = health.healthkitCarbsTodayG ?? health.manualCarbsG;
  const effectiveWeightKg = health.healthkitWeightKg ?? health.manualWeightKg;
  const effectiveBodyFatPct = health.healthkitBodyFatPct ?? health.manualBodyFatPct;

  const saveHealthData = useCallback(async () => {
    if (!currentUser) return;
    setHealthSaving(true);
    try {
      const payload: Record<string, any> = { ownerUid: currentUser.uid, healthDataSource: 'manual', updatedAt: new Date() };
      if (manualInputs.sleepH) payload.manualSleepMinutes = Math.round(parseFloat(manualInputs.sleepH) * 60);
      if (manualInputs.steps) payload.manualStepsToday = parseInt(manualInputs.steps, 10);
      if (manualInputs.distanceKm) payload.manualDistanceKmToday = parseFloat(manualInputs.distanceKm);
      if (manualInputs.workoutMin) payload.manualWorkoutMinutesToday = Math.round(parseFloat(manualInputs.workoutMin));
      if (manualInputs.calories) payload.manualCaloriesKcal = parseFloat(manualInputs.calories);
      if (manualInputs.protein) payload.manualProteinG = parseFloat(manualInputs.protein);
      if (manualInputs.fat) payload.manualFatG = parseFloat(manualInputs.fat);
      if (manualInputs.carbs) payload.manualCarbsG = parseFloat(manualInputs.carbs);
      if (manualInputs.weightKg) payload.manualWeightKg = parseFloat(manualInputs.weightKg);
      if (manualInputs.bodyFatPct) payload.manualBodyFatPct = parseFloat(manualInputs.bodyFatPct);
      await setDoc(doc(db, 'profiles', currentUser.uid), payload, { merge: true });
      setHealth((prev) => ({ ...prev, ...payload }));
      setHealthSaved(true);
      setTimeout(() => setHealthSaved(false), 3000);
    } catch { /* non-fatal */ }
    finally { setHealthSaving(false); }
  }, [currentUser, manualInputs]);

  // Auto-mark routine/habit items as done when health data covers them
  const autoMarkHealthRoutines = useCallback((snapshot: HealthSnapshot) => {
    const sl = snapshot.healthkitSleepMinutes ?? snapshot.manualSleepMinutes;
    const st = snapshot.healthkitStepsToday ?? snapshot.manualStepsToday;
    const pr = snapshot.healthkitProteinTodayG ?? snapshot.manualProteinG;
    setItems((prev) => prev.map((item) => {
      if (item.completed) return item;
      const title = item.title || '';
      if (sl && sl >= 360 && matchesHealthKeyword(title, 'sleep')) {
        return { ...item, completed: true, completedAt: Date.now(), completedBy: 'auto' };
      }
      if (st && st >= 5000 && matchesHealthKeyword(title, 'steps')) {
        return { ...item, completed: true, completedAt: Date.now(), completedBy: 'auto' };
      }
      if (pr && pr >= 10 && matchesHealthKeyword(title, 'macros')) {
        return { ...item, completed: true, completedAt: Date.now(), completedBy: 'auto' };
      }
      return item;
    }));
  }, []);

  useEffect(() => {
    if (Object.keys(health).length > 0) autoMarkHealthRoutines(health);
  }, [health, autoMarkHealthRoutines]);

  const loadPlannedItems = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const ownerUid = currentUser.uid;
      const blockQuery = query(
        collection(db, 'calendar_blocks'),
        where('ownerUid', '==', ownerUid),
        where('start', '>=', dayStart.getTime()),
        where('start', '<=', dayEnd.getTime()),
      );
      const personaValue = currentPersona || null;
      const taskTypeValues = ['chore', 'routine', 'habit', 'habitual'];
      const taskTagValues = ['chore', 'routine', 'habit', 'habitual', '#chore', '#routine', '#habit', '#habitual'];
      const baseTaskFilters = [
        where('ownerUid', '==', ownerUid),
        ...(personaValue ? [where('persona', '==', personaValue)] : []),
      ];
      const taskTypeQuery = query(
        collection(db, 'tasks'),
        ...baseTaskFilters,
        where('type', 'in', taskTypeValues),
      );
      const taskTagQuery = query(
        collection(db, 'tasks'),
        ...baseTaskFilters,
        where('tags', 'array-contains-any', taskTagValues),
      );

      const blocksPromise = getDocs(blockQuery).catch(async (err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInDaily: calendar_blocks permission denied, skipping');
          return { docs: [] } as any;
        }
        if (!isIndexError(err)) throw err;
        const fallbackSnap = await getDocs(
          query(collection(db, 'calendar_blocks'), where('ownerUid', '==', ownerUid)),
        );
        const filtered = fallbackSnap.docs.filter((docSnap) => {
          const data = docSnap.data() as any;
          const startMs = Number(data?.start || 0);
          return startMs >= dayStart.getTime() && startMs <= dayEnd.getTime();
        });
        return { docs: filtered } as typeof fallbackSnap;
      });

      const instancesPromise = getDocs(
        schedulerCollections.userInstancesRange(db, ownerUid, dateKey, dateKey),
      ).catch(async (err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInDaily: scheduled_instances permission denied, skipping');
          return { docs: [] } as any;
        }
        if (!isIndexError(err)) throw err;
        const fallbackSnap = await getDocs(
          query(collection(db, 'scheduled_instances'), where('ownerUid', '==', ownerUid)),
        );
        const filtered = fallbackSnap.docs.filter((docSnap) => {
          const data = docSnap.data() as any;
          return String(data?.occurrenceDate || '') === dateKey;
        });
        return { docs: filtered } as typeof fallbackSnap;
      });

      const habitsPromise = getDocs(query(collection(db, 'habits'), where('ownerUid', '==', ownerUid))).catch((err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInDaily: habits permission denied, skipping');
          return { docs: [] } as any;
        }
        throw err;
      });

      const taskTypePromise = getDocs(taskTypeQuery).catch(async (err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInDaily: tasks(type) permission denied, skipping');
          return { docs: [] } as any;
        }
        if (!isIndexError(err)) throw err;
        const fallbackSnap = await getDocs(query(collection(db, 'tasks'), ...baseTaskFilters));
        return { docs: fallbackSnap.docs } as typeof fallbackSnap;
      });

      const taskTagPromise = getDocs(taskTagQuery).catch(async (err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInDaily: tasks(tags) permission denied, skipping');
          return { docs: [] } as any;
        }
        if (!isIndexError(err)) throw err;
        const fallbackSnap = await getDocs(query(collection(db, 'tasks'), ...baseTaskFilters));
        return { docs: fallbackSnap.docs } as typeof fallbackSnap;
      });

      const [blocksSnap, instancesSnap, habitsSnap, taskTypeSnap, taskTagSnap] = await Promise.all([
        blocksPromise,
        instancesPromise,
        habitsPromise,
        taskTypePromise,
        taskTagPromise,
      ]);

      const blocks = blocksSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((block) => {
          const source = String(block.source || '').toLowerCase();
          const entryMethod = String(block.entry_method || '').toLowerCase();
          const isGcal = source === 'gcal' || entryMethod === 'google_calendar';
          if (!isGcal) return true;
          return !!(block.taskId || block.storyId || block.goalId || block.deepLink);
        });

      const instances = instancesSnap.docs.map((docSnap) => docSnap.data() as ScheduledInstanceModel);

      const habits = habitsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));
      const activeHabits = habits.filter((habit) => habit.isActive !== false);
      const dayIndex = dayStart.getDay();
      const taskIds = new Set<string>();
      const storyIds = new Set<string>();
      const goalIds = new Set<string>();
      const dueHabits = activeHabits.filter((habit) => {
        const freq = String(habit.frequency || 'daily').toLowerCase();
        if (freq === 'daily') return true;
        if (freq === 'weekly') {
          const days = Array.isArray(habit.daysOfWeek) ? habit.daysOfWeek : [];
          return days.includes(dayIndex);
        }
        return false;
      });
      dueHabits.forEach((habit) => {
        if (habit.linkedGoalId) goalIds.add(String(habit.linkedGoalId));
      });

      const habitCompletionMap = new Map<string, { completed: boolean; completedAt: number | null }>();
      const habitLastDoneMap = new Map<string, number | null>();
      await Promise.all(
        dueHabits.map(async (habit) => {
          try {
            const entrySnap = await getDoc(doc(db, `habits/${habit.id}/habitEntries/${dateKey}`));
            let completed = false;
            let completedAt: number | null = null;
            if (entrySnap.exists()) {
              const data = entrySnap.data() as any;
              completed = !!data?.isCompleted;
              completedAt = resolveTimestampMs(data?.completedAt || data?.updatedAt || data?.date);
            }
            habitCompletionMap.set(habit.id, { completed, completedAt });
          } catch {
            // ignore habit entry read errors
          }
          try {
            const latestSnap = await getDocs(query(
              collection(db, `habits/${habit.id}/habitEntries`),
              orderBy('date', 'desc'),
              limit(1),
            ));
            if (!latestSnap.empty) {
              const data = latestSnap.docs[0].data() as any;
              habitLastDoneMap.set(habit.id, resolveTimestampMs(data?.completedAt || data?.updatedAt || data?.date));
            }
          } catch {
            // ignore habit last-done lookup errors
          }
        }),
      );

      blocks.forEach((block) => {
        if (block.taskId) taskIds.add(String(block.taskId));
        if (block.storyId) storyIds.add(String(block.storyId));
        if (block.goalId) goalIds.add(String(block.goalId));
      });

      const taskRefs = new Map<string, string>();
      const storyRefs = new Map<string, string>();
      const taskMeta = new Map<string, { status: any; completedAtMs: number | null; lastDoneAtMs: number | null; goalId: string | null; type: string | null; completedBy: 'mac_sync' | 'user' | 'auto' | null; points: number | null }>();
      const storyMeta = new Map<string, { goalId: string | null; points: number | null }>();

      await Promise.all([
        ...Array.from(taskIds).map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'tasks', id));
            if (!snap.exists()) return;
            const data = snap.data() as any;
            const ref = data.ref || data.reference || data.referenceNumber || data.code || id.slice(-6).toUpperCase();
            taskRefs.set(id, String(ref));
            const completedAtMs = resolveTimestampMs(data.completedAt);
            const lastDoneAtMs = resolveTimestampMs(data.lastDoneAt) || completedAtMs;
            const reminderLinked = !!(data.reminderId || data.reminder?.id);
            const source = String(data.source || data.createdBy || '').toLowerCase();
            const completedBy = reminderLinked || source.includes('reminder') ? 'mac_sync' : 'user';
            taskMeta.set(id, {
              status: data.status,
              completedAtMs,
              lastDoneAtMs,
              goalId: data.goalId ? String(data.goalId) : null,
              type: data.type ? String(data.type) : null,
              completedBy,
              points: data.points != null ? Number(data.points) || null : null,
            });
            if (data.goalId) goalIds.add(String(data.goalId));
          } catch (err) {
            if (isPermissionDenied(err)) {
              console.warn('CheckInDaily: task read denied', id);
              return;
            }
            throw err;
          }
        }),
        ...Array.from(storyIds).map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'stories', id));
            if (!snap.exists()) return;
            const data = snap.data() as any;
            const ref = data.ref || data.reference || data.referenceNumber || data.code || id.slice(-6).toUpperCase();
            storyRefs.set(id, String(ref));
            storyMeta.set(id, {
              goalId: data.goalId ? String(data.goalId) : null,
              points: data.points != null ? Number(data.points) || null : null,
            });
            if (data.goalId) goalIds.add(String(data.goalId));
          } catch (err) {
            if (isPermissionDenied(err)) {
              console.warn('CheckInDaily: story read denied', id);
              return;
            }
            throw err;
          }
        }),
      ]);

      const goalTitles = new Map<string, string>();
      await Promise.all(
        Array.from(goalIds).map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'goals', id));
            if (!snap.exists()) return;
            const data = snap.data() as any;
            const title = data.title || data.name || id.slice(-6).toUpperCase();
            goalTitles.set(id, String(title));
          } catch {
            // ignore goal lookup errors
          }
        }),
      );

      const isTaskDone = (status: any) => {
        if (typeof status === 'number') return status >= 2;
        const normalized = String(status || '').toLowerCase();
        return ['done', 'complete', 'completed', 'finished', 'closed'].includes(normalized);
      };

      const wasCompletedToday = (completedAtMs: number | null) => {
        if (!completedAtMs) return false;
        return completedAtMs >= dayStart.getTime() && completedAtMs <= dayEnd.getTime();
      };

      const blockItems: DailyCheckInItem[] = blocks.map((block) => {
        const start = Number(block.start || 0);
        const end = Number(block.end || 0);
        const durationMin = start && end ? Math.round((end - start) / 60000) : null;
        const storyId = block.storyId ? String(block.storyId) : null;
        const taskId = block.taskId ? String(block.taskId) : null;
        const taskInfo = taskId ? taskMeta.get(taskId) : null;
        const storyInfo = storyId ? storyMeta.get(storyId) : null;
        const goalId = block.goalId
          ? String(block.goalId)
          : (taskInfo?.goalId || storyInfo?.goalId || null);
        const goalTitle = goalId ? goalTitles.get(goalId) || null : null;
        const completedFromTask = taskInfo ? (isTaskDone(taskInfo.status) && wasCompletedToday(taskInfo.completedAtMs)) : false;
        const completedBy = completedFromTask ? (taskInfo?.completedBy || 'auto') : null;
        return {
          key: `block:${block.id}`,
          type: 'block',
          title: block.title || block.category || 'Planned block',
          theme: block.theme || block.subTheme || null,
          sourceType: block.source || block.entry_method || block.category || null,
          sourceId: block.id,
          start,
          end,
          durationMin,
          storyId,
          storyRef: storyId ? storyRefs.get(storyId) || null : null,
          taskId,
          taskRef: taskId ? taskRefs.get(taskId) || null : null,
          goalId,
          goalTitle,
          completed: completedFromTask,
          completedAt: completedFromTask ? taskInfo?.completedAtMs || null : null,
          completedBy,
          lastDoneAt: taskInfo?.lastDoneAtMs || taskInfo?.completedAtMs || null,
          note: '',
          points: (taskId ? taskMeta.get(taskId)?.points : null) ?? (storyId ? storyMeta.get(storyId)?.points : null) ?? null,
        };
      });

      const instanceItems: DailyCheckInItem[] = instances.map((instance) => {
        const start = instance.plannedStart ? new Date(instance.plannedStart).getTime() : null;
        const end = instance.plannedEnd ? new Date(instance.plannedEnd).getTime() : null;
        const durationMin = start && end ? Math.round((end - start) / 60000) : null;
        const completedAt = resolveTimestampMs((instance as any).completedAt);
        return {
          key: `instance:${instance.id}`,
          type: 'instance',
          title: instance.title || instance.sourceId || 'Planned item',
          theme: (instance as any).theme || (instance as any).sourceTheme || null,
          sourceType: instance.sourceType || null,
          sourceId: instance.id,
          start,
          end,
          durationMin,
          completed: instance.status === 'completed',
          completedBy: instance.status === 'completed' ? 'auto' : null,
          completedAt: completedAt,
          lastDoneAt: completedAt,
          note: '',
        };
      });

      const habitItems: DailyCheckInItem[] = dueHabits.map((habit) => {
        const schedule = String(habit.scheduleTime || '').trim();
        let start: number | null = null;
        let end: number | null = null;
        if (schedule && schedule.includes(':')) {
          const [hh, mm] = schedule.split(':').map((v: string) => Number(v));
          const startDate = new Date(dayStart);
          startDate.setHours(Number.isFinite(hh) ? hh : 7, Number.isFinite(mm) ? mm : 0, 0, 0);
          start = startDate.getTime();
          end = start + 15 * 60 * 1000;
        }
        const habitState = habitCompletionMap.get(habit.id) || { completed: false, completedAt: null };
        const lastDoneAt = habitLastDoneMap.get(habit.id) || habitState.completedAt || null;
        return {
          key: `habit:${habit.id}`,
          type: 'habit',
          title: habit.name || habit.title || 'Habit',
          theme: null,
          sourceType: 'habit',
          sourceId: habit.id,
          start,
          end,
          durationMin: start && end ? Math.round((end - start) / 60000) : null,
          habitId: habit.id,
          goalId: habit.linkedGoalId || null,
          goalTitle: habit.linkedGoalId ? goalTitles.get(String(habit.linkedGoalId)) || null : null,
          completed: habitState.completed,
          completedAt: habitState.completedAt,
          completedBy: habitState.completed ? 'user' : null,
          lastDoneAt,
          note: '',
        };
      });

      const normalizeDayToken = (value: any) => {
        if (!value && value !== 0) return null;
        if (typeof value === 'number') {
          const idx = Math.max(0, Math.min(6, value % 7));
          return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][idx];
        }
        const raw = String(value).toLowerCase().trim();
        if (!raw) return null;
        if (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(raw)) return raw;
        if (raw.startsWith('su')) return 'sun';
        if (raw.startsWith('mo')) return 'mon';
        if (raw.startsWith('tu')) return 'tue';
        if (raw.startsWith('we')) return 'wed';
        if (raw.startsWith('th')) return 'thu';
        if (raw.startsWith('fr')) return 'fri';
        if (raw.startsWith('sa')) return 'sat';
        return null;
      };

      const dayToken = normalizeDayToken(dayStart.getDay());
      const dayOfMonth = dayStart.getDate();
      const monthOfYear = dayStart.getMonth() + 1;

      const getTaskDueMs = (task: any) => {
        const raw = task.dueDate ?? task.dueDateMs ?? task.targetDate ?? null;
        if (!raw) return null;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (typeof raw === 'object' && typeof raw.toDate === 'function') return raw.toDate().getTime();
        const parsed = Date.parse(String(raw));
        return Number.isNaN(parsed) ? null : parsed;
      };

      const isRecurringDueToday = (task: any) => {
        const dueMs = getTaskDueMs(task);
        if (dueMs && dueMs <= dayEnd.getTime()) return true;
        const recurrence = (task.recurrence || {}) as any;
        const freqRaw = task.repeatFrequency || recurrence.frequency || recurrence.freq || '';
        const freq = String(freqRaw).toLowerCase();
        if (!freq) return false;
        if (freq === 'daily') return true;
        const daysRaw = ([] as any[])
          .concat(task.daysOfWeek || [])
          .concat(task.repeatDaysOfWeek || [])
          .concat(recurrence.daysOfWeek || []);
        const daySet = new Set(daysRaw.map(normalizeDayToken).filter(Boolean) as string[]);
        if (freq === 'weekly') {
          if (dayToken && daySet.size > 0) return daySet.has(dayToken);
          return false;
        }
        if (freq === 'monthly') {
          const daysOfMonth = ([] as any[]).concat(recurrence.daysOfMonth || []);
          if (daysOfMonth.length) return daysOfMonth.map(Number).includes(dayOfMonth);
          if (dueMs) return new Date(dueMs).getDate() === dayOfMonth;
          return false;
        }
        if (freq === 'yearly') {
          if (dueMs) {
            const d = new Date(dueMs);
            return d.getDate() === dayOfMonth && (d.getMonth() + 1) === monthOfYear;
          }
          return false;
        }
        return false;
      };

      const taskDocs = [...taskTypeSnap.docs, ...taskTagSnap.docs];
      const taskMap = new Map<string, any>();
      taskDocs.forEach((docSnap) => {
        if (!taskMap.has(docSnap.id)) {
          taskMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as any) });
        }
      });
      const recurringTasks = Array.from(taskMap.values())
        .filter((task) => !task.deleted)
        .filter((task) => !isTaskDone(task.status))
        .filter((task) => {
          const type = String(task.type || '').toLowerCase();
          const tags = Array.isArray(task.tags) ? task.tags.map((t: any) => String(t).toLowerCase()) : [];
          return ['chore', 'routine', 'habit'].includes(type) || tags.some((t) => ['chore', 'routine', 'habit'].includes(t));
        })
        .filter((task) => isRecurringDueToday(task));
      recurringTasks.forEach((task) => {
        if (task.goalId) goalIds.add(String(task.goalId));
      });

      const missingGoalIds = Array.from(goalIds).filter((id) => !goalTitles.has(id));
      if (missingGoalIds.length) {
        await Promise.all(
          missingGoalIds.map(async (id) => {
            try {
              const snap = await getDoc(doc(db, 'goals', id));
              if (!snap.exists()) return;
              const data = snap.data() as any;
              const title = data.title || data.name || id.slice(-6).toUpperCase();
              goalTitles.set(id, String(title));
            } catch {
              // ignore goal lookup errors
            }
          }),
        );
      }

      const recurringTaskItems: DailyCheckInItem[] = recurringTasks.map((task) => {
        const dueMs = getTaskDueMs(task);
        const ref = task.ref || task.reference || task.referenceNumber || task.code || task.id.slice(-6).toUpperCase();
        const start = dueMs && dueMs >= dayStart.getTime() && dueMs <= dayEnd.getTime() ? dueMs : null;
        const end = start ? start + 15 * 60 * 1000 : null;
        const taskType = String(task.type || '').toLowerCase();
        const completedAtMs = resolveTimestampMs(task.completedAt);
        const completed = isTaskDone(task.status) && wasCompletedToday(completedAtMs);
        const reminderLinked = !!(task.reminderId || task.reminder?.id);
        const source = String(task.source || task.createdBy || '').toLowerCase();
        const completedBy = reminderLinked || source.includes('reminder') ? 'mac_sync' : 'user';
        const normalizedType: CheckInItemType = (taskType === 'chore' || taskType === 'routine' || taskType === 'habit')
          ? (taskType as CheckInItemType)
          : 'task';
        return {
          key: `task:${task.id}`,
          type: normalizedType,
          title: task.title || 'Recurring task',
          theme: null,
          sourceType: task.type || null,
          sourceId: task.id,
          start,
          end,
          durationMin: start && end ? Math.round((end - start) / 60000) : null,
          taskId: task.id,
          taskRef: ref,
          goalId: task.goalId || null,
          goalTitle: task.goalId ? goalTitles.get(String(task.goalId)) || null : null,
          taskType: task.type || null,
          completed,
          completedAt: completedAtMs,
          completedBy: completed ? completedBy : null,
          lastDoneAt: resolveTimestampMs(task.lastDoneAt) || completedAtMs,
          note: '',
        };
      });

      const plannedItems = [...blockItems, ...instanceItems, ...habitItems, ...recurringTaskItems].sort((a, b) => {
        const aTime = a.start || 0;
        const bTime = b.start || 0;
        return aTime - bTime;
      });

      const existingSnap = await getDoc(doc(db, 'daily_checkins', `${ownerUid}_${dateKey}`));
      if (existingSnap.exists()) {
        const existing = existingSnap.data() as DailyCheckInDoc;
        const existingMap = new Map(existing.items.map((item) => [item.key, item]));
        const merged = plannedItems.map((item) => {
          const prev = existingMap.get(item.key);
          if (!prev) return item;
          const autoCompleted = !!item.completed && !prev.completed;
          return {
            ...item,
            completed: prev.completed || autoCompleted,
            completedAt: prev.completedAt || (autoCompleted ? (item.completedAt || Date.now()) : null),
            completedBy: prev.completedBy || (autoCompleted ? (item.completedBy || 'auto') : null),
            note: prev.note || '',
            noteAt: prev.noteAt || null,
            progressPct: prev.progressPct ?? item.progressPct ?? null,
          };
        });
        const mergedWithComments = await hydrateLastComments(merged);
        setItems(mergedWithComments);
        initialItemsRef.current = new Map(mergedWithComments.map((item) => [item.key, item]));
      } else {
        const plannedWithComments = await hydrateLastComments(plannedItems);
        setItems(plannedWithComments);
        initialItemsRef.current = new Map(plannedWithComments.map((item) => [item.key, item]));
      }
    } catch (err) {
      console.error('Failed to load daily check-in data', err);
      setError('Unable to load planned items.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, currentPersona, dateKey, dayEnd, dayStart, hydrateLastComments]);

  useEffect(() => {
    loadPlannedItems();
  }, [loadPlannedItems]);

  const handleToggle = useCallback(async (item: DailyCheckInItem) => {
    const nextCompleted = !item.completed;
    const nextCompletedAt = nextCompleted ? Date.now() : null;
    setItems((prev) =>
      prev.map((entry) => (entry.key === item.key
        ? {
          ...entry,
          completed: nextCompleted,
          completedAt: nextCompletedAt,
          completedBy: nextCompleted ? 'user' : null,
        }
        : entry)),
    );
    if (item.type === 'instance') {
      try {
        await updateDoc(doc(db, 'scheduled_instances', item.key.replace('instance:', '')), {
          status: nextCompleted ? 'completed' : 'planned',
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.warn('Failed to update instance status', err);
      }
    }
    if (item.type === 'habit' && item.habitId) {
      try {
        const entryRef = doc(db, `habits/${item.habitId}/habitEntries/${dateKey}`);
        await setDoc(entryRef, {
          id: dateKey,
          habitId: item.habitId,
          ownerUid: currentUser?.uid || null,
          date: dayStart.getTime(),
          value: nextCompleted ? 1 : 0,
          isCompleted: nextCompleted,
          notes: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true });
      } catch (err) {
        console.warn('Failed to update habit entry', err);
      }
    }
    if (nextCompleted && item.taskId) {
      const taskKind = String(item.taskType || item.type || '').toLowerCase();
      const sourceKind = String(item.sourceType || '').toLowerCase();
      const isRecurringTask = ['chore', 'routine', 'habit'].includes(taskKind);
      const isChoreBlock = item.type === 'block' && ['chore', 'routine', 'habit'].includes(sourceKind);
      if (isRecurringTask || isChoreBlock) {
        try {
          const callable = httpsCallable(functions, 'completeChoreTask');
          await callable({ taskId: item.taskId });
        } catch (err) {
          console.warn('Failed to mark recurring task complete', err);
        }
      }
    }
  }, [dateKey, dayStart, currentUser]);

  const handleNoteChange = useCallback((key: string, note: string) => {
    setItems((prev) =>
      prev.map((entry) => {
        if (entry.key !== key) return entry;
        const effectiveType = String(entry.taskType || entry.sourceType || entry.type || '').toLowerCase();
        const isRecurringLike = ['chore', 'routine', 'habit'].includes(effectiveType);
        const supportsComments = !!(entry.storyId || (entry.taskId && !isRecurringLike));
        if (!supportsComments) return { ...entry, note: '' };
        return { ...entry, note };
      }),
    );
  }, []);

  const handleProgressChange = useCallback((key: string, pct: number | null) => {
    setItems((prev) =>
      prev.map((entry) => {
        if (entry.key !== key) return entry;
        const effectiveType = String(entry.taskType || entry.sourceType || entry.type || '').toLowerCase();
        const isRecurringLike = ['chore', 'routine', 'habit'].includes(effectiveType);
        const supportsProgress = !!(entry.storyId || (entry.taskId && !isRecurringLike));
        if (!supportsProgress) return { ...entry, progressPct: null };
        return { ...entry, progressPct: pct };
      }),
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const nowMs = Date.now();
      const prevMap = initialItemsRef.current;
      const itemsWithMeta = items.map((item) => {
        const prev = prevMap.get(item.key);
        const updated: DailyCheckInItem = { ...item };
        const effectiveType = String(item.taskType || item.sourceType || item.type || '').toLowerCase();
        const isRecurringLike = ['chore', 'routine', 'habit'].includes(effectiveType);
        const supportsProgress = !!(item.storyId || (item.taskId && !isRecurringLike));
        const supportsComments = supportsProgress;

        if (!supportsComments) {
          updated.note = '';
          updated.noteAt = null;
        }
        if (!supportsProgress) {
          updated.progressPct = null;
        }

        if (item.note && item.note !== (prev?.note || '')) {
          updated.noteAt = nowMs;
        }
        if (item.completed && !prev?.completed) {
          updated.completedAt = item.completedAt || nowMs;
          updated.completedBy = item.completedBy || 'user';
        }
        return updated;
      });
      const plannedCount = items.length;
      const completedCount = itemsWithMeta.filter((i) => i.completed).length;
      const payload: DailyCheckInDoc = {
        id: `${currentUser.uid}_${dateKey}`,
        ownerUid: currentUser.uid,
        dateKey,
        dateMs: dayStart.getTime(),
        items: itemsWithMeta,
        plannedCount,
        completedCount,
      };
      await setDoc(doc(db, 'daily_checkins', payload.id), {
        ...payload,
        updatedAt: new Date(),
        createdAt: new Date(),
      }, { merge: true });

      const noteWrites = itemsWithMeta.map(async (item) => {
        const prev = prevMap.get(item.key);
        const effectiveType = String(item.taskType || item.sourceType || item.type || '').toLowerCase();
        const isRecurringLike = ['chore', 'routine', 'habit'].includes(effectiveType);
        const supportsComments = !!(item.storyId || (item.taskId && !isRecurringLike));
        if (!supportsComments) return;
        const noteChanged = (item.note || '') !== (prev?.note || '');
        const completedChanged = item.completed && !prev?.completed;
        const entityId = item.taskId || item.storyId || item.goalId || null;
        const entityType = item.taskId ? 'task' : item.storyId ? 'story' : item.goalId ? 'goal' : null;
        const referenceNumber = item.taskRef || item.storyRef || '';
        if (!entityId || !entityType) return;
        if (noteChanged && (item.note || '').trim()) {
          await ActivityStreamService.addNote(
            entityId,
            entityType,
            item.note!.trim(),
            currentUser.uid,
            currentUser.email || undefined,
            currentPersona || undefined,
            referenceNumber,
            'human',
          );
          return;
        }
        if (completedChanged) {
          await ActivityStreamService.addNote(
            entityId,
            entityType,
            'Daily check-in: completed',
            currentUser.uid,
            currentUser.email || undefined,
            currentPersona || undefined,
            referenceNumber,
            'human',
          );
        }
      });
      await Promise.all(noteWrites);

      // Persist progress % to source task/story documents
      const progressWrites = itemsWithMeta
        .filter((item) => {
          const effectiveType = String(item.taskType || item.sourceType || item.type || '').toLowerCase();
          const isRecurringLike = ['chore', 'routine', 'habit'].includes(effectiveType);
          const supportsProgress = !!(item.storyId || (item.taskId && !isRecurringLike));
          return supportsProgress && item.progressPct != null && (item.storyId || item.taskId);
        })
        .map(async (item) => {
          const prev = prevMap.get(item.key);
          if (item.progressPct === prev?.progressPct) return;
          try {
            const col = item.storyId ? 'stories' : 'tasks';
            const id = item.storyId || item.taskId!;
            const payload: Record<string, any> = {
              progressPct: item.progressPct,
              progressPctUpdatedAt: Date.now(),
            };
            if (item.storyId) {
              const points = Number(item.points ?? 0);
              const pct = Number(item.progressPct ?? 0);
              const remaining = Number.isFinite(points) && points > 0
                ? Math.max(0, Math.ceil((points * (1 - Math.min(100, Math.max(0, pct)) / 100)) * 10) / 10)
                : 0;
              payload.pointsRemaining = remaining;
              payload.pointsRemainingAsOfDateKey = dateKey;
              payload.pointsRemainingUpdatedAt = Date.now();
            }
            await updateDoc(doc(db, col, id), payload);
          } catch (err) {
            console.warn('Failed to write progressPct to source doc', err);
          }
        });
      await Promise.all(progressWrites);

      setItems(itemsWithMeta);
      initialItemsRef.current = new Map(itemsWithMeta.map((item) => [item.key, item]));
    } catch (err) {
      console.error('Failed to save daily check-in', err);
      setError('Failed to save daily check-in.');
    } finally {
      setSaving(false);
    }
  }, [currentUser, currentPersona, dateKey, dayStart, items]);

  const [hideCompleted, setHideCompleted] = useState(true);
  const [refreshingComments, setRefreshingComments] = useState(false);

  // Keys of items that have unsaved progress or note changes
  const dirtyKeys = useMemo(() => {
    const keys = new Set<string>();
    items.forEach((item) => {
      const prev = initialItemsRef.current.get(item.key);
      if (!prev) return;
      if ((item.note || '') !== (prev.note || '')) keys.add(item.key);
      if ((item.progressPct ?? null) !== (prev.progressPct ?? null)) keys.add(item.key);
    });
    return keys;
  }, [items]);

  const refreshComments = useCallback(async () => {
    setRefreshingComments(true);
    try {
      const updated = await hydrateLastComments(items);
      setItems(updated);
    } finally {
      setRefreshingComments(false);
    }
  }, [hydrateLastComments, items]);

  const completedCount = items.filter((i) => i.completed).length;
  const nowMs = Date.now();
  const formatTime = (value?: number | null) => {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getBucketForItem = (item: DailyCheckInItem): 'morning' | 'afternoon' | 'evening' | 'anytime' => {
    if (!item.start) return 'anytime';
    const h = new Date(item.start).getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 18) return 'afternoon';
    if (h >= 18) return 'evening';
    return 'anytime';
  };

  const getBadgeForItem = (item: DailyCheckInItem): { bg: string; label: string } => {
    const type = String(item.taskType || item.sourceType || item.type || '').toLowerCase();
    if (type === 'routine') return { bg: 'success', label: 'Routine' };
    if (type === 'habit') return { bg: 'secondary', label: 'Habit' };
    if (type === 'chore') return { bg: 'primary', label: 'Chore' };
    if (item.storyId) return { bg: 'info', label: 'Story' };
    if (item.taskId) return { bg: 'warning', label: 'Task' };
    return { bg: 'light', label: item.type };
  };

  const isItemOverdue = (item: DailyCheckInItem): boolean => {
    if (item.completed) return false;
    if (!item.start) return false;
    return item.start < nowMs;
  };

  const visibleItems = hideCompleted ? items.filter((i) => !i.completed) : items;

  const BUCKETS = [
    { key: 'morning' as const, label: 'Morning', range: '5am – 12pm' },
    { key: 'afternoon' as const, label: 'Afternoon', range: '12pm – 6pm' },
    { key: 'evening' as const, label: 'Evening', range: '6pm – midnight' },
    { key: 'anytime' as const, label: 'Anytime', range: '' },
  ];

  const itemsByBucket = BUCKETS.reduce((acc, b) => {
    acc[b.key] = visibleItems.filter((i) => getBucketForItem(i) === b.key);
    return acc;
  }, {} as Record<string, DailyCheckInItem[]>);

  const renderCheckInCard = (item: DailyCheckInItem) => {
    const badge = getBadgeForItem(item);
    const overdue = isItemOverdue(item);
    const timeLabel = item.start && item.end
      ? `${formatTime(item.start)} – ${formatTime(item.end)}`
      : item.start ? formatTime(item.start) : null;
    return (
      <div
        key={item.key}
        className={`d-flex align-items-start gap-2 p-2 mb-2 rounded border${item.completed ? ' opacity-50' : ''}${overdue ? ' border-danger' : ''}`}
        style={{ background: item.completed ? 'var(--bs-light-bg-subtle, #f8f9fa)' : undefined }}
      >
        <Form.Check
          type="checkbox"
          className="mt-1 flex-shrink-0"
          checked={item.completed}
          onChange={() => handleToggle(item)}
          aria-label={`Toggle ${item.title}`}
        />
        <div className="flex-grow-1 min-w-0">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className={`fw-semibold${item.completed ? ' text-decoration-line-through text-muted' : ''}`}
              style={{ wordBreak: 'break-word' }}>
              {item.title}
            </span>
            <Badge bg={badge.bg} className="text-capitalize" style={{ fontSize: '0.7rem' }}>{badge.label}</Badge>
            {overdue && <Badge bg="danger" style={{ fontSize: '0.7rem' }}>Overdue</Badge>}
            {item.completed && item.completedBy === 'mac_sync' && <Badge bg="secondary" style={{ fontSize: '0.65rem' }}>Synced</Badge>}
          </div>
          <div className="d-flex align-items-center gap-3 mt-1 flex-wrap">
            {dirtyKeys.has(item.key) && (
              <span title="Unsaved changes" style={{ fontSize: '0.7rem', color: 'var(--bs-warning-text-emphasis, #664d03)' }}>● unsaved</span>
            )}
            {timeLabel && <span className="text-muted" style={{ fontSize: '0.78rem' }}>{timeLabel}</span>}
            {item.points != null && <span className="text-muted" style={{ fontSize: '0.78rem' }}>{item.points} pts</span>}
            {item.durationMin && !item.points && <span className="text-muted" style={{ fontSize: '0.78rem' }}>{item.durationMin}m</span>}
            {item.goalTitle && <span className="text-muted" style={{ fontSize: '0.78rem' }}>Goal: {item.goalTitle}</span>}
            {item.storyRef && (
              <button
                type="button"
                className="btn btn-link p-0 text-decoration-none"
                style={{ fontSize: '0.78rem' }}
                onClick={() => { void openStoryEdit(item); }}
              >
                {item.storyRef}
              </button>
            )}
            {item.taskRef && !item.storyRef && (
              <button
                type="button"
                className="btn btn-link p-0 text-decoration-none"
                style={{ fontSize: '0.78rem' }}
                onClick={() => { void openTaskEdit(item); }}
              >
                {item.taskRef}
              </button>
            )}
          </div>
          {supportsProgressForItem(item) && (
            <Form.Control
              size="sm"
              type="number"
              min={0}
              max={100}
              className="mt-1"
              style={{ maxWidth: 120 }}
              placeholder="Progress %"
              value={item.progressPct ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value)));
                handleProgressChange(item.key, v);
              }}
            />
          )}
          {supportsCommentsForItem(item) && (
            <Form.Control
              size="sm"
              className="mt-1"
              value={item.note || ''}
              placeholder="Add comment…"
              onChange={(e) => handleNoteChange(item.key, e.target.value)}
            />
          )}
          {supportsCommentsForItem(item) && !!item.note && (
            <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
              Last comment: {item.note || item.lastComment}
              {item.lastCommentAt ? ` (${formatTime(item.lastCommentAt)})` : ''}
            </div>
          )}
          {supportsCommentsForItem(item) && !item.note && !!item.lastComment && (
            <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
              Last comment: {item.lastComment}
              {item.lastCommentAt ? ` (${formatTime(item.lastCommentAt)})` : ''}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCheckInListRow = (item: DailyCheckInItem) => {
    const badge = getBadgeForItem(item);
    const overdue = isItemOverdue(item);
    const timeLabel = item.start && item.end
      ? `${formatTime(item.start)} – ${formatTime(item.end)}`
      : item.start ? formatTime(item.start) : null;

    return (
      <div
        key={item.key}
        className={`d-flex flex-column gap-2 p-2 mb-2 border rounded${item.completed ? ' opacity-50' : ''}${overdue ? ' border-danger' : ''}`}
      >
        <div className="d-flex align-items-center gap-2">
          <Form.Check
            type="checkbox"
            className="mt-0"
            checked={item.completed}
            onChange={() => handleToggle(item)}
            aria-label={`Toggle ${item.title}`}
          />
          <span className={`fw-semibold${item.completed ? ' text-decoration-line-through text-muted' : ''}`}>
            {item.title}
          </span>
          <Badge bg={badge.bg} className="text-capitalize" style={{ fontSize: '0.7rem' }}>{badge.label}</Badge>
          {overdue && <Badge bg="danger" style={{ fontSize: '0.7rem' }}>Overdue</Badge>}
          <div className="ms-auto text-muted" style={{ fontSize: '0.78rem' }}>
            {timeLabel || 'Anytime'}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {dirtyKeys.has(item.key) && (
            <span title="Unsaved changes" style={{ fontSize: '0.7rem', color: 'var(--bs-warning-text-emphasis, #664d03)' }}>● unsaved</span>
          )}
          {item.points != null && <span className="text-muted" style={{ fontSize: '0.78rem' }}>{item.points} pts</span>}
          {item.goalTitle && <span className="text-muted" style={{ fontSize: '0.78rem' }}>Goal: {item.goalTitle}</span>}
          {item.storyRef && (
            <button
              type="button"
              className="btn btn-link p-0 text-decoration-none"
              style={{ fontSize: '0.78rem' }}
              onClick={() => { void openStoryEdit(item); }}
            >
              {item.storyRef}
            </button>
          )}
          {item.taskRef && !item.storyRef && (
            <button
              type="button"
              className="btn btn-link p-0 text-decoration-none"
              style={{ fontSize: '0.78rem' }}
              onClick={() => { void openTaskEdit(item); }}
            >
              {item.taskRef}
            </button>
          )}
        </div>
        {supportsProgressForItem(item) && (
          <Form.Control
            size="sm"
            type="number"
            min={0}
            max={100}
            style={{ maxWidth: 160 }}
            placeholder="Progress %"
            value={item.progressPct ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value)));
              handleProgressChange(item.key, v);
            }}
          />
        )}
        {supportsCommentsForItem(item) && (
          <>
            <Form.Control
              size="sm"
              value={item.note || ''}
              placeholder="Add comment…"
              onChange={(e) => handleNoteChange(item.key, e.target.value)}
            />
            {!!item.note && (
              <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                Last comment: {item.note || item.lastComment}
                {item.lastCommentAt ? ` (${formatTime(item.lastCommentAt)})` : ''}
              </div>
            )}
            {!item.note && !!item.lastComment && (
              <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                Last comment: {item.lastComment}
                {item.lastCommentAt ? ` (${formatTime(item.lastCommentAt)})` : ''}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className={embedded ? 'p-0' : 'p-3'}>
      {!embedded && <h3 className="mb-3">Daily Check-in</h3>}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {!fixedDate && (
          <Form.Control
            type="date"
            value={format(date, 'yyyy-MM-dd')}
            onChange={(e) => setDate(new Date(e.target.value))}
            style={{ maxWidth: 200 }}
          />
        )}
        <Badge bg={completedCount === items.length && items.length > 0 ? 'success' : 'secondary'}>
          {completedCount}/{items.length} done
        </Badge>
        <Form.Check
          type="switch"
          id="hide-completed-switch"
          label="Hide completed"
          checked={hideCompleted}
          onChange={() => setHideCompleted((p) => !p)}
          className="ms-2"
        />
        <div className="btn-group ms-2" role="group" aria-label="Daily check-in view mode">
          <Button
            size="sm"
            variant={viewMode === 'card' ? 'secondary' : 'outline-secondary'}
            onClick={() => setViewMode('card')}
          >
            Card view
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'list' ? 'secondary' : 'outline-secondary'}
            onClick={() => setViewMode('list')}
          >
            List view
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={refreshComments}
          disabled={refreshingComments || loading}
          title="Reload latest comments from activity stream"
        >
          {refreshingComments ? <Spinner size="sm" animation="border" /> : '↺ Comments'}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || loading} className="ms-auto">
          {saving ? 'Saving…' : 'Submit check-in'}
        </Button>
      </div>

      {yesterdayWarning && (
        <Alert variant="danger" dismissible onClose={() => setYesterdayWarning(null)} className="mb-2">
          <strong>Incomplete check-in:</strong> {yesterdayWarning}
          {!fixedDate && format(date, DAY_FORMAT) !== format(getYesterday(), DAY_FORMAT) && (
            <Button
              size="sm"
              variant="outline-danger"
              className="ms-2"
              onClick={() => setDate(getYesterday())}
            >
              Switch to yesterday
            </Button>
          )}
        </Alert>
      )}
      {error && <Alert variant="danger">{error}</Alert>}

      {/* ── Health data panel ─────────────────────────────────────────── */}
      <Card className="mb-3 border-0 shadow-sm">
        <Card.Header className="py-2 d-flex justify-content-between align-items-center">
          <span className="fw-semibold small">Today's Health Data</span>
          <span className="text-muted small">
            {health.healthkitStatus === 'synced' ? '● HealthKit synced' : 'Manual entry'}
          </span>
        </Card.Header>
        <Card.Body className="py-2">
          <Row className="g-2">
            {/* Sleep */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Sleep</div>
              {effectiveSleepMinutes != null ? (
                <div className="fw-semibold">{(effectiveSleepMinutes / 60).toFixed(1)}h</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="hrs (e.g. 7.5)"
                  value={manualInputs.sleepH ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, sleepH: e.target.value }))}
                />
              )}
            </Col>
            {/* Steps */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Steps</div>
              {effectiveSteps != null ? (
                <div className="fw-semibold">{Number(effectiveSteps).toLocaleString()}</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="e.g. 8000"
                  value={manualInputs.steps ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, steps: e.target.value }))}
                />
              )}
            </Col>
            {/* Distance */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Distance</div>
              {effectiveDistanceKm != null ? (
                <div className="fw-semibold">{Number(effectiveDistanceKm).toFixed(2)} km</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="km"
                  value={manualInputs.distanceKm ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, distanceKm: e.target.value }))}
                />
              )}
            </Col>
            {/* Workout minutes */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Workout</div>
              {effectiveWorkoutMinutes != null ? (
                <div className="fw-semibold">{Math.round(Number(effectiveWorkoutMinutes))} min</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="minutes"
                  value={manualInputs.workoutMin ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, workoutMin: e.target.value }))}
                />
              )}
            </Col>
            {/* Calories */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Calories</div>
              {effectiveCalories != null ? (
                <div className="fw-semibold">{Math.round(effectiveCalories)} kcal</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="kcal"
                  value={manualInputs.calories ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, calories: e.target.value }))}
                />
              )}
            </Col>
            {/* Protein */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Protein</div>
              {effectiveProtein != null ? (
                <div className="fw-semibold">{Math.round(effectiveProtein)}g</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="g"
                  value={manualInputs.protein ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, protein: e.target.value }))}
                />
              )}
            </Col>
            {/* Fat */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Fat</div>
              {effectiveFat != null ? (
                <div className="fw-semibold">{Math.round(effectiveFat)}g</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="g"
                  value={manualInputs.fat ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, fat: e.target.value }))}
                />
              )}
            </Col>
            {/* Carbs */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Carbs</div>
              {effectiveCarbs != null ? (
                <div className="fw-semibold">{Math.round(effectiveCarbs)}g</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="g"
                  value={manualInputs.carbs ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, carbs: e.target.value }))}
                />
              )}
            </Col>
            {/* Weight */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Weight</div>
              {effectiveWeightKg != null ? (
                <div className="fw-semibold">{Number(effectiveWeightKg).toFixed(1)} kg</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="kg"
                  value={manualInputs.weightKg ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, weightKg: e.target.value }))}
                />
              )}
            </Col>
            {/* Body fat */}
            <Col xs={6} md={4} xl={2}>
              <div className="text-muted small mb-1">Body Fat</div>
              {effectiveBodyFatPct != null ? (
                <div className="fw-semibold">{Number(effectiveBodyFatPct).toFixed(1)}%</div>
              ) : (
                <Form.Control
                  size="sm"
                  type="number"
                  placeholder="%"
                  value={manualInputs.bodyFatPct ?? ''}
                  onChange={(e) => setManualInputs((p) => ({ ...p, bodyFatPct: e.target.value }))}
                />
              )}
            </Col>
          </Row>
          {/* Save button — only show if any manual inputs are present */}
          {Object.values(manualInputs).some((v) => v && v !== '') && (
            <div className="d-flex align-items-center gap-2 mt-2">
              <Button size="sm" variant="outline-primary" onClick={saveHealthData} disabled={healthSaving}>
                {healthSaving ? <Spinner size="sm" animation="border" /> : 'Save health data'}
              </Button>
              {healthSaved && <span className="text-success small">Saved! Routines auto-marked where applicable.</span>}
            </div>
          )}
        </Card.Body>
      </Card>
      {/* ─────────────────────────────────────────────────────────────── */}

      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner size="sm" animation="border" /> Loading planned items…
        </div>
      ) : items.length === 0 ? (
        <div className="text-muted">No planned items for this day.</div>
      ) : (
        <>
          {hideCompleted && completedCount > 0 && (
            <div className="text-muted small mb-3">{completedCount} completed item{completedCount !== 1 ? 's' : ''} hidden</div>
          )}
          {/* On md+ screens, show morning/afternoon/evening as 3 side-by-side columns; anytime always full-width */}
          <Row className="g-3">
            {BUCKETS.filter((b) => b.key !== 'anytime').map((bucket) => {
              const bucketItems = itemsByBucket[bucket.key] || [];
              if (bucketItems.length === 0) return null;
              return (
                <Col key={bucket.key} xs={12} md={4}>
                  <Card className="h-100 border-0 shadow-sm">
                    <Card.Header className="py-2 d-flex align-items-center justify-content-between">
                      <span className="fw-bold small">{bucket.label}</span>
                      {bucket.range && <span className="text-muted small">{bucket.range}</span>}
                    </Card.Header>
                    <Card.Body className="py-2">
                      {bucketItems.map((item) => (viewMode === 'card' ? renderCheckInCard(item) : renderCheckInListRow(item)))}
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
          </Row>
          {(itemsByBucket['anytime'] || []).length > 0 && (
            <Card className="mt-3 border-0 shadow-sm">
              <Card.Header className="py-2 d-flex align-items-center justify-content-between">
                <span className="fw-bold small">Anytime</span>
              </Card.Header>
              <Card.Body className="py-2">
                {(itemsByBucket['anytime'] || []).map((item) => (viewMode === 'card' ? renderCheckInCard(item) : renderCheckInListRow(item)))}
              </Card.Body>
            </Card>
          )}
        </>
      )}

      <EditTaskModal
        show={!!quickEditTask}
        task={quickEditTask}
        onHide={() => setQuickEditTask(null)}
      />

      <EditStoryModal
        show={!!quickEditStory}
        story={quickEditStory}
        goals={goals}
        onHide={() => setQuickEditStory(null)}
      />
    </div>
  );
};

export default CheckInDaily;
