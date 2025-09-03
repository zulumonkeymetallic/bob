import React, { useState, useEffect } from 'react';
import { Card, Container, Row, Col, Button, Form, Badge, Modal, Dropdown } from 'react-bootstrap';
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
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  SortableContext, 
  verticalListSortingStrategy, 
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, Target, Filter, Plus, ArrowUpDown, ArrowRight } from 'lucide-react';
import { getThemeName, getStatusName, getPriorityName } from '../utils/statusHelpers';

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
    opacity: isDragging ? 0.5 : 1,
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 0: return '#6b7280'; // Backlog
      case 1: return '#2563eb'; // Planned
      case 2: return '#f59e0b'; // In Progress
      case 3: return '#10b981'; // Testing
      case 4: return '#059669'; // Done
      default: return '#6b7280';
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return '#dc2626'; // P1
      case 2: return '#f59e0b'; // P2
      case 3: return '#059669'; // P3
      default: return '#6b7280';
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="mb-2"
    >
      <Card 
        style={{ 
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          cursor: 'grab',
          transition: 'all 0.2s ease',
          backgroundColor: isDragging ? '#f3f4f6' : '#fff'
        }}
      >
        <Card.Body style={{ padding: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ flex: 1, marginRight: '8px' }}>
              <h6 style={{ 
                margin: 0, 
                fontSize: '14px', 
                fontWeight: '600', 
                color: '#1f2937',
                lineHeight: '1.3'
              }}>
                {story.title}
              </h6>
              {story.description && (
                <p style={{ 
                  margin: '4px 0 0 0', 
                  fontSize: '12px', 
                  color: '#6b7280',
                  lineHeight: '1.3'
                }}>
                  {story.description.length > 80 
                    ? `${story.description.substring(0, 80)}...` 
                    : story.description
                  }
                </p>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
              <Badge 
                style={{ 
                  backgroundColor: getStatusColor(story.status),
                  fontSize: '10px',
                  padding: '2px 6px'
                }}
              >
                {getStatusName(story.status)}
              </Badge>
              <Badge 
                style={{ 
                  backgroundColor: getPriorityColor(story.priority),
                  fontSize: '10px',
                  padding: '2px 6px'
                }}
              >
                P{story.priority}
              </Badge>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: '500' }}>
                {story.ref}
              </span>
              {story.points && (
                <Badge bg="secondary" style={{ fontSize: '10px', padding: '2px 6px' }}>
                  {story.points} pts
                </Badge>
              )}
            </div>
            
            {goal && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Target size={12} style={{ color: '#6b7280' }} />
                <span style={{ fontSize: '10px', color: '#6b7280' }}>
                  {goal.title.length > 20 ? `${goal.title.substring(0, 20)}...` : goal.title}
                </span>
              </div>
            )}
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

// Droppable Sprint Column
const SprintColumn: React.FC<{
  sprint: Sprint | null;
  stories: Story[];
  goals: Goal[];
  isBacklog?: boolean;
}> = ({ sprint, stories, goals, isBacklog = false }) => {
  const sprintId = sprint?.id || 'backlog';
  
  const getSprintStatus = () => {
    if (isBacklog) return { color: '#6b7280', text: 'BACKLOG' };
    if (!sprint) return { color: '#6b7280', text: 'UNKNOWN' };
    
    switch (sprint.status) {
      case 0: return { color: '#f59e0b', text: 'PLANNING' };
      case 1: return { color: '#059669', text: 'ACTIVE' };
      case 2: return { color: '#6b7280', text: 'COMPLETE' };
      case 3: return { color: '#dc2626', text: 'CANCELLED' };
      default: return { color: '#6b7280', text: 'UNKNOWN' };
    }
  };

  const status = getSprintStatus();
  const totalPoints = stories.reduce((sum, story) => sum + (story.points || 0), 0);

  return (
    <div
      style={{ 
        minHeight: '400px',
        padding: '16px',
        backgroundColor: '#f9fafb',
        border: '2px dashed #d1d5db',
        borderRadius: '8px',
        transition: 'all 0.2s ease'
      }}
    >
      {/* Column Header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h5 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>
            {isBacklog ? 'Backlog' : sprint?.name || 'Unknown Sprint'}
          </h5>
          <Badge 
            style={{ 
              backgroundColor: status.color,
              fontSize: '10px',
              padding: '4px 8px'
            }}
          >
            {status.text}
          </Badge>
        </div>
        
        {sprint && !isBacklog && (
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
            {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
          </div>
        )}
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>
            {stories.length} stories
          </span>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>
            {totalPoints} points
          </span>
        </div>
      </div>

      {/* Stories */}
      <SortableContext 
        items={stories.map(story => story.id)}
        strategy={verticalListSortingStrategy}
      >
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
      </SortableContext>

      {/* Empty State */}
      {stories.length === 0 && (
        <div style={{ 
          textAlign: 'center', 
          padding: '40px 20px',
          color: '#9ca3af'
        }}>
          <Calendar size={24} style={{ marginBottom: '8px' }} />
          <div style={{ fontSize: '14px' }}>
            {isBacklog ? 'No stories in backlog' : 'No stories in sprint'}
          </div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            Drag stories here to assign
          </div>
        </div>
      )}
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
    if (filterStatus !== 'all' && story.status.toString() !== filterStatus) return false;
    return true;
  });

  // Get sprints to show
  const displaySprints = viewMode === 'active' 
    ? sprints.filter(sprint => sprint.status <= 1) // Planning or Active
    : sprints;

  // Group stories by sprint
  const storyGroups = {
    backlog: filteredStories.filter(story => !story.sprintId),
    ...displaySprints.reduce((acc, sprint) => {
      acc[sprint.id] = filteredStories.filter(story => story.sprintId === sprint.id);
      return acc;
    }, {} as { [key: string]: Story[] })
  };

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) return;
    
    const storyId = active.id as string;
    const targetSprintId = over.id === 'backlog' ? null : over.id as string;
    
    // Find the story being moved
    const story = stories.find(s => s.id === storyId);
    if (!story) return;
    
    // Don't update if it's the same sprint
    if (story.sprintId === targetSprintId) return;
    
    try {
      console.log(`Moving story ${storyId} to ${targetSprintId || 'backlog'}`);
      
      await updateDoc(doc(db, 'stories', storyId), {
        sprintId: targetSprintId,
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ Story moved successfully');
    } catch (error) {
      console.error('❌ Error moving story:', error);
    }
  };

  if (loading) {
    return (
      <Container fluid className="p-4">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div className="spinner-border text-primary" />
          <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading sprint planning data...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid style={{ padding: '24px', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <Row className="mb-4">
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#1f2937' }}>
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
        <Row>
          {/* Backlog Column */}
          <Col md={4} className="mb-4">
            <SprintColumn
              sprint={null}
              stories={storyGroups.backlog || []}
              goals={goals}
              isBacklog={true}
            />
          </Col>

          {/* Sprint Columns */}
          {displaySprints.map(sprint => (
            <Col md={4} key={sprint.id} className="mb-4">
              <SprintColumn
                sprint={sprint}
                stories={storyGroups[sprint.id] || []}
                goals={goals}
              />
            </Col>
          ))}
        </Row>
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
