import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Badge, Button, Dropdown, Modal, Alert } from 'react-bootstrap';
import { Edit3, Trash2, ChevronDown, Target, Calendar, User, Hash, MessageCircle, ChevronUp, Plus, Clock, CalendarPlus } from 'lucide-react';
import { Goal, Story } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, deleteDoc, doc, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import EditGoalModal from './EditGoalModal';
import AddStoryModal from './AddStoryModal';
import { ChoiceMigration } from '../config/migration';
import { ChoiceHelper } from '../config/choices';
import { getThemeName, getStatusName } from '../utils/statusHelpers';
import { ActivityStreamService } from '../services/ActivityStreamService';

interface GoalsCardViewProps {
  goals: Goal[];
  onGoalUpdate: (goalId: string, updates: Partial<Goal>) => void;
  onGoalDelete: (goalId: string) => void;
  onGoalPriorityChange: (goalId: string, newPriority: number) => void;
  onGoalSelect?: (goalId: string) => void; // New prop for goal selection
  selectedGoalId?: string | null; // New prop for highlighting selected goal
}

const GoalsCardView: React.FC<GoalsCardViewProps> = ({
  goals,
  onGoalUpdate,
  onGoalDelete,
  onGoalPriorityChange,
  onGoalSelect,
  selectedGoalId
}) => {
  const { showSidebar } = useSidebar();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState<Goal | null>(null);
  const [showAddStoryModal, setShowAddStoryModal] = useState<string | null>(null); // Store goalId
  const [latestActivities, setLatestActivities] = useState<{ [goalId: string]: any }>({});
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<{ [goalId: string]: string }>({});
  const [isSchedulingGoal, setIsSchedulingGoal] = useState<string | null>(null);
  const [goalTimeAllocations, setGoalTimeAllocations] = useState<{ [goalId: string]: number }>({});

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

  
  const loadLatestActivityForGoal = async (goalId: string) => {
    if (!currentUser) return;
    
    try {
      // Query latest activities directly from Firestore
      const q = query(
        collection(db, 'activity_stream'),
        where('entityId', '==', goalId),
        where('ownerUid', '==', currentUser.uid),
        orderBy('timestamp', 'desc'),
        limit(10)
      );
      
      const snapshot = await getDocs(q);
      const activities = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as any[];
      
      // Filter out UI activities that aren't meaningful
      const meaningfulActivities = activities.filter(activity => 
        !['clicked', 'viewed', 'exported', 'imported'].includes(activity.activityType)
      );
      
      // Get the most recent meaningful activity (comment, status change, or field update)
      const latestActivity = meaningfulActivities.find(activity => 
        (activity.activityType === 'note_added' && activity.noteContent) ||
        activity.activityType === 'status_changed' ||
        (activity.activityType === 'updated' && activity.fieldName) ||
        activity.activityType === 'created'
      );
      
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

  // Load latest activities when goals change
  useEffect(() => {
    if (currentUser && goals.length > 0) {
      goals.forEach(goal => {
        loadLatestActivityForGoal(goal.id);
      });
    }
  }, [currentUser, goals]);

  // Fetch time allocations for goals from calendar blocks
  useEffect(() => {
    if (!currentUser || !goals.length) return;

    const fetchTimeAllocations = async () => {
      try {
        const now = new Date();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        const allocations: { [goalId: string]: number } = {};

        for (const goal of goals) {
          // Query calendar blocks for this goal - simplified to avoid complex index
          const blocksQuery = query(
            collection(db, 'calendar_blocks'),
            where('ownerUid', '==', currentUser.uid),
            where('goalId', '==', goal.id)
          );

          const blocksSnapshot = await getDocs(blocksQuery);
          let totalMinutes = 0;

          // Filter by date range in JavaScript to avoid complex Firestore index
          blocksSnapshot.docs.forEach(doc => {
            const block = doc.data();
            if (block.start && block.end) {
              const blockStart = block.start;
              if (blockStart >= weekStart.getTime() && blockStart <= weekEnd.getTime()) {
                totalMinutes += (block.end - block.start) / (1000 * 60);
              }
            }
          });

          allocations[goal.id] = totalMinutes;
        }

        setGoalTimeAllocations(allocations);
      } catch (error) {
        console.error('Failed to fetch time allocations:', error);
      }
    };

    fetchTimeAllocations();
  }, [currentUser, goals]);

  // Schedule time for a specific goal
  const scheduleGoalTime = async (goal: Goal) => {
    if (!currentUser) return;

    let aiCallId: string | undefined;
    const startTime = Date.now();

    try {
      setIsSchedulingGoal(goal.id);
      setCalendarSyncStatus(prev => ({ 
        ...prev, 
        [goal.id]: '🤖 AI is analyzing and scheduling time for this goal...' 
      }));

      // 🤖 Log AI call initiation
      const parameters = {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        persona: currentPersona || 'personal',
        focusGoalId: goal.id,
        goalTimeRequest: goal.timeToMasterHours ? Math.min(goal.timeToMasterHours * 60, 300) : 120
      };

      aiCallId = await ActivityStreamService.logAICallInitiated(
        goal.id,
        'goal',
        'planCalendar',
        parameters,
        currentUser.uid,
        currentUser.email || undefined,
        `Scheduling time blocks for goal: ${goal.title}`
      );

      // Call the calendar planning function with goal focus
      const planCalendar = httpsCallable(functions, 'planCalendar');
      const result = await planCalendar(parameters);

      const planResult = result.data as any;
      const executionTime = Date.now() - startTime;

      // 🤖 Log AI call completion
      await ActivityStreamService.logAICallCompleted(
        aiCallId,
        goal.id,
        'goal',
        'planCalendar',
        planResult,
        currentUser.uid,
        currentUser.email || undefined,
        executionTime
      );
      
      if (planResult.blocksCreated > 0) {
        setCalendarSyncStatus(prev => ({ 
          ...prev, 
          [goal.id]: `✅ Scheduled ${planResult.blocksCreated} time blocks for "${goal.title}"` 
        }));

        // 📅 Log calendar scheduling result
        await ActivityStreamService.logCalendarSchedulingResult(
          goal.id,
          'goal',
          {
            blocksCreated: planResult.blocksCreated,
            timeRequested: goal.timeToMasterHours ? Math.min(goal.timeToMasterHours * 60, 300) : 120,
            schedulingType: 'goal_focus',
            dateRange: `${new Date().toISOString().split('T')[0]} to ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}`
          },
          currentUser.uid,
          currentUser.email || undefined,
          aiCallId
        );

        // Log individual calendar blocks if available
        if (planResult.blocks && Array.isArray(planResult.blocks)) {
          for (const block of planResult.blocks) {
            await ActivityStreamService.logCalendarBlockCreated(
              goal.id,
              'goal',
              {
                startTime: block.startTime,
                endTime: block.endTime,
                title: block.title || `${goal.title} - Work Session`,
                description: block.description || `Scheduled time for goal: ${goal.title}`,
                isAiGenerated: true
              },
              currentUser.uid,
              currentUser.email || undefined,
              aiCallId
            );
          }
        }
      } else {
        setCalendarSyncStatus(prev => ({ 
          ...prev, 
          [goal.id]: '⚠️ No available time slots found for scheduling' 
        }));
      }
    } catch (error) {
      console.error('Failed to schedule goal time:', error);
      const executionTime = Date.now() - startTime;
      
      // 🤖 Log AI call failure
      if (aiCallId) {
        await ActivityStreamService.logAICallFailed(
          aiCallId,
          goal.id,
          'goal',
          'planCalendar',
          error,
          currentUser.uid,
          currentUser.email || undefined,
          executionTime
        );
      }

      setCalendarSyncStatus(prev => ({ 
        ...prev, 
        [goal.id]: '❌ Failed to schedule time: ' + (error as Error).message 
      }));
    } finally {
      setIsSchedulingGoal(null);
      // Clear status after 5 seconds
      setTimeout(() => {
        setCalendarSyncStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[goal.id];
          return newStatus;
        });
      }, 5000);
    }
  };

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
                border: selectedGoalId === goal.id ? '3px solid #3b82f6' : 'none',
                boxShadow: selectedGoalId === goal.id 
                  ? '0 8px 20px rgba(59, 130, 246, 0.3)' 
                  : '0 4px 6px rgba(0,0,0,0.1)',
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                backgroundColor: selectedGoalId === goal.id ? '#f8faff' : '#fff'
              }}
              className="h-100"
              onClick={() => onGoalSelect?.(goal.id)}
              onMouseEnter={(e) => {
                if (selectedGoalId !== goal.id) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 12px rgba(0,0,0,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedGoalId !== goal.id) {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                }
              }}
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
                      <Dropdown.Item 
                        onClick={() => setShowEditModal(goal)}
                      >
                        <Edit3 size={14} className="me-2" />
                        Edit Goal
                      </Dropdown.Item>
                      <Dropdown.Item 
                        onClick={() => setShowAddStoryModal(goal.id)}
                      >
                        <Plus size={14} className="me-2" />
                        Add Story
                      </Dropdown.Item>
                      <Dropdown.Item 
                        onClick={() => scheduleGoalTime(goal)}
                        disabled={isSchedulingGoal === goal.id}
                      >
                        <CalendarPlus size={14} className="me-2" />
                        {isSchedulingGoal === goal.id ? 'Scheduling...' : 'Schedule Time Blocks'}
                      </Dropdown.Item>
                      <Dropdown.Divider />
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
                      {latestActivities[goal.id].activityType === 'note_added' 
                        ? 'Latest Comment'
                        : latestActivities[goal.id].activityType === 'status_changed'
                        ? 'Latest Status'
                        : latestActivities[goal.id].activityType === 'updated'
                        ? 'Latest Update'
                        : 'Latest Activity'}
                    </div>
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#374151', 
                      fontStyle: 'italic',
                      lineHeight: '1.4'
                    }}>
                      {latestActivities[goal.id].activityType === 'note_added'
                        ? `"${latestActivities[goal.id].noteContent}"`
                        : latestActivities[goal.id].activityType === 'status_changed'
                        ? `Status changed to: ${ChoiceHelper.getLabel('goal', 'status', parseInt(latestActivities[goal.id].newValue) || latestActivities[goal.id].newValue)}`
                        : latestActivities[goal.id].activityType === 'updated' && latestActivities[goal.id].fieldName
                        ? `${latestActivities[goal.id].fieldName} changed to: ${latestActivities[goal.id].newValue}`
                        : latestActivities[goal.id].activityType === 'created'
                        ? 'Goal created'
                        : latestActivities[goal.id].description || 'Activity logged'}
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
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px', color: '#6b7280' }}>
                      <User size={14} style={{ marginRight: '8px' }} />
                      <span style={{ fontWeight: '500', marginRight: '8px' }}>Confidence:</span>
                      <span>{goal.confidence}/10</span>
                    </div>
                  )}
                  {goalTimeAllocations[goal.id] !== undefined && (
                    <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color: '#059669' }}>
                      <Clock size={14} style={{ marginRight: '8px' }} />
                      <span style={{ fontWeight: '500', marginRight: '8px' }}>This Week:</span>
                      <span>{Math.round(goalTimeAllocations[goal.id])} minutes allocated</span>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <Calendar size={12} style={{ marginRight: '4px' }} />
                      Created: {goal.createdAt && (() => {
                        try {
                          return new Date(goal.createdAt.toDate()).toLocaleDateString();
                        } catch (error) {
                          return 'Unknown';
                        }
                      })()}
                    </div>
                    {goal.updatedAt && goal.updatedAt.toDate && (
                      <div style={{ display: 'flex', alignItems: 'center', color: '#059669', fontWeight: '500' }}>
                        <Calendar size={12} style={{ marginRight: '4px' }} />
                        Updated: {(() => {
                          try {
                            const date = new Date(goal.updatedAt.toDate());
                            return `${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                          } catch (error) {
                            return 'Unknown';
                          }
                        })()}
                      </div>
                    )}
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
                  </div>
                </div>
              </Card.Body>
            </Card>

            {/* Calendar Sync Status */}
            {calendarSyncStatus[goal.id] && (
              <Alert 
                variant={calendarSyncStatus[goal.id].startsWith('✅') ? 'success' : 
                        calendarSyncStatus[goal.id].startsWith('❌') ? 'danger' : 
                        calendarSyncStatus[goal.id].startsWith('⚠️') ? 'warning' : 'info'}
                style={{ 
                  marginTop: '8px',
                  fontSize: '12px',
                  padding: '8px 12px',
                  marginBottom: 0
                }}
                dismissible
                onClose={() => setCalendarSyncStatus(prev => {
                  const newStatus = { ...prev };
                  delete newStatus[goal.id];
                  return newStatus;
                })}
              >
                {calendarSyncStatus[goal.id]}
              </Alert>
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

      {/* Edit Goal Modal */}
      <EditGoalModal
        goal={showEditModal}
        show={!!showEditModal}
        onClose={() => setShowEditModal(null)}
        currentUserId={currentUser?.uid || ''}
      />

      {/* Add Story Modal */}
      <AddStoryModal
        show={!!showAddStoryModal}
        onClose={() => setShowAddStoryModal(null)}
        goalId={showAddStoryModal || undefined}
      />
    </div>
  );
};

export default GoalsCardView;
