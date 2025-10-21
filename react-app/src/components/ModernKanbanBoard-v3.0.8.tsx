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
import { Settings, Plus, Edit3, Trash2, User, Calendar, Target, BookOpen, AlertCircle } from 'lucide-react';
import { themeVars, rgbaCard, domainThemePrimaryVar } from '../utils/themeVars';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Story, Goal, Task, Sprint } from '../types';
import { isStatus, isTheme, isPriority, getStatusName, getThemeName, getPriorityName } from '../utils/statusHelpers';
import { generateRef } from '../utils/referenceGenerator';
import { DnDMutationHandler } from '../utils/dndMutations';

interface ModernKanbanBoardProps {
  onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
}

// Droppable Area Component
const DroppableArea: React.FC<{ 
  id: string; 
  children: React.ReactNode; 
  style?: React.CSSProperties 
}> = ({ id, children, style }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div 
      ref={setNodeRef}
      style={{
        minHeight: '100px',
        backgroundColor: isOver ? (rgbaCard(0.06) as string) : 'transparent',
        borderRadius: '6px',
        padding: '8px',
        transition: 'background-color 0.2s ease',
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
    opacity: isDragging ? 0.8 : 1,
  };

  const blocked = isStatus(story.status, 'blocked') || (story as any)?.status === 'Blocked';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <Card 
        style={{ 
          border: blocked ? '2px solid var(--red)' : '1px solid ' + themeColor,
          borderRadius: '7px',
          boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          marginBottom: '10px'
        }}
        onClick={() => onItemClick(story)}
      >
        <Card.Body style={{ padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', color: blocked ? 'var(--red)' : (themeColor as string) }}>
                  {story.ref || `STRY-${story.id.slice(-3).toUpperCase()}`}
                </span>
                <h6 style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: themeVars.text as string }}>
                  {story.title}
                </h6>
              </div>
              {goal && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                  <Target size={12} color={themeColor} />
                  <span style={{ fontSize: '12px', color: themeVars.muted as string }}>
                    {goal.title}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: themeVars.muted as string }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(story);
                }}
              >
                <Edit3 size={12} />
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
                <Trash2 size={12} />
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <Badge 
                bg={isPriority(story.priority, 'High') ? 'danger' : isPriority(story.priority, 'Medium') ? 'warning' : 'secondary'}
                style={{ fontSize: '10px' }}
              >
                {story.priority}
              </Badge>
              <Badge bg="info" style={{ fontSize: '10px' }}>
                {story.points} pts
              </Badge>
              {blocked && (
                <Badge bg="danger" style={{ fontSize: '10px' }}>Blocked</Badge>
              )}
              {goal?.theme && (
                <Badge 
                  style={{ 
                    backgroundColor: themeColor, 
                    color: themeVars.onAccent as string,
                    fontSize: '10px'
                  }}
                >
                  {goal.theme}
                </Badge>
              )}
            </div>
            <span style={{ fontSize: '11px', color: themeVars.muted as string }}>
              {taskCount} tasks
            </span>
          </div>

          {story.description && (
            <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: themeVars.muted as string, lineHeight: '1.35' }}>
              {story.description.substring(0, 80)}{story.description.length > 80 ? '...' : ''}
            </p>
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
  themeColor: string;
  onEdit: (task: Task) => void;
  onItemClick: (task: Task) => void;
}> = ({ task, story, themeColor, onEdit, onItemClick }) => {
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
    opacity: isDragging ? 0.8 : 1,
  };

  const blocked = isStatus(task.status, 'blocked') || (task as any)?.status === 'Blocked';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <Card 
        style={{ 
          border: blocked ? '2px solid var(--red)' : `1px solid ${themeColor}`,
          borderRadius: '5px',
          boxShadow: isDragging ? '0 4px 8px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          marginBottom: '7px'
        }}
        onClick={() => onItemClick(task)}
      >
        <Card.Body style={{ padding: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: '600', color: blocked ? 'var(--red)' : (themeColor as string) }}>
                  {task.ref || `TASK-${task.id.slice(-3).toUpperCase()}`}
                </span>
                <h6 style={{ margin: 0, fontSize: '12px', fontWeight: '600', color: themeVars.text as string }}>
                  {task.title}
                </h6>
              </div>
              {story && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <BookOpen size={10} color={themeColor} />
                  <span style={{ fontSize: '10px', color: themeVars.muted as string }}>
                    {story.title}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: themeVars.muted as string }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
              >
                <Edit3 size={10} />
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <Badge 
                bg={isPriority(task.priority, 'high') ? 'danger' : isPriority(task.priority, 'med') ? 'warning' : 'secondary'}
                style={{ fontSize: '9px' }}
              >
                {task.priority}
              </Badge>
              <Badge bg="outline-secondary" style={{ fontSize: '9px', color: themeVars.muted as string, backgroundColor: 'transparent', border: `1px solid ${themeVars.border}` }}>
                {task.effort}
              </Badge>
              {blocked && (
                <Badge bg="danger" style={{ fontSize: '9px' }}>Blocked</Badge>
              )}
            </div>
            <span style={{ fontSize: '10px', color: themeVars.muted as string }}>
              {task.estimateMin}min
            </span>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

