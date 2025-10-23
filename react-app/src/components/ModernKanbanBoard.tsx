import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Row, Col, Button, Form, Modal, OverlayTrigger, Tooltip } from 'react-bootstrap';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Edit3, Trash2, Target, BookOpen, Activity, SquarePlus, ListTodo, KanbanSquare, Maximize2, Minimize2, GripVertical, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Story, Goal, Task, Sprint } from '../types';
import { useSprint } from '../contexts/SprintContext';
import { isStatus } from '../utils/statusHelpers';
import { deriveTaskSprint, sprintNameForId } from '../utils/taskSprintHelpers';
import { useActivityTracking } from '../hooks/useActivityTracking';
import { generateRef, displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import EditStoryModal from './EditStoryModal';
import { DnDMutationHandler } from '../utils/dndMutations';
import { themeVars } from '../utils/themeVars';
import '../styles/KanbanCards.css';
import { storyStatusText, taskStatusText, priorityLabel as formatPriorityLabel, priorityPillClass, goalThemeColor, colorWithAlpha } from '../utils/storyCardFormatting';

interface ModernKanbanBoardProps {
  onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
}

type LaneStatus = 'backlog' | 'in-progress' | 'done';

// Droppable Area Component
const DroppableArea: React.FC<{
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ id, children, style }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`drop-lane${isOver ? ' is-over' : ''}`}
      style={{ minHeight: '100px', ...style }}
    >
      {children}
    </div>
  );
};

