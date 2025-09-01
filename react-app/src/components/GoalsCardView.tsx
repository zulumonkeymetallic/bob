import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Badge, Button, Dropdown, Modal } from 'react-bootstrap';
import { Edit3, Trash2, ChevronDown, Target, Calendar, User, Hash, MessageCircle, ChevronUp, Plus } from 'lucide-react';
import { Goal, Story } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, deleteDoc, doc, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import ModernStoriesTable from './ModernStoriesTable';
import { ChoiceMigration } from '../config/migration';
import { ChoiceHelper } from '../config/choices';
import { getThemeName, getStatusName } from '../utils/statusHelpers';
import { ActivityStreamService } from '../services/ActivityStreamService';

interface GoalsCardViewProps {
  goals: Goal[];
  onGoalUpdate: (goalId: string, updates: Partial<Goal>) => void;
  onGoalDelete: (goalId: string) => void;
  onGoalPriorityChange: (goalId: string, newPriority: number) => void;
}

const GoalsCardView: React.FC<GoalsCardViewProps> = ({
  goals,
  onGoalUpdate,
  onGoalDelete,
  onGoalPriorityChange
}) => {
  const { showSidebar } = useSidebar();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [goalStories, setGoalStories] = useState<{ [goalId: string]: Story[] }>({});
  const [latestActivities, setLatestActivities] = useState<{ [goalId: string]: any }>({});

  // Theme colors mapping
  const themeColors = {
    'Health': '#ef4444',
    'Growth': '#8b5cf6', 
    'Wealth': '#059669',
    'Tribe': '#f59e0b',
    'Home': '#3b82f6'
  };

  // Status colors
  const statusColors = {
    'New': '#6b7280',
    'Work in Progress': '#059669',
    'Complete': '#2563eb',
    'Blocked': '#ef4444',
    'Deferred': '#f59e0b'
  };

  const handleGoalClick = (goal: Goal, event: React.MouseEvent) => {
    // Don't expand if clicking on dropdown or other interactive elements
    if ((event.target as HTMLElement).closest('.dropdown') || 
        (event.target as HTMLElement).closest('button')) {
      return;
    }
    
    console.log('🎯 Toggling goal expansion:', goal.id);
    if (expandedGoalId === goal.id) {
      setExpandedGoalId(null);
    } else {
      setExpandedGoalId(goal.id);
      loadStoriesForGoal(goal.id);
    }
  };

  
  const loadLatestActivityForGoal = async (goalId: string) => {
    if (!currentUser) return;
    
    try {
      // Query latest activities directly from Firestore
      const q = query(
        collection(db, 'activity_stream'),
        where('entityId', '==', goalId),
        where('ownerUid', '==', currentUser.uid),
        orderBy('timestamp', 'desc'),
        limit(5)
      );
      
      const snapshot = await getDocs(q);
      const activities = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as any[];
      
      const latestStatusChange = activities.find(activity => activity.activityType === 'status_changed');
      const latestComment = activities.find(activity => activity.activityType === 'note_added' && activity.noteContent);
      const latestActivity = latestStatusChange || latestComment;
      
      if (latestActivity) {
        setLatestActivities(prev => ({
          ...prev,
          [goalId]: latestActivity
        }));
      }
    } catch (error) {
      console.error('Error loading latest activity for goal:', goalId, error);
    }
  };

  const loadStoriesForGoal = async (goalId: string) => {
    if (!currentUser || goalStories[goalId]) return; // Don't reload if already loaded
    
    console.log('📚 Loading stories for goal:', goalId);
    
    const storiesQuery = query(
      collection(db, 'stories'),
      where('goalId', '==', goalId),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('orderIndex', 'asc')
    );
    
    onSnapshot(storiesQuery, (snapshot) => {
      const stories = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      
      console.log(`📚 Loaded ${stories.length} stories for goal ${goalId}`);
      setGoalStories(prev => ({
        ...prev,
        [goalId]: stories
      }));
    });
  };

  // Story CRUD operations
  const handleStoryAdd = (goalId: string) => async (storyData: Omit<Story, 'id' | 'ref' | 'createdAt' | 'updatedAt'>) => {
    if (!currentUser) return;
    
    try {
      // Generate next reference number
      const existingStories = goalStories[goalId] || [];
      const existingRefs = existingStories.map(s => parseInt(s.ref.replace('ST', '')) || 0);
      const nextRef = existingRefs.length > 0 ? Math.max(...existingRefs) + 1 : 1;
      
      const newStory = {
        ...storyData,
        ref: `ST${nextRef.toString().padStart(3, '0')}`,
        ownerUid: currentUser.uid,
        persona: 'personal' as const,
        goalId: goalId,
        createdAt: new Date(),
        updatedAt: new Date(),
        orderIndex: (goalStories[goalId]?.length || 0) + 1,
      };
      
      await addDoc(collection(db, 'stories'), newStory);
      console.log('✅ Story added successfully');
    } catch (error) {
      console.error('❌ Error adding story:', error);
    }
  };

  const handleStoryUpdate = async (storyId: string, updates: Partial<Story>) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        ...updates,
        updatedAt: new Date()
      });
      console.log('✅ Story updated successfully');
    } catch (error) {
      console.error('❌ Error updating story:', error);
    }
  };

  const handleStoryDelete = async (storyId: string) => {
    try {
      await deleteDoc(doc(db, 'stories', storyId));
      console.log('✅ Story deleted successfully');
    } catch (error) {
      console.error('❌ Error deleting story:', error);
    }
  };

  // Load latest activities when goals change
  useEffect(() => {
    if (currentUser && goals.length > 0) {
      goals.forEach(goal => {
        loadLatestActivityForGoal(goal.id);
      });
    }
  }, [currentUser, goals]);

  const handleStoryPriorityChange = async (storyId: string, newPriority: number) => {
    try {
      // Convert number back to priority string format
      const priorityMap = { 1: 'P1', 2: 'P2', 3: 'P3' } as const;
      const priorityString = priorityMap[newPriority as keyof typeof priorityMap] || 'P3';
      
      await updateDoc(doc(db, 'stories', storyId), {
        priority: priorityString,
        updatedAt: new Date()
      });
      console.log('✅ Story priority updated successfully');
    } catch (error) {
      console.error('❌ Error updating story priority:', error);
    }
  };

  const handleViewActivityStream = (goal: Goal, event: React.MouseEvent) => {
    event.stopPropagation();
    console.log('🎯 Opening goal activity stream:', goal.id);
    showSidebar(goal, 'goal');
  };

  const handleStatusChange = (goalId: string, newStatus: 'New' | 'Work in Progress' | 'Complete' | 'Blocked' | 'Deferred') => {
    const numericStatus = ChoiceMigration.migrateGoalStatus(newStatus);
    onGoalUpdate(goalId, { status: numericStatus });
  };

  const handlePriorityChange = (goalId: string, newPriority: number) => {
    onGoalPriorityChange(goalId, newPriority);
  };

  const handleDeleteConfirm = (goalId: string) => {
    onGoalDelete(goalId);
    setShowDeleteModal(null);
  };

  if (goals.length === 0) {
    return (
      <div style={{ 
        textAlign: 'center', 
        padding: '60px 20px',
        color: '#6b7280'
      }}>
        <Target size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <h4>No Goals Found</h4>
        <p>Start by creating your first goal to track your progress.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <Row className="g-4">
        {goals.map((goal) => (
          <Col key={goal.id} xl={4} lg={6} md={6} sm={12}>
            <Card 
              style={{ 
                height: '100%',
                border: 'none',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                cursor: 'pointer'
              }}
              className="h-100"
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 12px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
              }}
              onClick={(e) => handleGoalClick(goal, e)}
            >
              {/* Theme Bar */}
              <div 
                style={{ 
                  height: '6px', 
                  backgroundColor: themeColors[getThemeName(goal.theme) as keyof typeof themeColors] || '#6b7280'
                }} 
              />

              <Card.Body style={{ padding: '20px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5 style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '18px', 
                      fontWeight: '600',
                      lineHeight: '1.4',
                      wordBreak: 'break-word'
                    }}>
                      {goal.title}
                    </h5>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Badge 
                        style={{ 
                          backgroundColor: themeColors[getThemeName(goal.theme) as keyof typeof themeColors] || '#6b7280',
                          color: 'white',
                          fontSize: '12px'
                        }}
                      >
                        {getThemeName(goal.theme)}
                      </Badge>
                      <Badge 
                        style={{ 
                          backgroundColor: statusColors[getStatusName(goal.status) as keyof typeof statusColors] || '#6b7280',
                          color: 'white',
                          fontSize: '12px'
                        }}
                      >
                        {getStatusName(goal.status)}
                      </Badge>
                    </div>
                  </div>
                  
                  <Dropdown onClick={(e) => e.stopPropagation()}>
                    <Dropdown.Toggle 
                      variant="outline-secondary" 
                      size="sm"
                      style={{ border: 'none', padding: '4px 8px' }}
                    >
                      <ChevronDown size={16} />
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Header>Change Status</Dropdown.Header>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'New')}>
                        New
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Work in Progress')}>
                        Work in Progress
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Complete')}>
                        Complete
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Blocked')}>
                        Blocked (Pending Story)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handleStatusChange(goal.id, 'Deferred')}>
                        Deferred
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Header>Change Priority</Dropdown.Header>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 1)}>
                        High Priority (1)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 2)}>
                        Medium Priority (2)
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => handlePriorityChange(goal.id, 3)}>
                        Low Priority (3)
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Item 
                        className="text-danger"
                        onClick={() => setShowDeleteModal(goal.id)}
                      >
                        <Trash2 size={14} className="me-2" />
                        Delete Goal
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </div>

                {/* Description */}
                {goal.description && (
                  <p style={{ 
                    margin: '0 0 16px 0', 
                    color: '#6b7280', 
                    fontSize: '14px',
                    lineHeight: '1.5',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {goal.description}
                  </p>
                )}

                {/* Latest Status/Comment */}
                {latestActivities[goal.id] && (
                  <div style={{ 
                    marginBottom: '16px',
                    padding: '12px',
                    backgroundColor: '#f0f9ff',
                    border: '1px solid #0ea5e9',
                    borderRadius: '6px'
                  }}>
                    <div style={{ 
                      fontSize: '11px', 
                      fontWeight: '600', 
                      color: '#0ea5e9', 
                      marginBottom: '6px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {latestActivities[goal.id].activityType === 'status_changed' 
                        ? 'Latest Status' 
                        : 'Latest Comment'}
                    </div>
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#374151', 
                      fontStyle: 'italic',
                      lineHeight: '1.4'
                    }}>
                      {latestActivities[goal.id].activityType === 'status_changed'
                        ? `Status changed to: ${ChoiceHelper.getLabel('goal', 'status', parseInt(latestActivities[goal.id].newValue) || latestActivities[goal.id].newValue)}`
                        : `"${latestActivities[goal.id].noteContent}"`}
                    </div>
                    <div style={{ 
                      fontSize: '10px', 
                      color: '#6b7280', 
                      marginTop: '6px'
                    }}>
                      {ActivityStreamService.formatTimestamp(latestActivities[goal.id].timestamp)}
                      {latestActivities[goal.id].userEmail && ` • ${latestActivities[goal.id].userEmail.split('@')[0]}`}
                    </div>
                  </div>
                )}

                {/* Goal Details */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px', color: '#6b7280' }}>
                    <Target size={14} style={{ marginRight: '8px' }} />
                    <span style={{ fontWeight: '500', marginRight: '8px' }}>Size:</span>
                    <span>{goal.size}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px', color: '#6b7280' }}>
                    <Hash size={14} style={{ marginRight: '8px' }} />
                    <span style={{ fontWeight: '500', marginRight: '8px' }}>Priority:</span>
                    <span>{goal.priority}</span>
                  </div>
                  {goal.confidence && (
                    <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color: '#6b7280' }}>
                      <User size={14} style={{ marginRight: '8px' }} />
                      <span style={{ fontWeight: '500', marginRight: '8px' }}>Confidence:</span>
                      <span>{goal.confidence}/10</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  paddingTop: '16px',
                  borderTop: '1px solid #e5e7eb',
                  fontSize: '12px',
                  color: '#9ca3af'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Calendar size={12} style={{ marginRight: '4px' }} />
                    {goal.createdAt && new Date(goal.createdAt.toDate()).toLocaleDateString()}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewActivityStream(goal, e);
                      }}
                      style={{ 
                        fontSize: '12px',
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <MessageCircle size={12} />
                      Activity
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedGoalId(expandedGoalId === goal.id ? null : goal.id);
                        if (expandedGoalId !== goal.id) loadStoriesForGoal(goal.id);
                      }}
                      style={{ 
                        fontSize: '12px',
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {expandedGoalId === goal.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      Stories ({goalStories[goal.id]?.length || 0})
                    </Button>
                  </div>
                </div>
              </Card.Body>
            </Card>

            {/* Expanded Stories Section */}
            {expandedGoalId === goal.id && (
              <Card style={{ 
                marginTop: '8px',
                border: 'none',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                borderLeft: `4px solid ${themeColors[getThemeName(goal.theme) as keyof typeof themeColors] || '#6b7280'}`
              }}>
                <Card.Header style={{ 
                  backgroundColor: '#f9fafb', 
                  borderBottom: '1px solid #e5e7eb', 
                  padding: '12px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <h6 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                    Stories for "{goal.title}"
                  </h6>
                  <Button
                    size="sm"
                    variant="primary"
                    style={{ 
                      fontSize: '12px',
                      padding: '4px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plus size={12} />
                    Add Story
                  </Button>
                </Card.Header>
                <Card.Body style={{ padding: 0 }}>
                  {goalStories[goal.id] && goalStories[goal.id].length > 0 ? (
                    <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                      <ModernStoriesTable
                        stories={goalStories[goal.id]}
                        goals={[goal]}
                        onStoryUpdate={handleStoryUpdate}
                        onStoryDelete={handleStoryDelete}
                        onStoryPriorityChange={handleStoryPriorityChange}
                        onStoryAdd={handleStoryAdd(goal.id)}
                        goalId={goal.id}
                      />
                    </div>
                  ) : (
                    <div style={{ 
                      textAlign: 'center', 
                      padding: '40px 20px',
                      color: '#6b7280'
                    }}>
                      <Target size={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
                      <p style={{ margin: 0, fontSize: '14px' }}>
                        No stories yet for this goal
                      </p>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', opacity: 0.7 }}>
                        Break down your goal into actionable stories
                      </p>
                    </div>
                  )}
                </Card.Body>
              </Card>
            )}
          </Col>
        ))}
      </Row>

      {/* Delete Confirmation Modal */}
      <Modal show={!!showDeleteModal} onHide={() => setShowDeleteModal(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete Goal</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete this goal? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(null)}>
            Cancel
          </Button>
          <Button 
            variant="danger" 
            onClick={() => showDeleteModal && handleDeleteConfirm(showDeleteModal)}
          >
            Delete Goal
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default GoalsCardView;