const ModernKanbanBoard: React.FC<ModernKanbanBoardProps> = ({ onItemSelect }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar, setUpdateHandler } = useSidebar();
  
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

  // Swim lanes configuration (Blocked is not a separate lane; it renders as red border within In Progress)
  const swimLanes = [
    { id: 'backlog', title: 'Backlog', status: 'backlog', color: themeVars.muted },
    { id: 'in-progress', title: 'In Progress', status: 'in-progress', color: themeVars.brand },
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

  const getStoriesForLane = (status: string): Story[] => {
    const s = status;
    return stories.filter(story => {
      const st = (story as any).status;
      if (s === 'backlog') {
        return isStatus(st, 'backlog') || isStatus(st, 'planned') || isStatus(st, 'todo') || st === 0 || st === 1;
      }
      if (s === 'in-progress') {
        // Include blocked in the In Progress lane (visualized by red border)
        return isStatus(st, 'in-progress') || isStatus(st, 'active') || isStatus(st, 'testing') || isStatus(st, 'blocked') || st === 2 || st === 3;
      }
      if (s === 'done') {
        return isStatus(st, 'done') || st === 4;
      }
      return isStatus(st, s);
    });
  };

  const getTasksForLane = (status: string): Task[] => {
    return tasks.filter(task => {
      const st = (task as any).status;
      if (status === 'backlog') {
        return isStatus(st, 'backlog') || isStatus(st, 'planned') || isStatus(st, 'todo') || st === 0;
      }
      if (status === 'in-progress') {
        // Include blocked tasks in the In Progress lane
        return isStatus(st, 'in-progress') || isStatus(st, 'blocked') || st === 1 || st === 3;
      }
      if (status === 'done') {
        return isStatus(st, 'done') || st === 2;
      }
      return isStatus(st, status);
    });
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
    
    console.log('DragEnd Event:', { active: active.id, over: over?.id });
    
    setActiveId(null);
    setActiveDragItem(null);

    if (!over) {
      console.log('No drop target found');
      return;
    }
    
    const activeId = active.id as string;
    const overId = over.id as string;

    // Parse the droppable zone ID to get status and type
    const overParts = overId.split('-');
    console.log('Drop zone parts:', overParts);
    
    if (overParts.length < 2) {
      console.log('Invalid drop zone format:', overId);
      return;
    }
    
    const newStatus = overParts[0];
    const itemType = overParts[1]; // 'stories' or 'tasks'

    console.log('Moving item:', { activeId, newStatus, itemType });

    try {
      if (itemType === 'stories') {
        const story = stories.find(s => s.id === activeId);
        console.log('Found story:', story);
        // Normalize 'active' to 'in-progress' for consistency
        const normalized = newStatus === 'active' ? 'in-progress' : newStatus;
        if (story && !isStatus(story.status, normalized)) {
          console.log('Updating story status from', story.status, 'to', newStatus);
          await updateDoc(doc(db, 'stories', activeId), {
            status: normalized,
            updatedAt: serverTimestamp()
          });
          console.log('Story updated successfully');
        }
      } else if (itemType === 'tasks') {
        const taskStatus = newStatus === 'active' ? 'in-progress' : newStatus;
        const task = tasks.find(t => t.id === activeId);
        console.log('Found task:', task);
        if (task && !isStatus(task.status, taskStatus)) {
          console.log('Updating task status from', task.status, 'to', taskStatus);
          await updateDoc(doc(db, 'tasks', activeId), {
            status: taskStatus,
            updatedAt: serverTimestamp()
          });
          console.log('Task updated successfully');
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
    console.log('🔧 ModernKanbanBoard: EDIT button clicked', {
      action: 'edit_button_clicked',
      itemType: type,
      itemId: item.id,
      itemRef: item.ref,
      itemTitle: item.title,
      user: currentUser?.uid,
      timestamp: new Date().toISOString()
    });
    
    setSelectedItem(item);
    setSelectedType(type);
    setEditForm(item);
    setShowEditModal(true);
  };

  const handleDelete = async (item: Story | Task, type: 'story' | 'task') => {
    console.log('🗑️ ModernKanbanBoard: DELETE button clicked', {
      action: 'delete_button_clicked',
      itemType: type,
      itemId: item.id,
      itemRef: item.ref,
      itemTitle: item.title,
      user: currentUser?.uid,
      timestamp: new Date().toISOString()
    });
    
    if (window.confirm(`Are you sure you want to delete this ${type}?`)) {
      try {
        console.log('🗑️ ModernKanbanBoard: Starting DELETE operation', {
          action: 'delete_operation_start',
          itemType: type,
          itemId: item.id,
          collection: type === 'story' ? 'stories' : 'tasks'
        });
        
        const collection_name = type === 'story' ? 'stories' : 'tasks';
        await deleteDoc(doc(db, collection_name, item.id));
        
        console.log('✅ ModernKanbanBoard: DELETE operation successful', {
          action: 'delete_operation_success',
          itemType: type,
          itemId: item.id,
          collection: collection_name,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('❌ ModernKanbanBoard: DELETE operation failed', {
          action: 'delete_operation_error',
          itemType: type,
          itemId: item.id,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  const handleAdd = (type: 'story' | 'task') => {
    console.log('➕ ModernKanbanBoard: ADD button clicked', {
      action: 'add_button_clicked',
      itemType: type,
      user: currentUser?.uid,
      persona: currentPersona,
      timestamp: new Date().toISOString()
    });
    
    setAddType(type);
    setAddForm({});
    setShowAddModal(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedItem || !editForm.title) return;

    try {
      console.log('💾 ModernKanbanBoard: Starting SAVE EDIT operation', {
        action: 'save_edit_start',
        itemType: selectedType,
        itemId: selectedItem.id,
        originalData: selectedItem,
        newData: editForm,
        user: currentUser?.uid,
        timestamp: new Date().toISOString()
      });

      const collection_name = selectedType === 'story' ? 'stories' : 'tasks';
      await updateDoc(doc(db, collection_name, selectedItem.id), {
        ...editForm,
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ ModernKanbanBoard: SAVE EDIT operation successful', {
        action: 'save_edit_success',
        itemType: selectedType,
        itemId: selectedItem.id,
        collection: collection_name,
        timestamp: new Date().toISOString()
      });
      
      setShowEditModal(false);
    } catch (error) {
      console.error('❌ ModernKanbanBoard: SAVE EDIT operation failed', {
        action: 'save_edit_error',
        itemType: selectedType,
        itemId: selectedItem.id,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleSaveAdd = async () => {
    if (!addForm.title) return;

    try {
      console.log('💾 ModernKanbanBoard: Starting ADD NEW operation', {
        action: 'add_new_start',
        itemType: addType,
        formData: addForm,
        user: currentUser?.uid,
        persona: currentPersona,
        timestamp: new Date().toISOString()
      });

      // Generate unique reference
      const collection_name = addType === 'story' ? 'stories' : 'tasks';
      const existingItems = await getDocs(query(
        collection(db, collection_name),
        where('ownerUid', '==', currentUser?.uid),
        where('persona', '==', currentPersona)
      ));
      const existingRefs = existingItems.docs.map(doc => doc.data().ref).filter(Boolean) as string[];
      const ref = generateRef(addType, existingRefs);
      
      console.log('📝 ModernKanbanBoard: Generated reference', {
        action: 'reference_generated',
        itemType: addType,
        generatedRef: ref,
        existingRefsCount: existingRefs.length
      });
      
      const newItemData = {
        ...addForm,
        ref,
        ownerUid: currentUser?.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      console.log('💾 ModernKanbanBoard: About to save to database', {
        action: 'database_write_start',
        collection: collection_name,
        data: newItemData
      });

      await addDoc(collection(db, collection_name), newItemData);
      
      console.log('✅ ModernKanbanBoard: ADD NEW operation successful', {
        action: 'add_new_success',
        itemType: addType,
        ref: ref,
        collection: collection_name,
        timestamp: new Date().toISOString()
      });
      
      setShowAddModal(false);
    } catch (error) {
      console.error('❌ ModernKanbanBoard: ADD NEW operation failed', {
        action: 'add_new_error',
        itemType: addType,
        error: error.message,
        formData: addForm,
        timestamp: new Date().toISOString()
      });
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', paddingTop: '100px' }}>
          <div className="spinner-border" style={{ marginBottom: '16px' }} />
          <p style={{ color: 'var(--muted)' }}>Loading kanban board...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: 'var(--text)' }}>
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
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: 'var(--muted)' }}>
                  {stories.length}
                </h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
                  Total Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: 'var(--brand)' }}>
                  {stories.filter(s => isStatus(s.status, 'active')).length}
                </h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
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
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
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
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px', fontWeight: '500' }}>
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
        onDragEnd={handleDragEnd}
      >
        <Row style={{ minHeight: '600px' }}>
          {swimLanes.map((lane) => (
            <Col lg={4} key={lane.id} style={{ marginBottom: '20px' }}>
              <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <Card.Header style={{ 
                  backgroundColor: lane.color, 
                  color: 'white',
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
                <h6 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text)', marginBottom: '12px' }}>
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
                          const themeColor = goal?.theme ? themeColors[goal.theme] : (themeVars.muted as string);
                          
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
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text)', marginBottom: '12px' }}>
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
                          const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';
                          
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
          ))}
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

      {/* Edit Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Edit {selectedType === 'story' ? 'Story' : 'Task'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedItem && (
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Title *</Form.Label>
                <Form.Control
                  type="text"
                  value={editForm.title || ''}
                  onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                  required
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Status</Form.Label>
                <Form.Select
                  value={editForm.status || ''}
                  onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                >
                  <option value="backlog">Backlog</option>
                  <option value="active">Active</option>
                  <option value="done">Done</option>
                  {selectedType === 'task' && <option value="in-progress">In Progress</option>}
                  {selectedType === 'task' && <option value="blocked">Blocked</option>}
                </Form.Select>
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
