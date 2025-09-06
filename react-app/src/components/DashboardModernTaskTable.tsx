import React, { useState, useEffect } from 'react';
import { Card, Button, Badge, Form, Row, Col, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, updateDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Task, Story, Goal, Sprint } from '../types';
import { Plus, Filter, Calendar, Clock, Target } from 'lucide-react';
import { generateRef } from '../utils/referenceGenerator';
import { getThemeClass, getThemeName, getStatusName, getPriorityName } from '../utils/statusHelpers';
import { getDeadlineInfo } from '../utils/deadlineUtils';
import ModernTaskTable from './ModernTaskTable';
import { useTheme } from '../contexts/ModernThemeContext';

interface DashboardModernTaskTableProps {
  maxTasks?: number;
  showDueToday?: boolean;
  title?: string;
  showMetrics?: boolean;
}

const DashboardModernTaskTable: React.FC<DashboardModernTaskTableProps> = ({ 
  maxTasks = 10, 
  showDueToday = false,
  title = "Upcoming Tasks",
  showMetrics = true
}) => {
  const { theme } = useTheme();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    openTasks: 0,
    openStories: 0,
    tasksDueToday: 0,
    activeSprint: null as Sprint | null,
    daysLeftInSprint: 0
  });

  useEffect(() => {
    if (!currentUser || !currentPersona) return;

    const setupSubscriptions = () => {
      // Tasks subscription
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );
      
      const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
        const tasksData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        
        let filteredTasks = tasksData.filter(task => !task.deleted);
        
        if (showDueToday) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          filteredTasks = filteredTasks.filter(task => {
            if (!task.dueDate) return false;
            const dueDate = new Date(task.dueDate);
            return dueDate >= today && dueDate < tomorrow;
          });
        } else {
          // For upcoming tasks, exclude completed and show recent
          filteredTasks = filteredTasks
            .filter(task => task.status !== 3) // not done
            .sort((a, b) => {
              // Sort by priority first, then by due date
              if (a.priority !== b.priority) {
                return (b.priority || 0) - (a.priority || 0);
              }
              if (a.dueDate && b.dueDate) {
                const dateA = new Date(a.dueDate);
                const dateB = new Date(b.dueDate);
                return dateA.getTime() - dateB.getTime();
              }
              return 0;
            })
            .slice(0, maxTasks);
        }
        
        setTasks(filteredTasks);
      });

      // Stories subscription
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );
      
      const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Story[];
        setStories(storiesData.filter(story => !(story as any).deleted));
      });

      // Goals subscription
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );
      
      const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Goal[];
        setGoals(goalsData.filter(goal => !(goal as any).deleted));
      });

      // Sprints subscription
      const sprintsQuery = query(
        collection(db, 'sprints'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );
      
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

    return setupSubscriptions();
  }, [currentUser, currentPersona, maxTasks, showDueToday]);

  // Calculate metrics when data changes
  useEffect(() => {
    if (tasks.length === 0 && stories.length === 0 && sprints.length === 0) return;

    const openTasks = tasks.filter(task => task.status !== 2).length; // Not Done
    const openStories = stories.filter(story => story.status !== 4).length; // Not Done
    
    // Find active sprint
    const activeSprint = sprints.find(sprint => sprint.status === 1); // Active
    
    // Calculate days left in active sprint
    let daysLeftInSprint = 0;
    if (activeSprint) {
      const now = new Date();
      const endDate = new Date(activeSprint.endDate);
      daysLeftInSprint = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    }
    
    // Calculate tasks due today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const tasksDueToday = tasks.filter(task => {
      if (!task.dueDate || task.status === 3) return false; // exclude completed tasks
      const dueDate = new Date(task.dueDate);
      return dueDate >= today && dueDate < tomorrow;
    }).length;
    
    setMetrics({
      openTasks,
      openStories,
      tasksDueToday,
      activeSprint,
      daysLeftInSprint
    });
  }, [tasks, stories, sprints]);

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    try {
      console.log(`🔄 Dashboard: Updating task ${taskId}:`, updates);
      
      await updateDoc(doc(db, 'tasks', taskId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
      
      console.log(`✅ Dashboard: Task ${taskId} updated successfully`);
    } catch (error) {
      console.error('❌ Dashboard: Error updating task:', error);
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        deleted: true,
        updatedAt: serverTimestamp()
      });
      console.log(`✅ Dashboard: Task ${taskId} marked as deleted`);
    } catch (error) {
      console.error('❌ Dashboard: Error deleting task:', error);
    }
  };

  const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        priority: newPriority,
        updatedAt: serverTimestamp()
      });
      console.log(`✅ Dashboard: Task ${taskId} priority updated to ${newPriority}`);
    } catch (error) {
      console.error('❌ Dashboard: Error updating task priority:', error);
    }
  };

  const handleAddTask = async () => {
    if (!currentUser) return;

    try {
      const newTask = {
        title: 'New Task',
        description: '',
        ref: generateRef('task', []),
        status: 0, // todo
        priority: 1, // medium
        theme: 0, // default
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        deleted: false
      } as any;

      const docRef = await addDoc(collection(db, 'tasks'), newTask);
      console.log(`✅ Dashboard: New task created with ID: ${docRef.id}`);
    } catch (error) {
      console.error('❌ Dashboard: Error creating task:', error);
    }
  };

  // Get theme color for task cards
  const getTaskThemeColor = (task: Task) => {
    const storyId = task.parentId || task.storyId;
    if (storyId) {
      const story = stories.find(s => s.id === storyId);
      if (story && story.theme !== undefined) {
        return getThemeClass(story.theme);
      }
    }
    
    const goalId = task.goalId;
    if (goalId) {
      const goal = goals.find(g => g.id === goalId);
      if (goal && goal.theme !== undefined) {
        return getThemeClass(goal.theme);
      }
    }
    
    return 'bg-light';
  };

  if (loading) {
    return (
      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <Card.Header style={{ 
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
          color: 'white',
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
            {title}
          </h5>
        </Card.Header>
        <Card.Body style={{ padding: '20px', textAlign: 'center' }}>
          <div>Loading tasks...</div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <>
      {/* Metrics Panel */}
      {showMetrics && (
        <Row className="mb-4">
          <Col md={3}>
            <Card className="text-center border-0 shadow-sm">
              <Card.Body>
                <Target size={24} className="text-primary mb-2" />
                <h4 className="mb-0 text-primary">{metrics.openTasks}</h4>
                <small className="text-muted">Open Tasks</small>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center border-0 shadow-sm">
              <Card.Body>
                <Calendar size={24} className="text-info mb-2" />
                <h4 className="mb-0 text-info">{metrics.openStories}</h4>
                <small className="text-muted">Open Stories</small>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center border-0 shadow-sm">
              <Card.Body>
                <Clock size={24} className="text-warning mb-2" />
                <h4 className="mb-0 text-warning">{metrics.tasksDueToday}</h4>
                <small className="text-muted">Due Today</small>
              </Card.Body>
            </Card>
          </Col>
          <Col md={3}>
            <Card className="text-center border-0 shadow-sm">
              <Card.Body>
                <Calendar size={24} className="text-success mb-2" />
                <h4 className="mb-0 text-success">{metrics.daysLeftInSprint}</h4>
                <small className="text-muted">
                  Days Left{metrics.activeSprint ? ` in ${metrics.activeSprint.name}` : ''}
                </small>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Task Deadlines Alert */}
            {metrics.tasksDueToday > 0 && (
        <Alert variant="warning" className="mb-3">
          <Clock size={18} className="me-2" />
          <strong>
            <strong>{metrics.tasksDueToday}</strong> task{metrics.tasksDueToday !== 1 ? 's' : ''} 
            {metrics.tasksDueToday === 1 ? ' is' : ' are'} due today
          </strong>
        </Alert>
      )}

      <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <Card.Header style={{ 
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
          color: 'white',
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              {title}
            </h5>
            <Badge bg="light" text="dark" style={{ fontSize: '12px' }}>
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
            </Badge>
          </div>
          <Button 
            variant="light" 
            size="sm" 
            onClick={handleAddTask}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            <Plus size={16} />
            Add Task
          </Button>
        </Card.Header>
      <Card.Body style={{ padding: 0 }}>
        {tasks.length === 0 ? (
          <div style={{ 
            padding: '40px 20px', 
            textAlign: 'center', 
            color: theme.colors.onSurface 
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📋</div>
            <h6 style={{ marginBottom: '8px', color: theme.colors.onSurface }}>
              {showDueToday ? 'No tasks due today' : 'No upcoming tasks'}
            </h6>
            <p style={{ marginBottom: '20px', fontSize: '14px' }}>
              {showDueToday 
                ? 'Great! You\'re all caught up for today.' 
                : 'Create a new task to get started.'
              }
            </p>
            {!showDueToday && (
              <Button variant="primary" size="sm" onClick={handleAddTask}>
                <Plus size={16} style={{ marginRight: '6px' }} />
                Create First Task
              </Button>
            )}
          </div>
        ) : (
          <div style={{ height: '400px', overflow: 'auto' }}>
            <ModernTaskTable
              tasks={tasks}
              stories={stories}
              goals={goals}
              sprints={sprints}
              onTaskUpdate={handleTaskUpdate}
              onTaskDelete={handleTaskDelete}
              onTaskPriorityChange={handleTaskPriorityChange}
              defaultColumns={['ref', 'title', 'description', 'dueDate', 'storyTitle', 'goalTitle']}
              compact={true}
            />
          </div>
        )}
      </Card.Body>
    </Card>
    </>
  );
};

export default DashboardModernTaskTable;
