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
  entityType: 'goal' | 'story' | 'task' | 'calendar_block';
  activityType: 'created' | 'updated' | 'deleted' | 'note_added' | 'status_changed' | 'sprint_changed' | 'priority_changed';
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
  
  // Metadata
  persona?: string;
  referenceNumber?: string;
  linkUrl?: string;
  
  // Source tracking (Human, Function, AI)
  source: 'human' | 'function' | 'ai';
  sourceDetails?: string;
}

export class ActivityStreamService {
  // Add activity entry
  static async addActivity(activity: Omit<ActivityEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      // Remove undefined values to satisfy Firestore constraints
      const cleaned: any = {};
      Object.entries(activity as Record<string, any>).forEach(([k, v]) => {
        if (v !== undefined) cleaned[k] = v;
      });
      await addDoc(collection(db, 'activity_stream'), {
        ...cleaned,
        // Firestore rules require ownerUid for create; match to userId
        ownerUid: activity.userId,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error adding activity:', error);
      throw error;
    }
  }

  // Log field changes with source tracking
  static async logFieldChange(
    entityId: string,
    entityType: 'goal' | 'story' | 'task' | 'calendar_block',
    userId: string,
    userEmail: string,
    fieldName: string,
    oldValue: any,
    newValue: any,
    persona: string,
    referenceNumber: string,
    source: 'human' | 'function' | 'ai' = 'human'
  ): Promise<void> {
    const description = `Updated ${fieldName} from "${oldValue}" to "${newValue}"`;
    
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
      source
    });
  }

    // Log status change
  static async logStatusChange(
    entityId: string,
    entityType: 'goal' | 'story' | 'task',
    userId: string,
    userEmail: string,
    oldStatus: string,
    newStatus: string,
    persona: string,
    referenceNumber: string,
    source: 'human' | 'function' | 'ai' = 'human'
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
      source
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
    referenceNumber?: string,
    source: 'human' | 'function' | 'ai' = 'human'
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
      source
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
    referenceNumber?: string,
    source: 'human' | 'function' | 'ai' = 'human'
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
      source
    });
  }

  // Log creation
  static async logCreation(
    entityId: string,
    entityType: 'goal' | 'story' | 'task' | 'calendar_block',
    entityTitle: string,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string,
    source: 'human' | 'function' | 'ai' = 'human'
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
      source
    });
  }

  // Get activity stream for entity
  static subscribeToActivityStream(
    entityId: string,
    callback: (activities: ActivityEntry[]) => void
  ): () => void {
    const q = query(
      collection(db, 'activity_stream'),
      where('entityId', '==', entityId),
      orderBy('timestamp', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      const raw = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      // Filter out non-CRUD/noise events (viewed/clicked/imported/exported) and misclassified view notes
      const allowed = new Set(['created','updated','deleted','note_added','status_changed','sprint_changed','priority_changed']);
      const activities = raw.filter((a) => {
        const t = String(a.activityType || '').toLowerCase();
        if (!allowed.has(t)) return false;
        // Exclude any entries that are effectively view-only interactions
        const desc = String(a.description || '').toLowerCase();
        if (t === 'note_added' && (desc.startsWith('viewed ') || desc.startsWith('opened activity'))) return false;
        return true;
      }) as ActivityEntry[];
      // Safety: ensure newest first even if some timestamps resolve later
      const sorted = activities.sort((a,b) => {
        const ta = (a.timestamp as any)?.toMillis ? (a.timestamp as any).toMillis() : 0;
        const tb = (b.timestamp as any)?.toMillis ? (b.timestamp as any).toMillis() : 0;
        return tb - ta;
      });
      callback(sorted);
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
      where('userId', '==', userId),
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

  // Convenience: log deletion event
  static async logDeletion(
    entityId: string,
    entityType: ActivityEntry['entityType'],
    entityTitle: string,
    userId: string,
    userEmail?: string,
    persona?: string,
    referenceNumber?: string,
    source: 'human' | 'function' | 'ai' = 'human'
  ) {
    await this.addActivity({
      entityId,
      entityType,
      activityType: 'deleted',
      userId,
      userEmail,
      description: `Deleted ${entityType}: ${entityTitle}`,
      persona,
      referenceNumber,
      source
    });
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
}
