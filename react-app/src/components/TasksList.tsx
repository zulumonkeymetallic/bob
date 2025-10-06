import React, { useState, useEffect } from 'react';
import { Container, Table, Badge, Button, Form, Row, Col, Modal, InputGroup, Dropdown, Alert, Spinner, Toast, ToastContainer } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { Task, Goal, Story, WorkProject, Sprint } from '../types';
import { generateRef } from '../utils/referenceGenerator';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '../utils/statusHelpers';
import { deriveTaskSprint, effectiveSprintId, isDueDateWithinStorySprint, sprintNameForId } from '../utils/taskSprintHelpers';
import { useGlobalThemes } from '../hooks/useGlobalThemes';

interface TaskWithContext extends Task {
  referenceNumber?: string;
  storyTitle?: string;
  goalTitle?: string;
  sprintName?: string;
}

interface StorySuggestion {
  taskId: string;
  taskTitle: string;
  storyTitle: string;
  storyDescription: string;
  confidence: number;
  rationale?: string;
  goalId?: string | null;
  goalTitle?: string | null;
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
  const [aiSuggestions, setAiSuggestions] = useState<StorySuggestion[]>([]);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccess, setAiSuccess] = useState<string | null>(null);
  const [toastState, setToastState] = useState<{ show: boolean; message: string; variant: 'danger' | 'info' | 'success' }>({ show: false, message: '', variant: 'danger' });
  
  const showToast = (message: string, variant: 'danger' | 'info' | 'success' = 'danger') => {
    setToastState({ show: true, message, variant });
  };

  const closeToast = () => setToastState(prev => ({ ...prev, show: false }));

  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    effort: '',
    hasGoal: '',
    search: '',
    sprint: '',
    due: ''
  });

  const location = useLocation();
  const navigate = useNavigate();

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'med' as 'low' | 'med' | 'high',
    effort: 'M' as 'S' | 'M' | 'L',
    parentType: 'story' as 'story' | 'project',
    parentId: '',
    theme: 1, // Default to Health & Fitness
    status: 'planned' as 'planned' | 'in_progress' | 'done',
    estimatedHours: 1
  });

  const [editingField, setEditingField] = useState<{taskId: string, field: string, value: any} | null>(null);
  const { themes } = useGlobalThemes();
  const [newTaskThemeInput, setNewTaskThemeInput] = useState('');
  const [editTaskThemeInput, setEditTaskThemeInput] = useState('');

  const effortToHours = (effort: string | undefined): number => {
    switch (effort) {
      case 'S':
        return 0.5;
      case 'L':
        return 2;
      case 'M':
      default:
        return 1;
    }
  };

  const normalizeEstimatedHours = (task: Partial<Task>): number | undefined => {
    if (typeof task.estimatedHours === 'number' && !Number.isNaN(task.estimatedHours)) {
      return task.estimatedHours;
    }
    if (typeof task.estimateMin === 'number' && !Number.isNaN(task.estimateMin)) {
      return Number((task.estimateMin / 60).toFixed(2));
    }
    if (task.effort) {
      return effortToHours(task.effort as string);
    }
    return undefined;
  };

  const roundHours = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  };

  const isDueToday = (task: TaskWithContext): boolean => {
    const raw = (task as any).dueDate ?? (task as any).targetDate ?? (task as any).dueDateMs ?? null;
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

  const handleCloseAiModal = () => {
    setShowAiModal(false);
    setAiSuggestions([]);
    setAiError(null);
    setAiSuccess(null);
  };

  const fetchAiSuggestions = async () => {
    if (!currentUser) return;
    setAiLoading(true);
    setAiError(null);
    setAiSuccess(null);
    try {
      const callable = httpsCallable(functions, 'suggestTaskStoryConversions');
      const response: any = await callable({ persona: currentPersona, limit: 8 });
      const rawSuggestions = Array.isArray(response?.data?.suggestions) ? response.data.suggestions : [];
      const mapped: StorySuggestion[] = rawSuggestions.map((item: any) => {
        const fallbackTask = tasks.find(t => t.id === item.taskId);
        const goalTitle = item.goalTitle || goals.find(g => g.id === item.goalId)?.title || null;
        const numericConfidence = Number(item.confidence);
        const confidence = Number.isFinite(numericConfidence) ? Math.max(0, Math.min(1, numericConfidence)) : 0.5;
        return {
          taskId: item.taskId,
          taskTitle: item.taskTitle || fallbackTask?.title || 'Task',
          storyTitle: item.storyTitle || fallbackTask?.title || 'Story',
          storyDescription: item.storyDescription || fallbackTask?.description || '',
          confidence,
          rationale: item.rationale || '',
          goalId: item.goalId || null,
          goalTitle
        };
      });
      setAiSuggestions(mapped);
      setShowAiModal(true);
      if (!mapped.length) {
        setAiSuccess('No strong conversion candidates right now. Try adding more detail to tasks.');
      }
    } catch (error: any) {
      const message = error?.message || 'Failed to fetch AI suggestions';
      setAiError(message);
      setShowAiModal(true);
    } finally {
      setAiLoading(false);
    }
  };

  const handleConvertSuggestion = async (suggestion: StorySuggestion) => {
    if (!currentUser) return;
    setAiLoading(true);
    setAiError(null);
    setAiSuccess(null);
    try {
      const callable = httpsCallable(functions, 'convertTasksToStories');
      await callable({
        conversions: [{
          taskId: suggestion.taskId,
          storyTitle: suggestion.storyTitle,
          storyDescription: suggestion.storyDescription,
          goalId: suggestion.goalId || null
        }]
      });
      setAiSuggestions(prev => prev.filter(item => item.taskId !== suggestion.taskId));
      setAiSuccess(`Created story "${suggestion.storyTitle}"`);
    } catch (error: any) {
      setAiError(error?.message || 'Failed to convert task');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    // Initialize add/edit theme input labels when data changes
    const matchNew = themes.find(t => t.id === (newTask as any).theme);
    setNewTaskThemeInput(matchNew?.label || '');
  }, [themes]);

  useEffect(() => {
    if (selectedTask) {
      const match = themes.find(t => t.id === (selectedTask as any).theme);
      setEditTaskThemeInput(match?.label || '');
    }
  }, [selectedTask, themes]);

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
      const activeTasks = tasksData.filter(task => !task.deleted);
      const tasksWithContext = activeTasks.map((task, index) => {
        const estimatedHours = normalizeEstimatedHours(task);
        const parentStory = stories.find(s => s.id === (task.storyId || (task.parentType === 'story' ? task.parentId : undefined)));
        const parentGoal = goals.find(g => g.id === (parentStory?.goalId || task.goalId));
        const derivedTheme = parentStory?.theme ?? parentGoal?.theme ?? task.theme;
        const derivedSprintId = effectiveSprintId(task, stories, sprints);
        return {
          ...task,
          sprintId: derivedSprintId ?? null,
          theme: derivedTheme ?? task.theme,
          estimatedHours,
          referenceNumber: generateReferenceNumber(task, index),
          storyTitle: parentStory?.title || '',
          goalTitle: parentGoal?.title || '',
          sprintName: sprintNameForId(sprints, derivedSprintId)
        };
      });
      
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
      filtered = filtered.filter(task => isStatus(task.status, filters.status));
    }

    if (filters.priority) {
      filtered = filtered.filter(task => isPriority(task.priority, filters.priority));
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

    if (filters.sprint) {
      if (filters.sprint === 'none') {
        filtered = filtered.filter(task => !task.sprintId);
      } else {
        filtered = filtered.filter(task => task.sprintId === filters.sprint);
      }
    }

    if (filters.due === 'today') {
      filtered = filtered.filter(task => isDueToday(task));
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
      console.log('🚀 TasksList: Starting TASK creation', {
        action: 'task_creation_start',
        user: currentUser.uid,
        persona: currentPersona,
        title: newTask.title.trim(),
        parentType: newTask.parentType,
        parentId: newTask.parentId,
        priority: newTask.priority,
        effort: newTask.effort,
        timestamp: new Date().toISOString()
      });

      // Get existing task references for unique ref generation
      const existingTasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid)
      );
      const existingSnapshot = await getDocs(existingTasksQuery);
      const existingRefs = existingSnapshot.docs
        .map(doc => doc.data().ref)
        .filter(ref => ref);
      
      // Generate unique reference number
      const ref = generateRef('task', existingRefs);
      console.log('🏷️ TasksList: Generated reference', {
        action: 'reference_generated',
        ref: ref,
        timestamp: new Date().toISOString()
      });

      const estimatedHoursValue = normalizeEstimatedHours({
        estimatedHours: newTask.estimatedHours,
        effort: newTask.effort
      }) ?? effortToHours(newTask.effort);
      const estimatedHoursRounded = roundHours(estimatedHoursValue);
      const estimateMinutes = Math.max(5, Math.round(estimatedHoursRounded * 60));

      const taskData: any = {
        ref: ref, // Add reference number
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
        effort: newTask.effort,
        estimatedHours: estimatedHoursRounded,
        estimateMin: estimateMinutes,
        status: newTask.status,
        theme: newTask.theme,
        persona: currentPersona,
        ownerUid: currentUser.uid, // Ensure ownerUid is included
        storyId: newTask.parentType === 'story' ? newTask.parentId : null,
        projectId: newTask.parentType === 'project' ? newTask.parentId : null,
        sprintId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const derivedSprint = deriveTaskSprint({
        task: { ...taskData, id: ref } as Task,
        stories,
        sprints
      }).sprintId;
      if (derivedSprint) {
        taskData.sprintId = derivedSprint;
      }

      console.log('💾 TasksList: Saving TASK to database', {
        action: 'task_save_start',
        data: taskData,
        timestamp: new Date().toISOString()
      });

      await addDoc(collection(db, 'tasks'), taskData);
      
      console.log('✅ TasksList: TASK created successfully', {
        action: 'task_creation_success',
        ref: ref,
        taskId: 'pending_from_firestore',
        timestamp: new Date().toISOString()
      });

      setNewTask({
        title: '',
        description: '',
        priority: 'med',
        effort: 'M',
        parentType: currentPersona === 'personal' ? 'story' : 'project',
        parentId: '',
        theme: 1, // Default to Health & Fitness
        status: 'planned',
        estimatedHours: 1
      });
      setShowAddTask(false);
    } catch (error) {
      console.error('❌ TasksList: TASK creation failed', {
        action: 'task_creation_error',
        error: error.message,
        formData: newTask,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    if (!currentUser) return;

    try {
      console.log('🔧 TasksList: Starting TASK update', {
        action: 'task_update_start',
        taskId: taskId,
        updates: updates,
        user: currentUser.uid,
        timestamp: new Date().toISOString()
      });

      const existingTask = tasks.find(t => t.id === taskId);
      if (!existingTask) return;

      const derivation = deriveTaskSprint({
        task: existingTask,
        updates,
        stories,
        sprints
      });

      if (!isDueDateWithinStorySprint(derivation.dueDateMs, derivation.story, sprints)) {
        showToast('Task due date must fall within the linked story sprint window.');
        console.warn('⚠️ TasksList: due date outside sprint window', {
          taskId,
          dueDate: derivation.dueDateMs,
          sprintId: derivation.story?.sprintId
        });
        return;
      }

      const payload: Partial<Task> & { updatedAt?: any } = { ...updates };
      if ('dueDate' in updates) {
        payload.dueDate = derivation.dueDateMs ?? null;
      }
      if (payload.estimatedHours !== undefined) {
        const hours = Number(payload.estimatedHours);
        if (!Number.isNaN(hours)) {
          payload.estimatedHours = roundHours(hours);
          payload.estimateMin = Math.max(5, Math.round(payload.estimatedHours * 60));
        } else {
          delete payload.estimatedHours;
        }
      } else if (payload.estimateMin !== undefined) {
        const minutes = Number(payload.estimateMin);
        if (!Number.isNaN(minutes)) {
          payload.estimatedHours = roundHours(minutes / 60);
        }
      }

      if (derivation.story?.sprintId) {
        payload.sprintId = derivation.story.sprintId;
      } else if ('sprintId' in payload || derivation.sprintId !== existingTask.sprintId) {
        payload.sprintId = derivation.sprintId ?? null;
      }

      if (payload.sprintId === existingTask.sprintId || (payload.sprintId == null && !existingTask.sprintId)) {
        delete payload.sprintId;
      }

      await updateDoc(doc(db, 'tasks', taskId), {
        ...payload,
        updatedAt: serverTimestamp()
      });

      console.log('✅ TasksList: TASK updated successfully', {
        action: 'task_update_success',
        taskId: taskId,
        updates: updates,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ TasksList: TASK update failed', {
        action: 'task_update_error',
        taskId: taskId,
        updates: updates,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!currentUser) return;
    
    console.log('🗑️ TasksList: DELETE confirmation requested', {
      action: 'delete_confirmation_requested',
      taskId: taskId,
      user: currentUser.uid,
      timestamp: new Date().toISOString()
    });

    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        console.log('💾 TasksList: Starting TASK deletion', {
          action: 'task_delete_start',
          taskId: taskId,
          user: currentUser.uid,
          timestamp: new Date().toISOString()
        });

        await deleteDoc(doc(db, 'tasks', taskId));
        
        console.log('✅ TasksList: TASK deleted successfully', {
          action: 'task_delete_success',
          taskId: taskId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ TasksList: TASK deletion failed', {
          action: 'task_delete_error',
          taskId: taskId,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      console.log('↩️ TasksList: DELETE cancelled by user', {
        action: 'delete_cancelled',
        taskId: taskId,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Quick edit functions
  const handleQuickStatusChange = async (taskId: string, newStatus: string) => {
    console.log('⚡ TasksList: Quick STATUS change', {
      action: 'quick_status_change',
      taskId: taskId,
      newStatus: newStatus,
      timestamp: new Date().toISOString()
    });
    await handleUpdateTask(taskId, { status: newStatus as any });
  };

  const handleQuickSprintAssign = async (taskId: string, sprintId: string) => {
    console.log('⚡ TasksList: Quick SPRINT assign', {
      action: 'quick_sprint_assign',
      taskId: taskId,
      sprintId: sprintId || 'unassigned',
      timestamp: new Date().toISOString()
    });
    await handleUpdateTask(taskId, { sprintId: sprintId || null });
  };

  const handleQuickPriorityChange = async (taskId: string, priority: string) => {
    console.log('⚡ TasksList: Quick PRIORITY change', {
      action: 'quick_priority_change',
      taskId: taskId,
      newPriority: priority,
      timestamp: new Date().toISOString()
    });
    await handleUpdateTask(taskId, { priority: priority as any });
  };

  const handleRowClick = (task: TaskWithContext) => {
    setSelectedRowId(task.id === selectedRowId ? null : task.id);
  };

  const handleEditTask = (task: TaskWithContext) => {
    const estimatedHours = normalizeEstimatedHours(task);
    setSelectedTask({ ...task, estimatedHours });
    setShowEditTask(true);
  };

  const handleSaveEditTask = async () => {
    if (!selectedTask || !currentUser) return;

    try {
      await handleUpdateTask(selectedTask.id, {
        title: selectedTask.title,
        description: selectedTask.description,
        priority: selectedTask.priority,
        effort: selectedTask.effort,
        status: selectedTask.status as any,
        theme: selectedTask.theme,
        storyId: selectedTask.storyId || null,
        projectId: selectedTask.projectId || null,
        sprintId: selectedTask.sprintId || null,
        estimatedHours: normalizeEstimatedHours(selectedTask),
        estimateMin: selectedTask.estimateMin
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
          <Button variant="outline-info" onClick={fetchAiSuggestions} disabled={aiLoading}>
            {aiLoading ? (
              <span className="d-inline-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" />
                Working...
              </span>
            ) : (
              'AI Story Suggestions'
            )}
          </Button>
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
      <Row className="mb-4">
        <Col md={3} sm={6} className="mb-2 mb-md-0">
          <Form.Select
            value={filters.sprint}
            onChange={(e) => setFilters({ ...filters, sprint: e.target.value })}
            size="sm"
          >
            <option value="">All Sprints</option>
            <option value="none">No Sprint</option>
            {sprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
            ))}
          </Form.Select>
        </Col>
      </Row>
      {filters.due && (
        <Alert variant="info" className="d-flex justify-content-between align-items-center">
          <div>
            <strong>Preset applied:</strong>{' '}
            {filters.due === 'today' ? 'Showing tasks due today' : filters.due}
          </div>
          <Button size="sm" variant="outline-info" onClick={() => setFilters({ ...filters, due: '' })}>
            Clear preset
          </Button>
        </Alert>
      )}

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
                    <Dropdown.Toggle as={Badge} bg={getBadgeVariant(getStatusName(task.status))} style={{ cursor: 'pointer' }}>
                      {getStatusName(task.status).replace('-', ' ').toUpperCase()}
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
                    <Dropdown.Toggle as={Badge} bg={getPriorityColor(getPriorityName(task.priority))} style={{ cursor: 'pointer' }}>
                      {getPriorityName(task.priority).toUpperCase()}
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

      <Modal show={showAiModal} onHide={handleCloseAiModal} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>AI Story Suggestions</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {aiError && <Alert variant="danger">{aiError}</Alert>}
          {aiSuccess && <Alert variant="success">{aiSuccess}</Alert>}
          {aiLoading && (
            <div className="text-center my-4">
              <Spinner animation="border" />
            </div>
          )}
          {!aiLoading && !aiSuggestions.length && !aiError && (
            <p className="mb-0 text-muted">No suggestions available right now. Try again after updating your tasks.</p>
          )}
          {aiSuggestions.map((suggestion) => (
            <div key={suggestion.taskId} className="border rounded p-3 mb-3">
              <div className="d-flex justify-content-between align-items-start gap-3">
                <div>
                  <h5 className="mb-1">{suggestion.storyTitle}</h5>
                  <div className="text-muted mb-2">Derived from task: {suggestion.taskTitle}</div>
                  {suggestion.goalTitle && (
                    <div className="mb-2"><strong>Goal:</strong> {suggestion.goalTitle}</div>
                  )}
                  <p style={{ whiteSpace: 'pre-wrap' }} className="mb-2">{suggestion.storyDescription || 'No description provided by AI.'}</p>
                  {suggestion.rationale && (
                    <div className="text-muted"><strong>Why:</strong> {suggestion.rationale}</div>
                  )}
                </div>
                <div className="text-end" style={{ minWidth: '140px' }}>
                  <div className="mb-2"><Badge bg="info">Confidence {(suggestion.confidence * 100).toFixed(0)}%</Badge></div>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => handleConvertSuggestion(suggestion)}
                    disabled={aiLoading}
                  >
                    Convert to Story
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseAiModal}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

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
                  <Form.Control
                    list="task-theme-options"
                    value={newTaskThemeInput}
                    onChange={(e) => setNewTaskThemeInput(e.target.value)}
                    onBlur={() => {
                      const val = newTaskThemeInput.trim();
                      const match = themes.find(t => t.label === val || t.name === val || String(t.id) === val);
                      setNewTask({ ...newTask, theme: match ? match.id : (parseInt(val) || (newTask as any).theme) });
                    }}
                    placeholder="Search themes..."
                  />
                  <datalist id="task-theme-options">
                    {themes.map(t => (
                      <option key={t.id} value={t.label} />
                    ))}
                  </datalist>
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
                  <Form.Label>Estimated Hours</Form.Label>
                  <Form.Control
                    type="number"
                    min="0"
                    step="0.25"
                    value={newTask.estimatedHours ?? 1}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      setNewTask({
                        ...newTask,
                        estimatedHours: Number.isNaN(value) ? undefined : value
                      });
                    }}
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={4}>
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
              <Col md={8}>
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
              </Col>
            </Row>
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
                    <Form.Control
                      list="task-theme-options-edit"
                      value={editTaskThemeInput}
                      onChange={(e) => setEditTaskThemeInput(e.target.value)}
                      onBlur={() => {
                        if (!selectedTask) return;
                        const val = editTaskThemeInput.trim();
                        const match = themes.find(t => t.label === val || t.name === val || String(t.id) === val);
                        setSelectedTask({ ...selectedTask, theme: match ? match.id : (parseInt(val) || (selectedTask as any).theme) });
                      }}
                      placeholder="Search themes..."
                    />
                    <datalist id="task-theme-options-edit">
                      {themes.map(t => (
                        <option key={t.id} value={t.label} />
                      ))}
                    </datalist>
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
                      onChange={(e) => {
                        const nextEffort = e.target.value as any;
                        const hoursFromEffort = normalizeEstimatedHours({ effort: nextEffort });
                        setSelectedTask({
                          ...selectedTask,
                          effort: nextEffort,
                          estimatedHours: selectedTask.estimatedHours ?? hoursFromEffort,
                          estimateMin: selectedTask.estimateMin ?? (hoursFromEffort ? Math.round(hoursFromEffort * 60) : undefined)
                        });
                      }}
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
                    <Form.Label>Estimated Hours</Form.Label>
                    <Form.Control
                      type="number"
                      min="0"
                      step="0.25"
                      value={selectedTask.estimatedHours ?? normalizeEstimatedHours(selectedTask) ?? 1}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        setSelectedTask({
                          ...selectedTask,
                          estimatedHours: Number.isNaN(value) ? undefined : roundHours(value),
                          estimateMin: Number.isNaN(value) ? selectedTask.estimateMin : Math.max(5, Math.round(roundHours(value) * 60))
                        });
                      }}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={6}>
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

      <ToastContainer position="bottom-end" className="p-3">
        <Toast bg={toastState.variant} onClose={closeToast} show={toastState.show} delay={4000} autohide>
          <Toast.Body className={toastState.variant === 'info' ? '' : 'text-white'}>{toastState.message}</Toast.Body>
        </Toast>
      </ToastContainer>
    </Container>
  );
};

export default TasksList;
