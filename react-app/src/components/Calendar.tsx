import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Container, Row, Col, Card, Button, Badge, Modal, Form, Spinner } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { CalendarBlock, Task } from '../types';
import StoryBlock from './StoryBlock';
import { DndContext, useDraggable, useDroppable, DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ListChecks, Clock } from 'lucide-react';
import { isRecurringDueOnDate, resolveRecurringDueMs, resolveTaskDueMs } from '../utils/recurringTaskDue';

// Draggable Block Wrapper
const DraggableBlock = ({ block, children }: { block: any, children: React.ReactNode }) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: block.id,
    data: block
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    zIndex: transform ? 999 : 'auto',
    cursor: 'grab',
    touchAction: 'none'
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      {children}
    </div>
  );
};

// Droppable Slot Wrapper
const DroppableSlot = ({ date, hour, children }: { date: Date, hour: number, children: React.ReactNode }) => {
  const slotId = `${date.toISOString().split('T')[0]}:${hour}`;
  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: { date, hour }
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: '60px',
        borderBottom: '1px solid #eee',
        backgroundColor: isOver ? '#f0f9ff' : 'transparent',
        position: 'relative',
        padding: '2px'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, fontSize: '0.6rem', color: '#ccc', padding: '2px' }}>
        {hour}:00
      </div>
      {children}
    </div>
  );
};

