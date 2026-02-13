import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Form, Spinner, Table } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { endOfDay, format, formatDistanceToNow, startOfDay, subDays } from 'date-fns';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Task } from '../types';
import { useNavigate } from 'react-router-dom';
import { isRecurringDueOnDate, resolveRecurringDueMs } from '../utils/recurringTaskDue';

interface Occurrence {
  id: string;
  start: number;
  status: string;
  done: boolean;
}

interface TaskStats {
  occurrences: Occurrence[];
  completedCount: number;
  totalCount: number;
  streak: number;
  expectedSlots: { dayMs: number; done: boolean }[];
}

const LOOKBACK_DAYS = 180;
const TARGET_OCCURRENCES = 15;

const getLastDoneMs = (task: Task): number | null => {
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

const getHabitKind = (task: Task): 'routine' | 'habit' | null => {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'routine' || normalized === 'habit') return normalized as any;
  const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
  const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
  if (tagKeys.includes('routine')) return 'routine';
  if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
  return null;
};

const formatDueLabel = (dueMs?: number | null) => {
  if (!dueMs) return '—';
  const d = new Date(dueMs);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return hasTime ? format(d, 'MMM d, HH:mm') : format(d, 'MMM d');
};

const formatRelative = (value?: number | null) => {
  if (!value) return '—';
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
};

const getConsistencyBadge = (completed: number, total: number) => {
  if (!total) return { label: 'No data', variant: 'secondary' };
  const rate = completed / total;
  if (rate >= 0.8) return { label: 'On track', variant: 'success' };
  if (rate >= 0.5) return { label: 'Mixed', variant: 'warning' };
  return { label: 'Needs attention', variant: 'danger' };
};

const HabitsChoresDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [occurrenceMap, setOccurrenceMap] = useState<Record<string, Occurrence[]>>({});
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});

  const todayStartMs = useMemo(() => startOfDay(new Date()).getTime(), []);
  const todayEndMs = useMemo(() => endOfDay(new Date()).getTime(), []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setTasks([]);
      setLoadingTasks(false);
      return;
    }
    setLoadingTasks(true);
    const q = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as Task);
        setTasks(rows);
        setLoadingTasks(false);
      },
      () => setLoadingTasks(false),
    );
    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setGoals([]);
      return;
    }
    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const unsub = onSnapshot(q, (snap) => {
      setGoals(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as Goal));
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setOccurrenceMap({});
      setLoadingBlocks(false);
      return;
    }
    const startMs = startOfDay(subDays(new Date(), LOOKBACK_DAYS)).getTime();
    const endMs = endOfDay(new Date()).getTime();
    setLoadingBlocks(true);
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', startMs),
      where('start', '<=', endMs),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, Occurrence[]> = {};
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const entityType = String(data.entityType || '').toLowerCase();
          if (!['routine', 'habit', 'chore'].includes(entityType)) return;
          const taskId = String(data.taskId || '').trim();
          if (!taskId) return;
          const start = typeof data.start === 'number' ? data.start : null;
          if (!start) return;
          const status = String(data.status || '').toLowerCase();
          const done = ['done', 'complete', 'completed'].includes(status);
          const entry: Occurrence = { id: docSnap.id, start, status, done };
          if (!map[taskId]) map[taskId] = [];
          map[taskId].push(entry);
        });
        Object.keys(map).forEach((taskId) => {
          map[taskId].sort((a, b) => b.start - a.start);
          map[taskId] = map[taskId].slice(0, LOOKBACK_DAYS);
        });
        setOccurrenceMap(map);
        setLoadingBlocks(false);
      },
      () => setLoadingBlocks(false),
    );
    return () => unsub();
  }, [currentUser?.uid]);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter((task) => !task.deleted)
      .filter((task) => (task.status ?? 0) !== 2)
      .filter((task) => !currentPersona || !task.persona || task.persona === currentPersona)
      .filter((task) => !!getHabitKind(task));
  }, [tasks, currentPersona]);

  const taskStats = useMemo(() => {
    const stats: Record<string, TaskStats> = {};
    filteredTasks.forEach((task) => {
      const occurrences = occurrenceMap[task.id] || [];
      const doneDaySet = new Set<number>();
      occurrences.forEach((occ) => {
        if (!occ.done) return;
        doneDaySet.add(startOfDay(new Date(occ.start)).getTime());
      });
      const lastDoneMs = getLastDoneMs(task);
      if (lastDoneMs) {
        doneDaySet.add(startOfDay(new Date(lastDoneMs)).getTime());
      }

      const expectedDays: number[] = [];
      const anchor = startOfDay(new Date());
      for (let i = 0; i < LOOKBACK_DAYS && expectedDays.length < TARGET_OCCURRENCES; i += 1) {
        const day = subDays(anchor, i);
        if (isRecurringDueOnDate(task, day)) {
          expectedDays.push(startOfDay(day).getTime());
        }
      }
      if (expectedDays.length === 0) {
        const fallbackDays = occurrences
          .map((occ) => startOfDay(new Date(occ.start)).getTime())
          .filter((value, idx, arr) => arr.indexOf(value) === idx)
          .slice(0, TARGET_OCCURRENCES);
        expectedDays.push(...fallbackDays);
      }
      const expectedSlots = expectedDays.map((dayMs) => ({
        dayMs,
        done: doneDaySet.has(dayMs),
      }));
      const completedCount = expectedSlots.filter((slot) => slot.done).length;
      const totalCount = expectedSlots.length;
      let streak = 0;
      for (const slot of expectedSlots) {
        if (slot.done) streak += 1;
        else break;
      }
      stats[task.id] = { occurrences, completedCount, totalCount, streak, expectedSlots };
    });
    return stats;
  }, [filteredTasks, occurrenceMap]);

  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);

  const grouped = useMemo(() => {
    const groups = new Map<string, { goal: Goal | null; tasks: Task[] }>();
    filteredTasks.forEach((task) => {
      const goalId = task.goalId || 'unlinked';
      if (!groups.has(goalId)) {
        groups.set(goalId, { goal: goalId !== 'unlinked' ? goalsById.get(goalId) || null : null, tasks: [] });
      }
      groups.get(goalId)!.tasks.push(task);
    });
    const ordered = Array.from(groups.entries()).map(([goalId, data]) => ({ goalId, ...data }));
    ordered.sort((a, b) => {
      if (a.goalId === 'unlinked') return 1;
      if (b.goalId === 'unlinked') return -1;
      return String(a.goal?.title || '').localeCompare(String(b.goal?.title || ''));
    });
    return ordered;
  }, [filteredTasks, goalsById]);

  const handleComplete = useCallback(async (task: Task) => {
    if (!currentUser?.uid) return;
    if (completing[task.id]) return;
    setCompleting((prev) => ({ ...prev, [task.id]: true }));
    try {
      const callable = httpsCallable(functions, 'completeChoreTask');
      await callable({ taskId: task.id });
    } catch (err) {
      console.warn('Failed to complete chore task', err);
    } finally {
      setCompleting((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
    }
  }, [currentUser?.uid, completing]);

  const loading = loadingTasks || loadingBlocks;

  return (
    <div className="container py-3" style={{ maxWidth: 1200 }}>
      <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2 mb-3">
        <div>
          <h4 className="mb-1">Habit Tracking</h4>
          <div className="text-muted small">Track routines and habits only, with a 15-instance completion view by expected cadence.</div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => navigate('/chores/checklist')}>Open today’s checklist</Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/tasks')}>Manage tasks</Button>
        </div>
      </div>

      {loading ? (
        <Card className="mb-3">
          <Card.Body className="d-flex align-items-center gap-2 text-muted">
            <Spinner size="sm" animation="border" /> Loading habits and routines…
          </Card.Body>
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <Card.Body className="text-muted">No routines or habits found for this persona.</Card.Body>
        </Card>
      ) : (
        grouped.map((group) => {
          const goalTitle = group.goal?.title || (group.goalId === 'unlinked' ? 'Unlinked' : 'Goal');
          return (
            <Card key={group.goalId} className="mb-3">
              <Card.Header className="d-flex align-items-center justify-content-between">
                <div className="fw-semibold">{goalTitle}</div>
                <Badge bg="secondary" pill>{group.tasks.length} item{group.tasks.length === 1 ? '' : 's'}</Badge>
              </Card.Header>
              <Card.Body className="p-0">
                <div className="table-responsive">
                  <Table hover responsive size="sm" className="mb-0 align-middle">
                    <thead>
                      <tr>
                        <th style={{ width: 260 }}>Item</th>
                        <th>Next Due</th>
                        <th>Last Done</th>
                        <th>Last 15</th>
                        <th>Status</th>
                        <th style={{ width: 120 }}>Today</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tasks.map((task) => {
                        const kind = getHabitKind(task) || 'habit';
                        const badgeVariant = kind === 'routine' ? 'success' : 'secondary';
                        const badgeLabel = kind === 'routine' ? 'Routine' : 'Habit';
                        const stats = taskStats[task.id] || { occurrences: [], completedCount: 0, totalCount: 0, streak: 0, expectedSlots: [] };
                        const consistency = getConsistencyBadge(stats.completedCount, stats.totalCount);
                        const dueMs = resolveRecurringDueMs(task, new Date(), todayStartMs);
                        const lastDoneMs = getLastDoneMs(task);
                        const dueLabel = formatDueLabel(dueMs);
                        const lastLabel = formatRelative(lastDoneMs);
                        const doneToday = !!lastDoneMs && lastDoneMs >= todayStartMs;
                        const canComplete = !!dueMs && dueMs <= todayEndMs && !doneToday;
                        const busy = !!completing[task.id];
                        return (
                          <tr key={task.id}>
                            <td>
                              <div className="fw-semibold">{task.title}</div>
                              <div className="text-muted small d-flex align-items-center gap-2">
                                <Badge bg={badgeVariant}>{badgeLabel}</Badge>
                                <a href={`/tasks/${encodeURIComponent(task.ref || task.id)}`} className="text-decoration-none">Open</a>
                              </div>
                            </td>
                            <td>{dueLabel}</td>
                            <td>{lastLabel}</td>
                            <td>
                              {stats.expectedSlots.length === 0 ? (
                                <span className="text-muted">—</span>
                              ) : (
                                <div className="d-flex align-items-center gap-2">
                                  <span className="small text-muted">{stats.completedCount}/{stats.totalCount}</span>
                                  <div className="d-flex gap-1">
                                    {stats.expectedSlots.map((slot, idx) => (
                                      <span
                                        key={`${task.id}-${slot.dayMs}-${idx}`}
                                        title={`${format(new Date(slot.dayMs), 'EEE d MMM')}: ${slot.done ? 'completed' : 'not completed'}`}
                                        style={{
                                          width: 12,
                                          height: 12,
                                          borderRadius: 999,
                                          display: 'inline-block',
                                          backgroundColor: slot.done ? '#16a34a' : '#dc2626',
                                          border: '1px solid rgba(15, 23, 42, 0.2)',
                                        }}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td>
                              <Badge bg={consistency.variant}>{consistency.label}</Badge>
                              {stats.streak > 1 && (
                                <div className="text-muted small">Streak {stats.streak}</div>
                              )}
                            </td>
                            <td>
                              <Form.Check
                                type="checkbox"
                                checked={doneToday}
                                disabled={!canComplete || busy}
                                onChange={() => handleComplete(task)}
                                aria-label={`Complete ${task.title} today`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </Card.Body>
            </Card>
          );
        })
      )}
    </div>
  );
};

export default HabitsChoresDashboard;
