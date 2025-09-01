import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, ProgressBar, Badge, Button, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Task } from '../types';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '../utils/statusHelpers';
import { ChoiceHelper } from '../config/choices';

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
    if (!currentUser) return;
    
    loadDashboardData();
  }, [currentUser, currentPersona]);

  const loadDashboardData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('userId', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('updatedAt', 'desc'),
      limit(5)
    );
    
    // Load tasks
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('userId', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', '!=', 'done'),
      orderBy('priority', 'desc'),
      limit(5)
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
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
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

          {/* Recent Stories */}
          <Row className="mb-4">
            <Col md={6}>
              <Card>
                <Card.Header>
                  <h5 className="mb-0">Recent Stories</h5>
                </Card.Header>
                <Card.Body>
                  {loading ? (
                    <div className="text-center p-3">
                      <div className="spinner-border spinner-border-sm" />
                      <p className="mt-2 mb-0">Loading stories...</p>
                    </div>
                  ) : recentStories.length === 0 ? (
                    <p className="text-muted mb-0">No stories found. <a href="/kanban">Create your first story</a></p>
                  ) : (
                    <div className="list-group list-group-flush">
                      {recentStories.map(story => (
                        <div key={story.id} className="list-group-item border-0 px-0">
                          <div className="d-flex justify-content-between align-items-start">
                            <div>
                              <h6 className="mb-1">{story.title}</h6>
                              <p className="mb-1 text-muted small">{story.description}</p>
                            </div>
                            <div className="text-end">
                              <Badge bg={ChoiceHelper.getColor('story', 'status', story.status)}>{ChoiceHelper.getLabel('story', 'status', story.status)}</Badge>
                              <br />
                              <Badge bg={ChoiceHelper.getColor('story', 'priority', story.priority)} className="mt-1">{ChoiceHelper.getLabel('story', 'priority', story.priority)}</Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>

            {/* Upcoming Tasks */}
            <Col md={6}>
              <Card>
                <Card.Header>
                  <h5 className="mb-0">Upcoming Tasks</h5>
                </Card.Header>
                <Card.Body>
                  {loading ? (
                    <div className="text-center p-3">
                      <div className="spinner-border spinner-border-sm" />
                      <p className="mt-2 mb-0">Loading tasks...</p>
                    </div>
                  ) : upcomingTasks.length === 0 ? (
                    <p className="text-muted mb-0">All caught up! <a href="/tasks">View all tasks</a></p>
                  ) : (
                    <div className="list-group list-group-flush">
                      {upcomingTasks.map(task => (
                        <div key={task.id} className="list-group-item border-0 px-0">
                          <div className="d-flex justify-content-between align-items-start">
                            <div>
                              <h6 className="mb-1">{task.title}</h6>
                              <p className="mb-1 text-muted small">{task.description}</p>
                            </div>
                            <div className="text-end">
                              <Badge bg={ChoiceHelper.getColor('task', 'status', task.status)}>{ChoiceHelper.getLabel('task', 'status', task.status)}</Badge>
                              <br />
                              <Badge bg={ChoiceHelper.getColor('task', 'priority', task.priority)} className="mt-1">{ChoiceHelper.getLabel('task', 'priority', task.priority)}</Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
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