const Calendar: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [currentStart, setCurrentStart] = useState(new Date()); // Start of rolling window
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    start: '',
    duration: 60,
    theme: 'Health' as 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home',
    subtheme: '',
    repeatWeekly: false,
    repeatDays: { SU: false, MO: false, TU: false, WE: false, TH: false, FR: false, SA: false } as Record<'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA', boolean>,
    repeatUntil: ''
  });
  const [choresDueToday, setChoresDueToday] = useState<Task[]>([]);
  const [choresLoading, setChoresLoading] = useState(false);
  const [choreCompletionBusy, setChoreCompletionBusy] = useState<Record<string, boolean>>({});
  const [tasksDueTodayList, setTasksDueTodayList] = useState<Task[]>([]);
  const [tasksDueTodayLoading, setTasksDueTodayLoading] = useState(false);
  const [tasksDueTodaySortMode, setTasksDueTodaySortMode] = useState<'due' | 'ai' | 'top3'>('due');
  const [replanLoading, setReplanLoading] = useState(false);
  const [fullReplanLoading, setFullReplanLoading] = useState(false);
  const [replanFeedback, setReplanFeedback] = useState<string | null>(null);

  const getTaskDueMs = useCallback((task: Task): number | null => resolveTaskDueMs(task), []);

  const getTaskLastDoneMs = useCallback((task: Task): number | null => {
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
  }, []);

  const getChoreKind = useCallback((task: Task): 'chore' | 'routine' | 'habit' | null => {
    const raw = String((task as any)?.type || (task as any)?.task_type || '').toLowerCase();
    const normalized = raw === 'habitual' ? 'habit' : raw;
    if (['chore', 'routine', 'habit'].includes(normalized)) return normalized as any;
    const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
    const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
    if (tagKeys.includes('chore')) return 'chore';
    if (tagKeys.includes('routine')) return 'routine';
    if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
    return null;
  }, []);

  const formatDueDetail = useCallback((dueMs: number) => {
    const dueDate = new Date(dueMs);
    const dateLabel = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeLabel = dueDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const hasTime = dueDate.getHours() !== 0 || dueDate.getMinutes() !== 0;
    return hasTime ? `${dateLabel} • ${timeLabel}` : dateLabel;
  }, []);

  const todayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  // Load calendar blocks
  useEffect(() => {
    if (!currentUser) return;
    const windowEnd = new Date(currentStart);
    windowEnd.setDate(currentStart.getDate() + 8); // Fetch a bit more

    const blocksQuery = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', currentStart.getTime()),
      where('start', '<=', windowEnd.getTime())
    );

    const unsubscribe = onSnapshot(blocksQuery, (snapshot) => {
      const blocksData: CalendarBlock[] = [];
      snapshot.forEach((doc) => {
        blocksData.push({ id: doc.id, ...doc.data() } as CalendarBlock);
      });
      setBlocks(blocksData);
    });
    return () => unsubscribe();
  }, [currentUser, currentStart]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setChoresDueToday([]);
      setChoresLoading(false);
      setTasksDueTodayList([]);
      setTasksDueTodayLoading(false);
      return;
    }
    setChoresLoading(true);
    setTasksDueTodayLoading(true);
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const allRows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as Task))
          .filter((task) => !task.deleted)
          .filter((task) => {
            const due = getTaskDueMs(task);
            if (due) return due <= todayEnd.getTime();
            return !!getChoreKind(task) && isRecurringDueOnDate(task, todayStart, due);
          })
          .filter((task) => (task.status ?? 0) !== 2);

        const rows = allRows
          .filter((task) => !!getChoreKind(task))
          .filter((task) => {
            const lastDone = getTaskLastDoneMs(task);
            if (!lastDone) return true;
            return lastDone < todayStart.getTime() || lastDone > todayEnd.getTime();
          });

        const taskRows = allRows.filter((task) => !getChoreKind(task));

        rows.sort((a, b) => {
          const aDue = resolveRecurringDueMs(a, new Date(), todayStartMs) ?? 0;
          const bDue = resolveRecurringDueMs(b, new Date(), todayStartMs) ?? 0;
          return aDue - bDue;
        });
        setChoresDueToday(rows);
        setChoresLoading(false);
        setTasksDueTodayList(taskRows);
        setTasksDueTodayLoading(false);
      },
      (err) => {
        console.warn('Calendar: failed to load chores due today', err);
        setChoresDueToday([]);
        setChoresLoading(false);
        setTasksDueTodayList([]);
        setTasksDueTodayLoading(false);
      },
    );
    return () => unsub();
  }, [currentUser?.uid, currentPersona, getTaskDueMs, getChoreKind, getTaskLastDoneMs, todayStartMs]);

  const tasksDueTodaySorted = useMemo(() => {
    let rows = [...tasksDueTodayList];
    if (tasksDueTodaySortMode === 'top3') {
      rows = rows.filter((t) => (t as any).aiTop3ForDay === true);
      rows.sort((a, b) => {
        const ar = Number((a as any).aiPriorityRank || 0) || 99;
        const br = Number((b as any).aiPriorityRank || 0) || 99;
        return ar - br;
      });
      return rows;
    }
    if (tasksDueTodaySortMode === 'ai') {
      rows.sort((a, b) => {
        const aScore = Number((a as any).aiCriticalityScore ?? (a as any).aiPriorityScore ?? 0);
        const bScore = Number((b as any).aiCriticalityScore ?? (b as any).aiPriorityScore ?? 0);
        if (aScore !== bScore) return bScore - aScore;
        return (getTaskDueMs(a) ?? 0) - (getTaskDueMs(b) ?? 0);
      });
      return rows;
    }
    rows.sort((a, b) => (getTaskDueMs(a) ?? 0) - (getTaskDueMs(b) ?? 0));
    return rows;
  }, [tasksDueTodayList, tasksDueTodaySortMode, getTaskDueMs]);

  const handleCompleteChoreTask = useCallback(async (task: Task) => {
    if (!currentUser) return;
    const taskId = task.id;
    if (!taskId || choreCompletionBusy[taskId]) return;
    setChoreCompletionBusy((prev) => ({ ...prev, [taskId]: true }));
    try {
      const fn = httpsCallable(functions, 'completeChoreTask');
      await fn({ taskId });
    } catch (err) {
      console.warn('Failed to complete chore task', err);
      setChoreCompletionBusy((prev) => ({ ...prev, [taskId]: false }));
      return;
    }
    setTimeout(() => {
      setChoreCompletionBusy((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }, 1500);
  }, [currentUser, choreCompletionBusy]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const blockId = active.id as string;
    const block = active.data.current as any;
    const slotData = over.data.current as { date: Date, hour: number };

    if (block && slotData) {
      const newStart = new Date(slotData.date);
      newStart.setHours(slotData.hour, 0, 0, 0);
      const duration = block.end - block.start;
      const newEnd = new Date(newStart.getTime() + duration);

      // Optimistic update
      setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, start: newStart.getTime(), end: newEnd.getTime() } : b));

      try {
        await updateDoc(doc(db, 'calendar_blocks', blockId), {
          start: newStart.getTime(),
          end: newEnd.getTime(),
          updatedAt: Date.now()
        });

        // Trigger rebalance/sync if needed (backend handles sync on write)
      } catch (e) {
        console.error("Failed to move block", e);
        // Revert on failure (could reload from db)
      }
    }
  };

  const getRollingDates = () => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentStart);
      d.setDate(currentStart.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  const rollingDates = getRollingDates();
  const hours = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 10pm

  const navigate = (days: number) => {
    const newStart = new Date(currentStart);
    newStart.setDate(currentStart.getDate() + days);
    setCurrentStart(newStart);
  };

  const handleDeltaReplan = useCallback(async () => {
    if (!currentUser) return;
    setReplanFeedback(null);
    setReplanLoading(true);
    try {
      const callable = httpsCallable(functions, 'replanCalendarNow');
      const response = await callable({ days: 7 });
      const payload = response.data as { created?: number; rescheduled?: number; blocked?: number };
      const parts: string[] = [];
      if (payload?.created) parts.push(`${payload.created} created`);
      if (payload?.rescheduled) parts.push(`${payload.rescheduled} moved`);
      if (payload?.blocked) parts.push(`${payload.blocked} blocked`);
      setReplanFeedback(parts.length ? `Delta replan complete: ${parts.join(', ')}.` : 'Delta replan complete.');
    } catch (err) {
      console.error('Delta replan failed', err);
      setReplanFeedback('Delta replan failed. Please retry.');
    } finally {
      setReplanLoading(false);
    }
  }, [currentUser]);

  const handleFullReplan = useCallback(async () => {
    if (!currentUser) return;
    setReplanFeedback(null);
    setFullReplanLoading(true);
    try {
      const callable = httpsCallable(functions, 'runNightlyChainNow');
      const response = await callable({});
      const payload = response.data as { results?: Array<{ status?: string }> };
      const total = payload?.results?.length || 0;
      const ok = (payload?.results || []).filter((item) => item.status === 'ok').length;
      if (total > 0 && ok === total) {
        setReplanFeedback(`Full replan complete: ${ok}/${total} orchestration steps succeeded.`);
      } else if (total > 0 && ok > 0) {
        setReplanFeedback(`Full replan partial: ${ok}/${total} orchestration steps succeeded.`);
      } else {
        setReplanFeedback('Full replan finished with errors. Check logs.');
      }
    } catch (err) {
      console.error('Full replan failed', err);
      setReplanFeedback('Full replan failed. Please retry.');
    } finally {
      setFullReplanLoading(false);
    }
  }, [currentUser]);

  if (!currentUser) return <div>Please sign in.</div>;

  return (
    <Container fluid className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Rolling Calendar</h2>
        <div>
          <Button variant="outline-secondary" onClick={() => navigate(-1)} className="me-2">Prev</Button>
          <Button variant="outline-secondary" onClick={() => setCurrentStart(new Date())} className="me-2">Today</Button>
          <Button variant="outline-secondary" onClick={() => navigate(1)} className="me-2">Next</Button>
          <Button
            variant="outline-primary"
            onClick={handleDeltaReplan}
            className="me-2"
            disabled={replanLoading || fullReplanLoading}
            title="Delta replan: quickly rebalance existing calendar blocks using current priorities."
          >
            {replanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : null}
            Delta replan
          </Button>
          <Button
            variant="primary"
            onClick={handleFullReplan}
            className="me-2"
            disabled={fullReplanLoading || replanLoading}
            title="Full replan: runs full nightly orchestration (pointing, conversions, priority scoring, and calendar planning)."
          >
            {fullReplanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : null}
            Full replan
          </Button>
          <Button variant="primary" onClick={() => setShowCreateEvent(true)}>+ Event</Button>
        </div>
      </div>
      {replanFeedback && (
        <div className="text-muted small mb-3">{replanFeedback}</div>
      )}

      <Row className="g-3">
        <Col lg={9} md={12}>
          <DndContext onDragEnd={handleDragEnd}>
            <div style={{ display: 'flex', overflowX: 'auto', minWidth: '100%' }}>
              {/* Time Column */}
              <div style={{ width: '50px', flexShrink: 0, paddingTop: '40px' }}>
                {hours.map(h => (
                  <div key={h} style={{ height: '60px', textAlign: 'right', paddingRight: '5px', fontSize: '0.7rem', color: '#888' }}>
                    {h}:00
                  </div>
                ))}
              </div>

              {/* Days Columns */}
              {rollingDates.map((date, i) => {
                const isToday = date.toDateString() === new Date().toDateString();
                return (
                  <div key={i} style={{ flex: 1, minWidth: '140px', borderLeft: '1px solid #eee' }}>
                    <div className={`text-center p-2 ${isToday ? 'bg-primary text-white' : 'bg-light'}`} style={{ borderBottom: '1px solid #ddd' }}>
                      <div style={{ fontWeight: 'bold' }}>{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      <div>{date.getDate()}</div>
                    </div>

                    {hours.map(hour => {
                      const slotStart = new Date(date);
                      slotStart.setHours(hour, 0, 0, 0);
                      const slotEnd = new Date(slotStart);
                      slotEnd.setHours(hour + 1, 0, 0, 0);

                      // Find blocks that start in this hour
                      // Note: This is a simplified view. Real calendar needs to handle overlaps and sub-hour precision.
                      // For MVP, we just show blocks starting in this hour.
                      const slotBlocks = blocks.filter(b => {
                        const bStart = new Date(b.start);
                        return bStart >= slotStart && bStart < slotEnd;
                      });

                      return (
                        <DroppableSlot key={hour} date={date} hour={hour}>
                          {slotBlocks.map(block => (
                            <DraggableBlock key={block.id} block={block}>
                              <StoryBlock event={{ ...block, title: block.title || 'Untitled' }} />
                            </DraggableBlock>
                          ))}
                        </DroppableSlot>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </DndContext>
        </Col>
        <Col lg={3} md={12}>
          <Card className="shadow-sm border-0 mb-3">
            <Card.Header className="d-flex align-items-center justify-content-between">
              <div className="fw-semibold d-flex align-items-center gap-2">
                <Clock size={16} /> Tasks due today
              </div>
              <div className="d-flex align-items-center gap-2">
                <Form.Select
                  size="sm"
                  value={tasksDueTodaySortMode}
                  onChange={(e) => setTasksDueTodaySortMode(e.target.value as 'due' | 'ai' | 'top3')}
                >
                  <option value="due">Sort: Due time</option>
                  <option value="ai">Sort: AI score</option>
                  <option value="top3">Top 3 (AI)</option>
                </Form.Select>
                <Badge bg={tasksDueTodaySorted.length > 0 ? 'info' : 'secondary'} pill>
                  {tasksDueTodaySorted.length}
                </Badge>
              </div>
            </Card.Header>
            <Card.Body className="p-3 d-flex flex-column gap-2">
              {tasksDueTodayLoading ? (
                <div className="d-flex align-items-center gap-2 text-muted">
                  <Spinner size="sm" animation="border" /> Loading tasks…
                </div>
              ) : tasksDueTodaySorted.length === 0 ? (
                <div className="text-muted small">No tasks due today.</div>
              ) : (
                tasksDueTodaySorted.map((task) => {
                  const dueMs = resolveRecurringDueMs(task, new Date(), todayStartMs);
                  const dueLabel = dueMs ? formatDueDetail(dueMs) : 'today';
                  const isOverdue = !!dueMs && dueMs < todayStartMs;
                  const refLabel = task.ref || task.id;
                  return (
                    <div key={task.id} className="border rounded p-2 d-flex align-items-start gap-2">
                      <div className="flex-grow-1">
                        <div className="fw-semibold">
                          <Link to={`/tasks/${encodeURIComponent(refLabel)}`} className="text-decoration-none">
                            {task.title}
                          </Link>
                        </div>
                        <div className="text-muted small d-flex align-items-center gap-1">
                          <Clock size={12} /> {isOverdue ? `Overdue · ${dueLabel}` : `Due ${dueLabel}`}
                        </div>
                      </div>
                      {isOverdue && <Badge bg="danger">Overdue</Badge>}
                    </div>
                  );
                })
              )}
            </Card.Body>
          </Card>

          <Card className="shadow-sm border-0">
            <Card.Header className="d-flex align-items-center justify-content-between">
              <div className="fw-semibold d-flex align-items-center gap-2">
                <ListChecks size={16} /> Chores &amp; Habits
              </div>
              <div className="d-flex align-items-center gap-2">
                <Button size="sm" variant="outline-secondary" href="/chores/checklist">Checklist</Button>
                <Badge bg={choresDueToday.length > 0 ? 'info' : 'secondary'} pill>
                  {choresDueToday.length}
                </Badge>
              </div>
            </Card.Header>
            <Card.Body className="p-3 d-flex flex-column gap-2">
              {choresLoading ? (
                <div className="d-flex align-items-center gap-2 text-muted">
                  <Spinner size="sm" animation="border" /> Loading chores…
                </div>
              ) : choresDueToday.length === 0 ? (
                <div className="text-muted small">No chores, habits, or routines due today.</div>
              ) : (
                choresDueToday.map((task) => {
                  const kind = getChoreKind(task) || 'chore';
                  const dueMs = getTaskDueMs(task);
                  const dueLabel = dueMs ? formatDueDetail(dueMs) : 'today';
                  const isOverdue = !!dueMs && dueMs < todayStartMs;
                  const badgeVariant = kind === 'routine' ? 'success' : kind === 'habit' ? 'secondary' : 'primary';
                  const badgeLabel = kind === 'routine' ? 'Routine' : kind === 'habit' ? 'Habit' : 'Chore';
                  const busy = !!choreCompletionBusy[task.id];
                  return (
                    <div key={task.id} className="border rounded p-2 d-flex align-items-start gap-2">
                      <Form.Check
                        type="checkbox"
                        checked={busy}
                        disabled={busy}
                        onChange={() => handleCompleteChoreTask(task)}
                        aria-label={`Complete ${task.title}`}
                      />
                      <div className="flex-grow-1">
                        <div className="fw-semibold">{task.title}</div>
                        <div className="text-muted small d-flex align-items-center gap-1">
                          <Clock size={12} /> {isOverdue ? `Overdue · ${dueLabel}` : `Due ${dueLabel}`}
                        </div>
                      </div>
                      <div className="d-flex flex-column align-items-end gap-1">
                        {isOverdue && <Badge bg="danger">Overdue</Badge>}
                        <Badge bg={badgeVariant}>{badgeLabel}</Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Create Event Modal (Simplified) */}
      <Modal show={showCreateEvent} onHide={() => setShowCreateEvent(false)}>
        <Modal.Header closeButton><Modal.Title>New Event</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control type="text" value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Start</Form.Label>
              <Form.Control type="datetime-local" value={newEvent.start} onChange={e => setNewEvent({ ...newEvent, start: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={newEvent.theme} onChange={e => setNewEvent({ ...newEvent, theme: e.target.value as any })}>
                <option>Health</option><option>Growth</option><option>Wealth</option><option>Tribe</option><option>Home</option>
              </Form.Select>
            </Form.Group>

            <Form.Check
              type="checkbox"
              label="Repeat Weekly"
              checked={newEvent.repeatWeekly}
              onChange={e => setNewEvent({ ...newEvent, repeatWeekly: e.target.checked })}
              className="mb-2"
            />

            {newEvent.repeatWeekly && (
              <div className="mb-3 ms-3 border-start ps-3">
                <Form.Label>Repeat On</Form.Label>
                <div className="d-flex gap-2 flex-wrap mb-2">
                  {['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].map(day => (
                    <Form.Check
                      key={day}
                      type="checkbox"
                      label={day}
                      checked={newEvent.repeatDays[day as keyof typeof newEvent.repeatDays]}
                      onChange={e => setNewEvent({
                        ...newEvent,
                        repeatDays: { ...newEvent.repeatDays, [day]: e.target.checked }
                      })}
                    />
                  ))}
                </div>
                <Form.Group>
                  <Form.Label>Until (Optional)</Form.Label>
                  <Form.Control
                    type="date"
                    value={newEvent.repeatUntil}
                    onChange={e => setNewEvent({ ...newEvent, repeatUntil: e.target.value })}
                  />
                </Form.Group>
              </div>
            )}

          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowCreateEvent(false)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!currentUser) return;
            const start = new Date(newEvent.start);
            const end = new Date(start.getTime() + 60 * 60000);

            let recurrenceRule = null;
            if (newEvent.repeatWeekly) {
              const days = Object.entries(newEvent.repeatDays)
                .filter(([_, checked]) => checked)
                .map(([day]) => day);

              if (days.length > 0) {
                let rule = `FREQ=WEEKLY;BYDAY=${days.join(',')}`;
                if (newEvent.repeatUntil) {
                  // Format until date as YYYYMMDD
                  const untilDate = new Date(newEvent.repeatUntil);
                  untilDate.setHours(23, 59, 59);
                  const untilStr = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
                  rule += `;UNTIL=${untilStr}`;
                }
                recurrenceRule = rule;
              }
            }

            await addDoc(collection(db, 'calendar_blocks'), {
              ownerUid: currentUser.uid,
              title: newEvent.title,
              start: start.getTime(),
              end: end.getTime(),
              theme: newEvent.theme,
              status: 'applied',
              recurrence: recurrenceRule ? { rrule: recurrenceRule } : null,
              updatedAt: Date.now()
            });
            setShowCreateEvent(false);
          }}>Create</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Calendar;

export { };
