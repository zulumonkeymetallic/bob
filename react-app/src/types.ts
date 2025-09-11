export interface Goal {
  id: string;
  persona: 'personal'; // Goals are personal-only per requirements
  title: string;
  description?: string;
  theme: number; // 1=Health, 2=Growth, 3=Wealth, 4=Tribe, 5=Home
  size: number; // 1=Small, 2=Medium, 3=Large
  timeToMasterHours: number;
  targetDate?: string;
  startDate?: number; // Timestamp for goal start date
  endDate?: number; // Timestamp for goal end date
  confidence: number; // 1=Low, 2=Medium, 3=High
  kpis?: Array<{name: string; target: number; unit: string}>;
  status: number; // 0=New, 1=Work in Progress, 2=Complete, 3=Blocked, 4=Deferred
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
  // Relationships
  parentGoalId?: string | null; // Optional parent goal relationship
  dependsOnGoalIds?: string[]; // Optional dependency links
  // Legacy fields for backward compatibility
  dueDate?: number;
  category?: string;
  priority?: number;
}

export interface Story {
  id: string;
  ref: string;
  persona: 'personal'; // Stories are personal-only per requirements
  title: string;
  description?: string;
  goalId: string;
  theme?: number; // Inherited from goal: 1=Health, 2=Growth, 3=Wealth, 4=Tribe, 5=Home
  status: number; // 0=Backlog, 1=Planned, 2=In Progress, 3=Testing, 4=Done
  priority: number; // 1=P1, 2=P2, 3=P3
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
  taskCount?: number;
  doneTaskCount?: number;
}

export interface Sprint {
  id: string;
  ref: string;
  name: string;
  objective?: string;
  notes?: string;
  status: number; // 0=Planning, 1=Active, 2=Complete, 3=Cancelled
  startDate: number;
  endDate: number;
  planningDate: number;
  retroDate: number;
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

export interface WorkProject {
  id: string;
  persona: 'work';
  title: string;
  client?: string;
  team?: string;
  tags?: string[];
  status: number; // 0=Backlog, 1=Active, 2=Done
  wipLimit: number;
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

export interface Task {
  id: string;
  ref: string;
  persona: 'personal' | 'work';
  parentType: 'story' | 'project';
  parentId: string;
  title: string;
  description?: string;
  status: number; // 0=To Do, 1=In Progress, 2=Done, 3=Blocked
  priority: number; // 1=High, 2=Medium, 3=Low
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
  theme?: number; // 1=Health, 2=Growth, 3=Wealth, 4=Tribe, 5=Home
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
  // New fields for v3.0.2
  importanceScore?: number;
  isImportant?: boolean;
  reminderId?: string;
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
  syncToGoogle?: boolean;
  taskId?: string;
  goalId?: string;
  storyId?: string;
  habitId?: string;
  seriesId?: string;
  subTheme?: string;
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

export interface Digest {
  id: string;
  date: any; // Firebase Timestamp
  tasksDue: Task[];
  storiesFocus: Story[];
  calendarBlocks: CalendarBlock[];
  velocitySnapshot: any;
  html: string;
}

export interface MetricsHrv {
  id: string;
  date: any; // Firebase Timestamp
  value: number;
  source: string;
}

export interface MetricsWorkouts {
  id: string;
  date: any; // Firebase Timestamp
  type: string;
  distance: number;
  duration: number;
  hr_avg: number;
  source: string;
  stravaActivityId: string;
}

export interface MetricsNutrition {
  id: string;
  date: any; // Firebase Timestamp
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  source: string;
  mfpEntryId: string;
}

export interface TestLoginToken {
  id: string;
  token: string;
  uid: string;
  expiresAt: any; // Firebase Timestamp
  scope: string;
}

export interface Taxonomy {
    id: string;
    type: 'theme' | 'subtheme';
    name: string;
    parent?: string;
}
