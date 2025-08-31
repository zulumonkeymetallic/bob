import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../firebase';

export interface ActivityEntry {
  id?: string;
  entityId: string;
  entityType: 'goal' | 'story' | 'task' | 'sprint' | 'calendar_block' | 'digest' | 'habit' | 'personal_list' | 'okr' | 'resource' | 'trip' | 'work_project';
  activityType: 'created' | 'updated' | 'deleted' | 'note_added' | 'status_changed' | 'sprint_changed' | 'priority_changed' | 'viewed' | 'clicked' | 'edited' | 'exported' | 'imported';
  userId: string;
  userEmail?: string;
  timestamp: Timestamp;
  
  // For field changes
  fieldName?: string;
  oldValue?: any;
  newValue?: any;
  
  // For notes
  noteContent?: string;
  
  // General description
  description: string;
  
  // Enhanced metadata
  persona?: string;
  referenceNumber?: string;
  entityTitle?: string;
  uiComponent?: string;
  userAgent?: string;
  sessionId?: string;
  
  // For UI interaction tracking
  clickType?: 'button' | 'link' | 'dropdown' | 'checkbox' | 'edit' | 'delete' | 'view' | 'drag' | 'drop';
  elementId?: string;
  elementClass?: string;
}

export class ActivityStreamService {
  // Add activity entry
  static async addActivity(activity: Omit<ActivityEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      await addDoc(collection(db, 'activity_stream'), {
        ...activity,
        ownerUid: activity.userId, // Add ownerUid for Firestore security rules
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error adding activity:', error);
      throw error;
    }
  }

  // Log field change
  static async logFieldChange(
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    fieldName: string,
    oldValue: any,
    newValue: any,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `Changed ${fieldName} from "${oldValue}" to "${newValue}"`;
    
    await this.addActivity({
      entityId,
      entityType,
      activityType: 'updated',
      userId,
      userEmail,
      fieldName,
      oldValue,
      newValue,
      description,
      persona,
      referenceNumber,
    });
  }

  // Log status change
  static async logStatusChange(
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    oldStatus: string,
    newStatus: string,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `Status changed from "${oldStatus}" to "${newStatus}"`;
    
    await this.addActivity({
      entityId,
      entityType,
      activityType: 'status_changed',
      userId,
      userEmail,
      fieldName: 'status',
      oldValue: oldStatus,
      newValue: newStatus,
      description,
      persona,
      referenceNumber,
    });
  }

  // Log sprint change
  static async logSprintChange(
    entityId: string,
    entityType: 'story' | 'task',
    oldSprint: string,
    newSprint: string,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `Sprint changed from "${oldSprint}" to "${newSprint}"`;
    
    await this.addActivity({
      entityId,
      entityType,
      activityType: 'sprint_changed',
      userId,
      userEmail,
      fieldName: 'sprint',
      oldValue: oldSprint,
      newValue: newSprint,
      description,
      persona,
      referenceNumber,
    });
  }

  // Add note
  static async addNote(
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    noteContent: string,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `Added note: ${noteContent.substring(0, 100)}${noteContent.length > 100 ? '...' : ''}`;
    
    await this.addActivity({
      entityId,
      entityType,
      activityType: 'note_added',
      userId,
      userEmail,
      noteContent,
      description,
      persona,
      referenceNumber,
    });
  }

  // Log creation
  static async logCreation(
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    entityTitle: string,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `Created ${entityType}: ${entityTitle}`;
    
    await this.addActivity({
      entityId,
      entityType,
      activityType: 'created',
      userId,
      userEmail,
      description,
      persona,
      referenceNumber,
    });
  }

  // Get activity stream for entity
  static subscribeToActivityStream(
    entityId: string,
    userId: string,
    callback: (activities: ActivityEntry[]) => void
  ): () => void {
    const q = query(
      collection(db, 'activity_stream'),
      where('entityId', '==', entityId),
      where('ownerUid', '==', userId),
      orderBy('timestamp', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      const activities = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityEntry[];
      
      callback(activities);
    }, (error) => {
      console.error('ActivityStreamService: Error in subscribeToActivityStream:', error);
    });
  }

  // Get activity stream for multiple entities (for dashboard views)
  static subscribeToUserActivityStream(
    userId: string,
    callback: (activities: ActivityEntry[]) => void,
    limit: number = 50
  ): () => void {
    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', userId), // Use ownerUid instead of userId for security rules
      orderBy('timestamp', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      const activities = snapshot.docs
        .slice(0, limit)
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ActivityEntry[];
      
      callback(activities);
    }, (error) => {
      console.error('ActivityStreamService: Error in subscribeToUserActivityStream:', error);
    });
  }

  // Utility to format activity description with icons
  static formatActivityIcon(activityType: string): string {
    switch (activityType) {
      case 'created': return '🆕';
      case 'updated': return '✏️';
      case 'deleted': return '🗑️';
      case 'note_added': return '📝';
      case 'status_changed': return '🔄';
      case 'sprint_changed': return '🏃';
      case 'priority_changed': return '⚡';
      default: return '📋';
    }
  }

