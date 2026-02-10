import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Spinner, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format, startOfDay, endOfDay, formatDistanceToNow } from 'date-fns';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { schedulerCollections, type ScheduledInstanceModel } from '../../domain/scheduler/repository';
import { ActivityStreamService } from '../../services/ActivityStreamService';

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

const CheckInDaily: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [date, setDate] = useState<Date>(new Date());
  const [items, setItems] = useState<DailyCheckInItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialItemsRef = useRef<Map<string, DailyCheckInItem>>(new Map());

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
      const taskMeta = new Map<string, { status: any; completedAtMs: number | null; lastDoneAtMs: number | null; goalId: string | null; type: string | null; completedBy: 'mac_sync' | 'user' | 'auto' | null }>();
      const storyMeta = new Map<string, { goalId: string | null }>();

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
            if (data.goalId) {
              storyMeta.set(id, { goalId: String(data.goalId) });
              goalIds.add(String(data.goalId));
            }
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
          };
        });
        setItems(merged);
        initialItemsRef.current = new Map(merged.map((item) => [item.key, item]));
      } else {
        setItems(plannedItems);
        initialItemsRef.current = new Map(plannedItems.map((item) => [item.key, item]));
      }
    } catch (err) {
      console.error('Failed to load daily check-in data', err);
      setError('Unable to load planned items.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, currentPersona, dateKey, dayEnd, dayStart]);

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
      prev.map((entry) => (entry.key === key ? { ...entry, note } : entry)),
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

      setItems(itemsWithMeta);
      initialItemsRef.current = new Map(itemsWithMeta.map((item) => [item.key, item]));
    } catch (err) {
      console.error('Failed to save daily check-in', err);
      setError('Failed to save daily check-in.');
    } finally {
      setSaving(false);
    }
  }, [currentUser, currentPersona, dateKey, dayStart, items]);

  const completedCount = items.filter((i) => i.completed).length;
  const formatTime = (value?: number | null) => {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const formatTimeRange = (item: DailyCheckInItem) => {
    if (item.start && item.end) return `${formatTime(item.start)} – ${formatTime(item.end)}`;
    if (item.start) return formatTime(item.start);
    return '—';
  };
  const formatTypeLabel = (item: DailyCheckInItem) => {
    if (item.type === 'task' && item.taskType) return item.taskType;
    return item.type;
  };
  const formatLastDone = (value?: number | null) => {
    if (!value) return '—';
    try {
      return formatDistanceToNow(new Date(value), { addSuffix: true });
    } catch {
      return '—';
    }
  };
  const doneVariantFor = (item: DailyCheckInItem) => {
    if (!item.completed) return 'outline-secondary';
    if (item.completedBy === 'mac_sync') return 'success';
    return 'primary';
  };

  return (
    <div className="p-3">
      <h3 className="mb-3">Daily Check-in</h3>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <Form.Control
          type="date"
          value={format(date, 'yyyy-MM-dd')}
          onChange={(e) => setDate(new Date(e.target.value))}
          style={{ maxWidth: 200 }}
        />
        <Badge bg={completedCount === items.length && items.length > 0 ? 'success' : 'secondary'}>
          {completedCount}/{items.length} done
        </Badge>
        <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Submit check-in'}
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner size="sm" animation="border" /> Loading planned items…
        </div>
      ) : items.length === 0 ? (
        <div className="text-muted">No planned items for this day.</div>
      ) : (
        <>
          <div className="d-md-none">
            {items.map((item) => (
              <div key={item.key} className="border rounded p-2 mb-2">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <div className="fw-semibold">{item.title}</div>
                    <div className="text-muted small">{formatTimeRange(item)}</div>
                    <div className="text-muted small text-capitalize">{formatTypeLabel(item)}</div>
                    <div className="text-muted small">Last done: {formatLastDone(item.lastDoneAt)}</div>
                    {item.goalId ? (
                      <div className="text-muted small">Goal: {item.goalTitle || String(item.goalId).slice(-6).toUpperCase()}</div>
                    ) : null}
                    {item.storyRef ? (
                      <div className="small">
                        Story:{' '}
                        <Link to={`/stories/${item.storyRef}`} className="text-decoration-none">
                          {item.storyRef}
                        </Link>
                      </div>
                    ) : null}
                    {item.taskRef ? (
                      <div className="small">
                        Task:{' '}
                        <Link to={`/tasks/${item.taskRef}`} className="text-decoration-none">
                          {item.taskRef}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant={doneVariantFor(item)}
                    onClick={() => handleToggle(item)}
                  >
                    {item.completed ? 'Done' : 'Mark done'}
                  </Button>
                </div>
                <Form.Control
                  size="sm"
                  className="mt-2"
                  value={item.note || ''}
                  placeholder="Add note..."
                  onChange={(e) => handleNoteChange(item.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="d-none d-md-block">
            <Table responsive hover size="sm" className="align-middle">
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>Time</th>
                  <th>Item</th>
                  <th style={{ width: '180px' }}>Linked</th>
                  <th style={{ width: '120px' }}>Type</th>
                  <th style={{ width: '140px' }}>Last done</th>
                  <th style={{ width: '90px' }}>Done</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key}>
                    <td className="text-muted">{formatTimeRange(item)}</td>
                    <td>
                      <div className="fw-semibold">{item.title}</div>
                      <div className="text-muted small">
                        {item.theme ? <span>{item.theme}</span> : null}
                        {item.sourceType ? <span className="ms-2">{String(item.sourceType)}</span> : null}
                      </div>
                    </td>
                    <td className="text-muted small">
                      {item.goalId ? <div>Goal: {item.goalTitle || String(item.goalId).slice(-6).toUpperCase()}</div> : null}
                      {item.storyRef ? (
                        <div>
                          Story:{' '}
                          <Link to={`/stories/${item.storyRef}`} className="text-decoration-none">
                            {item.storyRef}
                          </Link>
                        </div>
                      ) : null}
                      {item.taskRef ? (
                        <div>
                          Task:{' '}
                          <Link to={`/tasks/${item.taskRef}`} className="text-decoration-none">
                            {item.taskRef}
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td className="text-muted small text-capitalize">{formatTypeLabel(item)}</td>
                    <td>
                      <span title={item.lastDoneAt ? new Date(item.lastDoneAt).toLocaleString() : undefined}>
                        {formatLastDone(item.lastDoneAt)}
                      </span>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant={doneVariantFor(item)}
                        onClick={() => handleToggle(item)}
                      >
                        {item.completed ? 'Done' : 'Mark done'}
                      </Button>
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        value={item.note || ''}
                        placeholder="Add note..."
                        onChange={(e) => handleNoteChange(item.key, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
};

export default CheckInDaily;
