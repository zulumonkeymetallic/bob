import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from 'react-bootstrap';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useFocusGoals } from '../../hooks/useFocusGoals';
import type { Goal, Story, Task } from '../../types';
import { getActiveFocusLeafGoalIds } from '../../utils/goalHierarchy';
import { buildPlannerItems, type PlannerCalendarBlockRow, type PlannerScheduledInstanceRow } from '../../utils/plannerItems';

const DailyPlanSummaryCard: React.FC = () => {
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
  const [reviewDone, setReviewDone] = useState(false);
  const [loading, setLoading] = useState(true);

  const todayStartMs = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }, []);
  const todayEndMs = useMemo(() => todayStartMs + (24 * 60 * 60 * 1000) - 1, [todayStartMs]);
  const todayIso = useMemo(() => new Date(todayStartMs).toISOString().slice(0, 10), [todayStartMs]);
  const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(activeFocusGoals), [activeFocusGoals]);
  const reviewStateId = useMemo(
    () => (currentUser?.uid ? `${currentUser.uid}_${currentPersona || 'personal'}_${todayIso}` : null),
    [currentUser?.uid, currentPersona, todayIso],
  );

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      return;
    }
    const taskQuery = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(200));
    const storyQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(200));
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

    const unsubTasks = onSnapshot(taskQuery, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
      rows = rows.filter((task: any) => currentPersona === 'work' ? task.persona === 'work' : task.persona == null || task.persona === 'personal');
      setTasks(rows);
      setLoading(false);
    }, (error) => {
      console.warn('DailyPlanSummaryCard: tasks listener denied/failed', error?.message || error);
      setTasks([]);
      setLoading(false);
    });
    const unsubStories = onSnapshot(storyQuery, (snap) => {
      let rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[];
      rows = rows.filter((story: any) => currentPersona === 'work' ? story.persona === 'work' : story.persona == null || story.persona === 'personal');
      setStories(rows);
    }, (error) => {
      console.warn('DailyPlanSummaryCard: stories listener denied/failed', error?.message || error);
      setStories([]);
    });
    const unsubGoals = onSnapshot(goalQuery, (snap) => {
      setGoals(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Goal[]);
    }, (error) => {
      console.warn('DailyPlanSummaryCard: goals listener denied/failed', error?.message || error);
      setGoals([]);
    });
    const unsubBlocks = onSnapshot(blockQuery, (snap) => {
      setCalendarBlocks(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as PlannerCalendarBlockRow[]);
    }, (error) => {
      console.warn('DailyPlanSummaryCard: calendar_blocks listener denied/failed', error?.message || error);
      setCalendarBlocks([]);
    });
    const unsubInstances = onSnapshot(instanceQuery, (snap) => {
      setScheduledInstances(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as PlannerScheduledInstanceRow[]);
    }, (error) => {
      console.warn('DailyPlanSummaryCard: scheduled_instances listener denied/failed', error?.message || error);
      setScheduledInstances([]);
    });
    const unsubReview = reviewStateId
      ? onSnapshot(doc(db, 'daily_plan_state', reviewStateId), (snap) => {
          const data = snap.data() as any;
          setReviewDone(!!(data?.reviewCompletedAt || data?.reviewCompletedAtMs));
        }, (error) => {
          console.warn('DailyPlanSummaryCard: review state listener denied/failed', error?.message || error);
          setReviewDone(false);
        })
      : () => undefined;

    return () => {
      unsubTasks();
      unsubStories();
      unsubGoals();
      unsubBlocks();
      unsubInstances();
      unsubReview();
    };
  }, [currentUser?.uid, currentPersona, todayEndMs, todayIso, todayStartMs, reviewStateId]);

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
        includeUnscheduledTasks: true,
      }).filter((item) => item.kind !== 'event'),
    [tasks, stories, goals, calendarBlocks, scheduledInstances, activeFocusGoalIds, todayStartMs, todayEndMs, selectedSprintId],
  );

  const summary = useMemo(() => {
    const openItems = plannerItems.length;
    const reviewItems = plannerItems.filter(
      (item) =>
        (item.kind === 'task' || item.kind === 'story')
        && !item.isTop3
        && !item.isFocusAligned
        && !(item.deferredUntilMs && item.deferredUntilMs > Date.now()),
    ).length;
    const overdue = plannerItems.filter((item) => item.dueAt != null && item.dueAt < Date.now()).length;
    const focusItems = plannerItems.filter((item) => item.isFocusAligned).length;
    return { openItems, reviewItems, overdue, focusItems };
  }, [plannerItems]);

  const urgency = reviewDone
    ? 'Morning review completed'
    : summary.reviewItems > 0
    ? 'Review queue waiting'
    : summary.overdue > 0
      ? 'Overdue items need attention'
      : summary.focusItems === 0
        ? 'Top 3 not scheduled'
        : 'Daily plan is ready';

  return (
    <Card className="shadow-sm border-0 h-100">
        <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold">Daily Plan</div>
        <Badge
          bg={!reviewDone && summary.reviewItems > 0 ? 'warning' : summary.openItems > 0 ? 'info' : 'secondary'}
          text={!reviewDone && summary.reviewItems > 0 ? 'dark' : undefined}
          pill
        >
          {!reviewDone && summary.reviewItems > 0 ? summary.reviewItems : summary.openItems}
        </Badge>
      </Card.Header>
      <Card.Body>
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner size="sm" animation="border" /> Loading today…
          </div>
        ) : (
          <>
            <Alert variant={!reviewDone && (summary.reviewItems > 0 || summary.overdue > 0) ? 'warning' : 'light'} className="py-2 px-3">
              <div className="fw-semibold">{urgency}</div>
              <div className="small text-muted mt-1">
                {!reviewDone && summary.reviewItems > 0
                  ? `${summary.reviewItems} review ${summary.reviewItems === 1 ? 'item' : 'items'} waiting · ${summary.openItems} open · ${summary.overdue} overdue · ${summary.focusItems} focus aligned`
                  : `${summary.openItems} open · ${summary.reviewItems} review · ${summary.overdue} overdue · ${summary.focusItems} focus aligned`}
              </div>
            </Alert>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <Badge bg="secondary">Open {summary.openItems}</Badge>
              <Badge bg={reviewDone ? 'secondary' : 'warning'} text={reviewDone ? undefined : 'dark'}>
                {reviewDone ? 'Reviewed' : 'Review'} {summary.reviewItems}
              </Badge>
              <Badge bg="danger">Overdue {summary.overdue}</Badge>
              <Badge bg="success">Focus {summary.focusItems}</Badge>
            </div>
            <Button size="sm" variant="primary" onClick={() => navigate('/daily-plan')}>
              Open Daily Plan
            </Button>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default DailyPlanSummaryCard;
