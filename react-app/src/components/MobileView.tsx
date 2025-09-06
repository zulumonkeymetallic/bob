import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Task, Story, Goal, IHabit, IHabitEntry } from '../types';
import { Container, Card, Button, Badge, ProgressBar, Alert } from 'react-bootstrap';
import { isStatus, isTheme, isPriority } from '../utils/statusHelpers';
import { useTheme } from '../contexts/ModernThemeContext';

const MobileView: React.FC = () => {
  const { theme } = useTheme();
    const { currentUser } = useAuth();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [stories, setStories] = useState<Story[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [habits, setHabits] = useState<IHabit[]>([]);
    const [habitEntries, setHabitEntries] = useState<IHabitEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const themeColors = {
        'Health': '#22c55e',
        'Growth': '#3b82f6', 
        'Wealth': '#eab308',
        'Tribe': '#8b5cf6',
        'Home': '#f97316'
    };

    useEffect(() => {
        if (!currentUser) return;

        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

        // Get important tasks (overdue, due today, high importance, current sprint)
        const tasksQuery = query(
            collection(db, 'tasks'), 
            where('ownerUid', '==', currentUser.uid),
            where('status', 'in', ['todo', 'planned', 'in-progress'])
        );

        const storiesQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
        const goalsQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
        const habitsQuery = query(collection(db, 'habits'), where('ownerUid', '==', currentUser.uid), where('isActive', '==', true));
        
        const habitEntriesQuery = query(
            collection(db, 'habit_entries'),
            where('date', '>=', startOfDay.getTime()),
            where('date', '<', endOfDay.getTime())
        );

        const unsubscribeTasks = onSnapshot(tasksQuery, snapshot => {
            const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
            
            // Filter and sort important tasks
            const importantTasks = tasksData.filter(task => {
                const isDueToday = task.dueDate && task.dueDate >= startOfDay.getTime() && task.dueDate < endOfDay.getTime();
                const isOverdue = task.dueDate && task.dueDate < startOfDay.getTime();
                const isHighImportance = task.isImportant || task.importanceScore && task.importanceScore > 70;
                const isHighPriority = isPriority(task.priority, 'high');
                
                return isDueToday || isOverdue || isHighImportance || isHighPriority;
            }).sort((a, b) => {
                // Sort by: overdue first, then due today, then by importance/priority
                const aOverdue = a.dueDate && a.dueDate < startOfDay.getTime() ? 1 : 0;
                const bOverdue = b.dueDate && b.dueDate < startOfDay.getTime() ? 1 : 0;
                
                if (aOverdue !== bOverdue) return bOverdue - aOverdue;
                
                const aDueToday = a.dueDate && a.dueDate >= startOfDay.getTime() && a.dueDate < endOfDay.getTime() ? 1 : 0;
                const bDueToday = b.dueDate && b.dueDate >= startOfDay.getTime() && b.dueDate < endOfDay.getTime() ? 1 : 0;
                
                if (aDueToday !== bDueToday) return bDueToday - aDueToday;
                
                const aImportance = a.importanceScore || (isPriority(a.priority, 'high') ? 80 : isPriority(a.priority, 'med') ? 50 : 20);
                const bImportance = b.importanceScore || (isPriority(b.priority, 'high') ? 80 : isPriority(b.priority, 'med') ? 50 : 20);
                
                return bImportance - aImportance;
            }).slice(0, 8); // Limit to top 8 for mobile

            setTasks(importantTasks);
            setLoading(false);
        });

        const unsubscribeStories = onSnapshot(storiesQuery, snapshot => {
            const storiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
            setStories(storiesData);
        });

        const unsubscribeGoals = onSnapshot(goalsQuery, snapshot => {
            const goalsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal));
            setGoals(goalsData);
        });

        const unsubscribeHabits = onSnapshot(habitsQuery, snapshot => {
            const habitsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as IHabit));
            setHabits(habitsData.slice(0, 6)); // Limit to 6 habits for mobile
        });

        const unsubscribeHabitEntries = onSnapshot(habitEntriesQuery, snapshot => {
            const entriesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as IHabitEntry));
            setHabitEntries(entriesData);
        });

        return () => {
            unsubscribeTasks();
            unsubscribeStories();
            unsubscribeGoals();
            unsubscribeHabits();
            unsubscribeHabitEntries();
        };
    }, [currentUser]);

    const handleTaskComplete = async (taskId: string) => {
        try {
            await updateDoc(doc(db, 'tasks', taskId), {
                status: 'done',
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error completing task:', error);
        }
    };

    const handleTaskDefer = async (taskId: string) => {
        try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            await updateDoc(doc(db, 'tasks', taskId), {
                dueDate: tomorrow.getTime(),
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error deferring task:', error);
        }
    };

    const getStoryForTask = (task: Task) => {
        return stories.find(s => s.id === task.parentId && task.parentType === 'story');
    };

    const getGoalForStory = (story: Story) => {
        return goals.find(g => g.id === story.goalId);
    };

    const getTaskUrgencyLabel = (task: Task) => {
        const now = new Date().getTime();
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

        if (task.dueDate && task.dueDate < startOfDay) {
            return { label: 'OVERDUE', variant: 'danger' };
        }
        if (task.dueDate && task.dueDate >= startOfDay && task.dueDate < endOfDay) {
            return { label: 'DUE TODAY', variant: 'warning' };
        }
        if (task.isImportant || task.importanceScore && task.importanceScore > 70) {
            return { label: 'IMPORTANT', variant: 'info' };
        }
        if (isPriority(task.priority, 'high')) {
            return { label: 'HIGH PRIORITY', variant: 'primary' };
        }
        return { label: 'FOCUS', variant: 'secondary' };
    };

    const getHabitStreak = (habit: IHabit) => {
        // This would calculate streak from habit entries
        // For now, return a placeholder
        return Math.floor(Math.random() * 10) + 1;
    };

    const isHabitCompletedToday = (habitId: string) => {
        return habitEntries.some(entry => entry.habitId === habitId && entry.isCompleted);
    };

    if (loading) {
        return (
            <Container className="p-3">
                <div className="d-flex justify-content-center p-5">
                    <div className="spinner-border" role="status"></div>
                </div>
            </Container>
        );
    }

    return (
        <Container fluid className="p-3" style={{ maxWidth: '500px' }}>
            {/* Header */}
            <div className="text-center mb-4">
                <h1 className="h3 mb-1">🎯 Important Now</h1>
                <small className="text-muted">
                    {new Date().toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        month: 'long', 
                        day: 'numeric' 
                    })}
                </small>
            </div>

            {/* Habits Strip */}
            {habits.length > 0 && (
                <Card className="mb-4">
                    <Card.Header className="bg-light">
                        <h6 className="mb-0">📊 Today's Habits</h6>
                    </Card.Header>
                    <Card.Body className="p-2">
                        <div className="d-flex flex-wrap gap-2">
                            {habits.map(habit => {
                                const isCompleted = isHabitCompletedToday(habit.id);
                                const streak = getHabitStreak(habit);
                                
                                return (
                                    <div 
                                        key={habit.id} 
                                        className={`flex-fill text-center p-2 rounded ${isCompleted ? 'bg-success text-white' : 'bg-light'}`}
                                        style={{ minWidth: '80px', cursor: 'pointer' }}
                                    >
                                        <div className="small">{habit.name}</div>
                                        <div className="small">
                                            {isCompleted ? '✅' : '⭕'} {streak}🔥
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Card.Body>
                </Card>
            )}

            {/* Important Tasks */}
            {tasks.length > 0 ? (
                <div className="mb-4">
                    {tasks.map(task => {
                        const story = getStoryForTask(task);
                        const goal = story ? getGoalForStory(story) : null;
                        const urgency = getTaskUrgencyLabel(task);
                        const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';

                        return (
                            <Card key={task.id} className="mb-3 shadow-sm">
                                <Card.Body className="p-3">
                                    <div className="d-flex justify-content-between align-items-start mb-2">
                                        <Badge bg={urgency.variant} className="me-2">
                                            {urgency.label}
                                        </Badge>
                                        <small className="text-muted">
                                            {task.ref || task.id.slice(-4)}
                                        </small>
                                    </div>
                                    
                                    <h6 className="mb-2">{task.title}</h6>
                                    
                                    {task.description && (
                                        <p className="text-muted small mb-2">
                                            {task.description.substring(0, 80)}
                                            {task.description.length > 80 && '...'}
                                        </p>
                                    )}
                                    
                                    <div className="d-flex justify-content-between align-items-center mb-3">
                                        <div className="small text-muted">
                                            {goal && (
                                                <span 
                                                    className="badge me-1"
                                                    style={{ backgroundColor: themeColor, color: 'white' }}
                                                >
                                                    {goal.theme}
                                                </span>
                                            )}
                                            {story && <span>{story.title}</span>}
                                            {task.effort && <span> • {task.effort}</span>}
                                        </div>
                                        {task.dueDate && (
                                            <small className="text-muted">
                                                {new Date(task.dueDate).toLocaleTimeString('en-US', { 
                                                    hour: '2-digit', 
                                                    minute: '2-digit' 
                                                })}
                                            </small>
                                        )}
                                    </div>
                                    
                                    <div className="d-flex gap-2">
                                        <Button 
                                            variant="success" 
                                            size="sm" 
                                            className="flex-fill"
                                            onClick={() => handleTaskComplete(task.id)}
                                        >
                                            ✓ Complete
                                        </Button>
                                        <Button 
                                            variant="outline-secondary" 
                                            size="sm"
                                            onClick={() => handleTaskDefer(task.id)}
                                        >
                                            Defer
                                        </Button>
                                    </div>
                                </Card.Body>
                            </Card>
                        );
                    })}
                </div>
            ) : (
                <Alert variant="success" className="text-center">
                    <Alert.Heading>🎉 All Clear!</Alert.Heading>
                    <p>No urgent tasks right now. Great job staying on top of things!</p>
                    <Button variant="outline-success" size="sm">
                        View All Tasks
                    </Button>
                </Alert>
            )}

            {/* Quick Actions */}
            <Card>
                <Card.Header className="bg-light">
                    <h6 className="mb-0">⚡ Quick Actions</h6>
                </Card.Header>
                <Card.Body className="p-2">
                    <div className="d-grid gap-2">
                        <Button variant="outline-primary" size="sm">
                            + Add Quick Task
                        </Button>
                        <Button variant="outline-info" size="sm">
                            📅 View Calendar
                        </Button>
                        <Button variant="outline-success" size="sm">
                            🎯 Sprint Progress
                        </Button>
                    </div>
                </Card.Body>
            </Card>
        </Container>
    );
};

export default MobileView;
