import React, { useState, useEffect, useMemo } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Task, Story, Goal, Sprint } from '../types';
import ModernTaskTable from './ModernTaskTable';
import { isStatus, isTheme } from '../utils/statusHelpers';
import { useSprint } from '../contexts/SprintContext';

const TaskListView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { setUpdateHandler } = useSidebar();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dueFilter, setDueFilter] = useState<'all' | 'today'>('all');
  const [loading, setLoading] = useState(true);
  const { selectedSprintId, setSelectedSprintId, sprints: rawSprints } = useSprint();
  const location = useLocation();
  const navigate = useNavigate();

  const sprints = useMemo<Sprint[]>(() => {
    return rawSprints.map((s) => {
      const startDate = (s as any)?.startDate?.toDate?.() || s.startDate;
      const endDate = (s as any)?.endDate?.toDate?.() || s.endDate;
      const createdAt = (s as any)?.createdAt?.toDate?.() || s.createdAt;
      const updatedAt = (s as any)?.updatedAt?.toDate?.() || s.updatedAt;
      return { ...s, startDate, endDate, createdAt, updatedAt } as Sprint;
    });
  }, [rawSprints]);

  useEffect(() => {
    if (!currentUser) return;
    const loadTaskData = () => {
      if (!currentUser) return;

      setLoading(true);

      // Load all related data
      const tasksQuery = selectedSprintId
        ? query(
            collection(db, 'tasks'),
            where('ownerUid', '==', currentUser.uid),
            where('sprintId', '==', selectedSprintId),
            orderBy('priority', 'desc')
          )
        : query(
            collection(db, 'tasks'),
            where('ownerUid', '==', currentUser.uid),
            orderBy('priority', 'desc')
          );
      
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
      
      // Subscribe to real-time updates
      const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
        const tasksData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
            createdAt: data.createdAt?.toDate?.() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
            dueDate: data.dueDate?.toDate?.() || data.dueDate,
          };
        }) as Task[];
        setTasks(tasksData);
      });
      
      const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
            createdAt: data.createdAt?.toDate?.() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          };
        }) as Story[];
        setStories(storiesData);
      });
      
      const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
            createdAt: data.createdAt?.toDate?.() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
          };
        }) as Goal[];
        setGoals(goalsData);
      });
      
      setLoading(false);

      return () => {
        unsubscribeTasks();
        unsubscribeStories();
        unsubscribeGoals();
      };
    };
    return loadTaskData();
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
  const isDueToday = (task: Task): boolean => {
    const raw = (task.dueDate as any) ?? task.targetDate ?? task.dueDateMs ?? null;
    if (!raw) return false;
    const dateValue = raw instanceof Date
      ? raw
      : typeof raw === 'object' && typeof raw.toDate === 'function'
      ? raw.toDate()
      : Number.isFinite(Number(raw))
      ? new Date(Number(raw))
      : new Date(raw);
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return false;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    return dateValue >= start && dateValue <= end;
  };

  const filteredTasks = tasks.filter(task => {
    if (selectedSprintId && task.sprintId !== selectedSprintId) return false;
    if (task.persona) {
      const persona = typeof task.persona === 'string' ? task.persona.toLowerCase() : String(task.persona).toLowerCase();
      if (persona && persona !== currentPersona) return false;
    }
    if (filterStatus !== 'all' && !isStatus(task.status, filterStatus)) return false;
    if (filterTheme !== 'all' && !isTheme(task.theme, filterTheme)) return false;
    if (dueFilter === 'today' && !isDueToday(task)) return false;
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
    <div style={{ 
      padding: '24px', 
      backgroundColor: 'var(--bg)',
      minHeight: '100vh',
      width: '100%'
    }}>
      <div style={{ maxWidth: '100%', margin: '0' }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '24px' 
        }}>
          <div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '600' }}>
              Task List View
            </h2>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '16px' }}>
              Manage all your tasks with modern table interface
            </p>
          </div>
          <Button variant="outline-primary" href="#" disabled>
            Switch to Kanban
          </Button>
        </div>

        {/* Dashboard Cards */}
        <Row className="mb-4">
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--text)' }}>
                  {taskCounts.total}
                </h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
                  Total Tasks
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--orange)' }}>
                  {taskCounts.planned}
                </h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
                  Planned
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--brand)' }}>
                  {taskCounts.inProgress}
                </h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
                  In Progress
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--green)' }}>
                  {taskCounts.done}
                </h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
                  Done
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Filters */}
        <Card style={{ marginBottom: '24px', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <Card.Body style={{ padding: '24px' }}>
            <Row>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Search Tasks</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="text"
                      placeholder="Search by title..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ border: '1px solid var(--line)' }}
                    />
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Status</Form.Label>
                  <Form.Select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{ border: '1px solid var(--line)' }}
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
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Sprint</Form.Label>
                  <Form.Select
                    value={selectedSprintId || 'all'}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedSprintId(value === 'all' ? '' : value);
                    }}
                    style={{ border: '1px solid var(--line)' }}
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
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Theme</Form.Label>
                  <Form.Select
                    value={filterTheme}
                    onChange={(e) => setFilterTheme(e.target.value)}
                    style={{ border: '1px solid var(--line)' }}
                  >
                    <option value="all">All Themes</option>
                    <option value="Health">Health</option>
                    <option value="Growth">Growth</option>
                    <option value="Wealth">Wealth</option>
                    <option value="Tribe">Tribe</option>
                    <option value="Home">Home</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="d-flex align-items-center" style={{ height: '100%' }}>
                  <Form.Check
                    type="switch"
                    id="filter-due-today"
                    label="Only Due Today"
                    checked={dueFilter === 'today'}
                    onChange={(e) => setDueFilter(e.target.checked ? 'today' : 'all')}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row style={{ marginTop: '16px' }}>
              <Col>
                <Button 
                  variant="outline-secondary" 
                  onClick={() => {
                    setFilterStatus('all');
                    setSelectedSprintId('');
                    setFilterTheme('all');
                    setSearchTerm('');
                    setDueFilter('all');
                  }}
                  style={{ borderColor: 'var(--line)' }}
                >
                  Clear Filters
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Modern Task Table - Full Width */}
        <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '600px' }}>
          <Card.Header style={{ 
            backgroundColor: 'var(--panel)', 
            borderBottom: '1px solid var(--line)', 
            padding: '20px 24px' 
          }}>
            <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              Tasks ({filteredTasks.length})
            </h5>
          </Card.Header>
          <Card.Body style={{ padding: 0 }}>
            {loading ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <div className="spinner-border" style={{ marginBottom: '16px' }} />
                <p style={{ margin: 0, color: 'var(--muted)' }}>Loading tasks...</p>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '16px' }}>
                  No tasks found. Create your first task to get started!
                </p>
              </div>
            ) : (
              <div style={{ height: '600px', overflow: 'auto' }}>
                <ModernTaskTable
                  tasks={filteredTasks}
                  stories={stories}
                  goals={goals}
                  sprints={sprints}
                  onTaskUpdate={handleTaskUpdate}
                  onTaskDelete={handleTaskDelete}
                  onTaskPriorityChange={handleTaskPriorityChange}
                />
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </div>
  );
};

export default TaskListView;
