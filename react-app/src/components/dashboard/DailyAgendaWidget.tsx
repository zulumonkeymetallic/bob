import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, Spinner } from 'react-bootstrap';
import { collection, doc, onSnapshot, orderBy, query, limit, updateDoc, serverTimestamp, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Circle, Clock, ExternalLink } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useFocusGoals } from '../../hooks/useFocusGoals';
import type { Goal, Story, Task } from '../../types';
import { getActiveFocusLeafGoalIds } from '../../utils/goalHierarchy';
import {
  buildPlannerItems,
  type PlannerCalendarBlockRow,
  type PlannerItem,
  type PlannerScheduledInstanceRow,
} from '../../utils/plannerItems';
import { bucketLabel, bucketOrder, type TimelineBucket } from '../../utils/timelineBuckets';

const THEME_COLOURS: Record<string, string> = {
  health: '#198754',
  wealth: '#0d6efd',
  learning: '#6f42c1',
  work: '#fd7e14',
  hobbies: '#20c997',
  personal: '#6c757d',
  home: '#795548',
  family: '#e91e63',
  social: '#00bcd4',
  travel: '#ff9800',
};

function themeToColour(theme: string | null): string {
  if (!theme) return '#6c757d';
  return THEME_COLOURS[theme.toLowerCase()] ?? '#6c757d';
}

