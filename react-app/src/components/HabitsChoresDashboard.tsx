import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Form, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { endOfDay, format, startOfDay, subDays } from 'date-fns';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Task } from '../types';
import { useNavigate } from 'react-router-dom';
import { isRecurringDueOnDate, resolveRecurringDueMs } from '../utils/recurringTaskDue';
import EditTaskModal from './EditTaskModal';
import '../styles/HabitsChoresDashboard.css';

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

interface ChecklistItem {
  task: Task;
  kind: 'chore' | 'routine' | 'habit';
  dueMs: number;
  doneToday: boolean;
}

const LOOKBACK_DAYS = 180;
const TARGET_OCCURRENCES = 100;
const VISIBLE_BOXES = 30;

const THEME_LABELS: Record<number, string> = {
  1: 'Health',
  2: 'Growth',
  3: 'Wealth',
  4: 'Tribe',
  5: 'Home',
};

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

const getRecurringKind = (task: Task): 'chore' | 'routine' | 'habit' | null => {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized as any;
  const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
  const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
  if (tagKeys.includes('chore')) return 'chore';
  if (tagKeys.includes('routine')) return 'routine';
  if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
  return null;
};

const getHabitKind = (task: Task): 'routine' | 'habit' | null => {
  const kind = getRecurringKind(task);
  return kind === 'routine' || kind === 'habit' ? kind : null;
};

const cadenceLabel = (task: Task): 'Daily Protocols' | 'Weekly Maintenance' | 'Monthly Operations' => {
  const frequency = String((task as any).repeatFrequency || '').toLowerCase();
  if (frequency === 'weekly') return 'Weekly Maintenance';
  if (frequency === 'monthly' || frequency === 'yearly') return 'Monthly Operations';
  return 'Daily Protocols';
};

