import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Badge, Dropdown } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useThemeAwareColors, getContrastTextColor } from '../hooks/useThemeAwareColors';
import { Story, Goal, Task, Sprint } from '../types';
import { sanitizeFirestoreData } from '../utils/firestoreUtils';
import { ChoiceHelper } from '../config/choices';
import { getStatusName, getThemeName } from '../utils/statusHelpers';
import { Settings, Eye, EyeOff, Plus, Edit, Trash2, Move } from 'lucide-react';
import { themeVars, rgbaCard } from '../utils/themeVars';
import ModernTaskTable from './ModernTaskTable';

const EnhancedKanbanPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { isDark, colors, backgrounds } = useThemeAwareColors();
  
  // State management
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [selectedSprint, setSelectedSprint] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [showAddStory, setShowAddStory] = useState(false);
  const [showEditStory, setShowEditStory] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<Story | null>(null);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  
  // Form data
  const [newStory, setNewStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 2 as number,
    points: 1
  });
  
  const [editStory, setEditStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 2 as number,
    points: 1
  });
  
  // Swim lanes configuration
  const swimLanes = [
    { id: 'backlog', title: 'Backlog', status: 0, color: themeVars.muted },
    { id: 'active', title: 'Active', status: 1, color: themeVars.brand },
    { id: 'done', title: 'Done', status: 2, color: 'var(--green)' }
  ];

  useEffect(() => {
    if (!currentUser) return;
    loadData();
  }, [currentUser, currentPersona]);

  const loadData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => sanitizeFirestoreData({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
    });

    // Load stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => sanitizeFirestoreData({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storiesData);
    });

    // Load tasks
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => sanitizeFirestoreData({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(tasksData);
    });

    // Load sprints
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => sanitizeFirestoreData({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      setSprints(sprintsData);
    });

    setLoading(false);

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeTasks();
      unsubscribeSprints();
    };
  };

  // Filter stories by selected sprint
  const getFilteredStories = () => {
    if (selectedSprint === 'all') return stories;
    
    const sprint = sprints.find(s => s.id === selectedSprint);
    if (!sprint) return stories;
    
    return stories.filter(story => {
      // Check if story is directly assigned to sprint
      return story.sprintId === selectedSprint;
    });
  };

  const getGoalTitle = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal?.title || 'Unassigned';
  };

  const getGoalTheme = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal?.theme || 5; // Default to "Home" theme
  };

  const getThemeColor = (theme: number) => {
    const themeColors: { [key: number]: string } = {
      1: 'success', // Health
      2: 'primary', // Growth
      3: 'warning', // Wealth
      4: 'info',    // Tribe
      5: 'secondary' // Home
    };
    return themeColors[theme] || 'secondary';
  };

  const getThemeName = (theme: number) => {
    const themeNames: { [key: number]: string } = {
      1: 'Health',
      2: 'Growth', 
      3: 'Wealth',
      4: 'Tribe',
      5: 'Home'
    };
    return themeNames[theme] || 'Home';
  };

  const getPriorityName = (priority: number) => {
    const priorityNames: { [key: number]: string } = {
      1: 'P1',
      2: 'P2',
      3: 'P3'
    };
    return priorityNames[priority] || 'P2';
  };

  const getTaskCount = (storyId: string) => {
    return tasks.filter(task => task.parentId === storyId && task.parentType === 'story').length;
  };

  const handleAddStory = async () => {
    if (!currentUser || !newStory.title.trim()) return;

    try {
      await addDoc(collection(db, 'stories'), {
        title: newStory.title,
        description: newStory.description,
        goalId: newStory.goalId,
        status: 0,
        priority: newStory.priority,
        points: newStory.points,
        orderIndex: stories.length,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setNewStory({
        title: '',
        description: '',
        goalId: '',
        priority: 2,
        points: 1
      });
      setShowAddStory(false);
    } catch (error) {
      console.error('Error adding story:', error);
    }
  };

  const handleUpdateStory = async () => {
    if (!currentUser || !selectedStory || !editStory.title.trim()) return;

    try {
      await updateDoc(doc(db, 'stories', selectedStory.id), {
        title: editStory.title,
        description: editStory.description,
        goalId: editStory.goalId,
        priority: editStory.priority,
        points: editStory.points,
        updatedAt: serverTimestamp()
      });

      setShowEditStory(false);
      setSelectedStory(null);
    } catch (error) {
      console.error('Error updating story:', error);
    }
  };

  const handleDeleteStory = async (story: Story) => {
    if (!currentUser) return;

    try {
      await deleteDoc(doc(db, 'stories', story.id));
      setShowDeleteModal(null);
    } catch (error) {
      console.error('Error deleting story:', error);
    }
  };

  const updateStoryStatus = async (storyId: string, newStatus: number) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating story status:', error);
    }
  };

  const handleStoryClick = (story: Story) => {
    setSelectedStory(story);
    setShowTaskPanel(true);
  };

  const openEditStory = (story: Story, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditStory({
      title: story.title,
      description: story.description || '',
      goalId: story.goalId || '',
      priority: story.priority,
      points: story.points || 1
    });
    setSelectedStory(story);
    setShowEditStory(true);
  };

  const openDeleteModal = (story: Story, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteModal(story);
  };

  // Enhanced Story Card Component (matching Goals style)
  const StoryCard: React.FC<{ story: Story; lane: any }> = ({ story, lane }) => {
    const goalTheme = getGoalTheme(story.goalId);
    const taskCount = getTaskCount(story.id);
    const isSelected = selectedStory?.id === story.id;
    
    return (
      <div
        onClick={() => handleStoryClick(story)}
        style={{
          backgroundColor: themeVars.panel,
          border: isSelected ? `2px solid ${themeVars.brand}` : `1px solid ${themeVars.border}`,
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '12px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.1)',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) {
            e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            e.currentTarget.style.borderColor = themeVars.border as string;
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            e.currentTarget.style.borderColor = themeVars.border as string;
          }
        }}
      >
        {/* Header with title and badges */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <h6 style={{ 
            margin: 0, 
            fontSize: '14px', 
            fontWeight: '600', 
            color: colors.onSurface,
            lineHeight: '1.4',
            flex: 1,
            marginRight: '8px'
          }}>
            {story.title}
          </h6>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <span style={{
              backgroundColor: rgbaCard(0.2),
              color: themeVars.text as string,
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: '500',
            }}>
              {goalTheme}
            </span>
            {(() => {
              const p = (story as any).priority as number;
              const label = p === 1 ? 'P1' : p === 2 ? 'P2' : 'P3';
              const bg = p === 1 ? 'rgba(255, 0, 0, 0.15)' : p === 2 ? 'rgba(255, 165, 0, 0.15)' : rgbaCard(0.2);
              const fg = p === 1 ? 'var(--red)' : p === 2 ? 'var(--orange)' : 'var(--green)';
              return (
                <span style={{
                  backgroundColor: bg,
                  color: fg,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: '500',
                }}>
                  {label}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Goal reference */}
        <div style={{ marginBottom: '8px' }}>
          <span style={{ 
            fontSize: '12px', 
            color: themeVars.muted as string,
            fontWeight: '500'
          }}>
            Goal: {getGoalTitle(story.goalId)}
          </span>
        </div>

        {/* Description */}
        {story.description && (
          <p style={{ 
            fontSize: '13px', 
            color: themeVars.muted as string, 
            margin: '0 0 12px 0',
            lineHeight: '1.4'
          }}>
            {story.description}
          </p>
        )}

        {/* Stats */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '12px',
          padding: '8px 0',
          borderTop: `1px solid ${themeVars.border}`,
          borderBottom: `1px solid ${themeVars.border}`
        }}>
          <span style={{ fontSize: '12px', color: themeVars.muted as string }}>
            📋 {taskCount} tasks • ⭐ {story.points} points
          </span>
          {isSelected && (
            <span style={{
              backgroundColor: rgbaCard(0.2),
              color: themeVars.brand as string,
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: '500',
            }}>
              Selected
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: themeVars.muted as string }}>
            Click to view tasks
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={(e) => openEditStory(story, e)}
              style={{
                color: themeVars.brand as string,
                padding: '4px 8px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: '500',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = rgbaCard(0.2);
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title="Edit story"
            >
              <Edit size={12} />
            </button>
            <button
              onClick={(e) => openDeleteModal(story, e)}
              style={{
                color: 'var(--red)',
                padding: '4px 8px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: '500',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = rgbaCard(0.15);
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title="Delete story"
            >
              <Trash2 size={12} />
            </button>
            <Dropdown>
              <Dropdown.Toggle 
                as="button"
                style={{
                  color: 'var(--green)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: '500',
                  transition: 'all 0.15s ease',
                }}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                <Move size={12} />
              </Dropdown.Toggle>
              <Dropdown.Menu>
                {swimLanes.map(swimLane => (
                  <Dropdown.Item 
                    key={swimLane.id}
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      updateStoryStatus(story.id, swimLane.status); 
                    }}
                  >
                    {swimLane.title}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>
      </div>
    );
  };

  const filteredStories = getFilteredStories();

  if (loading) {
    return (
      <Container>
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <h4>Loading Kanban Board...</h4>
        </div>
      </Container>
    );
  }

  return (
    <Container style={{ maxWidth: '100%', padding: '0 20px' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '24px',
        paddingBottom: '16px',
        borderBottom: '1px solid #e5e7eb'
      }}>
        <div>
          <h3 style={{ 
            fontSize: '24px', 
            fontWeight: '700', 
            color: colors.onSurface, 
            margin: 0,
            marginBottom: '4px' 
          }}>
            Story Kanban Board
          </h3>
          <p style={{ 
            fontSize: '14px', 
            color: '#6b7280', 
            margin: 0 
          }}>
            {filteredStories.length} stories • {goals.length} goals • {sprints.length} sprints
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Sprint Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: '500', color: colors.onSurface }}>
              Sprint:
            </label>
            <select
              value={selectedSprint}
              onChange={(e) => setSelectedSprint(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                backgroundColor: backgrounds.surface,
                color: colors.onSurface,
                fontSize: '14px',
                minWidth: '150px',
              }}
            >
              <option value="all">All Stories</option>
              {sprints.map(sprint => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
            </select>
          </div>
          
          <Button
            variant="primary"
            onClick={() => setShowAddStory(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            <Plus size={16} />
            Add Story
          </Button>
        </div>
      </div>

      {/* No Goals Warning */}
      {goals.length === 0 && (
        <div style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--orange)',
          borderRadius: '8px',
          padding: '20px',
          textAlign: 'center',
          marginBottom: '24px'
        }}>
          <h5 style={{ color: '#92400e', marginBottom: '8px' }}>No Goals Found</h5>
          <p style={{ color: '#92400e', marginBottom: '16px' }}>
            You need to create goals first before adding stories.
          </p>
          <Button variant="warning" href="/goals-management">
            Go to Goals Management
          </Button>
        </div>
      )}

      {/* Kanban Board */}
      {goals.length > 0 && (
        <Row className="g-3">
          {swimLanes.map((lane) => (
            <Col md={4} key={lane.id}>
              <div style={{
                backgroundColor: backgrounds.surface,
                border: '1px solid var(--line)',
                borderRadius: '8px',
                height: '70vh',
                display: 'flex',
                flexDirection: 'column'
              }}>
                {/* Lane Header */}
                <div style={{
                  backgroundColor: 'var(--card)',
                  padding: '16px',
                  borderBottom: '1px solid var(--line)',
                  borderRadius: '8px 8px 0 0'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h5 style={{ 
                      margin: 0, 
                      fontSize: '16px', 
                      fontWeight: '600',
                      color: lane.color
                    }}>
                      {lane.title}
                    </h5>
                    <span style={{
                      backgroundColor: lane.color,
                      color: 'var(--on-accent)',
                      padding: '4px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '500'
                    }}>
                      {filteredStories.filter(s => (s as any).status === lane.status).length}
                    </span>
                  </div>
                </div>
                
                {/* Lane Body */}
                <div style={{ 
                  flex: 1, 
                  padding: '16px', 
                  overflowY: 'auto' 
                }}>
                  {filteredStories
                    .filter(story => (story as any).status === lane.status)
                    .map((story) => (
                      <StoryCard key={story.id} story={story} lane={lane} />
                    ))}
                  
                  {filteredStories.filter(s => (s as any).status === lane.status).length === 0 && (
                    <div style={{
                      textAlign: 'center',
                      padding: '40px 20px',
                      color: 'var(--muted)',
                      fontSize: '14px'
                    }}>
                      No stories in {lane.title.toLowerCase()}
                    </div>
                  )}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}

      {/* Task Panel */}
      {showTaskPanel && selectedStory && (
        <div style={{
          marginTop: '32px',
          backgroundColor: backgrounds.surface,
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '20px',
            paddingBottom: '16px',
            borderBottom: '1px solid #e5e7eb'
          }}>
            <h4 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              📋 Tasks for: {selectedStory.title}
            </h4>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setShowTaskPanel(false)}
            >
              Hide Tasks
            </Button>
          </div>
          
          <ModernTaskTable
            stories={stories}
            goals={goals}
            sprints={sprints}
            tasks={tasks.filter(task => task.parentId === selectedStory.id && task.parentType === 'story')}
            onTaskUpdate={async () => {}}
            onTaskDelete={async () => {}}
            onTaskPriorityChange={async () => {}}
          />
        </div>
      )}

      {/* Add Story Modal */}
      <Modal show={showAddStory} onHide={() => setShowAddStory(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Add New Story</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title *</Form.Label>
              <Form.Control
                type="text"
                value={newStory.title}
                onChange={(e) => setNewStory(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Enter story title"
                required
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={newStory.description}
                onChange={(e) => setNewStory(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Enter story description"
              />
            </Form.Group>
            
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Goal</Form.Label>
                  <Form.Select
                    value={newStory.goalId}
                    onChange={(e) => setNewStory(prev => ({ ...prev, goalId: e.target.value }))}
                  >
                    <option value="">Select a goal</option>
                    {goals.map(goal => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title} ({goal.theme})
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={newStory.priority}
                    onChange={(e) => setNewStory(prev => ({ ...prev, priority: parseInt(e.target.value) || 2 }))}
                  >
                    <option value={1}>P1 - High</option>
                    <option value={2}>P2 - Medium</option>
                    <option value={3}>P3 - Low</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Points</Form.Label>
                  <Form.Control
                    type="number"
                    min="1"
                    max="13"
                    value={newStory.points}
                    onChange={(e) => setNewStory(prev => ({ ...prev, points: parseInt(e.target.value) || 1 }))}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddStory(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleAddStory}
            disabled={!newStory.title.trim()}
          >
            Add Story
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Story Modal */}
      <Modal show={showEditStory} onHide={() => setShowEditStory(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Edit Story</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title *</Form.Label>
              <Form.Control
                type="text"
                value={editStory.title}
                onChange={(e) => setEditStory(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Enter story title"
                required
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={editStory.description}
                onChange={(e) => setEditStory(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Enter story description"
              />
            </Form.Group>
            
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Goal</Form.Label>
                  <Form.Select
                    value={editStory.goalId}
                    onChange={(e) => setEditStory(prev => ({ ...prev, goalId: e.target.value }))}
                  >
                    <option value="">Select a goal</option>
                    {goals.map(goal => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title} ({goal.theme})
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select
                    value={editStory.priority}
                    onChange={(e) => setEditStory(prev => ({ ...prev, priority: parseInt(e.target.value) || 2 }))}
                  >
                    <option value={1}>P1 - High</option>
                    <option value={2}>P2 - Medium</option>
                    <option value={3}>P3 - Low</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              
              <Col md={3}>
                <Form.Group className="mb-3">
                  <Form.Label>Points</Form.Label>
                  <Form.Control
                    type="number"
                    min="1"
                    max="13"
                    value={editStory.points}
                    onChange={(e) => setEditStory(prev => ({ ...prev, points: parseInt(e.target.value) || 1 }))}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEditStory(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleUpdateStory}
            disabled={!editStory.title.trim()}
          >
            Update Story
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal show={!!showDeleteModal} onHide={() => setShowDeleteModal(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Are you sure you want to delete the story "{showDeleteModal?.title}"?</p>
          <p className="text-muted">This action cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(null)}>
            Cancel
          </Button>
          <Button 
            variant="danger" 
            onClick={() => showDeleteModal && handleDeleteStory(showDeleteModal)}
          >
            Delete Story
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default EnhancedKanbanPage;
