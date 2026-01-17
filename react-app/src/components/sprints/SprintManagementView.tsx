import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Container, Row, Col, Card, Button, Modal, Form, Table, Badge, ProgressBar, Alert, Dropdown } from 'react-bootstrap';
import {
  Play,
  Square,
  RotateCcw,
  Calendar,
  Users,
  Target,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Plus,
  Edit,
  Trash2,
  BarChart3
} from 'lucide-react';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { Story, Goal, Task, Sprint } from '../../types';
import { useSprint } from '../../contexts/SprintContext';
import { generateRef } from '../../utils/referenceGenerator';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '../../utils/statusHelpers';
import SprintMetricsPanel from '../SprintMetricsPanel';
import ModernSprintsTable from '../ModernSprintsTable';
import SprintKanbanPageV2 from '../SprintKanbanPageV2';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar } from 'recharts';

// BOB v3.5.6 - Sprint Management with Database Integration
// Replaces /kanban route with comprehensive sprint management

const SprintManagementView = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  const { sprints, sprintsById, selectedSprintId, setSelectedSprintId } = useSprint();
  const location = useLocation();

  // State management
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [showSprintModal, setShowSprintModal] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'board' | 'table' | 'burndown' | 'retrospective'>('table');
  const [newSprint, setNewSprint] = useState({
    name: '',
    objective: '',
    startDate: '',
    endDate: '',
    notes: '',
  });
  const [retrospectiveNotes, setRetrospectiveNotes] = useState({
    wentWell: '',
    toImprove: '',
    actions: '',
  });

  // New task form
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    effort: 'M' as 'S' | 'M' | 'L',
    priority: 2 as 1 | 2 | 3,
    estimatedHours: 1
  });

  const selectedSprint: Sprint | null = selectedSprintId ? (sprintsById[selectedSprintId] ?? null) : null;
  const sprintForCharts: Sprint | null = selectedSprint || sprints[0] || null;

  const sprintStories = sprintForCharts ? stories.filter((s) => s.sprintId === sprintForCharts.id) : [];
  const sprintPointsTotal = sprintStories.reduce((sum, s) => sum + (s.points || 0), 0);
  const sprintPointsDone = sprintStories.filter((s) => s.status === 4).reduce((sum, s) => sum + (s.points || 0), 0);

  const burndownData = React.useMemo(() => {
    if (!sprintForCharts) return [];
    const start = new Date(sprintForCharts.startDate);
    const end = new Date(sprintForCharts.endDate);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const now = new Date();
    const daysElapsed = Math.min(days, Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))));
    const total = sprintPointsTotal || 1;
    const expectedDaily = total / days;
    const actualDaily = daysElapsed > 0 ? sprintPointsDone / daysElapsed : 0;
    const data: Array<{ day: string; expected: number; actual: number }> = [];
    for (let i = 0; i <= days; i++) {
      const expectedRemaining = Math.max(0, total - expectedDaily * i);
      const actualRemaining = Math.max(0, total - actualDaily * i);
      data.push({
        day: `Day ${i + 1}`,
        expected: Number(expectedRemaining.toFixed(1)),
        actual: Number(actualRemaining.toFixed(1)),
      });
    }
    return data;
  }, [sprintForCharts, sprintPointsTotal, sprintPointsDone]);

  const velocityData = React.useMemo(() => {
    const sorted = [...sprints].sort((a, b) => (b.endDate ?? 0) - (a.endDate ?? 0)).slice(0, 5);
    return sorted.map((s) => {
      const relatedStories = stories.filter((st) => st.sprintId === s.id);
      const totalPts = relatedStories.reduce((sum, st) => sum + (st.points || 0), 0);
      const donePts = relatedStories.filter((st) => st.status === 4).reduce((sum, st) => sum + (st.points || 0), 0);
      const days = Math.max(1, Math.ceil((Number(s.endDate) - Number(s.startDate)) / (1000 * 60 * 60 * 24)));
      const velocity = donePts / days;
      return {
        name: s.name || s.id,
        velocity: Number(velocity.toFixed(2)),
        done: donePts,
        total: totalPts,
      };
    });
  }, [sprints, stories]);

  // Load real data from Firebase
  useEffect(() => {
    if (!currentUser || !currentPersona) return;

    let unsubscribeGoals: (() => void) | undefined;
    let unsubscribeStories: (() => void) | undefined;
    let unsubscribeTasks: (() => void) | undefined;

    try {
      // Load goals with error handling
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );

      unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Goal[];
        setGoals(goalsData);
      }, (error) => {
        console.error('Goals subscription error:', error);
      });

      // Load stories with simplified query
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );

      unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Story[];
        setStories(storiesData);
      }, (error) => {
        console.error('Stories subscription error:', error);
      });

      // Load tasks with simplified query
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );

      unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
        const tasksData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        setTasks(tasksData);
      }, (error) => {
        console.error('Tasks subscription error:', error);
      });

    } catch (error) {
      console.error('Error setting up subscriptions:', error);
    }

    return () => {
      try {
        unsubscribeGoals?.();
        unsubscribeStories?.();
        unsubscribeTasks?.();
      } catch (error) {
        console.error('Error cleaning up subscriptions:', error);
      }
    };
  }, [currentUser, currentPersona]);

  useEffect(() => {
    if (location.pathname.includes('/sprints/management/burndown')) {
      setActiveTab('burndown');
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!sprints.length) return;
    if (selectedSprintId && sprintsById[selectedSprintId]) return;
    const activeSprint = sprints.find((s) => (s.status ?? 0) === 1) || sprints[0];
    // Respect explicit "All Sprints" (empty string). Only auto-select if truly unset.
    if ((selectedSprintId as any) === undefined || (selectedSprintId as any) === null) {
      if (activeSprint) setSelectedSprintId(activeSprint.id);
    }
  }, [sprints, selectedSprintId, sprintsById, setSelectedSprintId]);

  // Helper functions
  const getGoalTitle = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.title : 'Unknown Goal';
  };

  const getThemeColor = (theme: number) => {
    const colors = {
      1: 'success', // Health
      2: 'info',    // Growth
      3: 'warning', // Wealth
      4: 'primary', // Tribe
      5: 'secondary' // Home
    };
    return colors[theme as keyof typeof colors] || 'secondary';
  };

  const getTasksForStory = (storyId: string) => {
    return tasks.filter(task => task.parentType === 'story' && task.parentId === storyId);
  };

  const getSprintStories = () => {
    if (!selectedSprint) return [];
    return stories.filter(story => story.sprintId === selectedSprint.id);
  };

  // Task management functions
  const handleStoryClick = (story: Story) => {
    setSelectedStory(selectedStory?.id === story.id ? null : story);
  };

  const updateTaskStatus = async (taskId: string, status: number) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status: status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  const updateStoryStatus = async (storyId: string, status: number) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        status: status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating story status:', error);
    }
  };

  const addTask = async () => {
    if (!currentUser || !selectedStory || !newTask.title.trim()) return;

    try {
      const taskRef = generateRef('task', []);
      const estimateMin = newTask.estimatedHours !== undefined
        ? Math.max(5, Math.round(newTask.estimatedHours * 60))
        : (newTask.effort === 'S' ? 30 : newTask.effort === 'M' ? 120 : 480);
      const estimatedHours = newTask.estimatedHours !== undefined
        ? Math.round(newTask.estimatedHours * 100) / 100
        : Math.round((estimateMin / 60) * 100) / 100;

      await addDoc(collection(db, 'tasks'), {
        ref: taskRef,
        title: newTask.title,
        description: newTask.description,
        parentType: 'story',
        parentId: selectedStory.id,
        status: 0, // To Do
        priority: newTask.priority,
        effort: newTask.effort,
        estimateMin,
        estimatedHours,
        persona: currentPersona,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        alignedToGoal: true,
        theme: stories.find(s => s.id === selectedStory.id)?.theme || 1,
        source: 'web',
        aiLinkConfidence: 1.0
      });

      // Reset form
      setNewTask({
        title: '',
        description: '',
        effort: 'M',
        priority: 2,
        estimatedHours: 1
      });
      setShowAddTask(false);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  };

  const handleCreateSprint = async () => {
    if (!currentUser) return;
    if (!newSprint.name.trim() || !newSprint.startDate || !newSprint.endDate) {
      alert('Please provide a name, start date, and end date.');
      return;
    }
    try {
      await addDoc(collection(db, 'sprints'), {
        name: newSprint.name.trim(),
        objective: newSprint.objective.trim(),
        notes: newSprint.notes.trim(),
        startDate: new Date(newSprint.startDate).getTime(),
        endDate: new Date(newSprint.endDate).getTime(),
        planningDate: new Date(newSprint.startDate).getTime(),
        retroDate: new Date(newSprint.endDate).getTime(),
        status: 0,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowSprintModal(false);
      setNewSprint({ name: '', objective: '', startDate: '', endDate: '', notes: '' });
    } catch (error) {
      console.error('Error creating sprint:', error);
      alert('Failed to create sprint.');
    }
  };

  const handleSaveRetrospective = async () => {
    if (!currentUser || !selectedSprintId) return;
    try {
      await addDoc(collection(db, 'sprint_retros'), {
        sprintId: selectedSprintId,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        ...retrospectiveNotes,
        updatedAt: serverTimestamp(),
      });
      alert('Retrospective saved.');
    } catch (error) {
      console.error('Error saving retrospective:', error);
      alert('Failed to save retrospective.');
    }
  };

  const deleteTask = async (taskId: string) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteDoc(doc(db, 'tasks', taskId));
      } catch (error) {
        console.error('Error deleting task:', error);
      }
    }
  };

  // Swim lanes for kanban board
  const swimLanes = [
    { id: 'backlog', title: 'Backlog', status: 0 },
    { id: 'in-progress', title: 'In Progress', status: 2 },
    { id: 'done', title: 'Done', status: 4 }
  ];

  return (
    <Container fluid className="sprint-management">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Sprint Management</h2>
            <div className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setActiveTab('overview')}
                className={activeTab === 'overview' ? 'active' : ''}
              >
                Overview
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setActiveTab('table')}
                className={activeTab === 'table' ? 'active' : ''}
              >
                Table View
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setActiveTab('board')}
                className={activeTab === 'board' ? 'active' : ''}
              >
                Sprint Board
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setActiveTab('burndown')}
                className={activeTab === 'burndown' ? 'active' : ''}
              >
                Burndown
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setActiveTab('retrospective')}
                className={activeTab === 'retrospective' ? 'active' : ''}
              >
                Retrospective
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowSprintModal(true)}
              >
                <Plus size={16} className="me-1" />
                New Sprint
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* Sprint Selector */}
      {sprints.length > 0 && (
        <Row className="mb-4">
          <Col>
            <Card>
              <Card.Header>
                <h5 className="mb-0">Active Sprint</h5>
              </Card.Header>
              <Card.Body>
                <Row className="align-items-center">
                  <Col md={4}>
                    <Form.Select
                      value={selectedSprintId || ''}
                      onChange={(e) => {
                        const sprint = sprints.find(s => s.id === e.target.value);
                        setSelectedSprintId(sprint?.id || '');
                        setSelectedStory(null); // Reset selected story when switching sprints
                      }}
                    >
                      <option value="">Select a sprint...</option>
                      {sprints.map(sprint => (
                        <option key={sprint.id} value={sprint.id}>
                          {sprint.name} ({getStatusName(sprint.status)})
                        </option>
                      ))}
                    </Form.Select>
                  </Col>
                  {selectedSprint && (
                    <Col md={8}>
                      <div className="d-flex justify-content-between align-items-center">
                        <div>
                          <Badge bg={getThemeColor(1)} className="me-2">
                            {getStatusName(selectedSprint.status)}
                          </Badge>
                          <span className="text-muted">
                            {new Date(selectedSprint.startDate).toLocaleDateString()} - {new Date(selectedSprint.endDate).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="text-end">
                          <small className="text-muted d-block">
                            {getSprintStories().length} stories • {getSprintStories().reduce((sum, s) => sum + (s.points || 0), 0)} points
                          </small>
                        </div>
                      </div>
                    </Col>
                  )}
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Sprint Metrics Panel - Enhanced */}
      {selectedSprint && (
        <SprintMetricsPanel
          sprint={selectedSprint}
          stories={stories.filter(s => s.sprintId === selectedSprint.id)}
          tasks={tasks}
          goals={goals}
        />
      )}

      {/* Empty state when no sprints */}
      {sprints.length === 0 && (
        <Row>
          <Col>
            <Card className="text-center">
              <Card.Body className="py-5">
                <Calendar size={48} className="text-muted mb-3" />
                <h5>No Sprints Found</h5>
                <p className="text-muted mb-4">Create your first sprint to start organizing your stories and tasks.</p>
                <Button variant="primary" onClick={() => setShowSprintModal(true)}>
                  <Plus size={16} className="me-1" />
                  Create First Sprint
                </Button>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Sprint Table Tab - Modern table with CRUD operations */}
      {activeTab === 'table' && (
        <Row>
          <Col>
            <ModernSprintsTable
              selectedSprintId={selectedSprintId || undefined}
              onSprintSelect={(sprintId) => {
                setSelectedSprintId(sprintId || '');
              }}
              onSprintChange={(sprint) => {
                if (selectedSprintId === sprint.id) {
                  setSelectedSprintId(sprint.id);
                }
              }}
            />
          </Col>
        </Row>
      )}

      {/* Sprint Board Tab - now mirrors the dedicated Kanban page */}
      {activeTab === 'board' && (
        <Row>
          <Col>
            <SprintKanbanPageV2 />
          </Col>
        </Row>
      )}

      {/* Other tabs can be implemented later */}
      {activeTab === 'overview' && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <h5>Sprint Overview</h5>
              </Card.Header>
              <Card.Body>
                <Row>
                  <Col md={6} className="mb-3">
                    <h6 className="mb-2">Burndown</h6>
                    {burndownData.length > 0 ? (
                      <div style={{ width: '100%', height: 260 }}>
                        <ResponsiveContainer>
                          <LineChart data={burndownData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="day" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="expected" stroke="#8884d8" name="Expected remaining" />
                            <Line type="monotone" dataKey="actual" stroke="#82ca9d" name="Actual remaining" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="text-muted">Select a sprint to see burndown.</div>
                    )}
                  </Col>
                  <Col md={6} className="mb-3">
                    <h6 className="mb-2">Velocity Trend (pts/day)</h6>
                    {velocityData.length > 0 ? (
                      <div style={{ width: '100%', height: 260 }}>
                        <ResponsiveContainer>
                          <BarChart data={velocityData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="velocity" fill="#2563eb" name="Velocity" />
                            <Bar dataKey="done" fill="#16a34a" name="Points done" />
                            <Bar dataKey="total" fill="#9ca3af" name="Total points" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="text-muted">No sprint history yet.</div>
                    )}
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {activeTab === 'burndown' && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <h5>Burndown Chart</h5>
              </Card.Header>
              <Card.Body>
                <Row>
                  <Col md={6} className="mb-3">
                    {burndownData.length > 0 ? (
                      <div style={{ width: '100%', height: 320 }}>
                        <ResponsiveContainer>
                          <LineChart data={burndownData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="day" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="expected" stroke="#8884d8" name="Expected remaining" />
                            <Line type="monotone" dataKey="actual" stroke="#82ca9d" name="Actual remaining" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="text-muted text-center py-4">Select a sprint to view burndown.</div>
                    )}
                  </Col>
                  <Col md={6} className="mb-3">
                    <h6 className="mb-2">Velocity (points/day)</h6>
                    {velocityData.length > 0 ? (
                      <div style={{ width: '100%', height: 320 }}>
                        <ResponsiveContainer>
                          <BarChart data={velocityData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="velocity" fill="#2563eb" name="Velocity" />
                            <Bar dataKey="done" fill="#16a34a" name="Points done" />
                            <Bar dataKey="total" fill="#9ca3af" name="Total points" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="text-muted text-center py-4">No sprint history yet.</div>
                    )}
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {activeTab === 'retrospective' && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <h5>Sprint Retrospective</h5>
              </Card.Header>
              <Card.Body>
                <Form>
                  <Form.Group className="mb-3">
                    <Form.Label>What went well</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={retrospectiveNotes.wentWell}
                      onChange={(e) => setRetrospectiveNotes({ ...retrospectiveNotes, wentWell: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>What to improve</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={retrospectiveNotes.toImprove}
                      onChange={(e) => setRetrospectiveNotes({ ...retrospectiveNotes, toImprove: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Actions</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={retrospectiveNotes.actions}
                      onChange={(e) => setRetrospectiveNotes({ ...retrospectiveNotes, actions: e.target.value })}
                    />
                  </Form.Group>
                  <Button onClick={handleSaveRetrospective}>
                    Save Retrospective
                  </Button>
                </Form>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Add Task Modal */}
      <Modal show={showAddTask} onHide={() => setShowAddTask(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add Task to {selectedStory?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Task Title *</Form.Label>
              <Form.Control
                type="text"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder="Enter task title"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder="Optional task description"
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Effort</Form.Label>
                  <Form.Select
                    value={newTask.effort}
                    onChange={(e) => setNewTask({ ...newTask, effort: e.target.value as 'S' | 'M' | 'L' })}
                  >
                    <option value="S">Small (0.5-2 hours)</option>
                    <option value="M">Medium (2-8 hours)</option>
                    <option value="L">Large (8+ hours)</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: parseInt(e.target.value) as 1 | 2 | 3 })}
                  >
                    <option value={1}>P1 (High)</option>
                    <option value={2}>P2 (Medium)</option>
                    <option value={3}>P3 (Low)</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddTask(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={addTask}
            disabled={!newTask.title.trim()}
          >
            Add Task
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Sprint Modal */}
      <Modal show={showSprintModal} onHide={() => setShowSprintModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create New Sprint</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Sprint Name *</Form.Label>
              <Form.Control
                type="text"
                value={newSprint.name}
                onChange={(e) => setNewSprint({ ...newSprint, name: e.target.value })}
                placeholder="Sprint 41 (Work in Progress)"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Objective</Form.Label>
              <Form.Control
                type="text"
                value={newSprint.objective}
                onChange={(e) => setNewSprint({ ...newSprint, objective: e.target.value })}
                placeholder="Goal or theme for this sprint"
              />
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Start Date *</Form.Label>
                  <Form.Control
                    type="date"
                    value={newSprint.startDate}
                    onChange={(e) => setNewSprint({ ...newSprint, startDate: e.target.value })}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>End Date *</Form.Label>
                  <Form.Control
                    type="date"
                    value={newSprint.endDate}
                    onChange={(e) => setNewSprint({ ...newSprint, endDate: e.target.value })}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3">
              <Form.Label>Notes</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={newSprint.notes}
                onChange={(e) => setNewSprint({ ...newSprint, notes: e.target.value })}
                placeholder="Any additional context"
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSprintModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreateSprint}>
            Create Sprint
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default SprintManagementView;
