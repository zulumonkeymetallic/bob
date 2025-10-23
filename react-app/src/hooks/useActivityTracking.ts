import { useAuth } from '../contexts/AuthContext';
import { ActivityStreamService } from '../services/ActivityStreamService';

export interface TrackingOptions {
  elementId: string;
  elementType: 'button' | 'link' | 'dropdown' | 'checkbox' | 'edit' | 'delete' | 'view' | 'drag' | 'drop';
  entityId: string;
  entityType: 'goal' | 'story' | 'task' | 'sprint' | 'calendar_block' | 'digest' | 'habit' | 'personal_list' | 'okr' | 'resource' | 'trip' | 'work_project';
  entityTitle?: string;
  additionalData?: any;
}

/**
 * 🎯 BOB v3.8.0 CRUD-Only Activity Tracking Hook
 * 
 * FOCUSED on meaningful business operations - no UI click noise.
 * Only tracks CREATE, READ, UPDATE, DELETE operations.
 * 
 * @example
 * const { trackCRUD, addNote, trackFieldChange } = useActivityTracking();
 * 
 * // Only track meaningful operations:
 * trackCRUD('create', goal.id, 'goal', 'Created new goal');
 * trackCRUD('update', story.id, 'story', 'Updated status');
 * trackCRUD('delete', task.id, 'task', 'Deleted task');
 */
export const useActivityTracking = () => {
  const { currentUser } = useAuth();

  // Track only meaningful CRUD operations - no UI clicks
  const trackCRUD = async (
    operation: 'create' | 'update' | 'delete',
    entityId: string,
    entityType: 'goal' | 'story' | 'task' | 'calendar_block',
    description: string,
    additionalData?: any
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.8.0: Cannot track CRUD - user not authenticated');
      return;
    }

    try {
      const activityType = operation === 'create' ? 'created' : 
                          operation === 'update' ? 'updated' :
                          'deleted';

      await ActivityStreamService.addActivity({
        entityId,
        entityType,
        activityType,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        description,
        persona: additionalData?.persona || 'Primary',
        referenceNumber: additionalData?.referenceNumber || entityId,
        source: 'human'
      });

      console.log(`✅ BOB v3.8.0: Tracked ${operation} for ${entityType} ${entityId}`);
    } catch (error) {
      console.error('❌ BOB v3.8.0: Failed to track CRUD operation:', error);
    }
  };

  const addNote = async (
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    noteContent: string,
    referenceNumber?: string
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.8.0: Cannot add note - user not authenticated');
      return;
    }

    try {
      await ActivityStreamService.addNote(
        entityId,
        entityType,
        noteContent,
        currentUser.uid,
        currentUser.email,
        'personal', // default persona
        referenceNumber
      );
    } catch (error) {
      console.error('❌ BOB v3.8.0: Failed to add note:', error, { entityId, entityType, noteContent });
    }
  };

  const trackFieldChange = async (
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    fieldName: string,
    oldValue: any,
    newValue: any,
    referenceNumber?: string
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.8.0: Cannot track field change - user not authenticated');
      return;
    }

    try {
      await ActivityStreamService.logFieldChange(
        entityId,
        entityType,
        currentUser.uid,
        currentUser.email,
        fieldName,
        oldValue,
        newValue,
        'personal', // persona
        referenceNumber || entityId
      );
    } catch (error) {
      console.error('❌ BOB v3.8.0: Failed to track field change:', error, { 
        entityId, 
        entityType, 
        fieldName, 
        oldValue, 
        newValue 
      });
    }
  };

  const subscribeToActivity = (
    entityId: string,
    callback: (activities: any[]) => void
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.8.0: Cannot subscribe to activity - user not authenticated');
      return () => {};
    }

    return ActivityStreamService.subscribeToActivityStream(
      entityId,
      callback,
      currentUser.uid
    );
  };

  // 🖱️ Click tracking for debugging (console logs only - NOT saved to activity stream)
  const trackClick = (options: TrackingOptions) => {
    console.log('🖱️ UI Click (Debug Only):', {
      timestamp: new Date().toISOString(),
      elementId: options.elementId,
      elementType: options.elementType,
      entityId: options.entityId,
      entityType: options.entityType,
      entityTitle: options.entityTitle,
      additionalData: options.additionalData,
      user: currentUser?.email || 'anonymous',
      note: 'This is for debugging only - NOT saved to activity stream'
    });
    // Note: This is intentionally NOT saving to ActivityStreamService
    // We only want CRUD operations in the activity stream
  };

  return {
    trackCRUD,
    trackClick, // Added for debugging console logs
    addNote,
    trackFieldChange,
    subscribeToActivity
  };
};