const percent = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 100) : 0);

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

  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);

  const recurringTasks = useMemo(() => {
    return tasks
      .filter((task) => !task.deleted)
      .filter((task) => (task.status ?? 0) !== 2)
      .filter((task) => !currentPersona || !task.persona || task.persona === currentPersona)
      .filter((task) => !!getRecurringKind(task));
  }, [tasks, currentPersona]);

  const filteredHabitTasks = useMemo(() => {
    return recurringTasks.filter((task) => !!getHabitKind(task));
  }, [recurringTasks]);

  const taskStats = useMemo(() => {
    const stats: Record<string, TaskStats> = {};
    filteredHabitTasks.forEach((task) => {
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
      const expectedSlots = expectedDays.map((dayMs) => ({ dayMs, done: doneDaySet.has(dayMs) }));
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
  }, [filteredHabitTasks, occurrenceMap]);

  const heatmapRows = useMemo(() => {
    const rows = filteredHabitTasks.map((task) => {
      const stats = taskStats[task.id] || { occurrences: [], completedCount: 0, totalCount: 0, streak: 0, expectedSlots: [] };
      const dueMs = resolveRecurringDueMs(task, new Date(), todayStartMs) ?? Number.POSITIVE_INFINITY;
      const goal = task.goalId ? goalsById.get(task.goalId) : undefined;
      const domain = goal?.theme ? THEME_LABELS[goal.theme] || 'Growth' : 'Growth';
      const rowAdherence = percent(stats.completedCount, stats.totalCount);
      const chronological = stats.expectedSlots.slice(0, VISIBLE_BOXES).reverse();
      const emptyCount = Math.max(0, VISIBLE_BOXES - chronological.length);
      const displaySlots = [
        ...Array.from({ length: emptyCount }, (_, idx) => ({ key: `empty-${idx}`, dayMs: null as number | null, done: false, empty: true })),
        ...chronological.map((slot) => ({ key: `${task.id}-${slot.dayMs}`, dayMs: slot.dayMs, done: slot.done, empty: false })),
      ];
      return {
        task,
        kind: getHabitKind(task) || 'habit',
        stats,
        dueMs,
        domain,
        rowAdherence,
        displaySlots,
      };
    });

    rows.sort((a, b) => {
      if (sortMode === 'type') {
        const ka = a.kind === 'habit' ? 0 : 1;
        const kb = b.kind === 'habit' ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return (a.task.title || '').localeCompare(b.task.title || '');
      }
      if (sortMode === 'due') return a.dueMs - b.dueMs;
      return b.stats.streak - a.stats.streak;
    });

    return rows;
  }, [filteredHabitTasks, goalsById, sortMode, taskStats, todayStartMs]);

  const checklistItems = useMemo(() => {
    const rows: ChecklistItem[] = recurringTasks
      .map((task) => {
        const kind = getRecurringKind(task);
        if (!kind) return null;
        const dueMs = resolveRecurringDueMs(task, new Date(), todayStartMs);
        if (!dueMs || dueMs > todayEndMs) return null;
        const lastDoneMs = getLastDoneMs(task);
        const doneToday = !!lastDoneMs && lastDoneMs >= todayStartMs;
        return { task, kind, dueMs, doneToday };
      })
      .filter(Boolean) as ChecklistItem[];

    rows.sort((a, b) => {
      if (a.doneToday !== b.doneToday) return a.doneToday ? 1 : -1;
      return a.dueMs - b.dueMs;
    });

    return rows;
  }, [recurringTasks, todayStartMs, todayEndMs]);

  const checklistGroups = useMemo(() => {
    const grouped: Record<string, ChecklistItem[]> = {
      'Daily Protocols': [],
      'Weekly Maintenance': [],
      'Monthly Operations': [],
    };
    checklistItems.forEach((item) => {
      grouped[cadenceLabel(item.task)].push(item);
    });
    return grouped;
  }, [checklistItems]);

  const tomorrowDueCount = useMemo(() => {
    const tomorrowStart = startOfDay(subDays(new Date(), -1)).getTime();
    const tomorrowEnd = endOfDay(subDays(new Date(), -1)).getTime();
    return recurringTasks.filter((task) => {
      const dueMs = resolveRecurringDueMs(task, new Date(subDays(new Date(), -1)), tomorrowStart);
      return !!dueMs && dueMs >= tomorrowStart && dueMs <= tomorrowEnd;
    }).length;
  }, [recurringTasks]);

  const kpis = useMemo(() => {
    const globalStreak = heatmapRows.reduce((max, row) => Math.max(max, row.stats.streak), 0);

    const dueToday = heatmapRows.filter((row) => row.dueMs <= todayEndMs).length;
    const doneToday = heatmapRows.filter((row) => {
      const lastDoneMs = getLastDoneMs(row.task);
      return !!lastDoneMs && lastDoneMs >= todayStartMs;
    }).length;
    const todayLoadPct = dueToday > 0 ? percent(doneToday, dueToday) : 100;

    const pendingChores = checklistItems.filter((item) => item.kind === 'chore' && !item.doneToday).length;

    const allSlots = heatmapRows.flatMap((row) => row.stats.expectedSlots);
    const consistency = allSlots.length ? percent(allSlots.filter((slot) => slot.done).length, allSlots.length) : 0;

    const now = new Date();
    const latestStart = startOfDay(subDays(now, 6)).getTime();
    const prevStart = startOfDay(subDays(now, 13)).getTime();
    const prevEnd = endOfDay(subDays(now, 7)).getTime();

    const getWindowPct = (fromMs: number, toMs: number) => {
      let total = 0;
      let done = 0;
      heatmapRows.forEach((row) => {
        row.stats.expectedSlots.forEach((slot) => {
          if (slot.dayMs >= fromMs && slot.dayMs <= toMs) {
            total += 1;
            if (slot.done) done += 1;
          }
        });
      });
      return total ? (done / total) * 100 : 0;
    };

    const currentWeekPct = getWindowPct(latestStart, todayEndMs);
    const previousWeekPct = getWindowPct(prevStart, prevEnd);
    const velocity = currentWeekPct - previousWeekPct;
    const readiness = Math.max(0, Math.min(100, Math.round((todayLoadPct * 0.65) + (consistency * 0.35))));

    return {
      globalStreak,
      dueToday,
      doneToday,
      todayLoadPct,
      pendingChores,
      consistency,
      velocity,
      readiness,
    };
  }, [heatmapRows, checklistItems, todayEndMs, todayStartMs]);

  const aiAdvice = useMemo(() => {
    if (heatmapRows.length === 0) {
      return 'Build your first recurring routine to unlock streak intelligence and tailored coaching.';
    }
    const weakest = [...heatmapRows].sort((a, b) => a.rowAdherence - b.rowAdherence)[0];
    if (!weakest) return 'Momentum looks stable. Keep your recovery blocks protected to sustain consistency.';
    if (weakest.rowAdherence >= 80) {
      return `Your consistency is strong. Lock in ${weakest.task.title} earlier in the day to protect the streak under busy schedules.`;
    }
    return `"${weakest.task.title}" is trending low at ${weakest.rowAdherence}%. Try adding a fixed trigger time and a 2-minute starter version.`;
  }, [heatmapRows]);

  const handleComplete = useCallback(async (task: Task) => {
    if (!currentUser?.uid) return;
    if (completing[task.id]) return;
    setCompleting((prev) => ({ ...prev, [task.id]: true }));
    try {
      const callable = httpsCallable(functions, 'completeChoreTask');
      await callable({ taskId: task.id });
    } catch (err) {
      console.warn('Failed to complete recurring task', err);
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
    <div className="habits-os-shell">
      <header className="habits-os-topbar">
        <div>
          <p className="habits-os-kicker">Dashboard</p>
          <h1 className="habits-os-title">Habits &amp; Chores</h1>
        </div>
        <div className="habits-os-topbar-actions">
          <Form.Select
            size="sm"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as 'type' | 'due' | 'streak')}
            className="habits-os-select"
          >
            <option value="type">Sort: Habits first</option>
            <option value="due">Sort: Next due</option>
            <option value="streak">Sort: Streak</option>
          </Form.Select>
          <Button variant="outline-light" size="sm" onClick={() => navigate('/chores/checklist')}>Checklist</Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/tasks')}>Manage Tasks</Button>
        </div>
      </header>

      {loading ? (
        <section className="habits-os-loading">
          <Spinner size="sm" animation="border" /> Loading habits and chores…
        </section>
      ) : heatmapRows.length === 0 ? (
        <section className="habits-os-empty">No habits or routines found for this persona.</section>
      ) : (
        <>
          <section className="habits-os-kpis">
            <article className="habits-os-kpi-card">
              <span className="habits-os-kpi-label">Global Streak</span>
              <div className="habits-os-kpi-value-row">
                <h2>{kpis.globalStreak}</h2>
                <span>days</span>
              </div>
              <div className="habits-os-meter">
                <div style={{ width: `${Math.min(100, kpis.globalStreak)}%` }} />
              </div>
            </article>

            <article className="habits-os-kpi-card">
              <span className="habits-os-kpi-label">Today&apos;s Load</span>
              <div className="habits-os-kpi-value-row">
                <h2>{kpis.todayLoadPct}%</h2>
              </div>
              <p>{kpis.doneToday}/{kpis.dueToday || 0} recurring actions complete</p>
            </article>

            <article className="habits-os-kpi-card">
              <span className="habits-os-kpi-label">Pending Chores</span>
              <div className="habits-os-kpi-value-row">
                <h2>{String(kpis.pendingChores).padStart(2, '0')}</h2>
                <span>urgent</span>
              </div>
              <div className="habits-os-alert-bars">
                <i className={kpis.pendingChores >= 1 ? 'on' : ''} />
                <i className={kpis.pendingChores >= 2 ? 'on' : ''} />
                <i className={kpis.pendingChores >= 3 ? 'on' : ''} />
                <i className={kpis.pendingChores >= 4 ? 'on' : ''} />
                <i className={kpis.pendingChores >= 5 ? 'on' : ''} />
              </div>
            </article>

            <article className="habits-os-kpi-card habits-os-readiness">
              <span className="habits-os-kpi-label">Neural Readiness</span>
              <div className="habits-os-ring" style={{ ['--score' as any]: `${kpis.readiness}` }}>
                <span>{kpis.readiness}%</span>
              </div>
              <p>{kpis.readiness >= 75 ? 'High focus window' : 'Recovery window recommended'}</p>
            </article>
          </section>

          <section className="habits-os-grid">
            <div className="habits-os-panel habits-os-heatmap-panel">
              <div className="habits-os-panel-header">
                <div>
                  <h3>Behavior Heatmaps (30D)</h3>
                  <p>Green = done, red = missed, gray = empty</p>
                </div>
                <Badge bg="dark">Consistency {kpis.consistency}%</Badge>
              </div>

              <div className="habits-os-heatmap-list">
                {heatmapRows.map((row) => (
                  <div key={row.task.id} className="habits-os-heatmap-row">
                    <div className="habits-os-row-meta">
                      <button type="button" onClick={() => setEditingTask(row.task)}>
                        {row.task.title || 'Untitled'}
                      </button>
                      <p>Domain: {row.domain}</p>
                    </div>

                    <div className="habits-os-heatmap-track" aria-label={`30 day consistency for ${row.task.title}`}>
                      {row.displaySlots.map((slot) => {
                        if (slot.empty) return <span key={slot.key} className="heatbox empty" />;
                        const label = `${format(new Date(slot.dayMs as number), 'EEE d MMM')}: ${slot.done ? 'completed' : 'missed'}`;
                        return (
                          <span
                            key={slot.key}
                            className={`heatbox ${slot.done ? 'done' : 'missed'}`}
                            title={label}
                          />
                        );
                      })}
                    </div>

                    <div className="habits-os-row-right">
                      <strong>{row.rowAdherence}%</strong>
                      <span>{row.stats.streak}d streak</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="habits-os-panel-footer">
                <div>
                  <span>Consistency Index</span>
                  <strong>{kpis.consistency.toFixed(1)}</strong>
                </div>
                <div>
                  <span>Velocity</span>
                  <strong className={kpis.velocity >= 0 ? 'up' : 'down'}>{kpis.velocity >= 0 ? '+' : ''}{kpis.velocity.toFixed(1)}%</strong>
                </div>
              </div>
            </div>

            <aside className="habits-os-sidecol">
              <div className="habits-os-panel habits-os-checklist-panel">
                <div className="habits-os-panel-header">
                  <div>
                    <h3>Chore Command</h3>
                    <p>Recurring due today</p>
                  </div>
                  <Badge bg={kpis.pendingChores > 0 ? 'danger' : 'success'}>{kpis.pendingChores > 0 ? 'Critical' : 'Stable'}</Badge>
                </div>

                <div className="habits-os-checklist-body">
                  {Object.entries(checklistGroups).map(([title, items]) => (
                    <section key={title} className="habits-os-checklist-group">
                      <h4>{title}</h4>
                      {items.length === 0 ? (
                        <p className="habits-os-muted">No items due.</p>
                      ) : (
                        items.slice(0, 8).map((item) => {
                          const busy = !!completing[item.task.id];
                          const statusClass = item.doneToday ? 'done' : 'todo';
                          return (
                            <label key={item.task.id} className={`habits-os-check-item ${statusClass}`}>
                              <input
                                type="checkbox"
                                checked={item.doneToday}
                                disabled={item.doneToday || busy}
                                onChange={() => handleComplete(item.task)}
                              />
                              <div>
                                <button type="button" onClick={() => setEditingTask(item.task)}>
                                  {item.task.title || 'Untitled recurring task'}
                                </button>
                                <p>
                                  {item.kind.toUpperCase()} · Due {format(new Date(item.dueMs), 'HH:mm')}
                                </p>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </section>
                  ))}
                </div>

                <div className="habits-os-checklist-footer">
                  <p>System generated: {tomorrowDueCount} item{tomorrowDueCount === 1 ? '' : 's'} recurring tomorrow</p>
                  <Button variant="outline-light" size="sm" onClick={() => navigate('/chores/checklist')}>Manage Recurring Logic</Button>
                </div>
              </div>

              <div className="habits-os-advice-card">
                <h4>AI Coach Advice</h4>
                <p>{aiAdvice}</p>
              </div>
            </aside>
          </section>
        </>
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
