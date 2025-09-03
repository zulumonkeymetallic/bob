import React, { useState, useEffect } from 'react';
import { Card, Button, Badge } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, updateDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Task, Story, Goal, Sprint } from '../types';
import { Plus } from 'lucide-react';
import { generateRef } from '../utils/referenceGenerator';
import { getThemeClass } from '../utils/statusHelpers';
import ModernTaskTable from './ModernTaskTable';

interface DashboardModernTaskTableProps {
  maxTasks?: number;
  showDueToday?: boolean;
  title?: string;
}

const DashboardModernTaskTable: React.FC<DashboardModernTaskTableProps> = ({ 
  maxTasks = 10, 
  showDueToday = false,
  title = "Upcoming Tasks"
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);

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
            color: '#6b7280' 
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📋</div>
            <h6 style={{ marginBottom: '8px', color: '#374151' }}>
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
  );
};

export default DashboardModernTaskTable;
