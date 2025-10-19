import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Badge, Button, Alert, Table, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Task, Sprint, Goal } from '../types';
import { isStatus } from '../utils/statusHelpers';
import SprintSelector from './SprintSelector';
import { useSprint } from '../contexts/SprintContext';
import ChecklistPanel from './ChecklistPanel';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import CompactSprintMetrics from './CompactSprintMetrics';
import ThemeBreakdown from './ThemeBreakdown';
import { format, startOfDay, endOfDay } from 'date-fns';
import { useUnifiedPlannerData, type PlannerRange } from '../hooks/useUnifiedPlannerData';
import type { ScheduledInstanceModel } from '../domain/scheduler/repository';
import { nextDueAt } from '../utils/recurrence';

interface DashboardStats {
  activeGoals: number;
  goalsDueSoon: number;
  activeStories: number;
  storyCompletion: number;
  pendingTasks: number;
  completedToday: number;
  upcomingDeadlines: number;
  tasksUnlinked: number;
  sprintTasksTotal: number;
  sprintTasksDone: number;
}

interface ReminderItem {
  id: string;
  title: string;
  dueDate: Date | null;
  taskId?: string | null;
}

interface MonzoSummary {
  totals?: {
    spent?: number;
    budget?: number;
    remaining?: number;
  } | null;
  categories?: Array<{ category?: string; name?: string; spent?: number }>;
  goalAlignment?: any;
  updatedAt?: any;
}

