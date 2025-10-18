import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, Row, Col, Badge, Button, Form, Modal } from 'react-bootstrap';
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
import {
  Edit3,
  Trash2,
  Target,
  BookOpen,
  Activity,
  Wand2,
  GripVertical,
  SquarePlus,
  ListChecks,
  Table2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { db, functions } from '../firebase';
import logger from '../utils/logger';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Story, Goal, Task, Sprint } from '../types';
import { useSprint } from '../contexts/SprintContext';
import { isStatus, isPriority, storyStatusCodeFromLabel, storyStatusLabel } from '../utils/statusHelpers';
import { deriveTaskSprint, sprintNameForId } from '../utils/taskSprintHelpers';
import { useActivityTracking } from '../hooks/useActivityTracking';
import { displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import QuickAddModal from './QuickAddModal';
import EditStoryModal from './EditStoryModal';
import { themeVars, rgbaCard } from '../utils/themeVars';
import { getThemeById, migrateThemeValue } from '../constants/globalThemes';
import { useNavigate } from 'react-router-dom';

interface ModernKanbanBoardProps {
  onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
}

const DroppableArea: React.FC<{
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  isActive?: boolean;
}> = ({ id, children, style, isActive = false }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  const highlight = isOver || isActive;

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: '100px',
        backgroundColor: highlight ? rgbaCard(0.16) : 'transparent',
        borderRadius: '8px',
        padding: '8px',
        border: highlight ? '2px solid rgba(37, 99, 235, 0.65)' : '2px dashed transparent',
        boxShadow: highlight ? '0 0 0 3px rgba(37, 99, 235, 0.28)' : 'none',
        transition: 'background-color 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

interface SortableStoryCardProps {
  story: Story;
  goal?: Goal;
  taskCount: number;
  themeColor: string;
  onEdit: (story: Story) => void;
  onDelete: (story: Story) => void;
  onItemClick: (story: Story) => void;
  onAutoGenerateTasks: (story: Story, taskCount: number) => void;
  autoGenerating: boolean;
}

const SortableStoryCard: React.FC<SortableStoryCardProps> = ({
  story,
  goal,
  taskCount,
  themeColor,
  onEdit,
  onDelete,
  onItemClick,
  onAutoGenerateTasks,
  autoGenerating,
}) => {
  const { showSidebar } = useSidebar();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: story.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.85 : 1,
      }}
    >
      <Card
        style={{
          border: `1px solid ${isDragging ? themeColor : themeVars.border}`,
          borderRadius: '8px',
          boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.18)' : '0 1px 4px rgba(0,0,0,0.08)',
          cursor: 'default',
          transition: 'all 0.18s ease',
          marginBottom: '8px',
          backgroundColor: isDragging ? rgbaCard(0.12) : themeVars.panel,
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          if (!isDragging) (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.16)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.boxShadow = isDragging ? '0 8px 16px rgba(0,0,0,0.18)' : '0 2px 6px rgba(0,0,0,0.08)';
        }}
        onClick={(e) => {
          if (!(e.target instanceof HTMLElement && e.target.closest('[data-drag-handle="true"]'))) {
            onItemClick(story);
          }
        }}
      >
        <Card.Body style={{ padding: '8px 10px 10px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: themeColor }}>
              {(() => {
                const shortRef = (story as any).referenceNumber || story.ref;
                return shortRef && validateRef(shortRef, 'story')
                  ? shortRef
                  : displayRefForEntity('story', story.id);
              })()}
            </span>
            <span style={{ fontSize: '9px', color: themeVars.muted }}>{taskCount} tasks</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
            <div
              style={{
                width: '22px',
                minHeight: '28px',
                borderRadius: '6px',
                border: `1px dashed ${isDragging ? themeColor : rgbaCard(0.2)}`,
                background: rgbaCard(0.06),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'grab',
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
              }}
              data-drag-handle="true"
              {...attributes}
              {...listeners}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={12} color={isDragging ? themeColor : themeVars.muted} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: themeVars.text, lineHeight: 1.25 }}>
                {story.title}
              </div>
              {story.description && (
                <p style={{ margin: '4px 0 0 0', fontSize: '9px', color: themeVars.muted, lineHeight: 1.35 }}>
                  {story.description.substring(0, 80)}
                  {story.description.length > 80 ? '…' : ''}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: themeVars.muted }}
                title="Activity stream"
                onClick={(e) => {
                  e.stopPropagation();
                  showSidebar(story, 'story');
                }}
              >
                <Activity size={10} />
              </Button>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: autoGenerating ? themeVars.muted : themeVars.brand, opacity: autoGenerating ? 0.6 : 1 }}
                title={autoGenerating ? 'Generating tasks…' : 'Auto-generate tasks'}
                disabled={autoGenerating}
                onClick={(e) => {
                  e.stopPropagation();
                  onAutoGenerateTasks(story, taskCount);
                }}
              >
                <Wand2 size={10} />
              </Button>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: themeVars.muted }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(story);
                }}
              >
                <Edit3 size={10} />
              </Button>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: 'var(--red)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(story);
                }}
              >
                <Trash2 size={10} />
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginBottom: goal ? '6px' : 0 }}>
            <Badge
              bg={isPriority(story.priority, 'High') ? 'danger' : isPriority(story.priority, 'Medium') ? 'warning' : 'secondary'}
              style={{ fontSize: '9px' }}
            >
              {story.priority}
            </Badge>
            <Badge bg="info" style={{ fontSize: '8px' }}>
              {story.points} pts
            </Badge>
            {goal?.theme && (
              <Badge
                style={{
                  backgroundColor: themeColor,
                  color: themeVars.onAccent,
                  fontSize: '8px',
                }}
              >
                {goal.theme}
              </Badge>
            )}
          </div>

          {goal && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Target size={10} color={themeColor} />
              <span style={{ fontSize: '10px', color: themeVars.muted }}>{goal.title}</span>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

interface SortableTaskCardProps {
  task: Task;
  story?: Story;
  goal?: Goal;
  themeColor: string;
  onEdit: (task: Task) => void;
  onItemClick: (task: Task) => void;
}

const SortableTaskCard: React.FC<SortableTaskCardProps> = ({ task, story, goal, themeColor, onEdit, onItemClick }) => {
  const { showSidebar } = useSidebar();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.85 : 1,
      }}
    >
      <Card
        style={{
          border: `1px solid ${isDragging ? themeColor : themeVars.border}`,
          borderRadius: '8px',
          boxShadow: isDragging ? '0 6px 12px rgba(0,0,0,0.16)' : '0 2px 4px rgba(0,0,0,0.08)',
          cursor: 'default',
          transition: 'all 0.18s ease',
          marginBottom: '6px',
          backgroundColor: isDragging ? rgbaCard(0.12) : themeVars.card,
        }}
        onMouseEnter={(e) => {
          if (!isDragging) (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.16)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.boxShadow = isDragging ? '0 6px 12px rgba(0,0,0,0.16)' : '0 2px 4px rgba(0,0,0,0.08)';
        }}
        onClick={(e) => {
          if (!(e.target instanceof HTMLElement && e.target.closest('[data-drag-handle="true"]'))) {
            onItemClick(task);
          }
        }}
      >
        <Card.Body style={{ padding: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
            <div
              style={{
                width: '22px',
                minHeight: '28px',
                borderRadius: '6px',
                border: `1px dashed ${isDragging ? themeColor : rgbaCard(0.2)}`,
                background: rgbaCard(0.06),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'grab',
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
              }}
              data-drag-handle="true"
              {...attributes}
              {...listeners}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={11} color={isDragging ? themeColor : themeVars.muted} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: themeColor }}>
                      {task.ref || `TASK-${task.id.slice(-4).toUpperCase()}`}
                    </span>
                    <h6 style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: themeVars.text, lineHeight: 1.25 }}>
                      {task.title}
                    </h6>
                  </div>
                  {story && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <BookOpen size={10} color={themeColor} />
                      <span style={{ fontSize: '9px', color: themeVars.muted }}>{story.title}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ padding: '2px', color: themeVars.muted }}
                    title="Activity stream"
                    onClick={(e) => {
                      e.stopPropagation();
                      showSidebar(task, 'task');
                    }}
                  >
                    <Activity size={9} />
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    style={{ padding: '2px', color: themeVars.muted }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(task);
                    }}
                  >
                    <Edit3 size={9} />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge
                bg={isPriority(task.priority, 'high') ? 'danger' : isPriority(task.priority, 'med') ? 'warning' : 'secondary'}
                style={{ fontSize: '8px' }}
              >
                {task.priority}
              </Badge>
              <Badge
                bg="outline-secondary"
                style={{ fontSize: '8px', color: themeVars.muted, backgroundColor: 'transparent', border: `1px solid ${themeVars.border}` }}
              >
                {task.effort}
              </Badge>
              {typeof task.points === 'number' && (
                <Badge bg="info" style={{ fontSize: '8px' }}>
                  {task.points} pts
                </Badge>
              )}
              {task.source && (
                <Badge bg="light" text="dark" style={{ fontSize: '9px', border: `1px solid ${themeVars.border}` }}>
                  {String(task.source)
                    .replace('ios_reminder', 'iOS')
                    .replace('MacApp', 'Mac')
                    .replace('web', 'Web')
                    .replace('ai', 'AI')
                    .toUpperCase()}
                </Badge>
              )}
            </div>
            <span style={{ fontSize: '10px', color: themeVars.muted }}>{task.estimateMin}min</span>
          </div>

          {goal && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px' }}>
              <Target size={10} color={themeColor} />
              <span style={{ fontSize: '10px', color: themeVars.muted }}>{goal.title}</span>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

const ModernKanbanBoard: React.FC<ModernKanbanBoardProps> = ({ onItemSelect }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar, setUpdateHandler } = useSidebar();
  const { selectedSprintId } = useSprint();
  const { trackFieldChange, addNote } = useActivityTracking();
  const navigate = useNavigate();

  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedItem, setSelectedItem] = useState<Story | Task | null>(null);
  const [selectedType, setSelectedType] = useState<'story' | 'task'>('story');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddType, setQuickAddType] = useState<'story' | 'task'>('story');
  const [autoGeneratingStoryId, setAutoGeneratingStoryId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeDragItem, setActiveDragItem] = useState<Story | Task | null>(null);
  const [activeDropLane, setActiveDropLane] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.error('KanbanBoard: exit fullscreen failed', error);
      }
    }
  }, []);

  const enterFullscreen = useCallback(async () => {
    const node = containerRef.current;
    if (!node) return;
    try {
      if ((node as any).requestFullscreen) {
        await (node as any).requestFullscreen();
      } else if ((node as any).webkitRequestFullscreen) {
        await (node as any).webkitRequestFullscreen();
      } else if ((node as any).msRequestFullscreen) {
        await (node as any).msRequestFullscreen();
      }
    } catch (error) {
      console.error('KanbanBoard: enter fullscreen failed', error);
    }
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    if (document.fullscreenElement === node) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen]);
  useEffect(
    () => () => {
      exitFullscreen();
      document.body.classList.remove('kanban-fullscreen');
    },
    [exitFullscreen]
  );


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const normalizedSprintId = useMemo(() => {
    const trimmed = (selectedSprintId ?? '').trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || lower === 'all' || lower === '__all__') return null;
    return trimmed;
  }, [selectedSprintId]);

  const activeSprint = useMemo(() => {
    if (!normalizedSprintId) return null;
    return sprints.find((s) => s.id === normalizedSprintId) || null;
  }, [normalizedSprintId, sprints]);

  const sprintMatchValues = useMemo(() => {
    const matches = new Set<string | undefined>();
    if (normalizedSprintId) {
      matches.add(normalizedSprintId);
    }
    if (activeSprint) {
      matches.add(activeSprint.id);
      const sprintName = (activeSprint as any)?.name;
      if (typeof sprintName === 'string' && sprintName.trim()) {
        matches.add(sprintName.trim());
      }
    }
    return matches;
  }, [normalizedSprintId, activeSprint]);

  const visibleStories = useMemo(() => {
    if (sprintMatchValues.size === 0) return stories;
    return stories.filter((story) => {
      const storySprintId = (story as any)?.sprintId as string | undefined;
      const storySprintName = (story as any)?.sprintName as string | undefined;
      if (!storySprintId && !storySprintName) return true;
      if (storySprintId && sprintMatchValues.has(storySprintId)) return true;
      if (storySprintName && sprintMatchValues.has(storySprintName)) return true;
      return false;
    });
  }, [stories, sprintMatchValues]);

  const visibleTasks = useMemo(() => {
    if (sprintMatchValues.size === 0) return tasks;
    return tasks.filter((task) => {
      const taskSprintId = (task as any)?.sprintId as string | undefined;
      if (!taskSprintId) return true;
      return sprintMatchValues.has(taskSprintId);
    });
  }, [tasks, sprintMatchValues]);

  useEffect(() => {
    const handleChange = () => {
      const active = document.fullscreenElement === containerRef.current;
      setIsFullscreen(active);
      if (active) {
        document.body.classList.add('kanban-fullscreen');
      } else {
        document.body.classList.remove('kanban-fullscreen');
      }
    };

    document.addEventListener('fullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.body.classList.remove('kanban-fullscreen');
    };
  }, []);

  useEffect(() => {
    if (isFullscreen) {
      setShowQuickAddModal(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) return;

    setLoading(true);
    let cancelled = false;

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
      orderBy('createdAt', 'desc')
    );

    const unsubGoals = onSnapshot(goalsQuery, (snapshot) => {
      if (cancelled) return;
      const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Goal[];
      setGoals(data);
    });

    const unsubStories = onSnapshot(storiesQuery, (snapshot) => {
      if (cancelled) return;
      const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[];
      setStories(data);
    });

    const unsubTasks = onSnapshot(tasksQuery, (snapshot) => {
      if (cancelled) return;
      const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
      setTasks(data.filter((task) => !task.deleted));
      setLoading(false);
    });

    const unsubSprints = onSnapshot(sprintsQuery, (snapshot) => {
      if (cancelled) return;
      const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Sprint[];
      setSprints(data);
    });

    return () => {
      cancelled = true;
      unsubGoals();
      unsubStories();
      unsubTasks();
      unsubSprints();
    };
  }, [currentUser?.uid, currentPersona]);

  const deriveTaskDueDate = useCallback(
    (taskDraft: Partial<Task>, story?: Story | null): number | null => {
      const existing =
        (taskDraft as any)?.dueDate ??
        (taskDraft as any)?.dueDateMs ??
        (taskDraft as any)?.targetDate ??
        null;
      if (existing) return Number(existing);

      const storyDue =
        (story as any)?.dueDate ??
        (story as any)?.targetDate ??
        null;
      if (storyDue) return Number(storyDue);

      const sprintFromStory = story?.sprintId;
      const sprintFromTask = (taskDraft as any)?.sprintId;
      const targetSprintId = sprintFromStory || sprintFromTask || null;
      if (targetSprintId) {
        const sprint = sprints.find((sp) => sp.id === targetSprintId);
        if (sprint?.endDate) return Number(sprint.endDate);
      }

      return null;
    },
    [sprints]
  );

  useEffect(() => {
    const handler = async (item: Story | Task, type: 'story' | 'task', updates: any) => {
      const collectionName = type === 'story' ? 'stories' : 'tasks';
      const docRef = doc(db, collectionName, (item as any).id);
      const payload: Record<string, any> = { ...updates, updatedAt: serverTimestamp() };

      if (type === 'task') {
        try {
          const existing = tasks.find((task) => task.id === (item as any).id);
          if (existing) {
            if ('dueDate' in updates) {
              const derivation = deriveTaskSprint({ task: existing, updates, stories, sprints });
              if (derivation.sprintId && derivation.sprintId !== (existing as any).sprintId) {
                payload.sprintId = derivation.sprintId;
                const sprintName = sprintNameForId(sprints, derivation.sprintId) || derivation.sprintId;
                const due = derivation.dueDateMs ? new Date(derivation.dueDateMs).toISOString().slice(0, 10) : 'unknown';
                try {
                  await addNote(
                    existing.id,
                    'task',
                    `Auto-aligned to sprint "${sprintName}" because due date ${due} falls within its window.`,
                    (existing as any).ref
                  );
                  await trackFieldChange(
                    existing.id,
                    'task',
                    'sprintId',
                    String((existing as any).sprintId || ''),
                    String(derivation.sprintId),
                    (existing as any).ref
                  );
                } catch {
                  // ignore telemetry failures
                }
              }
            }
            if (!('dueDate' in updates) && !(existing as any).dueDate && !(existing as any).dueDateMs) {
              const storyCandidateId =
                (existing as any).storyId ||
                ((existing as any).parentType === 'story' ? (existing as any).parentId : null);
              const linkedStory = storyCandidateId ? stories.find((story) => story.id === storyCandidateId) : undefined;
              const derivedDue = deriveTaskDueDate(
                { ...existing, ...updates, sprintId: (existing as any).sprintId || linkedStory?.sprintId },
                linkedStory || undefined
              );
              if (derivedDue) {
                payload.dueDate = derivedDue;
              }
            }
          }
        } catch {
          // ignore
        }
      }

      await updateDoc(docRef, payload);
    };

    setUpdateHandler(handler);
  }, [setUpdateHandler, tasks, stories, sprints, addNote, trackFieldChange, deriveTaskDueDate]);

  const swimLanes = [
    { id: 'backlog', title: 'Backlog', status: 'backlog', color: '#334155' },
    { id: 'in-progress', title: 'In Progress', status: 'in-progress', color: '#2563EB' },
    { id: 'done', title: 'Complete', status: 'done', color: '#0D9488' },
  ];

  const themeColorForGoal = (goal?: Goal): string => {
    if (!goal) return themeVars.muted as string;
    const themeId = migrateThemeValue((goal as any).theme);
    return getThemeById(Number(themeId)).color || (themeVars.muted as string);
  };

  const describeTaskStatus = (status: any): string => {
    if (typeof status === 'number') {
      switch (status) {
        case 0:
          return 'Backlog';
        case 1:
          return 'In Progress';
        case 2:
          return 'Complete';
        case 3:
          return 'Blocked';
        default:
          return 'Unknown';
      }
    }
    if (typeof status === 'string') {
      const normalized = status.trim().toLowerCase();
      if (['todo', 'backlog', 'planned'].includes(normalized)) return 'Backlog';
      if (['in-progress', 'in progress', 'active', 'doing'].includes(normalized)) return 'In Progress';
      if (['done', 'complete', 'completed', 'finished'].includes(normalized)) return 'Complete';
      if (['blocked'].includes(normalized)) return 'Blocked';
      return status;
    }
    return 'Unknown';
  };


  const storiesById = new Map(stories.map((story) => [story.id, story]));
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));

  const getGoalForStory = (storyId: string): Goal | undefined => {
    const story = storiesById.get(storyId);
    if (!story) return undefined;
    return goalsById.get(story.goalId);
  };

  const getStoryForTask = (taskId: string): Story | undefined => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return undefined;
    return storiesById.get(task.parentType === 'story' ? task.parentId : task.storyId || '');
  };

  const getTasksForStory = (storyId: string): Task[] =>
    visibleTasks.filter((task) => (task.parentType === 'story' ? task.parentId === storyId : task.storyId === storyId));

  const storyLaneForStatus = (story: Story): 'backlog' | 'in-progress' | 'done' => {
    const rawStatus = (story as any).status;
    let statusCode: number | null = null;
    if (typeof rawStatus === 'number') {
      statusCode = rawStatus;
    } else {
      const mapped = storyStatusCodeFromLabel(rawStatus);
      if (typeof mapped === 'number') statusCode = mapped;
    }
    if (typeof statusCode === 'number') {
      if (statusCode <= 1) return 'backlog';
      if (statusCode === 2) return 'in-progress';
      return 'done';
    }
    const normalized = String(rawStatus || '').toLowerCase();
    if (['in-progress', 'in progress', 'active', 'doing', 'testing', 'qa', 'review'].includes(normalized)) return 'in-progress';
    if (['done', 'complete', 'completed', 'finished'].includes(normalized)) return 'done';
    return 'backlog';
  };

  const taskLaneForStatus = (task: Task): 'backlog' | 'in-progress' | 'done' => {
    const rawStatus = (task as any).status;
    if (typeof rawStatus === 'number') {
      if (rawStatus <= 0) return 'backlog';
      if (rawStatus === 1) return 'in-progress';
      return 'done';
    }
    const normalized = String(rawStatus || '').toLowerCase();
    if (['in-progress', 'in progress', 'active', 'doing'].includes(normalized)) return 'in-progress';
    if (['done', 'complete', 'completed', 'finished'].includes(normalized)) return 'done';
    return 'backlog';
  };

  const storiesInLane = (lane: string): Story[] =>
    visibleStories.filter((story) => storyLaneForStatus(story) === lane);

  const tasksInLane = (lane: string): Task[] =>
    visibleTasks.filter((task) => taskLaneForStatus(task) === lane);

  const dropLaneKey = (status: string, targetType: 'stories' | 'tasks') => `${status}-${targetType}`;

  const parseDroppableId = (
    id: string
  ): { newStatus: string; targetType: 'stories' | 'tasks' } | null => {
    const storySuffix = '-stories';
    const taskSuffix = '-tasks';
    if (id.endsWith(storySuffix)) {
      const status = id.slice(0, -storySuffix.length);
      if (status === 'backlog' || status === 'in-progress' || status === 'done') {
        return { newStatus: status, targetType: 'stories' };
      }
    }
    if (id.endsWith(taskSuffix)) {
      const status = id.slice(0, -taskSuffix.length);
      if (status === 'backlog' || status === 'in-progress' || status === 'done') {
        return { newStatus: status, targetType: 'tasks' };
      }
    }
    return null;
  };

  const resolveDropTarget = (
    overId: string,
    activeId?: string
  ): { newStatus: string; targetType: 'stories' | 'tasks' } | null => {
    const direct = parseDroppableId(overId);
    if (direct) return direct;

    const activeIsTask = activeId ? tasks.some((t) => t.id === activeId) : false;
    const activeIsStory = activeId ? stories.some((s) => s.id === activeId) : false;

    const story = stories.find((s) => s.id === overId);
    if (story) {
      if (activeIsTask) return null;
      return { newStatus: storyLaneForStatus(story), targetType: 'stories' };
    }
    const task = tasks.find((t) => t.id === overId);
    if (task) {
      if (activeIsStory) return null;
      return { newStatus: taskLaneForStatus(task), targetType: 'tasks' };
    }
    return null;
  };

  const openQuickAdd = (type: 'story' | 'task') => {
    setQuickAddType(type);
    setShowQuickAddModal(true);
  };

  const handleOpenPlanningMatrix = () => {
    const from = `${window.location.pathname}${window.location.search}`;
    const target = new URL('/sprints/planning', window.location.origin);
    const details = { from, to: target.toString() };
    console.info('[KANBAN][PlanningMatrix] navigation requested', details);
    logger.info('kanban', 'Planning matrix navigation requested', details);
    try {
      window.location.assign(target.toString());
    } catch (error) {
      console.error('[KANBAN][PlanningMatrix] navigation failed', error, details);
      logger.error('kanban', 'Planning matrix navigation failed', error, details);
    }
  };

  const handleItemClick = (item: Story | Task, type: 'story' | 'task') => {
    if (onItemSelect) onItemSelect(item, type);
  };

  const handleEdit = (item: Story | Task, type: 'story' | 'task') => {
    setSelectedItem(item);
    setSelectedType(type);
    setEditForm(item);
    setShowEditModal(true);
  };

  const handleDelete = async (item: Story | Task, type: 'story' | 'task') => {
    if (!window.confirm(`Delete this ${type}?`)) return;
    try {
      await deleteDoc(doc(db, type === 'story' ? 'stories' : 'tasks', item.id));
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
    }
  };

  const storyOptions = useMemo(
    () =>
      stories.map((story) => ({
        id: story.id,
        title: story.title,
        goalId: story.goalId,
        sprintId: story.sprintId,
      })),
    [stories]
  );

  const handleTaskStoryLinkChange = useCallback(
    (storyId: string) => {
      if (selectedType !== 'task') return;
      const story = storyId ? stories.find((s) => s.id === storyId) : undefined;
      setEditForm((prev: any) => {
        const next = { ...prev };
        if (storyId && story) {
          next.storyId = storyId;
          next.parentType = 'story';
          next.parentId = storyId;
          next.goalId = story.goalId;
          if (story.sprintId) next.sprintId = story.sprintId;
          if (story.theme) next.theme = migrateThemeValue((story as any).theme);
          if (!next.dueDate) {
            const derived = deriveTaskDueDate(
              { ...prev, sprintId: next.sprintId || story.sprintId },
              story
            );
            if (derived) next.dueDate = derived;
          }
          if (!next.points && typeof story.points === 'number') {
            const siblingCount = Math.max(1, getTasksForStory(story.id).length || 1);
            next.points = Math.max(1, Math.round(story.points / siblingCount));
          }
        } else {
          next.storyId = '';
          next.parentType = prev?._originalParentType || prev?.parentType || 'story';
          next.parentId = '';
        }
        return next;
      });
    },
    [selectedType, stories, deriveTaskDueDate]
  );

  useEffect(() => {
    if (selectedType === 'task' && selectedItem) {
      const task = selectedItem as Task;
      const storyCandidateId =
        (task as any).storyId ||
        ((task as any).parentType === 'story' ? (task as any).parentId : '');
      const linkedStory = storyCandidateId ? stories.find((story) => story.id === storyCandidateId) : undefined;
      const derivedDue = deriveTaskDueDate(task, linkedStory);
      setEditForm({
        ...task,
        storyId: storyCandidateId || '',
        parentType: storyCandidateId ? 'story' : task.parentType,
        parentId: storyCandidateId || task.parentId,
        dueDate: (task as any).dueDate ?? derivedDue ?? null,
        _originalParentType: (task as any).parentType || 'story',
      });
    } else if (selectedType === 'story' && selectedItem) {
      setEditForm(selectedItem);
    } else {
      setEditForm({});
    }
  }, [selectedType, selectedItem, stories, deriveTaskDueDate]);

  const handleAutoGenerateTasks = async (story: Story, taskCount: number) => {
    const points = Number((story as any).points ?? 0);
    if (!Number.isFinite(points) || points <= 4) {
      window.alert('Story points must be greater than 4 to auto-generate tasks.');
      return;
    }
    if (taskCount >= 4) {
      window.alert('Story already has several tasks.');
      return;
    }
    try {
      setAutoGeneratingStoryId(story.id);
      const callable = httpsCallable(functions, 'generateTasksForStory');
      const response: any = await callable({ storyId: story.id });
      const created = response?.data?.createdCount ?? response?.data?.created ?? 0;
      if (created > 0) {
        window.alert(`Generated ${created} task${created === 1 ? '' : 's'}.`);
      } else {
        const reason = response?.data?.reason || 'No tasks generated for this story.';
        window.alert(reason);
      }
    } catch (error: any) {
      window.alert(error?.message || 'Failed to generate tasks.');
    } finally {
      setAutoGeneratingStoryId(null);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const activeKey = String(event.active.id);
    setActiveId(activeKey);
    const story = stories.find((s) => s.id === activeKey);
    const task = tasks.find((t) => t.id === activeKey);
    if (logger.isEnabled('debug', 'kanban')) {
      logger.debug('kanban', 'Drag start', {
        activeId: activeKey,
        type: story ? 'story' : task ? 'task' : 'unknown',
        storyStatus: story ? storyStatusLabel(story.status) : undefined,
        taskStatus: task ? describeTaskStatus(task.status) : undefined,
      });
    }
    setActiveDragItem(story || task || null);
    if (story) {
      setActiveDropLane(dropLaneKey(storyLaneForStatus(story), 'stories'));
    } else if (task) {
      setActiveDropLane(dropLaneKey(taskLaneForStatus(task), 'tasks'));
    } else {
      setActiveDropLane(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveDragItem(null);
    setActiveDropLane(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const target = resolveDropTarget(overId, activeId);
    if (!target) return;
    const { newStatus, targetType } = target;

    if (logger.isEnabled('debug', 'kanban')) {
      logger.debug('kanban', 'Drag end', {
        activeId,
        overId,
        newStatus,
        targetType,
      });
    }

    try {
      if (targetType === 'stories') {
        const story = stories.find((s) => s.id === activeId);
        if (story && !isStatus(story.status, newStatus)) {
          const mappedStatus = storyStatusCodeFromLabel(newStatus);
          const nextStatus = mappedStatus ?? newStatus;
          logger.info('kanban', 'Story status change requested via drag', {
            storyId: story.id,
            fromStatus: storyStatusLabel(story.status),
            toLane: newStatus,
            resolvedTo: storyStatusLabel(nextStatus),
            resolvedCode: nextStatus,
          });
          await updateDoc(doc(db, 'stories', activeId), {
            status: nextStatus,
            updatedAt: serverTimestamp(),
          });
          logger.info('kanban', 'Story status updated via drag', {
            storyId: story.id,
            newStatus: storyStatusLabel(nextStatus),
            rawStatus: nextStatus,
          });
          try {
            await trackFieldChange(
              story.id,
              'story',
              'status',
              storyStatusLabel(story.status),
              storyStatusLabel(nextStatus),
              (story as any).ref
            );
          } catch (err) {
            console.warn('[kanban] failed to log story status change', err);
          }
        } else if (story) {
          logger.debug('kanban', 'Drag dropped without status change', {
            storyId: story.id,
            lane: newStatus,
            currentStatus: storyStatusLabel(story.status),
          });
        }
      } else if (targetType === 'tasks') {
        const task = tasks.find((t) => t.id === activeId);
        if (task) {
          const numericStatus = typeof task.status === 'number';
          const mappedStatus = (() => {
            if (newStatus === 'backlog') return numericStatus ? 0 : 'backlog';
            if (newStatus === 'in-progress') return numericStatus ? 1 : 'in-progress';
            if (newStatus === 'done') return numericStatus ? 2 : 'done';
            return task.status;
          })();
          const changed = numericStatus
            ? task.status !== mappedStatus
            : String(task.status || '').toLowerCase() !== String(mappedStatus).toLowerCase();
          const updates: Record<string, any> = {};
          if (changed) {
            logger.info('kanban', 'Task status change requested via drag', {
              taskId: task.id,
              fromStatus: describeTaskStatus(task.status),
              toLane: newStatus,
              resolvedTo: describeTaskStatus(mappedStatus),
              rawResolved: mappedStatus,
            });
            updates.status = mappedStatus;
          }
          if (!(task as any).dueDate && !(task as any).dueDateMs) {
            const linkedStory = getStoryForTask(task.id);
            const derivedDue = deriveTaskDueDate(
              { ...task, sprintId: task.sprintId || linkedStory?.sprintId },
              linkedStory || undefined
            );
            if (derivedDue) {
              updates.dueDate = derivedDue;
            }
          }
          if (Object.keys(updates).length) {
            updates.updatedAt = serverTimestamp();
            await updateDoc(doc(db, 'tasks', activeId), updates);
            if (changed) {
              logger.info('kanban', 'Task status updated via drag', {
                taskId: task.id,
                newStatus: describeTaskStatus(mappedStatus),
                rawStatus: mappedStatus,
              });
              try {
                await trackFieldChange(
                  task.id,
                  'task',
                  'status',
                  describeTaskStatus(task.status),
                  describeTaskStatus(mappedStatus),
                  (task as any).ref
                );
              } catch (err) {
                console.warn('[kanban] failed to log task status change', err);
              }
            }
          } else if (!changed) {
            logger.debug('kanban', 'Drag dropped without task status change', {
              taskId: task.id,
              lane: newStatus,
              currentStatus: describeTaskStatus(task.status),
            });
          }
        }
      }
    } catch (error) {
      console.error('Error updating item status:', error);
      logger.error('kanban', 'Drag status update failed', error, {
        activeId,
        newStatus,
        targetType,
      });
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const activeKey = String(event.active.id);
    setActiveId(activeKey);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      setActiveDropLane(null);
      return;
    }
    const target = resolveDropTarget(overId, activeKey);
    setActiveDropLane(target ? dropLaneKey(target.newStatus, target.targetType) : null);
  };

  const renderHeader = (mode: 'normal' | 'fullscreen') => {
    const isFull = mode === 'fullscreen';
    return (
      <div
        className={isFull ? 'kanban-fullscreen-header' : undefined}
        style={{
          display: 'flex',
          justifyContent: isFull ? 'flex-end' : 'space-between',
          alignItems: 'center',
          marginBottom: isFull ? '16px' : '24px',
          gap: '12px',
        }}
      >
        {!isFull && (
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, color: themeVars.text }}>
            Stories Kanban Board
          </h1>
        )}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            title="Quick add story"
            aria-label="Quick add story"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: `1px solid ${isFull ? themeVars.border : rgbaCard(0.22)}`,
              backgroundColor: rgbaCard(isFull ? 0.18 : 0.06),
              color: themeVars.text,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
            }}
            onClick={() => openQuickAdd('story')}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(0.12);
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(isFull ? 0.18 : 0.06);
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <SquarePlus size={18} />
          </button>
          <button
            type="button"
            title="Quick add task"
            aria-label="Quick add task"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: `1px solid ${isFull ? themeVars.border : rgbaCard(0.22)}`,
              backgroundColor: rgbaCard(isFull ? 0.18 : 0.06),
              color: themeVars.text,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
            }}
            onClick={() => openQuickAdd('task')}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(0.12);
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(isFull ? 0.18 : 0.06);
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <ListChecks size={18} />
          </button>
          <button
            type="button"
            title="Open sprint planning matrix"
            aria-label="Open sprint planning matrix"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: `1px solid ${isFull ? themeVars.border : rgbaCard(0.22)}`,
              backgroundColor: rgbaCard(isFull ? 0.18 : 0.06),
              color: themeVars.text,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
            }}
            onClick={handleOpenPlanningMatrix}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(0.12);
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(isFull ? 0.18 : 0.06);
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <Table2 size={18} />
          </button>
          <button
            type="button"
            title={isFull ? 'Exit full screen' : 'Enter full screen'}
            aria-label={isFull ? 'Exit full screen' : 'Enter full screen'}
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: `1px solid ${isFull ? themeVars.brand : rgbaCard(0.22)}`,
              backgroundColor: isFull ? rgbaCard(0.22) : rgbaCard(0.06),
              color: isFull ? themeVars.brand : themeVars.text,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
            }}
            onClick={handleToggleFullscreen}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = rgbaCard(0.12);
              e.currentTarget.style.borderColor = themeVars.brand;
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = isFull ? rgbaCard(0.22) : rgbaCard(0.06);
              e.currentTarget.style.borderColor = isFull ? themeVars.brand : rgbaCard(0.22);
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {isFull ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>
    );
  };

  const renderBoard = (fullscreen: boolean) => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <Row style={{ minHeight: fullscreen ? 'calc(100vh - 160px)' : '600px' }}>
        {swimLanes.map((lane) => (
          <Col xl={4} lg={4} md={6} sm={12} key={lane.id} style={{ marginBottom: '20px' }}>
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Header
                style={{
                  backgroundColor: lane.color,
                  color: themeVars.onAccent,
                  padding: '16px 20px',
                  border: 'none',
                }}
              >
                <h5 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{lane.title}</h5>
              </Card.Header>
              <Card.Body style={{ padding: '16px' }}>
                <div style={{ marginBottom: '24px' }}>
                  <h6 style={{ fontSize: '14px', fontWeight: 600, color: themeVars.text, marginBottom: '12px' }}>Stories</h6>
                  <DroppableArea
                    id={`${lane.status}-stories`}
                    isActive={activeDropLane === dropLaneKey(lane.status, 'stories')}
                  >
                    {(() => {
                      const laneStories = storiesInLane(lane.status);
                      const baseIds = laneStories.map((story) => story.id);
                      const isStoryDrag = !!activeDragItem && 'points' in (activeDragItem as any);
                      const activeStoryId = isStoryDrag ? (activeDragItem as Story).id : null;
                      const sortableIds =
                        activeStoryId &&
                        activeDropLane === dropLaneKey(lane.status, 'stories') &&
                        !baseIds.includes(activeStoryId)
                          ? [...baseIds, activeStoryId]
                          : baseIds;
                      return (
                        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                          {laneStories.map((story) => {
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
                                onEdit={(item) => handleEdit(item, 'story')}
                                onDelete={(item) => handleDelete(item, 'story')}
                                onItemClick={(item) => handleItemClick(item, 'story')}
                                onAutoGenerateTasks={handleAutoGenerateTasks}
                                autoGenerating={autoGeneratingStoryId === story.id}
                              />
                            );
                          })}
                        </SortableContext>
                      );
                    })()}
                  </DroppableArea>
                </div>

                <div>
                  <h6 style={{ fontSize: '14px', fontWeight: 600, color: themeVars.text, marginBottom: '12px' }}>Tasks</h6>
                  <DroppableArea
                    id={`${lane.status}-tasks`}
                    isActive={activeDropLane === dropLaneKey(lane.status, 'tasks')}
                  >
                    {(() => {
                      const laneTasks = tasksInLane(lane.status);
                      const baseIds = laneTasks.map((task) => task.id);
                      const isTaskDrag = !!activeDragItem && !('points' in (activeDragItem as any));
                      const activeTaskId = isTaskDrag ? (activeDragItem as Task).id : null;
                      const sortableIds =
                        activeTaskId &&
                        activeDropLane === dropLaneKey(lane.status, 'tasks') &&
                        !baseIds.includes(activeTaskId)
                          ? [...baseIds, activeTaskId]
                          : baseIds;
                      return (
                        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                          {laneTasks.map((task) => {
                            const story = getStoryForTask(task.id);
                            const goal = story ? getGoalForStory(story.id) : undefined;
                            const themeColor = themeColorForGoal(goal);
                            return (
                              <SortableTaskCard
                                key={task.id}
                                task={task}
                                story={story}
                                goal={goal}
                                themeColor={themeColor}
                                onEdit={(item) => handleEdit(item, 'task')}
                                onItemClick={(item) => handleItemClick(item, 'task')}
                              />
                            );
                          })}
                        </SortableContext>
                      );
                    })()}
                  </DroppableArea>
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <DragOverlay>
        {activeDragItem && (
          <div style={{ opacity: 0.85, padding: '8px 12px', borderRadius: '6px', backgroundColor: themeVars.panel }}>
            {'points' in activeDragItem ? `Story: ${activeDragItem.title}` : `Task: ${activeDragItem.title}`}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
  const handleSaveEdit = async () => {
    if (!selectedItem || !editForm.title) return;
    try {
      const collectionName = selectedType === 'story' ? 'stories' : 'tasks';
      const docRef = doc(db, collectionName, selectedItem.id);
      const payload: Record<string, any> = {
        ...editForm,
        updatedAt: serverTimestamp(),
      };

      if (selectedType === 'task') {
        const existing = tasks.find((task) => task.id === selectedItem.id);
        const storyId =
          (payload as any).storyId ||
          ((payload as any).parentType === 'story' ? (payload as any).parentId : null);
        const linkedStory = storyId ? stories.find((story) => story.id === storyId) : undefined;

        if (storyId) {
          payload.parentType = 'story';
          payload.parentId = storyId;
          payload.storyId = storyId;
        } else {
          delete payload.storyId;
        }

        if (linkedStory) {
          if (!payload.goalId) payload.goalId = linkedStory.goalId;
          if (!payload.sprintId && linkedStory.sprintId) payload.sprintId = linkedStory.sprintId;
        }

        if (payload.dueDate) {
          payload.dueDate = Number(payload.dueDate);
        }

        if (!payload.dueDate) {
          const derived = deriveTaskDueDate(payload as Partial<Task>, linkedStory);
          if (derived) payload.dueDate = derived;
        }

        if (existing && payload.dueDate) {
          const updates = { dueDate: payload.dueDate };
          const derivation = deriveTaskSprint({ task: existing, updates, stories, sprints });
          if (derivation.sprintId && derivation.sprintId !== (existing as any).sprintId) {
            payload.sprintId = derivation.sprintId;
            const sprintName = sprintNameForId(sprints, derivation.sprintId) || derivation.sprintId;
            const due = derivation.dueDateMs ? new Date(derivation.dueDateMs).toISOString().slice(0, 10) : 'unknown';
            try {
              await addNote(
                existing.id,
                'task',
                `Auto-aligned to sprint "${sprintName}" because due date ${due} falls within its window.`,
                (existing as any).ref
              );
              await trackFieldChange(
                existing.id,
                'task',
                'sprintId',
                String((existing as any).sprintId || ''),
                String(derivation.sprintId),
                (existing as any).ref
              );
            } catch {
              // best-effort
            }
          }
        }
      }

      delete (payload as any)._originalParentType;

      await updateDoc(docRef, payload);
      setShowEditModal(false);
    } catch (error) {
      console.error('Error updating item:', error);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: themeVars.bg }}>
        <div style={{ textAlign: 'center', paddingTop: '120px' }}>
          <div className="spinner-border" style={{ marginBottom: '16px' }} />
          <p style={{ color: themeVars.muted }}>Loading kanban board…</p>
        </div>
      </div>
    );
  }


  return (
    <div
      ref={containerRef}
      style={{
        minHeight: '100vh',
        backgroundColor: themeVars.bg,
        padding: isFullscreen ? '16px' : '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {renderHeader(isFullscreen ? 'fullscreen' : 'normal')}
      <div style={{ flex: 1, minHeight: 0, overflow: 'visible' }}>{renderBoard(isFullscreen)}</div>

      <QuickAddModal
        show={showQuickAddModal}
        onHide={() => setShowQuickAddModal(false)}
        initialType={quickAddType}
        allowTypeChange={false}
        defaultSprintId={selectedSprintId || undefined}
        availableStories={stories}
        container={isFullscreen ? containerRef.current : undefined}
      />

      {selectedType === 'story' && (
        <EditStoryModal
          show={showEditModal}
          onHide={() => setShowEditModal(false)}
          story={selectedItem as Story | null}
          goals={goals}
          onStoryUpdated={() => setShowEditModal(false)}
          container={isFullscreen ? containerRef.current : undefined}
        />
      )}

      {selectedType === 'task' && (
        <Modal
          show={showEditModal}
          onHide={() => setShowEditModal(false)}
          size="lg"
          container={isFullscreen ? containerRef.current : undefined}
        >
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
                <Form.Group className="mb-3">
                  <Form.Label>Linked Story</Form.Label>
                  <Form.Select
                    value={(editForm as any).storyId || ''}
                    onChange={(e) => handleTaskStoryLinkChange(e.target.value || '')}
                  >
                    <option value="">Unlinked Task</option>
                    {storyOptions.map((story) => (
                      <option key={story.id} value={story.id}>
                        {story.title}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Text className="text-muted">
                    Linking to a story keeps the task aligned with its goal and sprint schedule.
                  </Form.Text>
                </Form.Group>
                <Row>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Status</Form.Label>
                      <Form.Select
                        value={(editForm as any).status ?? ''}
                        onChange={(e) =>
                          setEditForm({
                            ...(editForm as any),
                            status:
                              typeof (selectedItem as any).status === 'number' ? Number(e.target.value) : e.target.value,
                          })
                        }
                      >
                        {typeof (selectedItem as any).status === 'number' ? (
                          <>
                            <option value={0}>Backlog</option>
                            <option value={1}>In Progress</option>
                            <option value={2}>Complete</option>
                            <option value={3}>Blocked</option>
                          </>
                        ) : (
                          <>
                            <option value="backlog">Backlog</option>
                            <option value="in-progress">In Progress</option>
                            <option value="done">Complete</option>
                          </>
                        )}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Priority</Form.Label>
                      <Form.Select
                        value={(editForm as any).priority ?? 2}
                        onChange={(e) =>
                          setEditForm({ ...(editForm as any), priority: Number(e.currentTarget.value) })
                        }
                      >
                        <option value={1}>High</option>
                        <option value={2}>Medium</option>
                        <option value={3}>Low</option>
                      </Form.Select>
                      <Form.Text className="text-muted">
                        AI reprioritizes tasks daily based on workload. Adjust if you need to override.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Points (Auto-sized)</Form.Label>
                      <Form.Control
                        type="number"
                        min={1}
                        value={
                          typeof (editForm as any).points === 'number' && !Number.isNaN((editForm as any).points)
                            ? (editForm as any).points
                            : ''
                        }
                        onChange={(e) =>
                          setEditForm({
                            ...(editForm as any),
                            points: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                      />
                      <Form.Text className="text-muted">
                        Task size is auto-estimated by AI; tweak only when manual sizing is required.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Due Date</Form.Label>
                      <Form.Control
                        type="date"
                        value={(editForm as any).dueDate ? new Date((editForm as any).dueDate).toISOString().slice(0, 10) : ''}
                        onChange={(e) =>
                          setEditForm({
                            ...(editForm as any),
                            dueDate: e.target.value ? new Date(e.target.value).getTime() : null,
                          })
                        }
                      />
                      <Form.Text className="text-muted">
                        Defaults to the linked story or sprint end date to keep delivery on track.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
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
    </div>
  );
};

export default ModernKanbanBoard;
