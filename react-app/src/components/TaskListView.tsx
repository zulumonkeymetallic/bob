import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Table, Badge, Button, Dropdown, Form, InputGroup, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Task, Story, Goal, Sprint } from '../types';

interface TaskWithContext extends Task {
  storyTitle?: string;
  goalTitle?: string;
  sprintName?: string;
  theme?: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
}

const TaskListView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [tasks, setTasks] = useState<TaskWithContext[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSprint, setFilterSprint] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    loadTaskData();
  }, [currentUser, currentPersona]);

  const loadTaskData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load all related data
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('priority', 'desc')
    );
    
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc')
    );

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      
      setTasks(tasksData);
    });

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      
      setStories(storiesData);
    });

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      
      setGoals(goalsData);
    });

    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      
      setSprints(sprintsData);
    });

    setLoading(false);

    return () => {
      unsubscribeTasks();
      unsubscribeStories();
      unsubscribeGoals();
      unsubscribeSprints();
    };
  };

  // Enhance tasks with context information
  const tasksWithContext: TaskWithContext[] = tasks.map(task => {
    const story = stories.find(s => s.id === task.parentId && task.parentType === 'story');
    const goal = story ? goals.find(g => g.id === story.goalId) : null;
    const sprint = story?.sprintId ? sprints.find(s => s.id === story.sprintId) : null;
    
    return {
      ...task,
      storyTitle: story?.title,
      goalTitle: goal?.title,
      sprintName: sprint?.name,
      theme: goal?.theme
    };
  });

  // Apply filters
  const filteredTasks = tasksWithContext.filter(task => {
    if (filterStatus !== 'all' && task.status !== filterStatus) return false;
    if (filterSprint !== 'all') {
      if (filterSprint === 'unassigned' && task.sprintName) return false;
      if (filterSprint !== 'unassigned' && task.sprintName !== filterSprint) return false;
    }
    if (filterTheme !== 'all' && task.theme !== filterTheme) return false;
    if (searchTerm && !task.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const updateTaskStatus = async (taskId: string, newStatus: 'planned' | 'in_progress' | 'done') => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  const moveTaskToSprint = async (taskId: string, targetSprintId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.parentType !== 'story') return;
    
    try {
      // Update the story's sprint instead of the task directly
      await updateDoc(doc(db, 'stories', task.parentId), {
        sprintId: targetSprintId,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error moving task to sprint:', error);
    }
  };

  const convertToStory = async (task: TaskWithContext) => {
    if (!currentUser) return;
    
    try {
      // Create a new story from the task
      const storyData = {
        title: task.title,
        description: task.description || '',
        goalId: task.goalTitle ? goals.find(g => g.title === task.goalTitle)?.id || '' : '',
        status: 'backlog' as const,
        priority: task.priority === 'high' ? 'P1' as const : 
                 task.priority === 'med' ? 'P2' as const : 'P3' as const,
        points: task.effort === 'L' ? 5 : task.effort === 'M' ? 3 : 1,
        wipLimit: 3,
        orderIndex: Date.now(),
        persona: currentPersona,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      await addDoc(collection(db, 'stories'), storyData);
      
      // Update original task status to done (converted)
      await updateDoc(doc(db, 'tasks', task.id), {
        status: 'done' as const,
        updatedAt: serverTimestamp()
      });
      
    } catch (error) {
      console.error('Error converting task to story:', error);
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'done': return 'success';
      case 'in_progress': return 'warning';
      case 'planned': return 'secondary';
      default: return 'secondary';
    }
  };

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'high': return 'danger';
      case 'med': return 'warning';
      case 'low': return 'secondary';
      default: return 'secondary';
    }
  };

  const getThemeColor = (theme?: string): string => {
    switch (theme) {
      case 'Health': return 'success';
      case 'Growth': return 'primary';
      case 'Wealth': return 'warning';
      case 'Tribe': return 'info';
      case 'Home': return 'secondary';
      default: return 'light';
    }
  };

  const getEffortColor = (effort: string): string => {
    switch (effort) {
      case 'L': return 'danger';
      case 'M': return 'warning';
      case 'S': return 'success';
      default: return 'secondary';
    }
  };

  if (!currentUser) {
    return <div>Please sign in to view your tasks.</div>;
  }

  const themes = [...new Set(goals.map(g => g.theme))];
  const sprintNames = [...new Set(sprints.map(s => s.name))];
  const taskStats = {
    total: filteredTasks.length,
    planned: filteredTasks.filter(t => t.status === 'planned').length,
    inProgress: filteredTasks.filter(t => t.status === 'in_progress').length,
    done: filteredTasks.filter(t => t.status === 'done').length
  };

  return (
    <Container fluid className="p-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Task List View</h2>
            <Button variant="outline-primary" href="/kanban">
              Switch to Kanban
            </Button>
          </div>

          {/* Task Stats */}
          <Row className="mb-4">
            <Col md={3}>
              <Card className="text-center">
                <Card.Body>
                  <h4 className="text-primary">{taskStats.total}</h4>
                  <small>Total Tasks</small>
                </Card.Body>
              </Card>
            </Col>
            <Col md={3}>
              <Card className="text-center">
                <Card.Body>
                  <h4 className="text-secondary">{taskStats.planned}</h4>
                  <small>Planned</small>
                </Card.Body>
              </Card>
            </Col>
            <Col md={3}>
              <Card className="text-center">
                <Card.Body>
                  <h4 className="text-warning">{taskStats.inProgress}</h4>
                  <small>In Progress</small>
                </Card.Body>
              </Card>
            </Col>
            <Col md={3}>
              <Card className="text-center">
                <Card.Body>
                  <h4 className="text-success">{taskStats.done}</h4>
                  <small>Done</small>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Filters */}
          <Card className="mb-4">
            <Card.Body>
              <Row>
                <Col md={3}>
                  <Form.Group>
                    <Form.Label>Search Tasks</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="Search by title..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label>Status</Form.Label>
                    <Form.Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                      <option value="all">All Status</option>
                      <option value="planned">Planned</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label>Sprint</Form.Label>
                    <Form.Select value={filterSprint} onChange={(e) => setFilterSprint(e.target.value)}>
                      <option value="all">All Sprints</option>
                      <option value="unassigned">Unassigned</option>
                      {sprintNames.map(sprintName => (
                        <option key={sprintName} value={sprintName}>{sprintName}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={2}>
                  <Form.Group>
                    <Form.Label>Theme</Form.Label>
                    <Form.Select value={filterTheme} onChange={(e) => setFilterTheme(e.target.value)}>
                      <option value="all">All Themes</option>
                      {themes.map(theme => (
                        <option key={theme} value={theme}>{theme}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3} className="d-flex align-items-end">
                  <Button 
                    variant="outline-secondary" 
                    onClick={() => {
                      setFilterStatus('all');
                      setFilterSprint('all');
                      setFilterTheme('all');
                      setSearchTerm('');
                    }}
                  >
                    Clear Filters
                  </Button>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          {/* Tasks Table */}
          <Card>
            <Card.Header>
              <h5 className="mb-0">Tasks ({filteredTasks.length})</h5>
            </Card.Header>
            <Card.Body className="p-0">
              {loading ? (
                <div className="text-center p-4">
                  <div className="spinner-border" />
                  <p className="mt-2">Loading tasks...</p>
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center p-4">
                  <p className="mb-0">No tasks found with current filters.</p>
                </div>
              ) : (
                <Table responsive hover className="mb-0">
                  <thead className="bg-light">
                    <tr>
                      <th>Task</th>
                      <th>Story</th>
                      <th>Goal</th>
                      <th>Sprint</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Effort</th>
                      <th>Theme</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map(task => (
                      <tr key={task.id}>
                        <td>
                          <div>
                            <strong>{task.title}</strong>
                            {task.description && (
                              <div className="text-muted small">{task.description}</div>
                            )}
                          </div>
                        </td>
                        <td>
                          {task.storyTitle ? (
                            <small>{task.storyTitle}</small>
                          ) : (
                            <Badge bg="light" text="dark">Personal Task</Badge>
                          )}
                        </td>
                        <td>
                          {task.goalTitle ? (
                            <small>{task.goalTitle}</small>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {task.sprintName ? (
                            <Badge bg="info">{task.sprintName}</Badge>
                          ) : (
                            <Badge bg="light" text="dark">Unassigned</Badge>
                          )}
                        </td>
                        <td>
                          <Dropdown>
                            <Dropdown.Toggle 
                              as={Badge} 
                              bg={getStatusColor(task.status)}
                              style={{ cursor: 'pointer' }}
                            >
                              {task.status.replace('_', ' ')}
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
                          <Badge bg={getPriorityColor(task.priority)}>{task.priority}</Badge>
                        </td>
                        <td>
                          <Badge bg={getEffortColor(task.effort)}>{task.effort}</Badge>
                        </td>
                        <td>
                          {task.theme ? (
                            <Badge bg={getThemeColor(task.theme)}>{task.theme}</Badge>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          <div className="d-flex gap-1">
                            {/* Edit Button */}
                            <Button
                              variant="outline-primary"
                              size="sm"
                              onClick={() => {/* TODO: Add edit functionality */}}
                              title="Edit Task"
                            >
                              <i className="fas fa-edit"></i>
                            </Button>
                            
                            {/* Convert to Story */}
                            <Button
                              variant="outline-primary"
                              size="sm"
                              onClick={() => convertToStory(task)}
                              title="Convert to Story"
                            >
                              📝
                            </Button>
                            
                            {/* Move Sprint */}
                            {sprints.length > 0 && task.parentType === 'story' && (
                              <Dropdown>
                                <Dropdown.Toggle variant="outline-info" size="sm">
                                  📋
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                  <Dropdown.Header>Move to Sprint</Dropdown.Header>
                                  {sprints.map(sprint => (
                                    <Dropdown.Item 
                                      key={sprint.id}
                                      onClick={() => moveTaskToSprint(task.id, sprint.id)}
                                      active={sprint.name === task.sprintName}
                                    >
                                      {sprint.name}
                                    </Dropdown.Item>
                                  ))}
                                </Dropdown.Menu>
                              </Dropdown>
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
          
          {/* Conversion Helper */}
          {filteredTasks.filter(t => !t.storyTitle).length > 0 && (
            <Alert variant="info" className="mt-4">
              <strong>💡 Tip:</strong> You have {filteredTasks.filter(t => !t.storyTitle).length} personal tasks that can be converted to stories and added to sprints. 
              Use the 📝 button to convert them for better sprint planning!
            </Alert>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default TaskListView;

export {};
