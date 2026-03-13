import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Container, ListGroup } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { CalendarPlus, Clock3 } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Story, Task } from '../types';
import { isRecurringDueOnDate, resolveRecurringDueMs, resolveTaskDueMs } from '../utils/recurringTaskDue';
import DeferItemModal from './DeferItemModal';

type TimelineBucket = 'morning' | 'afternoon' | 'evening';

type TimelineItem = {
  id: string;
  kind: 'task' | 'story' | 'chore' | 'event';
  title: string;
  timeLabel: string;
  sortMs: number | null;
  bucket: TimelineBucket;
  link: string | null;
  sourceId?: string;
  isTop3?: boolean;
  deferredUntilMs?: number | null;
};

const bucketOrder: TimelineBucket[] = ['morning', 'afternoon', 'evening'];

const toMs = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().getTime();
    } catch {
      return null;
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const isDoneStatus = (value: any): boolean => {
  if (typeof value === 'number') return value >= 2;
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'done' || raw === 'complete' || raw === 'completed' || raw === 'archived';
};

const getChoreKind = (task: Task): 'chore' | 'routine' | 'habit' | null => {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
  return null;
};

const bucketFromTime = (ms: number | null | undefined, timeOfDay?: string | null): TimelineBucket => {
  const tod = String(timeOfDay || '').toLowerCase().trim();
  if (tod === 'morning' || tod === 'afternoon' || tod === 'evening') return tod as TimelineBucket;
  if (!ms || !Number.isFinite(ms)) return 'morning';
  const date = new Date(ms);
  const minute = date.getHours() * 60 + date.getMinutes();
  if (minute >= 300 && minute <= 779) return 'morning';
  if (minute >= 780 && minute <= 1139) return 'afternoon';
  return 'evening';
};

const formatTimeLabel = (startMs: number | null | undefined, endMs?: number | null): string => {
  if (!startMs || !Number.isFinite(startMs)) return 'Anytime';
  const start = new Date(startMs);
  const startLabel = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (endMs && Number.isFinite(endMs)) {
    const end = new Date(endMs);
    const endLabel = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${startLabel} - ${endLabel}`;
  }
  return startLabel;
};

const DailyPlanPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId } = useSprint();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [deferTarget, setDeferTarget] = useState<{ type: 'task' | 'story'; id: string; title: string } | null>(null);
  const [morningReviewDone, setMorningReviewDone] = useState(false);

  const todayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const todayEndMs = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setTasks([]);
      return;
    }
    const q = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
      const persona = currentPersona || 'personal';
      rows = rows.filter((task: any) => {
        if (persona === 'work') return task.persona === 'work';
        return task.persona == null || task.persona === 'personal';
      });
      setTasks(rows);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setStories([]);
      return;
    }
    const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[];
      const persona = currentPersona || 'personal';
      rows = rows.filter((story: any) => {
        if (persona === 'work') return story.persona === 'work';
        return story.persona == null || story.persona === 'personal';
      });
      setStories(rows);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setSummary(null);
      return;
    }
    const q = query(
      collection(db, 'daily_summaries'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('generatedAt', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      const row = snap.docs[0]?.data() as any;
      setSummary(row?.summary || null);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  const today = useMemo(() => new Date(), []);

  const overviewCalendarEvents = useMemo(() => {
    const candidates = [
      summary?.calendar?.events,
      summary?.eventsToday,
      summary?.upcomingEvents,
      summary?.calendarEvents,
      summary?.dailyBrief?.calendar,
    ];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || candidate.length === 0) continue;
      const mapped = candidate
        .map((item: any, index: number) => {
          const title = String(item?.title || item?.summary || item?.name || '').trim();
          if (!title) return null;
          const startMs = toMs(item?.start ?? item?.startAt ?? item?.startDate ?? item?.when);
          const endMs = toMs(item?.end ?? item?.endAt ?? item?.endDate);
          return {
            id: String(item?.id || item?.eventId || `${title}-${index}`),
            title,
            startMs,
            endMs,
          };
        })
        .filter(Boolean) as Array<{ id: string; title: string; startMs: number | null; endMs: number | null }>;
      if (mapped.length > 0) return mapped;
    }
    return [] as Array<{ id: string; title: string; startMs: number | null; endMs: number | null }>;
  }, [summary]);

  const timelineItems = useMemo(() => {
    const rows: TimelineItem[] = [];
    const seen = new Set<string>();
    const push = (row: TimelineItem) => {
      const key = `${row.kind}:${row.title.toLowerCase()}:${row.timeLabel}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };

    const openNonChoreTasks = tasks
      .filter((task) => !isDoneStatus((task as any).status))
      .filter((task) => !getChoreKind(task));

    openNonChoreTasks.forEach((task) => {
      const dueMs = resolveTaskDueMs(task);
      const include = !dueMs || dueMs <= todayEndMs;
      if (!include) return;
      push({
        id: `task-${task.id}`,
        kind: 'task',
        title: task.title || 'Task',
        timeLabel: formatTimeLabel(dueMs),
        sortMs: dueMs,
        bucket: bucketFromTime(dueMs, (task as any).timeOfDay),
        link: `/tasks/${task.id}`,
        sourceId: task.id,
        isTop3: !!((task as any).aiTop3ForDay && String((task as any).aiTop3Date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)),
        deferredUntilMs: toMs((task as any).deferredUntil),
      });
    });

    tasks
      .filter((task) => !isDoneStatus((task as any).status))
      .filter((task) => !!getChoreKind(task))
      .filter((task) => isRecurringDueOnDate(task, today, todayStartMs) || !!resolveTaskDueMs(task))
      .forEach((task) => {
        const dueMs = resolveRecurringDueMs(task, today, todayStartMs) ?? resolveTaskDueMs(task);
        push({
          id: `chore-${task.id}`,
          kind: 'chore',
          title: task.title || 'Chore',
          timeLabel: formatTimeLabel(dueMs),
          sortMs: dueMs,
          bucket: bucketFromTime(dueMs, (task as any).timeOfDay),
          link: `/tasks/${task.id}`,
          sourceId: task.id,
          deferredUntilMs: toMs((task as any).deferredUntil),
        });
      });

    stories
      .filter((story) => !isDoneStatus((story as any).status))
      .filter((story) => (selectedSprintId ? String((story as any).sprintId || '') === String(selectedSprintId) : true))
      .forEach((story) => {
        const dueMs = toMs((story as any).targetDate || (story as any).dueDate || (story as any).plannedStartDate);
        if (dueMs && dueMs > todayEndMs) return;
        push({
          id: `story-${story.id}`,
          kind: 'story',
          title: story.title || 'Story',
          timeLabel: formatTimeLabel(dueMs),
          sortMs: dueMs,
          bucket: bucketFromTime(dueMs, (story as any).timeOfDay),
          link: `/stories/${story.id}`,
          sourceId: story.id,
          isTop3: !!((story as any).aiTop3ForDay && String((story as any).aiTop3Date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)),
          deferredUntilMs: toMs((story as any).deferredUntil),
        });
      });

    overviewCalendarEvents.forEach((event) => {
      if (event.startMs && (event.startMs < todayStartMs || event.startMs > todayEndMs)) return;
      push({
        id: `event-${event.id}`,
        kind: 'event',
        title: event.title,
        timeLabel: formatTimeLabel(event.startMs, event.endMs),
        sortMs: event.startMs,
        bucket: bucketFromTime(event.startMs),
        link: null,
      });
    });

    return rows.sort((a, b) => {
      const aMs = a.sortMs ?? Number.MAX_SAFE_INTEGER;
      const bMs = b.sortMs ?? Number.MAX_SAFE_INTEGER;
      if (aMs !== bMs) return aMs - bMs;
      return a.title.localeCompare(b.title);
    });
  }, [tasks, stories, selectedSprintId, overviewCalendarEvents, today, todayStartMs, todayEndMs]);

  const empty = timelineItems.length === 0;

  const todoSummary = useMemo(() => {
    const tasksCount = timelineItems.filter((item) => item.kind === 'task').length;
    const storiesCount = timelineItems.filter((item) => item.kind === 'story').length;
    const choresCount = timelineItems.filter((item) => item.kind === 'chore').length;
    const eventsCount = timelineItems.filter((item) => item.kind === 'event').length;
    const top3Count = timelineItems.filter((item) => (item.kind === 'task' || item.kind === 'story') && item.isTop3).length;
    const deferCandidates = timelineItems.filter((item) => (item.kind === 'task' || item.kind === 'story') && !item.isTop3 && !(item.deferredUntilMs && item.deferredUntilMs > Date.now()));
    return {
      tasksCount,
      storiesCount,
      choresCount,
      eventsCount,
      top3Count,
      deferCandidates,
    };
  }, [timelineItems]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setMorningReviewDone(false);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const key = `dailyPlanMorningReview:${currentUser.uid}:${today}`;
    setMorningReviewDone(window.localStorage.getItem(key) === '1');
  }, [currentUser?.uid]);

  const markMorningReviewDone = () => {
    if (!currentUser?.uid) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `dailyPlanMorningReview:${currentUser.uid}:${today}`;
    window.localStorage.setItem(key, '1');
    setMorningReviewDone(true);
  };

  const applyDefer = async (payload: { dateMs: number; rationale: string; source: string }) => {
    if (!deferTarget) return;
    const collectionName = deferTarget.type === 'story' ? 'stories' : 'tasks';
    await updateDoc(doc(db, collectionName, deferTarget.id), {
      deferredUntil: payload.dateMs,
      deferredReason: payload.rationale,
      deferredBy: payload.source,
      deferredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  return (
    <Container fluid="sm" className="py-3">
      <Card className="border-0 shadow-sm">
        <Card.Header className="d-flex align-items-center justify-content-between">
          <div className="fw-semibold">Daily Plan</div>
          <Badge bg={empty ? 'secondary' : 'info'} pill>{timelineItems.length}</Badge>
        </Card.Header>
        <Card.Body>
          <div className="text-muted small mb-2">
            A clean daily list of tasks, stories, calendar events, and chores/habits.
          </div>
          {!morningReviewDone && !empty && (
            <Alert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
              <div>
                <div className="fw-semibold">Morning check-in</div>
                <div className="small">
                  Today: {todoSummary.tasksCount} tasks, {todoSummary.storiesCount} stories, {todoSummary.choresCount} chores, {todoSummary.eventsCount} events.
                  {' '}Top 3 protected: {todoSummary.top3Count}. Review non-Top3 items and defer what should move.
                </div>
              </div>
              <div className="d-flex gap-2">
                <Button size="sm" variant="outline-secondary" onClick={() => navigate('/sprints/kanban')}>
                  Open board
                </Button>
                <Button size="sm" variant="primary" onClick={markMorningReviewDone}>
                  Mark reviewed
                </Button>
              </div>
            </Alert>
          )}
          {empty ? (
            <Alert variant="light" className="mb-0">No items scheduled for today.</Alert>
          ) : (
            bucketOrder.map((bucket) => {
              const items = timelineItems.filter((item) => item.bucket === bucket);
              if (items.length === 0) return null;
              const label = bucket === 'morning' ? 'Morning' : bucket === 'afternoon' ? 'Afternoon' : 'Evening';
              return (
                <div key={bucket} className="mb-3">
                  <div className="text-uppercase text-muted small fw-semibold mb-1">{label}</div>
                  <ListGroup variant="flush">
                    {items.map((item) => {
                      const variant = item.kind === 'story'
                        ? 'info'
                        : item.kind === 'chore'
                          ? 'success'
                          : item.kind === 'event'
                            ? 'secondary'
                            : 'primary';
                      const kindLabel = item.kind === 'story'
                        ? 'Story'
                        : item.kind === 'chore'
                          ? 'Chore'
                          : item.kind === 'event'
                            ? 'Event'
                            : 'Task';
                      return (
                        <ListGroup.Item key={item.id} className="d-flex align-items-center gap-2">
                          <div className="flex-grow-1 min-w-0">
                            <div className="fw-semibold text-truncate">
                              {item.link ? <Link to={item.link}>{item.title}</Link> : item.title}
                            </div>
                            <div className="text-muted small">{item.timeLabel}</div>
                          </div>
                          {(item.kind === 'task' || item.kind === 'story') && item.isTop3 && (
                            <Badge bg="danger" title="Top priority">
                              <span style={{ fontWeight: 800 }}>1</span>
                            </Badge>
                          )}
                          <Badge bg={variant}>{kindLabel}</Badge>
                          {(item.kind === 'task' || item.kind === 'story') && (
                            <div className="d-flex align-items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                title="Schedule now"
                                onClick={() => navigate('/calendar')}
                              >
                                <CalendarPlus size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-warning"
                                title="Defer intelligently"
                                disabled={!item.sourceId || !!item.isTop3}
                                onClick={() => {
                                  if (!item.sourceId) return;
                                  setDeferTarget({
                                    type: item.kind === 'story' ? 'story' : 'task',
                                    id: item.sourceId,
                                    title: item.title,
                                  });
                                }}
                              >
                                <Clock3 size={14} />
                              </Button>
                            </div>
                          )}
                        </ListGroup.Item>
                      );
                    })}
                  </ListGroup>
                </div>
              );
            })
          )}
        </Card.Body>
      </Card>
      {deferTarget && (
        <DeferItemModal
          show={!!deferTarget}
          onHide={() => setDeferTarget(null)}
          itemType={deferTarget.type}
          itemId={deferTarget.id}
          itemTitle={deferTarget.title}
          onApply={applyDefer}
        />
      )}
    </Container>
  );
};

export default DailyPlanPage;
