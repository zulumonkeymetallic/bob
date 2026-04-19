import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Container, Row, Col, Button, Form, Modal, Badge, Dropdown } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Task, Story, Goal } from '../types';
import ModernTaskTable from './ModernTaskTable';
import { useSidebar } from '../contexts/SidebarContext';
import { BookOpen, Target, Calendar, Plus, Filter, Search, Upload, ListChecks, Link, Unlink, FolderOpen } from 'lucide-react';
import ImportModal from './ImportModal';
import StatCard from './common/StatCard';
import PageHeader from './common/PageHeader';
import { SkeletonStatCard } from './common/SkeletonLoader';
import EmptyState from './common/EmptyState';
import { colors } from '../utils/colors';

const TasksManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const { showSidebar } = useSidebar();
  const [searchParams] = useSearchParams();

  // State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);

  // Filters
  const [filterStory, setFilterStory] = useState<string>('all');
  const [filterGoal, setFilterGoal] = useState<string>('all');
  const [filterSprint, setFilterSprint] = useState<string>('all');
  const [initializedSprintDefault, setInitializedSprintDefault] = useState<boolean>(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    if (!currentUser) return;

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

    // Stories subscription for linking
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

    // Goals subscription for context
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

    setLoading(false);

    return () => {
      unsubscribeTasks();
      unsubscribeStories();
      unsubscribeGoals();
    };
  }, [currentUser, currentPersona]);

  useEffect(() => {
    const sprintParam = searchParams.get('sprint');
    const filterParam = searchParams.get('filter');

    if (sprintParam) {
      setFilterSprint(sprintParam);
      setInitializedSprintDefault(true);
    } else if (!initializedSprintDefault) {
      const active = sprints.find(s => (s.status ?? 0) === 1);
      if (active) {
        setFilterSprint(active.id);
        setInitializedSprintDefault(true);
      }
    }

    if (filterParam === 'pending') {
      setFilterStatus('0');
    }
  }, [sprints, initializedSprintDefault, searchParams]);

  // Filter tasks based on story/goal/sprint relationships
  const filteredTasks = tasks.filter(task => {
    if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterStatus !== 'all' && (task.status !== undefined ? task.status : 0).toString() !== filterStatus) return false;
    if (filterSprint !== 'all' && task.sprintId !== filterSprint) return false;
    const rawType = String((task as any)?.type || (task as any)?.task_type || 'task').toLowerCase();
    const normalizedType = rawType === 'habitual' ? 'habit' : rawType;
    if (filterType !== 'all' && normalizedType !== filterType) return false;

    // Filter by story
    if (filterStory !== 'all') {
      if (filterStory === 'unlinked') {
        if (task.storyId) return false;
      } else {
        if (task.storyId !== filterStory) return false;
      }
    }

    // Filter by goal (through story relationship)
    if (filterGoal !== 'all') {
      if (filterGoal === 'unlinked') {
        // Task has no story, or story has no goal
        const story = stories.find(s => s.id === task.storyId);
        if (task.storyId && story?.goalId) return false;
      } else {
        const story = stories.find(s => s.id === task.storyId);
        if (!story || story.goalId !== filterGoal) return false;
      }
    }

    return true;
  });

  // Task handlers for ModernTaskTable
  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    try {
      console.log(`🔄 Updating task ${taskId}:`, updates);

      await updateDoc(doc(db, 'tasks', taskId), {
        ...updates,
        updatedAt: serverTimestamp()
      });

      console.log(`✅ Task ${taskId} updated successfully`);
    } catch (error) {
      console.error('❌ Error updating task:', error);
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        deleted: true,
        updatedAt: serverTimestamp()
      });
      console.log(`✅ Task ${taskId} marked as deleted`);
    } catch (error) {
      console.error('❌ Error deleting task:', error);
    }
  };

  const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        priority: newPriority,
        updatedAt: serverTimestamp()
      });
      console.log(`✅ Task ${taskId} priority updated to ${newPriority}`);
    } catch (error) {
      console.error('❌ Error updating task priority:', error);
    }
  };

  // Get story name for display
  const getStoryName = (storyId: string | undefined) => {
    if (!storyId) return 'No Story';
    const story = stories.find(s => s.id === storyId);
    return story?.title || 'Unknown Story';
  };

  // Get goal name through story relationship
  const getGoalNameForTask = (task: Task) => {
    if (!task.storyId) return 'No Goal';
    const story = stories.find(s => s.id === task.storyId);
    if (!story?.goalId) return 'No Goal';
    const goal = goals.find(g => g.id === story.goalId);
    return goal?.title || 'Unknown Goal';
  };

  // Statistics
  const taskStats = {
    total: filteredTasks.length,
    linked: filteredTasks.filter(t => t.storyId).length,
    unlinked: filteredTasks.filter(t => !t.storyId).length,
    withGoals: filteredTasks.filter(t => {
      if (!t.storyId) return false;
      const story = stories.find(s => s.id === t.storyId);
      return story?.goalId;
    }).length
  };

  return (
    <Container fluid style={{ padding: '24px', backgroundColor: 'var(--bg)', minHeight: '100vh' }}>
      <PageHeader
        title="Task Management"
        subtitle="Manage and track all tasks across stories and goals"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Tasks' }
        ]}
        badge={{ label: `${currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona`, variant: 'primary' }}
        actions={
          <>
            <Button variant="outline-primary" onClick={() => setShowImportModal(true)}>
              <Upload size={16} style={{ marginRight: '8px' }} />
              Import
            </Button>
            <Button variant="primary" href="/task">
              <Plus size={16} style={{ marginRight: '8px' }} />
              Add Task
            </Button>
          </>
        }
      />

      {/* Statistics Cards */}
      <Row className="mb-4">
        {loading ? (
          <>
            <Col md={3}>
              <SkeletonStatCard />
            </Col>
            <Col md={3}>
              <SkeletonStatCard />
            </Col>
            <Col md={3}>
              <SkeletonStatCard />
            </Col>
            <Col md={3}>
              <SkeletonStatCard />
            </Col>
          </>
        ) : (
          <>
            <Col md={3}>
              <StatCard
                label="Total Tasks"
                value={taskStats.total}
                icon={ListChecks}
                iconColor={colors.brand.primary}
              />
            </Col>
            <Col md={3}>
              <StatCard
                label="Linked to Stories"
                value={taskStats.linked}
                icon={Link}
                iconColor={colors.success.primary}
              />
            </Col>
            <Col md={3}>
              <StatCard
                label="Unlinked Tasks"
                value={taskStats.unlinked}
                icon={Unlink}
                iconColor={colors.danger.primary}
              />
            </Col>
            <Col md={3}>
              <StatCard
                label="Connected to Goals"
                value={taskStats.withGoals}
                icon={Target}
                iconColor={colors.themes.growth}
              />
            </Col>
          </>
        )}
      </Row>

      {/* Filters */}
      <Row className="mb-4">
        <Col>
          <Card style={{ border: 'none', boxShadow: 'var(--glass-shadow, 0 1px 3px var(--glass-shadow-color))' }}>
            <Card.Body>
              <Row className="align-items-center">
                <Col md={2}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <Search size={14} style={{ marginRight: '6px' }} />
                      Search
                    </Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="Search tasks..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      size="sm"
                    />
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <BookOpen size={14} style={{ marginRight: '6px' }} />
                      Story
                    </Form.Label>
                    <Form.Select
                      value={filterStory}
                      onChange={(e) => setFilterStory(e.target.value)}
                      size="sm"
                    >
                      <option value="all">All Stories</option>
                      <option value="unlinked">Unlinked Tasks</option>
                      {stories.map(story => (
                        <option key={story.id} value={story.id}>
                          {story.title}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <Target size={14} style={{ marginRight: '6px' }} />
                      Goal
                    </Form.Label>
                    <Form.Select
                      value={filterGoal}
                      onChange={(e) => setFilterGoal(e.target.value)}
                      size="sm"
                    >
                      <option value="all">All Goals</option>
                      <option value="unlinked">No Goal Connection</option>
                      {goals.map(goal => (
                        <option key={goal.id} value={goal.id}>
                          {goal.title}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <Calendar size={14} style={{ marginRight: '6px' }} />
                      Sprint
                    </Form.Label>
                    <Form.Select
                      value={filterSprint}
                      onChange={(e) => setFilterSprint(e.target.value)}
                      size="sm"
                    >
                      <option value="all">All Sprints</option>
                      <option value="">No Sprint (Backlog)</option>
                      {sprints.map(sprint => (
                        <option key={sprint.id} value={sprint.id}>
                          {sprint.name}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <FolderOpen size={14} style={{ marginRight: '6px' }} />
                      Type
                    </Form.Label>
                    <Form.Select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      size="sm"
                    >
                      <option value="all">All Types</option>
                      <option value="task">Task</option>
                      <option value="chore">Chore</option>
                      <option value="habit">Habit</option>
                      <option value="routine">Routine</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <Filter size={14} style={{ marginRight: '6px' }} />
                      Status
                    </Form.Label>
                    <Form.Select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      size="sm"
                    >
                      <option value="all">All Status</option>
                      <option value="0">To Do</option>
                      <option value="1">In Progress</option>
                      <option value="2">Done</option>
                      <option value="3">Blocked</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <div style={{ paddingTop: '20px' }}>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => {
                        setFilterStory('all');
                        setFilterGoal('all');
                        setFilterSprint('all');
                        setFilterType('all');
                        setFilterStatus('all');
                        setSearchTerm('');
                      }}
                    >
                      Clear Filters
                    </Button>
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Tasks Table */}
      <Row>
        <Col>
          <Card style={{ border: 'none', boxShadow: 'var(--glass-shadow, 0 1px 3px var(--glass-shadow-color))' }}>
            <Card.Header style={{
              backgroundColor: 'var(--card)',
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
                <EmptyState
                  icon={FolderOpen}
                  title="No tasks found"
                  description="Get started by creating your first task or adjust your filters to see more results."
                  action={{
                    label: 'Add Task',
                    onClick: () => window.location.href = '/task',
                    variant: 'primary'
                  }}
                />
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
        </Col>
      </Row>

      {/* Import Modal */}
      <ImportModal
        show={showImportModal}
        onHide={() => setShowImportModal(false)}
        entityType="tasks"
        onImportComplete={() => {
          setShowImportModal(false);
          // Tasks will auto-refresh via subscription
        }}
      />
    </Container>
  );
};

export default TasksManagement;