  // Utility to format timestamp
  static formatTimestamp(timestamp: Timestamp): string {
    if (!timestamp) return 'Unknown time';
    
    const date = timestamp.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }

  // 🎯 GLOBAL UI TRACKING METHODS FOR v3.1.0
  
  // Generate unique session ID for tracking
  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Log UI element clicks with comprehensive metadata
  static async logUIClick(
    elementId: string,
    elementType: 'button' | 'link' | 'dropdown' | 'checkbox' | 'edit' | 'delete' | 'view' | 'drag' | 'drop',
    entityId: string,
    entityType: ActivityEntry['entityType'],
    userId: string,
    userEmail?: string,
    additionalData?: any
  ): Promise<void> {
    const sessionId = sessionStorage.getItem('bobSessionId') || this.generateSessionId();
    sessionStorage.setItem('bobSessionId', sessionId);

    const description = `🖱️ UI Click: ${elementType} on ${entityType} (${elementId})`;
    
    console.log(`🎯 BOB v3.1.0 UI TRACKING: ${description}`, {
      elementId,
      elementType, 
      entityId,
      entityType,
      userId,
      userEmail,
      timestamp: new Date().toISOString(),
      sessionId,
      userAgent: navigator.userAgent,
      url: window.location.href,
      additionalData
    });

    await this.addActivity({
      entityId,
      entityType,
      activityType: 'clicked',
      userId,
      userEmail,
      description,
      clickType: elementType,
      elementId,
      uiComponent: elementId,
      userAgent: navigator.userAgent,
      sessionId,
      ...additionalData
    });
  }

  // Add user notes to any entity
  static async addUserNote(
    entityId: string,
    entityType: ActivityEntry['entityType'],
    noteContent: string,
    userId: string,
    userEmail?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `📝 User Note: ${noteContent.substring(0, 100)}${noteContent.length > 100 ? '...' : ''}`;
    
    console.log(`📝 BOB v3.1.0 USER NOTE ADDED:`, {
      entityId,
      entityType,
      noteContent,
      userId,
      userEmail,
      referenceNumber,
      timestamp: new Date().toISOString()
    });

    await this.addActivity({
      entityId,
      entityType,
      activityType: 'note_added',
      userId,
      userEmail,
      noteContent,
      description,
      referenceNumber
    });
  }

  // Log record views for audit trail
  static async logRecordView(
    entityId: string,
    entityType: ActivityEntry['entityType'],
    entityTitle: string,
    userId: string,
    userEmail?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `👁️ Viewed ${entityType}: ${entityTitle}`;
    
    console.log(`👁️ BOB v3.1.0 RECORD VIEW:`, {
      entityId,
      entityType,
      entityTitle,
      userId,
      userEmail,
      referenceNumber,
      timestamp: new Date().toISOString(),
      url: window.location.href
    });

    await this.addActivity({
      entityId,
      entityType,
      activityType: 'viewed',
      userId,
      userEmail,
      description,
      entityTitle,
      referenceNumber
    });
  }

  // Enhanced format activity icon for new activity types
  static formatActivityIconEnhanced(activityType: string): string {
    switch (activityType) {
      case 'created': return '🆕';
      case 'updated': return '✏️';
      case 'deleted': return '🗑️';
      case 'note_added': return '📝';
      case 'status_changed': return '🔄';
      case 'sprint_changed': return '🏃';
      case 'priority_changed': return '⚡';
      case 'viewed': return '👁️';
      case 'clicked': return '🖱️';
      case 'edited': return '✏️';
      case 'exported': return '📤';
      case 'imported': return '📥';
      default: return '📋';
    }
  }

  // Get comprehensive activity stream for any entity type
  static subscribeToGlobalActivityStream(
    entityId: string,
    entityType: ActivityEntry['entityType'],
    userId: string,
    callback: (activities: ActivityEntry[]) => void
  ): () => void {
    const q = query(
      collection(db, 'activity_stream'),
      where('entityId', '==', entityId),
      where('ownerUid', '==', userId),
      orderBy('timestamp', 'desc')
    );

    console.log(`🔄 BOB v3.1.0 ACTIVITY STREAM: Subscribing to ${entityType} ${entityId}`, {
      entityId,
      entityType,
      userId,
      timestamp: new Date().toISOString()
    });

    return onSnapshot(q, (snapshot) => {
      const activities = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActivityEntry[];
      
      console.log(`✅ BOB v3.1.0 ACTIVITY STREAM: Received ${activities.length} activities for ${entityType} ${entityId}`);
      callback(activities);
    }, (error) => {
      console.error('❌ BOB v3.1.0 ACTIVITY STREAM ERROR:', error, {
        entityId,
        entityType,
        userId,
        timestamp: new Date().toISOString()
      });
    });
  }
}
