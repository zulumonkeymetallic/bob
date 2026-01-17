import React, { useState, useEffect } from 'react';
import { Container, Table, Badge, Button, Form, Row, Col, Modal } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Task, Goal, Story, WorkProject } from '../types';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '../utils/statusHelpers';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { taskStatusText } from '../utils/storyCardFormatting';

const TasksList: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [projects, setProjects] = useState<WorkProject[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showEditTask, setShowEditTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { themes: globalThemes } = useGlobalThemes();
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    effort: '',
    hasGoal: '',
    search: ''
  });

  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'med' as 'low' | 'med' | 'high',
    effort: 'M' as 'S' | 'M' | 'L',
    parentType: 'story' as 'story' | 'project',
    parentId: '',
    theme: '1',
    estimatedHours: 1
  });

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
      setTasks(tasksData);
    });

    // Load goals (personal only)
    if (currentPersona === 'personal') {
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid)
      );

      const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData: Goal[] = [];
        snapshot.forEach((doc) => {
          goalsData.push({ id: doc.id, ...doc.data() } as Goal);
        });
        setGoals(goalsData);
      });

      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid)
      );

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
      // Load work projects
      const projectsQuery = query(
        collection(db, 'work_projects'),
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
  }, [currentUser, currentPersona]);

  // Apply filters
  useEffect(() => {
    let filtered = tasks;

    if (filters.status) {
      filtered = filtered.filter(task => isStatus(task.status, filters.status));
    }
    if (filters.priority) {
      filtered = filtered.filter(task => isPriority(task.priority, filters.priority));
    }
    if (filters.effort) {
      filtered = filtered.filter(task => task.effort === filters.effort);
    }
    if (filters.hasGoal) {
      filtered = filtered.filter(task => 
        filters.hasGoal === 'true' ? task.hasGoal : !task.hasGoal
      );
    }
    if (filters.search) {
      filtered = filtered.filter(task => 
        task.title.toLowerCase().includes(filters.search.toLowerCase()) ||
        task.description?.toLowerCase().includes(filters.search.toLowerCase())
      );
    }

    setFilteredTasks(filtered);
  }, [tasks, filters]);

  const handleAddTask = async () => {
    if (!currentUser || !newTask.title.trim()) return;

    try {
      const estimateMin = newTask.effort === 'S' ? 30 : newTask.effort === 'M' ? 60 : 120;
      const estimatedHours = Math.round((estimateMin / 60) * 100) / 100;
      const themeValue = Number.isFinite(Number(newTask.theme)) ? Number(newTask.theme) : newTask.theme;

      const priorityMap: Record<string, number> = { high: 1, med: 2, low: 3 };
      await addDoc(collection(db, 'tasks'), {
        ...newTask,
        theme: themeValue,
        persona: currentPersona,
        status: 0,
        priority: priorityMap[String((newTask as any).priority).toLowerCase()] ?? 2,
        alignedToGoal: currentPersona === 'personal' && newTask.parentType === 'story',
        hasGoal: currentPersona === 'personal' && newTask.parentType === 'story',
        source: 'web',
        aiLinkConfidence: 0,
        syncState: 'clean',
        serverUpdatedAt: Date.now(),
        createdBy: currentUser.uid,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        estimateMin,
        estimatedHours
      });

      setNewTask({
        title: '',
        description: '',
        priority: 'med',
        effort: 'M',
        parentType: 'story',
        parentId: '',
        theme: '1',
        estimatedHours: 1
      });
      setShowAddTask(false);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  };

  const updateTaskStatus = async (taskId: string, status: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleEditTask = async () => {
    if (!currentUser || !selectedTask || !newTask.title.trim()) return;

    try {
      const taskRef = doc(db, 'tasks', selectedTask.id);
      const estimateMin = newTask.estimatedHours !== undefined
        ? Math.max(5, Math.round(newTask.estimatedHours * 60))
        : (newTask.effort === 'S' ? 30 : newTask.effort === 'M' ? 60 : 120);
      const estimatedHours = newTask.estimatedHours !== undefined
        ? Math.round(newTask.estimatedHours * 100) / 100
        : Math.round((estimateMin / 60) * 100) / 100;
      const themeValue = Number.isFinite(Number(newTask.theme)) ? Number(newTask.theme) : newTask.theme;

      await updateDoc(taskRef, {
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
        effort: newTask.effort,
        parentType: newTask.parentType,
        parentId: newTask.parentId,
        theme: themeValue,
        estimateMin,
        estimatedHours,
        updatedAt: serverTimestamp()
      });

      setNewTask({
        title: '',
        description: '',
        priority: 'med',
        effort: 'M',
        parentType: 'story',
        parentId: '',
        theme: '1',
        estimatedHours: 1
      });
      setShowEditTask(false);
      setSelectedTask(null);
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  // DELETE FUNCTION - ADDED FOR C20 FIX
  const handleDeleteTask = async () => {
    if (!selectedTask) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${selectedTask.title}"?\n\nThis action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, 'tasks', selectedTask.id));
      console.log('Task deleted successfully:', selectedTask.id);
      setShowEditTask(false);
      setSelectedTask(null);
    } catch (error) {
      console.error('Error deleting task:', error);
      alert('Failed to delete task. Please try again.');
    }
  };

  const openEditTask = (task: Task) => {
    setSelectedTask(task);
    setNewTask({
      title: task.title,
      description: task.description || '',
      priority: getPriorityName(task.priority) as 'low' | 'med' | 'high',
      effort: task.effort,
      parentType: task.parentType,
      parentId: task.parentId,
      theme: String(task.theme ?? '1'),
      estimatedHours: typeof task.estimatedHours === 'number'
        ? Math.round(task.estimatedHours * 100) / 100
        : task.estimateMin
          ? Math.round((task.estimateMin / 60) * 100) / 100
          : 1
    });
    setShowEditTask(true);
  };

  const getParentName = (task: Task) => {
    if (task.parentType === 'story') {
      const story = stories.find(s => s.id === task.parentId);
      return story?.title || 'Unknown Story';
    } else {
      const project = projects.find(p => p.id === task.parentId);
      return project?.title || 'Unknown Project';
    }
  };

  const getGoalName = (task: Task) => {
    if (task.parentType === 'story') {
      const story = stories.find(s => s.id === task.parentId);
      if (story) {
        const goal = goals.find(g => g.id === story.goalId);
        return goal?.title || 'No Goal';
      }
    }
    return 'N/A';
  };

  return (
    <Container fluid>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>{currentPersona === 'personal' ? 'Personal' : 'Work'} Tasks</h2>
        <Button variant="primary" onClick={() => setShowAddTask(true)}>
          + Add Task
        </Button>
      </div>

      {/* Filters */}
      <Row className="mb-3">
        <Col md={2}>
          <Form.Select
            size="sm"
            value={filters.status}
            onChange={(e) => setFilters({...filters, status: e.target.value})}
          >
            <option value="">All Statuses</option>
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select
            size="sm"
            value={filters.priority}
            onChange={(e) => setFilters({...filters, priority: e.target.value})}
          >
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Form.Select
            size="sm"
            value={filters.effort}
            onChange={(e) => setFilters({...filters, effort: e.target.value})}
          >
            <option value="">All Efforts</option>
            <option value="S">Small</option>
            <option value="M">Medium</option>
            <option value="L">Large</option>
          </Form.Select>
        </Col>
        {currentPersona === 'personal' && (
          <Col md={2}>
            <Form.Select
              size="sm"
              value={filters.hasGoal}
              onChange={(e) => setFilters({...filters, hasGoal: e.target.value})}
            >
              <option value="">All Tasks</option>
              <option value="true">With Goals</option>
              <option value="false">Without Goals</option>
            </Form.Select>
          </Col>
        )}
        <Col md={4}>
          <Form.Control
            size="sm"
            type="text"
            placeholder="Search tasks..."
            value={filters.search}
            onChange={(e) => setFilters({...filters, search: e.target.value})}
          />
        </Col>
      </Row>

      {/* Tasks Table */}
      <Table striped bordered hover responsive>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Effort</th>
            <th>Parent</th>
            {currentPersona === 'personal' && <th>Goal</th>}
            <th>Theme</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredTasks.map((task) => (
            <tr key={task.id}>
              <td>
                <div>
                  <strong>{task.title}</strong>
                  {task.description && <div className="text-muted small">{task.description}</div>}
                </div>
              </td>
              <td>
                <Badge bg={
                  isStatus(task.status, 'done') ? 'success' : 
                  isStatus(task.status, 'in_progress') ? 'warning' : 'secondary'
                }>
                  {taskStatusText(task.status)}
                </Badge>
              </td>
              <td>
                <Badge bg={
                  isPriority(task.priority, 'high') ? 'danger' :
                  isPriority(task.priority, 'med') ? 'warning' : 'info'
                }>
                  {task.priority}
                </Badge>
              </td>
              <td>
                <Badge bg="outline-primary">{task.effort}</Badge>
              </td>
              <td>{getParentName(task)}</td>
              {currentPersona === 'personal' && <td>{getGoalName(task)}</td>}
              <td>
                {task.theme && <Badge bg="secondary">{task.theme}</Badge>}
              </td>
              <td>
                <div className="d-flex gap-1">
                  <Button 
                    variant="outline-primary" 
                    size="sm"
                    onClick={() => openEditTask(task)}
                  >
                    Edit
                  </Button>
                  <Form.Select
                    size="sm"
                    value={task.status}
                    onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                    style={{ width: '120px' }}
                  >
                    <option value="planned">Planned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </Form.Select>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {filteredTasks.length === 0 && (
        <div className="text-center text-muted mt-4">
          <p>No tasks found for the current filters.</p>
        </div>
      )}

      {/* Add Task Modal */}
      <Modal show={showAddTask} onHide={() => setShowAddTask(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add New Task</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
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
                rows={3}
                value={newTask.description}
                onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                placeholder="Enter task description"
              />
            </Form.Group>

            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({...newTask, priority: e.target.value as any})}
                  >
                    <option value="low">Low</option>
                    <option value="med">Medium</option>
                    <option value="high">High</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Effort</Form.Label>
                  <Form.Select
                    value={newTask.effort}
                    onChange={(e) => setNewTask({...newTask, effort: e.target.value as any})}
                  >
                    <option value="S">Small (30min)</option>
                    <option value="M">Medium (1hr)</option>
                    <option value="L">Large (2hr+)</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Theme</Form.Label>
                  <Form.Select
                    value={newTask.theme}
                    onChange={(e) => setNewTask({...newTask, theme: e.target.value as any})}
                  >
                    {globalThemes.map((theme) => (
                      <option key={theme.id} value={String(theme.id)}>
                        {theme.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>Parent {newTask.parentType === 'story' ? 'Story' : 'Project'}</Form.Label>
              <div className="mb-2">
                <Form.Check
                  inline
                  label="Story"
                  name="parentType"
                  type="radio"
                  id="parentType-story"
                  checked={newTask.parentType === 'story'}
                  onChange={() => setNewTask({...newTask, parentType: 'story', parentId: ''})}
                  disabled={currentPersona === 'work'}
                />
                <Form.Check
                  inline
                  label="Project"
                  name="parentType"
                  type="radio"
                  id="parentType-project"
                  checked={newTask.parentType === 'project'}
                  onChange={() => setNewTask({...newTask, parentType: 'project', parentId: ''})}
                />
              </div>
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
      <Modal show={showEditTask} onHide={() => setShowEditTask(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Task</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Task Title *</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter task title"
                value={newTask.title}
                onChange={(e) => setNewTask({...newTask, title: e.target.value})}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Task description..."
                value={newTask.description}
                onChange={(e) => setNewTask({...newTask, description: e.target.value})}
              />
            </Form.Group>

            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({...newTask, priority: e.target.value as any})}
                  >
                    <option value="low">Low</option>
                    <option value="med">Medium</option>
                    <option value="high">High</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Effort</Form.Label>
                  <Form.Select
                    value={newTask.effort}
                    onChange={(e) => setNewTask({...newTask, effort: e.target.value as any})}
                  >
                    <option value="S">S (30min)</option>
                    <option value="M">M (1hr)</option>
                    <option value="L">L (2hr)</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Theme</Form.Label>
                  <Form.Select
                    value={newTask.theme}
                    onChange={(e) => setNewTask({...newTask, theme: e.target.value as any})}
                  >
                    {globalThemes.map((theme) => (
                      <option key={theme.id} value={String(theme.id)}>
                        {theme.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

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
          <div className="d-flex justify-content-between w-100">
            <Button 
              variant="danger" 
              onClick={handleDeleteTask}
              className="me-auto"
            >
              Delete Task
            </Button>
            <div>
              <Button variant="secondary" onClick={() => setShowEditTask(false)} className="me-2">
                Cancel
              </Button>
              <Button variant="primary" onClick={handleEditTask}>
                Update Task
              </Button>
            </div>
          </div>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default TasksList;

export {};
