export interface Goal {
  id: string;
  persona: 'personal'; // Goals are personal-only per requirements
  title: string;
  description?: string;
  theme: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
  size: 'XS' | 'S' | 'M' | 'L' | 'XL';
  timeToMasterHours: number;
  targetDate?: string;
  confidence: number;
  kpis?: Array<{name: string; target: number; unit: string}>;
  status: 'new' | 'active' | 'paused' | 'done' | 'dropped';
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
  // Legacy fields for backward compatibility
  dueDate?: number;
  category?: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface Story {
  id: string;
  persona: 'personal'; // Stories are personal-only per requirements
  title: string;
  description?: string;
  goalId: string;
  theme?: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home'; // Inherited from goal
  status: 'backlog' | 'active' | 'done' | 'defect';
  priority: 'P1' | 'P2' | 'P3';
  points: number;
  wipLimit: number;
  tags?: string[];
  sprintId?: string;
  orderIndex: number;
  acceptanceCriteria?: string[];
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
  dueDate?: number; // Legacy compatibility
}

export interface Sprint {
  id: string;
  name: string;
  startDate: number;
  endDate: number;
  planningDate: number;
  retroDate: number;
  ownerUid: string;
}

export interface WorkProject {
  id: string;
  persona: 'work';
  title: string;
  client?: string;
  team?: string;
  tags?: string[];
  status: 'backlog' | 'active' | 'done';
  wipLimit: number;
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

export interface Task {
  id: string;
  persona: 'personal' | 'work';
  parentType: 'story' | 'project';
  parentId: string;
  title: string;
  description?: string;
  status: 'todo' | 'planned' | 'in-progress' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'med' | 'high';
  effort: 'S' | 'M' | 'L';
  estimateMin: number;
  startDate?: number;
  dueDate?: number;
  labels?: string[];
  blockedBy?: string[];
  dependsOn?: string[];
  checklist?: Array<{text: string; done: boolean}>;
  attachments?: Array<{name: string; url: string}>;
  alignedToGoal: boolean;
  theme?: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
  source: 'ios_reminder' | 'web' | 'ai' | 'gmail' | 'sheets';
  sourceRef?: string;
  aiSuggestedLinks?: Array<{goalId: string; storyId?: string; confidence: number; rationale: string}>;
  aiLinkConfidence: number;
  hasGoal: boolean;
  syncState: 'clean' | 'dirty' | 'pending_push' | 'awaiting_ack';
  deviceUpdatedAt?: number;
  serverUpdatedAt: number;
  createdBy: string;
  ownerUid: string;
  // Enhanced fields for v2.1.4+
  sprintId?: string;
  projectId?: string;
  // Legacy fields for backward compatibility
  reference?: string;
  storyId?: string;
  goalId?: string;
  deleted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  tags?: string[];
}

export interface Column {
  id: string;
  title: string;
  taskIds: string[]; // This will change to storyIds
}

export interface IHabit {
  id: string;
  userId: string;
  name: string;
  description?: string;
  frequency: "daily" | "weekly" | "monthly" | "custom";
  targetValue: number; // e.g., 1 for daily, 5 for 5 times a week, 8 for 8 glasses of water
  unit?: string; // e.g., "times", "glasses", "minutes"
  linkedGoalId?: string;
  linkedGoalName?: string;
  createdAt: number; // Using number for Firebase Timestamp
  updatedAt: number; // Using number for Firebase Timestamp
  isActive: boolean;
  color?: string; // For UI representation
}

export interface IHabitEntry {
  id: string; // Could be a date string like "YYYY-MM-DD"
  habitId: string;
  date: number; // Using number for Firebase Timestamp (start of day)
  value: number; // Actual value achieved for the habit on that day
  isCompleted: boolean; // Derived or explicitly set
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DevelopmentFeature {
  id: string;
  feature: string;
  description: string;
  implemented: boolean;
  uatCompleted: boolean;
  versionNumber: string;
  ownerUid: string;
}

export interface CalendarBlock {
  id: string;
  googleEventId?: string;
  taskId?: string;
  goalId?: string;
  persona: 'personal' | 'work';
  theme: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
  category: 'Tribe' | 'Chores' | 'Gaming' | 'Fitness' | 'Wellbeing' | 'Sauna' | 'Sleep';
  start: number; // timestamp
  end: number; // timestamp
  flexibility: 'hard' | 'soft';
  status: 'proposed' | 'applied' | 'superseded';
  colorId?: string;
  visibility: 'default' | 'private';
  createdBy: 'ai' | 'user';
  rationale?: string;
  version: number;
  supersededBy?: string;
  ownerUid: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlanningPrefs {
  uid: string;
  wakeTime: string; // HH:mm format
  sleepTime: string; // HH:mm format
  quietHours: Array<{start: string; end: string}>;
  maxHiSessionsPerWeek: number;
  minRecoveryGapHours: number;
  weeklyThemeTargets: {
    Health: number;
    Tribe: number;
    Wealth: number;
    Growth: number;
    Home: number;
  };
  poolHours?: Array<{day: number; open: string; close: string}>;
  gymHours?: Array<{day: number; open: string; close: string}>;
  autoApplyThreshold: number;
}

export type Persona = 'personal' | 'work';