// Scheduling-related types for chores, blocks and plan assignments

export interface Chore {
  id: string;
  title: string;
  description?: string;
  // RFC 5545 RRULE, e.g. "FREQ=DAILY;INTERVAL=1". Optional DTSTART may be stored separately
  rrule: string;
  dtstart?: number; // epoch millis for start of recurrence window
  estimatedMinutes: number; // default duration estimate for scheduling
  priority: number; // 1=High,2=Medium,3=Low
  themeId?: string; // normalized theme reference (optional while migrating)
  theme?: number; // legacy numeric theme until migration complete
  tags?: string[];
  nextDueAt?: number; // epoch millis for next due occurrence
  ownerUid: string;
  createdAt: any;
  updatedAt: any;
}

export interface Block {
  id: string;
  title?: string;
  start: number; // epoch millis
  end: number;   // epoch millis
  persona: 'personal' | 'work';
  themeId?: string;
  ownerUid: string;
  createdAt: any;
  updatedAt: any;
}

export interface PlanAssignment {
  id: string; // deterministic ID for idempotency
  planId: string; // yyyymmdd-userId
  dayKey: string; // yyyymmdd for querying
  userId: string;
  itemType: 'task' | 'story' | 'chore';
  itemId: string;
  title: string;
  estimatedMinutes: number;
  blockId?: string; // parent block when placed
  start?: number; // scheduled start in epoch millis
  end?: number;   // scheduled end in epoch millis
  status: 'planned' | 'in_progress' | 'done' | 'deferred' | 'skipped';
  external?: {
    googleEventId?: string;
    iosReminderId?: string;
  };
  ownerUid: string; // alias for userId to align with rules
  createdAt: any;
  updatedAt: any;
}

