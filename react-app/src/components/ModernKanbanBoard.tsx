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
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Story, Goal, Task, Sprint } from '../types';
import { isStatus, isTheme, isPriority, getStatusName, getThemeName, getPriorityName } from '../utils/statusHelpers';
import { generateRef } from '../utils/referenceGenerator';
import { DnDMutationHandler } from '../utils/dndMutations';
import { useTheme } from '../contexts/ModernThemeContext';

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
        backgroundColor: isOver ? '#f3f4f6' : 'transparent',
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <Card 
        style={{ 
          border: `2px solid ${themeColor}`,
          borderRadius: '8px',
          boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          marginBottom: '12px'
        }}
        onClick={() => onItemClick(story)}
      >
        <Card.Body style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: themeColor }}>
                  {story.ref || `STRY-${story.id.slice(-3).toUpperCase()}`}
                </span>
                <h6 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: theme.colors.onBackground }}>
                  {story.title}
                </h6>
              </div>
              {goal && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                  <Target size={12} color={themeColor} />
                  <span style={{ fontSize: '12px', color: theme.colors.onSurface }}>
                    {goal.title}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: theme.colors.onSurface }}
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
                style={{ padding: '2px', color: '#ef4444' }}
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
              {goal?.theme && (
                <Badge 
                  style={{ 
                    backgroundColor: themeColor, 
                    color: 'white',
                    fontSize: '10px'
                  }}
                >
                  {goal.theme}
                </Badge>
              )}
            </div>
            <span style={{ fontSize: '11px', color: theme.colors.onSurface }}>
              {taskCount} tasks
            </span>
          </div>

          {story.description && (
            <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: theme.colors.onSurface, lineHeight: '1.4' }}>
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <Card 
        style={{ 
          border: `1px solid ${themeColor}`,
          borderRadius: '6px',
          boxShadow: isDragging ? '0 4px 8px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          marginBottom: '8px'
        }}
        onClick={() => onItemClick(task)}
      >
        <Card.Body style={{ padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', color: themeColor }}>
                  {task.ref || `TASK-${task.id.slice(-3).toUpperCase()}`}
                </span>
                <h6 style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: theme.colors.onBackground }}>
                  {task.title}
                </h6>
              </div>
              {story && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <BookOpen size={10} color={themeColor} />
                  <span style={{ fontSize: '10px', color: theme.colors.onSurface }}>
                    {story.title}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <Button
                variant="link"
                size="sm"
                style={{ padding: '2px', color: theme.colors.onSurface }}
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
              <Badge bg="outline-secondary" style={{ fontSize: '9px', color: theme.colors.onSurface, backgroundColor: 'transparent', border: `1px solid ${theme.colors.border}` }}>
                {task.effort}
              </Badge>
            </div>
            <span style={{ fontSize: '10px', color: theme.colors.onSurface }}>
              {task.estimateMin}min
            </span>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

const ModernKanbanBoard: React.FC<ModernKanbanBoardProps> = ({ onItemSelect }) => {
  const { theme } = useTheme();
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

  // Swim lanes configuration
  const swimLanes = [
    { id: 'backlog', title: 'Backlog', status: 'backlog', color: theme.colors.onSurface },
    { id: 'active', title: 'Active', status: 'active', color: '#2563eb' },
    { id: 'done', title: 'Done', status: 'done', color: '#059669' },
  ];

  // Theme colors (simplified for demo)
  const themeColors: Record<string, string> = {
    Health: '#22c55e',
    Growth: '#3b82f6',
    Wealth: '#eab308',
    Tribe: '#8b5cf6',
    Home: '#f97316',
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
    return stories.filter(story => isStatus(story.status, status));
  };

  const getTasksForLane = (status: string): Task[] => {
    const taskStatus = status === 'active' ? 'in-progress' : status;
    return tasks.filter(task => isStatus(task.status, taskStatus));
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
    
    const activeId = active.id as string;
    const overId = over.id as string;

    // Parse the droppable zone ID to get status and type
    const overParts = overId.split('-');
    
    if (overParts.length < 2) return;
    
    const newStatus = overParts[0];
    const itemType = overParts[1]; // 'stories' or 'tasks'

    try {
      if (itemType === 'stories') {
        const story = stories.find(s => s.id === activeId);
        if (story && !isStatus(story.status, newStatus)) {
          await updateDoc(doc(db, 'stories', activeId), {
            status: newStatus,
            updatedAt: serverTimestamp()
          });
        }
      } else if (itemType === 'tasks') {
        const taskStatus = newStatus === 'active' ? 'in-progress' : newStatus;
        const task = tasks.find(t => t.id === activeId);
        if (task && !isStatus(task.status, taskStatus)) {
          await updateDoc(doc(db, 'tasks', activeId), {
            status: taskStatus,
            updatedAt: serverTimestamp()
          });
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
      <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: '#f8fafc' }}>
        <div style={{ textAlign: 'center', paddingTop: '100px' }}>
          <div className="spinner-border" style={{ marginBottom: '16px' }} />
          <p style={{ color: theme.colors.onSurface }}>Loading kanban board...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: '#f8fafc' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: theme.colors.onBackground }}>
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
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: theme.colors.onSurface }}>
                  {stories.length}
                </h3>
                <p style={{ margin: 0, color: theme.colors.onSurface, fontSize: '14px', fontWeight: '500' }}>
                  Total Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#2563eb' }}>
                  {stories.filter(s => isStatus(s.status, 'active')).length}
                </h3>
                <p style={{ margin: 0, color: theme.colors.onSurface, fontSize: '14px', fontWeight: '500' }}>
                  Active Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#059669' }}>
                  {stories.filter(s => isStatus(s.status, 'done')).length}
                </h3>
                <p style={{ margin: 0, color: theme.colors.onSurface, fontSize: '14px', fontWeight: '500' }}>
                  Done Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#dc2626' }}>
                  {tasks.length}
                </h3>
                <p style={{ margin: 0, color: theme.colors.onSurface, fontSize: '14px', fontWeight: '500' }}>
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
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: theme.colors.onSurface, marginBottom: '12px' }}>
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
                          const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';
                          
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
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: theme.colors.onSurface, marginBottom: '12px' }}>
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
