import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { startOfDay, endOfDay, formatDistanceToNow, format } from 'date-fns';
import { httpsCallable } from 'firebase/functions';
import { nextDueAt } from '../utils/recurrence';
import { schedulerCollections, ScheduledInstanceModel } from '../domain/scheduler/repository';
import { humanizePolicyMode } from '../utils/schedulerPolicy';

export interface ChecklistPanelProps {
  title?: string;
  compact?: boolean;
  dailyChecklist?: DailyChecklistData | null;
}

interface DailyChecklistData {
  items?: DailyChecklistEntry[];
  stats?: {
    total?: number;
    focus?: number;
    chores?: number;
    routines?: number;
    reminders?: number;
    stories?: number;
  } | null;
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

interface DailyChecklistEntry {
  key: string;
  type: 'task' | 'chore' | 'routine' | 'story' | 'reminder' | 'habit';
  title: string;
  category?: string;
  dueDisplay?: string | null;
  reason?: string | null;
  nextStep?: string | null;
  bucket?: string | null;
  ref?: string | null;
  checkable?: boolean;
  highlight?: boolean;
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

const ACTIONABLE_SOURCES = new Set(['scheduled', 'unscheduled', 'task', 'chore', 'habit', 'routine']);

const toChecklistKey = (item: ChecklistItem): string | null => {
  if (!item) return null;
  if (item.source === 'task') {
    const id = item.raw?.id || item.id.replace(/^task-/, '');
    return id ? `task:${id}` : null;
  }
  if (item.source === 'chore') {
    const id = item.raw?.id || item.id.replace(/^chore-/, '');
    return id ? `chore:${id}` : null;
  }
  if (item.source === 'routine') {
    const id = item.raw?.id || item.id.replace(/^routine-/, '');
    return id ? `routine:${id}` : null;
  }
  if (item.source === 'habit') {
    const id = item.raw?.id || item.id.replace(/^habit-/, '');
    return id ? `habit:${id}` : null;
  }
  if (item.source === 'scheduled' || item.source === 'unscheduled') {
    return item.id ? `${item.source}:${item.id}` : null;
  }
  return null;
};

const ChecklistPanel: React.FC<ChecklistPanelProps> = ({ title = "Today's Checklist", compact, dailyChecklist }) => {
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

        const habitsSnap = await getDocs(query(collection(db, 'habits'), where('ownerUid', '==', currentUser.uid), where('isActive', '==', true)));
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
  }, [currentUser, todayKey, todayIso]);

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
        if (inst.schedulingContext?.policyMode) {
          subtitlePieces.push(`Policy: ${humanizePolicyMode(inst.schedulingContext.policyMode)}`);
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

  const keyedItems = useMemo(() => {
    const map = new Map<string, ChecklistItem>();
    [...scheduledItems, ...looseItems].forEach((item) => {
      const key = toChecklistKey(item);
      if (key) map.set(key, item);
    });
    return map;
  }, [scheduledItems, looseItems]);

  const summaryGroups = useMemo(() => {
    if (!dailyChecklist || !Array.isArray(dailyChecklist.items) || !dailyChecklist.items.length) return null;
    const groups = new Map<string, { entry: DailyChecklistEntry; item: ChecklistItem | null }[]>();
    dailyChecklist.items.forEach((entry) => {
      if (!entry?.key) return;
      const item = keyedItems.get(entry.key) || null;
      const category = entry.category || 'Today';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push({ entry, item });
    });
    return groups;
  }, [dailyChecklist, keyedItems]);

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

  const describeSource = (item: ChecklistItem): string => {
    if (item.subtitle) return item.subtitle;
    switch (item.source) {
      case 'scheduled':
        return 'Scheduled';
      case 'unscheduled':
        return 'Needs block';
      case 'task':
        return 'Task';
      case 'chore':
        return 'Chore';
      case 'routine':
        return 'Routine';
      default:
        return 'Habit';
    }
  };

  const renderActions = (item: ChecklistItem) => {
    const actions: React.ReactNode[] = [];
    if ((item.source === 'scheduled' || item.source === 'unscheduled') && item.raw) {
      const instance = item.raw as ScheduledInstanceModel;
      if (instance.deepLink) {
        actions.push(
          <a
            key="open"
            className="btn btn-sm btn-outline-secondary"
            href={instance.deepLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            View
          </a>,
        );
      }
      if (instance.mobileCheckinUrl) {
        actions.push(
          <a
            key="checkin"
            className="btn btn-sm btn-outline-primary"
            href={instance.mobileCheckinUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Check-in
          </a>,
        );
      }
    }
    if (ACTIONABLE_SOURCES.has(item.source)) {
      actions.push(
        <button
          key="done"
          type="button"
          className="btn btn-sm btn-outline-success"
          onClick={() => markDone(item)}
        >
          Done
        </button>,
      );
    }
    return actions;
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
      {summaryGroups ? (
        <div className={compact ? 'mb-3' : 'mb-4'}>
          {Array.from(summaryGroups.entries()).map(([category, entries]) => (
            <div key={category} className="mb-3">
              <h6 className="text-uppercase text-muted small mb-2">{category}</h6>
              {entries.map(({ entry, item }) => {
                const metaParts: string[] = [];
                if (entry.reason) metaParts.push(entry.reason);
                else if (item) metaParts.push(describeSource(item));
                if (entry.dueDisplay && !(entry.reason && entry.reason.includes(entry.dueDisplay))) {
                  metaParts.push(entry.dueDisplay);
                }
                const metaLine = metaParts.join(' · ');
                const canComplete = !!item && ACTIONABLE_SOURCES.has(item.source) && entry.checkable !== false;
                const cardClasses = ['border', 'rounded', 'p-2', 'mb-2', 'bg-white'];
                if (entry.highlight) cardClasses.push('border-primary');

                return (
                  <div key={entry.key} className={cardClasses.join(' ')}>
                    <div className="d-flex flex-column gap-2">
                      <div className="d-flex align-items-start justify-content-between gap-2">
                        <div>
                          <div className="fw-semibold">
                            {entry.title || item?.title || 'Item'}
                            {entry.ref ? <span className="text-muted ms-2 small">{entry.ref}</span> : null}
                            {entry.bucket ? <span className="badge bg-primary-subtle text-primary ms-2">{entry.bucket}</span> : null}
                          </div>
                          {metaLine && <div className="text-muted small">{metaLine}</div>}
                          {entry.nextStep && <div className="small text-dark">Next: {entry.nextStep}</div>}
                        </div>
                        {canComplete ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success"
                            onClick={() => item && markDone(item)}
                          >
                            Done
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : loading ? (
        <div className="text-muted small">Loading…</div>
      ) : (
        <div className={`row ${compact ? '' : 'g-3'}`}>
          <div className="col-12 col-md-6">
            <h6 className="text-muted">Now / Next</h6>
            {nowNext.length === 0 && <div className="text-muted small">Nothing pending</div>}
            {nowNext.map((item) => (
              <div
                key={item.id}
                className="border rounded p-2 mb-2 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2"
              >
                <div className="d-flex flex-column">
                  <span className="fw-semibold">{item.title}</span>
                  <small className="text-muted">{describeSource(item)}</small>
                </div>
                <div className="d-flex flex-wrap gap-2 justify-content-end">
                  {renderActions(item)}
                </div>
              </div>
            ))}
          </div>
          <div className="col-12 col-md-6">
            <h6 className="text-muted">Later Today</h6>
            {later.length === 0 && <div className="text-muted small">Nothing later</div>}
            {later.map((item) => (
              <div
                key={item.id}
                className="border rounded p-2 mb-2 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2"
              >
                <div className="d-flex flex-column">
                  <span className="fw-semibold">{item.title}</span>
                  <small className="text-muted">{describeSource(item)}</small>
                </div>
                <div className="d-flex flex-wrap gap-2 justify-content-end">
                  {renderActions(item)}
                </div>
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
