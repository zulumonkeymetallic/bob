import React, { useState, useEffect, useCallback } from 'react';
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
import { Settings, Plus, Edit3, Trash2, User, Calendar, Target, BookOpen, AlertCircle, Activity, GripVertical } from 'lucide-react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Story, Goal, Task, Sprint } from '../types';
import { useSprint } from '../contexts/SprintContext';
import { isStatus, isTheme, isPriority, getStatusName, getThemeName, getPriorityName } from '../utils/statusHelpers';
import { generateRef, displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import EditStoryModal from './EditStoryModal';
import { DnDMutationHandler } from '../utils/dndMutations';
import { themeVars, rgbaCard, domainThemePrimaryVar } from '../utils/themeVars';

interface ModernKanbanBoardProps {
  onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
}

// Droppable Area Component
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
        ...style
      }}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
              <Target size={10} color={themeColor} />
              <span style={{ fontSize: '10px', color: themeVars.muted }}>
                {goal.title}
              </span>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};
// Sortable Task Card Component
const SortableTaskCard: React.FC<{ 
  task: Task; 
  story?: Story;
  goal?: Goal;
  themeColor: string;
  onEdit: (task: Task) => void;
  onItemClick: (task: Task) => void;
}> = ({ task, story, goal, themeColor, onEdit, onItemClick }) => {
  const { showSidebar } = useSidebar();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 600, color: themeColor }}>
                    {task.ref || `TASK-${task.id.slice(-4).toUpperCase()}`}
                  </span>
                  <h6 style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: themeVars.text }}>{task.title}</h6>
                </div>
                {story && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <BookOpen size={10} color={themeColor} />
                    <span style={{ fontSize: '9px', color: themeVars.muted }}>{story.title}</span>
                  </div>
                )}
              </div>
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
              {typeof (task as any).points === 'number' && (
                <Badge bg="info" style={{ fontSize: '8px' }}>
                  {(task as any).points} pts
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
  const [activeDropLane, setActiveDropLane] = useState<string | null>(null);

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

  // Swim lanes configuration
  const swimLanes = [
    { id: 'backlog', title: 'Backlog', status: 'backlog', color: themeVars.muted },
    { id: 'active', title: 'Active', status: 'active', color: themeVars.brand },
    { id: 'done', title: 'Done', status: 'done', color: 'var(--green)' },
  ];

  // Theme colors (simplified for demo)
  const themeColors: Record<string, string> = {
    Health: domainThemePrimaryVar('Health'),
    Growth: domainThemePrimaryVar('Growth'),
    Wealth: domainThemePrimaryVar('Wealth'),
    Tribe: domainThemePrimaryVar('Tribe'),
    Home: domainThemePrimaryVar('Home'),
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

const storyLaneForStatus = (story: Story): 'backlog' | 'in-progress' | 'done' => {
  const rawStatus = (story as any).status;
  if (typeof rawStatus === 'number') {
    if (rawStatus <= 1) return 'backlog';
    if (rawStatus === 2) return 'in-progress';
    return 'done';
  }
  const normalized = String(rawStatus || '').toLowerCase();
  if (['in-progress', 'in progress', 'active', 'doing', 'testing', 'qa', 'review'].includes(normalized)) {
    return 'in-progress';
  }
  if (['done', 'complete', 'completed', 'finished'].includes(normalized)) {
    return 'done';
  }
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

const nextStoryStatusForLane = (story: Story, lane: 'backlog' | 'in-progress' | 'done'): number | string => {
  const numeric = typeof story.status === 'number';
  if (numeric) {
    if (lane === 'backlog') return 0;
    if (lane === 'in-progress') return 2;
    return 4;
  }
  if (lane === 'backlog') return 'backlog';
  if (lane === 'in-progress') return 'in-progress';
  return 'done';
};

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

  const story = stories.find((s) => s.id === overId);
  if (story) {
    const activeIsTask = activeId ? tasks.some((t) => t.id === activeId) : false;
    if (activeIsTask) return null;
    return { newStatus: storyLaneForStatus(story), targetType: 'stories' };
  }

  const task = tasks.find((t) => t.id === overId);
  if (task) {
    const activeIsStory = activeId ? stories.some((s) => s.id === activeId) : false;
    if (activeIsStory) return null;
    return { newStatus: taskLaneForStatus(task), targetType: 'tasks' };
  }

  return null;
};

  // Sprint-aware filtering
  // When "All Sprints" (empty string) is selected, show everything. Otherwise respect explicit selection.
  const resolvedSprintId = selectedSprintId && selectedSprintId !== '' ? selectedSprintId : undefined;
  const storiesInScope = resolvedSprintId
    ? stories.filter(s => (s as any).sprintId === resolvedSprintId)
    : stories;
  const storyIdsInScope = resolvedSprintId ? new Set(storiesInScope.map(s => s.id)) : undefined;
  const tasksInScope = resolvedSprintId
    ? tasks.filter(t => {
        const taskSprintId = (t as any).sprintId;
        if (taskSprintId && taskSprintId === resolvedSprintId) return true;
        if (storyIdsInScope?.has(t.parentId)) return true;
        return false;
      })
    : tasks;

const getStoriesForLane = (status: string): Story[] => {
  return storiesInScope.filter((story) => storyLaneForStatus(story) === status);
};

const getTasksForLane = (status: string): Task[] => {
  return tasksInScope.filter((task) => taskLaneForStatus(task) === status);
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
    const activeKey = String(event.active.id);
    setActiveId(activeKey);

    const story = stories.find((s) => s.id === activeKey);
    const task = tasks.find((t) => t.id === activeKey);
    setActiveDragItem(story || task || null);

    if (story) {
      setActiveDropLane(dropLaneKey(storyLaneForStatus(story), 'stories'));
    } else if (task) {
      setActiveDropLane(dropLaneKey(taskLaneForStatus(task), 'tasks'));
    } else {
      setActiveDropLane(null);
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

    try {
    if (targetType === 'stories') {
      const story = stories.find((s) => s.id === activeId);
      if (story && !isStatus(story.status, newStatus)) {
        await updateDoc(doc(db, 'stories', activeId), {
          status: nextStoryStatusForLane(story, newStatus as 'backlog' | 'in-progress' | 'done'),
          updatedAt: serverTimestamp(),
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
          if (changed) {
            await updateDoc(doc(db, 'tasks', activeId), {
              status: mappedStatus,
              updatedAt: serverTimestamp(),
            });
          }
        }
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
      await updateDoc(doc(db, collection_name, selectedItem.id), {
        ...editForm,
        updatedAt: serverTimestamp()
      });
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
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: themeVars.text }}>
            Stories Kanban Board
          </h1>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button
              variant="outline-primary"
              onClick={() => handleAdd('story')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} />
              Add Story
            </Button>
            <Button
              variant="outline-secondary"
              onClick={() => handleAdd('task')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} />
              Add Task
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <Row>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: themeVars.muted }}>
                  {stories.length}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted, fontSize: '14px', fontWeight: '500' }}>
                  Total Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: themeVars.brand }}>
                  {stories.filter(s => isStatus(s.status, 'active')).length}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted, fontSize: '14px', fontWeight: '500' }}>
                  Active Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: 'var(--green)' }}>
                  {stories.filter(s => isStatus(s.status, 'done')).length}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted, fontSize: '14px', fontWeight: '500' }}>
                  Done Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: 'var(--red)' }}>
                  {tasks.length}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted, fontSize: '14px', fontWeight: '500' }}>
                  Total Tasks
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </div>

      {/* Kanban Board */}
      <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <Row style={{ minHeight: '600px' }}>
          {swimLanes.map((lane) => (
            <Col lg={4} key={lane.id} style={{ marginBottom: '20px' }}>
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
                    <DroppableArea 
                    id={`${lane.status}-stories`}
                    isActive={activeDropLane === dropLaneKey(lane.status, 'stories')}
                  >
                    {(() => {
                      const laneStories = getStoriesForLane(lane.status);
                      const baseIds = laneStories.map(story => story.id);
                      const isTaskDrag = activeDragItem && 'parentType' in (activeDragItem as any);
                      const activeStoryId = activeDragItem && !isTaskDrag
                        ? (activeDragItem as Story).id
                        : null;
                      const sortableIds = activeStoryId 
                        && activeDropLane === dropLaneKey(lane.status, 'stories')
                        && !baseIds.includes(activeStoryId)
                        ? [...baseIds, activeStoryId]
                        : baseIds;
                      return (
                        <SortableContext 
                          items={sortableIds}
                          strategy={verticalListSortingStrategy}
                        >
                          {laneStories.map((story) => {
                            const goal = getGoalForStory(story.id);
                            const taskCount = getTasksForStory(story.id).length;
                            const themeColor = goal?.theme ? themeColors[goal.theme] : themeVars.muted;
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
                      );
                    })()}
                  </DroppableArea>
                  </div>

                  {/* Tasks Section */}
                  <div>
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: themeVars.text, marginBottom: '12px' }}>
                      Tasks
                    </h6>
                    <DroppableArea 
                    id={`${lane.status}-tasks`}
                    isActive={activeDropLane === dropLaneKey(lane.status, 'tasks')}
                  >
                    {(() => {
                      const laneTasks = getTasksForLane(lane.status);
                      const baseIds = laneTasks.map(task => task.id);
                      const isTaskDrag = activeDragItem && 'parentType' in (activeDragItem as any);
                      const activeTaskId = activeDragItem && isTaskDrag
                        ? (activeDragItem as Task).id
                        : null;
                      const sortableIds = activeTaskId 
                        && activeDropLane === dropLaneKey(lane.status, 'tasks')
                        && !baseIds.includes(activeTaskId)
                        ? [...baseIds, activeTaskId]
                        : baseIds;
                      return (
                        <SortableContext 
                          items={sortableIds}
                          strategy={verticalListSortingStrategy}
                        >
                          {laneTasks.map((task) => {
                            const story = getStoryForTask(task.id);
                            const goal = story ? getGoalForStory(story.id) : undefined;
                            const themeColor = goal?.theme ? themeColors[goal.theme] : themeVars.muted;
                            return (
                              <SortableTaskCard
                                key={task.id}
                                task={task}
                                story={story}
                                goal={goal}
                                themeColor={themeColor}
                                onEdit={(task) => handleEdit(task, 'task')}
                                onItemClick={(task) => handleItemClick(task, 'task')}
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

        {/* Drag Overlay */}
        <DragOverlay>
          {activeDragItem && (
            <div style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: themeVars.panel, boxShadow: '0 4px 12px rgba(0,0,0,0.18)' }}>
              {'parentType' in (activeDragItem as any) ? (
                <div style={{ fontSize: '12px', fontWeight: 600 }}>Task: {activeDragItem.title}</div>
              ) : (
                <div style={{ fontSize: '12px', fontWeight: 600 }}>Story: {activeDragItem.title}</div>
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
              <Form.Select
                value={addForm.status || 'backlog'}
                onChange={(e) => setAddForm({...addForm, status: e.target.value})}
              >
                <option value="backlog">Backlog</option>
                <option value="active">Active</option>
                <option value="done">Done</option>
                {addType === 'task' && <option value="in-progress">In Progress</option>}
              </Form.Select>
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
