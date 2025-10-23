import React, { useState, useEffect } from 'react';
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
import { collection, query, where, onSnapshot, updateDoc, doc, addDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { Story, Goal, Task, Sprint } from '../../types';
import { generateRef } from '../../utils/referenceGenerator';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '../../utils/statusHelpers';
import { useSprint } from '../../contexts/SprintContext';

// BOB v3.5.6 - Sprint Management with Database Integration
// Replaces /kanban route with comprehensive sprint management

const SprintManagementView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  const { selectedSprintId, setSelectedSprintId } = useSprint();
  
  // State management
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [showSprintModal, setShowSprintModal] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'board' | 'burndown' | 'retrospective'>('board');
  
  // New task form
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    effort: 'M' as 'S' | 'M' | 'L',
    priority: 2 as 1 | 2 | 3,
    estimatedHours: 1
  });

  // Load real data from Firebase
  useEffect(() => {
    if (!currentUser) return;

    // Load goals
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

    let storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('orderIndex', 'asc'),
    );
    if (selectedSprintId) {
      storiesQuery = query(storiesQuery, where('sprintId', '==', selectedSprintId));
    }

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storiesData);
    });

    // Load tasks
    let tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc'),
    );
    if (selectedSprintId) {
      tasksQuery = query(tasksQuery, where('sprintId', '==', selectedSprintId));
    }
    
    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(tasksData);
    });

    // Load sprints
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
      
      // Set default selected sprint (most recent active one)
      if (selectedSprintId) {
        const match = sprintsData.find(s => s.id === selectedSprintId);
        if (match) setSelectedSprint(match);
      } else if (sprintsData.length > 0 && !selectedSprint) {
        const activeSprint = sprintsData.find(s => s.status === 1) || sprintsData[0];
        setSelectedSprint(activeSprint);
        if (activeSprint) setSelectedSprintId(activeSprint.id);
      }
    });

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeTasks();
      unsubscribeSprints();
    };
  }, [currentUser, currentPersona, selectedSprintId, setSelectedSprintId, selectedSprint]);

  useEffect(() => {
    if (!selectedSprintId && selectedSprint) {
      setSelectedSprintId(selectedSprint.id);
    }
    if (selectedSprintId && (!selectedSprint || selectedSprint.id !== selectedSprintId)) {
      const sprint = sprints.find(s => s.id === selectedSprintId) || null;
      if (sprint) setSelectedSprint(sprint);
    }
  }, [selectedSprintId, selectedSprint, sprints, setSelectedSprintId]);

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
      const taskRef = generateRef('task', []); // Pass empty array for now, in production this should contain existing refs
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
                      value={selectedSprint?.id || ''}
                      onChange={(e) => {
                        const sprint = sprints.find(s => s.id === e.target.value);
                        setSelectedSprint(sprint || null);
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

      {/* Sprint Board Tab - Database-driven with inline task editing */}
      {activeTab === 'board' && selectedSprint && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <div className="d-flex justify-content-between align-items-center">
                  <h5>{selectedSprint.name} - Sprint Board</h5>
                  <div>
                    <span className="text-muted me-3">
                      {getSprintStories().length} stories • {getSprintStories().reduce((sum, s) => sum + (s.points || 0), 0)} points
                    </span>
                  </div>
                </div>
              </Card.Header>
              <Card.Body>
                <Row>
                  {swimLanes.map((lane) => (
                    <Col key={lane.id} lg={2} md={3} sm={6}>
                      <Card className="h-100">
                        <Card.Header className="bg-light">
                          <h6 className="mb-0">{lane.title}</h6>
                          <small className="text-muted">
                            {getSprintStories().filter(s => s.status === lane.status).length} stories
                          </small>
                        </Card.Header>
                        <Card.Body style={{ maxHeight: '600px', overflowY: 'auto', padding: '10px' }}>
                          {getSprintStories()
                            .filter(story => story.status === lane.status)
                            .map((story) => {
                              const goal = goals.find(g => g.id === story.goalId);
                              const storyTasks = getTasksForStory(story.id);
                              const isSelected = selectedStory?.id === story.id;
                              
                              return (
                                <Card 
                                  key={story.id}
                                  className={`mb-3 shadow-sm ${isSelected ? 'border-primary' : ''}`}
                                  style={{ cursor: 'pointer', fontSize: '14px' }}
                                  onClick={() => handleStoryClick(story)}
                                >
                                  <Card.Body className="p-3">
                                    <div className="d-flex justify-content-between align-items-start mb-2">
                                      <div className="flex-grow-1">
                                        <div className="d-flex align-items-center gap-2 mb-1">
                                          <span style={{ fontSize: '11px', fontWeight: '600', color: '#6b7280' }}>
                                            {story.ref || `STRY-${story.id.slice(-3).toUpperCase()}`}
                                          </span>
                                        </div>
                                        <h6 className="mb-0" style={{ fontSize: '14px', lineHeight: '1.2' }}>
                                          {story.title}
                                        </h6>
                                      </div>
                                      <div className="d-flex flex-column gap-1 align-items-end">
                                        <Badge bg={getThemeColor(story.theme || 1)} style={{ fontSize: '10px' }}>
                                          {getThemeName(story.theme || 1)}
                                        </Badge>
                                        <Badge bg="secondary" style={{ fontSize: '10px' }}>
                                          P{story.priority}
                                        </Badge>
                                      </div>
                                    </div>
                                    
                                    {goal && (
                                      <small className="text-muted d-block mb-2">
                                        Goal: {goal.title}
                                      </small>
                                    )}

                                    {story.description && (
                                      <p className="small text-muted mb-2" style={{ fontSize: '12px' }}>
                                        {story.description.length > 60 
                                          ? `${story.description.substring(0, 60)}...` 
                                          : story.description
                                        }
                                      </p>
                                    )}

                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                      <small className="text-info">
                                        {storyTasks.length} tasks • {story.points} pts
                                      </small>
                                      {isSelected && (
                                        <Badge bg="primary" style={{ fontSize: '10px' }}>Selected</Badge>
                                      )}
                                    </div>

                                    {/* Progress bar for tasks */}
                                    {storyTasks.length > 0 && (
                                      <div className="mb-2">
                                        <ProgressBar 
                                          now={storyTasks.length > 0 ? (storyTasks.filter(t => t.status === 2).length / storyTasks.length) * 100 : 0}
                                          variant="success"
                                          style={{ height: '4px' }}
                                        />
                                      </div>
                                    )}

                                    {/* Actions */}
                                    <div className="d-flex justify-content-between align-items-center">
                                      <small className="text-muted">
                                        Click to {isSelected ? 'hide' : 'show'} tasks
                                      </small>
                                      <div>
                                        <Dropdown>
                                          <Dropdown.Toggle 
                                            size="sm" 
                                            variant="outline-secondary"
                                            style={{ fontSize: '11px', padding: '2px 6px' }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            Move
                                          </Dropdown.Toggle>
                                          <Dropdown.Menu>
                                            {swimLanes.map(swimLane => (
                                              <Dropdown.Item 
                                                key={swimLane.id}
                                                onClick={(e) => { 
                                                  e.stopPropagation(); 
                                                  updateStoryStatus(story.id, swimLane.status); 
                                                }}
                                              >
                                                {swimLane.title}
                                              </Dropdown.Item>
                                            ))}
                                          </Dropdown.Menu>
                                        </Dropdown>
                                      </div>
                                    </div>
                                  </Card.Body>
                                </Card>
                              );
                            })}

                          {getSprintStories().filter(s => s.status === lane.status).length === 0 && (
                            <div className="text-center text-muted py-4">
                              <p style={{ fontSize: '12px' }}>No stories in {lane.title.toLowerCase()}</p>
                            </div>
                          )}
                        </Card.Body>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Inline Task Management for Selected Story */}
      {selectedStory && activeTab === 'board' && (
        <Row className="mt-4">
          <Col>
            <Card>
              <Card.Header className="d-flex justify-content-between align-items-center">
                <div>
                  <h5 className="mb-0">Tasks for: {selectedStory.title}</h5>
                  <small className="text-muted">
                    {getTasksForStory(selectedStory.id).length} tasks • 
                    Goal: {getGoalTitle(selectedStory.goalId)}
                  </small>
                </div>
                <Button variant="primary" size="sm" onClick={() => setShowAddTask(true)}>
                  <Plus size={14} className="me-1" />
                  Add Task
                </Button>
              </Card.Header>
              <Card.Body>
                {getTasksForStory(selectedStory.id).length === 0 ? (
                  <div className="text-center text-muted py-4">
                    <p>No tasks for this story yet.</p>
                    <Button variant="primary" onClick={() => setShowAddTask(true)}>
                      Add First Task
                    </Button>
                  </div>
                ) : (
                  <Table responsive hover>
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Effort</th>
                        <th>Priority</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTasksForStory(selectedStory.id).map((task) => (
                        <tr 
                          key={task.id} 
                          style={{ cursor: 'pointer' }}
                          onClick={() => showSidebar && showSidebar(task, 'task')}
                        >
                          <td>
                            <div>
                              <strong>{task.title}</strong>
                              {task.description && (
                                <div className="text-muted small">{task.description}</div>
                              )}
                            </div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <Dropdown>
                              <Dropdown.Toggle as={Badge} bg={
                                task.status === 2 ? 'success' : 
                                task.status === 1 ? 'warning' : 
                                task.status === 3 ? 'danger' : 'secondary'
                              } style={{ cursor: 'pointer' }}>
                                {getStatusName(task.status)}
                              </Dropdown.Toggle>
                              <Dropdown.Menu>
                                <Dropdown.Item onClick={() => updateTaskStatus(task.id, 0)}>
                                  To Do
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => updateTaskStatus(task.id, 1)}>
                                  In Progress
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => updateTaskStatus(task.id, 2)}>
                                  Done
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => updateTaskStatus(task.id, 3)}>
                                  Blocked
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown>
                          </td>
                          <td>
                            <Badge bg="outline-dark">
                              {task.effort === 'S' ? 'Small' : task.effort === 'M' ? 'Medium' : 'Large'}
                            </Badge>
                          </td>
                          <td>
                            <Badge bg={
                              task.priority === 1 ? 'danger' : 
                              task.priority === 2 ? 'warning' : 'secondary'
                            }>
                              P{task.priority}
                            </Badge>
                          </td>
                          <td>
                            <Button 
                              size="sm" 
                              variant="outline-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTask(task.id);
                              }}
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card.Body>
            </Card>
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
                <div className="text-center text-muted py-5">
                  <Target size={48} className="mb-3" />
                  <h5>Sprint Overview</h5>
                  <p>Sprint overview features will be implemented here.</p>
                </div>
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
                <div className="text-center text-muted py-5">
                  <BarChart3 size={48} className="mb-3" />
                  <h5>Burndown Chart</h5>
                  <p>Burndown chart visualization will be implemented here.</p>
                </div>
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
                <div className="text-center text-muted py-5">
                  <RotateCcw size={48} className="mb-3" />
                  <h5>Sprint Retrospective</h5>
                  <p>Retrospective features will be implemented here.</p>
                </div>
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
                onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                placeholder="Enter task title"
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={2}
                value={newTask.description}
                onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                placeholder="Optional task description"
              />
            </Form.Group>
            
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Effort</Form.Label>
                  <Form.Select 
                    value={newTask.effort}
                    onChange={(e) => setNewTask({...newTask, effort: e.target.value as 'S' | 'M' | 'L'})}
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
                    onChange={(e) => setNewTask({...newTask, priority: parseInt(e.target.value) as 1 | 2 | 3})}
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

      {/* Sprint Modal placeholder */}
      <Modal show={showSprintModal} onHide={() => setShowSprintModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create New Sprint</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="text-center text-muted py-4">
            <Calendar size={48} className="mb-3" />
            <h5>Sprint Creation</h5>
            <p>Sprint creation form will be implemented here.</p>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSprintModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled>
            Create Sprint
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default SprintManagementView;
