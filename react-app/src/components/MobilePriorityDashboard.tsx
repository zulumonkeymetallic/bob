import React, { useState, useEffect } from 'react';
import { Container, Card, Form, Button, Badge, ListGroup } from 'react-bootstrap';
import { Check2Square, Square, Star, Clock, ExclamationTriangle } from 'react-bootstrap-icons';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp, orderBy, limit } from 'firebase/firestore';
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
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'today' | 'urgent' | 'completed'>('today');

  useEffect(() => {
    if (!currentUser) return;

    // Subscribe to tasks
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);

    let tasksQuery;
    const base = collection(db, 'sprint_task_index'); // Using index for efficiency

    // Simplified query for MVP - fetch open tasks and filter client side if needed, 
    // or use basic compound queries.
    // To avoid index issues, let's just fetch all open tasks for the user and filter in memory for now,
    // unless the dataset is huge. 
    // Or stick to the existing logic if it works.
    // The existing logic used 'sprint_task_index'.

    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('status', '!=', 4) // Not done
    );
    // Note: '!=' requires index. Let's use simple query.
    const q2 = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));

    const unsubscribeTasks = onSnapshot(q2, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)) as Task[];
      // Client-side filtering for the view
      setTasks(tasksData);
    });

    // Subscribe to stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('status', '==', 'active')
    );
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)) as Story[];
      setStories(storiesData);
    });

    // Subscribe to calendar blocks (rolling 3 days)
    const calStart = new Date(); calStart.setHours(0, 0, 0, 0);
    const calEnd = new Date(); calEnd.setDate(calEnd.getDate() + 3);
    const blocksQuery = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', calStart.getTime()),
      where('start', '<=', calEnd.getTime()),
      orderBy('start', 'asc')
    );
    const unsubscribeBlocks = onSnapshot(blocksQuery, (snapshot) => {
      const b = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setCalendarBlocks(b);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeStories();
      unsubscribeBlocks();
    };
  }, [currentUser]);

  const handleToggleTask = async (task: Task) => {
    if (!task.id) return;
    try {
      const newStatus = task.status === 2 ? 0 : 2; // Toggle between 0 (Todo) and 2 (Done) - assuming 2 is done based on previous code
      await updateDoc(doc(db, 'tasks', task.id), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error toggling task:", error);
    }
  };

  // Helper to group blocks by day
  const blocksByDay = calendarBlocks.reduce((acc, block) => {
    const d = new Date(block.start).toDateString();
    if (!acc[d]) acc[d] = [];
    acc[d].push(block);
    return acc;
  }, {} as Record<string, any[]>);

  const sortedDays = Object.keys(blocksByDay).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  // Filter tasks for display
  const filteredTasks = tasks.filter(task => {
    const isDone = task.status === 2; // Assuming 2 is done
    switch (filter) {
      case 'today':
        const today = new Date().toDateString();
        return !isDone && (task.dueDate ? new Date(task.dueDate).toDateString() === today : true); // Default to today if no due date? Or just show all pending?
      case 'urgent':
        return !isDone && (isPriority(task.priority, 'High') || isPriority(task.priority, 'Critical'));
      case 'completed':
        return isDone;
      case 'all':
      default:
        return !isDone;
    }
  });

  // Use filteredTasks for rendering
  const tasksToRender = filteredTasks;

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
    <Container fluid className="p-0" style={{ maxWidth: '100vw', overflowX: 'hidden', paddingBottom: '80px' }}>
      {/* Header */}
      <div className="bg-white p-3 shadow-sm sticky-top border-bottom" style={{ zIndex: 1020 }}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h4 className="fw-bold mb-0">My Day</h4>
          <Badge bg="primary" pill>{tasks.length} Tasks</Badge>
        </div>

        {/* Compact Rolling Calendar */}
        <div className="d-flex gap-3 overflow-auto pb-2" style={{ whiteSpace: 'nowrap' }}>
          {sortedDays.map(dayStr => {
            const date = new Date(dayStr);
            const isToday = date.toDateString() === new Date().toDateString();
            return (
              <div key={dayStr} className="d-inline-block" style={{ minWidth: '140px', verticalAlign: 'top' }}>
                <div className={`small fw-bold mb-1 ${isToday ? 'text-primary' : 'text-muted'}`}>
                  {date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                </div>
                <div className="d-flex flex-column gap-1">
                  {blocksByDay[dayStr].map((block: any) => (
                    <div key={block.id} className="rounded p-1 border bg-light" style={{ fontSize: '0.75rem', whiteSpace: 'normal' }}>
                      <div className="fw-bold text-truncate">{new Date(block.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="text-truncate">{block.title || 'Untitled'}</div>
                    </div>
                  ))}
                  {blocksByDay[dayStr].length === 0 && <div className="text-muted small fst-italic">No events</div>}
                </div>
              </div>
            );
          })}
          {sortedDays.length === 0 && <div className="text-muted small p-2">No upcoming events scheduled.</div>}
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 bg-light border-bottom d-flex gap-2 overflow-auto">
        {['today', 'urgent', 'all', 'completed'].map(f => (
          <Button
            key={f}
            variant={filter === f ? 'dark' : 'outline-secondary'}
            size="sm"
            className="rounded-pill px-3"
            onClick={() => setFilter(f as any)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {/* Task List */}
      <div className="p-3">
        {tasks.length === 0 ? (
          <div className="text-center py-5 text-muted">
            <Check2Square size={48} className="mb-3 opacity-50" />
            <p>No tasks found for this view.</p>
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {tasks.map(task => (
              <Card key={task.id} className="border-0 shadow-sm">
                <Card.Body className="p-3">
                  <div className="d-flex gap-3">
                    <div className="pt-1">
                      <Form.Check
                        type="checkbox"
                        checked={task.status === 2}
                        onChange={() => handleToggleTask(task)}
                        style={{ transform: 'scale(1.2)' }}
                      />
                    </div>
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between align-items-start mb-1">
                        <h6 className={`mb-0 fw-bold ${task.status === 2 ? 'text-decoration-line-through text-muted' : ''}`}>
                          {task.title}
                        </h6>
                        {(isPriority(task.priority, 'High') || isPriority(task.priority, 'Critical')) && <Star className="text-warning flex-shrink-0" fill="currentColor" />}
                      </div>

                      <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                        {task.theme && (
                          <Badge bg={getBadgeVariant(task.theme)} className="fw-normal">
                            {getThemeName(task.theme)}
                          </Badge>
                        )}
                        {task.dueDate && (
                          <small className={`d-flex align-items-center gap-1 ${task.dueDate < Date.now() && task.status !== 2 ? 'text-danger fw-bold' : 'text-muted'}`}>
                            <Clock size={12} />
                            {new Date(task.dueDate).toLocaleDateString()}
                          </small>
                        )}
                      </div>
                    </div>
                  </div>
                </Card.Body>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
};

export default MobilePriorityDashboard;

export { };
