import React, { useState, useEffect } from 'react';
import { Card, Container, Row, Col, Button, Form, Badge, Dropdown } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Story, Sprint, Goal } from '../types';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent,
  useDroppable
} from '@dnd-kit/core';
import { 
  SortableContext, 
  verticalListSortingStrategy, 
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, Target, Filter, Plus, ArrowUpDown, ArrowRight, GripVertical } from 'lucide-react';
import { themeVars } from '../utils/themeVars';
import '../styles/KanbanCards.css';
import { storyStatusText, priorityLabel as formatPriorityLabel, priorityPillClass, goalThemeColor, colorWithAlpha } from '../utils/storyCardFormatting';
import { displayRefForEntity, validateRef } from '../utils/referenceGenerator';

// Sortable Story Card Component
const SortableStoryCard: React.FC<{
  story: Story;
  goal?: Goal;
}> = ({ story, goal }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: story.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const refLabel = (() => {
    const shortRef = (story as any).referenceNumber || story.ref;
    return shortRef && validateRef(shortRef, 'story')
      ? shortRef
      : displayRefForEntity('story', story.id);
  })();

  const themeColor = goalThemeColor(goal);
  const statusLabel = storyStatusText((story as any).status);
  const priorityClass = priorityPillClass(story.priority);
  const priorityText = formatPriorityLabel(story.priority);
  const points = story.points ?? 0;
  const handleColor = themeColor || '#2563eb';
  const handleStyle: React.CSSProperties = {
    color: handleColor,
    borderColor: colorWithAlpha(handleColor, 0.45),
    backgroundColor: colorWithAlpha(handleColor, 0.12)
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`kanban-card kanban-card--story${isDragging ? ' dragging' : ''}`}
        style={{ borderLeft: `3px solid ${themeColor}` }}
      >
        <button
          type="button"
          className="kanban-card__handle"
          style={handleStyle}
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>

        <div className="kanban-card__content">
          <div className="kanban-card__header">
            <span className="kanban-card__ref" style={{ color: themeColor }}>
              {refLabel}
            </span>
          </div>

          <div className="kanban-card__title" title={story.title || 'Untitled story'}>
            {story.title || 'Untitled story'}
          </div>

          {story.description && story.description.trim().length > 0 && (
            <div className="kanban-card__description">
              {story.description}
            </div>
          )}

          <div className="kanban-card__meta">
            <span className={priorityClass} title={`Priority: ${priorityText}`}>
              {priorityText}
            </span>
            <span className="kanban-card__meta-badge" title="Story points">
              {points} pts
            </span>
            <span className="kanban-card__meta-text" title="Status">
              {statusLabel}
            </span>
          </div>

          <div className="kanban-card__goal">
            <Target size={12} color={themeColor} />
            <span title={goal?.title || 'No goal'}>
              {goal?.title || 'No goal'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Droppable Sprint Column
const SprintColumn: React.FC<{
  sprint: Sprint | null;
  stories: Story[];
  goals: Goal[];
  isBacklog?: boolean;
  placeholderLabel?: string;
  droppableId: string;
}> = ({ sprint, stories, goals, isBacklog = false, placeholderLabel, droppableId }) => {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

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
        ref={setNodeRef}
        className={`drop-lane${isOver ? ' is-over' : ''}`}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, minHeight: 220 }}
      >
        <SortableContext
          id={droppableId}
          items={stories.map(story => story.id)}
          strategy={verticalListSortingStrategy}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {stories.map(story => {
              const goal = goals.find(g => g.id === story.goalId);
              return (
                <SortableStoryCard
                  key={story.id}
                  story={story}
                  goal={goal}
                />
              );
            })}
          </div>
        </SortableContext>

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
  
  // State
  const [stories, setStories] = useState<Story[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [filterGoal, setFilterGoal] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'all' | 'active'>('active');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    if (!currentUser) return;

    const setupSubscriptions = () => {
      // Stories subscription
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('orderIndex', 'asc')
      );

      const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
        const storiesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Story[];
        setStories(storiesData);
      });

      // Sprints subscription
      const sprintsQuery = query(
        collection(db, 'sprints'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('startDate', 'desc')
      );

      const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
        const sprintsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Sprint[];
        setSprints(sprintsData);
      });

      // Goals subscription
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        orderBy('createdAt', 'desc')
      );

      const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
        const goalsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Goal[];
        setGoals(goalsData);
      });

      setLoading(false);

      return () => {
        unsubscribeStories();
        unsubscribeSprints();
        unsubscribeGoals();
      };
    };

    return setupSubscriptions();
  }, [currentUser, currentPersona]);

  // Filter stories
  const filteredStories = stories.filter(story => {
    if (filterGoal !== 'all' && story.goalId !== filterGoal) return false;
    if (filterStatus !== 'all' && (story.status !== undefined ? story.status : 0).toString() !== filterStatus) return false;
    return true;
  });

  // Story groups per sprint (including backlog)
  const storiesBySprint = filteredStories.reduce((acc, story) => {
    const sprintKey = story.sprintId ? String(story.sprintId) : 'backlog';
    if (!acc[sprintKey]) acc[sprintKey] = [];
    acc[sprintKey].push(story);
    return acc;
  }, {} as Record<string, Story[]>);

  const backlogStories = storiesBySprint.backlog ?? [];

  // Determine sprint slots (Backlog + next 4 sprints)
  const sortedSprints = [...sprints].sort((a, b) => {
    const startA = a.startDate ?? Number.MAX_SAFE_INTEGER;
    const startB = b.startDate ?? Number.MAX_SAFE_INTEGER;
    return startA - startB;
  });

  const activeFiltered = viewMode === 'active'
    ? sortedSprints.filter((sprint) => {
        const statusValue = (sprint as any).status;
        if (typeof statusValue === 'number') return statusValue <= 1;
        const normalized = String(statusValue ?? '').toLowerCase();
        return normalized === '' || normalized.includes('plan') || normalized.includes('active');
      })
    : sortedSprints;

  const sprintSlots: Array<Sprint | null> = [];
  for (const sprint of activeFiltered) {
    if (sprintSlots.length >= 4) break;
    sprintSlots.push(sprint);
  }
  if (sprintSlots.length < 4) {
    for (const sprint of sortedSprints) {
      if (sprintSlots.includes(sprint)) continue;
      sprintSlots.push(sprint);
      if (sprintSlots.length >= 4) break;
    }
  }
  while (sprintSlots.length < 4) {
    sprintSlots.push(null);
  }

  const resolveDropSprint = (overId: any): string | null | undefined => {
    if (overId == null) return undefined;
    const targetId = String(overId);
    if (targetId === 'backlog') return null;

    const matchingSprint = sprints.find(sprint => sprint.id === targetId);
    if (matchingSprint) return matchingSprint.id;

    const matchingStory = stories.find(story => story.id === targetId);
    if (matchingStory) {
      return matchingStory.sprintId ? String(matchingStory.sprintId) : null;
    }

    return undefined;
  };

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const storyId = String(active.id);
    const story = stories.find(s => s.id === storyId);
    if (!story) return;

    const resolvedTarget = resolveDropSprint(over.id);
    if (resolvedTarget === undefined) return;

    const targetSprintId = resolvedTarget ?? null;
    const currentSprintId = story.sprintId ? String(story.sprintId) : null;

    if (currentSprintId === targetSprintId) return;

    try {
      await updateDoc(doc(db, 'stories', storyId), {
        sprintId: targetSprintId,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('❌ Error moving story:', error);
    }
  };

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
    <Container fluid style={{ padding: '24px', backgroundColor: themeVars.bg as string, minHeight: '100vh' }}>
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
              <Dropdown>
                <Dropdown.Toggle variant="outline-secondary" size="sm">
                  <ArrowUpDown size={14} style={{ marginRight: '6px' }} />
                  {viewMode === 'active' ? 'Active Sprints' : 'All Sprints'}
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => setViewMode('active')} active={viewMode === 'active'}>
                    Active Sprints Only
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => setViewMode('all')} active={viewMode === 'all'}>
                    All Sprints
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
              
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
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <Target size={14} style={{ marginRight: '6px' }} />
                      Filter by Goal
                    </Form.Label>
                    <Form.Select
                      value={filterGoal}
                      onChange={(e) => setFilterGoal(e.target.value)}
                      size="sm"
                    >
                      <option value="all">All Goals</option>
                      {goals.map(goal => (
                        <option key={goal.id} value={goal.id}>
                          {goal.title}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                      <Filter size={14} style={{ marginRight: '6px' }} />
                      Filter by Status
                    </Form.Label>
                    <Form.Select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      size="sm"
                    >
                      <option value="all">All Status</option>
                      <option value="0">Backlog</option>
                      <option value="1">Planned</option>
                      <option value="2">In Progress</option>
                      <option value="3">Testing</option>
                      <option value="4">Done</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <div style={{ paddingTop: '20px' }}>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => {
                        setFilterGoal('all');
                        setFilterStatus('all');
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

      {/* Sprint Matrix */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="sprint-planning-grid">
          <SprintColumn
            sprint={null}
            stories={backlogStories}
            goals={goals}
            isBacklog={true}
            droppableId="backlog"
          />
          {sprintSlots.map((sprint, index) => (
            <SprintColumn
              key={sprint ? sprint.id : `placeholder-${index}`}
              sprint={sprint}
              stories={sprint ? (storiesBySprint[sprint.id] || []) : []}
              goals={goals}
              placeholderLabel={!sprint ? 'Add a sprint to plan upcoming work.' : undefined}
              droppableId={sprint ? sprint.id : `placeholder-${index}`}
            />
          ))}
        </div>
      </DndContext>

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
