import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { startOfDay, endOfDay, formatDistanceToNow, format } from 'date-fns';
import { httpsCallable } from 'firebase/functions';
import { nextDueAt } from '../utils/recurrence';
import { schedulerCollections, ScheduledInstanceModel } from '../domain/scheduler/repository';

export interface ChecklistPanelProps {
  title?: string;
  compact?: boolean;
}

interface ChecklistItem {
  id: string;
  title: string;
  start?: number;
  end?: number;
  source: 'scheduled' | 'unscheduled' | 'task' | 'chore' | 'habit' | 'routine';
  raw?: any;
  status?: string;
  subtitle?: string;
}

interface StatSummary {
  completedStreak: number;
  longestStreak: number;
  completedCount: number;
  missedCount: number;
  lastCompletedAt: number | null;
  nextDueAt: number | null;
}

interface ChoreStatRow {
  id: string;
  title: string;
  cadence: string | null;
  durationMinutes: number;
  priority: number;
  policy: any;
  tags: string[];
  timezone?: string;
  stats: StatSummary;
  tracker?: any;
}

interface RoutineStatRow {
  id: string;
  name: string;
  cadence: string | null;
  durationMinutes: number;
  priority: number;
  theme?: any;
  goalId?: string | null;
  policy: any;
  tags: string[];
  timezone?: string;
  stats: StatSummary;
  tracker?: any;
}

