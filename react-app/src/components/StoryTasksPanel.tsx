import React, { useState, useEffect } from 'react';
import { Card, Button, Badge, Form, Row, Col } from 'react-bootstrap';
import { ChevronDown, ChevronUp, Plus, Edit3, Save, X, Activity } from 'lucide-react';
import { Task, Story } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { generateRef } from '../utils/referenceGenerator';
import { useSidebar } from '../contexts/SidebarContext';

interface StoryTasksPanelProps {
  story: Story;
  onClose: () => void;
}

const StoryTasksPanel: React.FC<StoryTasksPanelProps> = ({ story, onClose }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Partial<Task>>({});
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    status: 0, // 0=To Do
    priority: 2 // 2=Medium
  });

  // Load tasks for this story
  useEffect(() => {
    if (!currentUser || !story.id) return;

    // Simplified query to avoid index requirements
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribe = onSnapshot(tasksQuery, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      
      // Filter for tasks belonging to this story
      const storyTasks = allTasks.filter(task => 
        task.parentType === 'story' && task.parentId === story.id
      );
      
      console.log(`📋 Loaded ${storyTasks.length} tasks for story:`, story.ref || story.id);
      setTasks(storyTasks.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, currentPersona, story.id]);

  const handleStartEdit = (task: Task) => {
    setEditingTaskId(task.id);
    setEditingValues({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority
    });
  };

  const handleSaveEdit = async () => {
    if (!editingTaskId || !editingValues.title?.trim()) return;

    try {
      await updateDoc(doc(db, 'tasks', editingTaskId), {
        ...editingValues,
        updatedAt: serverTimestamp()
      });
      
      setEditingTaskId(null);
      setEditingValues({});
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingTaskId(null);
    setEditingValues({});
  };

  const handleAddTask = async () => {
    if (!currentUser || !newTask.title.trim()) return;

    try {
      const existingRefs = tasks.map(t => t.ref).filter(Boolean);
      const taskRef = generateRef('task', existingRefs);
      await addDoc(collection(db, 'tasks'), {
        ref: taskRef,
        title: newTask.title,
        description: newTask.description,
        status: newTask.status,
        priority: newTask.priority,
        parentType: 'story',
        parentId: story.id,
        effort: 'M',
        estimateMin: 60,
        alignedToGoal: true,
        theme: story.theme || 1,
        source: 'web',
        aiLinkConfidence: 1.0,
        hasGoal: !!story.goalId,
        syncState: 'clean',
        serverUpdatedAt: Date.now(),
        createdBy: currentUser.uid,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setNewTask({
        title: '',
        description: '',
        status: 0,
        priority: 2
      });
      setIsAddingTask(false);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 0: return 'secondary'; // To Do
      case 1: return 'primary';   // In Progress
      case 2: return 'success';   // Done
      case 3: return 'warning';   // Blocked
      default: return 'secondary';
    }
  };

  const getStatusName = (status: number) => {
    switch (status) {
      case 0: return 'To Do';
      case 1: return 'In Progress';
      case 2: return 'Done';
      case 3: return 'Blocked';
      default: return 'Unknown';
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return 'danger';    // High
      case 2: return 'warning';   // Medium
      case 3: return 'info';      // Low
      default: return 'secondary';
    }
  };

  const getPriorityName = (priority: number) => {
    switch (priority) {
      case 1: return 'High';
      case 2: return 'Medium';
      case 3: return 'Low';
      default: return 'Unknown';
    }
  };

  return (
    <Card style={{ 
      border: '2px solid #007bff', 
      borderRadius: '12px',
      boxShadow: '0 4px 20px rgba(0, 123, 255, 0.15)',
      marginTop: '20px'
    }}>
      <Card.Header style={{ 
        background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)', 
        color: 'white',
        borderRadius: '10px 10px 0 0'
      }}>
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <h5 className="mb-1">
              📋 Tasks for: {story.title}
            </h5>
            <small className="opacity-75">
              {story.ref} • {tasks.length} task{tasks.length !== 1 ? 's' : ''}
            </small>
          </div>
          <div>
            <Button
              variant="outline-light"
              size="sm"
              className="me-2"
              onClick={() => setIsAddingTask(true)}
            >
              <Plus size={16} className="me-1" />
              Add Task
            </Button>
            <Button
              variant="outline-light"
              size="sm"
              onClick={onClose}
            >
              <ChevronUp size={16} />
            </Button>
          </div>
        </div>
      </Card.Header>

      <Card.Body style={{ padding: '20px' }}>
        {/* Add new task form */}
        {isAddingTask && (
          <Card className="mb-3" style={{ border: '2px dashed #28a745' }}>
            <Card.Body>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-2">
                    <Form.Label>Task Title</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="Enter task title..."
                      value={newTask.title}
                      onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                    />
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group className="mb-2">
                    <Form.Label>Status</Form.Label>
                    <Form.Select
                      value={newTask.status}
                      onChange={(e) => setNewTask({...newTask, status: parseInt(e.target.value)})}
                    >
                      <option value={0}>To Do</option>
                      <option value={1}>In Progress</option>
                      <option value={2}>Done</option>
                      <option value={3}>Blocked</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group className="mb-2">
                    <Form.Label>Priority</Form.Label>
                    <Form.Select
                      value={newTask.priority}
                      onChange={(e) => setNewTask({...newTask, priority: parseInt(e.target.value)})}
                    >
                      <option value={1}>High</option>
                      <option value={2}>Medium</option>
                      <option value={3}>Low</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  placeholder="Enter task description..."
                  value={newTask.description}
                  onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                />
              </Form.Group>
              <div className="d-flex gap-2">
                <Button variant="success" size="sm" onClick={handleAddTask}>
                  <Save size={16} className="me-1" />
                  Add Task
                </Button>
                <Button variant="outline-secondary" size="sm" onClick={() => setIsAddingTask(false)}>
                  <X size={16} className="me-1" />
                  Cancel
                </Button>
              </div>
            </Card.Body>
          </Card>
        )}

        {/* Tasks list */}
        {loading ? (
          <div className="text-center py-4">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading tasks...</span>
            </div>
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-5 text-muted">
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📝</div>
            <h6>No tasks yet</h6>
            <p>Click "Add Task" to create the first task for this story.</p>
          </div>
        ) : (
          <div className="tasks-list">
            {tasks.map((task) => (
              <Card 
                key={task.id} 
                className="mb-3"
                style={{ 
                  border: editingTaskId === task.id ? '2px solid #007bff' : '1px solid #dee2e6',
                  transition: 'all 0.2s ease'
                }}
              >
                <Card.Body>
                  {editingTaskId === task.id ? (
                    // Edit mode
                    <>
                      <Row>
                        <Col md={6}>
                          <Form.Group className="mb-2">
                            <Form.Label>Title</Form.Label>
                            <Form.Control
                              type="text"
                              value={editingValues.title || ''}
                              onChange={(e) => setEditingValues({...editingValues, title: e.target.value})}
                            />
                          </Form.Group>
                        </Col>
                        <Col md={3}>
                          <Form.Group className="mb-2">
                            <Form.Label>Status</Form.Label>
                            <Form.Select
                              value={editingValues.status || 0}
                              onChange={(e) => setEditingValues({...editingValues, status: parseInt(e.target.value)})}
                            >
                              <option value={0}>To Do</option>
                              <option value={1}>In Progress</option>
                              <option value={2}>Done</option>
                              <option value={3}>Blocked</option>
                            </Form.Select>
                          </Form.Group>
                        </Col>
                        <Col md={3}>
                          <Form.Group className="mb-2">
                            <Form.Label>Priority</Form.Label>
                            <Form.Select
                              value={editingValues.priority || 2}
                              onChange={(e) => setEditingValues({...editingValues, priority: parseInt(e.target.value)})}
                            >
                              <option value={1}>High</option>
                              <option value={2}>Medium</option>
                              <option value={3}>Low</option>
                            </Form.Select>
                          </Form.Group>
                        </Col>
                      </Row>
                      <Form.Group className="mb-3">
                        <Form.Label>Description</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={2}
                          value={editingValues.description || ''}
                          onChange={(e) => setEditingValues({...editingValues, description: e.target.value})}
                        />
                      </Form.Group>
                      <div className="d-flex gap-2">
                        <Button variant="success" size="sm" onClick={handleSaveEdit}>
                          <Save size={16} className="me-1" />
                          Save
                        </Button>
                        <Button variant="outline-secondary" size="sm" onClick={handleCancelEdit}>
                          <X size={16} className="me-1" />
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    // View mode
                    <>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <div className="flex-grow-1">
                          <h6 className="mb-1">{task.title}</h6>
                          <div className="d-flex gap-2 mb-2">
                            <Badge bg={getStatusColor(task.status)}>
                              {getStatusName(task.status)}
                            </Badge>
                            <Badge bg={getPriorityColor(task.priority)}>
                              {getPriorityName(task.priority)} Priority
                            </Badge>
                            {task.ref && (
                              <Badge bg="light" text="dark">
                                {task.ref}
                              </Badge>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-muted small mb-2">{task.description}</p>
                          )}
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => { try { showSidebar(task as any, 'task'); } catch {} }}
                            title="Activity"
                          >
                            <Activity size={14} />
                          </Button>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => handleStartEdit(task)}
                            title="Edit Task"
                          >
                            <Edit3 size={14} />
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </Card.Body>
              </Card>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default StoryTasksPanel;
