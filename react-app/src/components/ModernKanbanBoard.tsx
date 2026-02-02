import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, Row, Col, Button, Form, Modal } from 'react-bootstrap';
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
import { pointerWithin } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Edit3, Trash2, Target, BookOpen, Activity, Plus, List, Grid, Maximize2, Minimize2, GripVertical, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, getDocs, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
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
import AddStoryModal from './AddStoryModal';
import { DnDMutationHandler } from '../utils/dndMutations';
import { themeVars } from '../utils/themeVars';
import '../styles/KanbanCards.css';
import '../styles/KanbanFixes.css';
import { storyStatusText, taskStatusText, priorityLabel as formatPriorityLabel, priorityPillClass, goalThemeColor, colorWithAlpha } from '../utils/storyCardFormatting';
import SortableStoryCard from './stories/SortableStoryCard';
import { normalizePriorityValue, isCriticalPriority } from '../utils/priorityUtils';

const formatDueDate = (task: Task): string => {
  const ms = getTaskDueMs(task);
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)}`;
};

const getTaskDueMs = (task: Task): number | null => {
  const fields = ['dueDate', 'dueDateMs', 'dueAt', 'targetDate'];
  for (const field of fields) {
    const raw = (task as any)[field];
    if (raw == null) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'object' && typeof (raw as any)?.toDate === 'function') {
      return (raw as any).toDate().getTime();
    }
    const parsed = Date.parse(String(raw));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

const isTaskOverdue = (task: Task): boolean => {
  const due = getTaskDueMs(task);
  return due != null && due < Date.now();
};

const daysOverdue = (task: Task): number | null => {
  const due = getTaskDueMs(task);
  if (due == null) return null;
  const delta = Date.now() - due;
  if (delta <= 0) return 0;
  return Math.ceil(delta / 86400000);
};

const getStoryDueMs = (story: Story): number | null => {
  const fields = ['dueDate', 'targetDate', 'plannedEndDate', 'plannedStartDate'];
  for (const field of fields) {
    const raw = (story as any)[field];
    if (raw == null) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'object' && typeof (raw as any)?.toDate === 'function') {
      return (raw as any).toDate().getTime();
    }
    const parsed = Date.parse(String(raw));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

const getAiScoreValue = (item: Story | Task): number => {
  const raw = (item as any).aiCriticalityScore ?? (item as any).aiPriorityScore ?? null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

const matchesCriticalOrHighAi = (item: Story | Task): boolean => {
  return isCriticalPriority(item.priority) || getAiScoreValue(item) >= 90;
};

const isTaskLinkedToStory = (task: Task): boolean => !!(task.storyId && String(task.storyId).trim());
const isStoryLinkedToGoal = (story: Story): boolean => !!(story.goalId && String(story.goalId).trim());

interface ModernKanbanBoardProps {
  onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
  // Optional: constrain tasks to a sprint window (dueDate within [start,end])
  sprintDueDateRange?: { start: number; end: number } | null;
  // Optional: allowed task status values (defaults to [0,1,3] = not done)
  statusFilter?: number[];
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
      style={{ minHeight: '100px', padding: '8px', ...style }}
    >
      {children}
    </div>
  );
};

// Broad lane-level droppable to allow forgiving drops anywhere in a column
const LaneDroppable: React.FC<{ id: string; children: React.ReactNode; style?: React.CSSProperties }>
  = ({ id, children, style }) => {
    const { setNodeRef, isOver } = useDroppable({ id });
    return (
      <div ref={setNodeRef} className={`lane-drop-target${isOver ? ' is-over' : ''}`} style={style}>
        {children}
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
  const pointsValue = Number((task as any).points);
  const pointsLabel = Number.isFinite(pointsValue) ? `${pointsValue} pts` : null;
  const refLabel = task.ref || `TASK-${task.id.slice(-4).toUpperCase()}`;
  const accentColor = themeColor || '#2563eb';
  const handleStyle: React.CSSProperties = {
    color: accentColor,
    borderColor: colorWithAlpha(accentColor, 0.45),
    backgroundColor: colorWithAlpha(accentColor, 0.12)
  };

  const taskPriorityValue = normalizePriorityValue(task.priority);
  const isCriticalTask = taskPriorityValue >= 4;
  const criticalAccent = isCriticalTask
    ? {
      boxShadow: '0 0 0 2px rgba(251, 191, 36, 0.45)',
      border: '1px solid rgba(251, 191, 36, 0.8)',
    }
    : {};

  const [converting, setConverting] = useState(false);

  const handleConvertToStory = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (converting) return;
    setConverting(true);
    try {
      const suggest = httpsCallable(functions, 'suggestTaskStoryConversions');
      const convert = httpsCallable(functions, 'convertTasksToStories');
      const resp: any = await suggest({ persona: (task as any).persona || 'personal', taskIds: [task.id], limit: 1 });
      const suggestions: any[] = Array.isArray(resp?.data?.suggestions) ? resp.data.suggestions : [];
      const s = suggestions.find(x => x.taskId === task.id) || suggestions[0] || {};
      const storyTitle = (s.storyTitle || task.title || 'New Story').slice(0, 140);
      const storyDescription = (s.storyDescription || (task as any).description || '').slice(0, 1200);
      const goalId = s.goalId || (task as any).goalId || null;
      await convert({ conversions: [{ taskId: task.id, storyTitle, storyDescription, goalId }] });
    } catch (e) {
      console.warn('[Kanban] convert to story failed', e);
      alert('Could not convert this task to a story. Try again.');
    } finally {
      setConverting(false);
    }
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`kanban-card kanban-card--task kanban-card__clickable${isDragging ? ' dragging' : ''}`}
        style={{
          borderLeft: `3px solid ${isStatus((task as any).status, 'blocked') ? 'var(--bs-danger, #dc3545)' : (themeColor || '#2563eb')}`,
          marginBottom: '10px',
          ...criticalAccent,
        }}
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
                title={converting ? 'Converting…' : 'Convert to Story'}
                onClick={handleConvertToStory}
                onPointerDown={(e) => e.stopPropagation()}
                disabled={converting}
              >
                <Wand2 size={11} />
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
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Edit3 size={11} />
              </Button>
            </div>
          </div>

          {isCriticalTask && (
            <div
              style={{
                margin: '6px 12px 0 12px',
                padding: '4px 10px',
                borderRadius: '6px',
                backgroundColor: '#fef3c7',
                border: '1px solid rgba(251, 191, 36, 0.4)',
                color: '#92400e',
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              <span>Critical</span>
              <span aria-hidden="true">!</span>
            </div>
          )}

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
            {pointsLabel && (
              <span className="kanban-card__meta-badge" title="Story points">
                {pointsLabel}
              </span>
            )}
            <span className="kanban-card__meta-text" title="Due date">
              Due {formatDueDate(task)}
            </span>
            {(() => {
              const overdue = daysOverdue(task);
              if (!overdue || overdue <= 0) return null;
              return (
                <span className="kanban-card__meta-badge pill-danger" title="Overdue">
                  {overdue}d overdue
                </span>
              );
            })()}
            {(task as any).aiCriticalityScore != null && (
              <span
                className="kanban-card__meta-badge"
                title={`AI score ${Math.round(Number((task as any).aiCriticalityScore))}/100`}
              >
                AI {Math.round(Number((task as any).aiCriticalityScore))}
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

const ModernKanbanBoard: React.FC<ModernKanbanBoardProps> = ({ onItemSelect, sprintDueDateRange = null, statusFilter }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar, setUpdateHandler } = useSidebar();
  const { selectedSprintId } = useSprint();
  const navigate = useNavigate();
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
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
  const { sprints } = useSprint();
  const [loading, setLoading] = useState(true);

  // UI state
  const [selectedItem, setSelectedItem] = useState<Story | Task | null>(null);
  const [selectedType, setSelectedType] = useState<'story' | 'task'>('story');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddStoryModal, setShowAddStoryModal] = useState(false);
  const [addType, setAddType] = useState<'story' | 'task'>('story');

  // DnD state
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<Story | Task | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  // Form states
  const [editForm, setEditForm] = useState<any>({});
  const [addForm, setAddForm] = useState<any>({});
  const [filterCriticalOnly, setFilterCriticalOnly] = useState(false);
  const [filterCriticalAiOnly, setFilterCriticalAiOnly] = useState(false);
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);
  const [filterUnlinkedStoriesOnly, setFilterUnlinkedStoriesOnly] = useState(false);
  const [filterUnlinkedTasksOnly, setFilterUnlinkedTasksOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'default' | 'ai' | 'overdue' | 'priority' | 'due'>('default');

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

  // Dynamically size the scrollable board area to use the full viewport height
  const recomputeBoardHeight = useCallback(() => {
    try {
      const el = boardContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top = rect.top; // distance from viewport top
      const margin = 24; // a little breathing room
      const h = Math.max(320, Math.floor((window.innerHeight || document.documentElement.clientHeight) - top - margin));
      setBoardHeight(h);
    } catch { }
  }, []);

  useEffect(() => {
    recomputeBoardHeight();
    window.addEventListener('resize', recomputeBoardHeight);
    let ro: any = null;
    try {
      const RO = (window as any).ResizeObserver;
      if (typeof RO === 'function') {
        ro = new RO(() => {
          // Batch callback to next tick to avoid layout thrash
          if (resizeRafRef.current != null) {
            cancelAnimationFrame(resizeRafRef.current);
          }
          resizeRafRef.current = requestAnimationFrame(() => {
            resizeRafRef.current = null;
            recomputeBoardHeight();
          });
        });
        if (boardContainerRef.current) ro.observe(boardContainerRef.current);
      }
    } catch { }
    return () => {
      window.removeEventListener('resize', recomputeBoardHeight);
      try { if (ro) ro.disconnect(); } catch { }
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
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
              const due = derivation.dueDateMs ? new Date(derivation.dueDateMs).toISOString().slice(0, 10) : 'unknown';
              try {
                await addNote(existing.id, 'task', `Auto-aligned to sprint "${sprintName}" because due date ${due} falls within its window.`, (existing as any).ref);
                await trackFieldChange(existing.id, 'task', 'sprintId', String((existing as any).sprintId || ''), String(derivation.sprintId || ''), (existing as any).ref);
              } catch { }
            }
          }
        } catch { }
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
      // Only treat canonical done (4+) as done; avoid goal 'Complete' mapping
      if (raw >= 4 || isStatus(raw, 'done')) return 'done';
      if (raw >= 2 || isStatus(raw, 'active') || isStatus(raw, 'in-progress') || isStatus(raw, 'testing')) return 'in-progress';
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

  const filteredStories = storiesInScope.filter((story) => {
    if (filterCriticalOnly && !isCriticalPriority(story.priority)) return false;
    if (filterCriticalAiOnly && !matchesCriticalOrHighAi(story)) return false;
    if (filterUnlinkedStoriesOnly && isStoryLinkedToGoal(story)) return false;
    return true;
  });

  const filteredTasks = tasksInScope.filter((task) => {
    if (filterCriticalOnly && !isCriticalPriority(task.priority)) return false;
    if (filterCriticalAiOnly && !matchesCriticalOrHighAi(task)) return false;
    if (filterOverdueOnly && !isTaskOverdue(task)) return false;
    if (filterUnlinkedTasksOnly && isTaskLinkedToStory(task)) return false;
    return true;
  });

  const sortedStories = useMemo(() => {
    const arr = [...filteredStories];
    const now = Date.now();
    const score = getAiScoreValue;
    const dueMs = (story: Story) => getStoryDueMs(story);
    arr.sort((a, b) => {
      if (sortMode === 'ai') return (score(b) || -Infinity) - (score(a) || -Infinity);
      if (sortMode === 'overdue') {
        const da = dueMs(a); const db = dueMs(b);
        const oa = da != null ? Math.max(0, now - da) : -Infinity;
        const ob = db != null ? Math.max(0, now - db) : -Infinity;
        return ob - oa;
      }
      if (sortMode === 'priority') return normalizePriorityValue(b.priority) - normalizePriorityValue(a.priority);
      return 0;
    });
    return arr;
  }, [filteredStories, sortMode]);

  const sortedTasks = useMemo(() => {
    const arr = [...filteredTasks];
    const now = Date.now();
    const score = getAiScoreValue;
    const overdueMs = (task: Task) => {
      const due = getTaskDueMs(task);
      if (due == null) return -Infinity;
      return Math.max(0, now - due);
    };
    arr.sort((a, b) => {
      if (sortMode === 'ai') return (score(b) || -Infinity) - (score(a) || -Infinity);
      if (sortMode === 'due') return (getTaskDueMs(a) || Infinity) - (getTaskDueMs(b) || Infinity);
      if (sortMode === 'overdue') return overdueMs(b) - overdueMs(a);
      if (sortMode === 'priority') return normalizePriorityValue(b.priority) - normalizePriorityValue(a.priority);
      return 0;
    });
    return arr;
  }, [filteredTasks, sortMode]);

  const getStoriesForLane = (status: string): Story[] => {
    const lane = (status as LaneStatus) || 'backlog';
    return sortedStories.filter(story => storyLaneForStatus(story) === lane);
  };

  const getTasksForLane = (status: string): Task[] => {
    const lane = (status as LaneStatus) || 'backlog';
    return sortedTasks.filter(task => taskLaneForStatus(task) === lane);
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
    const lanePrefix = 'lane-';
    if (id.startsWith(lanePrefix)) {
      const lane = id.slice(lanePrefix.length) as LaneStatus;
      if (laneIds.includes(lane)) {
        // When dropping on a lane, infer type from the active item in resolveDropTarget
        return { lane, type: 'stories' } as any;
      }
    }
    return null;
  };

  const resolveDropTarget = (overId: string, activeId: string): { lane: LaneStatus; type: 'stories' | 'tasks' } | null => {
    const parsed = parseDroppableId(overId);
    if (parsed) {
      // If the target is a lane, derive type based on dragged entity
      if ((parsed as any).type === undefined || (overId || '').startsWith('lane-')) {
        const isStory = stories.some(s => s.id === activeId);
        return { lane: parsed.lane, type: isStory ? 'stories' : 'tasks' };
      }
      return parsed;
    }

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

    setLoading(true);

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc'),
      limit(1000)
    );

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc'),
      limit(1000)
    );

    // Prefer materialized sprint_task_index to avoid downloading all tasks
    let tasksQuery;
    const sprintKey = (resolvedSprintId && resolvedSprintId !== '') ? resolvedSprintId : '__none__';
    if (resolvedSprintId !== undefined) {
      // Specific sprint or backlog sentinel
      tasksQuery = query(
        collection(db, 'sprint_task_index'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        where('sprintId', '==', sprintKey),
        orderBy('dueDate', 'asc'),
        limit(1000)
      );
    } else {
      // All sprints: still use index but without sprint filter
      tasksQuery = query(
        collection(db, 'sprint_task_index'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('dueDate', 'asc'),
        limit(1000)
      );
    }

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
    }, (error) => console.warn('[Kanban] goals subscribe error', error?.message || error));

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storiesData);
    }, (error) => console.warn('[Kanban] stories subscribe error', error?.message || error));

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      // Map index docs to Task-like shape expected by board UI
      const tasksData = snapshot.docs.map(d => {
        const x = d.data() as any;
        const t: any = {
          id: d.id,
          title: x.title,
          description: x.description || '',
          status: x.status,
          priority: x.priority ?? 2,
          effort: x.effort ?? 'M',
          estimateMin: x.estimateMin ?? 0,
          dueDate: x.dueDate || null,
          parentType: x.parentType || 'story',
          parentId: x.parentId || x.storyId || '',
          storyId: x.storyId || null,
          sprintId: x.sprintId && x.sprintId !== '__none__' ? x.sprintId : null,
          persona: currentPersona,
          ownerUid: currentUser.uid,
          ref: x.ref || `TASK-${String(d.id).slice(-4).toUpperCase()}`,
        };
        return t as Task;
      });
      setTasks(tasksData);
      setLoading(false);
    }, (error) => {
      console.warn('[Kanban] tasks subscribe error', error?.message || error);
      setLoading(false);
    });

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeTasks();
    };
  }, [currentUser, currentPersona, resolvedSprintId, sprintDueDateRange?.start, sprintDueDateRange?.end, Array.isArray(statusFilter) ? statusFilter.join(',') : '']);

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
        } catch { }
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
        } catch { }
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
    if (type === 'story') {
      setShowAddStoryModal(true);
    } else {
      setAddForm({});
      setShowAddModal(true);
    }
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
              const due = derivation.dueDateMs ? new Date(derivation.dueDateMs).toISOString().slice(0, 10) : 'unknown';
              try {
                await addNote(existing.id, 'task', `Auto-aligned to sprint "${sprintName}" because due date ${due} falls within its window.`, (existing as any).ref);
                await trackFieldChange(existing.id, 'task', 'sprintId', String((existing as any).sprintId || ''), String(derivation.sprintId), (existing as any).ref);
              } catch { }
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
    <div style={{ minHeight: '100vh', padding: '12px', backgroundColor: themeVars.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: themeVars.text }}>
          Stories Kanban Board
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <Button
            variant="outline-primary"
            onClick={() => handleAdd('story')}
            aria-label="Add story"
            title="Add story"
            className="btn-icon-themed"
          >
            <Plus size={16} />
          </Button>
          <Button
            variant="outline-secondary"
            onClick={() => handleAdd('task')}
            aria-label="Add task"
            title="Add task"
            className="btn-icon-themed"
          >
            <List size={16} />
          </Button>
          <Button
            variant="outline-secondary"
            onClick={handleOpenPlanningMatrix}
            aria-label="Open planning matrix"
            title="Open planning matrix"
            className="btn-icon-themed"
          >
            <Grid size={16} />
          </Button>
          <Button
            variant="outline-secondary"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="btn-icon-themed"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </Button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <Form.Check
          inline
          type="switch"
          id="filter-critical"
          label="Critical only"
          checked={filterCriticalOnly}
          onChange={(e) => setFilterCriticalOnly(e.currentTarget.checked)}
        />
        <Form.Check
          inline
          type="switch"
          id="filter-critical-ai"
          label="Critical or AI ≥90"
          checked={filterCriticalAiOnly}
          onChange={(e) => setFilterCriticalAiOnly(e.currentTarget.checked)}
        />
        <Form.Check
          inline
          type="switch"
          id="filter-overdue"
          label="Overdue tasks only"
          checked={filterOverdueOnly}
          onChange={(e) => setFilterOverdueOnly(e.currentTarget.checked)}
        />
        <Form.Check
          inline
          type="switch"
          id="filter-unlinked-stories"
          label="Unlinked stories"
          checked={filterUnlinkedStoriesOnly}
          onChange={(e) => setFilterUnlinkedStoriesOnly(e.currentTarget.checked)}
        />
        <Form.Check
          inline
          type="switch"
          id="filter-unlinked-tasks"
          label="Unlinked tasks"
          checked={filterUnlinkedTasksOnly}
          onChange={(e) => setFilterUnlinkedTasksOnly(e.currentTarget.checked)}
        />
        <Form.Group className="d-flex align-items-center mb-0">
          <Form.Label className="me-2 mb-0">Sort</Form.Label>
          <Form.Select
            size="sm"
            value={sortMode}
            onChange={(e) => setSortMode(e.currentTarget.value as any)}
          >
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="overdue">Days overdue</option>
            <option value="default">Default</option>
            <option value="ai">AI score</option>
            <option value="overdue">Days overdue (desc)</option>
            <option value="priority">Priority (Critical → Low)</option>
          </Form.Select>
        </Form.Group>
      </div>

      <div
        ref={boardContainerRef}
        style={{
          position: 'relative',
          backgroundColor: themeVars.panel,
          borderRadius: '16px',
          padding: '8px',
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
            className="btn-icon-themed"
          >
            <Minimize2 size={14} className="me-1" />
            Exit Fullscreen
          </Button>
        )}

        {/* Kanban Board */}
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div style={{ height: boardHeight ? `${boardHeight}px` : 'calc(100dvh - 140px)', overflowY: 'auto', overflowX: 'auto' }}>
            <Row style={{ minHeight: '600px' }}>
              {swimLanes.map((lane) => {
                const lgCols = Math.max(1, Math.floor(12 / swimLanes.length));
                const mdCols = Math.min(12, Math.max(6, lgCols * 2));
                return (
                  <Col xs={12} md={mdCols as any} lg={lgCols as any} key={lane.id} style={{ marginBottom: '20px' }}>
                    <Card style={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      border: 'none',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                      <Card.Header style={{
                        backgroundColor: lane.color,
                        color: themeVars.onAccent,
                        padding: '12px 16px',
                        border: 'none',
                        position: 'sticky',
                        top: 0,
                        zIndex: 2
                      }}>
                        <h5 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                          {lane.title}
                        </h5>
                      </Card.Header>
                      <LaneDroppable id={`lane-${lane.status}`}>
                        <Card.Body style={{ padding: '8px' }}>
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
                      </LaneDroppable>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </div>

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
        <AddStoryModal
          show={showAddStoryModal}
          onClose={() => setShowAddStoryModal(false)}
        />
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
                          value={(editForm as any).dueDate ? new Date((editForm as any).dueDate).toISOString().slice(0, 10) : ''}
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
                  onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                  required
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={addForm.description || ''}
                  onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Status</Form.Label>
                {addType === 'story' ? null : (
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


    </div>
  );
};

export default ModernKanbanBoard;
