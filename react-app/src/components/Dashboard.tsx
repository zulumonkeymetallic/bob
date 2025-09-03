import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, ProgressBar, Badge, Button, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Task } from '../types';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '../utils/statusHelpers';
import { ChoiceHelper } from '../config/choices';
import QuickActionsPanel from './QuickActionsPanel';
import DashboardSprintKanban from './DashboardSprintKanban';
import DashboardModernTaskTable from './DashboardModernTaskTable';

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
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
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
      const allTasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      
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

    return () => {
      unsubscribeStories();
      unsubscribeTasks();
    };
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

  if (!currentUser) {
    return <div>Please sign in to view your dashboard.</div>;
  }

  return (
    <Container fluid className="p-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Dashboard</h2>
            <div>
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
          
          {/* Quick Stats Row */}
          <Row className="mb-4">
            <Col md={3}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-primary">{stats.activeStories}</h3>
                  <p className="mb-0">Active Stories</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={3}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-warning">{stats.pendingTasks}</h3>
                  <p className="mb-0">Pending Tasks</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={3}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-success">{stats.completedToday}</h3>
                  <p className="mb-0">Completed Today</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={3}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-info">{stats.progressScore}%</h3>
                  <p className="mb-0">Progress Score</p>
                  <ProgressBar 
                    now={stats.progressScore} 
                    variant="info" 
                    className="mt-2"
                    style={{ height: '6px' }}
                  />
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Sprint Kanban Board */}
          <Row className="mb-4">
            <Col md={12}>
              <DashboardSprintKanban maxStories={8} />
            </Col>
          </Row>

          {/* Tasks and Quick Actions */}
          <Row className="mb-4">
            <Col md={8}>
              <DashboardModernTaskTable maxTasks={10} showDueToday={false} title="Upcoming Tasks" />
            </Col>
            <Col md={4}>
              <QuickActionsPanel 
                onAction={(type, data) => {
                  console.log('✨ Quick action completed:', type, data);
                  // Refresh dashboard data when new items are created
                  loadDashboardData();
                }} 
              />
            </Col>
          </Row>

          {/* Tasks Due Today */}
          <Row className="mb-4">
            <Col md={12}>
              <DashboardModernTaskTable maxTasks={5} showDueToday={true} title="Tasks Due Today" />
            </Col>
          </Row>

          {/* Quick Actions */}
          <Card>
            <Card.Header>
              <h5 className="mb-0">� Quick Actions</h5>
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={3} className="mb-2">
                  <Button variant="primary" href="/kanban" className="w-100">
                    Manage Stories
                  </Button>
                </Col>
                <Col md={3} className="mb-2">
                  <Button variant="success" href="/tasks" className="w-100">
                    View Tasks
                  </Button>
                </Col>
                <Col md={3} className="mb-2">
                  <Button variant="info" href="/goals" className="w-100">
                    Plan Goals
                  </Button>
                </Col>
                <Col md={3} className="mb-2">
                  <Button variant="warning" href="/ai-planner" className="w-100">
                    AI Planning
                  </Button>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default Dashboard;

export {};
