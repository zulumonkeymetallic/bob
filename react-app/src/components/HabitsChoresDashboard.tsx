import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Form, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { endOfDay, format, startOfDay, subDays } from 'date-fns';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Task } from '../types';
import { useNavigate, Link } from 'react-router-dom';
import { isRecurringDueOnDate, resolveRecurringDueMs } from '../utils/recurringTaskDue';
import EditTaskModal from './EditTaskModal';

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
const TARGET_OCCURRENCES = 100;
const VISIBLE_BOXES = 30;

const BOX_SIZE = 13;
const BOX_GAP = 2;
const NAME_COL_WIDTH = 180;

function habitBoxColor(done: boolean): string {
  return done ? '#22c55e' : '#ef4444';
}

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
  const [sortMode, setSortMode] = useState<'type' | 'due' | 'streak'>('type');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [hoveredBox, setHoveredBox] = useState<string | null>(null);

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
    // Sort tasks within each group
    const kindOrder = (t: Task) => {
      const k = getHabitKind(t);
      if (k === 'habit') return 0;
      if (k === 'routine') return 1;
      return 2; // chore
    };
    groups.forEach((group) => {
      group.tasks.sort((a, b) => {
        if (sortMode === 'type') {
          const ka = kindOrder(a);
          const kb = kindOrder(b);
          if (ka !== kb) return ka - kb;
          return (a.title || '').localeCompare(b.title || '');
        }
        if (sortMode === 'due') {
          const aDue = resolveRecurringDueMs(a, new Date(), todayStartMs) ?? Infinity;
          const bDue = resolveRecurringDueMs(b, new Date(), todayStartMs) ?? Infinity;
          return aDue - bDue;
        }
        if (sortMode === 'streak') {
          const aStreak = taskStats[a.id]?.streak ?? 0;
          const bStreak = taskStats[b.id]?.streak ?? 0;
          return bStreak - aStreak; // highest streak first
        }
        return 0;
      });
    });
    const ordered = Array.from(groups.entries()).map(([goalId, data]) => ({ goalId, ...data }));
    ordered.sort((a, b) => {
      if (a.goalId === 'unlinked') return 1;
      if (b.goalId === 'unlinked') return -1;
      return String(a.goal?.title || '').localeCompare(String(b.goal?.title || ''));
    });
    return ordered;
  }, [filteredTasks, goalsById, sortMode, todayStartMs, taskStats]);

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
          <div className="text-muted small">Track routines and habits with 100-instance completion history, streaks and linked goals.</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Form.Select
            size="sm"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as 'type' | 'due' | 'streak')}
            style={{ width: 160 }}
          >
            <option value="type">Sort: Habits first</option>
            <option value="due">Sort: Next due</option>
            <option value="streak">Sort: Streak</option>
          </Form.Select>
          <Button variant="outline-secondary" size="sm" onClick={() => navigate('/chores/checklist')}>Open today's checklist</Button>
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
                <div className="d-flex align-items-center gap-2">
                  <span className="fw-semibold">{goalTitle}</span>
                  {group.goal && (
                    <Link to={`/goals/${(group.goal as any).ref || group.goalId}`} className="text-decoration-none small">View goal</Link>
                  )}
                </div>
                <div className="d-flex align-items-center gap-2">
                  {group.goal && (() => {
                    const groupStats = group.tasks.map((t) => taskStats[t.id]).filter(Boolean);
                    const totalCompleted = groupStats.reduce((s, ts) => s + ts.completedCount, 0);
                    const totalExpected = groupStats.reduce((s, ts) => s + ts.totalCount, 0);
                    const adherence = totalExpected ? Math.round((totalCompleted / totalExpected) * 100) : 0;
                    return (
                      <Badge bg={adherence >= 80 ? 'success' : adherence >= 50 ? 'warning' : 'danger'} pill>
                        {adherence}% adherence
                      </Badge>
                    );
                  })()}
                  <Badge bg="secondary" pill>{group.tasks.length} item{group.tasks.length === 1 ? '' : 's'}</Badge>
                </div>
              </Card.Header>
              <Card.Body className="py-2 px-3">
                {group.tasks.map((task, taskIdx) => {
                  const kind = getHabitKind(task) || 'habit';
                  const badgeVariant = kind === 'routine' ? 'success' : 'secondary';
                  const badgeLabel = kind === 'routine' ? 'Routine' : 'Habit';
                  const stats = taskStats[task.id] || { occurrences: [], completedCount: 0, totalCount: 0, streak: 0, expectedSlots: [] };
                  const dueMs = resolveRecurringDueMs(task, new Date(), todayStartMs);
                  const lastDoneMs = getLastDoneMs(task);
                  const doneToday = !!lastDoneMs && lastDoneMs >= todayStartMs;
                  const canComplete = !!dueMs && dueMs <= todayEndMs && !doneToday;
                  const busy = !!completing[task.id];
                  const boxes = stats.expectedSlots.slice(0, VISIBLE_BOXES);
                  const hitCount = boxes.filter(s => s.done).length;
                  return (
                    <div
                      key={task.id}
                      style={{ borderTop: taskIdx > 0 ? '1px solid #e5e7eb' : undefined, paddingTop: taskIdx > 0 ? 8 : 0, paddingBottom: 8 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Name */}
                        <div style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, flexShrink: 0 }}>
                          <div className="fw-semibold" style={{ fontSize: 13 }}>{task.title}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <Badge bg={badgeVariant} style={{ fontSize: 10 }}>{badgeLabel}</Badge>
                            <button type="button" className="btn btn-link p-0 text-decoration-none" style={{ fontSize: 11 }} onClick={() => setEditingTask(task)}>Open</button>
                          </div>
                        </div>
                        {/* Boxes */}
                        <div style={{ display: 'flex', gap: BOX_GAP, flexWrap: 'nowrap', overflowX: 'auto', flex: 1 }}>
                          {boxes.length === 0 ? (
                            <span className="text-muted small">No data</span>
                          ) : boxes.map((slot, idx) => {
                            const id = `${task.id}-${slot.dayMs}`;
                            const label = `${format(new Date(slot.dayMs), 'EEE d MMM')}: ${slot.done ? 'completed' : 'missed'}`;
                            return (
                              <div key={idx} style={{ position: 'relative', flexShrink: 0 }} onMouseEnter={() => setHoveredBox(id)} onMouseLeave={() => setHoveredBox(null)}>
                                <div style={{ width: BOX_SIZE, height: BOX_SIZE, borderRadius: 4, background: habitBoxColor(slot.done), cursor: 'default' }} />
                                {hoveredBox === id && (
                                  <div style={{ position: 'absolute', bottom: BOX_SIZE + 6, left: '50%', transform: 'translateX(-50%)', background: '#111827', color: '#f9fafb', padding: '4px 8px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap', zIndex: 100, pointerEvents: 'none', border: '1px solid #374151' }}>
                                    {label}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* Streak */}
                        <div style={{ minWidth: 48, textAlign: 'center', flexShrink: 0 }}>
                          <div className="fw-bold" style={{ fontSize: 16, lineHeight: 1 }}>{stats.streak}</div>
                          <div style={{ fontSize: 10, color: '#9ca3af' }}>streak</div>
                        </div>
                        {/* Today */}
                        <div style={{ flexShrink: 0 }}>
                          <Form.Check
                            type="checkbox"
                            checked={doneToday}
                            disabled={!canComplete || busy}
                            onChange={() => handleComplete(task)}
                            aria-label={`Complete ${task.title} today`}
                          />
                        </div>
                      </div>
                      {boxes.length > 0 && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, paddingLeft: NAME_COL_WIDTH + 12 }}>
                          {hitCount}/{boxes.length} completed · {stats.totalCount ? Math.round((stats.completedCount / stats.totalCount) * 100) : 0}% all-time
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card.Body>
            </Card>
          );
        })
      )}

      <EditTaskModal
        show={!!editingTask}
        task={editingTask}
        onHide={() => setEditingTask(null)}
      />
    </div>
  );
};

export default HabitsChoresDashboard;
