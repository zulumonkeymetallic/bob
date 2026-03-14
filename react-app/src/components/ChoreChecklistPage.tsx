import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Form, ListGroup, Spinner } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { endOfDay, format, startOfDay } from 'date-fns';
import { Activity } from 'lucide-react';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Task } from '../types';
import { resolveRecurringDueMs, resolveTaskDueMs } from '../utils/recurringTaskDue';

interface BlockWindow {
  start: number;
  end: number;
}

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const getTaskDueMs = (task: Task): number | null => resolveTaskDueMs(task);

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

const getChoreKind = (task: Task): 'chore' | 'routine' | 'habit' | null => {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
  if (normalized) return null;
  const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
  const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
  if (tagKeys.includes('chore')) return 'chore';
  if (tagKeys.includes('routine')) return 'routine';
  if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
  return null;
};

const formatDueLabel = (dueMs?: number | null) => {
  if (!dueMs) return 'Today';
  const d = new Date(dueMs);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return hasTime ? format(d, 'HH:mm') : format(d, 'MMM d');
};

const ChoreChecklistPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});
  const [localDone, setLocalDone] = useState<Record<string, boolean>>({});
  const [blockWindow, setBlockWindow] = useState<BlockWindow | null>(null);

  const dateParam = searchParams.get('date') || toIsoDate(new Date());
  const taskHighlightId = searchParams.get('taskId');
  const blockId = searchParams.get('blockId');

  const selectedDate = useMemo(() => {
    const parsed = new Date(`${dateParam}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [dateParam]);

  const rangeStartMs = useMemo(() => startOfDay(selectedDate).getTime(), [selectedDate]);
  const rangeEndMs = useMemo(() => endOfDay(selectedDate).getTime(), [selectedDate]);

  useEffect(() => {
    if (!currentUser?.uid || !blockId) {
      setBlockWindow(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'calendar_blocks', blockId));
        if (!snap.exists()) {
          if (mounted) setBlockWindow(null);
          return;
        }
        const data = snap.data() as any;
        const start = typeof data.start === 'number' ? data.start : null;
        const end = typeof data.end === 'number' ? data.end : null;
        if (mounted && start && end) setBlockWindow({ start, end });
      } catch {
        if (mounted) setBlockWindow(null);
      }
    })();
    return () => { mounted = false; };
  }, [currentUser?.uid, blockId]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setTasks([]);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as Task);
        setTasks(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.uid]);

  const handleDateChange = (nextIso: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextIso) nextParams.set('date', nextIso);
    else nextParams.delete('date');
    setSearchParams(nextParams, { replace: true });
  };

  const choresForDate = useMemo(() => {
    const list = tasks
      .filter((task) => !task.deleted)
      .filter((task) => (task.status ?? 0) !== 2)
      .filter((task) => !currentPersona || !task.persona || task.persona === currentPersona)
      .filter((task) => !!getChoreKind(task))
      .filter((task) => !localDone[task.id]);

    const filtered = list.filter((task) => {
      const hasBlock = !!blockWindow;
      const fallbackMs = hasBlock ? blockWindow!.start : rangeStartMs;
      const due = resolveRecurringDueMs(task, selectedDate, fallbackMs);
      if (!due) return false;
      if (hasBlock) {
        return due >= blockWindow!.start && due <= blockWindow!.end;
      }
      return due >= rangeStartMs && due <= rangeEndMs;
    }).filter((task) => {
      const lastDone = getLastDoneMs(task);
      if (!lastDone) return true;
      return lastDone < rangeStartMs || lastDone > rangeEndMs;
    });

    filtered.sort((a, b) => {
      const aDue = resolveRecurringDueMs(a, selectedDate, blockWindow?.start ?? rangeStartMs) ?? 0;
      const bDue = resolveRecurringDueMs(b, selectedDate, blockWindow?.start ?? rangeStartMs) ?? 0;
      return aDue - bDue;
    });
    return filtered;
  }, [tasks, currentPersona, rangeStartMs, rangeEndMs, blockWindow, localDone, selectedDate]);

  const handleComplete = useCallback(async (task: Task) => {
    if (!currentUser?.uid) return;
    if (completing[task.id]) return;
    setCompleting((prev) => ({ ...prev, [task.id]: true }));
    try {
      const callable = httpsCallable(functions, 'completeChoreTask');
      await callable({ taskId: task.id });
      setLocalDone((prev) => ({ ...prev, [task.id]: true }));
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

  const titleDate = format(selectedDate, 'MMMM d, yyyy');

  return (
    <div className="container py-3" style={{ maxWidth: 960 }}>
      <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2 mb-3">
        <div>
          <h4 className="mb-1">Chores Checklist</h4>
          <div className="text-muted small">{blockWindow ? 'Planned block' : 'All chores due'} for {titleDate}</div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Form.Control
            type="date"
            value={toIsoDate(selectedDate)}
            onChange={(e) => handleDateChange(e.target.value)}
            style={{ maxWidth: 180 }}
          />
          <Button variant="outline-secondary" size="sm" onClick={() => handleDateChange(toIsoDate(new Date()))}>Today</Button>
        </div>
      </div>

      <Card>
        <Card.Body>
          {loading ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner size="sm" animation="border" /> Loading chores…
            </div>
          ) : choresForDate.length === 0 ? (
            <div className="text-muted">No chores, routines, or habits due for this date.</div>
          ) : (
            (() => {
              const morning: typeof choresForDate = [];
              const afternoon: typeof choresForDate = [];
              const evening: typeof choresForDate = [];
              const other: typeof choresForDate = [];

              choresForDate.forEach((task) => {
                const tod = (task as any).timeOfDay;
                if (tod === 'morning') morning.push(task);
                else if (tod === 'afternoon') afternoon.push(task);
                else if (tod === 'evening') evening.push(task);
                else other.push(task);
              });

              const renderChoreItem = (task: any) => {
                const kind = getChoreKind(task) || 'chore';
                const badgeVariant = kind === 'routine' ? 'success' : kind === 'habit' ? 'secondary' : 'primary';
                const badgeLabel = kind === 'routine' ? 'Routine' : kind === 'habit' ? 'Habit' : 'Chore';
                const dueMs = resolveRecurringDueMs(task, selectedDate, blockWindow?.start ?? rangeStartMs);
                const dueLabel = formatDueLabel(dueMs);
                const isHighlight = taskHighlightId && taskHighlightId === task.id;
                const busy = !!completing[task.id];
                return (
                  <ListGroup.Item key={task.id} className={isHighlight ? 'border border-primary rounded mb-1' : 'mb-1 rounded border'}>
                    <div className="d-flex align-items-center gap-2">
                      <Form.Check
                        type="checkbox"
                        checked={busy}
                        disabled={busy}
                        onChange={() => handleComplete(task)}
                        aria-label={`Complete ${task.title}`}
                      />
                      <div className="flex-grow-1">
                        <div className="fw-semibold">{task.title}</div>
                        <div className="text-muted small">Due {dueLabel}</div>
                      </div>
                      <div className="d-flex flex-column align-items-end gap-1">
                        <Badge bg={badgeVariant}>{badgeLabel}</Badge>
                        <button
                          type="button"
                          className="d-inline-flex align-items-center justify-content-center"
                          onClick={() => showSidebar(task as any, 'task')}
                          title="Activity stream"
                          aria-label={`Open activity stream for ${task.title}`}
                          style={{
                            color: 'var(--bs-secondary-color)',
                            padding: 4,
                            borderRadius: 4,
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            lineHeight: 0,
                            flexShrink: 0,
                          }}
                        >
                          <Activity size={14} />
                        </button>
                      </div>
                    </div>
                  </ListGroup.Item>
                );
              };

              return (
                <ListGroup variant="flush">
                  {morning.length > 0 && (
                    <div className="mb-3">
                      <h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Morning</small></h6>
                      {morning.map((task) => renderChoreItem(task))}
                    </div>
                  )}
                  {afternoon.length > 0 && (
                    <div className="mb-3">
                      <h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Afternoon</small></h6>
                      {afternoon.map((task) => renderChoreItem(task))}
                    </div>
                  )}
                  {evening.length > 0 && (
                    <div className="mb-3">
                      <h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Evening</small></h6>
                      {evening.map((task) => renderChoreItem(task))}
                    </div>
                  )}
                  {other.length > 0 && (
                    <div className="mb-0">
                      {(morning.length > 0 || afternoon.length > 0 || evening.length > 0) && (
                        <h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Other / Anytime</small></h6>
                      )}
                      {other.map((task) => renderChoreItem(task))}
                    </div>
                  )}
                </ListGroup>
              );
            })()
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default ChoreChecklistPage;
