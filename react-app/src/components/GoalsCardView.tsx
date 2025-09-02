import React, { useState, useEffect } from 'react';
import { Goal } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import EditGoalModal from './EditGoalModal';
import { db } from '../firebase';
import { collection, query, where, orderBy, limit, getDocs, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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
  const [showEditModal, setShowEditModal] = useState<Goal | null>(null);
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
    'Work in Progress': '#3b82f6',
    'Complete': '#059669',
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
      const activities = snapshot.docs.map(doc => {
        const data = doc.data();
        // Convert Firestore timestamps to plain Date objects to avoid serialization issues
        return {
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt
        };
      }) as any[];
      
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
          // Query calendar blocks for this goal this week
          // NOTE: This query requires a Firebase composite index
          // For now, we'll use a simpler query and filter in memory
          const blocksQuery = query(
            collection(db, 'calendar_blocks'),
            where('goalId', '==', goal.id),
            where('ownerUid', '==', currentUser.uid)
          );

          const blocksSnapshot = await getDocs(blocksQuery);
          let totalMinutes = 0;

          // Filter blocks for this week in memory to avoid index requirement
          blocksSnapshot.docs.forEach(blockDoc => {
            const block = blockDoc.data();
            if (block.start && block.end) {
              const start = block.start.toDate ? block.start.toDate() : new Date(block.start);
              const end = block.end.toDate ? block.end.toDate() : new Date(block.end);
              
              // Check if this block is within the current week
              if (start >= weekStart && start < weekEnd) {
                totalMinutes += Math.round((end.getTime() - start.getTime()) / (1000 * 60));
              }
            }
          });

          allocations[goal.id] = totalMinutes;
        }

        setGoalTimeAllocations(allocations);
      } catch (error) {
        console.error('Error fetching time allocations:', error);
      }
    };

    fetchTimeAllocations();
  }, [currentUser, goals]);

  const handleScheduleGoal = async (goal: Goal) => {
    if (!currentUser) return;

    try {
      setIsSchedulingGoal(goal.id);
      setCalendarSyncStatus(prev => ({
        ...prev,
        [goal.id]: 'scheduling'
      }));

      // Create a calendar event for the goal
      const eventData = {
        title: `🎯 ${goal.title}`,
        description: goal.description || '',
        goalId: goal.id,
        persona: currentPersona || 'personal',
      };

      console.log('Creating calendar event:', eventData);
      
      // Update status to show scheduled
      setCalendarSyncStatus(prev => ({
        ...prev,
        [goal.id]: 'scheduled'
      }));

      // Add calendar block record
      await addDoc(collection(db, 'calendar_blocks'), {
        goalId: goal.id,
        ownerUid: currentUser.uid,
        title: eventData.title,
        description: eventData.description,
        createdAt: new Date(),
        updatedAt: new Date(),
        persona: currentPersona || 'personal'
      });
      
      setCalendarSyncStatus(prev => ({
        ...prev,
        [goal.id]: 'success'
      }));
      
      setIsSchedulingGoal(null);
      
      // Clear status after 3 seconds
      setTimeout(() => {
        setCalendarSyncStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[goal.id];
          return newStatus;
        });
      }, 3000);
    } catch (error) {
      console.error('Error scheduling goal:', error);
      setCalendarSyncStatus(prev => ({
        ...prev,
        [goal.id]: 'error'
      }));
      setIsSchedulingGoal(null);
      
      // Clear error status after 5 seconds
      setTimeout(() => {
        setCalendarSyncStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[goal.id];
          return newStatus;
        });
      }, 5000);
    }
  };

  const handleViewActivityStream = (goal: Goal, event: React.MouseEvent) => {
    event.stopPropagation();
    console.log('🎯 Opening goal activity stream:', goal.id);
    showSidebar(goal, 'goal');
  };

  const handleStatusChange = (goalId: string, newStatus: 'New' | 'Work in Progress' | 'Complete' | 'Blocked' | 'Deferred') => {
    // Convert string status to numeric
    const statusMap = {
      'New': 1,
      'Work in Progress': 2,
      'Complete': 3,
      'Blocked': 4,
      'Deferred': 5
    };
    const numericStatus = statusMap[newStatus];
    onGoalUpdate(goalId, { status: numericStatus });
  };

  const handlePriorityChange = (goalId: string, newPriority: number) => {
    onGoalPriorityChange(goalId, newPriority);
  };

  const handleDelete = (goalId: string) => {
    if (window.confirm('Are you sure you want to delete this goal?')) {
      onGoalDelete(goalId);
    }
  };

  if (goals.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg mb-4">No goals found</p>
        <p className="text-gray-400">Create your first goal to get started!</p>
      </div>
    );
  }

  const getThemeName = (themeValue: number): string => {
    const themeMap: { [key: number]: string } = {
      1: 'Health',
      2: 'Growth', 
      3: 'Wealth',
      4: 'Tribe',
      5: 'Home'
    };
    return themeMap[themeValue] || 'Home';
  };

  const getStatusName = (statusValue: number): string => {
    const statusMap: { [key: number]: string } = {
      1: 'New',
      2: 'Work in Progress',
      3: 'Complete',
      4: 'Blocked',
      5: 'Deferred'
    };
    return statusMap[statusValue] || 'New';
  };

  const getPriorityDisplay = (priority: number): string => {
    const priorityMap: { [key: number]: string } = {
      1: 'P1',
      2: 'P2', 
      3: 'P3'
    };
    return priorityMap[priority] || 'P3';
  };

  const formatTimeAllocation = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  const formatActivityTimestamp = (timestamp: any): string => {
    if (!timestamp) return '';
    
    let date: Date;
    
    try {
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        // Firestore Timestamp
        date = timestamp.toDate();
      } else if (timestamp instanceof Date) {
        // Regular Date object
        date = timestamp;
      } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
        // String or number timestamp
        date = new Date(timestamp);
      } else {
        // Fallback
        return '';
      }
      
      // Validate the date
      if (isNaN(date.getTime())) {
        return '';
      }
      
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      if (diffMins < 60) {
        return `${diffMins}m ago`;
      } else if (diffHours < 24) {
        return `${diffHours}h ago`;
      } else {
        return `${diffDays}d ago`;
      }
    } catch (error) {
      console.warn('Error formatting timestamp:', error);
      return '';
    }
  };

  return (
    <div className={`transition-all duration-300 ${showSidebar ? 'mr-96' : ''}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {goals.map((goal) => (
          <div
            key={goal.id}
            className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden transition-all duration-200 hover:shadow-md"
            style={{ 
              cursor: 'default',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 8px 12px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
            }}
          >
            {/* Theme Bar */}
            <div 
              style={{ 
                height: '6px', 
                backgroundColor: themeColors[getThemeName(goal.theme) as keyof typeof themeColors] || '#6b7280'
              }} 
            />
            
            {/* Card Content */}
            <div className="p-6">
              {/* Header with Title and Actions */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900 truncate mb-2">
                    {goal.title}
                  </h3>
                  <div className="flex items-center gap-2 mb-3">
                    <span 
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                      style={{ 
                        backgroundColor: `${statusColors[getStatusName(goal.status) as keyof typeof statusColors]}20`,
                        color: statusColors[getStatusName(goal.status) as keyof typeof statusColors]
                      }}
                    >
                      {getStatusName(goal.status)}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {getPriorityDisplay(goal.priority)}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {getThemeName(goal.theme)}
                    </span>
                  </div>
                </div>
                
                {/* Actions Dropdown */}
                <div className="dropdown dropdown-end">
                  <label tabIndex={0} className="btn btn-ghost btn-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
                    </svg>
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                    <li><a onClick={(e) => handleViewActivityStream(goal, e)}>View Activity Stream</a></li>
                    <li><a onClick={() => handleScheduleGoal(goal)}>Schedule Goal</a></li>
                    <li><a onClick={() => setShowEditModal(goal)}>Edit Goal</a></li>
                    <li><a onClick={() => handleDelete(goal.id)} className="text-red-600">Delete Goal</a></li>
                  </ul>
                </div>
              </div>

              {/* Description */}
              {goal.description && (
                <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                  {goal.description}
                </p>
              )}

              {/* Time Allocation */}
              {goalTimeAllocations[goal.id] > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>This week: {formatTimeAllocation(goalTimeAllocations[goal.id])}</span>
                  </div>
                </div>
              )}

              {/* Calendar Sync Status */}
              {calendarSyncStatus[goal.id] && (
                <div className="mb-4">
                  <div className={`text-sm px-3 py-2 rounded-md ${
                    calendarSyncStatus[goal.id] === 'success' ? 'bg-green-100 text-green-800' :
                    calendarSyncStatus[goal.id] === 'error' ? 'bg-red-100 text-red-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {calendarSyncStatus[goal.id] === 'scheduling' && 'Creating calendar event...'}
                    {calendarSyncStatus[goal.id] === 'scheduled' && 'Adding to calendar...'}
                    {calendarSyncStatus[goal.id] === 'success' && '✅ Successfully scheduled!'}
                    {calendarSyncStatus[goal.id] === 'error' && '❌ Failed to schedule. Please try again.'}
                  </div>
                </div>
              )}

              {/* Latest Activity */}
              {latestActivities[goal.id] && (
                <div className="border-t pt-4">
                  <div className="text-xs text-gray-500 mb-2">Latest Activity</div>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-700">
                        {latestActivities[goal.id].activityType === 'note_added' && latestActivities[goal.id].noteContent && (
                          <span>💬 {latestActivities[goal.id].noteContent}</span>
                        )}
                        {latestActivities[goal.id].activityType === 'status_changed' && (
                          <span>📊 Status changed to {latestActivities[goal.id].newValue}</span>
                        )}
                        {latestActivities[goal.id].activityType === 'updated' && latestActivities[goal.id].fieldName && (
                          <span>✏️ Updated {latestActivities[goal.id].fieldName}</span>
                        )}
                        {latestActivities[goal.id].activityType === 'created' && (
                          <span>🎯 Goal created</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {formatActivityTimestamp(latestActivities[goal.id].timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      <EditGoalModal
        goal={showEditModal}
        show={!!showEditModal}
        onClose={() => setShowEditModal(null)}
        currentUserId={currentUser?.uid || ''}
      />
    </div>
  );
};

export default GoalsCardView;
