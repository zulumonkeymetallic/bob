import React, { useState, useEffect } from 'react';
import { Container, Card, Form, Button, Badge, ListGroup } from 'react-bootstrap';
import { Check2Square, Square, Star, Clock, ExclamationTriangle } from 'react-bootstrap-icons';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useDeviceInfo } from '../utils/deviceDetection';
import { Task, Story } from '../types';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '../utils/statusHelpers';

interface MobilePriorityDashboardProps {
  selectedDate?: Date;
}

const MobilePriorityDashboard: React.FC<MobilePriorityDashboardProps> = ({ 
  selectedDate = new Date() 
}) => {
  const { currentUser } = useAuth();
  const deviceInfo = useDeviceInfo();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [filter, setFilter] = useState<'all' | 'today' | 'urgent' | 'completed'>('today');

  useEffect(() => {
    if (!currentUser) return;

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

    // Subscribe to stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('status', '==', 'active')
    );
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Story));
      setStories(storiesData);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeStories();
    };
  }, [currentUser]);

  const toggleTaskComplete = async (taskId: string, currentStatus: number) => {
    try {
      const newStatus = isStatus(currentStatus, 'done') ? 0 : 4; // 0=planned, 4=done
      await updateDoc(doc(db, 'tasks', taskId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'danger';
      case 'med':
        return 'warning';
      case 'low':
        return 'info';
      default:
        return 'secondary';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return <ExclamationTriangle className="me-1" />;
      case 'med':
        return <Star className="me-1" />;
      default:
        return <Clock className="me-1" />;
    }
  };

  const filteredTasks = tasks.filter(task => {
    switch (filter) {
      case 'today':
        const today = new Date().toDateString();
        return !isStatus(task.status, 'done') && (task.dueDate ? new Date(task.dueDate).toDateString() === today : true);
      case 'urgent':
        return !isStatus(task.status, 'done') && isPriority(task.priority, 'high');
      case 'completed':
        return isStatus(task.status, 'done');
      default:
        return true;
    }
  });

  const urgentStories = stories.filter(story => 
    isPriority(story.priority, 'High') && isStatus(story.status, 'active')
  );

  if (!deviceInfo.isMobile) {
    return (
      <Card className="mb-4">
        <Card.Body>
          <p className="text-muted">This mobile-optimized view is available on mobile devices.</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Container fluid className="mobile-priority-dashboard p-2">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Today's Priorities</h4>
        <Badge bg="primary">{filteredTasks.length} items</Badge>
      </div>

      {/* Filter Tabs */}
      <div className="mobile-filter-tabs mb-3">
        <div className="btn-group w-100" role="group">
          {[
            { key: 'today', label: 'Today', icon: <Clock size={16} /> },
            { key: 'urgent', label: 'Urgent', icon: <ExclamationTriangle size={16} /> },
            { key: 'completed', label: 'Done', icon: <Check2Square size={16} /> }
          ].map(({ key, label, icon }) => (
            <Button
              key={key}
              variant={filter === key ? 'primary' : 'outline-primary'}
              size="sm"
              onClick={() => setFilter(key as any)}
              className="d-flex align-items-center justify-content-center"
            >
              {icon}
              <span className="ms-1 d-none d-sm-inline">{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Urgent Stories Alert */}
      {urgentStories.length > 0 && filter !== 'completed' && (
        <Card className="mb-3 border-danger">
          <Card.Header className="bg-danger text-white d-flex align-items-center">
            <ExclamationTriangle className="me-2" />
            <strong>Urgent Stories</strong>
          </Card.Header>
          <Card.Body className="p-2">
            {urgentStories.slice(0, 3).map(story => (
              <div key={story.id} className="d-flex align-items-center mb-2">
                <Badge bg="danger" className="me-2">P1</Badge>
                <small className="text-truncate">{story.title}</small>
              </div>
            ))}
          </Card.Body>
        </Card>
      )}

      {/* Task List */}
      <div className="mobile-task-list">
        {filteredTasks.length === 0 ? (
          <Card className="text-center p-4">
            <Card.Body>
              <div className="text-muted mb-2">
                {filter === 'completed' ? (
                  <Check2Square size={48} />
                ) : (
                  <Clock size={48} />
                )}
              </div>
              <p className="text-muted mb-0">
                {filter === 'completed' 
                  ? 'No completed tasks today' 
                  : 'No tasks for today'}
              </p>
            </Card.Body>
          </Card>
        ) : (
          <ListGroup>
            {filteredTasks.map(task => (
              <ListGroup.Item
                key={task.id}
                className={`mobile-task-item d-flex align-items-start ${isStatus(task.status, 'done') ? 'completed-task' : ''}`}
                action
                onClick={() => toggleTaskComplete(task.id!, task.status)}
              >
                <div className="me-3 mt-1">
                  {isStatus(task.status, 'done') ? (
                    <Check2Square className="text-success" size={20} />
                  ) : (
                    <Square className="text-muted" size={20} />
                  )}
                </div>
                
                <div className="flex-grow-1">
                  <div className="d-flex align-items-center mb-1">
                    <span className={`task-title ${isStatus(task.status, 'done') ? 'text-decoration-line-through text-muted' : ''}`}>
                      {task.title}
                    </span>
                  </div>
                  
                  {task.description && (
                    <small className="text-muted d-block mb-1">
                      {task.description.length > 60 
                        ? `${task.description.substring(0, 60)}...` 
                        : task.description}
                    </small>
                  )}
                  
                  <div className="d-flex align-items-center">
                    <Badge 
                      bg={getPriorityColor(getPriorityName(task.priority))} 
                      className="me-2"
                      style={{ fontSize: '0.7rem' }}
                    >
                      {getPriorityIcon(getPriorityName(task.priority))}
                      {task.priority}
                    </Badge>
                    
                    {task.effort && (
                      <Badge bg="light" text="dark" style={{ fontSize: '0.7rem' }}>
                        {task.effort}
                      </Badge>
                    )}
                  </div>
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </div>

      {/* Quick Stats */}
      <Card className="mt-3 mobile-stats">
        <Card.Body className="p-2">
          <div className="row text-center">
            <div className="col-4">
              <div className="text-primary fw-bold">{tasks.filter(t => !isStatus(t.status, 'done')).length}</div>
              <small className="text-muted">Pending</small>
            </div>
            <div className="col-4">
              <div className="text-success fw-bold">{tasks.filter(t => isStatus(t.status, 'done')).length}</div>
              <small className="text-muted">Done</small>
            </div>
            <div className="col-4">
              <div className="text-warning fw-bold">{tasks.filter(t => isPriority(t.priority, 'high') && !isStatus(t.status, 'done')).length}</div>
              <small className="text-muted">Urgent</small>
            </div>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default MobilePriorityDashboard;

export {};
