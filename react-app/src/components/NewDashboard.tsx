import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Badge, ProgressBar } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Task, Goal, Story } from '../types';
import FloatingActionButton from './FloatingActionButton';
import ImportExportModal from './ImportExportModal';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import '../styles/MaterialDesign.css';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '../utils/statusHelpers';

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    if (!currentUser) return;

    // Load tasks
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData: Task[] = [];
      snapshot.forEach((doc) => {
        tasksData.push({ id: doc.id, ...doc.data() } as Task);
      });
      setTasks(tasksData);
    });

    // Load goals (personal only)
    let unsubscribeGoals = () => {};
    let unsubscribeStories = () => {};
    
    if (currentPersona === 'personal') {
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );

      unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData: Goal[] = [];
        snapshot.forEach((doc) => {
          goalsData.push({ id: doc.id, ...doc.data() } as Goal);
        });
        setGoals(goalsData);
      });

      // Load stories
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona)
      );

      unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData: Story[] = [];
        snapshot.forEach((doc) => {
          storiesData.push({ id: doc.id, ...doc.data() } as Story);
        });
        setStories(storiesData);
      });
    }

    return () => {
      unsubscribeTasks();
      unsubscribeGoals();
      unsubscribeStories();
    };
  }, [currentUser, currentPersona]);

  const getTaskStats = () => {
    const total = tasks.length;
    const inProgress = tasks.filter(t => isStatus(t.status, 'in_progress')).length;
    const completed = tasks.filter(t => isStatus(t.status, 'done')).length;
    const planned = tasks.filter(t => isStatus(t.status, 'planned')).length;
    
    return { total, inProgress, completed, planned };
  };

  const getThemeStats = () => {
    const themes = GLOBAL_THEMES.map(theme => theme.name);
    return themes.map(theme => {
      const themeTasks = tasks.filter(t => isTheme(t.theme, theme));
      const completed = themeTasks.filter(t => isStatus(t.status, 'done')).length;
      const total = themeTasks.length;
      const progress = total > 0 ? (completed / total) * 100 : 0;
      
      return { theme, completed, total, progress };
    });
  };

  const getGoalProgress = (goalId: string) => {
    const goalStories = stories.filter(s => s.goalId === goalId);
    const completedStories = goalStories.filter(s => isStatus(s.status, 'done')).length;
    const totalStories = goalStories.length;
    
    return totalStories > 0 ? (completedStories / totalStories) * 100 : 0;
  };

  const getRecentTasks = () => {
    return tasks
      .filter(t => !isStatus(t.status, 'done'))
      .sort((a, b) => {
        // Sort by priority and due date
        const priorityOrder = { high: 3, med: 2, low: 1 };
        const aPriority = priorityOrder[getPriorityName(a.priority) as keyof typeof priorityOrder] || 1;
        const bPriority = priorityOrder[getPriorityName(b.priority) as keyof typeof priorityOrder] || 1;
        
        if (aPriority !== bPriority) return bPriority - aPriority;
        
        if (a.dueDate && b.dueDate) {
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        }
        
        return 0;
      })
      .slice(0, 5);
  };

  const stats = getTaskStats();
  const themeStats = getThemeStats();
  const recentTasks = getRecentTasks();

  if (!currentUser) {
    return <div>Please sign in to view your dashboard.</div>;
  }

  return (
    <Container fluid className="p-4">
      {/* Welcome Section */}
      <div className="md-card mb-4">
        <Row className="align-items-center">
          <Col>
            <h2 className="md-headline-5 mb-2">
              Welcome back, {currentUser.displayName || 'there'}!
            </h2>
            <p className="md-body-1 text-muted mb-0">
              {currentPersona === 'personal' ? 'Personal' : 'Work'} Dashboard
            </p>
          </Col>
          <Col xs="auto">
            <Badge className={`md-chip ${currentPersona}`}>
              {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)}
            </Badge>
          </Col>
        </Row>
      </div>

      <Row>
        {/* Stats Overview */}
        <Col lg={8}>
          <div className="md-card mb-4">
            <h5 className="md-headline-6 mb-3">Quick Stats</h5>
            <Row>
              <Col sm={3}>
                <div className="text-center">
                  <div className="md-headline-4 text-primary">{stats.total}</div>
                  <div className="md-caption text-muted">Total Tasks</div>
                </div>
              </Col>
              <Col sm={3}>
                <div className="text-center">
                  <div className="md-headline-4 text-warning">{stats.inProgress}</div>
                  <div className="md-caption text-muted">In Progress</div>
                </div>
              </Col>
              <Col sm={3}>
                <div className="text-center">
                  <div className="md-headline-4 text-success">{stats.completed}</div>
                  <div className="md-caption text-muted">Completed</div>
                </div>
              </Col>
              <Col sm={3}>
                <div className="text-center">
                  <div className="md-headline-4 text-info">{stats.planned}</div>
                  <div className="md-caption text-muted">Planned</div>
                </div>
              </Col>
            </Row>
          </div>

          {/* Theme Progress */}
          <div className="md-card mb-4">
            <h5 className="md-headline-6 mb-3">Progress by Theme</h5>
            {themeStats.map(({ theme, completed, total, progress }) => (
              <div key={theme} className="mb-3">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <div className="d-flex align-items-center gap-2">
                    <Badge className={`md-chip ${getThemeClass(theme)}`}>{theme}</Badge>
                    <span className="md-body-2">{completed} / {total} tasks</span>
                  </div>
                  <span className="md-caption text-muted">{Math.round(progress)}%</span>
                </div>
                <ProgressBar now={progress} className="md-progress" />
              </div>
            ))}
          </div>

          {/* Goals Progress (Personal only) */}
          {currentPersona === 'personal' && goals.length > 0 && (
            <div className="md-card mb-4">
              <h5 className="md-headline-6 mb-3">Goal Progress</h5>
              {goals.slice(0, 3).map(goal => {
                const progress = getGoalProgress(goal.id);
                return (
                  <div key={goal.id} className="mb-3">
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <h6 className="md-subtitle-2 mb-1">{goal.title}</h6>
                        <Badge className={`md-chip ${getThemeClass(goal.theme)}`}>
                          {goal.theme}
                        </Badge>
                      </div>
                      <span className="md-caption text-muted">{Math.round(progress)}%</span>
                    </div>
                    <ProgressBar now={progress} className="md-progress" />
                  </div>
                );
              })}
            </div>
          )}
        </Col>

        {/* Recent Tasks */}
        <Col lg={4}>
          <div className="md-card">
            <h5 className="md-headline-6 mb-3">Priority Tasks</h5>
            {recentTasks.length === 0 ? (
              <div className="md-empty-state">
                <div className="md-empty-state-icon">+</div>
                <p className="md-body-2">No tasks yet</p>
                <p className="md-caption">Click the + button to add your first task</p>
              </div>
            ) : (
              <div className="md-list">
                {recentTasks.map(task => (
                  <div key={task.id} className="md-list-item">
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between align-items-start mb-1">
                        <h6 className="md-subtitle-2 mb-0">{task.title}</h6>
                        <Badge 
                          bg={isPriority(task.priority, 'high') ? 'orange' : isPriority(task.priority, 'med') ? 'warning' : 'secondary'}
                          className="ms-2"
                        >
                          {task.priority}
                        </Badge>
                      </div>
                      <div className="d-flex gap-2 align-items-center">
                        {task.theme && (
                          <Badge className={`md-chip ${getThemeClass(task.theme)}`}>
                            {task.theme}
                          </Badge>
                        )}
                        <span className="md-caption text-muted">
                          {task.effort} • {task.estimateMin}min
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          {(goals.length === 0 && tasks.length === 0) && (
            <div className="md-card mt-4">
              <h5 className="md-headline-6 mb-3">Get Started</h5>
              <p className="md-body-2 mb-3">
                Welcome to BOB! Start by adding your first goal or importing a template.
              </p>
              <div className="d-grid gap-2">
                <button 
                  className="md-action-btn primary"
                  onClick={() => setShowImportModal(true)}
                >
                  Browse Templates
                </button>
              </div>
            </div>
          )}
        </Col>
      </Row>

      {/* Floating Action Button */}
      <FloatingActionButton onImportClick={() => setShowImportModal(true)} />

      {/* Import Modal */}
      <ImportExportModal 
        show={showImportModal} 
        onHide={() => setShowImportModal(false)} 
      />
    </Container>
  );
};

export default Dashboard;

export {};
