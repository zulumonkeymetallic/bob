import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Badge, Table, Dropdown } from 'react-bootstrap';
import ModernTaskTable from './ModernTaskTable';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Story, Goal, Task } from '../types';
import { useSprint } from '../contexts/SprintContext';

const ModernKanbanPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId } = useSprint();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [showAddStory, setShowAddStory] = useState(false);
  const [showEditStory, setShowEditStory] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  
  // Configurable swim lanes (canonical numeric buckets)
  const [swimLanes] = useState([
    { id: 'backlog', title: 'Backlog', status: 0 }, // 0/1 -> Backlog
    { id: 'active', title: 'Active', status: 2 },   // 2/3 -> In Progress
    { id: 'done', title: 'Done', status: 4 }        // 4    -> Done
  ]);

  // Normalize story status (string/number) to canonical lane bucket 0,2,4
  const storyBucket = (s: any): 0 | 2 | 4 => {
    if (typeof s === 'number') {
      if (s >= 4) return 4; // Done
      if (s >= 2) return 2; // In Progress (2 or 3)
      return 0;             // Backlog (0 or 1)
    }
    const v = String(s || '').trim().toLowerCase().replace(/_/g, '-');
    if (['done','complete','completed','finished','closed'].includes(v)) return 4;
    if (['in-progress','in progress','active','wip','testing','qa','review','blocked','paused','on-hold','onhold','stalled','waiting'].includes(v)) return 2;
    return 0;
  };

  const [newStory, setNewStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 2, // P2 = Medium
    points: 1
  });
  
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    effort: 'M' as 'S' | 'M' | 'L',
    priority: 2 // 2 = Medium
  });

  const [editStory, setEditStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 2, // P2 = Medium
    points: 1
  });

  useEffect(() => {
    if (!currentUser) return;

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );
    const storiesQuery = query(
      collection(db, 'stories'),
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

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    let tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
    );
    if (selectedSprintId) {
      tasksQuery = query(tasksQuery, where('sprintId', '==', selectedSprintId));
    }

    const unsubscribe = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(tasksData);
    });

    return unsubscribe;
  }, [currentUser, selectedSprintId]);

  const handleAddStory = async () => {
    if (!currentUser || !newStory.title.trim()) return;

    try {
      await addDoc(collection(db, 'stories'), {
        title: newStory.title,
        description: newStory.description,
        goalId: newStory.goalId,
        status: 0, // 0 = Backlog
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
        priority: 2, // P2 = Medium
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
        persona: 'personal',
        parentType: 'story',
        parentId: selectedStory.id,
        title: newTask.title,
        description: newTask.description,
        status: 0,
        effort: newTask.effort,
        priority: newTask.priority,
        estimateMin: 0,
        estimatedHours: 0,
        alignedToGoal: true,
        source: 'web',
        aiLinkConfidence: 0,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setNewTask({
        title: '',
        description: '',
        effort: 'M',
        priority: 2 // 2 = Medium
      });
      setShowAddTask(false);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  };

  const updateStoryStatus = async (storyId: string, newStatus: number) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating story status:', error);
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: number) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  const handleStoryClick = (story: Story) => {
    setSelectedStory(story);
  };

  const openEditStory = (story: Story) => {
    setEditStory({
      title: story.title,
      description: story.description || '',
      goalId: story.goalId || '',
      priority: story.priority,
      points: story.points || 1
    });
    setSelectedStory(story);
    setShowEditStory(true);
  };

  const handleEditStory = async () => {
    if (!selectedStory || !editStory.title.trim()) return;

    try {
      await updateDoc(doc(db, 'stories', selectedStory.id), {
        title: editStory.title,
        description: editStory.description,
        goalId: editStory.goalId,
        priority: editStory.priority,
        points: editStory.points,
        updatedAt: serverTimestamp()
      });
      setShowEditStory(false);
    } catch (error) {
      console.error('Error updating story:', error);
    }
  };

  const deleteStory = async (storyId: string) => {
    if (!window.confirm('Are you sure you want to delete this story? This will also delete all associated tasks.')) {
      return;
    }

    try {
      // Delete associated tasks first
      const storyTasks = tasks.filter(t => t.storyId === storyId);
      for (const task of storyTasks) {
        await deleteDoc(doc(db, 'tasks', task.id));
      }
      
      // Delete the story
      await deleteDoc(doc(db, 'stories', storyId));
      
      if (selectedStory?.id === storyId) {
        setSelectedStory(null);
      }
    } catch (error) {
      console.error('Error deleting story:', error);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!window.confirm('Are you sure you want to delete this task?')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const getGoalTitle = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.title : 'No Goal';
  };

  const getGoalTheme = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.category : 'none';
  };

  const getThemeColor = (theme: string) => {
    const themeColors: { [key: string]: string } = {
      'Health': 'success',
      'Career': 'primary',
      'Personal': 'info',
      'Finance': 'warning',
      'Learning': 'secondary',
      'Relationships': 'danger',
      'none': 'light'
    };
    return themeColors[theme] || 'secondary';
  };

  const getTasksForSelectedStory = () => {
    if (!selectedStory) return [];
    return tasks.filter(t => t.parentType === 'story' && t.parentId === selectedStory.id);
  };

  const getTaskCount = (storyId: string) => {
    return tasks.filter(t => t.parentType === 'story' && t.parentId === storyId).length;
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

      {/* Kanban Board - Stories Only (Simplified, no drag and drop for now) */}
      {goals.length > 0 && (
        <Row className="mb-4">
          {swimLanes.map((lane) => (
            <Col md={4} key={lane.id}>
              <Card className="h-100">
                <Card.Header className="bg-light">
                  <h5 className="mb-0">{lane.title}</h5>
                  <small className="text-muted">
                    {stories.filter(s => storyBucket((s as any).status) === lane.status).length} stories
                  </small>
                </Card.Header>
                <Card.Body style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  {stories
                    .filter(story => storyBucket((story as any).status) === lane.status)
                    .map((story) => {
                      const goalTheme = getGoalTheme(story.goalId);
                      const taskCount = getTaskCount(story.id);
                      const isSelected = selectedStory?.id === story.id;
                      
                      return (
                        <Card 
                          key={story.id}
                          className={`mb-3 shadow-sm ${isSelected ? 'border-primary' : ''}`}
                          style={{ 
                            cursor: 'pointer',
                            boxShadow: (story as any).blocked ? '0 0 0 2px rgba(220, 38, 38, 0.35)' : undefined
                          }}
                          onClick={() => handleStoryClick(story)}
                        >
                          <Card.Body className="p-3">
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

                            {/* Actions */}
                            <div className="d-flex justify-content-between align-items-center">
                              <small className="text-muted">
                                Click to view tasks
                              </small>
                              <div>
                                <Dropdown>
                                  <Dropdown.Toggle 
                                    size="sm" 
                                    variant="outline-secondary"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Move
                                  </Dropdown.Toggle>
                                  <Dropdown.Menu>
                                    <Dropdown.Item onClick={(e) => { e.stopPropagation(); updateStoryStatus(story.id, 0); }}>
                                      Backlog
                                    </Dropdown.Item>
                                    <Dropdown.Item onClick={(e) => { e.stopPropagation(); updateStoryStatus(story.id, 2); }}>
                                      Active
                                    </Dropdown.Item>
                                    <Dropdown.Item onClick={(e) => { e.stopPropagation(); updateStoryStatus(story.id, 4); }}>
                                      Done
                                    </Dropdown.Item>
                                  </Dropdown.Menu>
                                </Dropdown>
                                <Button 
                                  size="sm" 
                                  variant="outline-primary"
                                  className="ms-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditStory(story);
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline-danger"
                                  className="ms-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteStory(story.id);
                                  }}
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </Card.Body>
                        </Card>
                      );
                    })}

                  {stories.filter(s => storyBucket((s as any).status) === lane.status).length === 0 && (
                    <div className="text-center text-muted py-4">
                      <p>No stories in {lane.title.toLowerCase()}</p>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Modern Tasks Table for Selected Story */}
      {selectedStory && (
        <Row>
          <Col md={12}>
            <Card>
              <Card.Header className="d-flex justify-content-between align-items-center">
                <div>
                  <h5 className="mb-0">Tasks for: {selectedStory.title}</h5>
                  <small className="text-muted">
                    Goal: {getGoalTitle(selectedStory.goalId)} • {getTasksForSelectedStory().length} tasks
                  </small>
                </div>
                <Button variant="primary" size="sm" onClick={() => setShowAddTask(true)}>
                  Add Task
                </Button>
              </Card.Header>
              <Card.Body style={{ padding: 0 }}>
                <ModernTaskTable
                  tasks={getTasksForSelectedStory()}
                  stories={stories}
                  goals={goals}
                  sprints={[]}
                  onTaskCreate={async (newTask) => {
                    if (!currentUser) return;
                    await addDoc(collection(db, 'tasks'), {
                      title: newTask.title,
                      description: newTask.description || '',
                      parentType: 'story',
                      parentId: (newTask as any).storyId || selectedStory?.id || '',
                      status: 0,
                      priority: newTask.priority || 2,
                      effort: 'M',
                      dueDate: newTask.dueDate || null,
                      ownerUid: currentUser.uid,
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                    });
                  }}
                  onTaskUpdate={async (taskId, updates) => {
                    await updateDoc(doc(db, 'tasks', taskId), { ...updates, updatedAt: serverTimestamp() });
                  }}
                  onTaskDelete={async (taskId) => {
                    await deleteDoc(doc(db, 'tasks', taskId));
                  }}
                  onTaskPriorityChange={async (taskId, newPriority) => {
                    await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() });
                  }}
                />
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
              <Form.Label>Goal</Form.Label>
              <Form.Select
                value={newStory.goalId}
                onChange={(e) => setNewStory({...newStory, goalId: e.target.value})}
              >
                <option value="">Select a goal...</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title} ({goal.category})
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                value={newStory.title}
                onChange={(e) => setNewStory({...newStory, title: e.target.value})}
                placeholder="Enter story title..."
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={newStory.description}
                onChange={(e) => setNewStory({...newStory, description: e.target.value})}
                placeholder="Enter story description..."
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newStory.priority}
                    onChange={(e) => setNewStory({...newStory, priority: parseInt(e.target.value)})}
                  >
                    <option value="1">P1 - High</option>
                    <option value="2">P2 - Medium</option>
                    <option value="3">P3 - Low</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Story Points</Form.Label>
                  <Form.Select
                    value={newStory.points}
                    onChange={(e) => setNewStory({...newStory, points: parseInt(e.target.value)})}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={5}>5</option>
                    <option value={8}>8</option>
                    <option value={13}>13</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddStory(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleAddStory}>
            Add Story
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
              <Form.Label>Goal</Form.Label>
              <Form.Select
                value={editStory.goalId}
                onChange={(e) => setEditStory({...editStory, goalId: e.target.value})}
              >
                <option value="">Select a goal...</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title} ({goal.category})
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                value={editStory.title}
                onChange={(e) => setEditStory({...editStory, title: e.target.value})}
                placeholder="Enter story title..."
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={editStory.description}
                onChange={(e) => setEditStory({...editStory, description: e.target.value})}
                placeholder="Enter story description..."
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={editStory.priority}
                    onChange={(e) => setEditStory({...editStory, priority: parseInt(e.target.value)})}
                  >
                    <option value="1">P1 - High</option>
                    <option value="2">P2 - Medium</option>
                    <option value="3">P3 - Low</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Story Points</Form.Label>
                  <Form.Select
                    value={editStory.points}
                    onChange={(e) => setEditStory({...editStory, points: parseInt(e.target.value)})}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={5}>5</option>
                    <option value={8}>8</option>
                    <option value={13}>13</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEditStory(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleEditStory}>
            Update Story
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Add Task Modal */}
      <Modal show={showAddTask} onHide={() => setShowAddTask(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Add Task to: {selectedStory?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                value={newTask.title}
                onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                placeholder="Enter task title..."
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={newTask.description}
                onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                placeholder="Enter task description..."
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Effort</Form.Label>
                  <Form.Select
                    value={newTask.effort}
                    onChange={(e) => setNewTask({...newTask, effort: e.target.value as 'S' | 'M' | 'L'})}
                  >
                    <option value="S">Small</option>
                    <option value="M">Medium</option>
                    <option value="L">Large</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({...newTask, priority: parseInt(e.target.value)})}
                  >
                    <option value="3">Low</option>
                    <option value="2">Medium</option>
                    <option value="1">High</option>
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
    </Container>
  );
};

export default ModernKanbanPage;