const ChecklistPanel: React.FC<ChecklistPanelProps> = ({ title = "Today's Checklist", compact }) => {
  const { currentUser } = useAuth();
  const [loadingScheduled, setLoadingScheduled] = useState(true);
  const [loadingLoose, setLoadingLoose] = useState(true);
  const [scheduled, setScheduled] = useState<ScheduledInstanceModel[]>([]);
  const [looseItems, setLooseItems] = useState<ChecklistItem[]>([]);
  const [choreStats, setChoreStats] = useState<ChoreStatRow[]>([]);
  const [routineStats, setRoutineStats] = useState<RoutineStatRow[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London', []);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todayKey = useMemo(() => todayIso.replace(/-/g, ''), [todayIso]);

  useEffect(() => {
    if (!currentUser) {
      setScheduled([]);
      setLoadingScheduled(false);
      return; 
    }
    setLoadingScheduled(true);
    const unsubscribe = onSnapshot(
      schedulerCollections.userInstances(db, currentUser.uid, todayKey),
      (snapshot) => {
        const docs = snapshot.docs.map((docSnap) => docSnap.data());
        setScheduled(docs);
        setLoadingScheduled(false);
      },
      () => setLoadingScheduled(false),
    );
    return () => unsubscribe();
  }, [currentUser, todayKey, todayIso]);

  useEffect(() => {
    if (!currentUser) {
      setLooseItems([]);
      setLoadingLoose(false);
      return;
    }
    const loadLoose = async () => {
      setLoadingLoose(true);
      try {
        const list: ChecklistItem[] = [];
    const start = startOfDay(new Date(todayIso)).getTime();
    const end = endOfDay(new Date(todayIso)).getTime();

        const tasksRef = collection(db, 'tasks');
        const tq = query(
          tasksRef,
          where('ownerUid', '==', currentUser.uid),
          where('dueDate', '>=', start),
          where('dueDate', '<=', end),
        );
        const ts = await getDocs(tq);
        ts.forEach((d) => {
          const t = d.data() as any;
          list.push({ id: `task-${d.id}`, title: t.title, start: t.dueDate, end: t.dueDate, source: 'task', raw: { id: d.id, ...t } });
        });

        const choresRef = collection(db, 'chores');
        const cq = query(choresRef, where('ownerUid', '==', currentUser.uid));
        const cs = await getDocs(cq);
        cs.forEach((d) => {
          const c = d.data() as any;
          const dtstart = c.dtstart || c.createdAt || undefined;
          const next = nextDueAt(c.rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
          const due = next || c.nextDueAt;
          if (due && due >= start && due <= end) {
            list.push({ id: `chore-${d.id}`, title: c.title || 'Chore', start: due, end: due, source: 'chore', raw: { id: d.id, ...c, computedNext: due } });
          }
        });

        const routinesRef = collection(db, 'routines');
        const rqDocs = await getDocs(query(routinesRef, where('ownerUid', '==', currentUser.uid)));
        rqDocs.forEach((d) => {
          const r = d.data() as any;
          const rrule = r.recurrence?.rrule || r.rrule;
          if (!rrule) return;
          const dtstart = r.recurrence?.dtstart || r.dtstart || r.createdAt || undefined;
          const computed = nextDueAt(rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
          const due = r.nextDueAt || computed;
          if (due && due >= start && due <= end) {
            list.push({ id: `routine-${d.id}`, title: r.name || 'Routine', start: due, end: due, source: 'routine', raw: { id: d.id, ...r, computedNext: due } });
          }
        });

        const habitsSnap = await getDocs(query(collection(db, 'habits'), where('userId', '==', currentUser.uid), where('isActive', '==', true)));
        for (const hDoc of habitsSnap.docs) {
          const h: any = hDoc.data();
          if (h.frequency === 'daily') {
            list.push({ id: `habit-${hDoc.id}`, title: h.name, source: 'habit', raw: { id: hDoc.id, ...h } });
          }
        }

        setLooseItems(list);
      } finally {
        setLoadingLoose(false);
      }
    };
    loadLoose();
  }, [currentUser, todayKey]);

  useEffect(() => {
    if (!currentUser) return;
    const key = `planBuilt-${todayKey}-${currentUser.uid}`;
    if (!localStorage.getItem(key)) {
      (async () => {
        try {
          const call = httpsCallable(functions, 'planBlocksV2');
        await call({ startDate: todayIso, days: 1, timezone });
        } catch (err) {
          console.warn('Failed to build schedule preview', err);
        }
        localStorage.setItem(key, '1');
      })();
    }
  }, [currentUser, todayKey, todayIso, timezone]);

  useEffect(() => {
    if (!currentUser) {
      setChoreStats([]);
      setRoutineStats([]);
      return;
    }
    let cancelled = false;
    const loadStats = async () => {
      setLoadingStats(true);
      try {
        const listChores = httpsCallable(functions, 'listChoresWithStats');
        const listRoutines = httpsCallable(functions, 'listRoutinesWithStats');
        const [choresRes, routinesRes] = await Promise.all([listChores({}), listRoutines({})]);
        if (cancelled) return;
        const rawChores = Array.isArray((choresRes?.data as any)?.items) ? (choresRes!.data as any).items : [];
        const sanitizedChores: ChoreStatRow[] = rawChores.map((item: any) => ({
          id: String(item?.id ?? ''),
          title: item?.title || 'Chore',
          cadence: item?.cadence || null,
          durationMinutes: Number(item?.durationMinutes ?? 0),
          priority: Number(item?.priority ?? 0),
          policy: item?.policy || null,
          tags: Array.isArray(item?.tags) ? item.tags : [],
          timezone: item?.timezone,
          tracker: item?.tracker || null,
          stats: {
            completedStreak: Number(item?.stats?.completedStreak ?? 0),
            longestStreak: Number(item?.stats?.longestStreak ?? 0),
            completedCount: Number(item?.stats?.completedCount ?? 0),
            missedCount: Number(item?.stats?.missedCount ?? 0),
            lastCompletedAt: item?.stats?.lastCompletedAt ?? null,
            nextDueAt: item?.stats?.nextDueAt ?? null,
          },
        }));
        const rawRoutines = Array.isArray((routinesRes?.data as any)?.items) ? (routinesRes!.data as any).items : [];
        const sanitizedRoutines: RoutineStatRow[] = rawRoutines.map((item: any) => ({
          id: String(item?.id ?? ''),
          name: item?.name || 'Routine',
          cadence: item?.cadence || null,
          durationMinutes: Number(item?.durationMinutes ?? 0),
          priority: Number(item?.priority ?? 0),
          theme: item?.theme || null,
          goalId: item?.goalId ?? null,
          policy: item?.policy || null,
          tags: Array.isArray(item?.tags) ? item.tags : [],
          timezone: item?.timezone,
          tracker: item?.tracker || null,
          stats: {
            completedStreak: Number(item?.stats?.completedStreak ?? 0),
            longestStreak: Number(item?.stats?.longestStreak ?? 0),
            completedCount: Number(item?.stats?.completedCount ?? 0),
            missedCount: Number(item?.stats?.missedCount ?? 0),
            lastCompletedAt: item?.stats?.lastCompletedAt ?? null,
            nextDueAt: item?.stats?.nextDueAt ?? null,
          },
        }));
        setChoreStats(sanitizedChores);
        setRoutineStats(sanitizedRoutines);
      } catch (err) {
        console.warn('Failed to load chore/routine stats', err);
      } finally {
        if (!cancelled) setLoadingStats(false);
      }
    };
    loadStats();
    return () => {
      cancelled = true;
    };
  }, [currentUser, todayKey]);

  const scheduledItems: ChecklistItem[] = useMemo(() => {
    const now = Date.now();
    return scheduled
      .filter((inst) => ['planned', 'committed', 'in_progress', 'unscheduled'].includes(inst.status))
      .map((inst) => {
        const startMs = inst.plannedStart ? Date.parse(inst.plannedStart) : undefined;
        const endMs = inst.plannedEnd ? Date.parse(inst.plannedEnd) : undefined;
        const overdue = inst.status === 'unscheduled' || (!startMs && !endMs);
        const label = inst.title || (inst.sourceType === 'chore' ? 'Chore' : 'Routine');
        const subtitlePieces: string[] = [];
        if (inst.blockId) subtitlePieces.push(`Block ${inst.blockId}`);
        if (inst.status === 'unscheduled') {
          subtitlePieces.push(inst.statusReason || 'Waiting for block');
        }
        return {
          id: inst.id,
          title: label,
          start: startMs ?? (overdue ? now + 12 * 60 * 60 * 1000 : undefined),
          end: endMs,
          source: inst.status === 'unscheduled' ? 'unscheduled' : 'scheduled',
          raw: inst,
          status: inst.status,
          subtitle: subtitlePieces.join(' · ') || undefined,
        } as ChecklistItem;
      });
  }, [scheduled]);

  const items = useMemo(() => {
    return [...scheduledItems, ...looseItems];
  }, [scheduledItems, looseItems]);

  const loading = loadingScheduled || loadingLoose;

  const now = Date.now();
  const nowNext = items
    .filter((i) => (i.start ?? now) <= now + 60 * 60 * 1000)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const later = items
    .filter((i) => (i.start ?? now) > now + 60 * 60 * 1000)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  if (!currentUser) return null;

  const handleCompleteChore = async (choreId: string) => {
    try {
      const callable = httpsCallable(functions, 'completeChore');
      const res = await callable({ choreId });
      const stats = ((res?.data as any)?.stats || {}) as Partial<StatSummary>;
      setChoreStats((prev) => prev.map((row) =>
        row.id === choreId
          ? {
              ...row,
              stats: {
                ...row.stats,
                ...stats,
                lastCompletedAt: stats.lastCompletedAt ?? row.stats.lastCompletedAt ?? null,
                nextDueAt: stats.nextDueAt ?? row.stats.nextDueAt ?? null,
                completedStreak: stats.completedStreak ?? row.stats.completedStreak,
                longestStreak: stats.longestStreak ?? row.stats.longestStreak,
                completedCount: stats.completedCount ?? row.stats.completedCount,
                missedCount: stats.missedCount ?? row.stats.missedCount,
              },
            }
          : row,
      ));
      setLooseItems((prev) => prev.filter((item) => !(item.source === 'chore' && (item.raw?.id === choreId || item.id === `chore-${choreId}`))));
    } catch (error) {
      console.error('Failed to complete chore', error);
      alert('Failed to complete chore');
    }
  };

  const handleCompleteRoutine = async (routineId: string) => {
    try {
      const callable = httpsCallable(functions, 'completeRoutine');
      const res = await callable({ routineId });
      const stats = ((res?.data as any)?.stats || {}) as Partial<StatSummary>;
      setRoutineStats((prev) => prev.map((row) =>
        row.id === routineId
          ? {
              ...row,
              stats: {
                ...row.stats,
                ...stats,
                lastCompletedAt: stats.lastCompletedAt ?? row.stats.lastCompletedAt ?? null,
                nextDueAt: stats.nextDueAt ?? row.stats.nextDueAt ?? null,
                completedStreak: stats.completedStreak ?? row.stats.completedStreak,
                longestStreak: stats.longestStreak ?? row.stats.longestStreak,
                completedCount: stats.completedCount ?? row.stats.completedCount,
                missedCount: stats.missedCount ?? row.stats.missedCount,
              },
            }
          : row,
      ));
      setLooseItems((prev) => prev.filter((item) => !(item.source === 'routine' && (item.raw?.id === routineId || item.id === `routine-${routineId}`))));
    } catch (error) {
      console.error('Failed to complete routine', error);
      alert('Failed to complete routine');
    }
  };

  const handleSkipRoutine = async (routineId: string) => {
    try {
      const callable = httpsCallable(functions, 'skipRoutine');
      const res = await callable({ routineId });
      const stats = ((res?.data as any)?.stats || {}) as Partial<StatSummary>;
      setRoutineStats((prev) => prev.map((row) =>
        row.id === routineId
          ? {
              ...row,
              stats: {
                ...row.stats,
                ...stats,
                nextDueAt: stats.nextDueAt ?? row.stats.nextDueAt ?? null,
                completedStreak: stats.completedStreak ?? 0,
                missedCount: stats.missedCount ?? row.stats.missedCount,
              },
            }
          : row,
      ));
    } catch (error) {
      console.error('Failed to skip routine', error);
      alert('Failed to skip routine');
    }
  };

  const markDone = async (item: ChecklistItem) => {
    try {
      if (item.source === 'scheduled' || item.source === 'unscheduled') {
        const ref = doc(db, `scheduled_instances/${item.id}`);
        await updateDoc(ref, { status: 'completed', statusUpdatedAt: Date.now(), updatedAt: Date.now() });
        setScheduled(prev => prev.filter(inst => inst.id !== item.id));
        return;
      } else if (item.source === 'task') {
        const id = item.raw?.id || item.id.replace('task-', '');
        await updateDoc(doc(db, 'tasks', id), { status: 2, updatedAt: Date.now() });
        setLooseItems(prev => prev.filter(i => i.id !== item.id));
        return;
      } else if (item.source === 'chore') {
        const chore = item.raw || {};
        const id = chore.id || item.id.replace('chore-', '');
        await handleCompleteChore(id);
        return;
      } else if (item.source === 'habit') {
        const h = item.raw || {};
        const entryId = todayKey;
        await updateDoc(doc(db, `habits/${h.id}/habitEntries/${entryId}`), { isCompleted: true, updatedAt: Date.now() }).catch(async () => {
          await setDoc(doc(db, `habits/${h.id}/habitEntries/${entryId}`), {
            id: entryId, habitId: h.id, date: new Date().setHours(0,0,0,0), value: 1, isCompleted: true, createdAt: Date.now(), updatedAt: Date.now()
          });
        });
        setLooseItems(prev => prev.filter(i => i.id !== item.id));
        return;
      } else if (item.source === 'routine') {
        const routine = item.raw || {};
        const id = routine.id || item.id.replace('routine-', '');
        await handleCompleteRoutine(id);
        return;
      }
    } catch (e) {
      console.error('Failed to mark done', e);
      alert('Failed to mark done');
    }
  };

  const formatRelativeTime = (value?: number | null) => {
    if (!value) return '—';
    try {
      return formatDistanceToNow(new Date(value), { addSuffix: true });
    } catch {
      return '—';
    }
  };

  const formatDateValue = (value?: number | null) => {
    if (!value) return '—';
    try {
      return format(new Date(value), 'PP');
    } catch {
      return '—';
    }
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">{title}</h5>
      </div>
      {loading ? (
        <div className="text-muted small">Loading…</div>
      ) : (
        <div className={`row ${compact ? '' : 'g-3'}`}>
          <div className="col-12 col-md-6">
            <h6 className="text-muted">Now / Next</h6>
            {nowNext.length === 0 && <div className="text-muted small">Nothing pending</div>}
            {nowNext.map(i => (
              <div key={i.id} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
              <div className="d-flex flex-column">
                <span className="fw-semibold">{i.title}</span>
                <small className="text-muted">{i.subtitle || (i.source === 'scheduled' ? 'Scheduled' : i.source === 'unscheduled' ? 'Needs block' : i.source === 'task' ? 'Task' : i.source === 'chore' ? 'Chore' : 'Habit')}</small>
              </div>
              <button className="btn btn-sm btn-outline-success" onClick={() => markDone(i)}>Done</button>
              </div>
            ))}
          </div>
          <div className="col-12 col-md-6">
            <h6 className="text-muted">Later Today</h6>
            {later.length === 0 && <div className="text-muted small">Nothing later</div>}
            {later.map(i => (
              <div key={i.id} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
                <div className="d-flex flex-column">
                  <span className="fw-semibold">{i.title}</span>
                  <small className="text-muted">{i.subtitle || (i.source === 'scheduled' ? 'Scheduled' : i.source === 'unscheduled' ? 'Needs block' : i.source === 'task' ? 'Task' : i.source === 'chore' ? 'Chore' : 'Habit')}</small>
                </div>
                <button className="btn btn-sm btn-outline-success" onClick={() => markDone(i)}>Done</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0">Chores</h6>
          {loadingStats ? <span className="text-muted small">Syncing…</span> : <span className="text-muted small">{choreStats.length} item{choreStats.length === 1 ? '' : 's'}</span>}
        </div>
        {loadingStats && choreStats.length === 0 ? (
          <div className="text-muted small">Loading chore stats…</div>
        ) : choreStats.length === 0 ? (
          <div className="text-muted small">No chores defined yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Chore</th>
                  <th>Next Due</th>
                  <th>Last Done</th>
                  <th>Streak</th>
                  <th>Completed</th>
                  <th>Missed</th>
                  <th style={{ width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {choreStats.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="fw-semibold">{row.title}</div>
                      {row.cadence && <div className="text-muted small">{row.cadence}</div>}
                    </td>
                    <td title={formatDateValue(row.stats.nextDueAt)}>{formatRelativeTime(row.stats.nextDueAt)}</td>
                    <td title={formatDateValue(row.stats.lastCompletedAt)}>{formatRelativeTime(row.stats.lastCompletedAt)}</td>
                    <td>{row.stats.completedStreak} 
                      <span className="text-muted small"> / best {row.stats.longestStreak}</span>
                    </td>
                    <td>{row.stats.completedCount}</td>
                    <td>{row.stats.missedCount}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-success" onClick={() => handleCompleteChore(row.id)}>Complete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0">Routines</h6>
          {loadingStats ? <span className="text-muted small">Syncing…</span> : <span className="text-muted small">{routineStats.length} item{routineStats.length === 1 ? '' : 's'}</span>}
        </div>
        {loadingStats && routineStats.length === 0 ? (
          <div className="text-muted small">Loading routine stats…</div>
        ) : routineStats.length === 0 ? (
          <div className="text-muted small">No routines defined yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Routine</th>
                  <th>Next Run</th>
                  <th>Last Run</th>
                  <th>Streak</th>
                  <th>Completed</th>
                  <th>Missed</th>
                  <th style={{ width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {routineStats.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="fw-semibold">{row.name}</div>
                      {row.cadence && <div className="text-muted small">{row.cadence}</div>}
                    </td>
                    <td title={formatDateValue(row.stats.nextDueAt)}>{formatRelativeTime(row.stats.nextDueAt)}</td>
                    <td title={formatDateValue(row.stats.lastCompletedAt)}>{formatRelativeTime(row.stats.lastCompletedAt)}</td>
                    <td>{row.stats.completedStreak} 
                      <span className="text-muted small"> / best {row.stats.longestStreak}</span>
                    </td>
                    <td>{row.stats.completedCount}</td>
                    <td>{row.stats.missedCount}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-success" onClick={() => handleCompleteRoutine(row.id)}>Complete</button>
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => handleSkipRoutine(row.id)}>Skip</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChecklistPanel;
