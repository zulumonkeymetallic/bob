import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Badge, Button, Form, Modal } from 'react-bootstrap';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { Settings, Plus, Edit3, Trash2, User, Calendar, Target, BookOpen, AlertCircle } from 'lucide-react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Story, Goal, Task, Sprint } from '../types';

interface ModernKanbanBoardProps {
  onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
}

const ModernKanbanBoard: React.FC<ModernKanbanBoardProps> = ({ onItemSelect }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<Story | Task | null>(null);
  const [selectedType, setSelectedType] = useState<'story' | 'task'>('story');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<'story' | 'task'>('story');

  // Form states
  const [editForm, setEditForm] = useState<any>({});
  const [addForm, setAddForm] = useState<any>({});

  // Swim lanes configuration
  const swimLanes = [
    { id: 'backlog', title: 'Backlog', status: 'backlog', color: '#6b7280' },
    { id: 'active', title: 'Active', status: 'active', color: '#2563eb' },
    { id: 'done', title: 'Done', status: 'done', color: '#059669' }
  ];

  // Theme colors mapping
  const themeColors = {
    'Health': '#ef4444',
    'Growth': '#8b5cf6', 
    'Wealth': '#059669',
    'Tribe': '#f59e0b',
    'Home': '#3b82f6'
  };

  useEffect(() => {
    loadData();
  }, [currentUser, currentPersona]);

  const loadData = () => {
    if (!currentUser) return;

    setLoading(true);

    // Load goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );

    // Load stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('orderIndex', 'asc')
    );

    // Load tasks
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    // Load sprints
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
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

  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    // Parse the droppable ID to get status and type
    const destinationParts = destination.droppableId.split('-');
    
    if (destinationParts.length < 2) return;
    
    const newStatus = destinationParts[0];
    const itemType = destinationParts[1]; // 'stories' or 'tasks'

    if (itemType === 'stories') {
      const story = stories.find(s => s.id === draggableId);
      if (story) {
        await updateDoc(doc(db, 'stories', draggableId), {
          status: newStatus,
          updatedAt: serverTimestamp()
        });
      }
    } else if (itemType === 'tasks') {
      const taskStatus = newStatus === 'active' ? 'in-progress' : newStatus;
      const task = tasks.find(t => t.id === draggableId);
      if (task) {
        await updateDoc(doc(db, 'tasks', draggableId), {
          status: taskStatus,
          updatedAt: serverTimestamp()
        });
      }
    }
  };

  const getGoalForStory = (storyId: string) => {
    const story = stories.find(s => s.id === storyId);
    return story ? goals.find(g => g.id === story.goalId) : null;
  };

  const getStoryForTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    return task ? stories.find(s => s.id === task.parentId && task.parentType === 'story') : null;
  };

  const getTasksForStory = (storyId: string) => {
    return tasks.filter(t => t.parentId === storyId && t.parentType === 'story');
  };

  const handleEdit = (item: Story | Task, type: 'story' | 'task') => {
    setSelectedItem(item);
    setSelectedType(type);
    setEditForm({ ...item });
    setShowEditModal(true);
  };

  const handleAdd = (type: 'story' | 'task', status: string = 'backlog') => {
    setAddType(type);
    setAddForm({
      title: '',
      description: '',
      status: status,
      priority: type === 'story' ? 'P2' : 'med',
      ...(type === 'story' ? { points: 1, goalId: '', wipLimit: 3 } : { effort: 'M', estimateMin: 60 })
    });
    setShowAddModal(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedItem) return;

    try {
      const collection_name = selectedType === 'story' ? 'stories' : 'tasks';
      await updateDoc(doc(db, collection_name, selectedItem.id), {
        ...editForm,
        updatedAt: serverTimestamp()
      });
      setShowEditModal(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('Error updating item:', error);
    }
  };

  const handleSaveAdd = async () => {
    try {
      const collection_name = addType === 'story' ? 'stories' : 'tasks';
      await addDoc(collection(db, collection_name), {
        ...addForm,
        ownerUid: currentUser?.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(addType === 'story' ? { orderIndex: stories.length } : { 
          parentType: 'story',
          source: 'web',
          alignedToGoal: true,
          hasGoal: false,
          aiLinkConfidence: 0,
          syncState: 'clean',
          serverUpdatedAt: Date.now(),
          createdBy: currentUser?.uid || ''
        })
      });
      setShowAddModal(false);
      setAddForm({});
    } catch (error) {
      console.error('Error adding item:', error);
    }
  };

  const handleDelete = async (item: Story | Task, type: 'story' | 'task') => {
    if (window.confirm(`Are you sure you want to delete this ${type}?`)) {
      try {
        const collection_name = type === 'story' ? 'stories' : 'tasks';
        await deleteDoc(doc(db, collection_name, item.id));
      } catch (error) {
        console.error('Error deleting item:', error);
      }
    }
  };

  const handleItemClick = (item: Story | Task, type: 'story' | 'task') => {
    if (onItemSelect) {
      onItemSelect(item, type);
    }
  };

  const renderStoryCard = (story: Story, index: number) => {
    const goal = getGoalForStory(story.id);
    const storyTasks = getTasksForStory(story.id);
    const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';

    return (
      <Draggable draggableId={story.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            style={{
              marginBottom: '12px',
              ...provided.draggableProps.style
            }}
          >
            <Card 
              style={{ 
                border: `2px solid ${themeColor}`,
                borderRadius: '8px',
                boxShadow: snapshot.isDragging ? '0 8px 16px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onClick={() => handleItemClick(story, 'story')}
            >
              <Card.Body style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <h6 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: '600', color: '#111827' }}>
                      {story.title}
                    </h6>
                    {goal && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                        <Target size={12} color={themeColor} />
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>
                          {goal.title}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button
                      variant="link"
                      size="sm"
                      style={{ padding: '2px', color: '#6b7280' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(story, 'story');
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
                        handleDelete(story, 'story');
                      }}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <Badge 
                      bg={story.priority === 'P1' ? 'danger' : story.priority === 'P2' ? 'warning' : 'secondary'}
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
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    {storyTasks.length} tasks
                  </span>
                </div>

                {story.description && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: '#6b7280', lineHeight: '1.4' }}>
                    {story.description.substring(0, 80)}{story.description.length > 80 ? '...' : ''}
                  </p>
                )}
              </Card.Body>
            </Card>
          </div>
        )}
      </Draggable>
    );
  };

  const renderTaskCard = (task: Task, index: number, storyId?: string) => {
    const story = storyId ? stories.find(s => s.id === storyId) : getStoryForTask(task.id);
    const goal = story ? getGoalForStory(story.id) : null;
    const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';

    return (
      <Draggable draggableId={task.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            style={{
              marginBottom: '8px',
              ...provided.draggableProps.style
            }}
          >
            <Card 
              style={{ 
                border: `1px solid ${themeColor}`,
                borderRadius: '6px',
                boxShadow: snapshot.isDragging ? '0 4px 8px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                backgroundColor: '#fafafa'
              }}
              onClick={() => handleItemClick(task, 'task')}
            >
              <Card.Body style={{ padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <h6 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: '500', color: '#111827' }}>
                      {task.title}
                    </h6>
                    {story && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                        <BookOpen size={10} color={themeColor} />
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>
                          {story.title}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button
                      variant="link"
                      size="sm"
                      style={{ padding: '1px', color: '#6b7280' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(task, 'task');
                      }}
                    >
                      <Edit3 size={10} />
                    </Button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <Badge 
                      bg={task.priority === 'high' ? 'danger' : task.priority === 'med' ? 'warning' : 'secondary'}
                      style={{ fontSize: '9px' }}
                    >
                      {task.priority}
                    </Badge>
                    <Badge bg="outline-secondary" style={{ fontSize: '9px', color: '#6b7280', backgroundColor: 'transparent', border: '1px solid #d1d5db' }}>
                      {task.effort}
                    </Badge>
                  </div>
                  <span style={{ fontSize: '10px', color: '#6b7280' }}>
                    {task.estimateMin}min
                  </span>
                </div>
              </Card.Body>
            </Card>
          </div>
        )}
      </Draggable>
    );
  };

  const getStoriesForLane = (status: string) => {
    return stories.filter(story => story.status === status);
  };

  const getTasksForLane = (status: string) => {
    const taskStatus = status === 'active' ? 'in-progress' : status;
    return tasks.filter(task => task.status === taskStatus);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: '#f8fafc' }}>
        <div style={{ textAlign: 'center', paddingTop: '100px' }}>
          <div className="spinner-border" style={{ marginBottom: '16px' }} />
          <p style={{ color: '#6b7280' }}>Loading kanban board...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', padding: '24px', backgroundColor: '#f8fafc' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#111827' }}>
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
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#6b7280' }}>
                  {stories.length}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Total Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#2563eb' }}>
                  {stories.filter(s => s.status === 'active').length}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Active Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#f59e0b' }}>
                  {tasks.length}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Total Tasks
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#059669' }}>
                  {stories.filter(s => s.status === 'done').length}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Completed Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </div>

      {/* Kanban Board */}
      <DragDropContext onDragEnd={handleDragEnd}>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h5 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                      {lane.title}
                    </h5>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Badge bg="light" text="dark" style={{ fontSize: '11px' }}>
                        {getStoriesForLane(lane.status).length} stories
                      </Badge>
                      <Badge bg="light" text="dark" style={{ fontSize: '11px' }}>
                        {getTasksForLane(lane.status).length} tasks
                      </Badge>
                    </div>
                  </div>
                </Card.Header>
                <Card.Body style={{ padding: '16px', backgroundColor: '#fafafa', minHeight: '500px' }}>
                  {/* Stories Section */}
                  <div style={{ marginBottom: '20px' }}>
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                      Stories
                    </h6>
                    <Droppable droppableId={`${lane.status}-stories`}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{
                            minHeight: '100px',
                            backgroundColor: snapshot.isDraggingOver ? '#f3f4f6' : 'transparent',
                            borderRadius: '6px',
                            padding: '8px'
                          }}
                        >
                          {getStoriesForLane(lane.status).map((story, index) => 
                            renderStoryCard(story, index)
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>

                  {/* Tasks Section */}
                  <div>
                    <h6 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                      Tasks
                    </h6>
                    <Droppable droppableId={`${lane.status}-tasks`}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{
                            minHeight: '100px',
                            backgroundColor: snapshot.isDraggingOver ? '#f3f4f6' : 'transparent',
                            borderRadius: '6px',
                            padding: '8px'
                          }}
                        >
                          {getTasksForLane(lane.status).map((task, index) => 
                            renderTaskCard(task, index)
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      </DragDropContext>

      {/* Edit Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Edit {selectedType === 'story' ? 'Story' : 'Task'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedItem && (
            <Form>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Title *</Form.Label>
                    <Form.Control
                      type="text"
                      value={editForm.title || ''}
                      onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                      required
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
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
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                />
              </Form.Group>

              <Row>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Priority</Form.Label>
                    <Form.Select
                      value={editForm.priority || ''}
                      onChange={(e) => setEditForm({...editForm, priority: e.target.value})}
                    >
                      {selectedType === 'story' ? (
                        <>
                          <option value="P1">P1 - High</option>
                          <option value="P2">P2 - Medium</option>
                          <option value="P3">P3 - Low</option>
                        </>
                      ) : (
                        <>
                          <option value="high">High</option>
                          <option value="med">Medium</option>
                          <option value="low">Low</option>
                        </>
                      )}
                    </Form.Select>
                  </Form.Group>
                </Col>

                {selectedType === 'story' && (
                  <>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Points</Form.Label>
                        <Form.Control
                          type="number"
                          min="1"
                          max="13"
                          value={editForm.points || 1}
                          onChange={(e) => setEditForm({...editForm, points: parseInt(e.target.value)})}
                        />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Goal</Form.Label>
                        <Form.Select
                          value={editForm.goalId || ''}
                          onChange={(e) => setEditForm({...editForm, goalId: e.target.value})}
                        >
                          <option value="">Select Goal</option>
                          {goals.map(goal => (
                            <option key={goal.id} value={goal.id}>{goal.title}</option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                  </>
                )}

                {selectedType === 'task' && (
                  <>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Effort</Form.Label>
                        <Form.Select
                          value={editForm.effort || ''}
                          onChange={(e) => setEditForm({...editForm, effort: e.target.value})}
                        >
                          <option value="S">S - Small</option>
                          <option value="M">M - Medium</option>
                          <option value="L">L - Large</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Estimate (minutes)</Form.Label>
                        <Form.Control
                          type="number"
                          min="15"
                          value={editForm.estimateMin || 60}
                          onChange={(e) => setEditForm({...editForm, estimateMin: parseInt(e.target.value)})}
                        />
                      </Form.Group>
                    </Col>
                  </>
                )}
              </Row>

              {selectedType === 'task' && (
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Parent Story</Form.Label>
                      <Form.Select
                        value={editForm.parentId || ''}
                        onChange={(e) => setEditForm({...editForm, parentId: e.target.value, parentType: 'story'})}
                      >
                        <option value="">Select Story</option>
                        {stories.map(story => (
                          <option key={story.id} value={story.id}>{story.title}</option>
                        ))}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Due Date</Form.Label>
                      <Form.Control
                        type="datetime-local"
                        value={editForm.dueDate ? new Date(editForm.dueDate).toISOString().slice(0, 16) : ''}
                        onChange={(e) => setEditForm({...editForm, dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined})}
                      />
                    </Form.Group>
                  </Col>
                </Row>
              )}
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
          <Modal.Title>Add New {addType === 'story' ? 'Story' : 'Task'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Title *</Form.Label>
                  <Form.Control
                    type="text"
                    value={addForm.title || ''}
                    onChange={(e) => setAddForm({...addForm, title: e.target.value})}
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
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
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={addForm.description || ''}
                onChange={(e) => setAddForm({...addForm, description: e.target.value})}
              />
            </Form.Group>

            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={addForm.priority || (addType === 'story' ? 'P2' : 'med')}
                    onChange={(e) => setAddForm({...addForm, priority: e.target.value})}
                  >
                    {addType === 'story' ? (
                      <>
                        <option value="P1">P1 - High</option>
                        <option value="P2">P2 - Medium</option>
                        <option value="P3">P3 - Low</option>
                      </>
                    ) : (
                      <>
                        <option value="high">High</option>
                        <option value="med">Medium</option>
                        <option value="low">Low</option>
                      </>
                    )}
                  </Form.Select>
                </Form.Group>
              </Col>

              {addType === 'story' && (
                <>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Points</Form.Label>
                      <Form.Control
                        type="number"
                        min="1"
                        max="13"
                        value={addForm.points || 1}
                        onChange={(e) => setAddForm({...addForm, points: parseInt(e.target.value)})}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Goal</Form.Label>
                      <Form.Select
                        value={addForm.goalId || ''}
                        onChange={(e) => setAddForm({...addForm, goalId: e.target.value})}
                      >
                        <option value="">Select Goal</option>
                        {goals.map(goal => (
                          <option key={goal.id} value={goal.id}>{goal.title}</option>
                        ))}
                      </Form.Select>
                    </Form.Group>
                  </Col>
                </>
              )}

              {addType === 'task' && (
                <>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Effort</Form.Label>
                      <Form.Select
                        value={addForm.effort || 'M'}
                        onChange={(e) => setAddForm({...addForm, effort: e.target.value})}
                      >
                        <option value="S">S - Small</option>
                        <option value="M">M - Medium</option>
                        <option value="L">L - Large</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Estimate (minutes)</Form.Label>
                      <Form.Control
                        type="number"
                        min="15"
                        value={addForm.estimateMin || 60}
                        onChange={(e) => setAddForm({...addForm, estimateMin: parseInt(e.target.value)})}
                      />
                    </Form.Group>
                  </Col>
                </>
              )}
            </Row>

            {addType === 'task' && (
              <Form.Group className="mb-3">
                <Form.Label>Parent Story</Form.Label>
                <Form.Select
                  value={addForm.parentId || ''}
                  onChange={(e) => setAddForm({...addForm, parentId: e.target.value, parentType: 'story'})}
                >
                  <option value="">Select Story</option>
                  {stories.map(story => (
                    <option key={story.id} value={story.id}>{story.title}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}
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
