import React, { useState, useEffect } from 'react';
import { Card, Container, Row, Col, Button, Dropdown, Badge, Spinner } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp, orderBy, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Story, Sprint, Task, Goal } from '../types';
import ModernKanbanBoard from './ModernKanbanBoard';
import StoryTasksPanel from './StoryTasksPanel';
import ModernTaskTable from './ModernTaskTable';
import { ChevronLeft, ChevronRight, Calendar, Target, BarChart3 } from 'lucide-react';
import { useSprint } from '../contexts/SprintContext';

interface SprintKanbanPageProps {
  showSidebar?: boolean;
  selectedSprintId?: string;
  showInlineTasks?: boolean; // show inline tasks panel under board when selecting a story
}

const SprintKanbanPage: React.FC<SprintKanbanPageProps> = ({ 
  showSidebar = false, 
  selectedSprintId: propSelectedSprintId,
  showInlineTasks = true,
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  // State
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const { selectedSprintId, setSelectedSprintId } = useSprint();
  const [loading, setLoading] = useState(true);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);

  // Update selected sprint when prop changes
  useEffect(() => {
    if (propSelectedSprintId && propSelectedSprintId !== selectedSprintId) {
      setSelectedSprintId(propSelectedSprintId);
    }
  }, [propSelectedSprintId, selectedSprintId, setSelectedSprintId]);

  // Effective selection: prefer context id, otherwise prop; then fall back to ACTIVE sprint
  const effectiveSelectedId = selectedSprintId || propSelectedSprintId || '';

  // Get current sprint from list (by id) or ACTIVE by status
  const currentSprint = effectiveSelectedId
    ? sprints.find(s => s.id === effectiveSelectedId)
    : sprints.find(s => s.status === 1);

  // Match stories by sprint id OR legacy sprint name for backwards compatibility
  const selectedMatchValues = new Set<string | undefined>([
    effectiveSelectedId || undefined,
    currentSprint?.id,
    (currentSprint as any)?.name,
  ]);

  // Filter stories and tasks for current selection
  const sprintStories = stories.filter((story) => {
    const storySprint = (story as any).sprintId as string | undefined;
    return currentSprint || effectiveSelectedId
      ? (storySprint ? selectedMatchValues.has(storySprint) : false)
      : !storySprint;
  });
  
  const sprintTasks = tasks.filter(task => 
    currentSprint || effectiveSelectedId
      ? (task.sprintId ? selectedMatchValues.has(task.sprintId as any) : false)
      : !task.sprintId
  );

  useEffect(() => {
    if (!currentUser) return;

    const setupSubscriptions = () => {
      // Stories subscription
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('orderIndex', 'asc')
      );

      const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Story[];
        setStories(storiesData);
      });

      // Tasks subscription
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('serverUpdatedAt', 'desc')
      );

      const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
        const tasksData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        setTasks(tasksData);
      });

      // Goals subscription
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );

      const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Goal[];
        setGoals(goalsData);
      });

      // Sprints subscription
      const sprintsQuery = query(
        collection(db, 'sprints'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('startDate', 'desc')
      );

      const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
        const sprintsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Sprint[];
        setSprints(sprintsData);
        
        // Auto-select active sprint if none selected
        if (!selectedSprintId) {
          const activeSprint = sprintsData.find(s => s.status === 1);
          if (activeSprint) {
            setSelectedSprintId(activeSprint.id);
          }
        }
      });

      setLoading(false);

      return () => {
        unsubscribeStories();
        unsubscribeTasks();
        unsubscribeGoals();
        unsubscribeSprints();
      };
    };

    return setupSubscriptions();
  }, [currentUser, currentPersona, selectedSprintId]);

  // Sprint navigation
  const handleSprintChange = (sprintId: string | null) => {
    setSelectedSprintId(sprintId || '');
  };

  const handlePreviousSprint = () => {
    const currentIndex = sprints.findIndex(s => s.id === selectedSprintId);
    if (currentIndex < sprints.length - 1) {
      setSelectedSprintId(sprints[currentIndex + 1].id);
    }
  };

  const handleNextSprint = () => {
    const currentIndex = sprints.findIndex(s => s.id === selectedSprintId);
    if (currentIndex > 0) {
      setSelectedSprintId(sprints[currentIndex - 1].id);
    }
  };

  // Sprint metrics
  const getSprintMetrics = () => {
    const totalStories = sprintStories.length;
    const completedStories = sprintStories.filter(s => s.status === 4).length; // Done
    const totalTasks = sprintTasks.length;
    const completedTasks = sprintTasks.filter(t => t.status === 2).length; // Done
    const totalPoints = sprintStories.reduce((sum, story) => sum + (story.points || 0), 0);
    const completedPoints = sprintStories
      .filter(s => s.status === 4)
      .reduce((sum, story) => sum + (story.points || 0), 0);

    return {
      totalStories,
      completedStories,
      totalTasks,
      completedTasks,
      totalPoints,
      completedPoints,
      storyProgress: totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0,
      taskProgress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      pointsProgress: totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0
    };
  };

  const metrics = getSprintMetrics();

  if (loading) {
    return (
      <Container fluid className="p-4">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spinner animation="border" variant="primary" />
          <p style={{ marginTop: '16px', color: 'var(--muted)' }}>Loading sprint data...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid style={{ padding: '24px', backgroundColor: 'var(--bg)', minHeight: '100vh' }}>
      {/* Header */}
      <Row className="mb-4">
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: 'var(--text)' }}>
                Sprint Kanban
              </h2>
              <Badge bg="primary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona
              </Badge>
            </div>

            {/* Sprint Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={handlePreviousSprint}
                disabled={!selectedSprintId || sprints.findIndex(s => s.id === selectedSprintId) >= sprints.length - 1}
                style={{ padding: '6px 12px' }}
              >
                <ChevronLeft size={16} />
              </Button>

              <Dropdown>
                <Dropdown.Toggle 
                  variant="outline-primary" 
                  style={{ minWidth: '200px', textAlign: 'left' }}
                >
                  {currentSprint ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Calendar size={16} />
                      {currentSprint.name}
                      {currentSprint.status === 1 && (
                        <Badge bg="success" style={{ fontSize: '10px', marginLeft: 'auto' }}>
                          ACTIVE
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Calendar size={16} />
                      Backlog (No Sprint)
                    </div>
                  )}
                </Dropdown.Toggle>

                <Dropdown.Menu style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  <Dropdown.Item
                    onClick={() => handleSprintChange(null)}
                    active={!selectedSprintId}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Target size={16} />
                      Backlog (No Sprint)
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Divider />
                  {sprints.map(sprint => (
                    <Dropdown.Item
                      key={sprint.id}
                      onClick={() => handleSprintChange(sprint.id)}
                      active={sprint.id === selectedSprintId}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Calendar size={16} />
                        <div>
                          <div>{sprint.name}</div>
                          <small style={{ color: 'var(--muted)' }}>
                            {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
                          </small>
                        </div>
                        {sprint.status === 1 && (
                          <Badge bg="success" style={{ fontSize: '10px', marginLeft: 'auto' }}>
                            ACTIVE
                          </Badge>
                        )}
                      </div>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>

              <Button
                variant="outline-secondary"
                size="sm"
                onClick={handleNextSprint}
                disabled={!selectedSprintId || sprints.findIndex(s => s.id === selectedSprintId) <= 0}
                style={{ padding: '6px 12px' }}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* Helper: Assign unassigned stories to the selected sprint */}
      {currentSprint && (
        <Row className="mb-3">
          <Col>
            <div className="d-flex align-items-center justify-content-between p-2 border rounded" style={{ background: 'var(--notion-hover)' }}>
              <div>
                <strong>Selected sprint:</strong> {currentSprint.name || currentSprint.id}
                <span className="ms-2 text-muted">(Showing stories with sprintId "{currentSprint.id}")</span>
              </div>
              <div className="d-flex gap-2">
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={async () => {
                    try {
                      const unassigned = stories.filter(s => !('sprintId' in s) || !(s as any).sprintId);
                      const toAssign = unassigned.slice(0, 10);
                      if (toAssign.length === 0) {
                        alert('No unassigned stories found.');
                        return;
                      }
                      const ops = toAssign.map(s => updateDoc(doc(db, 'stories', s.id), { sprintId: currentSprint.id, updatedAt: serverTimestamp() } as any));
                      await Promise.all(ops);
                    } catch (e) {
                      console.error('Failed to assign stories to sprint', e);
                      alert('Failed to assign stories.');
                    }
                  }}
                >
                  Assign unassigned stories to this sprint
                </Button>
              </div>
            </div>
          </Col>
        </Row>
      )}

      {/* Sprint Metrics */}
      {currentSprint && (
        <Row className="mb-4">
          <Col>
            <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <Card.Body>
                <Row>
                  <Col md={3}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--green)' }}>
                        {metrics.completedStories}/{metrics.totalStories}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Stories Completed
                      </div>
                      <div style={{ marginTop: '4px' }}>
                        <Badge bg="success" style={{ fontSize: '11px' }}>
                          {metrics.storyProgress}%
                        </Badge>
                      </div>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--brand)' }}>
                        {metrics.completedTasks}/{metrics.totalTasks}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Tasks Completed
                      </div>
                      <div style={{ marginTop: '4px' }}>
                        <Badge bg="primary" style={{ fontSize: '11px' }}>
                          {metrics.taskProgress}%
                        </Badge>
                      </div>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--purple)' }}>
                        {metrics.completedPoints}/{metrics.totalPoints}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Story Points
                      </div>
                      <div style={{ marginTop: '4px' }}>
                        <Badge bg="secondary" style={{ fontSize: '11px' }}>
                          {metrics.pointsProgress}%
                        </Badge>
                      </div>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)' }}>
                        {currentSprint.name}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Sprint Duration
                      </div>
                      <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                        {Math.ceil((currentSprint.endDate - currentSprint.startDate) / (1000 * 60 * 60 * 24))} days
                      </div>
                    </div>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Kanban Board */}
      <Row>
        <Col>
            <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ padding: '24px' }}>
              <ModernKanbanBoard
                onItemSelect={(item, type) => {
                  if (type === 'story') {
                    setSelectedStory(item as Story);
                  }
                }}
              />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Inline tasks for selected story (only on this page) */}
      {showInlineTasks && selectedStory && (
        <Row className="mt-3">
          <Col>
            <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <Card.Header style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
                <h5 className="mb-0">Tasks for: {selectedStory.title}</h5>
              </Card.Header>
              <Card.Body style={{ padding: 0 }}>
                <ModernTaskTable
                  tasks={tasks.filter(t => t.parentType === 'story' && t.parentId === selectedStory.id)}
                  stories={stories}
                  goals={goals}
                  sprints={sprints}
                  onTaskUpdate={async (taskId, updates) => {
                    await updateDoc(doc(db, 'tasks', taskId), { ...updates, updatedAt: serverTimestamp() });
                  }}
                  onTaskDelete={async (taskId) => {
                    await deleteDoc(doc(db, 'tasks', taskId));
                  }}
                  onTaskPriorityChange={async (taskId, newPriority) => {
                    await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() });
                  }}
                />
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Empty State */}
      {sprintStories.length === 0 && sprintTasks.length === 0 && (
        <Row className="mt-4">
          <Col>
            <Card style={{ border: 'none', textAlign: 'center', padding: '60px 20px' }}>
              <Card.Body>
                <BarChart3 size={48} style={{ color: 'var(--muted)', marginBottom: '16px' }} />
                <h5 style={{ color: 'var(--text)', marginBottom: '8px' }}>
                  {currentSprint ? `No items in ${currentSprint.name}` : 'No items in backlog'}
                </h5>
                <p style={{ color: 'var(--muted)', marginBottom: '24px' }}>
                  {currentSprint 
                    ? 'Add stories and tasks to this sprint to start planning your work.'
                    : 'Create stories and tasks, then assign them to a sprint when ready.'
                  }
                </p>
                <Button variant="primary" href="/stories">
                  Manage Stories
                </Button>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </Container>
  );
};

export default SprintKanbanPage;
