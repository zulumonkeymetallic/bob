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
  activityType: 'created' | 'updated' | 'deleted' | 'note_added' | 'status_changed' | 'sprint_changed' | 'priority_changed' | 'viewed' | 'clicked' | 'edited' | 'exported' | 'imported' | 'ai_generated' | 'ai_processed' | 'ai_enhanced';
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
  
  // AI vs Human tracking
  isAIGenerated?: boolean;
  aiModel?: string; // 'gpt-4', 'gpt-3.5-turbo', etc.
  aiPrompt?: string;
  aiConfidence?: number;
  humanReviewed?: boolean;
  
  // For UI interaction tracking
  clickType?: 'button' | 'link' | 'dropdown' | 'checkbox' | 'edit' | 'delete' | 'view' | 'drag' | 'drop';
  elementId?: string;
  elementClass?: string;
}

export class ActivityStreamService {
  private static lastActivityCache = new Map<string, number>();
  private static readonly DEBOUNCE_WINDOW = 2000; // 2 seconds
  
  // Activity payload validator to prevent undefined fields
  static validateActivityPayload(activity: any): any {
    const cleanPayload: any = {};
    
    // Required fields
    cleanPayload.entityId = activity.entityId;
    cleanPayload.entityType = activity.entityType;
    cleanPayload.activityType = activity.activityType;
    cleanPayload.userId = activity.userId;
    cleanPayload.description = activity.description;
    cleanPayload.ownerUid = activity.userId;
    
    // Handle ref/referenceNumber mapping
    if (activity.ref) {
      cleanPayload.ref = activity.ref;
      cleanPayload.referenceNumber = activity.ref; // Dual write during transition
    } else if (activity.referenceNumber) {
      cleanPayload.referenceNumber = activity.referenceNumber;
      cleanPayload.ref = activity.referenceNumber; // Reverse mapping
    } else {
      // Generate fallback reference
      const fallbackRef = `${activity.entityType.toUpperCase()}-${Date.now()}`;
      cleanPayload.ref = fallbackRef;
      cleanPayload.referenceNumber = fallbackRef;
    }
    
    // Optional fields - only include if defined and not null
    if (activity.userEmail !== undefined && activity.userEmail !== null) {
      cleanPayload.userEmail = activity.userEmail;
    }
    if (activity.persona !== undefined && activity.persona !== null) {
      cleanPayload.persona = activity.persona;
    }
    if (activity.entityTitle !== undefined && activity.entityTitle !== null) {
      cleanPayload.entityTitle = activity.entityTitle;
    }
    if (activity.fieldName !== undefined && activity.fieldName !== null) {
      cleanPayload.fieldName = activity.fieldName;
    }
    if (activity.oldValue !== undefined && activity.oldValue !== null) {
      cleanPayload.oldValue = activity.oldValue;
    }
    if (activity.newValue !== undefined && activity.newValue !== null) {
      cleanPayload.newValue = activity.newValue;
    }
    if (activity.noteContent !== undefined && activity.noteContent !== null) {
      cleanPayload.noteContent = activity.noteContent;
    }
    if (activity.uiComponent !== undefined && activity.uiComponent !== null) {
      cleanPayload.uiComponent = activity.uiComponent;
    }
    if (activity.clickType !== undefined && activity.clickType !== null) {
      cleanPayload.clickType = activity.clickType;
    }
    if (activity.elementId !== undefined && activity.elementId !== null) {
      cleanPayload.elementId = activity.elementId;
    }
    
    return cleanPayload;
  }
  
  // Debounce duplicate activities (same entity, type, user within window)
  static shouldSkipDuplicate(entityId: string, activityType: string, userId: string): boolean {
    const key = `${entityId}-${activityType}-${userId}`;
    const now = Date.now();
    const lastTime = this.lastActivityCache.get(key);
    
    if (lastTime && (now - lastTime) < this.DEBOUNCE_WINDOW) {
      return true; // Skip duplicate
    }
    
    this.lastActivityCache.set(key, now);
    return false;
  }

