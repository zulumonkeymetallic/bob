import React, { useState, useEffect } from 'react';
import { Container, Table, Badge, Button, Form, Row, Col, Modal, InputGroup, Dropdown, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Task, Goal, Story, WorkProject, Sprint } from '../types';

interface TaskWithContext extends Task {
  referenceNumber?: string;
  storyTitle?: string;
  goalTitle?: string;
  sprintName?: string;
}

const TasksList: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [tasks, setTasks] = useState<TaskWithContext[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [projects, setProjects] = useState<WorkProject[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<TaskWithContext[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showEditTask, setShowEditTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskWithContext | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    effort: '',
    hasGoal: '',
    search: ''
  });

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'med' as 'low' | 'med' | 'high',
    effort: 'M' as 'S' | 'M' | 'L',
    parentType: 'story' as 'story' | 'project',
    parentId: '',
    theme: 'Health' as 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home',
    status: 'planned' as 'planned' | 'in_progress' | 'done'
  });

  const [editingField, setEditingField] = useState<{taskId: string, field: string, value: any} | null>(null);

  // Generate reference number for task
  const generateReferenceNumber = (task: Task, index: number): string => {
    const personaPrefix = currentPersona === 'personal' ? 'P' : 'W';
    const typePrefix = 'T'; // Task
    const number = String(index + 1).padStart(3, '0');
    return `${personaPrefix}${typePrefix}${number}`;
  };

  // Load data based on current persona
  useEffect(() => {
    if (!currentUser) return;

    // Load tasks for current persona
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData: Task[] = [];
      snapshot.forEach((doc) => {
        tasksData.push({ id: doc.id, ...doc.data() } as Task);
      });
      
      // Add reference numbers and context
      const tasksWithContext = tasksData.map((task, index) => ({
        ...task,
        referenceNumber: generateReferenceNumber(task, index),
        storyTitle: stories.find(s => s.id === task.storyId)?.title || '',
        goalTitle: goals.find(g => g.id === task.goalId)?.title || '',
        sprintName: sprints.find(s => s.id === task.sprintId)?.name || ''
      }));
      
      setTasks(tasksWithContext);
    });

    // Load parent entities
    if (currentPersona === 'personal') {
      // Load goals and stories for personal
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid)
      );
      
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );

      const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData: Goal[] = [];
        snapshot.forEach((doc) => {
          goalsData.push({ id: doc.id, ...doc.data() } as Goal);
        });
        setGoals(goalsData);
      });

      const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData: Story[] = [];
        snapshot.forEach((doc) => {
          storiesData.push({ id: doc.id, ...doc.data() } as Story);
        });
        setStories(storiesData);
      });

      return () => {
        unsubscribeTasks();
        unsubscribeGoals();
        unsubscribeStories();
      };
    } else {
      // Load projects for work
      const projectsQuery = query(
        collection(db, 'projects'),
        where('ownerUid', '==', currentUser.uid)
      );

      const unsubscribeProjects = onSnapshot(projectsQuery, (snapshot) => {
        const projectsData: WorkProject[] = [];
        snapshot.forEach((doc) => {
          projectsData.push({ id: doc.id, ...doc.data() } as WorkProject);
        });
        setProjects(projectsData);
      });

      return () => {
        unsubscribeTasks();
        unsubscribeProjects();
      };
    }
  }, [currentUser, currentPersona, stories, goals, sprints]);

  // Load sprints
  useEffect(() => {
    if (!currentUser) return;

    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData: Sprint[] = [];
      snapshot.forEach((doc) => {
        sprintsData.push({ id: doc.id, ...doc.data() } as Sprint);
      });
      setSprints(sprintsData);
    });

    return unsubscribe;
  }, [currentUser]);

  // Apply filters
  useEffect(() => {
    let filtered = tasks;

    if (filters.status) {
      filtered = filtered.filter(task => task.status === filters.status);
    }

    if (filters.priority) {
      filtered = filtered.filter(task => task.priority === filters.priority);
    }

    if (filters.effort) {
      filtered = filtered.filter(task => task.effort === filters.effort);
    }

    if (filters.hasGoal) {
      if (filters.hasGoal === 'yes') {
        filtered = filtered.filter(task => task.goalId);
      } else if (filters.hasGoal === 'no') {
        filtered = filtered.filter(task => !task.goalId);
      }
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(task => 
        task.title.toLowerCase().includes(searchLower) ||
        task.description?.toLowerCase().includes(searchLower) ||
        task.referenceNumber?.toLowerCase().includes(searchLower)
      );
    }

    setFilteredTasks(filtered);
  }, [tasks, filters]);

  const handleAddTask = async () => {
    if (!currentUser || !newTask.title.trim()) return;

    try {
      await addDoc(collection(db, 'tasks'), {
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
        effort: newTask.effort,
        status: newTask.status,
        theme: newTask.theme,
        persona: currentPersona,
        ownerUid: currentUser.uid,
        storyId: newTask.parentType === 'story' ? newTask.parentId : null,
        projectId: newTask.parentType === 'project' ? newTask.parentId : null,
        sprintId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setNewTask({
        title: '',
        description: '',
        priority: 'med',
        effort: 'M',
        parentType: currentPersona === 'personal' ? 'story' : 'project',
        parentId: '',
        theme: 'Health',
        status: 'planned'
      });
      setShowAddTask(false);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    if (!currentUser) return;

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!currentUser) return;
    
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteDoc(doc(db, 'tasks', taskId));
      } catch (error) {
        console.error('Error deleting task:', error);
      }
    }
  };

  // Quick edit functions
  const handleQuickStatusChange = async (taskId: string, newStatus: string) => {
    await handleUpdateTask(taskId, { status: newStatus as any });
  };

  const handleQuickSprintAssign = async (taskId: string, sprintId: string) => {
    await handleUpdateTask(taskId, { sprintId: sprintId || null });
  };

  const handleQuickPriorityChange = async (taskId: string, priority: string) => {
    await handleUpdateTask(taskId, { priority: priority as any });
  };

  const handleRowClick = (task: TaskWithContext) => {
    setSelectedRowId(task.id === selectedRowId ? null : task.id);
  };

  const handleEditTask = (task: TaskWithContext) => {
    setSelectedTask(task);
    setShowEditTask(true);
  };

  const handleSaveEditTask = async () => {
    if (!selectedTask || !currentUser) return;

    try {
      await updateDoc(doc(db, 'tasks', selectedTask.id), {
        title: selectedTask.title,
        description: selectedTask.description,
        priority: selectedTask.priority,
        effort: selectedTask.effort,
        status: selectedTask.status,
        theme: selectedTask.theme,
        storyId: selectedTask.storyId || null,
        projectId: selectedTask.projectId || null,
        sprintId: selectedTask.sprintId || null,
        updatedAt: serverTimestamp()
      });

      setShowEditTask(false);
      setSelectedTask(null);
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const getBadgeVariant = (status: string) => {
    switch (status) {
      case 'done': return 'success';
      case 'in_progress': return 'primary';
      case 'planned': return 'secondary';
      default: return 'secondary';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'danger';
      case 'med': return 'warning';
      case 'low': return 'info';
      default: return 'secondary';
    }
  };

  if (currentPersona !== 'personal' && currentPersona !== 'work') {
    return (
      <Container className="mt-4">
        <Alert variant="info">
          Tasks are only available in Personal and Work personas. Please switch your persona to view tasks.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2>📋 Tasks Management</h2>
          <p className="text-muted">
            {filteredTasks.length} of {tasks.length} tasks • {currentPersona} persona
            {selectedRowId && (
              <span className="ms-2">
                <Badge bg="info">Row selected</Badge>
              </span>
            )}
          </p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="primary" onClick={() => setShowAddTask(true)}>
            + Add Task
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Row className="mb-4">
        <Col md={2}>
          <Form.Select 
            value={filters.status} 
            onChange={(e) => setFilters({...filters, status: e.target.value})}
            size="sm"
          >
            <option value="">All Statuses</option>
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select 
            value={filters.priority} 
            onChange={(e) => setFilters({...filters, priority: e.target.value})}
            size="sm"
          >
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="med">Medium</option>
            <option value="low">Low</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select 
            value={filters.effort} 
            onChange={(e) => setFilters({...filters, effort: e.target.value})}
            size="sm"
          >
            <option value="">All Efforts</option>
            <option value="S">Small</option>
            <option value="M">Medium</option>
            <option value="L">Large</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select 
            value={filters.hasGoal} 
            onChange={(e) => setFilters({...filters, hasGoal: e.target.value})}
            size="sm"
          >
            <option value="">All Tasks</option>
            <option value="yes">With Goals</option>
            <option value="no">Without Goals</option>
          </Form.Select>
        </Col>
        <Col md={4}>
          <InputGroup size="sm">
            <Form.Control
              type="text"
              placeholder="Search tasks, descriptions, or reference numbers..."
              value={filters.search}
              onChange={(e) => setFilters({...filters, search: e.target.value})}
            />
            <Button variant="outline-secondary" onClick={() => setFilters({...filters, search: ''})}>
              Clear
            </Button>
          </InputGroup>
        </Col>
      </Row>

      {/* Tasks Table */}
      <div className="table-responsive">
        <Table striped bordered hover size="sm">
          <thead className="table-dark">
            <tr>
              <th>Ref#</th>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Effort</th>
              <th>Parent</th>
              <th>Sprint</th>
              <th>Theme</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map((task) => (
              <tr 
                key={task.id}
                className={selectedRowId === task.id ? 'table-active' : ''}
                style={{ cursor: 'pointer' }}
              >
                <td onClick={() => handleRowClick(task)}>
                  <code className="text-primary">{task.referenceNumber}</code>
                </td>
                <td onClick={() => handleRowClick(task)}>
                  <strong>{task.title}</strong>
                  {task.description && (
                    <div className="text-muted small">{task.description.substring(0, 100)}...</div>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <Dropdown>
                    <Dropdown.Toggle as={Badge} bg={getBadgeVariant(task.status)} style={{ cursor: 'pointer' }}>
                      {task.status.replace('-', ' ').toUpperCase()}
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => handleQuickStatusChange(task.id, 'planned')}>
                        Planned
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleQuickStatusChange(task.id, 'in_progress')}>
                        In Progress
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleQuickStatusChange(task.id, 'done')}>
                        Done
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <Dropdown>
                    <Dropdown.Toggle as={Badge} bg={getPriorityColor(task.priority)} style={{ cursor: 'pointer' }}>
                      {task.priority.toUpperCase()}
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => handleQuickPriorityChange(task.id, 'high')}>
                        High
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleQuickPriorityChange(task.id, 'med')}>
                        Medium
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleQuickPriorityChange(task.id, 'low')}>
                        Low
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </td>
                <td onClick={() => handleRowClick(task)}>
                  <Badge bg="info">{task.effort}</Badge>
                </td>
                <td onClick={() => handleRowClick(task)}>
                  <small className="text-muted">
                    {task.storyTitle || task.projectId || 'None'}
                  </small>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <Dropdown>
                    <Dropdown.Toggle variant="link" size="sm" className="p-0">
                      {task.sprintName || 'No Sprint'}
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => handleQuickSprintAssign(task.id, '')}>
                        No Sprint
                      </Dropdown.Item>
                      {sprints.map(sprint => (
                        <Dropdown.Item 
                          key={sprint.id}
                          onClick={() => handleQuickSprintAssign(task.id, sprint.id)}
                        >
                          {sprint.name}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown>
                </td>
                <td onClick={() => handleRowClick(task)}>
                  <Badge bg="secondary">{task.theme}</Badge>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="d-flex gap-1">
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => handleEditTask(task)}
                      title="Edit Task"
                    >
                      <i className="fas fa-edit"></i>
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDeleteTask(task.id)}
                      title="Delete Task"
                    >
                      <i className="fas fa-trash"></i>
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {filteredTasks.length === 0 && (
        <div className="text-center py-5">
          <i className="fas fa-tasks fa-3x text-muted mb-3"></i>
          <h5 className="text-muted">No tasks found</h5>
          <p className="text-muted">
            {tasks.length === 0 
              ? "Create your first task to get started" 
              : "Try adjusting your filters"
            }
          </p>
        </div>
      )}

      {/* Add Task Modal */}
      <Modal show={showAddTask} onHide={() => setShowAddTask(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Add New Task</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={8}>
                <Form.Group className="mb-3">
                  <Form.Label>Title</Form.Label>
                  <Form.Control
                    type="text"
                    value={newTask.title}
                    onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                    placeholder="Enter task title"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Theme</Form.Label>
                  <Form.Select
                    value={newTask.theme}
                    onChange={(e) => setNewTask({...newTask, theme: e.target.value as any})}
                  >
                    <option value="Health">Health</option>
                    <option value="Growth">Growth</option>
                    <option value="Wealth">Wealth</option>
                    <option value="Tribe">Tribe</option>
                    <option value="Home">Home</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={newTask.description}
                onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                placeholder="Enter task description"
              />
            </Form.Group>

            <Row>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({...newTask, priority: e.target.value as any})}
                  >
                    <option value="high">High</option>
                    <option value="med">Medium</option>
                    <option value="low">Low</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Effort</Form.Label>
                  <Form.Select
                    value={newTask.effort}
                    onChange={(e) => setNewTask({...newTask, effort: e.target.value as any})}
                  >
                    <option value="S">Small</option>
                    <option value="M">Medium</option>
                    <option value="L">Large</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Status</Form.Label>
                  <Form.Select
                    value={newTask.status}
                    onChange={(e) => setNewTask({...newTask, status: e.target.value as any})}
                  >
                    <option value="planned">Planned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Parent Type</Form.Label>
                  <Form.Select
                    value={newTask.parentType}
                    onChange={(e) => setNewTask({...newTask, parentType: e.target.value as any, parentId: ''})}
                  >
                    {currentPersona === 'personal' && <option value="story">Story</option>}
                    {currentPersona === 'work' && <option value="project">Project</option>}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>Parent {newTask.parentType}</Form.Label>
              <Form.Select
                value={newTask.parentId}
                onChange={(e) => setNewTask({...newTask, parentId: e.target.value})}
              >
                <option value="">Select {newTask.parentType}</option>
                {newTask.parentType === 'story' ? 
                  stories.map(story => (
                    <option key={story.id} value={story.id}>{story.title}</option>
                  )) :
                  projects.map(project => (
                    <option key={project.id} value={project.id}>{project.title}</option>
                  ))
                }
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddTask(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleAddTask}>
            Add Task
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Task Modal */}
      <Modal show={showEditTask} onHide={() => setShowEditTask(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            Edit Task: {selectedTask?.referenceNumber}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedTask && (
            <Form>
              <Row>
                <Col md={8}>
                  <Form.Group className="mb-3">
                    <Form.Label>Title</Form.Label>
                    <Form.Control
                      type="text"
                      value={selectedTask.title}
                      onChange={(e) => setSelectedTask({...selectedTask, title: e.target.value})}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Theme</Form.Label>
                    <Form.Select
                      value={selectedTask.theme}
                      onChange={(e) => setSelectedTask({...selectedTask, theme: e.target.value as any})}
                    >
                      <option value="Health">Health</option>
                      <option value="Growth">Growth</option>
                      <option value="Wealth">Wealth</option>
                      <option value="Tribe">Tribe</option>
                      <option value="Home">Home</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={selectedTask.description || ''}
                  onChange={(e) => setSelectedTask({...selectedTask, description: e.target.value})}
                />
              </Form.Group>

              <Row>
                <Col md={3}>
                  <Form.Group className="mb-3">
                    <Form.Label>Priority</Form.Label>
                    <Form.Select
                      value={selectedTask.priority}
                      onChange={(e) => setSelectedTask({...selectedTask, priority: e.target.value as any})}
                    >
                      <option value="high">High</option>
                      <option value="med">Medium</option>
                      <option value="low">Low</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group className="mb-3">
                    <Form.Label>Effort</Form.Label>
                    <Form.Select
                      value={selectedTask.effort}
                      onChange={(e) => setSelectedTask({...selectedTask, effort: e.target.value as any})}
                    >
                      <option value="S">Small</option>
                      <option value="M">Medium</option>
                      <option value="L">Large</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group className="mb-3">
                    <Form.Label>Status</Form.Label>
                    <Form.Select
                      value={selectedTask.status}
                      onChange={(e) => setSelectedTask({...selectedTask, status: e.target.value as any})}
                    >
                      <option value="planned">Planned</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group className="mb-3">
                    <Form.Label>Sprint</Form.Label>
                    <Form.Select
                      value={selectedTask.sprintId || ''}
                      onChange={(e) => setSelectedTask({...selectedTask, sprintId: e.target.value || null})}
                    >
                      <option value="">No Sprint</option>
                      {sprints.map(sprint => (
                        <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEditTask(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveEditTask}>
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default TasksList;

export {};
