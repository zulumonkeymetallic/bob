import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, ProgressBar, Badge, Button, Dropdown, Alert, Modal, Form } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Task, Goal, Sprint } from '../types';

interface SprintMetrics {
  totalStories: number;
  activeStories: number;
  doneStories: number;
  defectStories: number;
  totalTasks: number;
  completedTasks: number;
  daysLeft: number;
  sprintProgress: number;
  goalProgress: { [goalId: string]: number };
  themeProgress: { [theme: string]: { completed: number; total: number } };
}

interface DashboardStats {
  currentSprint: Sprint | null;
  sprints: Sprint[];
  sprintMetrics: SprintMetrics;
  recentStories: Story[];
  upcomingTasks: Task[];
  goals: Goal[];
}

const SprintDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [stats, setStats] = useState<DashboardStats>({
    currentSprint: null,
    sprints: [],
    sprintMetrics: {
      totalStories: 0,
      activeStories: 0,
      doneStories: 0,
      defectStories: 0,
      totalTasks: 0,
      completedTasks: 0,
      daysLeft: 0,
      sprintProgress: 0,
      goalProgress: {},
      themeProgress: {}
    },
    recentStories: [],
    upcomingTasks: [],
    goals: []
  });
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [newSprintName, setNewSprintName] = useState('');
  const [sprintDuration, setSprintDuration] = useState(14); // Default 2 weeks

  useEffect(() => {
    if (!currentUser) return;
    loadDashboardData();
  }, [currentUser, currentPersona, selectedSprintId]);

  const loadDashboardData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load sprints
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc')
    );
    
    // Load goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    // Load stories for current sprint
    const storiesQuery = selectedSprintId 
      ? query(
          collection(db, 'stories'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', currentPersona),
          where('sprintId', '==', selectedSprintId)
        )
      : query(
          collection(db, 'stories'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', currentPersona),
          limit(10)
        );
    
    // Load tasks
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('priority', 'desc'),
      limit(10)
    );

    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      
      const currentSprint = selectedSprintId 
        ? sprintsData.find(s => s.id === selectedSprintId) || null
        : sprintsData.find(s => {
            const now = Date.now();
            return now >= s.startDate && now <= s.endDate;
          }) || null;
      
      setStats(prev => ({
        ...prev,
        sprints: sprintsData,
        currentSprint
      }));
      
      if (!selectedSprintId && currentSprint) {
        setSelectedSprintId(currentSprint.id);
      }
    });

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      
      setStats(prev => ({ ...prev, goals: goalsData }));
    });

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      
      setStats(prev => ({ ...prev, recentStories: storiesData }));
      
      // Calculate sprint metrics
      const totalStories = storiesData.length;
      const activeStories = storiesData.filter(s => s.status === 'active').length;
      const doneStories = storiesData.filter(s => s.status === 'done').length;
      const defectStories = storiesData.filter(s => s.status === 'defect').length;
      
      // Calculate theme progress
      const themeProgress: { [theme: string]: { completed: number; total: number } } = {};
      storiesData.forEach(story => {
        if (story.theme) {
          if (!themeProgress[story.theme]) {
            themeProgress[story.theme] = { completed: 0, total: 0 };
          }
          themeProgress[story.theme].total++;
          if (story.status === 'done') {
            themeProgress[story.theme].completed++;
          }
        }
      });
      
      // Calculate goal progress
      const goalProgress: { [goalId: string]: number } = {};
      const goalStories: { [goalId: string]: Story[] } = {};
      storiesData.forEach(story => {
        if (!goalStories[story.goalId]) {
          goalStories[story.goalId] = [];
        }
        goalStories[story.goalId].push(story);
      });
      
      Object.keys(goalStories).forEach(goalId => {
        const stories = goalStories[goalId];
        const completed = stories.filter(s => s.status === 'done').length;
        goalProgress[goalId] = stories.length > 0 ? (completed / stories.length) * 100 : 0;
      });
      
      const sprintProgress = totalStories > 0 ? (doneStories / totalStories) * 100 : 0;
      
      // Calculate days left in sprint
      let daysLeft = 0;
      if (stats.currentSprint) {
        const now = Date.now();
        const endDate = stats.currentSprint.endDate;
        daysLeft = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
      }
      
      setStats(prev => ({
        ...prev,
        sprintMetrics: {
          totalStories,
          activeStories,
          doneStories,
          defectStories,
          totalTasks: 0, // Will be updated by tasks subscription
          completedTasks: 0,
          daysLeft,
          sprintProgress,
          goalProgress,
          themeProgress
        }
      }));
    });

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      
      setStats(prev => ({ ...prev, upcomingTasks: tasksData }));
      
      // Filter tasks for current sprint stories
      const sprintStoryIds = stats.recentStories.map(s => s.id);
      const sprintTasks = tasksData.filter(t => 
        t.parentType === 'story' && sprintStoryIds.includes(t.parentId)
      );
      
      const totalTasks = sprintTasks.length;
      const completedTasks = sprintTasks.filter(t => t.status === 'done').length;
      
      setStats(prev => ({
        ...prev,
        sprintMetrics: {
          ...prev.sprintMetrics,
          totalTasks,
          completedTasks
        }
      }));
    });

    setLoading(false);

    return () => {
      unsubscribeSprints();
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeTasks();
    };
  };

  const createNewSprint = async () => {
    if (!currentUser || !newSprintName.trim()) return;
    
    const startDate = Date.now();
    const endDate = startDate + (sprintDuration * 24 * 60 * 60 * 1000);
    
    try {
      const docRef = await addDoc(collection(db, 'sprints'), {
        name: newSprintName,
        startDate,
        endDate,
        planningDate: startDate,
        retroDate: endDate,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      setSelectedSprintId(docRef.id);
      setNewSprintName('');
      setShowCreateSprint(false);
    } catch (error) {
      console.error('Error creating sprint:', error);
    }
  };

  const moveStoryToSprint = async (storyId: string, targetSprintId: string) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        sprintId: targetSprintId,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error moving story to sprint:', error);
    }
  };

  const getThemeColor = (theme: string): string => {
    switch (theme) {
      case 'Health': return 'success';
      case 'Growth': return 'primary';
      case 'Wealth': return 'warning';
      case 'Tribe': return 'info';
      case 'Home': return 'secondary';
      default: return 'light';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'done': return 'success';
      case 'active': return 'warning';
      case 'backlog': return 'secondary';
      case 'defect': return 'danger';
      default: return 'secondary';
    }
  };

  if (!currentUser) {
    return <div>Please sign in to view your sprint dashboard.</div>;
  }

  return (
    <Container fluid className="p-4">
      <Row>
        <Col>
          {/* Header with Sprint Selector */}
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Sprint Dashboard</h2>
            <div className="d-flex align-items-center gap-3">
              <Dropdown>
                <Dropdown.Toggle variant="outline-primary">
                  {stats.currentSprint ? stats.currentSprint.name : 'Select Sprint'}
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  {stats.sprints.map(sprint => (
                    <Dropdown.Item 
                      key={sprint.id}
                      onClick={() => setSelectedSprintId(sprint.id)}
                      active={sprint.id === selectedSprintId}
                    >
                      {sprint.name}
                      <small className="text-muted d-block">
                        {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                      </small>
                    </Dropdown.Item>
                  ))}
                  <Dropdown.Divider />
                  <Dropdown.Item onClick={() => setShowCreateSprint(true)}>
                    + Create New Sprint
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
              <Button variant="outline-secondary" size="sm" onClick={loadDashboardData}>
                Refresh
              </Button>
            </div>
          </div>

          {/* Current Sprint Overview */}
          {stats.currentSprint && (
            <Alert variant="info" className="mb-4">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <strong>Current Sprint: {stats.currentSprint.name}</strong>
                  <br />
                  <small>
                    {new Date(stats.currentSprint.startDate).toLocaleDateString()} - {new Date(stats.currentSprint.endDate).toLocaleDateString()}
                  </small>
                </div>
                <div className="text-end">
                  <h4 className="mb-0 text-primary">{stats.sprintMetrics.daysLeft} days left</h4>
                  <small className="text-muted">Sprint progress: {stats.sprintMetrics.sprintProgress.toFixed(1)}%</small>
                </div>
              </div>
            </Alert>
          )}

          {/* Sprint Metrics Row */}
          <Row className="mb-4">
            <Col md={2}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-primary">{stats.sprintMetrics.totalStories}</h3>
                  <p className="mb-0">Total Stories</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-warning">{stats.sprintMetrics.activeStories}</h3>
                  <p className="mb-0">Active</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-success">{stats.sprintMetrics.doneStories}</h3>
                  <p className="mb-0">Done</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-danger">{stats.sprintMetrics.defectStories}</h3>
                  <p className="mb-0">Defects</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-info">{stats.sprintMetrics.completedTasks}/{stats.sprintMetrics.totalTasks}</h3>
                  <p className="mb-0">Tasks</p>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2}>
              <Card className="text-center h-100">
                <Card.Body>
                  <h3 className="text-primary">{stats.sprintMetrics.sprintProgress.toFixed(1)}%</h3>
                  <p className="mb-0">Progress</p>
                  <ProgressBar 
                    now={stats.sprintMetrics.sprintProgress} 
                    variant="primary" 
                    className="mt-2"
                    style={{ height: '6px' }}
                  />
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Theme Progress */}
          {Object.keys(stats.sprintMetrics.themeProgress).length > 0 && (
            <Row className="mb-4">
              <Col>
                <Card>
                  <Card.Header>
                    <h5 className="mb-0">Theme Progress</h5>
                  </Card.Header>
                  <Card.Body>
                    <Row>
                      {Object.entries(stats.sprintMetrics.themeProgress).map(([theme, progress]) => (
                        <Col md={2} key={theme} className="mb-3">
                          <div className="text-center">
                            <Badge bg={getThemeColor(theme)} className="mb-2 w-100 p-2">
                              {theme}
                            </Badge>
                            <div>
                              <strong>{progress.completed}/{progress.total}</strong>
                            </div>
                            <ProgressBar 
                              now={progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}
                              variant={getThemeColor(theme)}
                              className="mt-1"
                              style={{ height: '4px' }}
                            />
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          )}

          {/* Sprint Stories and Tasks */}
          <Row className="mb-4">
            <Col md={8}>
              <Card>
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Sprint Stories</h5>
                  <Button variant="outline-primary" size="sm" href="/kanban">
                    Manage in Kanban
                  </Button>
                </Card.Header>
                <Card.Body>
                  {loading ? (
                    <div className="text-center p-3">
                      <div className="spinner-border spinner-border-sm" />
                      <p className="mt-2 mb-0">Loading stories...</p>
                    </div>
                  ) : stats.recentStories.length === 0 ? (
                    <p className="text-muted mb-0">No stories in this sprint. <a href="/kanban">Add stories to sprint</a></p>
                  ) : (
                    <div className="list-group list-group-flush">
                      {stats.recentStories.map(story => {
                        const goal = stats.goals.find(g => g.id === story.goalId);
                        return (
                          <div key={story.id} className="list-group-item border-0 px-0">
                            <div className="d-flex justify-content-between align-items-start">
                              <div className="flex-grow-1">
                                <h6 className="mb-1">{story.title}</h6>
                                <p className="mb-1 text-muted small">{story.description}</p>
                                {goal && (
                                  <div className="mb-1">
                                    <Badge bg={getThemeColor(goal.theme)} className="me-1">
                                      {goal.theme}
                                    </Badge>
                                    <small className="text-muted">{goal.title}</small>
                                  </div>
                                )}
                              </div>
                              <div className="text-end">
                                <Badge bg={getStatusColor(story.status)}>{story.status}</Badge>
                                <br />
                                <Badge bg="secondary" className="mt-1">{story.points} pts</Badge>
                                {stats.sprints.length > 1 && (
                                  <Dropdown className="mt-1">
                                    <Dropdown.Toggle variant="outline-secondary" size="sm">
                                      Move
                                    </Dropdown.Toggle>
                                    <Dropdown.Menu>
                                      {stats.sprints
                                        .filter(s => s.id !== selectedSprintId)
                                        .map(sprint => (
                                          <Dropdown.Item 
                                            key={sprint.id}
                                            onClick={() => moveStoryToSprint(story.id, sprint.id)}
                                          >
                                            {sprint.name}
                                          </Dropdown.Item>
                                        ))}
                                    </Dropdown.Menu>
                                  </Dropdown>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>

            {/* Goal Progress */}
            <Col md={4}>
              <Card>
                <Card.Header>
                  <h5 className="mb-0">Goal Progress</h5>
                </Card.Header>
                <Card.Body>
                  {Object.keys(stats.sprintMetrics.goalProgress).length === 0 ? (
                    <p className="text-muted mb-0">No goals linked to sprint stories</p>
                  ) : (
                    <div>
                      {Object.entries(stats.sprintMetrics.goalProgress).map(([goalId, progress]) => {
                        const goal = stats.goals.find(g => g.id === goalId);
                        if (!goal) return null;
                        
                        return (
                          <div key={goalId} className="mb-3">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <small className="fw-medium">{goal.title}</small>
                              <small className="text-muted">{progress.toFixed(0)}%</small>
                            </div>
                            <ProgressBar 
                              now={progress}
                              variant={getThemeColor(goal.theme)}
                              style={{ height: '8px' }}
                            />
                            <Badge bg={getThemeColor(goal.theme)} className="mt-1">
                              {goal.theme}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Quick Actions */}
          <Card>
            <Card.Header>
              <h5 className="mb-0">Sprint Actions</h5>
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={2} className="mb-2">
                  <Button variant="primary" href="/kanban" className="w-100">
                    Kanban Board
                  </Button>
                </Col>
                <Col md={2} className="mb-2">
                  <Button variant="success" href="/goals" className="w-100">
                    Plan Goals
                  </Button>
                </Col>
                <Col md={2} className="mb-2">
                  <Button variant="info" href="/backlog" className="w-100">
                    Story Backlog
                  </Button>
                </Col>
                <Col md={2} className="mb-2">
                  <Button variant="warning" href="/ai-planner" className="w-100">
                    AI Planning
                  </Button>
                </Col>
                <Col md={2} className="mb-2">
                  <Button variant="outline-primary" onClick={() => setShowCreateSprint(true)} className="w-100">
                    New Sprint
                  </Button>
                </Col>
                <Col md={2} className="mb-2">
                  <Button variant="outline-info" href="/calendar" className="w-100">
                    Calendar Sync
                  </Button>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Create Sprint Modal */}
      <Modal show={showCreateSprint} onHide={() => setShowCreateSprint(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create New Sprint</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Sprint Name</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Sprint 1, Q1 Health Focus"
                value={newSprintName}
                onChange={(e) => setNewSprintName(e.target.value)}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Duration (days)</Form.Label>
              <Form.Select 
                value={sprintDuration}
                onChange={(e) => setSprintDuration(Number(e.target.value))}
              >
                <option value={7}>1 week</option>
                <option value={14}>2 weeks</option>
                <option value={21}>3 weeks</option>
                <option value={28}>4 weeks</option>
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowCreateSprint(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={createNewSprint} disabled={!newSprintName.trim()}>
            Create Sprint
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default SprintDashboard;

export {};
