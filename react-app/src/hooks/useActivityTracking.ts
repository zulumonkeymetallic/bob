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
 * 🎯 BOB v3.2.4 Global Activity Tracking Hook
 * 
 * Use this hook in any component to automatically track user interactions
 * and maintain a comprehensive audit trail.
 * 
 * @example
 * const { trackClick, trackView, addNote } = useActivityTracking();
 * 
 * <Button onClick={() => trackClick({
 *   elementId: 'edit-goal-btn',
 *   elementType: 'button',
 *   entityId: goal.id,
 *   entityType: 'goal',
 *   entityTitle: goal.title
 * })}>
 *   Edit Goal
 * </Button>
 */
export const useActivityTracking = () => {
  const { currentUser } = useAuth();

  const trackClick = async (options: TrackingOptions) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.2.4: Cannot track click - user not authenticated');
      return;
    }

    try {
      await ActivityStreamService.logUIClick(
        options.elementId,
        options.elementType,
        options.entityId,
        options.entityType,
        currentUser.uid,
        currentUser.email,
        options.additionalData
      );
    } catch (error) {
      console.error('❌ BOB v3.2.4: Failed to track click:', error, options);
    }
  };

  const trackView = async (
    entityId: string,
    entityType: TrackingOptions['entityType'],
    entityTitle: string,
    referenceNumber?: string,
    additionalData?: any
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.2.4: Cannot track view - user not authenticated');
      return;
    }

    try {
      await ActivityStreamService.logRecordView(
        entityId,
        entityType,
        entityTitle,
        currentUser.uid,
        currentUser.email,
        referenceNumber
      );
    } catch (error) {
      console.error('❌ BOB v3.2.4: Failed to track view:', error, { entityId, entityType, entityTitle });
    }
  };

  const addNote = async (
    entityId: string,
    entityType: TrackingOptions['entityType'],
    noteContent: string,
    referenceNumber?: string
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.2.4: Cannot add note - user not authenticated');
      return;
    }

    try {
      await ActivityStreamService.addUserNote(
        entityId,
        entityType,
        noteContent,
        currentUser.uid,
        currentUser.email,
        referenceNumber
      );
    } catch (error) {
      console.error('❌ BOB v3.2.4: Failed to add note:', error, { entityId, entityType, noteContent });
    }
  };

  const trackFieldChange = async (
    entityId: string,
    entityType: 'goal' | 'story' | 'task', // Restricted to what ActivityStreamService supports
    fieldName: string,
    oldValue: any,
    newValue: any,
    entityTitle?: string,
    referenceNumber?: string
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.2.4: Cannot track field change - user not authenticated');
      return;
    }

    try {
      await ActivityStreamService.logFieldChange(
        entityId,
        entityType,
        fieldName,
        oldValue,
        newValue,
        currentUser.uid,
        currentUser.email,
        'personal', // persona
        referenceNumber
      );
    } catch (error) {
      console.error('❌ BOB v3.2.4: Failed to track field change:', error, { 
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
    entityType: TrackingOptions['entityType'],
    callback: (activities: any[]) => void
  ) => {
    if (!currentUser) {
      console.warn('🚫 BOB v3.2.4: Cannot subscribe to activity - user not authenticated');
      return () => {};
    }

    return ActivityStreamService.subscribeToGlobalActivityStream(
      entityId,
      entityType,
      currentUser.uid,
      callback
    );
  };

  return {
    trackClick,
    trackView,
    addNote,
    trackFieldChange,
    subscribeToActivity,
    isAuthenticated: !!currentUser
  };
};

export default useActivityTracking;
