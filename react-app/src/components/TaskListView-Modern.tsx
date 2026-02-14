import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Task, Story, Goal } from '../types';
import ModernTaskTable from './ModernTaskTable';
import { isStatus, isTheme } from '../utils/statusHelpers';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { useSprint } from '../contexts/SprintContext';

const TaskListView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();
  const { themes: globalThemes } = useGlobalThemes();

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    let tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('priority', 'desc'),
    );
    if (selectedSprintId) {
      tasksQuery = query(tasksQuery, where('sprintId', '==', selectedSprintId));
    }

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(tasksData);
      setLoading(false);
    });

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storiesData);
    });

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeStories();
      unsubscribeGoals();
    };
  }, [currentUser, currentPersona, selectedSprintId]);

  // Handler functions for ModernTaskTable
  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        priority: newPriority,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task priority:', error);
    }
  };

  // Apply filters to tasks
  const filteredTasks = tasks.filter(task => {
    if (selectedSprintId && task.sprintId !== selectedSprintId) return false;
    // Respect persona when present on the task
    if (task.persona) {
      const p = typeof task.persona === 'string' ? task.persona.toLowerCase() : String(task.persona).toLowerCase();
      if (p && p !== currentPersona) return false;
    }
    if (filterStatus !== 'all' && !isStatus(task.status, filterStatus)) return false;
    const rawType = String((task as any)?.type || (task as any)?.task_type || 'task').toLowerCase();
    const normalizedType = rawType === 'habitual' ? 'habit' : rawType;
    if (filterType !== 'all' && normalizedType !== filterType) return false;
    if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Get counts for dashboard cards
  const taskCounts = {
    total: filteredTasks.length,
    planned: filteredTasks.filter(t => isStatus(t.status, 'planned')).length,
    inProgress: filteredTasks.filter(t => isStatus(t.status, 'in_progress')).length,
    done: filteredTasks.filter(t => isStatus(t.status, 'done')).length
  };

  return (
    <Container fluid className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Task List View</h2>
          <p className="text-muted mb-0">Manage all your tasks with modern table interface</p>
        </div>
        <Button variant="outline-primary" href="#" disabled>
          Switch to Kanban
        </Button>
      </div>

      {/* Dashboard Cards */}
      <Row className="mb-2">
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center" style={{ padding: '12px' }}>
              <h3 className="mb-1" style={{ fontSize: '26px' }}>{taskCounts.total}</h3>
              <p className="text-muted mb-0" style={{ fontSize: '12px' }}>Total Tasks</p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center" style={{ padding: '12px' }}>
              <h3 className="mb-1" style={{ fontSize: '26px' }}>{taskCounts.planned}</h3>
              <p className="text-muted mb-0" style={{ fontSize: '12px' }}>Planned</p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center" style={{ padding: '12px' }}>
              <h3 className="mb-1" style={{ fontSize: '26px' }}>{taskCounts.inProgress}</h3>
              <p className="text-muted mb-0" style={{ fontSize: '12px' }}>In Progress</p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center" style={{ padding: '12px' }}>
              <h3 className="mb-1" style={{ fontSize: '26px' }}>{taskCounts.done}</h3>
              <p className="text-muted mb-0" style={{ fontSize: '12px' }}>Done</p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Card className="mb-3">
        <Card.Body style={{ padding: '8px' }}>
          <Row>
            <Col md={3}>
              <Form.Group>
                <Form.Label className="small mb-0">Search Tasks</Form.Label>
                <InputGroup>
                  <Form.Control
                    size="sm"
                    type="text"
                    placeholder="Search by title..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </InputGroup>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label className="small mb-0">Status</Form.Label>
                <Form.Select
                  size="sm"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="planned">Planned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label className="small mb-0">Sprint</Form.Label>
                <Form.Select
                  size="sm"
                  value={selectedSprintId || 'all'}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedSprintId(value === 'all' ? '' : value);
                  }}
                >
                  <option value="all">All Sprints</option>
                  {sprints.map(sprint => (
                    <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label className="small mb-0">Theme</Form.Label>
                <Form.Select
                  size="sm"
                  value={filterTheme}
                  onChange={(e) => setFilterTheme(e.target.value)}
                >
                  <option value="all">All Themes</option>
                  {globalThemes.map((theme) => (
                    <option key={theme.id} value={String(theme.id)}>
                      {theme.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label className="small mb-0">Type</Form.Label>
                <Form.Select
                  size="sm"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">All Types</option>
                  <option value="task">Task</option>
                  <option value="chore">Chore</option>
                  <option value="habit">Habit</option>
                  <option value="routine">Routine</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
          <Row className="mt-1">
            <Col>
              <Button 
                size="sm"
                variant="outline-secondary" 
                onClick={() => {
                  setFilterStatus('all');
                  setSelectedSprintId('');
                  setFilterTheme('all');
                  setFilterType('all');
                  setSearchTerm('');
                }}
              >
                Clear Filters
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Modern Task Table */}
      <Card>
        <Card.Header>
          <h5 className="mb-0">Tasks ({filteredTasks.length})</h5>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center p-4">
              <div className="spinner-border" />
              <p className="mt-2">Loading tasks...</p>
            </div>
          ) : (
            <ModernTaskTable
              tasks={filteredTasks}
              stories={stories}
              goals={goals}
              sprints={sprints}
              onTaskUpdate={handleTaskUpdate}
              onTaskDelete={handleTaskDelete}
              onTaskPriorityChange={handleTaskPriorityChange}
            />
          )}
        </Card.Body>
      </Card>
    </Container>
  );
};

export default TaskListView;
