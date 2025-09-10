import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Badge, Button, Dropdown, Alert } from 'react-bootstrap';
import { Edit3, Trash2, ChevronDown, Target, Calendar, User, Hash, MessageCircle, Plus, Clock, ArrowRight } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Story, Goal } from '../types';
import { getThemeName, getStatusName } from '../utils/statusHelpers';
import { domainThemePrimaryVar, themeVars } from '../utils/themeVars';
import { displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { ChoiceMigration } from '../config/migration';
import { ChoiceHelper } from '../config/choices';

interface StoriesCardViewProps {
  stories: Story[];
  goals: Goal[];
  onStoryUpdate: (storyId: string, updates: any) => void;
  onStoryDelete: (storyId: string) => void;
  onStorySelect: (story: Story) => void;
  onEditStory: (story: Story) => void;
  selectedStoryId: string | null;
}

const StoriesCardView: React.FC<StoriesCardViewProps> = ({
  stories,
  goals,
  onStoryUpdate,
  onStoryDelete,
  onStorySelect,
  onEditStory,
  selectedStoryId
}) => {
  const { currentUser } = useAuth();
  const { showSidebar } = useSidebar();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [latestActivities, setLatestActivities] = useState<{ [storyId: string]: any }>({});

  // Theme colors mapping (matching Goals)
  const themeColors = {
    Health: domainThemePrimaryVar('Health'),
    Growth: domainThemePrimaryVar('Growth'),
    Wealth: domainThemePrimaryVar('Wealth'),
    Tribe: domainThemePrimaryVar('Tribe'),
    Home: domainThemePrimaryVar('Home')
  } as const;

  // Status colors for stories
  const statusColors = {
    Backlog: 'var(--muted)',
    Active: 'var(--green)',
    Done: 'var(--brand)'
  } as const;

  const getStoryStatusName = (status: number): string => {
    switch (status) {
      case 0: return 'Backlog';
      case 1: return 'Active';
      case 2: return 'Done';
      default: return 'Backlog';
    }
  };

  const getGoalForStory = (storyGoalId: string): Goal | undefined => {
    return goals.find(goal => goal.id === storyGoalId);
  };

  const getThemeColorForStory = (story: Story): string => {
    const parentGoal = getGoalForStory(story.goalId);
    if (parentGoal) {
      const themeName = getThemeName(parentGoal.theme);
    return themeColors[themeName as keyof typeof themeColors] || 'var(--muted)';
    }
  return 'var(--muted)';
  };

  const loadLatestActivityForStory = async (storyId: string) => {
    if (!currentUser) return;

    try {
      // Query latest activities directly from Firestore
      // Add ownerUid filter to satisfy Firestore rules and avoid permission-denied
      const q = query(
        collection(db, 'activity_stream'),
        where('ownerUid', '==', currentUser.uid),
        where('entityId', '==', storyId),
        where('entityType', '==', 'story'),
        orderBy('timestamp', 'desc'),
        limit(1)
      );

      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const latestActivity = querySnapshot.docs[0].data();
        setLatestActivities(prev => ({
          ...prev,
          [storyId]: latestActivity
        }));
      }
    } catch (error: any) {
      // Gracefully degrade on permission errors (rules may restrict activity_stream visibility)
      if (error?.code === 'permission-denied') {
        console.warn('activity_stream read blocked by rules for story', storyId);
        return;
      }
      console.error('Error loading latest activity for story:', storyId, error);
    }
  };

  useEffect(() => {
    // Load latest activity for each story
    stories.forEach(story => {
      loadLatestActivityForStory(story.id);
    });
  }, [stories, currentUser]);

  const handleViewActivityStream = (story: Story, event: React.MouseEvent) => {
    event.stopPropagation();
    console.log('📖 Opening story activity stream:', story.id);
    showSidebar(story, 'story');
  };

  const handleStatusChange = (storyId: string, newStatus: 'Backlog' | 'Active' | 'Done') => {
    const numericStatus = newStatus === 'Backlog' ? 0 : newStatus === 'Active' ? 1 : 2;
    onStoryUpdate(storyId, { status: numericStatus });
  };

  const handlePriorityChange = (storyId: string, newPriority: number) => {
    onStoryUpdate(storyId, { priority: newPriority });
  };

  const handleDeleteConfirm = (storyId: string) => {
    onStoryDelete(storyId);
    setShowDeleteModal(null);
  };

  return (
    <div style={{ padding: '20px' }}>
      <Row>
        {stories.map(story => {
          const parentGoal = getGoalForStory(story.goalId);
          const themeColor = getThemeColorForStory(story);
          
          return (
            <Col md={6} lg={4} key={story.id} className="mb-4">
              <Card 
                style={{ 
                  minHeight: '380px',
                  cursor: 'pointer',
                  border: selectedStoryId === story.id ? `2px solid ${themeColor}` : '1px solid var(--line)',
                  transition: 'all 0.2s ease-in-out',
                  transform: selectedStoryId === story.id ? 'translateY(-2px)' : 'translateY(0)',
                  boxShadow: selectedStoryId === story.id ? '0 8px 16px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.1)'
                }}
                onClick={() => { onStorySelect(story); try { showSidebar(story, 'story'); } catch {} }}
                onMouseEnter={(e) => {
                  if (selectedStoryId !== story.id) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 12px rgba(0,0,0,0.15)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedStoryId !== story.id) {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                  }
                }}
              >
                {/* Theme Bar */}
                <div 
                  style={{ 
                    height: '6px', 
                    backgroundColor: themeColor
                  }} 
                />

                <Card.Body style={{ padding: '20px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h5 style={{ 
                        margin: '0 0 4px 0', 
                        fontSize: '16px', 
                        fontWeight: '600',
                        lineHeight: '1.4',
                        wordBreak: 'break-word',
                        color: 'var(--text)'
                      }}>
                        {(() => {
                          const shortRef = (story as any).referenceNumber || story.ref;
                          const display = shortRef && validateRef(shortRef, 'story')
                            ? shortRef
                            : displayRefForEntity('story', story.id);
                          return display;
                        })()}
                      </h5>
                      <p style={{ 
                        margin: '0 0 8px 0', 
                        fontSize: '14px',
                        lineHeight: '1.4',
                        color: 'var(--text)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {story.title}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <Badge 
                          style={{ 
                            backgroundColor: statusColors[getStoryStatusName(story.status) as keyof typeof statusColors] || 'var(--muted)',
                            color: 'var(--on-accent)',
                            fontSize: '12px'
                          }}
                        >
                          {getStoryStatusName(story.status)}
                        </Badge>
                        <Badge 
                          style={{ 
                            backgroundColor: story.priority === 1 ? 'var(--red)' : story.priority === 2 ? 'var(--orange)' : 'var(--muted)',
                            color: 'var(--on-accent)',
                            fontSize: '12px'
                          }}
                        >
                          P{story.priority}
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
                        <Dropdown.Item 
                          onClick={() => onEditStory(story)}
                        >
                          <Edit3 size={14} className="me-2" />
                          Edit Story
                        </Dropdown.Item>
                        <Dropdown.Divider />
                        <Dropdown.Header>Change Status</Dropdown.Header>
                        <Dropdown.Item onClick={() => handleStatusChange(story.id, 'Backlog')}>
                          Backlog
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleStatusChange(story.id, 'Active')}>
                          Active
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleStatusChange(story.id, 'Done')}>
                          Done
                        </Dropdown.Item>
                        <Dropdown.Divider />
                        <Dropdown.Header>Change Priority</Dropdown.Header>
                        <Dropdown.Item onClick={() => handlePriorityChange(story.id, 1)}>
                          High Priority (1)
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handlePriorityChange(story.id, 2)}>
                          Medium Priority (2)
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handlePriorityChange(story.id, 3)}>
                          Low Priority (3)
                        </Dropdown.Item>
                        <Dropdown.Divider />
                        <Dropdown.Item 
                          className="text-danger"
                          onClick={() => setShowDeleteModal(story.id)}
                        >
                          <Trash2 size={14} className="me-2" />
                          Delete Story
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                  </div>

                  {/* Goal Link */}
                  {parentGoal && (
                    <div style={{ 
                      marginBottom: '16px',
                      padding: '10px',
                      backgroundColor: 'var(--card)',
                      border: `1px solid ${themeColor}`,
                      borderRadius: '6px'
                    }}>
                      <div style={{ 
                        fontSize: '11px', 
                        fontWeight: '600', 
                        color: themeColor, 
                        marginBottom: '4px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <Target size={10} />
                        LINKED GOAL
                      </div>
                      <div style={{ 
                        fontSize: '13px', 
                        color: 'var(--text)', 
                        fontWeight: '500',
                        lineHeight: '1.3'
                      }}>
                        {parentGoal.title}
                      </div>
                      <div style={{ 
                        fontSize: '11px', 
                        color: 'var(--muted)', 
                        marginTop: '2px'
                      }}>
                        {getThemeName(parentGoal.theme)} • {getStatusName(parentGoal.status)}
                      </div>
                    </div>
                  )}

                  {/* Latest Activity */}
                  {latestActivities[story.id] && (
                    <div style={{ 
                      marginBottom: '16px',
                      padding: '12px',
                      backgroundColor: 'rgba(var(--card-rgb), 0.1)',
                      border: `1px solid ${(() => { const g = getGoalForStory(story.goalId); const tn = g ? getThemeName(g.theme) : undefined; return (tn && themeColors[tn as keyof typeof themeColors]) || themeVars.border; })()}`,
                      borderRadius: '6px'
                    }}>
                      <div style={{ 
                        fontSize: '11px', 
                        fontWeight: '600', 
                        color: (() => { const g = getGoalForStory(story.goalId); const tn = g ? getThemeName(g.theme) : undefined; return (tn && themeColors[tn as keyof typeof themeColors]) || 'var(--brand)'; })(), 
                        marginBottom: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        {latestActivities[story.id].activityType === 'note_added' 
                          ? 'Latest Comment'
                          : latestActivities[story.id].activityType === 'status_changed'
                          ? 'Latest Status'
                          : latestActivities[story.id].activityType === 'updated'
                          ? 'Latest Update'
                          : 'Latest Activity'}
                      </div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'var(--text)', 
                        fontStyle: 'italic',
                        lineHeight: '1.4'
                      }}>
                        {latestActivities[story.id].activityType === 'note_added'
                          ? `"${latestActivities[story.id].noteContent}"`
                          : latestActivities[story.id].activityType === 'status_changed'
                          ? `Status changed to: ${getStoryStatusName(parseInt(latestActivities[story.id].newValue) || latestActivities[story.id].newValue)}`
                          : latestActivities[story.id].activityType === 'updated' && latestActivities[story.id].fieldName
                          ? `${latestActivities[story.id].fieldName} changed to: ${latestActivities[story.id].newValue}`
                          : latestActivities[story.id].activityType === 'created'
                          ? 'Story created'
                          : latestActivities[story.id].description || 'Activity logged'}
                      </div>
                      <div style={{ 
                        fontSize: '10px', 
                        color: 'var(--muted)', 
                        marginTop: '6px'
                      }}>
                        {ActivityStreamService.formatTimestamp(latestActivities[story.id].timestamp)}
                        {latestActivities[story.id].userEmail && ` • ${latestActivities[story.id].userEmail.split('@')[0]}`}
                      </div>
                    </div>
                  )}

                  {/* Story Details */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px', color: '#6b7280' }}>
                      <Hash size={14} style={{ marginRight: '8px' }} />
                      <span style={{ fontWeight: '500', marginRight: '8px' }}>Points:</span>
                      <span>{story.points}</span>
                    </div>
                    {story.description && (
                      <div style={{ 
                        fontSize: '13px',
                        color: '#6b7280',
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {story.description}
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    paddingTop: '16px',
                    borderTop: '1px solid var(--line)',
                    fontSize: '12px',
                    color: 'var(--muted)'
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Calendar size={12} style={{ marginRight: '4px' }} />
                        Created: {story.createdAt && (story.createdAt instanceof Date ? story.createdAt.toLocaleDateString() : new Date(story.createdAt).toLocaleDateString())}
                      </div>
                      {story.updatedAt && (
                        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--green)', fontWeight: '500' }}>
                          <Calendar size={12} style={{ marginRight: '4px' }} />
                          Updated: {story.updatedAt instanceof Date ? story.updatedAt.toLocaleDateString() : new Date(story.updatedAt).toLocaleDateString()} at {story.updatedAt instanceof Date ? story.updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(story.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewActivityStream(story, e);
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
                    </div>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
};

export default StoriesCardView;
