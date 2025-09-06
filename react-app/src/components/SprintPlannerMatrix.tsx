import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Button, Row, Col, Badge } from 'react-bootstrap';
import { 
import { useTheme } from '../contexts/ModernThemeContext';
  ChevronDown, 
  ChevronRight, 
  Calendar,
  Layers,
  Bullseye,
  Flag
} from 'react-bootstrap-icons';

import { Goal, Sprint, Story, Task } from '../types';
import { EnhancedStory, SubGoal } from '../types/v3.0.8-types';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useThemeColors, getThemeColorById } from '../hooks/useThemeColor';
import { getThemeName } from '../utils/statusHelpers';
import StoryCard from './StoryCard';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface PlannerRowExpansion {
  [themeId: string]: {
    [goalId: string]: boolean;
  };
}

interface SprintPlannerMatrixProps {
  userId?: string;
  currentPersona?: string;
}

const SprintPlannerMatrix: React.FC<SprintPlannerMatrixProps> = ({
  userId,
  currentPersona
}) => {
  // Data state
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [subGoals, setSubGoals] = useState<SubGoal[]>([]);
  const [stories, setStories] = useState<EnhancedStory[]>([]);
  
  // UI state
  const [rowExpansion, setRowExpansion] = useState<PlannerRowExpansion>({});
  const [loading, setLoading] = useState(true);

  // Auth and persona context
  const { currentUser } = useAuth();
  const { currentPersona: contextPersona } = usePersona();
  
  // Use the passed persona or context persona
  const activePersona = currentPersona || contextPersona;

  // Theme system
  const { themes } = useThemeColors();

  // Load data - using real Firebase data
  useEffect(() => {
    if (!currentUser) return;

    const unsubscribes: (() => void)[] = [];

    // Load sprints
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'asc')
    );
    
    const sprintsUnsub = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      setSprints(sprintsData);
      console.log('SprintPlannerMatrix: Loaded', sprintsData.length, 'sprints');
    });
    unsubscribes.push(sprintsUnsub);

    // Load goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', activePersona)
    );
    
    const goalsUnsub = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
      console.log('SprintPlannerMatrix: Loaded', goalsData.length, 'goals');
    });
    unsubscribes.push(goalsUnsub);

    // Load stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', activePersona)
    );
    
    const storiesUnsub = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        rank: doc.data().rank || 0,
        rankByLane: doc.data().rankByLane || {},
        rankByCell: doc.data().rankByCell || {},
        dragLockVersion: doc.data().dragLockVersion || 0
      })) as EnhancedStory[];
      setStories(storiesData);
      console.log('SprintPlannerMatrix: Loaded', storiesData.length, 'stories');
    });
    unsubscribes.push(storiesUnsub);

    // TODO: Load sub-goals when that collection is implemented
    setSubGoals([]);

    // Load UI state from localStorage
    if (activePersona) {
      const savedExpansion = localStorage.getItem(`plannerRowExpansion_${activePersona}`);
      if (savedExpansion) {
        setRowExpansion(JSON.parse(savedExpansion));
      }
    }
    
    setLoading(false);

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [currentUser, activePersona]);

  // Save expansion state
  const saveExpansionState = useCallback((newExpansion: PlannerRowExpansion) => {
    setRowExpansion(newExpansion);
    localStorage.setItem(`plannerRowExpansion_${activePersona}`, JSON.stringify(newExpansion));
  }, [activePersona]);

  // Toggle theme expansion
  const toggleThemeExpansion = useCallback((themeId: string, goalId: string) => {
    const newExpansion = { ...rowExpansion };
    if (!newExpansion[themeId]) {
      newExpansion[themeId] = {};
    }
    newExpansion[themeId][goalId] = !newExpansion[themeId][goalId];
    saveExpansionState(newExpansion);
  }, [rowExpansion, saveExpansionState]);

  // Get stories for specific cell
  const getStoriesForCell = useCallback((sprintId: string, goalId: string, subGoalId?: string): EnhancedStory[] => {
    return stories
      .filter(story => {
        const matchesSprint = story.sprintId === sprintId;
        const matchesGoal = story.goalId === goalId;
        const matchesSubGoal = subGoalId ? story.subGoalId === subGoalId : !story.subGoalId;
        return matchesSprint && matchesGoal && matchesSubGoal;
      })
      .sort((a, b) => {
        const cellKey = `${sprintId}/${goalId}/${subGoalId || ''}`;
        const rankA = a.rankByCell?.[cellKey] || a.rank || 0;
        const rankB = b.rankByCell?.[cellKey] || b.rank || 0;
        return rankA - rankB;
      });
  }, [stories]);

  // Group goals by theme
  const goalsByTheme = useMemo(() => {
    const grouped: Record<string, Goal[]> = {};
    
    goals.forEach(goal => {
      const themeId = goal.theme || 'Health'; // Use existing theme field
      if (!grouped[themeId]) {
        grouped[themeId] = [];
      }
      grouped[themeId].push(goal);
    });

    return grouped;
  }, [goals]);

  // Group subgoals by goal
  const subGoalsByGoal = useMemo(() => {
    const grouped: Record<string, SubGoal[]> = {};
    
    subGoals.forEach(subGoal => {
      const goalId = subGoal.goalId;
      if (!grouped[goalId]) {
        grouped[goalId] = [];
      }
      grouped[goalId].push(subGoal);
    });

    return grouped;
  }, [subGoals]);

  // Render matrix cell component
  const MatrixCell: React.FC<{
    sprintId: string;
    goalId: string;
    subGoalId?: string;
  }> = React.memo(({ sprintId, goalId, subGoalId }) => {
    const cellStories = getStoriesForCell(sprintId, goalId, subGoalId);

    return (
      <Card 
        className="matrix-cell h-100"
        style={{ 
          minHeight: '120px',
          border: '1px solid #e0e0e0',
          backgroundColor: cellStories.length > 0 ? '#f8f9fa' : '#ffffff'
        }}
        data-testid={`planner-cell-${sprintId}-${goalId}-${subGoalId || 'root'}`}
      >
        <Card.Body className="p-2">
          <div style={{ minHeight: '80px' }}>
            {cellStories.map((story, index) => (
              <div key={story.id} className="mb-1">
                <StoryCard
                  story={story}
                  index={index}
                />
              </div>
            ))}
          </div>
          
          {cellStories.length === 0 && (
            <div className="text-muted text-center py-3" style={{ fontSize: '0.8em' }}>
              Drop stories here
            </div>
          )}
        </Card.Body>
      </Card>
    );
  });

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '400px' }}>
        <div className="spinner-border" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sprint-planner-matrix">
      {/* Header */}
      <Row className="mb-3">
        <Col>
          <h4 className="d-flex align-items-center gap-2">
            <Calendar size={20} />
            Sprint Planner Matrix
            <Badge bg="secondary">{stories.length} stories</Badge>
          </h4>
          <p className="text-muted mb-0">
            2-D view: Themes → Goals → SubGoals (rows) × Sprints (columns)
          </p>
        </Col>
      </Row>

      {sprints.length === 0 ? (
        <div className="text-center py-5">
          <h5 className="text-muted">No sprints found</h5>
          <p className="text-muted">Create some sprints to see the matrix view.</p>
        </div>
      ) : (
        <>
          {/* Sprint columns header */}
          <div className="matrix-header mb-3">
            <Row>
              <Col xs={3} className="fw-bold">
                Themes → Goals → SubGoals
              </Col>
              {sprints.map(sprint => (
                <Col key={sprint.id} className="text-center">
                  <Card className="sprint-header">
                    <Card.Body className="p-2">
                      <div className="fw-bold">{sprint.name}</div>
                      <small className="text-muted">
                        {sprint.startDate ? new Date(sprint.startDate).toLocaleDateString() : 'No date'}
                      </small>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>

          {/* Matrix body */}
          <div className="matrix-body">
            {Object.entries(goalsByTheme).length === 0 ? (
              <div className="text-center py-4">
                <p className="text-muted">No goals found for the current persona. Create some goals to populate the matrix.</p>
              </div>
            ) : (
              Object.entries(goalsByTheme).map(([themeId, themeGoals]) => {
                const themeColor = getThemeColorById(themeId, themes);

                return (
                  <div key={themeId} className="theme-section mb-4">
                    {/* Theme header */}
                    <div 
                      className="theme-header p-2 mb-2 rounded"
                      style={{ 
                        backgroundColor: `${themeColor.primary}20`,
                        borderLeft: `4px solid ${themeColor.primary}`
                      }}
                    >
                      <h6 className="mb-0 d-flex align-items-center gap-2">
                        <Layers size={16} />
                        {themeId}
                        <Badge bg="light" text="dark">{themeGoals.length} goals</Badge>
                      </h6>
                    </div>

                    {/* Goals */}
                    {themeGoals.map(goal => {
                      const goalSubGoals = subGoalsByGoal[goal.id] || [];
                      const isExpanded = rowExpansion[themeId]?.[goal.id] || false;
                      const goalColor = getThemeColorById(getThemeName(goal.theme) || 'Health', themes);

                      return (
                        <div key={goal.id} className="goal-section mb-3">
                          {/* Goal row */}
                          <Row className="goal-row mb-2">
                            <Col xs={3} className="goal-label">
                              <div className="d-flex align-items-center gap-2">
                                {goalSubGoals.length > 0 && (
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="p-0"
                                    onClick={() => toggleThemeExpansion(themeId, goal.id)}
                                  >
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  </Button>
                                )}
                                <Bullseye size={16} style={{ color: goalColor.primary }} />
                                <span className="fw-medium">{goal.title}</span>
                                {goalSubGoals.length > 0 && (
                                  <Badge bg="light" text="dark">{goalSubGoals.length}</Badge>
                                )}
                              </div>
                            </Col>
                            {sprints.map(sprint => (
                              <Col key={`${goal.id}-${sprint.id}`}>
                                <MatrixCell
                                  sprintId={sprint.id}
                                  goalId={goal.id}
                                />
                              </Col>
                            ))}
                          </Row>

                          {/* SubGoal rows (if expanded) */}
                          {isExpanded && goalSubGoals.map(subGoal => (
                            <Row key={subGoal.id} className="subgoal-row mb-2 ms-4">
                              <Col xs={3} className="subgoal-label">
                                <div className="d-flex align-items-center gap-2">
                                  <Flag size={14} style={{ color: goalColor.primary }} />
                                  <span className="text-muted">{subGoal.title}</span>
                                </div>
                              </Col>
                              {sprints.map(sprint => (
                                <Col key={`${subGoal.id}-${sprint.id}`}>
                                  <MatrixCell
                                    sprintId={sprint.id}
                                    goalId={goal.id}
                                    subGoalId={subGoal.id}
                                  />
                                </Col>
                              ))}
                            </Row>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Instructions */}
      <div className="mt-4 p-3 bg-light rounded">
        <h6>📋 Sprint Planner Matrix (v3.0.8 - Real Data)</h6>
        <small className="text-muted">
          This is the 2-D Sprint Planner Matrix from the v3.0.8 specification. 
          Stories are organized by Theme → Goal → SubGoal hierarchy (rows) and Sprint timeline (columns).
          <br />
          <strong>Status:</strong> Using live Firebase data with real-time updates
          <br />
          <strong>Features:</strong> Reference numbers (STRY-###), theme colors, priority display, data persistence
          <br />
          <strong>Next iterations:</strong> Drag & drop functionality, SubGoal management, enhanced cell interactions
        </small>
      </div>
    </div>
  );
};

export default SprintPlannerMatrix;
