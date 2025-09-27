import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Badge, Button, Alert, Table, ProgressBar } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import SprintMetricsPanel from './SprintMetricsPanel';
import { Sprint, Story, Task } from '../types';
import { db } from '../firebase';
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

interface DashboardStats {
  activeGoals: number;
  activeStories: number;
  pendingTasks: number;
  completedToday: number;
  upcomingDeadlines: number;
  progressScore: number;
}

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
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
  // Finance metrics (budget summary)
  const [monzoSummary, setMonzoSummary] = useState<any | null>(null);
  const [budgetConfig, setBudgetConfig] = useState<Record<string, number>>({});
  // Burndown data sources
  const [activeSprint, setActiveSprint] = useState<any | null>(null);
  const [sprintStories, setSprintStories] = useState<any[]>([]);
  const [sprintTasks, setSprintTasks] = useState<any[]>([]);
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
        countTasksDueToday()
      ]);
    } catch {}

    return () => {
      unsubscribeStories();
      unsubscribeTasks();
    };
  };

  // Subscribe to finance summary and load optional budget config
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(doc(db, 'monzo_budget_summary', currentUser.uid), (snap) => {
      setMonzoSummary(snap.exists() ? snap.data() : null);
    });
    // Load budget config once (no listener needed for dashboard)
    getDoc(doc(db, 'finance_budgets', currentUser.uid)).then((snap) => {
      if (snap.exists()) {
        const d: any = snap.data();
        setBudgetConfig(d?.byCategory || {});
      }
    }).catch(() => {});
    return () => unsub();
  }, [currentUser]);

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

  // Derived finance KPIs
  const currency = 'GBP';
  const formatCurrency = (n: number) => (Number(n) || 0).toLocaleString('en-GB', { style: 'currency', currency });
  const currentMonthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthly = monzoSummary?.monthly?.[currentMonthKey] || null;
  const monthSpend = (monthly?.mandatory || 0) + (monthly?.optional || 0);
  const totalBudget = Object.entries(budgetConfig || {})
    .filter(([k]) => !/income/i.test(k) && !/saving/i.test(k))
    .reduce((sum, [, v]) => sum + (Number(v) || 0), 0);
  const budgetLeft = Math.max(totalBudget - monthSpend, 0);
  const budgetPct = totalBudget > 0 ? Math.min(100, Math.round((monthSpend / totalBudget) * 100)) : 0;

  // Load burndown-related data for selected sprint
  useEffect(() => {
    if (!currentUser || !selectedSprintId) { setActiveSprint(null); setSprintStories([]); setSprintTasks([]); return; }
    const sRef = doc(db, 'sprints', selectedSprintId);
    const unsubS = onSnapshot(sRef, (snap) => { setActiveSprint(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null); });
    const unsubStories = onSnapshot(query(collection(db, 'stories'), where('ownerUid','==', currentUser.uid), where('persona','==', currentPersona)), (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setSprintStories(all.filter((st:any) => st.sprintId === selectedSprintId));
    });
    const unsubTasks = onSnapshot(query(collection(db, 'tasks'), where('ownerUid','==', currentUser.uid), where('persona','==', currentPersona)), (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setSprintTasks(all);
    });
    return () => { unsubS(); unsubStories(); unsubTasks(); };
  }, [currentUser, currentPersona, selectedSprintId]);

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
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-warning">{tasksDueToday}</h3>
                  <p className="mb-0">Tasks Due Today</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={3}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-info">{todayBlocks.length}</h3>
                  <p className="mb-0">Today's Blocks</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={3} className="mt-3 mt-md-0">
              <Card className="text-center h-100">
                <Card.Body>
                  <h5 className="mb-1">{formatCurrency(monthSpend)}</h5>
                  <div className="text-muted" style={{ fontSize: 13 }}>Month-to-date spend</div>
                  {totalBudget > 0 && (
                    <div className="mt-2">
                      <ProgressBar now={budgetPct} label={`${budgetPct}%`} style={{ height: 8 }} />
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col md={6} lg={3} className="mt-3 mt-lg-0">
              <Card className="text-center h-100">
                <Card.Body>
                  <h5 className="mb-1">{totalBudget > 0 ? formatCurrency(budgetLeft) : '—'}</h5>
                  <div className="text-muted" style={{ fontSize: 13 }}>Budget remaining</div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Sprint Kanban moved to its own page (/sprints/kanban) */}

          {/* 3-Column Overview: Checklist | Calendar | Upcoming Tasks */}
          <Row className="mb-4">
            <Col lg={4} className="mb-3">
              <Card className="h-100">
                <Card.Body>
                  <ChecklistPanel title="Today's Checklist" compact />
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
              <Card className="h-100">
                <Card.Header>
                  <h5 className="mb-0">Upcoming Tasks</h5>
                </Card.Header>
                <Card.Body>
                  {upcomingTasks.length === 0 ? (
                    <div className="text-muted">No upcoming tasks</div>
                  ) : (
                    <Table size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th style={{width:'60%'}}>Task</th>
                          <th>Due</th>
                          <th>Priority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...upcomingTasks]
                          .sort((a:any,b:any)=>{
                            const ad = a.dueDate || 0; const bd = b.dueDate || 0; return (ad||0) - (bd||0);
                          })
                          .slice(0,5)
                          .map((t:any)=> (
                            <tr key={t.id}>
                              <td>{t.title}</td>
                              <td>{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</td>
                              <td><Badge bg={getPriorityColor(String(t.priority || 'P3'))}>{String(t.priority || 'P3')}</Badge></td>
                            </tr>
                          ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Sprint Burndown (Kanban) */}
          {activeSprint && (
            <div className="mb-4">
              <SprintMetricsPanel
                sprint={activeSprint as any}
                stories={sprintStories as any}
                tasks={sprintTasks as any}
                goals={[]}
              />
            </div>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default Dashboard;

export {};