const AgendaItem: React.FC<{
  item: PlannerItem;
  onComplete: (item: PlannerItem) => void;
  completingId: string | null;
}> = ({ item, onComplete, completingId }) => {
  const navigate = useNavigate();
  const isEvent = item.kind === 'event';
  const isStory = item.kind === 'story';
  const isCompleting = completingId === item.id;
  const borderColour = themeToColour(item.goalTheme);
  const isOverdue = item.dueAt != null && item.dueAt < Date.now() && !isEvent;

  const handleClick = () => {
    if (isStory) {
      navigate(`/stories/${item.id}`);
    } else if (item.kind === 'task' || item.kind === 'chore') {
      navigate(`/tasks/${item.id}`);
    }
  };

  return (
    <div
      className="d-flex align-items-center gap-2 py-1"
      style={{
        borderLeft: `3px solid ${borderColour}`,
        paddingLeft: 8,
        opacity: isCompleting ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      {isEvent ? (
        <Clock size={13} className="text-muted flex-shrink-0" />
      ) : isStory ? (
        <ExternalLink size={13} className="text-muted flex-shrink-0" style={{ cursor: 'pointer' }} onClick={handleClick} />
      ) : isCompleting ? (
        <Spinner size="sm" animation="border" style={{ width: 13, height: 13 }} />
      ) : (
        <button
          className="border-0 bg-transparent p-0 d-flex align-items-center"
          style={{ cursor: 'pointer', color: '#6c757d' }}
          onClick={() => onComplete(item)}
          title="Mark complete"
        >
          <Circle size={13} />
        </button>
      )}
      <span
        className={`small flex-grow-1 text-truncate ${isOverdue ? 'text-danger' : ''}`}
        style={{ cursor: isEvent ? 'default' : 'pointer' }}
        onClick={isEvent ? undefined : handleClick}
        title={item.title}
      >
        {item.timeLabel && (
          <span className="text-muted me-1" style={{ fontSize: '0.7rem' }}>{item.timeLabel}</span>
        )}
        {item.title}
      </span>
      {item.isTop3 && <Badge bg="warning" text="dark" pill style={{ fontSize: '0.6rem' }}>Top3</Badge>}
      {isOverdue && <Badge bg="danger" pill style={{ fontSize: '0.6rem' }}>Late</Badge>}
    </div>
  );
};

interface BucketSection {
  key: TimelineBucket;
  label: string;
  items: PlannerItem[];
}

const DailyAgendaWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<PlannerCalendarBlockRow[]>([]);
  const [scheduledInstances, setScheduledInstances] = useState<PlannerScheduledInstanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<TimelineBucket>>(new Set());

  const todayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const todayEndMs = useMemo(() => todayStartMs + 86_400_000 - 1, [todayStartMs]);
  const todayIso = useMemo(() => new Date(todayStartMs).toISOString().slice(0, 10), [todayStartMs]);

  const activeFocusGoalIds = useMemo(
    () => getActiveFocusLeafGoalIds(activeFocusGoals),
    [activeFocusGoals],
  );

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      return;
    }

    const taskQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('updatedAt', 'desc'),
      limit(200),
    );
    const storyQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('updatedAt', 'desc'),
      limit(200),
    );
    const goalQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
    const blockQuery = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', todayStartMs),
      where('start', '<=', todayEndMs),
    );
    const instanceQuery = query(
      collection(db, 'scheduled_instances'),
      where('ownerUid', '==', currentUser.uid),
      where('occurrenceDate', '==', todayIso),
    );

    const filterPersona = (items: any[]) =>
      items.filter((item) =>
        currentPersona === 'work'
          ? item.persona === 'work'
          : item.persona == null || item.persona === 'personal',
      );

    const unsubTasks = onSnapshot(taskQuery, (snap) => {
      const rows = filterPersona(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))) as Task[];
      setTasks(rows);
      setLoading(false);
    }, () => { setTasks([]); setLoading(false); });

    const unsubStories = onSnapshot(storyQuery, (snap) => {
      const rows = filterPersona(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))) as Story[];
      setStories(rows);
    }, () => setStories([]));

    const unsubGoals = onSnapshot(goalQuery, (snap) => {
      setGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Goal[]);
    }, () => setGoals([]));

    const unsubBlocks = onSnapshot(blockQuery, (snap) => {
      setCalendarBlocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PlannerCalendarBlockRow[]);
    }, () => setCalendarBlocks([]));

    const unsubInstances = onSnapshot(instanceQuery, (snap) => {
      setScheduledInstances(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PlannerScheduledInstanceRow[]);
    }, () => setScheduledInstances([]));

    return () => {
      unsubTasks();
      unsubStories();
      unsubGoals();
      unsubBlocks();
      unsubInstances();
    };
  }, [currentUser?.uid, currentPersona, todayStartMs, todayEndMs, todayIso]);

  const plannerItems = useMemo(
    () =>
      buildPlannerItems({
        tasks,
        stories,
        goals,
        calendarBlocks,
        scheduledInstances,
        activeFocusGoalIds,
        rangeStartMs: todayStartMs,
        rangeEndMs: todayEndMs,
        selectedSprintId,
        includeUnscheduledTasks: false,
      }),
    [tasks, stories, goals, calendarBlocks, scheduledInstances, activeFocusGoalIds, todayStartMs, todayEndMs, selectedSprintId],
  );

  const bucketSections = useMemo((): BucketSection[] =>
    bucketOrder.map((key) => ({
      key,
      label: bucketLabel(key),
      items: plannerItems.filter((item) => item.bucket === key),
    })).filter((s) => s.items.length > 0),
    [plannerItems],
  );

  const totalCount = plannerItems.length;
  const overdueCount = plannerItems.filter((i) => i.dueAt != null && i.dueAt < Date.now() && i.kind !== 'event').length;

  const handleComplete = useCallback(async (item: PlannerItem) => {
    if (!item.rawTask) return;
    setCompletingId(item.id);
    try {
      await updateDoc(doc(db, 'tasks', item.rawTask.id), {
        status: 2,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('DailyAgendaWidget: failed to complete task', err);
    } finally {
      setCompletingId(null);
    }
  }, []);

  const toggleBucket = useCallback((key: TimelineBucket) => {
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <CalendarDays size={15} />
          Today's Agenda
        </div>
        <div className="d-flex align-items-center gap-2">
          {overdueCount > 0 && (
            <Badge bg="danger" pill>{overdueCount} late</Badge>
          )}
          <Badge bg="secondary" pill>{totalCount}</Badge>
        </div>
      </Card.Header>
      <Card.Body className="p-2" style={{ overflowY: 'auto' }}>
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small p-2">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : bucketSections.length === 0 ? (
          <div className="text-muted small p-2">
            Nothing scheduled today.{' '}
            <span
              className="text-primary"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/daily-plan')}
            >
              Open planner
            </span>
          </div>
        ) : (
          <div className="d-flex flex-column gap-1">
            {bucketSections.map((section) => {
              const collapsed = collapsedBuckets.has(section.key);
              return (
                <div key={section.key}>
                  <button
                    className="border-0 bg-transparent p-0 d-flex align-items-center gap-1 w-100 mb-1"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleBucket(section.key)}
                  >
                    <span className="text-uppercase text-muted fw-semibold" style={{ fontSize: '0.68rem', letterSpacing: '0.05em' }}>
                      {section.label}
                    </span>
                    <Badge bg="light" text="dark" pill style={{ fontSize: '0.65rem' }}>
                      {section.items.length}
                    </Badge>
                    <span className="text-muted ms-auto" style={{ fontSize: '0.68rem' }}>
                      {collapsed ? '▶' : '▼'}
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="d-flex flex-column gap-1 mb-2">
                      {section.items.map((item) => (
                        <AgendaItem
                          key={item.id}
                          item={item}
                          onComplete={handleComplete}
                          completingId={completingId}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="text-center mt-1">
              <span
                className="small text-muted"
                style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                onClick={() => navigate('/daily-plan')}
              >
                Full planner
              </span>
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default DailyAgendaWidget;