interface ChecklistSnapshotItem {
  id: string;
  title: string;
  dueAt: Date | null;
  type: 'chore' | 'routine';
}

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  
  // Debug logging for authentication
  console.log('🔍 Dashboard: currentUser:', currentUser);
  console.log('🔍 Dashboard: currentUser type:', typeof currentUser);
  console.log('🔍 Dashboard: currentUser uid:', currentUser?.uid);
  console.log('🔍 Dashboard: currentUser email:', currentUser?.email);
  
  const [stats, setStats] = useState<DashboardStats>({
    activeGoals: 0,
    goalsDueSoon: 0,
    activeStories: 0,
    storyCompletion: 0,
    pendingTasks: 0,
    completedToday: 0,
    upcomingDeadlines: 0,
    tasksUnlinked: 0,
    sprintTasksTotal: 0,
    sprintTasksDone: 0,
  });
  const [recentStories, setRecentStories] = useState<Story[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  // Use global sprint selection for consistency across app
  const { selectedSprintId, setSelectedSprintId } = useSprint();
  const [priorityBanner, setPriorityBanner] = useState<{ title: string; score: number; bucket?: string } | null>(null);
  const [todayBlocks, setTodayBlocks] = useState<any[]>([]);
  const [tasksDueToday, setTasksDueToday] = useState<number>(0);
  const [unscheduledToday, setUnscheduledToday] = useState<ScheduledInstanceModel[]>([]);
  const [remindersDueToday, setRemindersDueToday] = useState<ReminderItem[]>([]);
  const [choresDueToday, setChoresDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [routinesDueToday, setRoutinesDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [monzoSummary, setMonzoSummary] = useState<MonzoSummary | null>(null);

  const decodeToDate = (value: any): Date | null => {
    if (value == null) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && typeof value.toDate === 'function') {
      try { return value.toDate(); } catch { return null; }
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return new Date(numeric);
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
    return null;
  };
  const dailyBrief = () => {
    const parts: string[] = [];
    if (tasksDueToday > 0) parts.push(`${tasksDueToday} due today`);
    if (todayBlocks.length > 0) parts.push(`${todayBlocks.length} blocks scheduled`);
    if (priorityBanner?.title) parts.push(`Focus: ${priorityBanner.title}`);
    return parts.length ? parts.join(' · ') : 'No urgent items. Plan or review your goals.';
  };

  useEffect(() => {
    console.log('🔍 Dashboard useEffect triggered:', { currentUser: !!currentUser, persona: currentPersona });
    if (!currentUser) {
      console.log('🔍 Dashboard: No currentUser, returning early');
      return;
    }
    
    console.log('🔍 Dashboard: Loading dashboard data for user:', currentUser.uid);
    loadDashboardData();
  }, [currentUser, currentPersona]);

  const loadDashboardData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('updatedAt', 'desc'),
      limit(8)
    );

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    // Load tasks (simplified query while indexes are building)
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('priority', 'desc'),
      limit(40)
    );

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        };
      }) as Story[];
      setRecentStories(storiesData.slice(0, 5));

      const activeStories = storiesData.filter(story => !isStatus(story.status, 'done')).length;
      const doneStories = storiesData.filter(story => isStatus(story.status, 'done')).length;

      setStats(prev => ({
        ...prev,
        activeStories,
        storyCompletion: storiesData.length > 0 ? Math.round((doneStories / storiesData.length) * 100) : 0,
      }));
    });

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalData = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          targetDate: data.targetDate?.toDate ? data.targetDate.toDate() : data.targetDate,
          dueDate: data.dueDate?.toDate ? data.dueDate.toDate() : data.dueDate,
        } as Goal;
      });

      const activeGoals = goalData.filter(goal => !isStatus(goal.status, 'Complete')).length;
      const now = new Date();
      const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const dueSoon = goalData.filter(goal => {
        const due = decodeToDate(goal.targetDate || goal.dueDate);
        return due ? due >= now && due <= soon : false;
      }).length;

      setStats(prev => ({
        ...prev,
        activeGoals,
        goalsDueSoon: dueSoon,
      }));
    });

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
          dueDate: data.dueDate?.toDate ? data.dueDate.toDate() : data.dueDate,
        };
      }) as Task[];

      const activeTaskList = allTasks.filter(task => !isStatus(task.status, 'done'));
      const nextTasks = activeTaskList.slice(0, 5);
      setUpcomingTasks(nextTasks);

      const openTasks = allTasks.filter(task => !isStatus(task.status, 'done')).length;
      const todayCompleted = allTasks.filter(task => {
        if (!isStatus(task.status, 'done') || !task.updatedAt) return false;
        const completedDate = decodeToDate(task.updatedAt);
        if (!completedDate) return false;
        const today = new Date();
        return completedDate.toDateString() === today.toDateString();
      }).length;

      const unlinkedCount = allTasks.filter(task => !task.storyId).length;
      const now = new Date();
      const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const upcomingDeadlines = allTasks.filter(task => {
        const due = decodeToDate(task.dueDate ?? (task as any).targetDate ?? (task as any).dueDateMs);
        return due ? due >= now && due <= soon : false;
      }).length;

      const sprintTasks = selectedSprintId
        ? allTasks.filter(task => task.sprintId === selectedSprintId)
        : allTasks.filter(task => task.sprintId);
      const sprintDone = sprintTasks.filter(task => isStatus(task.status, 'done')).length;

      setStats(prev => ({
        ...prev,
        pendingTasks: openTasks,
        completedToday: todayCompleted,
        tasksUnlinked: unlinkedCount,
        upcomingDeadlines,
        sprintTasksTotal: sprintTasks.length,
        sprintTasksDone: sprintDone,
      }));
    });

    setLastUpdated(new Date());
    setLoading(false);

    // After basic data, load LLM priority, today's schedule and due counts in parallel
    try {
      await Promise.all([
        loadLLMPriority(),
        loadTodayBlocks(),
        countTasksDueToday(),
        loadRemindersDueToday(),
        loadChecklistDueToday(),
        loadMonzoSummary()
      ]);
    } catch {}

    return () => {
      unsubscribeStories();
      unsubscribeGoals();
      unsubscribeTasks();
    };
  };

  useEffect(() => {
    if (!currentUser) {
      setUnscheduledToday([]);
      return;
    }
    const todayKey = format(new Date(), 'yyyyMMdd');
    const q = query(
      collection(db, 'scheduled_instances'),
      where('ownerUid', '==', currentUser.uid),
      where('occurrenceDate', '==', todayKey),
      where('status', '==', 'unscheduled'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as ScheduledInstanceModel[];
      setUnscheduledToday(rows);
    });
    return () => unsub();
  }, [currentUser]);

  const unscheduledSummary = unscheduledToday.slice(0, 3);

  const loadLLMPriority = async () => {
    if (!currentUser) return;
    try {
      // Use a small snapshot of tasks as candidates
      const tq = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('createdAt', 'desc'),
        limit(30)
      );
      const snap = await getDocs(tq);
      const tasks: any[] = [];
      snap.forEach(d => {
        const t = d.data();
        tasks.push({ id: d.id, title: t.title, dueDate: t.dueDate || null, priority: t.priority, effort: t.effort, status: t.status });
      });

      const call = httpsCallable(functions, 'prioritizeBacklog');
      const res: any = await call({ tasks });
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const todayItem = items.find((x: any) => (x.bucket || '').toUpperCase() === 'TODAY');
      const best = todayItem || items.sort((a: any, b: any) => (b.score||0) - (a.score||0))[0];
      if (best) {
        const ref = tasks.find(t => t.id === best.id);
        if (ref) setPriorityBanner({ title: ref.title, score: best.score || 0, bucket: best.bucket || null });
      }
    } catch (e) {
      // Fallback: top priority from current upcomingTasks state
      if (upcomingTasks && upcomingTasks.length > 0) {
        const top = upcomingTasks[0];
        setPriorityBanner({ title: top.title, score: 0 });
      }
    }
  };

  const loadTodayBlocks = async () => {
    if (!currentUser) return;
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', start.getTime()),
      where('start', '<=', end.getTime())
    );
    const snap = await getDocs(q);
    const blocks: any[] = [];
    snap.forEach(d => blocks.push({ id: d.id, ...(d.data() || {}) }));
    blocks.sort((a,b) => a.start - b.start);
    setTodayBlocks(blocks);
  };

  const countTasksDueToday = async () => {
    if (!currentUser) return;
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    // Tasks due today
    const tq = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('dueDate', '>=', start.getTime()),
      where('dueDate', '<=', end.getTime())
    );
    const ts = await getDocs(tq);
    let count = ts.size;
    // Chores due today via nextDueAt precompute
    const cq = query(collection(db, 'chores'), where('ownerUid', '==', currentUser.uid));
    const cs = await getDocs(cq);
    cs.forEach(d => {
      const c: any = d.data() || {};
      const due = c.nextDueAt;
      if (due && due >= start.getTime() && due <= end.getTime()) count += 1;
    });
    setTasksDueToday(count);
  };

  const loadRemindersDueToday = async () => {
    if (!currentUser) {
      setRemindersDueToday([]);
      return;
    }
    const start = startOfDay(new Date()).getTime();
    const end = endOfDay(new Date()).getTime();
    const remindersQuery = query(
      collection(db, 'reminders'),
      where('ownerUid', '==', currentUser.uid),
      where('dueDate', '>=', start),
      where('dueDate', '<=', end)
    );
    const snap = await getDocs(remindersQuery).catch(() => null);
    if (!snap) {
      setRemindersDueToday([]);
      return;
    }
    const items: ReminderItem[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if ((data.status || 'open') === 'done') return;
      const dueDate = decodeToDate(data.dueDate || data.dueAt);
      items.push({
        id: docSnap.id,
        title: data.title || data.note || 'Reminder',
        dueDate,
        taskId: data.taskId || null,
      });
    });
    items.sort((a, b) => {
      const aTime = a.dueDate ? a.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.dueDate ? b.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
    setRemindersDueToday(items);
  };

  const loadChecklistDueToday = async () => {
    if (!currentUser) {
      setChoresDueToday([]);
      setRoutinesDueToday([]);
      return;
    }

    const start = startOfDay(new Date()).getTime();
    const end = endOfDay(new Date()).getTime();

    const choreSnap = await getDocs(query(collection(db, 'chores'), where('ownerUid', '==', currentUser.uid))).catch(() => null);
    const routineSnap = await getDocs(query(collection(db, 'routines'), where('ownerUid', '==', currentUser.uid))).catch(() => null);

    const chores: ChecklistSnapshotItem[] = [];
    if (choreSnap) {
      choreSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const dtstart = data.dtstart || data.createdAt || undefined;
        const computed = nextDueAt(data.rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
        const due = data.nextDueAt || computed;
        if (due && due >= start && due <= end) {
          chores.push({
            id: docSnap.id,
            title: data.title || 'Chore',
            dueAt: new Date(due),
            type: 'chore',
          });
        }
      });
    }

    const routines: ChecklistSnapshotItem[] = [];
    if (routineSnap) {
      routineSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const rrule = data.recurrence?.rrule || data.rrule;
        if (!rrule) return;
        const dtstart = data.recurrence?.dtstart || data.dtstart || data.createdAt || undefined;
        const computed = nextDueAt(rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
        const due = data.nextDueAt || computed;
        if (due && due >= start && due <= end) {
          routines.push({
            id: docSnap.id,
            title: data.name || 'Routine',
            dueAt: new Date(due),
            type: 'routine',
          });
        }
      });
    }

    chores.sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER));
    routines.sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER));

    setChoresDueToday(chores);
    setRoutinesDueToday(routines);
  };

  const loadMonzoSummary = async () => {
    if (!currentUser) {
      setMonzoSummary(null);
      return;
    }
    try {
      const budgetSnap = await getDoc(doc(db, 'monzo_budget_summary', currentUser.uid));
      const alignmentSnap = await getDoc(doc(db, 'monzo_goal_alignment', currentUser.uid));
      if (!budgetSnap.exists && !alignmentSnap.exists) {
        setMonzoSummary(null);
        return;
      }
      const summary: MonzoSummary = {};
      if (budgetSnap.exists) {
        const data = budgetSnap.data() as any;
        summary.totals = data?.totals || null;
        summary.categories = Array.isArray(data?.categories) ? data.categories.slice(0, 4) : [];
        summary.updatedAt = data?.updatedAt || null;
      }
      if (alignmentSnap.exists) {
        summary.goalAlignment = alignmentSnap.data();
      }
      setMonzoSummary(summary);
    } catch (error) {
      console.warn('Failed to load Monzo summary', error);
      setMonzoSummary(null);
    }
  };

  const handleNavigateToTasksToday = () => {
    navigate('/tasks', { state: { preset: 'dueToday' } });
  };

  const handleOpenChecklist = () => {
    navigate('/calendar', { state: { focus: 'checklist' } });
  };

  const handleThemeSelect = (themeId: string) => {
    navigate('/stories', { state: { themeId } });
  };

  if (!currentUser) {
    return <div>Please sign in to view your dashboard.</div>;
  }

  const sprintProgress = stats.sprintTasksTotal > 0
    ? Math.min(100, Math.round((stats.sprintTasksDone / stats.sprintTasksTotal) * 100))
    : 0;
  const sprintRemaining = Math.max(stats.sprintTasksTotal - stats.sprintTasksDone, 0);
  const hasSelectedSprint = Boolean(selectedSprintId);

  const sortedUpcoming = [...upcomingTasks].sort((a, b) => {
    const aDue = decodeToDate(a.dueDate ?? (a as any).targetDate ?? (a as any).dueDateMs)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDue = decodeToDate(b.dueDate ?? (b as any).targetDate ?? (b as any).dueDateMs)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });
  const upcomingFocus = sortedUpcoming.slice(0, 4);

  const formatDueLabel = (task: Task): string => {
    const due = decodeToDate(task.dueDate ?? (task as any).targetDate ?? (task as any).dueDateMs);
    if (!due) return 'No due date';
    return format(due, 'MMM d');
  };

  const automationSnapshot = [
    { label: 'Tasks due today', value: tasksDueToday },
    { label: 'Reminders pending', value: remindersDueToday.length },
    { label: 'Chores today', value: choresDueToday.length },
    { label: 'Routines today', value: routinesDueToday.length },
    { label: 'Unscheduled blocks', value: unscheduledToday.length },
  ];

  return (
    <Container fluid className="p-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between flex-wrap gap-3 align-items-start mb-3">
            <div>
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <h2 className="mb-0">Dashboard</h2>
                <SprintSelector
                  selectedSprintId={selectedSprintId}
                  onSprintChange={(sprintId: string) => setSelectedSprintId(sprintId)}
                />
                <CompactSprintMetrics selectedSprintId={selectedSprintId} />
                {stats.tasksUnlinked > 0 && (
                  <Badge bg="warning" text="dark" pill>
                    {stats.tasksUnlinked} unlinked tasks
                  </Badge>
                )}
              </div>
              <div className="text-muted small mt-2">{dailyBrief()}</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <small className="text-muted">Last updated {lastUpdated.toLocaleTimeString()}</small>
              <Button variant="outline-primary" size="sm" onClick={loadDashboardData}>
                Refresh
              </Button>
            </div>
          </div>

          <Row className="g-3 mb-4">
            <Col xl={3} md={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Body>
                  <div className="text-uppercase text-muted small mb-1">Goals</div>
                  <h3 className="fw-semibold mb-1">{stats.activeGoals}</h3>
                  <div className="text-muted small">{stats.goalsDueSoon} due in next 14 days</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xl={3} md={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Body>
                  <div className="text-uppercase text-muted small mb-1">Stories</div>
                  <h3 className="fw-semibold mb-1">{stats.activeStories}</h3>
                  <ProgressBar now={stats.storyCompletion} variant="success" className="mb-2" />
                  <div className="text-muted small">{stats.storyCompletion}% complete</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xl={3} md={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Body>
                  <div className="text-uppercase text-muted small mb-1">Sprint Progress</div>
                  <h3 className="fw-semibold mb-1">{stats.sprintTasksDone}/{stats.sprintTasksTotal}</h3>
                  <ProgressBar now={sprintProgress} variant="info" className="mb-2" />
                  <div className="text-muted small">
                    {hasSelectedSprint
                      ? `${sprintRemaining} tasks remaining`
                      : 'Select a sprint to track burndown'}
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col xl={3} md={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Body>
                  <div className="text-uppercase text-muted small mb-1">Workload</div>
                  <h3 className="fw-semibold mb-1">{stats.pendingTasks}</h3>
                  <ul className="list-unstyled mb-0 text-muted small">
                    <li>Upcoming deadlines: {stats.upcomingDeadlines}</li>
                    <li>Unlinked tasks: {stats.tasksUnlinked}</li>
                  </ul>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mb-4">
            <Col xl={4} md={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Daily Priorities</span>
                  <Button variant="link" size="sm" className="text-decoration-none" onClick={() => navigate('/tasks')}>
                    Open tasks
                  </Button>
                </Card.Header>
                <Card.Body>
                  {priorityBanner ? (
                    <div className="border rounded p-3 mb-3 bg-light">
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="fw-semibold">{priorityBanner.title}</div>
                        {priorityBanner.bucket && (
                          <Badge bg="primary" pill>{priorityBanner.bucket}</Badge>
                        )}
                      </div>
                      {priorityBanner.score ? (
                        <div className="text-muted small mt-1">AI score {Math.round(priorityBanner.score)}</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-muted">Focus recommendations will appear after reprioritisation runs.</div>
                  )}

                  <div className="text-uppercase text-muted small fw-semibold mb-2">Next up</div>
                  {upcomingFocus.length ? (
                    <ul className="list-unstyled mb-0">
                      {upcomingFocus.map((task) => (
                        <li key={task.id} className="mb-2">
                          <div className="fw-semibold">{task.title}</div>
                          <div className="text-muted small">{formatDueLabel(task)}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-muted small">No upcoming work detected.</div>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col xl={4} md={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="fw-semibold">Today's Schedule</Card.Header>
                <Card.Body>
                  {todayBlocks.length === 0 ? (
                    <div className="text-muted">No blocks scheduled today.</div>
                  ) : (
                    <Table size="sm" className="mb-0">
                      <tbody>
                        {todayBlocks.map((block) => (
                          <tr key={block.id}>
                            <td style={{ width: '35%' }}>
                              {new Date(block.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td>{block.category || block.title || 'Block'}</td>
                            <td className="text-end">
                              <Badge bg="secondary">{block.theme || 'General'}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col xl={4} md={12}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="fw-semibold">Automation Snapshot</Card.Header>
                <Card.Body>
                  <ul className="list-unstyled mb-3">
                    {automationSnapshot.map((item) => (
                      <li key={item.label} className="d-flex justify-content-between align-items-center py-1">
                        <span className="text-muted">{item.label}</span>
                        <span className="fw-semibold">{item.value}</span>
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline-primary" size="sm" onClick={handleOpenChecklist}>
                    View planner checklist
                  </Button>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mb-4">
            <Col xl={8}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="fw-semibold">Today's Checklist</Card.Header>
                <Card.Body>
                  {unscheduledToday.length > 0 && (
                    <Alert variant="warning" className="py-2">
                      <div className="fw-semibold mb-1">Scheduling issues</div>
                      <ul className="mb-0 small">
                        {unscheduledSummary.map((item) => (
                          <li key={item.id}>{item.title || item.sourceId}</li>
                        ))}
                        {unscheduledToday.length > unscheduledSummary.length && (
                          <li className="text-muted">+{unscheduledToday.length - unscheduledSummary.length} more</li>
                        )}
                      </ul>
                    </Alert>
                  )}
                  <ChecklistPanel title="" compact />
                </Card.Body>
              </Card>
            </Col>
            <Col xl={4}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="fw-semibold">Theme Breakdown</Card.Header>
                <Card.Body>
                  <ThemeBreakdown onThemeSelect={handleThemeSelect} />
                </Card.Body>
              </Card>
              <Card className="shadow-sm border-0 mt-3">
                <Card.Header className="fw-semibold">Finance Snapshot</Card.Header>
                <Card.Body>
                  {!monzoSummary ? (
                    <div className="text-muted">Connect Monzo to surface spending insights.</div>
                  ) : (
                    <>
                      <div className="d-flex justify-content-between mb-2">
                        <span className="text-muted">Spent</span>
                        <span className="fw-semibold">£{Number(monzoSummary.totals?.spent ?? 0).toFixed(2)}</span>
                      </div>
                      <div className="d-flex justify-content-between mb-2">
                        <span className="text-muted">Budget</span>
                        <span className="fw-semibold">£{Number(monzoSummary.totals?.budget ?? 0).toFixed(2)}</span>
                      </div>
                      <div className="d-flex justify-content-between mb-3">
                        <span className="text-muted">Remaining</span>
                        <span className="fw-semibold">£{Number(monzoSummary.totals?.remaining ?? 0).toFixed(2)}</span>
                      </div>
                      {monzoSummary.categories && monzoSummary.categories.length > 0 && (
                        <ul className="list-unstyled mb-0 small text-muted">
                          {monzoSummary.categories.map((cat, idx) => (
                            <li key={idx} className="d-flex justify-content-between">
                              <span>{cat.category || cat.name || 'Category'}</span>
                              <span>£{Number(cat.spent || 0).toFixed(2)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-3">
            <Col xl={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Reminders Due Today</span>
                  <Badge bg="warning" text="dark">{remindersDueToday.length}</Badge>
                </Card.Header>
                <Card.Body>
                  {remindersDueToday.length === 0 ? (
                    <div className="text-muted">No reminders remaining today.</div>
                  ) : (
                    <ul className="list-unstyled mb-3">
                      {remindersDueToday.slice(0, 6).map((reminder) => (
                        <li key={reminder.id} className="d-flex justify-content-between align-items-center py-1">
                          <span>{reminder.title}</span>
                          <small className="text-muted ms-2">
                            {reminder.dueDate ? format(reminder.dueDate, 'HH:mm') : 'Anytime'}
                          </small>
                        </li>
                      ))}
                      {remindersDueToday.length > 6 && (
                        <li className="text-muted small">+{remindersDueToday.length - 6} more</li>
                      )}
                    </ul>
                  )}
                  <div className="d-flex justify-content-end">
                    <Button size="sm" variant="outline-primary" onClick={handleNavigateToTasksToday}>
                      Review tasks & reminders
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col xl={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Routines &amp; Chores Today</span>
                  <Badge bg="info">{choresDueToday.length + routinesDueToday.length}</Badge>
                </Card.Header>
                <Card.Body>
                  {(choresDueToday.length + routinesDueToday.length) === 0 ? (
                    <div className="text-muted">No routines or chores scheduled today.</div>
                  ) : (
                    <ul className="list-unstyled mb-3">
                      {[...choresDueToday, ...routinesDueToday]
                        .sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER))
                        .slice(0, 6)
                        .map((item) => (
                          <li key={`${item.type}-${item.id}`} className="d-flex justify-content-between align-items-center py-1">
                            <span>
                              <Badge bg={item.type === 'chore' ? 'secondary' : 'success'} className="me-2">
                                {item.type === 'chore' ? 'Chore' : 'Routine'}
                              </Badge>
                              {item.title}
                            </span>
                            <small className="text-muted ms-2">
                              {item.dueAt ? format(item.dueAt, 'HH:mm') : 'Anytime'}
                            </small>
                          </li>
                        ))}
                      {(choresDueToday.length + routinesDueToday.length) > 6 && (
                        <li className="text-muted small">+{choresDueToday.length + routinesDueToday.length - 6} more</li>
                      )}
                    </ul>
                  )}
                  <div className="d-flex justify-content-end">
                    <Button size="sm" variant="outline-primary" onClick={handleOpenChecklist}>
                      Open daily checklist
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          
          {/* Priority Banner */}
          {/* Daily Brief */}
          {/* Key Stats Row */}
        </Col>
      </Row>
    </Container>
  );
};

export default Dashboard;

export {};
