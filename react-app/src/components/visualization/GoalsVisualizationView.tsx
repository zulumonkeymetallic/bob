import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Badge, Button } from 'react-bootstrap';
import { Calendar, Target, TrendingUp, ChevronDown, ChevronRight, Plus, Settings, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { Goal, Sprint, Story, Task } from '../../types';
import { getThemeName, getStatusName } from '../../utils/statusHelpers';
import EditGoalModal from '../EditGoalModal';

interface GoalsVisualizationViewProps {
  goals?: Goal[];
  onEditGoal?: (goal: Goal) => void;
  onDeleteGoal?: (goalId: string) => void;
}

const GoalsVisualizationView: React.FC<GoalsVisualizationViewProps> = ({
  goals: propGoals = [],
  onEditGoal,
  onDeleteGoal
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  const [goals, setGoals] = useState<Goal[]>(propGoals);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  
  // UI state
  const [showSidebar, setShowSidebar] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [collapsedGoals, setCollapsedGoals] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (currentUser && currentPersona) {
      loadData();
    }
  }, [currentUser, currentPersona]);

  const loadData = async () => {
    if (!currentUser || !currentPersona) return;

    setLoading(true);
    setError(null);
    
    try {
      console.log('🎯 [GoalsVisualizationView] Loading data for persona:', currentPersona);
      
      // Load goals if not provided via props
      if (propGoals.length === 0) {
        const goalsQuery = query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', currentPersona),
          orderBy('createdAt', 'desc')
        );
        const goalsSnapshot = await getDocs(goalsQuery);
        const goalsData = goalsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Goal[];
        setGoals(goalsData);
        console.log('📊 [GoalsVisualizationView] Loaded goals:', goalsData.length);
      } else {
        setGoals(propGoals);
      }

      // Load sprints
      const sprintsQuery = query(
        collection(db, 'sprints'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('startDate', 'asc')
      );
      const sprintsSnapshot = await getDocs(sprintsQuery);
      const sprintsData = sprintsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      setSprints(sprintsData);

      // Load stories
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );
      const storiesSnapshot = await getDocs(storiesQuery);
      const storiesData = storiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storiesData);

      // Load tasks
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );
      const tasksSnapshot = await getDocs(tasksQuery);
      const tasksData = tasksSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(tasksData);

      console.log('✅ [GoalsVisualizationView] Data loaded successfully');
      
    } catch (error) {
      console.error('❌ [GoalsVisualizationView] Error loading data:', error);
      setError('Failed to load visualization data');
    } finally {
      setLoading(false);
    }
  };

  const handleGoalEdit = (goal: Goal) => {
    console.log('✏️ [GoalsVisualizationView] Edit goal clicked:', goal.id);
    setSelectedGoal(goal);
    setShowEditModal(true);
  };

  const handleGoalDelete = (goalId: string) => {
    console.log('🗑️ [GoalsVisualizationView] Delete goal clicked:', goalId);
    if (onDeleteGoal) {
      onDeleteGoal(goalId);
    }
  };

  const handleGoalUpdate = (goalId: string, updates: Partial<Goal>) => {
    console.log('🔄 [GoalsVisualizationView] Goal updated:', goalId, updates);
    setGoals(prev => prev.map(goal => 
      goal.id === goalId ? { ...goal, ...updates } : goal
    ));
    setShowEditModal(false);
    setSelectedGoal(null);
  };

  const toggleGoalCollapse = (goalId: string) => {
    console.log('🔽 [GoalsVisualizationView] Toggle goal collapse:', goalId);
    const newCollapsed = new Set(collapsedGoals);
    if (newCollapsed.has(goalId)) {
      newCollapsed.delete(goalId);
    } else {
      newCollapsed.add(goalId);
    }
    setCollapsedGoals(newCollapsed);
  };

  const getGoalProgress = (goal: Goal) => {
    const goalStories = stories.filter(story => story.goalId === goal.id);
    const goalTasks = tasks.filter(task => task.goalId === goal.id);
    
    const completedStories = goalStories.filter(story => story.status === 4).length; // 4 = Done
    const completedTasks = goalTasks.filter(task => task.status === 2).length; // 2 = Complete
    
    const totalItems = goalStories.length + goalTasks.length;
    const completedItems = completedStories + completedTasks;
    
    return totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  };

  const getStatusBadgeVariant = (status: number) => {
    switch (status) {
      case 2: return 'success'; // Complete
      case 1: return 'primary'; // Work in Progress
      case 3: return 'warning'; // Blocked
      case 4: return 'secondary'; // Deferred
      default: return 'light'; // New
    }
  };

  const getPriorityBorder = (size: number) => {
    switch (size) {
      case 3: return 'border-danger'; // Large
      case 2: return 'border-warning'; // Medium
      case 1: return 'border-success'; // Small
      default: return 'border-secondary';
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="d-flex justify-content-center align-items-center" style={{ height: '300px' }}>
          <div className="text-center">
            <div className="spinner-border text-primary mb-3" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <div>Loading goals visualization...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="alert alert-danger">
          <h5 className="alert-heading">Error Loading Visualization</h5>
          <p className="mb-3">{error}</p>
          <Button variant="outline-danger" size="sm" onClick={loadData}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-100 d-flex flex-column">
      {/* Header */}
      <div className="border-bottom bg-white p-3 flex-shrink-0">
        <Row className="align-items-center">
          <Col>
            <div className="d-flex align-items-center">
              <Target className="me-2 text-primary" size={24} />
              <h2 className="mb-0">Goals Roadmap</h2>
            </div>
          </Col>
          <Col xs="auto">
            <div className="d-flex align-items-center gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setShowSidebar(!showSidebar)}
              >
                <Settings size={16} />
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.1))}
              >
                <ZoomOut size={16} />
              </Button>
              <span className="text-muted small">{Math.round(zoomLevel * 100)}%</span>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setZoomLevel(Math.min(2, zoomLevel + 0.1))}
              >
                <ZoomIn size={16} />
              </Button>
            </div>
          </Col>
        </Row>
      </div>

      <div className="flex-fill d-flex overflow-hidden">
        {/* Sidebar */}
        {showSidebar && (
          <div className="border-end bg-light p-3" style={{ width: '300px', overflowY: 'auto' }}>
            <div className="mb-3">
              <label className="form-label small text-muted fw-bold">
                Search Goals
              </label>
              <div className="position-relative">
                <Search className="position-absolute top-50 start-0 translate-middle-y ms-2 text-muted" size={16} />
                <input
                  type="text"
                  className="form-control ps-4"
                  placeholder="Search goals..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label small text-muted fw-bold">
                Quick Stats
              </label>
              <div className="small">
                <div className="d-flex justify-content-between">
                  <span>Total Goals:</span>
                  <span className="fw-bold">{goals.length}</span>
                </div>
                <div className="d-flex justify-content-between">
                  <span>Active Sprints:</span>
                  <span className="fw-bold">
                    {sprints.filter(s => s.status === 1).length}
                  </span>
                </div>
                <div className="d-flex justify-content-between">
                  <span>Total Stories:</span>
                  <span className="fw-bold">{stories.length}</span>
                </div>
                <div className="d-flex justify-content-between">
                  <span>Total Tasks:</span>
                  <span className="fw-bold">{tasks.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-fill overflow-auto p-3" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}>
          {goals.length === 0 ? (
            <div className="text-center py-5">
              <Target className="text-muted mb-3" size={48} />
              <h4 className="text-muted">No Goals Found</h4>
              <p className="text-muted mb-4">Get started by creating your first goal</p>
              <Button variant="primary">
                <Plus size={16} className="me-1" />
                Create Goal
              </Button>
            </div>
          ) : (
            <Row className="g-3">
              {goals
                .filter(goal => 
                  searchQuery === '' || 
                  goal.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  goal.description?.toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((goal) => {
                  const progress = getGoalProgress(goal);
                  const isCollapsed = collapsedGoals.has(goal.id);
                  const goalStories = stories.filter(story => story.goalId === goal.id);
                  const goalTasks = tasks.filter(task => task.goalId === goal.id);

                  return (
                    <Col xs={12} key={goal.id}>
                      <Card className={`h-100 ${getPriorityBorder(goal.size)} border-2 shadow-sm`}>
                        <Card.Header className="d-flex justify-content-between align-items-start">
                          <div className="d-flex align-items-center flex-fill">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleGoalCollapse(goal.id)}
                              className="p-1 me-2"
                            >
                              {isCollapsed ? (
                                <ChevronRight size={16} />
                              ) : (
                                <ChevronDown size={16} />
                              )}
                            </Button>
                            <div className="flex-fill">
                              <h5 className="card-title mb-1">{goal.title}</h5>
                              <div className="d-flex align-items-center gap-2 mb-0">
                                <Badge bg={getStatusBadgeVariant(goal.status)}>
                                  {getStatusName(goal.status)}
                                </Badge>
                                <small className="text-muted">
                                  {Math.round(progress)}% Complete
                                </small>
                                <small className="text-muted">
                                  {goalStories.length} stories, {goalTasks.length} tasks
                                </small>
                              </div>
                            </div>
                          </div>
                          <div className="d-flex gap-1">
                            <Button
                              variant="outline-primary"
                              size="sm"
                              onClick={() => handleGoalEdit(goal)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleGoalDelete(goal.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </Card.Header>
                        
                        {!isCollapsed && (
                          <Card.Body>
                            {goal.description && (
                              <p className="text-muted mb-3">{goal.description}</p>
                            )}
                            
                            {/* Progress Bar */}
                            <div className="mb-3">
                              <div className="d-flex justify-content-between small text-muted mb-1">
                                <span>Progress</span>
                                <span>{Math.round(progress)}%</span>
                              </div>
                              <div className="progress" style={{ height: '6px' }}>
                                <div
                                  className="progress-bar"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>

                            {/* Goal Details */}
                            <Row className="small text-muted">
                              <Col md={3}>
                                <strong>Theme:</strong><br />
                                {getThemeName(goal.theme)}
                              </Col>
                              <Col md={3}>
                                <strong>Size:</strong><br />
                                {goal.size === 1 ? 'Small' : goal.size === 2 ? 'Medium' : 'Large'}
                              </Col>
                              <Col md={3}>
                                <strong>Confidence:</strong><br />
                                {goal.confidence === 1 ? 'Low' : goal.confidence === 2 ? 'Medium' : 'High'}
                              </Col>
                              <Col md={3}>
                                <strong>Created:</strong><br />
                                {new Date(goal.createdAt.seconds * 1000).toLocaleDateString()}
                              </Col>
                            </Row>
                          </Card.Body>
                        )}
                      </Card>
                    </Col>
                  );
                })}
            </Row>
          )}
        </div>
      </div>

      {/* Edit Goal Modal */}
      {selectedGoal && (
        <EditGoalModal
          show={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedGoal(null);
          }}
          goal={selectedGoal}
          currentUserId={currentUser?.uid || ''}
        />
      )}
    </div>
  );
};

export default GoalsVisualizationView;
