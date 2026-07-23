import React, { useState, useEffect, useMemo } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { Task, Story, Goal, Sprint } from '../types';
import ModernTaskTable from './ModernTaskTable';
import TasksCardView from './TasksCardView';
import EditTaskModal from './EditTaskModal';
import { isStatus, isTheme } from '../utils/statusHelpers';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { useSprint } from '../contexts/SprintContext';
import WorkSurfaceNav from './common/WorkSurfaceNav';
import { getActiveFocusLeafGoalIds, isGoalInHierarchySet } from '../utils/goalHierarchy';
import { FocusGoal } from '../types';

const TaskListView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { setUpdateHandler } = useSidebar();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  // Default to hiding Done tasks — per Jim, 2026-07-23, matching StoriesManagement's default.
  const [filterStatus, setFilterStatus] = useState<string>('not_done');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDataQuality, setFilterDataQuality] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dueFilter, setDueFilter] = useState<'all' | 'today'>('all');
  const [top3Only, setTop3Only] = useState(false);
  const [focusOnly, setFocusOnly] = useState(false);
  const [focusGoals, setFocusGoals] = useState<FocusGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const { selectedSprintId, setSelectedSprintId, sprints: rawSprints } = useSprint();
  const { themes: globalThemes } = useGlobalThemes();
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
    if (!currentUser?.uid) { setFocusGoals([]); return; }
    const focusQuery = query(
      collection(db, 'focusGoals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('isActive', '==', true)
    );
    const unsub = onSnapshot(
      focusQuery,
      (snapshot) => setFocusGoals(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as FocusGoal[]),
      () => setFocusGoals([])
    );
    return () => unsub();
  }, [currentUser, currentPersona]);

  const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(focusGoals), [focusGoals]);

  useEffect(() => {
    if (!currentUser) return;
    const loadTaskData = () => {
      if (!currentUser) return;

      setLoading(true);

      // Load all related data
      // Use materialized index for open tasks to avoid downloading entire tasks collection
      const tasksQuery = selectedSprintId
        ? query(
            collection(db, 'sprint_task_index'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona),
            where('sprintId', '==', selectedSprintId),
            where('isOpen', '==', true),
            orderBy('dueDate', 'asc'),
            limit(1000)
          )
        : query(
            collection(db, 'sprint_task_index'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona),
            where('isOpen', '==', true),
            orderBy('dueDate', 'asc'),
            limit(1000)
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
        const tasksData = snapshot.docs.map(docSnap => {
          const x = docSnap.data() as any;
          const t: any = {
            id: docSnap.id,
            title: x.title,
            description: x.description || '',
            status: x.status,
            priority: x.priority ?? 2,
            type: x.type || 'task',
            repeatFrequency: x.repeatFrequency || null,
            repeatInterval: x.repeatInterval ?? null,
            daysOfWeek: Array.isArray(x.daysOfWeek) ? x.daysOfWeek : [],
            lastDoneAt: x.lastDoneAt || null,
            snoozedUntil: x.snoozedUntil || null,
            aiCriticalityScore: x.aiCriticalityScore ?? null,
            aiCriticalityReason: x.aiCriticalityReason || null,
            effort: x.effort ?? 'M',
            estimateMin: x.estimateMin ?? 0,
            dueDate: x.dueDate || null,
            parentType: x.parentType || 'story',
            parentId: x.parentId || x.storyId || '',
            storyId: x.storyId || null,
            sprintId: x.sprintId && x.sprintId !== '__none__' ? x.sprintId : null,
            persona: currentPersona,
            ownerUid: currentUser.uid,
            ref: x.ref || `TASK-${String(docSnap.id).slice(-4).toUpperCase()}`,
            updatedAt: x.updatedAt || null,
            deviceUpdatedAt: x.deviceUpdatedAt || null,
            serverUpdatedAt: x.serverUpdatedAt || null,
            macSyncedAt: x.macSyncedAt || null,
            syncState: x.syncState || null,
            goalId: x.goalId || null,
            theme: x.theme ?? null,
          };
          return t as Task;
        });
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
    } catch (error: any) {
      if (error?.code === 'not-found') {
        // Benign race: the task was deleted (duplicate cleanup, nightly archival, etc.)
        // between this row rendering and the edit landing. Not an error worth alarming
        // over — the live onSnapshot listener above will drop it from `tasks` on its own
        // as soon as the delete's snapshot update arrives.
        console.warn('Skipped update — task no longer exists:', taskId);
        return;
      }
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
    } catch (error: any) {
      if (error?.code === 'not-found') {
        console.warn('Skipped priority update — task no longer exists:', taskId);
        return;
      }
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

  // Sprint/persona-scoped but otherwise unfiltered — used for the stat strip counts, so
  // "Done" reflects reality even while the status filter (default: hide Done) is narrowing
  // what's actually visible in the table below. Previously the counts were computed from
  // `filteredTasks`, which already had Done tasks filtered out by the default "not_done"
  // status filter — so "Done" always read 0 regardless of the real count. Confirmed by Jim,
  // 2026-07-23.
  const scopedTasks = tasks.filter(task => {
    if (selectedSprintId && task.sprintId !== selectedSprintId) return false;
    if (task.persona) {
      const persona = typeof task.persona === 'string' ? task.persona.toLowerCase() : String(task.persona).toLowerCase();
      if (persona && persona !== currentPersona) return false;
    }
    return true;
  });
  const filteredTasks = tasks.filter(task => {
    if (selectedSprintId && task.sprintId !== selectedSprintId) return false;
    if (task.persona) {
      const persona = typeof task.persona === 'string' ? task.persona.toLowerCase() : String(task.persona).toLowerCase();
      if (persona && persona !== currentPersona) return false;
    }
    if (filterStatus === 'not_done' && isStatus(task.status, 'done')) return false;
    else if (filterStatus !== 'all' && filterStatus !== 'not_done' && !isStatus(task.status, filterStatus)) return false;
    if (filterTheme !== 'all' && !isTheme(task.theme, filterTheme)) return false;
    const rawType = String((task as any)?.type || (task as any)?.task_type || 'task').toLowerCase();
    const normalizedType = rawType === 'habitual' ? 'habit' : rawType;
    if (filterType !== 'all' && normalizedType !== filterType) return false;
    if (dueFilter === 'today' && !isDueToday(task)) return false;
    if (top3Only && (task as any).aiTop3ForDay !== true) return false;
    if (focusOnly) {
      if (activeFocusGoalIds.size === 0) return false;
      const storyId = String((task as any).storyId || (task as any).parentId || '').trim();
      const parentStory = storyId ? stories.find((s) => s.id === storyId) : null;
      const goalId = String((task as any).goalId || parentStory?.goalId || '').trim();
      if (!goalId || !isGoalInHierarchySet(goalId, goals, activeFocusGoalIds)) return false;
    }
    if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterDataQuality !== 'all') {
      const storyId = String((task as any).storyId || (task as any).parentId || '').trim();
      const hasStory = !!storyId && stories.some((s) => s.id === storyId);
      const storyGoalId = hasStory ? String((stories.find((s) => s.id === storyId) as any)?.goalId || '').trim() : '';
      const directGoalId = String((task as any).goalId || '').trim();
      const goalId = storyGoalId || directGoalId;
      const hasGoal = !!goalId && goals.some((g) => g.id === goalId);
      const rawPoints = (task as any).points;
      const missingPoints = rawPoints == null || rawPoints === '' || Number(rawPoints) <= 0;
      const missingDesc = !String((task as any).description || '').trim();
      if (filterDataQuality === 'missing_any' && !(!hasStory || !hasGoal || missingPoints || missingDesc)) return false;
      if (filterDataQuality === 'missing_link' && !((!hasStory) || !hasGoal)) return false;
      if (filterDataQuality === 'missing_points' && !missingPoints) return false;
      if (filterDataQuality === 'missing_description' && !missingDesc) return false;
    }
    return true;
  });

  // Get counts for dashboard cards
  const taskCounts = {
    total: scopedTasks.length,
    planned: scopedTasks.filter(t => isStatus(t.status, 'planned')).length,
    inProgress: scopedTasks.filter(t => isStatus(t.status, 'in_progress')).length,
    done: scopedTasks.filter(t => isStatus(t.status, 'done')).length
  };

  return (
    <div style={{ 
      padding: '24px', 
      backgroundColor: 'var(--bg)',
      minHeight: '100vh',
      width: '100%'
    }}>
      <div style={{ maxWidth: '100%', margin: '0' }}>
        <WorkSurfaceNav />
        {/* Header */}
        <div style={{
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '24px' 
        }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: '700' }}>
              Tasks
            </h2>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
              Manage all your tasks with modern table interface
            </p>
          </div>
          {/* List/Cards toggle + Switch to Kanban sit to the left of the primary Add task
              button, which stays rightmost as the primary CTA — consistent with
              Goals/Stories. Per Jim, 2026-07-23. */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button
              size="sm"
              variant={viewMode === 'list' ? 'primary' : 'outline-secondary'}
              onClick={() => setViewMode('list')}
            >
              List
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'cards' ? 'primary' : 'outline-secondary'}
              onClick={() => setViewMode('cards')}
            >
              Cards
            </Button>
            <Button variant="outline-primary" href="#" disabled>
              Switch to Kanban
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setShowAddTaskModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} />
              Add Task
            </Button>
          </div>
        </div>

        {/* Stat strip — was 4 full-height cards stacked above the filters; collapsed to one
            slim inline row, matching StoriesManagement. Per Jim, 2026-07-23. */}
        <div
          className="mb-2 d-flex align-items-center flex-wrap"
          style={{ gap: '6px 16px', fontSize: '13px', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card)' }}
        >
          <span><strong style={{ color: 'var(--text)' }}>{taskCounts.total}</strong> Total</span>
          <span><strong style={{ color: 'var(--orange)' }}>{taskCounts.planned}</strong> Planned</span>
          <span><strong style={{ color: 'var(--brand)' }}>{taskCounts.inProgress}</strong> In Progress</span>
          <span><strong style={{ color: 'var(--green)' }}>{taskCounts.done}</strong> Done</span>
        </div>

        {/* Filters */}
        <Card style={{ marginBottom: '12px', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <Card.Body style={{ padding: '6px' }}>
            <Row>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Search Tasks</Form.Label>
                  <InputGroup>
                    <Form.Control
                      size="sm"
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
                  <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Status</Form.Label>
                  <Form.Select
                    size="sm"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{ border: '1px solid var(--line)' }}
                  >
                    <option value="not_done">Open (hide Done)</option>
                    <option value="all">All Status</option>
                    <option value="planned">Planned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Sprint</Form.Label>
                  <Form.Select
                    size="sm"
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
                  <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Theme</Form.Label>
                  <Form.Select
                    size="sm"
                    value={filterTheme}
                    onChange={(e) => setFilterTheme(e.target.value)}
                    style={{ border: '1px solid var(--line)' }}
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
                  <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Type</Form.Label>
                  <Form.Select
                    size="sm"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    style={{ border: '1px solid var(--line)' }}
                  >
                    <option value="all">All Types</option>
                    <option value="task">Task</option>
                    <option value="read">Read</option>
                    <option value="watch">Watch</option>
                    <option value="chore">Chore</option>
                    <option value="habit">Habit</option>
                    <option value="routine">Routine</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '2px', fontSize: '11px' }}>Data Quality</Form.Label>
                  <Form.Select
                    size="sm"
                    value={filterDataQuality}
                    onChange={(e) => setFilterDataQuality(e.target.value)}
                    style={{ border: '1px solid var(--line)' }}
                  >
                    <option value="all">All</option>
                    <option value="missing_any">Missing Any</option>
                    <option value="missing_link">Missing Link</option>
                    <option value="missing_points">Missing Points</option>
                    <option value="missing_description">Missing Description</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            {/* Toggles + Clear Filters merged onto one line — was three separate Rows. */}
            <Row style={{ marginTop: '4px' }}>
              <Col className="d-flex align-items-center flex-wrap" style={{ gap: '4px 20px' }}>
                <Form.Check
                  type="switch"
                  id="filter-due-today"
                  label={<span style={{ fontSize: '11px' }}>Only Due Today</span>}
                  checked={dueFilter === 'today'}
                  onChange={(e) => setDueFilter(e.target.checked ? 'today' : 'all')}
                />
                <Form.Check
                  type="switch"
                  id="filter-top3"
                  label={<span style={{ fontSize: '11px' }}>Top 3 Only</span>}
                  checked={top3Only}
                  onChange={(e) => setTop3Only(e.target.checked)}
                />
                <Form.Check
                  type="switch"
                  id="filter-focus"
                  label={<span style={{ fontSize: '11px' }}>{`Focus only${activeFocusGoalIds.size > 0 ? ` (${activeFocusGoalIds.size})` : ''}`}</span>}
                  checked={focusOnly}
                  disabled={activeFocusGoalIds.size === 0}
                  onChange={(e) => setFocusOnly(e.target.checked)}
                />
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    setFilterStatus('all');
                    setSelectedSprintId('');
                    setFilterTheme('all');
                    setFilterType('all');
                    setFilterDataQuality('all');
                    setSearchTerm('');
                    setDueFilter('all');
                    setTop3Only(false);
                    setFocusOnly(false);
                  }}
                  style={{ borderColor: 'var(--line)', marginLeft: 'auto' }}
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
            ) : viewMode === 'cards' ? (
              <TasksCardView
                tasks={filteredTasks}
                stories={stories}
                goals={goals}
                onTaskUpdate={handleTaskUpdate}
                onTaskDelete={handleTaskDelete}
                onTaskPriorityChange={handleTaskPriorityChange}
                onEditTask={setEditTask}
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
      </div>
      <EditTaskModal
        show={showAddTaskModal}
        task={null}
        onHide={() => setShowAddTaskModal(false)}
        onUpdated={() => setShowAddTaskModal(false)}
      />
      <EditTaskModal
        show={!!editTask}
        task={editTask}
        onHide={() => setEditTask(null)}
        onUpdated={() => setEditTask(null)}
      />
    </div>
  );
};

export default TaskListView;
