import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Badge, ProgressBar, Dropdown } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Task, Goal, Story } from '../types';
import FloatingActionButton from './FloatingActionButton';
import ImportExportModal from './ImportExportModal';
import DevTools from './DevTools';
import { ChoiceMigration } from '../config/migration';
import PriorityPane from './PriorityPane';
import AddGoalModal from './AddGoalModal';
import AddStoryModal from './AddStoryModal';
import { GLOBAL_THEMES } from '../constants/globalThemes';
// import { VERSION, BUILD_TIME } from '../version';
import '../styles/MaterialDesign.css';
import { isStatus, isTheme } from '../utils/statusHelpers';

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [showAddStory, setShowAddStory] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Handle dropdown item clicks to ensure dropdown closes
  const handleDropdownItemClick = (action: () => void) => {
    action();
    setDropdownOpen(false);
  };

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
        where('ownerUid', '==', currentUser.uid)
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
        where('ownerUid', '==', currentUser.uid)
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

  const getStoryStats = () => {
    const total = stories.length;
    const active = stories.filter(s => isStatus(s.status, 'active')).length;
    const completed = stories.filter(s => isStatus(s.status, 'done')).length;
    const backlog = stories.filter(s => isStatus(s.status, 'backlog')).length;
    
    return { total, active, completed, backlog };
  };

  const getSprintStats = () => {
    const currentSprint = 'current'; // This could be dynamic
    const sprintTasks = tasks.filter(t => t.storyId); // Tasks linked to stories
    const sprintStories = stories.filter(s => s.sprintId === currentSprint);
    const activeGoals = goals.filter(g => isStatus(g.status, 'Work in Progress'));
    
    return {
      goals: activeGoals.length,
      stories: sprintStories.length,
      tasks: sprintTasks.length,
      totalItems: activeGoals.length + sprintStories.length + sprintTasks.length
    };
  };

  const getOverallProgress = () => {
    const allItems = [...goals, ...stories, ...tasks];
    const completedItems = allItems.filter(item => isStatus(item.status, 'done'));
    const totalItems = allItems.length;
    
    return totalItems > 0 ? Math.round((completedItems.length / totalItems) * 100) : 0;
  };

  const getThemeStats = () => {
    const themes = GLOBAL_THEMES.map(theme => theme.name);
    return themes.map(theme => {
      const themeTasks = tasks.filter(t => isTheme(t.theme, theme));
      const themeGoals = goals.filter(g => isTheme(g.theme, theme));
      const themeStories = stories.filter(s => {
        // Stories get theme from their associated goal
        const associatedGoal = goals.find(g => g.id === s.goalId);
        return associatedGoal && isTheme(associatedGoal.theme, theme);
      });
      
      const allThemeItems = [...themeTasks, ...themeStories, ...themeGoals];
      const completed = allThemeItems.filter(item => isStatus(item.status, 'done')).length;
      const total = allThemeItems.length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      
      return { theme, completed, total, progress, tasks: themeTasks.length, stories: themeStories.length, goals: themeGoals.length };
    });
  };

  const getGoalProgress = (goalId: string) => {
    const goalStories = stories.filter(s => s.goalId === goalId);
    const completedStories = goalStories.filter(s => isStatus(s.status, 'done')).length;
    const totalStories = goalStories.length;
    
    return totalStories > 0 ? (completedStories / totalStories) * 100 : 0;
  };

  const stats = getTaskStats();
  const storyStats = getStoryStats();
  const sprintStats = getSprintStats();
  const overallProgress = getOverallProgress();
  const themeStats = getThemeStats();

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
            <div className="d-flex gap-2 align-items-center">
              <Badge className={`md-chip ${currentPersona}`}>
                {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)}
              </Badge>
              <Dropdown 
                show={dropdownOpen} 
                onToggle={(isOpen) => setDropdownOpen(isOpen)}
              >
                <Dropdown.Toggle 
                  variant="primary" 
                  id="quick-add-dropdown"
                  className="btn btn-primary"
                >
                  + Add New
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  {currentPersona === 'personal' && (
                    <Dropdown.Item onClick={() => handleDropdownItemClick(() => setShowAddGoal(true))}>
                      Add Goal
                    </Dropdown.Item>
                  )}
                  <Dropdown.Item onClick={() => handleDropdownItemClick(() => setShowAddStory(true))}>
                    Add Story
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => handleDropdownItemClick(() => setShowImportModal(true))}>
                    Import from Templates
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </div>
          </Col>
        </Row>
      </div>

      {/* Overall Progress Ring */}
      <Row className="mb-4">
        <Col xs={12}>
          <div className="md-card text-center">
            <Row className="align-items-center">
              <Col md={3}>
                <div className="progress-ring mx-auto" style={{ '--progress': `${overallProgress}` } as React.CSSProperties}>
                  <div className="progress-ring-text">{overallProgress}%</div>
                </div>
                <h6 className="mt-2 mb-0">Overall Progress</h6>
                <small className="text-muted">{goals.length + stories.length + tasks.length} total items</small>
              </Col>
              <Col md={9}>
                <Row>
                  <Col md={4}>
                    <div className="text-center">
                      <div className="md-headline-4 text-success">{goals.length}</div>
                      <div className="md-caption text-muted">Goals</div>
                      <small className="text-muted">{goals.filter(g => isStatus(g.status, 'Complete')).length} completed</small>
                    </div>
                  </Col>
                  <Col md={4}>
                    <div className="text-center">
                      <div className="md-headline-4 text-info">{stories.length}</div>
                      <div className="md-caption text-muted">Stories</div>
                      <small className="text-muted">{storyStats.completed} completed</small>
                    </div>
                  </Col>
                  <Col md={4}>
                    <div className="text-center">
                      <div className="md-headline-4 text-warning">{tasks.length}</div>
                      <div className="md-caption text-muted">Tasks</div>
                      <small className="text-muted">{stats.completed} completed</small>
                    </div>
                  </Col>
                </Row>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      <Row>
        {/* Current Sprint Stats */}
        <Col lg={4}>
          <div className="md-card mb-4">
            <h5 className="md-headline-6 mb-3">Current Sprint</h5>
            <Row>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-primary">{sprintStats.goals}</div>
                  <div className="md-caption text-muted">Goals</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-info">{sprintStats.stories}</div>
                  <div className="md-caption text-muted">Stories</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-warning">{sprintStats.tasks}</div>
                  <div className="md-caption text-muted">Tasks</div>
                </div>
              </Col>
            </Row>
          </div>
        </Col>

        {/* Task Status Breakdown */}
        <Col lg={4}>
          <div className="md-card mb-4">
            <h5 className="md-headline-6 mb-3">Task Status</h5>
            <Row>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-info">{stats.planned}</div>
                  <div className="md-caption text-muted">Planned</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-warning">{stats.inProgress}</div>
                  <div className="md-caption text-muted">In Progress</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-success">{stats.completed}</div>
                  <div className="md-caption text-muted">Done</div>
                </div>
              </Col>
            </Row>
          </div>
        </Col>

        {/* Story Status Breakdown */}
        <Col lg={4}>
          <div className="md-card mb-4">
            <h5 className="md-headline-6 mb-3">Story Status</h5>
            <Row>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-secondary">{storyStats.backlog}</div>
                  <div className="md-caption text-muted">Backlog</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-primary">{storyStats.active}</div>
                  <div className="md-caption text-muted">Active</div>
                </div>
              </Col>
              <Col xs={4}>
                <div className="text-center">
                  <div className="md-headline-5 text-success">{storyStats.completed}</div>
                  <div className="md-caption text-muted">Done</div>
                </div>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      <Row>
        {/* Detailed Theme Progress */}
        <Col lg={8}>
          <div className="md-card mb-4">
            <h5 className="md-headline-6 mb-3">Progress by Theme</h5>
            {themeStats.map(({ theme, completed, total, progress, goals, stories, tasks }) => (
              <div key={theme} className={`theme-card theme-${theme.toLowerCase()} mb-3 p-3 border rounded`}>
                <Row className="align-items-center">
                  <Col md={3}>
                    <h6 className="mb-1">{theme}</h6>
                    <small className="text-muted">{completed}/{total} completed</small>
                  </Col>
                  <Col md={6}>
                    <ProgressBar 
                      now={progress} 
                      label={`${progress}%`}
                      className="mb-1"
                      style={{ height: '8px' }}
                    />
                  </Col>
                  <Col md={3}>
                    <div className="d-flex justify-content-around">
                      <small><strong>{goals}</strong> Goals</small>
                      <small><strong>{stories}</strong> Stories</small>
                      <small><strong>{tasks}</strong> Tasks</small>
                    </div>
                  </Col>
                </Row>
              </div>
            ))}
          </div>
        </Col>

        {/* Today's Top 5 Priority Tasks */}
        <Col lg={4}>
          <div className="md-card mb-4">
            <h5 className="md-headline-6 mb-3">Today's Top 5 Priority Tasks</h5>
            {tasks.slice(0, 5).length > 0 ? (
              tasks.slice(0, 5).map(task => (
                <div key={task.id} className="d-flex justify-content-between align-items-center mb-2 p-2 border-bottom">
                  <span className="md-body-2">{task.title}</span>
                  <Badge className={`md-chip ${task.priority}`}>{task.priority}</Badge>
                </div>
              ))
            ) : (
              <div className="text-center text-muted py-4">
                <p>No active tasks to prioritize.</p>
                <p className="small">Create some tasks to see your priority list!</p>
              </div>
            )}
          </div>
        </Col>
      </Row>

      {/* Modals */}
      <AddGoalModal 
        show={showAddGoal} 
        onClose={() => setShowAddGoal(false)} 
      />
      
      <AddStoryModal 
        show={showAddStory} 
        onClose={() => setShowAddStory(false)} 
      />
      
      <ImportExportModal 
        show={showImportModal} 
        onHide={() => setShowImportModal(false)} 
      />

      {/* Floating Action Button */}
      <FloatingActionButton 
        onImportClick={() => setShowImportModal(true)}
      />

      {/* DevTools Modal */}
      <DevTools 
        show={showDevTools} 
        onHide={() => setShowDevTools(false)} 
      />
    </Container>
  );
};

export default Dashboard;

export {};