// Sortable Story Card Component
const SortableStoryCard: React.FC<{
  story: Story;
  goal?: Goal;
  taskCount: number;
  themeColor: string;
  onEdit: (story: Story) => void;
  onDelete: (story: Story) => void;
  onItemClick: (story: Story) => void;
}> = ({ story, goal, taskCount, themeColor, onEdit, onDelete, onItemClick }) => {
  const { showSidebar } = useSidebar();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: story.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleCardClick = () => onItemClick(story);
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onItemClick(story);
    }
  };

  const refLabel = (() => {
    const shortRef = (story as any).referenceNumber || story.ref;
    return shortRef && validateRef(shortRef, 'story')
      ? shortRef
      : displayRefForEntity('story', story.id);
  })();

  const statusLabel = storyStatusText((story as any).status);
  const priorityClass = priorityPillClass(story.priority);
  const priorityLabel = formatPriorityLabel(story.priority);
  const accentColor = themeColor || '#2563eb';
  const handleStyle: React.CSSProperties = {
    color: accentColor,
    borderColor: colorWithAlpha(accentColor, 0.45),
    backgroundColor: colorWithAlpha(accentColor, 0.12)
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`kanban-card kanban-card--story kanban-card__clickable${isDragging ? ' dragging' : ''}`}
        style={{ borderLeft: `3px solid ${((story as any).blocked ? 'var(--bs-danger, #dc3545)' : (themeColor || '#2563eb'))}` }}
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        <button
          type="button"
          className="kanban-card__handle"
          style={handleStyle}
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>

        <div className="kanban-card__content">
          <div className="kanban-card__header">
            <span className="kanban-card__ref" style={{ color: themeColor || '#2563eb' }}>
              {refLabel}
            </span>
            <div className="kanban-card__actions">
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="Activity stream"
                onClick={(event) => {
                  event.stopPropagation();
                  showSidebar(story, 'story');
                }}
              >
                <Activity size={12} />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="AI: Generate tasks for this story"
                onClick={async (event) => {
                  event.stopPropagation();
                  try {
                    const callable = httpsCallable(functions, 'orchestrateStoryPlanning');
                    await callable({ storyId: (story as any).id });
                  } catch (e) {
                    // best-effort; surface minimal alert to user
                    alert((e as any)?.message || 'Failed to orchestrate story planning');
                  }
                }}
              >
                <Wand2 size={12} />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="Edit story"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(story);
                }}
              >
                <Edit3 size={12} />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: 'var(--red)' }}
                title="Delete story"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(story);
                }}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          </div>

          <div className="kanban-card__title" title={story.title || 'Untitled story'}>
            {story.title || 'Untitled story'}
          </div>

          {story.description && story.description.trim().length > 0 && (
            <div className="kanban-card__description">
              {story.description}
            </div>
          )}

          <div className="kanban-card__meta">
            <span className={priorityClass} title={`Priority: ${priorityLabel}`}>
              {priorityLabel}
            </span>
            <span className="kanban-card__meta-badge" title="Story points">
              {(story.points ?? 0)} pts
            </span>
            <span className="kanban-card__meta-text" title="Status">
              {statusLabel}
            </span>
          </div>

          <div className="kanban-card__goal">
            <Target size={12} color={themeColor || '#2563eb'} />
            <span title={goal?.title || 'No goal linked'}>
              {goal?.title || 'No goal'}
            </span>
            <span className="kanban-card__meta-text" style={{ marginLeft: 'auto' }}>
              {taskCount} task{taskCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Sortable Task Card Component
const SortableTaskCard: React.FC<{
  task: Task;
  story?: Story;
  themeColor: string;
  onEdit: (task: Task) => void;
  onItemClick: (task: Task) => void;
}> = ({ task, story, themeColor, onEdit, onItemClick }) => {
  const { showSidebar } = useSidebar();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleCardClick = () => onItemClick(task);
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onItemClick(task);
    }
  };

  const statusLabel = taskStatusText((task as any).status);
  const priorityClass = priorityPillClass(task.priority);
  const priorityLabel = formatPriorityLabel(task.priority);
  const effortLabel = task.effort ? String(task.effort).toUpperCase() : null;
  const estimateLabel = task.estimateMin ? `${task.estimateMin} min` : null;
  const refLabel = task.ref || `TASK-${task.id.slice(-4).toUpperCase()}`;
  const accentColor = themeColor || '#2563eb';
  const handleStyle: React.CSSProperties = {
    color: accentColor,
    borderColor: colorWithAlpha(accentColor, 0.45),
    backgroundColor: colorWithAlpha(accentColor, 0.12)
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`kanban-card kanban-card__clickable${isDragging ? ' dragging' : ''}`}
        style={{ borderLeft: `3px solid ${isStatus((task as any).status, 'blocked') ? 'var(--bs-danger, #dc3545)' : (themeColor || '#2563eb')}`, marginBottom: '10px' }}
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        <button
          type="button"
          className="kanban-card__handle"
          style={handleStyle}
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>

        <div className="kanban-card__content">
          <div className="kanban-card__header">
            <span className="kanban-card__ref" style={{ color: themeColor || '#2563eb' }}>
              {refLabel}
            </span>
            <div className="kanban-card__actions">
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="Activity stream"
                onClick={(event) => {
                  event.stopPropagation();
                  showSidebar(task, 'task');
                }}
              >
                <Activity size={11} />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="Edit task"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(task);
                }}
              >
                <Edit3 size={11} />
              </Button>
            </div>
          </div>

          <div className="kanban-card__title" title={task.title || 'Untitled task'}>
            {task.title || 'Untitled task'}
          </div>

          {task.description && task.description.trim().length > 0 && (
            <div className="kanban-card__description">
              {task.description}
            </div>
          )}

          <div className="kanban-card__meta">
            <span className={priorityClass} title={`Priority: ${priorityLabel}`}>
              {priorityLabel}
            </span>
            {effortLabel && (
              <span className="kanban-card__meta-badge" title="Effort">
                {effortLabel}
              </span>
            )}
            {estimateLabel && (
              <span className="kanban-card__meta-text" title="Time estimate">
                {estimateLabel}
              </span>
            )}
            <span className="kanban-card__meta-text" title="Status">
              {statusLabel}
            </span>
          </div>

          <div className="kanban-card__goal">
            <BookOpen size={12} color={themeColor || '#2563eb'} />
            <span title={story?.title || 'No parent story'}>
              {story?.title || 'No parent story'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ModernKanbanBoard: React.FC<ModernKanbanBoardProps> = ({ onItemSelect }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar, setUpdateHandler } = useSidebar();
  const { selectedSprintId } = useSprint();
  const navigate = useNavigate();
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { trackFieldChange, addNote } = useActivityTracking();
  const iconButtonStyle: React.CSSProperties = {
    width: 38,
    height: 38,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    borderRadius: 10
  };
  
  // Data state
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI state
  const [selectedItem, setSelectedItem] = useState<Story | Task | null>(null);
  const [selectedType, setSelectedType] = useState<'story' | 'task'>('story');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<'story' | 'task'>('story');

  // DnD state
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<Story | Task | null>(null);

  // Form states
  const [editForm, setEditForm] = useState<any>({});
  const [addForm, setAddForm] = useState<any>({});

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === boardContainerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Wire sidebar inline editor to Firestore updates
  useEffect(() => {
    const handler = async (item: Story | Task, type: 'story' | 'task', updates: any) => {
      const col = type === 'story' ? 'stories' : 'tasks';
      const docRef = doc(db, col, (item as any).id);
      let payload: any = { ...updates, updatedAt: serverTimestamp() };
      if (type === 'task' && 'dueDate' in updates) {
        try {
          const existing = tasks.find(t => t.id === (item as any).id);
          if (existing) {
            const derivation = deriveTaskSprint({ task: existing, updates, stories, sprints });
            if (derivation.sprintId && derivation.sprintId !== (existing as any).sprintId) {
              payload.sprintId = derivation.sprintId;
              const sprintName = sprintNameForId(sprints, derivation.sprintId) || derivation.sprintId;
              const due = derivation.dueDateMs ? new Date(derivation.dueDateMs).toISOString().slice(0,10) : 'unknown';
              try {
                await addNote(existing.id, 'task', `Auto-aligned to sprint "${sprintName}" because due date ${due} falls within its window.`, (existing as any).ref);
                await trackFieldChange(existing.id, 'task', 'sprintId', String((existing as any).sprintId || ''), String(derivation.sprintId || ''), (existing as any).ref);
              } catch {}
            }
          }
        } catch {}
      }
      await updateDoc(docRef, payload);
    };
    setUpdateHandler(handler);
  }, [setUpdateHandler, tasks, stories, sprints, addNote, trackFieldChange]);

  // Swim lanes configuration
  const swimLanes: Array<{ id: LaneStatus; title: string; status: LaneStatus; color: string }> = [
    { id: 'backlog', title: 'Backlog', status: 'backlog', color: themeVars.muted as string },
    { id: 'in-progress', title: 'In Progress', status: 'in-progress', color: themeVars.brand as string },
    { id: 'done', title: 'Done', status: 'done', color: 'var(--green)' },
  ];
  const laneIds: LaneStatus[] = swimLanes.map(lane => lane.id);

  // Resolve theme color from goal's theme id or name consistently
  const themeColorForGoal = (goal?: Goal): string => goalThemeColor(goal);

  const normalizeStatusValue = (value: any): string | null => {
    if (typeof value === 'string') {
      return value.trim().toLowerCase().replace(/\s+/g, '-');
    }
    return null;
  };

  const storyLaneForStatus = (story: Story): LaneStatus => {
    const raw = (story as any).status;
    if (typeof raw === 'number') {
      if (isStatus(raw, 'Blocked')) return 'in-progress';
      if (isStatus(raw, 'done') || isStatus(raw, 'Complete')) return 'done';
      if (isStatus(raw, 'active') || isStatus(raw, 'in-progress') || isStatus(raw, 'testing')) return 'in-progress';
      return 'backlog';
    }
    const normalized = normalizeStatusValue(raw);
    if (!normalized) return 'backlog';
    if (['done', 'complete', 'completed', 'finished'].includes(normalized)) return 'done';
    if (['blocked', 'stalled', 'waiting', 'on-hold', 'onhold', 'paused'].includes(normalized)) return 'in-progress';
    if (['in-progress', 'inprogress', 'active', 'doing', 'testing', 'qa', 'review'].includes(normalized)) return 'in-progress';
    return 'backlog';
  };

  const taskLaneForStatus = (task: Task): LaneStatus => {
    const raw = (task as any).status;
    if (typeof raw === 'number') {
      if (raw === 3 || isStatus(raw, 'blocked')) return 'in-progress';
      if (raw >= 2) return 'done';
      if (raw === 1) return 'in-progress';
      return 'backlog';
    }
    const normalized = normalizeStatusValue(raw);
    if (!normalized) return 'backlog';
    if (['done', 'complete', 'completed', 'finished'].includes(normalized)) return 'done';
    if (['blocked', 'stalled', 'waiting', 'on-hold', 'onhold', 'paused'].includes(normalized)) return 'in-progress';
    if (['in-progress', 'inprogress', 'active', 'doing'].includes(normalized)) return 'in-progress';
    return 'backlog';
  };

  const storyStatusForLane = (story: Story, lane: LaneStatus): string | number => {
    const raw = (story as any).status;
    if (typeof raw === 'number') {
      if (lane === 'backlog') return 0;
      if (lane === 'in-progress') return 2;
      return 4;
    }
    if (lane === 'backlog') return 'backlog';
    if (lane === 'in-progress') return 'in-progress';
    return 'done';
  };

  const taskStatusForLane = (task: Task, lane: LaneStatus): string | number => {
    const raw = (task as any).status;
    if (typeof raw === 'number') {
      if (lane === 'backlog') return 0;
      if (lane === 'in-progress') return 1;
      return 2;
    }
    if (lane === 'backlog') return 'backlog';
    if (lane === 'in-progress') return 'in-progress';
    return 'done';
  };

  // Helper functions
  const getGoalForStory = (storyId: string): Goal | undefined => {
    const story = stories.find(s => s.id === storyId);
    return story ? goals.find(g => g.id === story.goalId) : undefined;
  };

  const getStoryForTask = (taskId: string): Story | undefined => {
    const task = tasks.find(t => t.id === taskId);
    return task ? stories.find(s => s.id === task.parentId) : undefined;
  };

  const getTasksForStory = (storyId: string): Task[] => {
    return tasks.filter(task => task.parentId === storyId);
  };

  // Sprint-aware filtering
  // When "All Sprints" is selected (selectedSprintId === ''), do not filter by sprint.
  // Only use active sprint fallback when no explicit selection is present (undefined/null).
  const resolvedSprintId = (selectedSprintId === '' ? undefined : selectedSprintId) 
    ?? (sprints.find(s => isStatus(s.status, 'active'))?.id);
  const storiesInScope = resolvedSprintId
    ? stories.filter(s => (s as any).sprintId === resolvedSprintId)
    : stories;

  const resolvedSprint = resolvedSprintId
    ? sprints.find(s => (s as any).id === resolvedSprintId)
    : undefined;

  const sprintStartMs = (() => {
    const v = resolvedSprint?.startDate as any;
    if (!v) return null;
    if (typeof v === 'number') return v;
    if (v?.toDate) return v.toDate().getTime();
    const parsed = Date.parse(String(v));
    return Number.isNaN(parsed) ? null : parsed;
  })();

  const sprintEndMs = (() => {
    const v = resolvedSprint?.endDate as any;
    if (!v) return null;
    if (typeof v === 'number') return v;
    if (v?.toDate) return v.toDate().getTime();
    const parsed = Date.parse(String(v));
    return Number.isNaN(parsed) ? null : parsed;
  })();

  const isDueDateInSprint = (task: Task): boolean => {
    if (!resolvedSprintId || !sprintStartMs || !sprintEndMs) return false;
    const raw = (task as any).dueDate ?? (task as any).dueDateMs ?? (task as any).targetDate ?? null;
    if (!raw) return false;
    let ms: number | null = null;
    if (typeof raw === 'number') ms = raw;
    else if ((raw as any)?.toDate) ms = (raw as any).toDate().getTime();
    else {
      const parsed = Date.parse(String(raw));
      ms = Number.isNaN(parsed) ? null : parsed;
    }
    if (!ms) return false;
    return ms >= sprintStartMs && ms <= sprintEndMs;
  };

  const tasksInScope = resolvedSprintId
    ? tasks.filter(t => {
        const explicit = (t as any).sprintId === resolvedSprintId;
        return explicit || isDueDateInSprint(t);
      })
    : tasks;

  const getStoriesForLane = (status: string): Story[] => {
    const lane = (status as LaneStatus) || 'backlog';
    return storiesInScope.filter(story => storyLaneForStatus(story) === lane);
  };

  const getTasksForLane = (status: string): Task[] => {
    const lane = (status as LaneStatus) || 'backlog';
    return tasksInScope.filter(task => taskLaneForStatus(task) === lane);
  };

  const parseDroppableId = (id: string): { lane: LaneStatus; type: 'stories' | 'tasks' } | null => {
    const storySuffix = '-stories';
    if (id.endsWith(storySuffix)) {
      const lane = id.slice(0, -storySuffix.length) as LaneStatus;
      if (laneIds.includes(lane)) {
        return { lane, type: 'stories' };
      }
    }
    const taskSuffix = '-tasks';
    if (id.endsWith(taskSuffix)) {
      const lane = id.slice(0, -taskSuffix.length) as LaneStatus;
      if (laneIds.includes(lane)) {
        return { lane, type: 'tasks' };
      }
    }
    return null;
  };

  const resolveDropTarget = (overId: string, activeId: string): { lane: LaneStatus; type: 'stories' | 'tasks' } | null => {
    const parsed = parseDroppableId(overId);
    if (parsed) return parsed;

    const story = stories.find(s => s.id === overId);
    if (story) return { lane: storyLaneForStatus(story), type: 'stories' };

    const task = tasks.find(t => t.id === overId);
    if (task) return { lane: taskLaneForStatus(task), type: 'tasks' };

    // When dragging over combined droppable area, fallback to active item's current lane
    const activeStory = stories.find(s => s.id === activeId);
    if (activeStory) return { lane: storyLaneForStatus(activeStory), type: 'stories' };
    const activeTask = tasks.find(t => t.id === activeId);
    if (activeTask) return { lane: taskLaneForStatus(activeTask), type: 'tasks' };

    return null;
  };

  // Data loading effect
  useEffect(() => {
    if (!currentUser || !currentPersona) return;

    const setupData = async () => {
      setLoading(true);

      // Set up real-time listeners
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );

      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );

      const tasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );

      const sprintsQuery = query(
        collection(db, 'sprints'),
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

      const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Story[];
        setStories(storiesData);
      });

      const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
        const tasksData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        setTasks(tasksData);
        setLoading(false);
      });

      const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
        const sprintsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Sprint[];
        setSprints(sprintsData);
      });

      return () => {
        unsubscribeGoals();
        unsubscribeStories();
        unsubscribeTasks();
        unsubscribeSprints();
      };
    };

    setupData();
  }, [currentUser, currentPersona]);

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
    
    const story = stories.find(s => s.id === event.active.id);
    const task = tasks.find(t => t.id === event.active.id);
    
    setActiveDragItem(story || task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveId(null);
    setActiveDragItem(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const target = resolveDropTarget(overId, activeId);
    if (!target) return;

    const activeIsStory = stories.some(s => s.id === activeId);
    const activeIsTask = tasks.some(t => t.id === activeId);

    if (target.type === 'stories' && !activeIsStory) return;
    if (target.type === 'tasks' && !activeIsTask) return;

    try {
      if (target.type === 'stories') {
        const story = stories.find(s => s.id === activeId);
        if (!story) return;
        const currentLane = storyLaneForStatus(story);
        if (currentLane === target.lane) return;

        const nextStatus = storyStatusForLane(story, target.lane);
        await updateDoc(doc(db, 'stories', activeId), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
        try {
          const oldLabel = String((story as any).status ?? '');
          const newLabel = String(nextStatus);
          if (oldLabel !== newLabel) {
            await trackFieldChange(story.id, 'story', 'status', oldLabel, newLabel, (story as any).ref);
          }
        } catch {}
      } else {
        const task = tasks.find(t => t.id === activeId);
        if (!task) return;
        const currentLane = taskLaneForStatus(task);
        if (currentLane === target.lane) return;

        const nextStatus = taskStatusForLane(task, target.lane);
        await updateDoc(doc(db, 'tasks', activeId), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
        try {
          const oldLabel = String((task as any).status ?? '');
          const newLabel = String(nextStatus);
          if (oldLabel !== newLabel) {
            await trackFieldChange(task.id, 'task', 'status', oldLabel, newLabel, (task as any).ref);
          }
        } catch {}
      }
    } catch (error) {
      console.error('Error updating item status:', error);
    }
  };

  // Event handlers
  const handleItemClick = (item: Story | Task, type: 'story' | 'task') => {
    showSidebar(item, type);
    if (onItemSelect) {
      onItemSelect(item, type);
    }
  };

  const handleEdit = (item: Story | Task, type: 'story' | 'task') => {
    setSelectedItem(item);
    setSelectedType(type);
    setEditForm(item);
    setShowEditModal(true);
  };

  const handleDelete = async (item: Story | Task, type: 'story' | 'task') => {
    if (window.confirm(`Are you sure you want to delete this ${type}?`)) {
      try {
        const collection_name = type === 'story' ? 'stories' : 'tasks';
        await deleteDoc(doc(db, collection_name, item.id));
      } catch (error) {
        console.error(`Error deleting ${type}:`, error);
      }
    }
  };

  const handleAdd = (type: 'story' | 'task') => {
    setAddType(type);
    setAddForm({});
    setShowAddModal(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedItem || !editForm.title) return;

    try {
      const collection_name = selectedType === 'story' ? 'stories' : 'tasks';
      const docRef = doc(db, collection_name, selectedItem.id);
      let payload: any = { ...editForm, updatedAt: serverTimestamp() };

      if (selectedType === 'task') {
        const existing = tasks.find(t => t.id === selectedItem.id);
        if (existing) {
          const updates: any = {};
          if ('dueDate' in editForm) updates.dueDate = (editForm as any).dueDate;
          if (Object.keys(updates).length) {
            const derivation = deriveTaskSprint({ task: existing, updates, stories, sprints });
            if (derivation.sprintId && derivation.sprintId !== (existing as any).sprintId) {
              payload.sprintId = derivation.sprintId;
              // log alignment reason
              const sprintName = sprintNameForId(sprints, derivation.sprintId) || derivation.sprintId;
              const due = derivation.dueDateMs ? new Date(derivation.dueDateMs).toISOString().slice(0,10) : 'unknown';
              try {
                await addNote(existing.id, 'task', `Auto-aligned to sprint "${sprintName}" because due date ${due} falls within its window.` , (existing as any).ref);
                await trackFieldChange(existing.id, 'task', 'sprintId', String((existing as any).sprintId || ''), String(derivation.sprintId), (existing as any).ref);
              } catch {}
            }
          }
        }
      }

      await updateDoc(docRef, payload);
      setShowEditModal(false);
    } catch (error) {
      console.error('Error updating item:', error);
    }
  };

  const handleSaveAdd = async () => {
    if (!addForm.title) return;

    try {
      // Generate unique reference
      const collection_name = addType === 'story' ? 'stories' : 'tasks';
      const existingItems = await getDocs(query(
        collection(db, collection_name),
        where('ownerUid', '==', currentUser?.uid),
        where('persona', '==', currentPersona)
      ));
      const existingRefs = existingItems.docs.map(doc => doc.data().ref).filter(Boolean) as string[];
      const ref = generateRef(addType, existingRefs);
      
      await addDoc(collection(db, collection_name), {
        ...addForm,
        ref,
        ownerUid: currentUser?.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      setShowAddModal(false);
    } catch (error) {
      console.error('Error adding item:', error);
    }
  };

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === boardContainerRef.current) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } else if (boardContainerRef.current?.requestFullscreen) {
        await boardContainerRef.current.requestFullscreen();
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
    }
  }, []);

  const handleOpenPlanningMatrix = useCallback(() => {
    navigate('/sprints/planning');
  }, [navigate]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: themeVars.bg }}>
        <div style={{ textAlign: 'center', paddingTop: '100px' }}>
          <div className="spinner-border" style={{ marginBottom: '16px' }} />
          <p style={{ color: themeVars.muted }}>Loading kanban board...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: themeVars.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: themeVars.text }}>
          Stories Kanban Board
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <OverlayTrigger placement="bottom" overlay={<Tooltip id="add-story-tip">Add story</Tooltip>}>
            <Button
              variant="outline-primary"
              onClick={() => handleAdd('story')}
              aria-label="Add story"
              style={iconButtonStyle}
            >
              <SquarePlus size={16} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip id="add-task-tip">Add task</Tooltip>}>
            <Button
              variant="outline-secondary"
              onClick={() => handleAdd('task')}
              aria-label="Add task"
              style={iconButtonStyle}
            >
              <ListTodo size={16} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip id="planning-matrix-tip">Open planning matrix</Tooltip>}>
            <Button
              variant="outline-secondary"
              onClick={handleOpenPlanningMatrix}
              aria-label="Open planning matrix"
              style={iconButtonStyle}
            >
              <KanbanSquare size={16} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip id="fullscreen-tip">{isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}</Tooltip>}>
            <Button
              variant="outline-secondary"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              style={iconButtonStyle}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </Button>
          </OverlayTrigger>
        </div>
      </div>

      <div
        ref={boardContainerRef}
        style={{
          position: 'relative',
          backgroundColor: themeVars.panel,
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)',
        }}
      >
        {isFullscreen && (
          <Button
            variant="light"
            size="sm"
            onClick={toggleFullscreen}
            style={{
              position: 'fixed',
              top: '16px',
              right: '24px',
              zIndex: 1100,
              boxShadow: '0 6px 18px rgba(15, 23, 42, 0.25)',
            }}
          >
            <Minimize2 size={14} className="me-1" />
            Exit Fullscreen
          </Button>
        )}

        {/* Kanban Board */}
        <DndContext 
          sensors={sensors} 
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <Row style={{ minHeight: '600px' }}>
          {swimLanes.map((lane) => {
            const lgCols = Math.max(1, Math.floor(12 / swimLanes.length));
            const mdCols = Math.min(12, Math.max(6, lgCols * 2));
            return (
            <Col xs={12} md={mdCols as any} lg={lgCols as any} key={lane.id} style={{ marginBottom: '20px' }}>
              <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <Card.Header style={{ 
                  backgroundColor: lane.color, 
                  color: themeVars.onAccent,
                  padding: '16px 20px',
                  border: 'none'
                }}>
                  <h5 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                    {lane.title}
                  </h5>
                </Card.Header>
                <Card.Body style={{ padding: '16px' }}>
                  {/* Stories Section */}
                  <div style={{ marginBottom: '24px' }}>
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: themeVars.text, marginBottom: '12px' }}>
                      Stories
                    </h6>
                    <DroppableArea id={`${lane.status}-stories`}>
                      <SortableContext 
                        items={getStoriesForLane(lane.status).map(story => story.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {getStoriesForLane(lane.status).map((story) => {
                          const goal = getGoalForStory(story.id);
                          const taskCount = getTasksForStory(story.id).length;
                          const themeColor = themeColorForGoal(goal);
                          
                          return (
                            <SortableStoryCard
                              key={story.id}
                              story={story}
                              goal={goal}
                              taskCount={taskCount}
                              themeColor={themeColor}
                              onEdit={(story) => handleEdit(story, 'story')}
                              onDelete={(story) => handleDelete(story, 'story')}
                              onItemClick={(story) => handleItemClick(story, 'story')}
                            />
                          );
                        })}
                      </SortableContext>
                    </DroppableArea>
                  </div>

                  {/* Tasks Section */}
                  <div>
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: themeVars.text, marginBottom: '12px' }}>
                      Tasks
                    </h6>
                    <DroppableArea id={`${lane.status}-tasks`}>
                      <SortableContext 
                        items={getTasksForLane(lane.status).map(task => task.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {getTasksForLane(lane.status).map((task) => {
                          const story = getStoryForTask(task.id);
                          const goal = story ? getGoalForStory(story.id) : undefined;
                          const themeColor = themeColorForGoal(goal);
                          
                          return (
                            <SortableTaskCard
                              key={task.id}
                              task={task}
                              story={story}
                              themeColor={themeColor}
                              onEdit={(task) => handleEdit(task, 'task')}
                              onItemClick={(task) => handleItemClick(task, 'task')}
                            />
                          );
                        })}
                      </SortableContext>
                    </DroppableArea>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          );})}
        </Row>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeDragItem && (
            <div style={{ opacity: 0.8 }}>
              {'points' in activeDragItem ? (
                <div>Story: {activeDragItem.title}</div>
              ) : (
                <div>Task: {activeDragItem.title}</div>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      </div>

      {/* Edit Modals */}
      {selectedType === 'story' && (
        <EditStoryModal
          show={showEditModal}
          onHide={() => setShowEditModal(false)}
          story={selectedItem as Story | null}
          goals={goals}
          onStoryUpdated={() => setShowEditModal(false)}
        />
      )}
      {selectedType === 'task' && (
        <Modal show={showEditModal} onHide={() => setShowEditModal(false)} size="lg">
          <Modal.Header closeButton>
            <Modal.Title>Edit Task</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selectedItem && (
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Title *</Form.Label>
                  <Form.Control
                    type="text"
                    value={(editForm as any).title || ''}
                    onChange={(e) => setEditForm({ ...(editForm as any), title: e.target.value })}
                    required
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={(editForm as any).description || ''}
                    onChange={(e) => setEditForm({ ...(editForm as any), description: e.target.value })}
                  />
                </Form.Group>
                <Row>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Status</Form.Label>
                      <Form.Select
                        value={typeof (editForm as any).status === 'number' ? (editForm as any).status : Number((editForm as any).status) || 0}
                        onChange={(e) => setEditForm({ ...(editForm as any), status: Number(e.target.value) })}
                      >
                        <option value={0}>Backlog</option>
                        <option value={1}>In Progress</option>
                        <option value={2}>Done</option>
                        <option value={3}>Blocked</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Due Date</Form.Label>
                      <Form.Control
                        type="date"
                        value={(editForm as any).dueDate ? new Date((editForm as any).dueDate).toISOString().slice(0,10) : ''}
                        onChange={(e) => setEditForm({ ...(editForm as any), dueDate: e.target.value ? new Date(e.target.value).getTime() : null })}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Source</Form.Label>
                      <Form.Control value={(selectedItem as any).source || 'web'} readOnly />
                    </Form.Group>
                  </Col>
                </Row>
              </Form>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Add Modal */}
      <Modal show={showAddModal} onHide={() => setShowAddModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Add {addType === 'story' ? 'Story' : 'Task'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title *</Form.Label>
              <Form.Control
                type="text"
                value={addForm.title || ''}
                onChange={(e) => setAddForm({...addForm, title: e.target.value})}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={addForm.description || ''}
                onChange={(e) => setAddForm({...addForm, description: e.target.value})}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Status</Form.Label>
              {addType === 'story' ? (
                <Form.Select
                  value={addForm.status ?? 0}
                  onChange={(e) => setAddForm({ ...addForm, status: Number(e.target.value) })}
                >
                  <option value={0}>Backlog</option>
                  <option value={2}>In Progress</option>
                  <option value={4}>Done</option>
                </Form.Select>
              ) : (
                <Form.Select
                  value={addForm.status ?? 0}
                  onChange={(e) => setAddForm({ ...addForm, status: Number(e.target.value) })}
                >
                  <option value={0}>To Do</option>
                  <option value={1}>In Progress</option>
                  <option value={2}>Done</option>
                </Form.Select>
              )}
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveAdd}>
            Add {addType === 'story' ? 'Story' : 'Task'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default ModernKanbanBoard;
