import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Badge, Table, Dropdown } from 'react-bootstrap';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Story, Goal, Task } from '../types';

const KanbanPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [showAddStory, setShowAddStory] = useState(false);
  const [showEditStory, setShowEditStory] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  
  // Configurable swim lanes
  const [swimLanes, setSwimLanes] = useState([
    { id: 'backlog', title: 'Backlog', status: 'backlog' },
    { id: 'active', title: 'Active', status: 'active' },
    { id: 'done', title: 'Done', status: 'done' }
  ]);

  const [newStory, setNewStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 'P2' as const,
    points: 1
  });
  
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    effort: 'medium' as const,
    priority: 'medium' as const
  });

  const [editStory, setEditStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 'P2' as 'P1' | 'P2' | 'P3',
    points: 1
  });

  useEffect(() => {
    if (!currentUser) return;

    // Subscribe to goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Goal));
      setGoals(goalsData);
    });

    // Subscribe to stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Story));
      setStories(storiesData);
    });

    // Subscribe to tasks
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Task));
      setTasks(tasksData);
    });

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeTasks();
    };
  }, [currentUser]);

  const handleAddStory = async () => {
    if (!currentUser || !newStory.title.trim() || !newStory.goalId) return;

    try {
      await addDoc(collection(db, 'stories'), {
        title: newStory.title,
        description: newStory.description,
        goalId: newStory.goalId,
        status: 'backlog',
        priority: newStory.priority,
        points: newStory.points,
        orderIndex: stories.length,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setNewStory({
        title: '',
        description: '',
        goalId: '',
        priority: 'P2',
        points: 1
      });
      setShowAddStory(false);
    } catch (error) {
      console.error('Error adding story:', error);
    }
  };

  const handleAddTask = async () => {
    if (!currentUser || !newTask.title.trim() || !selectedStory) return;

    try {
      await addDoc(collection(db, 'tasks'), {
        title: newTask.title,
        description: newTask.description,
        storyId: selectedStory.id,
        status: 'Not Started',
        effort: newTask.effort,
        priority: newTask.priority,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setNewTask({
        title: '',
        description: '',
        effort: 'medium',
        priority: 'medium'
      });
      setShowAddTask(false);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  };

  const openEditStory = (story: Story) => {
    setEditStory({
      title: story.title,
      description: story.description || '',
      goalId: story.goalId,
      priority: story.priority,
      points: story.points
    });
    setSelectedStory(story);
    setShowEditStory(true);
  };

  const handleEditStory = async () => {
    if (!currentUser || !editStory.title.trim() || !selectedStory) return;

    try {
      await updateDoc(doc(db, 'stories', selectedStory.id), {
        title: editStory.title,
        description: editStory.description,
        goalId: editStory.goalId,
        priority: editStory.priority,
        points: editStory.points,
        updatedAt: serverTimestamp()
      });

      setEditStory({
        title: '',
        description: '',
        goalId: '',
        priority: 'P2',
        points: 1
      });
      setShowEditStory(false);
    } catch (error) {
      console.error('Error editing story:', error);
    }
  };

  // DELETE FUNCTION - ADDED FOR C20 FIX
  const handleDeleteStory = async () => {
    if (!selectedStory) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${selectedStory.title}"?\n\nThis action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      // Get all tasks linked to this story
      const linkedTasks = tasks.filter(task => task.storyId === selectedStory.id);
      
      if (linkedTasks.length > 0) {
        const deleteTasksConfirm = window.confirm(
          `This story has ${linkedTasks.length} linked task(s). Do you want to delete them as well?\n\nClick OK to delete story and all tasks, or Cancel to abort.`
        );
        
        if (!deleteTasksConfirm) return;
        
        // Delete all linked tasks first
        for (const task of linkedTasks) {
          await deleteDoc(doc(db, 'tasks', task.id));
        }
      }

      // Delete the story
      await deleteDoc(doc(db, 'stories', selectedStory.id));
      
      console.log('Story deleted successfully:', selectedStory.id);
      setShowEditStory(false);
      setSelectedStory(null);
      
    } catch (error) {
      console.error('Error deleting story:', error);
      alert('Failed to delete story. Please try again.');
    }
  };

  const updateStoryStatus = async (storyId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating story status:', error);
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  // Drag and Drop Handler
  const handleDragEnd = async (result: DropResult) => {
    console.log('🔄 Drag end result:', result);
    
    const { destination, source, draggableId } = result;

    // If no destination, do nothing
    if (!destination) {
      console.log('❌ No destination for drag');
      return;
    }

    // If dropped in same position, do nothing
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      console.log('⏸️ Dropped in same position');
      return;
    }

    // Find the story that was dragged
    const draggedStory = stories.find(story => story.id === draggableId);
    if (!draggedStory) {
      console.log('❌ Could not find dragged story:', draggableId);
      return;
    }

    // Map droppable IDs to status values
    const statusMap: { [key: string]: string } = {
      'backlog': 'backlog',
      'active': 'active', 
      'done': 'done'
    };

    const newStatus = statusMap[destination.droppableId];
    if (!newStatus) {
      console.log('❌ Invalid destination status:', destination.droppableId);
      return;
    }

    // Business Rule: Prevent moving to "done" if story has open tasks
    if (newStatus === 'done') {
      const storyTasks = tasks.filter(task => task.storyId === draggableId);
      const openTasks = storyTasks.filter(task => task.status !== 'done');
      
      if (openTasks.length > 0) {
        alert(`Warning: Cannot mark story as Done: ${openTasks.length} task(s) still open.\n\nComplete all tasks before marking the story as done.`);
        console.log(`❌ Blocked: Story has ${openTasks.length} open tasks`);
        return;
      }
    }

    console.log(`📋 Moving story "${draggedStory.title}" from ${source.droppableId} to ${destination.droppableId} (${newStatus})`);

    try {
      // Update the story status in Firestore
      await updateStoryStatus(draggableId, newStatus);
      console.log('✅ Story status updated successfully');
    } catch (error) {
      console.error('❌ Error updating story status:', error);
    }
  };

  const getGoalTitle = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.title : 'Unknown Goal';
  };

  const getGoalTheme = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.theme : 'Growth';
  };

  const getThemeColor = (theme: string) => {
    const colors = {
      Health: 'danger',
      Growth: 'primary',
      Wealth: 'success', 
      Tribe: 'info',
      Home: 'warning'
    };
    return colors[theme] || 'secondary';
  };

  const getTasksForSelectedStory = () => {
    if (!selectedStory) return [];
    return tasks.filter(task => task.storyId === selectedStory.id);
  };

  const getTaskCount = (storyId: string) => {
    return tasks.filter(task => task.storyId === storyId).length;
  };

  const handleStoryClick = (story: Story) => {
    setSelectedStory(story);
  };

  return (
    <Container fluid className="mt-4">
      {/* Header */}
      <Row>
        <Col md={12}>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Stories Kanban Board</h2>
            <div>
              <Button variant="outline-primary" className="me-2" onClick={() => setShowAddStory(true)}>
                Add Story
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* No Goals Warning */}
      {goals.length === 0 && (
        <Row>
          <Col md={12}>
            <Card className="text-center">
              <Card.Body>
                <h5>No Goals Found</h5>
                <p>You need to create goals first before adding stories.</p>
                <Button variant="primary" href="/goals">Go to Goals Management</Button>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Kanban Board - Stories Only */}
      {goals.length > 0 && (
        <DragDropContext 
          onDragEnd={handleDragEnd}
          onDragStart={(start) => {
            console.log('🔄 Drag started:', start);
            console.log('🔄 Available stories:', stories.map(s => ({ id: s.id, title: s.title, status: s.status })));
          }}
          onDragUpdate={(update) => {
            console.log('🔄 Drag update:', update);
          }}
        >
          <Row className="mb-4">
          {swimLanes.map((lane) => (
            <Col md={4} key={lane.id}>
              <Card className="h-100">
                <Card.Header className="bg-light">
                  <h5 className="mb-0">{lane.title}</h5>
                  <small className="text-muted">
                    {stories.filter(s => s.status === lane.status).length} stories
                  </small>
                </Card.Header>
                <Droppable droppableId={lane.id}>
                  {(provided, snapshot) => (
                    <Card.Body
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`story-droppable-area ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                      style={{ 
                        maxHeight: '60vh', 
                        overflowY: 'auto',
                        backgroundColor: snapshot.isDraggingOver ? '#f8f9fa' : 'transparent',
                        transition: 'background-color 0.2s ease'
                      }}
                    >
                  {stories
                    .filter(story => story.status === lane.status)
                    .map((story, index) => {
                      const goalTheme = getGoalTheme(story.goalId);
                      const taskCount = getTaskCount(story.id);
                      const isSelected = selectedStory?.id === story.id;
                      
                      return (
                        <Draggable key={story.id} draggableId={story.id} index={index}>
                          {(provided, snapshot) => (
                            <Card 
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`mb-3 shadow-sm story-card-draggable ${isSelected ? 'border-primary' : ''} ${snapshot.isDragging ? 'story-card-dragging' : ''}`}
                              style={{ 
                                ...provided.draggableProps.style,
                                position: 'relative'
                              }}
                              onClick={() => handleStoryClick(story)}
                            >
                          <Card.Body className="p-3" style={{ position: 'relative' }}>
                            {/* Mobile-first drag handle */}
                            <div 
                              {...provided.dragHandleProps}
                              className="drag-handle"
                              title="Drag to move story"
                            />
                            
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <h6 className="mb-1">{story.title}</h6>
                              <div>
                                <Badge bg={getThemeColor(goalTheme)} className="me-1">
                                  {goalTheme}
                                </Badge>
                                <Badge bg="secondary">{story.priority}</Badge>
                              </div>
                            </div>
                            
                            <small className="text-muted d-block mb-2">
                              Goal: {getGoalTitle(story.goalId)}
                            </small>

                            {story.description && (
                              <p className="small text-muted mb-2">{story.description}</p>
                            )}

                            <div className="d-flex justify-content-between align-items-center mb-2">
                              <small className="text-info">
                                {taskCount} tasks • {story.points} points
                              </small>
                              {isSelected && (
                                <Badge bg="primary">Selected</Badge>
                              )}
                            </div>

                            {/* Edit button and drag hint */}
                            <div className="d-flex justify-content-between align-items-center">
                              <small className="text-muted">
                                <i className="fas fa-arrows-alt"></i> Drag to move
                              </small>
                              <Button 
                                size="sm" 
                                variant="outline-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditStory(story);
                                }}
                              >
                                Edit
                              </Button>
                            </div>
                          </Card.Body>
                        </Card>
                          )}
                        </Draggable>
                      );
                    })}

                  {stories.filter(s => s.status === lane.status).length === 0 && (
                    <div className="text-center text-muted py-4">
                      <p>No stories in {lane.title.toLowerCase()}</p>
                    </div>
                  )}
                      {provided.placeholder}
                    </Card.Body>
                  )}
                </Droppable>
              </Card>
            </Col>
          ))}
        </Row>
        </DragDropContext>
      )}

      {/* Tasks Table for Selected Story */}
      {selectedStory && (
        <Row>
          <Col md={12}>
            <Card>
              <Card.Header>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h5 className="mb-0">Tasks for: {selectedStory.title}</h5>
                    <small className="text-muted">
                      Goal: {getGoalTitle(selectedStory.goalId)} • {getTasksForSelectedStory().length} tasks
                    </small>
                  </div>
                  <div>
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={() => setShowAddTask(true)}
                    >
                      Add Task
                    </Button>
                    <Button 
                      variant="outline-secondary" 
                      size="sm" 
                      className="ms-2"
                      onClick={() => setSelectedStory(null)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </Card.Header>
              <Card.Body>
                {getTasksForSelectedStory().length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-muted">No tasks for this story yet.</p>
                    <Button variant="primary" onClick={() => setShowAddTask(true)}>
                      Add First Task
                    </Button>
                  </div>
                ) : (
                  <Table responsive hover>
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Effort</th>
                        <th>Priority</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTasksForSelectedStory().map((task) => (
                        <tr key={task.id}>
                          <td>
                            <div>
                              <strong>{task.title}</strong>
                              {task.description && (
                                <div className="text-muted small">{task.description}</div>
                              )}
                            </div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <Dropdown>
                              <Dropdown.Toggle as={Badge} bg={task.status === 'done' ? 'success' : 
                                  task.status === 'in_progress' ? 'warning' : 'secondary'} style={{ cursor: 'pointer' }}>
                                {task.status === 'in_progress' ? 'In Progress' : 
                                 task.status === 'done' ? 'Done' : 'Planned'}
                              </Dropdown.Toggle>
                              <Dropdown.Menu>
                                <Dropdown.Item onClick={() => updateTaskStatus(task.id, 'planned')}>
                                  Planned
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => updateTaskStatus(task.id, 'in_progress')}>
                                  In Progress
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => updateTaskStatus(task.id, 'done')}>
                                  Done
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown>
                          </td>
                          <td>
                            <Badge bg="outline-dark">{task.effort}</Badge>
                          </td>
                          <td>
                            <Badge 
                              bg={task.priority === 'high' ? 'danger' : 
                                  task.priority === 'med' ? 'warning' : 'secondary'}
                            >
                              {task.priority}
                            </Badge>
                          </td>
                          <td>
                            <div className="d-flex gap-1">
                              {/* Edit button */}
                              <Button 
                                size="sm" 
                                variant="outline-primary"
                                onClick={() => {/* TODO: Add edit functionality */}}
                                title="Edit Task"
                              >
                                <i className="fas fa-edit"></i>
                              </Button>
                              {task.status !== 'in_progress' && (
                                <Button 
                                  size="sm" 
                                  variant="outline-warning"
                                  onClick={() => updateTaskStatus(task.id, 'in_progress')}
                                >
                                  Start
                                </Button>
                              )}
                              {task.status !== 'done' && (
                                <Button 
                                  size="sm" 
                                  variant="outline-success"
                                  onClick={() => updateTaskStatus(task.id, 'done')}
                                >
                                  Complete
                                </Button>
                              )}
                              {task.status !== 'planned' && (
                                <Button 
                                  size="sm" 
                                  variant="outline-secondary"
                                  onClick={() => updateTaskStatus(task.id, 'planned')}
                                >
                                  Reset
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Add Story Modal */}
      <Modal show={showAddStory} onHide={() => setShowAddStory(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Add New Story</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Story Title *</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Create weekly running schedule"
                value={newStory.title}
                onChange={(e) => setNewStory({...newStory, title: e.target.value})}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Describe what this story entails..."
                value={newStory.description}
                onChange={(e) => setNewStory({...newStory, description: e.target.value})}
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Link to Goal *</Form.Label>
                  <Form.Select
                    value={newStory.goalId}
                    onChange={(e) => setNewStory({...newStory, goalId: e.target.value})}
                  >
                    <option value="">Select a goal...</option>
                    {goals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        [{goal.theme}] {goal.title}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newStory.priority}
                    onChange={(e) => setNewStory({...newStory, priority: e.target.value as any})}
                  >
                    <option value="P1">P1 - High</option>
                    <option value="P2">P2 - Medium</option>
                    <option value="P3">P3 - Low</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Story Points</Form.Label>
                  <Form.Control
                    type="number"
                    min={1}
                    max={13}
                    value={newStory.points}
                    onChange={(e) => setNewStory({...newStory, points: parseInt(e.target.value)})}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddStory(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleAddStory}
            disabled={!newStory.title.trim() || !newStory.goalId}
          >
            Create Story
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Add Task Modal */}
      <Modal show={showAddTask} onHide={() => setShowAddTask(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add Task to: {selectedStory?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Task Title *</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Research running routes in neighborhood"
                value={newTask.title}
                onChange={(e) => setNewTask({...newTask, title: e.target.value})}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Task details..."
                value={newTask.description}
                onChange={(e) => setNewTask({...newTask, description: e.target.value})}
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Effort</Form.Label>
                  <Form.Select
                    value={newTask.effort}
                    onChange={(e) => setNewTask({...newTask, effort: e.target.value as any})}
                  >
                    <option value="small">Small (&lt; 2h)</option>
                    <option value="medium">Medium (2-8h)</option>
                    <option value="large">Large (&gt; 8h)</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({...newTask, priority: e.target.value as any})}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
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
          <Button 
            variant="primary" 
            onClick={handleAddTask}
            disabled={!newTask.title.trim()}
          >
            Add Task
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Story Modal */}
      <Modal show={showEditStory} onHide={() => setShowEditStory(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Edit Story</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Story Title *</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Run 5k every morning"
                value={editStory.title}
                onChange={(e) => setEditStory({...editStory, title: e.target.value})}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Story details..."
                value={editStory.description}
                onChange={(e) => setEditStory({...editStory, description: e.target.value})}
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Goal *</Form.Label>
                  <Form.Select
                    value={editStory.goalId}
                    onChange={(e) => setEditStory({...editStory, goalId: e.target.value})}
                  >
                    <option value="">Select a Goal...</option>
                    {goals.map(goal => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title} ({goal.theme})
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={editStory.priority}
                    onChange={(e) => setEditStory({...editStory, priority: e.target.value as 'P1' | 'P2' | 'P3'})}
                  >
                    <option value="P1">P1 (High)</option>
                    <option value="P2">P2 (Medium)</option>
                    <option value="P3">P3 (Low)</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Story Points</Form.Label>
                  <Form.Select
                    value={editStory.points}
                    onChange={(e) => setEditStory({...editStory, points: parseInt(e.target.value)})}
                  >
                    <option value={1}>1 point</option>
                    <option value={2}>2 points</option>
                    <option value={3}>3 points</option>
                    <option value={5}>5 points</option>
                    <option value={8}>8 points</option>
                    <option value={13}>13 points</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <div className="d-flex justify-content-between w-100">
            <Button 
              variant="danger" 
              onClick={handleDeleteStory}
              className="me-auto"
            >
              Delete Story
            </Button>
            <div>
              <Button variant="secondary" onClick={() => setShowEditStory(false)} className="me-2">
                Cancel
              </Button>
              <Button 
                variant="primary" 
                onClick={handleEditStory}
                disabled={!editStory.title.trim() || !editStory.goalId}
              >
                Update Story
              </Button>
            </div>
          </div>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default KanbanPage;
export {};
