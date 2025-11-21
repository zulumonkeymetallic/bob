import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Button, Row, Col, Badge, Container } from 'react-bootstrap';
import {
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
import { collection, query, where, orderBy, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useSprint } from '../contexts/SprintContext';
import SortableStoryCard from './stories/SortableStoryCard';
import SprintSelector from './SprintSelector';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  UniqueIdentifier,
  useDroppable
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

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
  const { sprints, selectedSprintId, setSelectedSprintId } = useSprint();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [subGoals, setSubGoals] = useState<SubGoal[]>([]);
  const [stories, setStories] = useState<EnhancedStory[]>([]);
  const [capacityBySprint, setCapacityBySprint] = useState<Record<string, number>>({});

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getCellId = useCallback((sprintId: string, goalId: string, subGoalId?: string) => {
    return `cell::${sprintId || 'backlog'}::${goalId || 'none'}::${subGoalId || ''}`;
  }, []);

  const parseCellId = useCallback((value: UniqueIdentifier) => {
    if (typeof value !== 'string') return null;
    if (!value.startsWith('cell::')) return null;
    const [, sprintPart = 'backlog', goalPart = 'none', subGoalPart = ''] = value.split('::');
    return {
      sprintId: sprintPart === 'backlog' ? null : sprintPart,
      goalId: goalPart === 'none' ? '' : goalPart,
      subGoalId: subGoalPart || undefined,
    };
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeStory = stories.find((story) => story.id === active.id);
      if (!activeStory) return;

      let target = parseCellId(over.id);
      if (!target) {
        const overStory = stories.find((story) => story.id === over.id);
        if (overStory) {
          target = {
            sprintId: overStory.sprintId ?? null,
            goalId: overStory.goalId,
            subGoalId: (overStory as any).subGoalId ?? undefined,
          };
        }
      }

      if (!target) return;

      const { sprintId, goalId, subGoalId } = target;
      const normalizedGoalId = goalId || activeStory.goalId || '';
      const normalizedSubGoalId = subGoalId ?? (activeStory as any).subGoalId ?? null;
      const currentSprintId = activeStory.sprintId ?? null;
      const currentGoalId = activeStory.goalId ?? '';
      const currentSubGoalId = (activeStory as any).subGoalId ?? null;

      if (
        currentSprintId === (sprintId ?? null) &&
        currentGoalId === normalizedGoalId &&
        currentSubGoalId === normalizedSubGoalId
      ) {
        return;
      }

      try {
        await updateDoc(doc(db, 'stories', activeStory.id), {
          sprintId: sprintId ?? null,
          goalId: normalizedGoalId,
          subGoalId: normalizedSubGoalId || null,
          updatedAt: serverTimestamp(),
        } as Partial<Story>);
      } catch (error) {
        console.error('SprintPlannerMatrix: failed to update story position', error);
      }
    },
    [stories, parseCellId]
  );

  // Load data - using real Firebase data
  useEffect(() => {
    if (!currentUser) return;

    const unsubscribes: (() => void)[] = [];

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

  useEffect(() => {
    const capacityMap: Record<string, number> = {};
    sprints.forEach((sprint) => {
      capacityMap[sprint.id] = (sprint as any).capacityPoints || 20;
    });
    setCapacityBySprint(capacityMap);
  }, [sprints]);

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
    goal: Goal;
    themeColor: string;
    subGoal?: SubGoal;
  }> = React.memo(({ sprintId, goal, themeColor, subGoal }) => {
    const cellStories = getStoriesForCell(sprintId, goal.id, subGoal?.id);
    const droppableId = getCellId(sprintId, goal.id, subGoal?.id);
    const { setNodeRef, isOver } = useDroppable({ id: droppableId });

    return (
      <Card
        className={`matrix-cell h-100${isOver ? ' is-over' : ''}`}
        style={{
          minHeight: '120px',
          border: isOver ? '2px dashed var(--brand, #0d6efd)' : '1px solid var(--line)',
          backgroundColor: isOver ? 'rgba(13, 110, 253, 0.05)' : (cellStories.length > 0 ? 'var(--card)' : 'var(--panel)'),
          transition: 'border-color 0.15s ease, background-color 0.15s ease',
        }}
        data-testid={`planner-cell-${sprintId}-${goal.id}-${subGoal?.id || 'root'}`}
      >
        <Card.Body className="p-2">
          <div ref={setNodeRef}>
            <SortableContext
              items={cellStories.map((story) => story.id)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ minHeight: '80px' }}>
                {cellStories.map((story) => {
                  const taskCount = Array.isArray((story as any).tasks)
                    ? (story as any).tasks.length
                    : Number((story as any).taskCount ?? 0);

                  return (
                    <div key={story.id} className="mb-1">
                      <SortableStoryCard
                        story={story as unknown as Story}
                        goal={goal}
                        taskCount={taskCount}
                        themeColor={themeColor}
                      />
                    </div>
                  );
                })}
              </div>
            </SortableContext>
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
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <Container fluid className="p-3">
        <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <Card.Body className="p-4">
            <div className="sprint-planner-matrix">
              {/* Header */}
              <Row className="mb-3 align-items-center">
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
                <Col xs="auto" className="text-end">
                  <SprintSelector className="d-inline-block" />
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
                      {sprints.map(sprint => {
                        const cap = capacityBySprint[sprint.id] || 20;
                        const total = stories.filter(st => (st as any).sprintId === sprint.id).reduce((sum, st) => sum + (st.points || 1), 0);
                        const over = total > cap;
                        const isSelected = selectedSprintId ? selectedSprintId === sprint.id : false;
                        return (
                          <Col key={sprint.id} className="text-center">
                            <Card
                              className={`sprint-header ${isSelected ? 'border-primary shadow-sm' : ''}`}
                              role="button"
                              onClick={() => setSelectedSprintId(sprint.id)}
                              style={{
                                cursor: 'pointer',
                                border: isSelected ? '2px solid var(--bs-primary)' : undefined,
                              }}
                            >
                              <Card.Body className="p-2">
                                <div className="fw-bold">{sprint.name}</div>
                                <small className="text-muted d-block mb-1">
                                  {sprint.startDate ? new Date(sprint.startDate).toLocaleDateString() : 'No date'}
                                </small>
                                <div className="d-flex justify-content-center align-items-center gap-2">
                                  <span className={`badge ${over ? 'bg-danger' : 'bg-primary'}`}>{total}/{cap} pts</span>
                                  <Button size="sm" variant="outline-secondary" onClick={async () => {
                                    const raw = prompt('Set sprint capacity (points):', String(cap));
                                    const next = raw ? parseInt(raw) : NaN;
                                    if (!Number.isFinite(next) || next <= 0) return;
                                    try {
                                      const { doc, updateDoc } = await import('firebase/firestore');
                                      const { db } = await import('../firebase');
                                      await updateDoc(doc(db, 'sprints', sprint.id), { capacityPoints: next, updatedAt: Date.now() } as any);
                                    } catch (e) { console.warn('capacity update failed', e); }
                                  }}>Cap</Button>
                                </div>
                              </Card.Body>
                            </Card>
                          </Col>
                        );
                      })}
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
                                          goal={goal}
                                          themeColor={goalColor.primary}
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
                                            goal={goal}
                                            subGoal={subGoal}
                                            themeColor={goalColor.primary}
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

              {/* Capacity overview */}
              <div className="mt-3">
                <h6>Sprint Capacity</h6>
                <div className="d-flex flex-wrap gap-2">
                  {sprints.map((s) => {
                    const cap = capacityBySprint[s.id] || 20;
                    const total = stories.filter(st => (st as any).sprintId === s.id).reduce((sum, st) => sum + (st.points || 1), 0);
                    const over = total > cap;
                    const pct = Math.min(100, Math.round((total / Math.max(1, cap)) * 100));
                    return (
                      <div key={s.id} className="border rounded px-2 py-1 small">
                        <strong>{s.name}</strong> – {total}/{cap} pts
                        <div className="progress" style={{ height: 6, width: 160 }}>
                          <div className={`progress-bar ${over ? 'bg-danger' : 'bg-success'}`} role="progressbar" style={{ width: `${pct}%` }} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Instructions */}
              <div className="mt-4 p-3 bg-light rounded">
                <h6>📋 Sprint Planner Matrix (v3.0.8 - Real Data)</h6>
                <small className="text-muted">
                  This is the 2-D Sprint Planner Matrix from the v3.0.8 specification.
                  Stories are organized by Theme → Goal → SubGoal hierarchy (rows) and Sprint timeline (columns).
                  <br />
                  <strong>Status:</strong> Using live Firebase data with real-time updates
                  <br />
                  <strong>Features:</strong> Reference numbers (STRY-###), theme colors, priority display, drag &amp; drop reassignment, data persistence
                  <br />
                  <strong>Next iterations:</strong> SubGoal management, enhanced cell interactions, matrix analytics
                </small>
              </div>
            </div>

          </Card.Body>
        </Card>
      </Container>
    </DndContext >
  );
};

export default SprintPlannerMatrix;
