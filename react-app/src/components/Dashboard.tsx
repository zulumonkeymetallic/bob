import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Badge, Button, Alert, Table } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Task, Sprint } from '../types';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '../utils/statusHelpers';
import { ChoiceHelper } from '../config/choices';
import SprintKanbanPage from './SprintKanbanPage';
import SprintSelector from './SprintSelector';
import { useSprint } from '../contexts/SprintContext';
import ChecklistPanel from './ChecklistPanel';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import CompactSprintMetrics from './CompactSprintMetrics';
import ThemeBreakdown from './ThemeBreakdown';
import { format, startOfDay, endOfDay } from 'date-fns';
import type { ScheduledInstanceModel } from '../domain/scheduler/repository';
import { humanizePolicyMode } from '../utils/schedulerPolicy';
import { nextDueAt } from '../utils/recurrence';

interface DashboardStats {
  activeGoals: number;
  activeStories: number;
  pendingTasks: number;
  completedToday: number;
  upcomingDeadlines: number;
  progressScore: number;
}

interface ReminderItem {
  id: string;
  title: string;
  dueDate: Date | null;
  taskId?: string | null;
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
    activeStories: 0,
    pendingTasks: 0,
    completedToday: 0,
    upcomingDeadlines: 0,
    progressScore: 0
  });
  const [recentStories, setRecentStories] = useState<Story[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  // Use global sprint selection for consistency across app
  const { selectedSprintId, setSelectedSprintId } = useSprint();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [priorityBanner, setPriorityBanner] = useState<{ title: string; score: number; bucket?: string } | null>(null);
  const [todayBlocks, setTodayBlocks] = useState<any[]>([]);
  const [tasksDueToday, setTasksDueToday] = useState<number>(0);
  const [unscheduledToday, setUnscheduledToday] = useState<ScheduledInstanceModel[]>([]);
  const [remindersDueToday, setRemindersDueToday] = useState<ReminderItem[]>([]);
  const [choresDueToday, setChoresDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [routinesDueToday, setRoutinesDueToday] = useState<ChecklistSnapshotItem[]>([]);
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
      limit(5)
    );
    
    // Load tasks (simplified query while indexes are building)
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('priority', 'desc'),
      limit(10)
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
      setRecentStories(storiesData);
      
      // Calculate stats from stories
      const activeStories = storiesData.filter(s => isStatus(s.status, 'active')).length;
      const doneStories = storiesData.filter(s => isStatus(s.status, 'done')).length;
      
      setStats(prev => ({
        ...prev,
        activeStories,
        progressScore: storiesData.length > 0 ? Math.round((doneStories / storiesData.length) * 100) : 0
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
      
      // Filter out 'done' tasks on client side while indexes are building
      const tasksData = allTasks.filter(task => !isStatus(task.status, 'done')).slice(0, 5);
      setUpcomingTasks(tasksData);
      
      // Calculate task stats
      const pendingTasks = tasksData.filter(t => !isStatus(t.status, 'done')).length;
      const todayCompleted = tasksData.filter(t => {
        if (isStatus(t.status, 'done') && t.updatedAt) {
          try {
            const taskDate = typeof t.updatedAt === 'object' && t.updatedAt && 'seconds' in t.updatedAt 
              ? new Date((t.updatedAt as any).seconds * 1000)
              : new Date(t.updatedAt as any);
            return taskDate.toDateString() === new Date().toDateString();
          } catch {
            return false;
          }
        }
        return false;
      }).length;
      
      setStats(prev => ({
        ...prev,
        pendingTasks,
        completedToday: todayCompleted
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
        loadChecklistDueToday()
      ]);
    } catch {}

    return () => {
      unsubscribeStories();
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
    return null;
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

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'done': return 'success';
      case 'active': return 'warning';
      case 'backlog': return 'secondary';
      default: return 'secondary';
    }
  };

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'P1': case 'high': return 'danger';
      case 'P2': case 'medium': return 'warning';
      case 'P3': case 'low': return 'secondary';
      default: return 'secondary';
    }
  };

  const handleNavigateToTasksToday = () => {
    navigate('/task-list', { state: { preset: 'dueToday' } });
  };

  const handleNavigateToCalendarToday = () => {
    navigate('/calendar', { state: { focus: 'today' } });
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

  return (
    <Container fluid className="p-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div className="d-flex align-items-center gap-3 flex-wrap">
              <h2 className="mb-0">Dashboard</h2>
              <SprintSelector
                selectedSprintId={selectedSprintId}
                onSprintChange={(sprintId: string) => setSelectedSprintId(sprintId)}
                className="ms-3"
              />
              <CompactSprintMetrics selectedSprintId={selectedSprintId} />
            </div>
            <div className="d-flex align-items-center">
              <small className="text-muted me-3">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </small>
              <Button variant="outline-primary" size="sm" onClick={loadDashboardData}>
                Refresh
              </Button>
            </div>
          </div>

          {/* Welcome Section */}
          <Alert variant="info" className="mb-4">
            <strong>Welcome back, {currentUser.displayName || 'there'}!</strong>
            <br />
            Currently viewing <Badge bg="primary">{currentPersona}</Badge> persona data.
          </Alert>
          
          {/* Priority Banner */}
          {priorityBanner && (
            <Alert variant="primary" className="mb-3">
              <strong>Priority for Today:</strong> {priorityBanner.title}
              {priorityBanner.score ? <span className="ms-2 badge bg-light text-dark">Score {Math.round(priorityBanner.score)}</span> : null}
            </Alert>
          )}
          {/* Daily Brief */}
          <Card className="mb-3">
            <Card.Body>
              <strong>Daily Brief:</strong> <span className="ms-1">{dailyBrief()}</span>
            </Card.Body>
          </Card>
          {/* Key Stats Row */}
          <Row className="mb-4">
            <Col md={6} lg={3}>
              <Card
                className="text-center h-100"
                role="button"
                style={{ cursor: 'pointer' }}
                onClick={handleNavigateToTasksToday}
              >
                <Card.Body>
                  <h3 className="text-warning">{tasksDueToday}</h3>
                  <p className="mb-0">Tasks Due Today</p>
                  <small className="text-muted d-block mt-1">Click to review due items</small>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={3}>
              <Card
                className="text-center h-100"
                role="button"
                style={{ cursor: 'pointer' }}
                onClick={handleNavigateToCalendarToday}
              >
                <Card.Body>
                  <h3 className="text-info">{todayBlocks.length}</h3>
                  <p className="mb-0">Today's Blocks</p>
                  <small className="text-muted d-block mt-1">Open planner for today</small>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Sprint Kanban moved to its own page (/sprints/kanban) */}

          {/* 3-Column Overview: Checklist | Calendar | Theme Breakdown */}
          <Row className="mb-4">
            <Col lg={4} className="mb-3">
              <Card className="h-100">
                <Card.Body>
                  {unscheduledToday.length > 0 && (
                    <Alert variant="warning" className="mb-3">
                      <strong>Scheduling issues:</strong>
                      <ul className="mb-0 small">
                        {unscheduledSummary.map((item) => {
                          const label = item.title || item.sourceId;
                          const policyLabel = item.schedulingContext?.policyMode
                            ? humanizePolicyMode(item.schedulingContext.policyMode)
                            : null;
                          return (
                            <li key={item.id}>
                              {item.deepLink ? (
                                <a href={item.deepLink} target="_blank" rel="noopener noreferrer">
                                  {label}
                                </a>
                              ) : (
                                label
                              )}
                              {item.statusReason && <span> · {item.statusReason}</span>}
                              {policyLabel && <span> · {policyLabel}</span>}
                              {item.mobileCheckinUrl && (
                                <span> · <a href={item.mobileCheckinUrl} target="_blank" rel="noopener noreferrer">Check-in</a></span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {unscheduledToday.length > unscheduledSummary.length && (
                        <div className="small text-muted mt-1">+{unscheduledToday.length - unscheduledSummary.length} more</div>
                      )}
                    </Alert>
                  )}
                  <ChecklistPanel title="Today's Checklist" compact />
                  <div className="d-flex justify-content-end mt-3">
                    <Button variant="outline-primary" size="sm" onClick={handleOpenChecklist}>
                      Open Planner Checklist
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={4} className="mb-3">
              <Card className="h-100">
                <Card.Header>
                  <h5 className="mb-0">Today's Schedule</h5>
                </Card.Header>
                <Card.Body>
                  {todayBlocks.length === 0 ? (
                    <div className="text-muted">No blocks for today</div>
                  ) : (
                    <Table size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th style={{width:'30%'}}>Time</th>
                          <th>Category</th>
                          <th>Theme</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayBlocks.map(b => (
                          <tr key={b.id}>
                            <td>{new Date(b.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                            <td>{b.category || b.title || 'Block'}</td>
                            <td><Badge bg="secondary">{b.theme}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col lg={4} className="mb-3">
              <ThemeBreakdown onThemeSelect={handleThemeSelect} />
            </Col>
          </Row>

          <Row className="mb-4">
            <Col lg={6} className="mb-3">
              <Card className="h-100">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Reminders Due Today</h5>
                  <Badge bg="warning" text="dark">{remindersDueToday.length}</Badge>
                </Card.Header>
                <Card.Body>
                  {remindersDueToday.length === 0 ? (
                    <div className="text-muted">No reminders remaining today.</div>
                  ) : (
                    <ul className="list-unstyled mb-3">
                      {remindersDueToday.slice(0, 4).map((reminder) => (
                        <li key={reminder.id} className="d-flex justify-content-between align-items-center py-1">
                          <span>{reminder.title}</span>
                          <small className="text-muted ms-2">
                            {reminder.dueDate ? format(reminder.dueDate, 'HH:mm') : 'Anytime'}
                          </small>
                        </li>
                      ))}
                      {remindersDueToday.length > 4 && (
                        <li className="text-muted small">+{remindersDueToday.length - 4} more</li>
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
            <Col lg={6} className="mb-3">
              <Card className="h-100">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Routines &amp; Chores Today</h5>
                  <Badge bg="info">{choresDueToday.length + routinesDueToday.length}</Badge>
                </Card.Header>
                <Card.Body>
                  {choresDueToday.length + routinesDueToday.length === 0 ? (
                    <div className="text-muted">No routines or chores scheduled today.</div>
                  ) : (
                    <ul className="list-unstyled mb-3">
                      {[...choresDueToday, ...routinesDueToday]
                        .sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER))
                        .slice(0, 4)
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
                      {(choresDueToday.length + routinesDueToday.length) > 4 && (
                        <li className="text-muted small">+{choresDueToday.length + routinesDueToday.length - 4} more</li>
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
        </Col>
      </Row>
    </Container>
  );
};

export default Dashboard;

export {};
