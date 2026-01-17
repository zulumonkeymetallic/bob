import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Container, Row, Col, Button, Form, Badge, Dropdown, Alert } from 'react-bootstrap';
import { dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Story, Sprint, Goal } from '../types';
import { Calendar, Filter, Plus, ArrowUpDown, ArrowRight, Target, Maximize2, Minimize2, LayoutGrid } from 'lucide-react';
import KanbanCardV2 from './KanbanCardV2';
import GLOBAL_THEMES from '../constants/globalThemes';
import { themeVars } from '../utils/themeVars';
import '../styles/KanbanCards.css';
import { goalThemeColor } from '../utils/storyCardFormatting';
import { useNavigate } from 'react-router-dom';

// Normalize sprint identifiers so we handle doc refs, strings, and legacy placeholders
const normalizeSprintId = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'backlog' || trimmed === '__backlog__') return null;
    if (trimmed.startsWith('placeholder-')) return null;
    return trimmed;
  }
  if (typeof value === 'object') {
    const refId = (value as any)?.id;
    if (typeof refId === 'string') return refId;
  }
  return String(value);
};

// Droppable Sprint Column using pragmatic DnD
const SprintColumn: React.FC<{
  sprint: Sprint | null;
  stories: Story[];
  goals: Goal[];
  isBacklog?: boolean;
  placeholderLabel?: string;
  droppableId: string;
  showDescriptions: boolean;
}> = ({ sprint, stories, goals, isBacklog = false, placeholderLabel, droppableId, showDescriptions }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ targetSprintId: sprint ? sprint.id : null, droppableId }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [sprint, droppableId]);

  if (!sprint && !isBacklog) {
    return (
      <div className="sprint-column">
        <div className="sprint-column__placeholder">
          {placeholderLabel || 'Plan your next sprint to unlock this lane.'}
        </div>
      </div>
    );
  }

  const getSprintStatus = () => {
    if (isBacklog) return { color: '#6b7280', text: 'Backlog' };
    if (!sprint) return { color: '#6b7280', text: 'Unknown' };

    const statusValue = (sprint as any).status;
    if (typeof statusValue === 'number') {
      switch (statusValue) {
        case 0: return { color: '#f59e0b', text: 'Planning' };
        case 1: return { color: '#059669', text: 'Active' };
        case 2: return { color: '#6b7280', text: 'Complete' };
        case 3: return { color: '#dc2626', text: 'Cancelled' };
        default: return { color: '#6b7280', text: 'Open' };
      }
    }
    const raw = String(statusValue || '').toLowerCase();
    if (raw.includes('plan')) return { color: '#f59e0b', text: 'Planning' };
    if (raw.includes('active')) return { color: '#059669', text: 'Active' };
    if (raw.includes('done') || raw.includes('complete')) return { color: '#6b7280', text: 'Complete' };
    if (raw.includes('cancel')) return { color: '#dc2626', text: 'Cancelled' };
    return { color: '#6b7280', text: 'Open' };
  };

  const status = getSprintStatus();
  const totalPoints = stories.reduce((sum, story) => sum + (story.points || 0), 0);
  const dateRangeLabel = sprint && !isBacklog && sprint.startDate && sprint.endDate
    ? `${new Date(sprint.startDate).toLocaleDateString()} – ${new Date(sprint.endDate).toLocaleDateString()}`
    : null;

  return (
    <div className={`sprint-column${isOver ? ' is-over' : ''}`}>
      <div className="sprint-column__header">
        <div className="sprint-column__header-top">
          <h5 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: themeVars.text as string }}>
            {isBacklog ? 'Backlog' : sprint?.name || 'Upcoming Sprint'}
          </h5>
          <Badge
            bg="light"
            text="dark"
            style={{
              backgroundColor: status.color,
              color: '#ffffff',
              fontSize: 10,
              padding: '3px 8px',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase'
            }}
          >
            {status.text}
          </Badge>
        </div>
        {dateRangeLabel && (
          <span style={{ fontSize: 11, color: themeVars.muted as string }}>{dateRangeLabel}</span>
        )}
        <div className="sprint-column__stats">
          <span>{stories.length} stories</span>
          <span>{totalPoints} pts</span>
        </div>
      </div>

      <div
        ref={ref}
        className={`drop-lane${isOver ? ' is-over' : ''}`}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, minHeight: 220 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {stories.map(story => {
            const goal = goals.find(g => g.id === story.goalId);
            const themeColor = goalThemeColor(goal);
            return (
              <KanbanCardV2
                key={story.id}
                item={story}
                type="story"
                goal={goal}
                themeColor={themeColor || undefined}
                taskCount={0}
                showDescription={showDescriptions}
              />
            );
          })}
        </div>

        {stories.length === 0 && (
          <div className="sprint-column__placeholder">
            <div>
              <Calendar size={20} style={{ marginBottom: 8 }} />
              <div>{isBacklog ? 'No stories in backlog' : 'No stories assigned'}</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                Drag stories here to assign
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SprintPlanningMatrix: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // State
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [showDescriptions, setShowDescriptions] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Filters
  const [filterGoal, setFilterGoal] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<number | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [goalSearch, setGoalSearch] = useState('');

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    if (!currentUser || !currentPersona) return;

    const setupSubscriptions = () => {
      // Stories subscription
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('orderIndex', 'asc')
      );

      const unsubscribeStories = onSnapshot(
        storiesQuery,
        (snapshot) => {
          const storiesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Story[];
          setStories(storiesData);
          setMoveError(null);
        },
        (error) => {
          console.error('❌ Failed to load stories for planning matrix:', error);
          setMoveError('Missing or insufficient permissions to load stories. Please confirm ownerUid/persona.');
          setLoading(false);
        }
      );

      // Goals subscription
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );

      const unsubscribeGoals = onSnapshot(
        goalsQuery,
        (snapshot) => {
          const goalsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Goal[];
          setGoals(goalsData);
        },
        (error) => {
          console.error('❌ Failed to load goals for planning matrix:', error);
          setMoveError('Missing or insufficient permissions to load goals. Please confirm ownerUid/persona.');
        }
      );

      setLoading(false);

      return () => {
        unsubscribeStories();
        unsubscribeGoals();
      };
    };

    return setupSubscriptions();
  }, [currentUser, currentPersona]);

  // Filter stories
  const filteredStories = useMemo(() => {
    return stories.filter((story) => {
      if (filterGoal !== 'all' && story.goalId !== filterGoal) return false;
      if (filterTheme) {
        const goal = goals.find((g) => g.id === story.goalId);
        const storyTheme = (story as any).theme ?? goal?.theme ?? null;
        if (storyTheme !== filterTheme) return false;
      }
      return true;
    });
  }, [stories, goals, filterGoal, filterTheme]);

  const filteredGoals = useMemo(() => {
    if (!goalSearch.trim()) return goals;
    const q = goalSearch.toLowerCase();
    return goals.filter((g) => g.title.toLowerCase().includes(q));
  }, [goals, goalSearch]);

  // Story groups per sprint (including backlog)
  const storiesBySprint = filteredStories.reduce((acc, story) => {
    const sprintKey = normalizeSprintId((story as any).sprintId) ?? 'backlog';
    if (!acc[sprintKey]) acc[sprintKey] = [];
    acc[sprintKey].push(story);
    return acc;
  }, {} as Record<string, Story[]>);

  const backlogStories = storiesBySprint.backlog ?? [];

  const visibleSprints = useMemo(() => {
    return [...sprints]
      .filter((s) => {
        if (showCompleted) return true;
        const statusValue = (s as any).status;
        if (typeof statusValue === 'number') return statusValue <= 1;
        const normalized = String(statusValue ?? '').toLowerCase();
        return normalized === '' || normalized.includes('plan') || normalized.includes('active');
      })
      .sort((a, b) => (a.startDate ?? 0) - (b.startDate ?? 0));
  }, [sprints, showCompleted]);

  // Monitor drag/drop using pragmatic DnD
  useEffect(() => {
    return monitorForElements({
      onDrop: async ({ source, location }) => {
        try {
          const destination = location.current.dropTargets[0];
          if (!destination) return;
          const targetSprintId = (destination.data as any)?.targetSprintId ?? null;
          const story = source.data.item as Story | undefined;
          if (!story || !currentUser) return;

          const normalizedTarget = normalizeSprintId(targetSprintId);
          const currentSprintId = normalizeSprintId((story as any).sprintId);
          if (normalizedTarget === currentSprintId) return;

          // Optimistic update
          setStories((prev) =>
            prev.map((s) => (s.id === story.id ? { ...s, sprintId: normalizedTarget ?? undefined } : s))
          );
          setMoveError(null);

          await updateDoc(doc(db, 'stories', story.id), {
            sprintId: normalizedTarget ?? null,
            ownerUid: currentUser.uid,
            persona: currentPersona,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          console.error('❌ Error moving story:', error);
          setMoveError('Failed to move story. Please try again.');
        }
      },
    });
  }, [currentUser, currentPersona]);

  if (loading) {
    return (
      <Container fluid className="p-4">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div className="spinner-border text-primary" />
          <p style={{ marginTop: '16px', color: themeVars.muted as string }}>Loading sprint planning data...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid style={{ padding: '24px', backgroundColor: themeVars.bg as string, minHeight: '100vh' }} ref={containerRef}>
      {/* Header */}
      <Row className="mb-4">
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: themeVars.text as string }}>
                Sprint Planning Matrix
              </h2>
              <Badge bg="primary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona
              </Badge>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => navigate('/sprints/kanban')}
                className="d-inline-flex align-items-center"
              >
                <LayoutGrid size={16} style={{ marginRight: 6 }} />
                Kanban
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => {
                  const el = containerRef.current;
                  if (!el) return;
                  if (!document.fullscreenElement) {
                    el.requestFullscreen().catch(() => {});
                  } else {
                    document.exitFullscreen().catch(() => {});
                  }
                }}
                className="d-inline-flex align-items-center"
              >
                {isFullscreen ? <Minimize2 size={16} style={{ marginRight: 6 }} /> : <Maximize2 size={16} style={{ marginRight: 6 }} />}
                {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              </Button>
              <Button variant="primary" href="/sprints/new">
                <Plus size={16} style={{ marginRight: '8px' }} />
                Create Sprint
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* Filters */}
      <Row className="mb-4">
        <Col>
          <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <Card.Body>
              <Row className="align-items-center">
                <Col md={3}>
                  <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    <Target size={14} style={{ marginRight: '6px' }} />
                    Filter by Goal
                  </Form.Label>
                  <Dropdown>
                    <Dropdown.Toggle variant="outline-secondary" size="sm" style={{ minWidth: '200px' }} className="text-truncate">
                      {filterGoal === 'all'
                        ? 'All Goals'
                        : (goals.find(g => g.id === filterGoal)?.title || 'Unknown Goal')}
                    </Dropdown.Toggle>
                    <Dropdown.Menu style={{ maxHeight: '420px', overflowY: 'auto', minWidth: '260px' }}>
                      <div className="p-2 sticky-top bg-white border-bottom">
                        <Form.Control
                          size="sm"
                          placeholder="Search goals..."
                          value={goalSearch}
                          onChange={(e) => setGoalSearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <Dropdown.Item onClick={() => setFilterGoal('all')} active={filterGoal === 'all'}>
                        All Goals
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      {filteredGoals.length > 0 ? (
                        filteredGoals.map(goal => (
                          <Dropdown.Item
                            key={goal.id}
                            onClick={() => setFilterGoal(goal.id)}
                            active={filterGoal === goal.id}
                          >
                            <div className="text-truncate" title={goal.title}>{goal.title}</div>
                          </Dropdown.Item>
                        ))
                      ) : (
                        <div className="p-2 text-center text-muted small">No goals found</div>
                      )}
                    </Dropdown.Menu>
                  </Dropdown>
                </Col>
                <Col md={3}>
                  <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                    <Filter size={14} style={{ marginRight: '6px' }} />
                    Filter by Theme
                  </Form.Label>
                  <Dropdown>
                    <Dropdown.Toggle variant="outline-secondary" size="sm" style={{ minWidth: '200px' }}>
                      {filterTheme === null
                        ? 'All Themes'
                        : (GLOBAL_THEMES.find(t => t.id === filterTheme)?.label || 'Unknown Theme')}
                    </Dropdown.Toggle>
                    <Dropdown.Menu style={{ maxHeight: '420px', overflowY: 'auto' }}>
                      <Dropdown.Item onClick={() => setFilterTheme(null)} active={filterTheme === null}>
                        All Themes
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      {GLOBAL_THEMES.map(theme => (
                        <Dropdown.Item
                          key={theme.id}
                          onClick={() => setFilterTheme(theme.id)}
                          active={filterTheme === theme.id}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: theme.color }} />
                            {theme.label}
                          </div>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown>
                </Col>
                <Col md={3}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <ArrowUpDown size={14} style={{ marginRight: '6px' }} />
                      Sprint Visibility
                    </Form.Label>
                    <Form.Check
                      type="switch"
                      id="toggle-completed-sprints"
                      label="Show completed sprints"
                      checked={showCompleted}
                      onChange={(e) => setShowCompleted(e.target.checked)}
                    />
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <ArrowRight size={14} style={{ marginRight: '6px' }} />
                      Story details
                    </Form.Label>
                    <Form.Check
                      type="switch"
                      id="toggle-matrix-descriptions"
                      label="Show descriptions"
                      checked={showDescriptions}
                      onChange={(e) => setShowDescriptions(e.target.checked)}
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <div style={{ paddingTop: '20px' }}>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => {
                        setFilterGoal('all');
                        setFilterTheme(null);
                        setShowCompleted(false);
                        setShowDescriptions(false);
                        setGoalSearch('');
                      }}
                    >
                      Clear Filters
                    </Button>
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {moveError && (
        <Row className="mt-3">
          <Col>
            <Alert variant="danger" dismissible onClose={() => setMoveError(null)}>
              {moveError}
            </Alert>
          </Col>
        </Row>
      )}

      {/* Sprint Matrix */}
      <div className="sprint-planning-grid">
        <SprintColumn
          sprint={null}
          stories={backlogStories}
          goals={goals}
          isBacklog={true}
          droppableId="backlog"
          showDescriptions={showDescriptions}
        />
        {visibleSprints.map((sprint) => (
          <SprintColumn
            key={sprint.id}
            sprint={sprint}
            stories={storiesBySprint[sprint.id] || []}
            goals={goals}
            placeholderLabel={undefined}
            droppableId={sprint.id}
            showDescriptions={showDescriptions}
          />
        ))}
      </div>

      {/* Instructions */}
      <Row className="mt-4">
        <Col>
          <Card style={{ border: 'none', backgroundColor: '#f0f9ff', padding: '16px' }}>
            <Card.Body>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <ArrowRight size={20} style={{ color: '#2563eb' }} />
                <div>
                  <h6 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#1e40af' }}>
                    Drag & Drop Instructions
                  </h6>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#1e40af' }}>
                    Drag stories between backlog and sprints to plan your work. 
                    Stories will automatically update their sprint assignment.
                  </p>
                </div>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Empty State */}
      {filteredStories.length === 0 && (
        <Row className="mt-4">
          <Col>
            <Card style={{ border: 'none', textAlign: 'center', padding: '60px 20px' }}>
              <Card.Body>
                <Calendar size={48} style={{ color: '#9ca3af', marginBottom: '16px' }} />
                <h5 style={{ color: '#374151', marginBottom: '8px' }}>No stories found</h5>
                <p style={{ color: '#6b7280', marginBottom: '24px' }}>
                  Create stories to start planning your sprints, or adjust your filters.
                </p>
                <Button variant="primary" href="/stories">
                  Manage Stories
                </Button>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </Container>
  );
};

export default SprintPlanningMatrix;
