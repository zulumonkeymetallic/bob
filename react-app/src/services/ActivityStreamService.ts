import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  limit as fslimit
} from 'firebase/firestore';
import { db } from '../firebase';

export type ActivitySource = 'human' | 'function' | 'ai' | 'system';
export type ActivityType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'note_added'
  | 'status_changed'
  | 'sprint_changed'
  | 'priority_changed'
  | 'task_to_story_conversion'
  | 'story_status_from_reminder'
  | 'automation_event'
  | 'automation_alert'
  | 'automation_activity';

export interface ActivityEntry {
  id?: string;
  entityId: string;
  entityType: 'goal' | 'story' | 'task' | 'calendar_block';
  activityType: ActivityType;
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

  // Source tracking (Human, Function, AI)
  source: ActivitySource;
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
    source: ActivitySource = 'human'
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
    source: ActivitySource = 'human'
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
    source: ActivitySource = 'human'
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
    source: ActivitySource = 'human'
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
    source: ActivitySource = 'human'
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
    callback: (activities: ActivityEntry[]) => void,
    userId?: string
  ): () => void {
    if (!userId) {
      console.warn('ActivityStreamService.subscribeToActivityStream called without userId, skipping listener', { entityId });
      return () => { };
    }

    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', userId),
      where('entityId', '==', entityId),
      orderBy('timestamp', 'desc'),
      fslimit(50)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const raw = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
        // Filter out non-CRUD/noise events (viewed/clicked/imported/exported) and misclassified view notes
        const allowed = new Set([
          'created',
          'updated',
          'deleted',
          'note_added',
          'status_changed',
          'sprint_changed',
          'priority_changed',
          'task_to_story_conversion',
          'ai_priority_score',
          'ai_due_date_adjustment',
          'calendar_insertion',
          'calendar_reschedule',
          'automation_event',
          'automation_alert',
          'automation_activity'
        ]);
        const activities = raw.filter((a) => {
          const t = String(a.activityType || '').toLowerCase();
          if (!allowed.has(t)) return false;
          // Exclude any entries that are effectively view-only interactions
          const desc = String(a.description || '').toLowerCase();
          if (t === 'note_added' && (desc.startsWith('viewed ') || desc.startsWith('opened activity'))) return false;
          return true;
        }) as ActivityEntry[];
        // Safety: ensure newest first even if some timestamps resolve later
        const sorted = activities.sort((a, b) => {
          const ta = (a.timestamp as any)?.toMillis ? (a.timestamp as any).toMillis() : 0;
          const tb = (b.timestamp as any)?.toMillis ? (b.timestamp as any).toMillis() : 0;
          return tb - ta;
        });
        callback(sorted);
      },
      (error) => {
        // Gracefully degrade on permission issues instead of throwing
        console.warn('Activity stream subscribe error', error?.message || error);
        callback([]);
      }
    );
  }

  // Subscribe to activity stream entries that may use legacy fields (taskId/storyId/goalId)
  static subscribeToActivityStreamAny(
    entityId: string,
    entityType: 'task' | 'story' | 'goal',
    callback: (activities: ActivityEntry[]) => void,
    userId?: string,
    limit: number = 50
  ): () => void {
    if (!userId) {
      console.warn('ActivityStreamService.subscribeToActivityStreamAny called without userId, skipping listener', { entityId });
      return () => { };
    }

    const fields: string[] = ['entityId'];
    if (entityType === 'task') {
      fields.push('taskId');
    } else if (entityType === 'story') {
      fields.push('storyId');
    } else if (entityType === 'goal') {
      fields.push('goalId');
    }

    const unsubs: (() => void)[] = [];
    const state: Record<string, ActivityEntry> = {};
    const normalizeTimestamp = (val: any): Timestamp | undefined => {
      if (!val) return undefined;
      if ((val as any).toDate) return val as Timestamp;
      return undefined;
    };

    const emit = () => {
      const sorted = Object.values(state).sort((a, b) => {
        const ta = (a.timestamp as any)?.toMillis ? (a.timestamp as any).toMillis() : 0;
        const tb = (b.timestamp as any)?.toMillis ? (b.timestamp as any).toMillis() : 0;
        return tb - ta;
      });
      callback(sorted);
    };

    // activity_stream (primary) plus automation collections for richer context
    const sources: {
      name: string;
      fields: string[];
      orderField: string;
      defaultType: ActivityType;
      idPrefix?: string;
    }[] = [
      { name: 'activity_stream', fields, orderField: 'timestamp', defaultType: 'updated', idPrefix: 'activity_stream' },
      { name: 'activity_stream', fields, orderField: 'createdAt', defaultType: 'updated', idPrefix: 'activity_stream' },
      { name: 'automation_events', fields: ['entityId'], orderField: 'createdAt', defaultType: 'automation_event' },
      { name: 'automation_alerts', fields: ['entityId'], orderField: 'createdAt', defaultType: 'automation_alert' },
      { name: 'activity', fields: ['entityId'], orderField: 'createdAt', defaultType: 'automation_activity' }
    ];

    sources.forEach((source) => {
      source.fields.forEach((field) => {
        const q = query(
          collection(db, source.name),
          where('ownerUid', '==', userId),
          where(field, '==', entityId),
          orderBy(source.orderField, 'desc'),
          fslimit(limit)
        );
        const unsub = onSnapshot(
          q,
          (snapshot) => {
            snapshot.docs.forEach((doc) => {
              const data = doc.data() as any;
              const idPrefix = source.idPrefix ?? source.name;
              const id = `${idPrefix}:${doc.id}`;
              const activityType =
                (data.activityType as ActivityType) ||
                (data.type as ActivityType) ||
                source.defaultType;
              const timestamp =
                normalizeTimestamp(data[source.orderField]) ||
                normalizeTimestamp(data.timestamp) ||
                normalizeTimestamp(data.createdAt);
              let description =
                data.description ||
                data.message ||
                data.reason ||
                (data.action ? `Integration: ${data.action}${data.title ? ` · ${data.title}` : ''}` : '') ||
                `${activityType} via ${source.name}`;
              if (activityType === 'story_status_from_reminder') {
                const meta = data.metadata || {};
                const prev = meta.previousStatus ?? meta.previous_status ?? '';
                const next = meta.newStatus ?? meta.new_status ?? '';
                description = `Story status updated from reminder${prev !== '' || next !== '' ? ` (${prev} → ${next})` : ''}`;
              }
              state[id] = {
                id,
                entityId,
                entityType,
                activityType,
                userId: (data.userId as string) || userId,
                userEmail: data.userEmail,
                timestamp: timestamp || (serverTimestamp() as any),
                fieldName: data.fieldName,
                oldValue: data.oldValue,
                newValue: data.newValue,
                noteContent: data.noteContent,
                description,
                persona: data.persona,
                referenceNumber: data.referenceNumber,
                source: (data.source as ActivitySource) || 'system'
              };
            });
            emit();
          },
          (error) => {
            console.warn(`Activity stream subscribe error (${source.name})`, error?.message || error);
            emit();
          }
        );
        unsubs.push(unsub);
      });
    });

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }

  // Get activity stream for multiple entities (for dashboard views)
  static subscribeToUserActivityStream(
    userId: string,
    callback: (activities: ActivityEntry[]) => void,
    limit: number = 50
  ): () => void {
    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', userId),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      fslimit(limit)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const activities = snapshot.docs
          .map(doc => ({ id: doc.id, ...(doc.data() as any) })) as ActivityEntry[];
        callback(activities);
      },
      (error) => {
        console.warn('User activity stream subscribe error', error?.message || error);
        callback([]);
      }
    );
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
      case 'story_status_from_reminder': return '✅';
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
    source: ActivitySource = 'human'
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
