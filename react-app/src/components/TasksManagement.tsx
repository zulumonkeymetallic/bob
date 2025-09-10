import React, { useState, useEffect } from 'react';
import { Card, Container, Row, Col, Button, Form, Modal, Badge, Dropdown } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Task, Story, Goal, Sprint } from '../types';
import ModernTaskTable from './ModernTaskTable';
import { useSidebar } from '../contexts/SidebarContext';
import { BookOpen, Target, Calendar, Plus, Filter, Search, Upload } from 'lucide-react';
import ImportModal from './ImportModal';

const TasksManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  
  // State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  
  // Filters
  const [filterStory, setFilterStory] = useState<string>('all');
  const [filterGoal, setFilterGoal] = useState<string>('all');
  const [filterSprint, setFilterSprint] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    if (!currentUser) return;

    const setupSubscriptions = () => {
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
      });

      setLoading(false);

      return () => {
        unsubscribeTasks();
        unsubscribeStories();
        unsubscribeGoals();
        unsubscribeSprints();
      };
    };

    return setupSubscriptions();
  }, [currentUser, currentPersona]);

  // Filter tasks based on story/goal/sprint relationships
  const filteredTasks = tasks.filter(task => {
    if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterStatus !== 'all' && (task.status !== undefined ? task.status : 0).toString() !== filterStatus) return false;
    if (filterSprint !== 'all' && task.sprintId !== filterSprint) return false;
    
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
      {/* Header */}
      <Row className="mb-4">
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: 'var(--text)' }}>
                Task Management
              </h2>
              <Badge bg="primary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona
              </Badge>
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="outline-primary" onClick={() => setShowImportModal(true)}>
                <Upload size={16} style={{ marginRight: '8px' }} />
                Import
              </Button>
              <Button variant="primary" href="/tasks/new">
                <Plus size={16} style={{ marginRight: '8px' }} />
                Add Task
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* Statistics Cards */}
      <Row className="mb-4">
        <Col md={3}>
          <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--text)' }}>
                {taskStats.total}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--muted)', marginTop: '4px' }}>
                Total Tasks
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--green)' }}>
                {taskStats.linked}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--muted)', marginTop: '4px' }}>
                Linked to Stories
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--red)' }}>
                {taskStats.unlinked}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--muted)', marginTop: '4px' }}>
                Unlinked Tasks
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--purple)' }}>
                {taskStats.withGoals}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--muted)', marginTop: '4px' }}>
                Connected to Goals
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Row className="mb-4">
        <Col>
          <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
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
          <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
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
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Empty State */}
      {filteredTasks.length === 0 && (
        <Row className="mt-4">
          <Col>
            <Card style={{ border: 'none', textAlign: 'center', padding: '60px 20px' }}>
              <Card.Body>
                <BookOpen size={48} style={{ color: 'var(--muted)', marginBottom: '16px' }} />
                <h5 style={{ color: 'var(--text)', marginBottom: '8px' }}>No tasks found</h5>
                <p style={{ color: 'var(--muted)', marginBottom: '24px' }}>
                  Create your first task or adjust your filters to see tasks.
                </p>
                <Button variant="primary" href="/tasks/new">
                  Create Task
                </Button>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Import Tasks Modal */}
      <ImportModal
        entityType="tasks"
        show={showImportModal}
        onHide={() => setShowImportModal(false)}
        onImportComplete={() => {
          setShowImportModal(false);
          // Tasks will auto-refresh via subscription
        }}
      />
    </Container>
  );
};

export default TasksManagement;