  // Add activity entry with validation and debouncing
  static async addActivity(activity: Omit<ActivityEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      // Skip duplicate activities within debounce window
      if (this.shouldSkipDuplicate(activity.entityId, activity.activityType, activity.userId)) {
        return;
      }
      
      // Validate and clean payload
      const cleanPayload = this.validateActivityPayload(activity);
      
      await addDoc(collection(db, 'activity_stream'), {
        ...cleanPayload,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      // Throttle error logging to prevent console flooding
      const errorKey = `activity-error-${error.message}`;
      const lastErrorTime = this.lastActivityCache.get(errorKey);
      const now = Date.now();
      
      if (!lastErrorTime || (now - lastErrorTime) > 5000) { // Log error max once per 5 seconds
        console.error('Error adding activity:', error);
        this.lastActivityCache.set(errorKey, now);
      }
      
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
    referenceNumber?: string,
    entityTitle?: string
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
      entityTitle,
      uiComponent: 'field-editor'
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
    
    // Prepare activity data, excluding undefined values
    const activityData: any = {
      entityId,
      entityType,
      activityType: 'status_changed',
      userId,
      userEmail,
      fieldName: 'status',
      oldValue: oldStatus,
      newValue: newStatus,
      description
    };

    // Only include optional fields if they're defined
    if (persona !== undefined && persona !== null) {
      activityData.persona = persona;
    }
    if (referenceNumber !== undefined && referenceNumber !== null) {
      activityData.referenceNumber = referenceNumber;
    }

    await this.addActivity(activityData);
  }

  // Log sprint change
  static async logSprintChange(
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    oldSprint: string,
    newSprint: string,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string
  ): Promise<void> {
    const description = `Sprint changed from "${oldSprint}" to "${newSprint}"`;
    
    // Prepare activity data, excluding undefined values
    const activityData: any = {
      entityId,
      entityType,
      activityType: 'sprint_changed',
      userId,
      userEmail,
      fieldName: 'sprint',
      oldValue: oldSprint,
      newValue: newSprint,
      description
    };

    // Only include optional fields if they're defined
    if (persona !== undefined && persona !== null) {
      activityData.persona = persona;
    }
    if (referenceNumber !== undefined && referenceNumber !== null) {
      activityData.referenceNumber = referenceNumber;
    }

    await this.addActivity(activityData);
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
    
    // Prepare activity data, excluding undefined values
    const activityData: any = {
      entityId,
      entityType,
      activityType: 'note_added',
      userId,
      userEmail,
      noteContent,
      description
    };

    // Only include optional fields if they're defined
    if (persona !== undefined && persona !== null) {
      activityData.persona = persona;
    }
    if (referenceNumber !== undefined && referenceNumber !== null) {
      activityData.referenceNumber = referenceNumber;
    }

    await this.addActivity(activityData);
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
    
    // Prepare activity data, excluding undefined values
    const activityData: any = {
      entityId,
      entityType,
      activityType: 'created',
      userId,
      userEmail,
      description
    };

    // Only include optional fields if they're defined
    if (persona !== undefined && persona !== null) {
      activityData.persona = persona;
    }
    if (referenceNumber !== undefined && referenceNumber !== null) {
      activityData.referenceNumber = referenceNumber;
    }

    await this.addActivity(activityData);
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
    
    console.log(`🎯 BOB v3.2.4 UI TRACKING: ${description}`, {
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
      userEmail: userEmail || undefined,
      description,
      clickType: elementType,
      elementId,
      uiComponent: elementId,
      userAgent: navigator.userAgent,
      sessionId,
      ...(additionalData || {})
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
    
    console.log(`📝 BOB v3.2.4 USER NOTE ADDED:`, {
      entityId,
      entityType,
      noteContent,
      userId,
      userEmail,
      referenceNumber,
      timestamp: new Date().toISOString()
    });

    // Prepare activity data, excluding undefined values
    const activityData: any = {
      entityId,
      entityType,
      activityType: 'note_added',
      userId,
      userEmail,
      noteContent,
      description
    };

    // Only include referenceNumber if it's defined
    if (referenceNumber !== undefined && referenceNumber !== null) {
      activityData.referenceNumber = referenceNumber;
    }

    await this.addActivity(activityData);
  }

  // Enhanced format activity icon for meaningful activities only
  static formatActivityIconEnhanced(activityType: string): string {
    switch (activityType) {
      case 'created': return '🆕';
      case 'updated': return '✏️';
      case 'deleted': return '🗑️';
      case 'note_added': return '📝';
      case 'status_changed': return '🔄';
      case 'sprint_changed': return '🏃';
      case 'priority_changed': return '⚡';
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

    console.log(`🔄 BOB v3.2.4 ACTIVITY STREAM: Subscribing to ${entityType} ${entityId}`, {
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
      
      console.log(`✅ BOB v3.2.4 ACTIVITY STREAM: Received ${activities.length} activities for ${entityType} ${entityId}`);
      callback(activities);
    }, (error) => {
      console.error('❌ BOB v3.2.4 ACTIVITY STREAM ERROR:', error, {
        entityId,
        entityType,
        userId,
        timestamp: new Date().toISOString()
      });
    });
  }

  // Track AI-generated or AI-processed activities
  static async trackAIActivity(
    entityId: string,
    entityType: ActivityEntry['entityType'],
    activityType: 'ai_generated' | 'ai_processed' | 'ai_enhanced',
    userId: string,
    description: string,
    options: {
      userEmail?: string;
      persona?: string;
      referenceNumber?: string;
      entityTitle?: string;
      aiModel?: string;
      aiPrompt?: string;
      aiConfidence?: number;
      humanReviewed?: boolean;
      fieldName?: string;
      oldValue?: any;
      newValue?: any;
    } = {}
  ): Promise<void> {
    const {
      userEmail,
      persona,
      referenceNumber,
      entityTitle,
      aiModel,
      aiPrompt,
      aiConfidence,
      humanReviewed,
      fieldName,
      oldValue,
      newValue
    } = options;

    const activityData: Omit<ActivityEntry, 'id' | 'timestamp'> = {
      entityId,
      entityType,
      activityType,
      userId,
      description,
      isAIGenerated: true,
      aiModel: aiModel || 'gpt-4',
      aiPrompt,
      aiConfidence,
      humanReviewed: humanReviewed || false
    };

    // Only include optional fields if they're defined
    if (userEmail !== undefined && userEmail !== null) {
      activityData.userEmail = userEmail;
    }
    if (persona !== undefined && persona !== null) {
      activityData.persona = persona;
    }
    if (referenceNumber !== undefined && referenceNumber !== null) {
      activityData.referenceNumber = referenceNumber;
    }
    if (entityTitle !== undefined && entityTitle !== null) {
      activityData.entityTitle = entityTitle;
    }
    if (fieldName !== undefined && fieldName !== null) {
      activityData.fieldName = fieldName;
    }
    if (oldValue !== undefined && oldValue !== null) {
      activityData.oldValue = oldValue;
    }
    if (newValue !== undefined && newValue !== null) {
      activityData.newValue = newValue;
    }

    await this.addActivity(activityData);
  }

  // Mark AI activity as human-reviewed
  static async markAIActivityReviewed(
    entityId: string,
    userId: string,
    description: string = 'AI activity reviewed by human'
  ): Promise<void> {
    await this.addActivity({
      entityId,
      entityType: 'goal', // This could be made dynamic
      activityType: 'updated',
      userId,
      description,
      isAIGenerated: false,
      humanReviewed: true
    });
  }

  // Get AI vs Human activity analytics
  static async getAIHumanAnalytics(
    userId: string,
    dateRange?: { start: Date; end: Date }
  ): Promise<{
    totalActivities: number;
    aiGenerated: number;
    humanGenerated: number;
    aiPercentage: number;
    humanPercentage: number;
    aiModelBreakdown: Record<string, number>;
    activityTypeBreakdown: Record<string, { ai: number; human: number }>;
  }> {
    // This would need to be implemented with proper Firestore querying
    // For now, return mock data structure
    console.log('🤖 AI/Human Analytics requested for user:', userId, dateRange);
    
    return {
      totalActivities: 0,
      aiGenerated: 0,
      humanGenerated: 0,
      aiPercentage: 0,
      humanPercentage: 0,
      aiModelBreakdown: {},
      activityTypeBreakdown: {}
    };
  }
}
