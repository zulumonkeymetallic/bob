export interface FocusGoal {
  id: string;
  ownerUid: string;
  persona: 'personal' | 'work';
  goalIds: string[]; // IDs of goals selected for focus
  goalTypeMap?: { [goalId: string]: 'story' | 'calendar' };
  timeframe: 'sprint' | 'quarter' | 'year'; // Duration of focus
  startDate: any; // Firebase Timestamp
  endDate: any; // Firebase Timestamp (calculated from timeframe)
  daysRemaining?: number; // Calculated: days until endDate
  title?: string; // Optional custom title for this focus set
  description?: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
  isActive: boolean; // Whether this focus goal set is currently active
  storiesCreatedFor?: string[]; // Track which goal stories were auto-created
  potIdsCreatedFor?: { [goalId: string]: string }; // Track which pots were auto-created per goal
  visionText?: string;
  intentBrokerIntakeId?: string;
  intentMatches?: Array<{ goalId: string; title: string; score: number; tag?: string }>;
  intentProposals?: Array<{ tag: string; title: string; rationale: string; confidence: number }>;
  storyTableHandoff?: boolean;
  autoCreatedSprintIds?: string[];
  deferredNonFocusCount?: number;
  monzoPotGoalRefs?: { [goalId: string]: string };
}

export interface Goal {
  id: string;
  ref?: string;
  persona: 'personal' | 'work';
  title: string;
  description?: string;
  theme: number; // 1=Health, 2=Growth, 3=Wealth, 4=Tribe, 5=Home
  size: number; // 1=Small, 2=Medium, 3=Large
  timeToMasterHours: number;
  estimatedCost?: number; // Optional cost estimate used for budgeting
  costType?: 'none' | 'one_off' | 'recurring';
  recurrence?: 'monthly' | 'annual';
  targetYear?: number;
  goalRequiresStory?: boolean;
  monzoPotGoalRef?: string | null;
  monzoPotId?: string | null;
  monzoPotLinkedAt?: any;
  monzoPotRefRequestedAt?: any;
  monzoPotLinkTimedOutAt?: any;
  monzoPotLinkStatus?: 'pending' | 'linked' | 'timeout' | string | null;
  monzoPotLinkError?: string | null;
  potId?: string | null; // Optional explicit Monzo pot mapping
  linkedPotId?: string | null; // Canonical Monzo pot mapping id
  targetDate?: string;
  startDate?: number; // Timestamp for goal start date
  endDate?: number; // Timestamp for goal end date
  confidence: number; // 1=Low, 2=Medium, 3=High
  kpis?: Array<{ name: string; target: number; unit: string }>;
  status: number; // 0=New, 1=Work in Progress, 2=Complete, 3=Blocked, 4=Deferred
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
  url?: string | null;
  orderIndex?: number; // Stable ordering for modern tables
  // Relationships
  parentGoalId?: string | null; // Optional parent goal relationship
  dependsOnGoalIds?: string[]; // Optional dependency links
  // Publishing & sharing
  isPublished?: boolean; // Whether goal is publicly shareable
  shareCode?: string; // Unique code for sharing (e.g., abc123xyz)
  publishedAt?: any; // Firebase Timestamp when goal was published
  // Legacy fields for backward compatibility
  dueDate?: number;
  category?: string;
  priority?: number;
  tags?: string[];
}

export interface Story {
  id: string;
  ref: string;
  referenceNumber?: string;
  persona: 'personal' | 'work';
  title: string;
  description?: string;
  goalId: string;
  theme?: number; // Inherited from goal: 1=Health, 2=Growth, 3=Wealth, 4=Tribe, 5=Home
  status: number; // 0=Backlog, 1=Planned, 2=In Progress, 3=Testing, 4=Done
  blocked?: boolean; // Separate flag: when true, UI shows subtle red outline
  priority: number; // 4=Critical, 3=High, 2=Medium, 1=Low
  points: number;
  wipLimit: number;
  tags?: string[];
  sprintId?: string;
  orderIndex: number;
  acceptanceCriteria?: string[];
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
  url?: string | null;
  dueDate?: number; // Legacy compatibility
  dueTime?: string; // HH:mm format
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  targetDate?: number | string;
  plannedStartDate?: number | string;
  taskCount?: number;
  doneTaskCount?: number;
  metadata?: Record<string, any>;
  aiCriticalityScore?: number;
  aiCriticalityReason?: string;
  aiFocusStoryRank?: number;
  aiTop3ForDay?: boolean;
  aiTop3Date?: string;
  aiPriorityLabel?: string;
  aiTop3Reason?: string;
  // User-set #1 priority flag for gcal override
  userPriorityFlag?: boolean;
  userPriorityFlagAt?: string;
  deferredUntil?: any;
  deferredReason?: string;
  deferredBy?: string;
  // Optional travel/location metadata
  countryCode?: string; // ISO alpha-2
  city?: string;
  locationName?: string; // Full display name
  locationLat?: number;
  locationLon?: number;
}

export interface JournalMindsetAnalysis {
  emotionalTone?: string | null;
  cognitiveStyle?: string | null;
  motivationsAndDrivers?: string | null;
  psychologicalStrengths?: string | null;
  potentialStressors?: string | null;
}

export interface JournalEntryMetadata {
  moodScore?: number | null;
  stressLevel?: number | null;
  energyLevel?: number | null;
  primaryThemes?: string[];
  cognitiveState?: string | null;
  sentiment?: 'negative' | 'neutral' | 'mixed' | 'positive' | string | null;
}

export interface JournalEntry {
  id: string;
  persona: 'personal' | 'work';
  ownerUid: string;
  originalTranscript?: string;
  journalDateKey?: string | null;
  dateHeading?: string;
  structuredEntry?: string;
  oneLineSummary?: string;
  aiSummaryBullets?: string[];
  advice?: string;
  mindsetAnalysis?: JournalMindsetAnalysis | null;
  entryMetadata?: JournalEntryMetadata | null;
  entryCount?: number;
  summaryHistory?: string[];
  docUrl?: string | null;
  googleDoc?: {
    attempted?: boolean;
    appended?: boolean;
    status?: string | null;
    message?: string | null;
    url?: string | null;
  } | null;
  googleDocAppendedAt?: any;
  entryType?: 'journal' | 'mixed' | 'task_list' | 'url_only' | string;
  transcriptFingerprint?: string;
  source?: string;
  sourceUrls?: string[];
  storyIds?: string[];
  taskIds?: string[];
  linkedStories?: Array<{
    id: string;
    ref?: string;
    title?: string;
    url?: string | null;
    deepLink?: string | null;
    existing?: boolean;
    updated?: boolean;
  }>;
  linkedTasks?: Array<{
    id: string;
    ref?: string;
    title?: string;
    url?: string | null;
    deepLink?: string | null;
    existing?: boolean;
    updated?: boolean;
  }>;
  createdAt: any;
  updatedAt: any;
}

export interface Sprint {
  id: string;
  ref: string;
  name: string;
  objective?: string;
  notes?: string;
  persona?: 'personal' | 'work';
  status: number; // 0=Planning, 1=Active, 2=Complete, 3=Cancelled
  focusGoalIds?: string[];
  alignmentMode?: 'warn' | 'strict';
  alignmentLockedAt?: any;
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
  priority: number; // 4=Critical, 3=High, 2=Medium, 1=Low
  effort: 'S' | 'M' | 'L';
  estimateMin: number;
  points?: number;
  estimatedHours?: number;
  startDate?: number;
  dueDate?: number;
  dueDateMs?: number;
  dueTime?: string; // HH:mm format
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  dueDateLocked?: boolean;
  dueDateReason?: string;
  lockDueDate?: boolean;
  targetDate?: number | string;
  labels?: string[];
  blockedBy?: string[];
  dependsOn?: string[];
  checklist?: Array<{ text: string; done: boolean }>;
  attachments?: Array<{ name: string; url: string }>;
  alignedToGoal: boolean;
  theme?: number; // 1=Health, 2=Growth, 3=Wealth, 4=Tribe, 5=Home
  source: 'ios_reminder' | 'MacApp' | 'web' | 'ai' | 'gmail' | 'sheets';
  sourceRef?: string;
  aiSuggestedLinks?: Array<{ goalId: string; storyId?: string; confidence: number; rationale: string }>;
  aiLinkConfidence: number;
  hasGoal: boolean;
  syncState: 'clean' | 'dirty' | 'pending_push' | 'awaiting_ack';
  deviceUpdatedAt?: number;
  serverUpdatedAt: number;
  macSyncedAt?: number;
  createdBy: string;
  ownerUid: string;
  // New fields for v3.0.2
  importanceScore?: number;
  isImportant?: boolean;
  importanceUpdatedAt?: number;
  reminderId?: string;
  reminderCreatedAt?: number;
  duplicateOf?: string;
  duplicateKey?: string;
  duplicateResolvedAt?: number;
  duplicateChildren?: string[];
  reminderSyncDirective?: 'complete' | 'delete' | null;
  convertedToStoryId?: string;
  aiCriticalityScore?: number;
  aiCriticalityReason?: string;
  aiFlaggedTop?: boolean;
  aiPriorityRank?: number;
  aiDailyRank?: number;
  aiTop3ForDay?: boolean;
  aiTop3Date?: string;
  aiPriorityLabel?: string;
  aiTop3Reason?: string;
  iosPriority?: string;
  type?: 'task' | 'chore' | 'routine' | 'habit' | 'read' | 'watch' | string;
  repeatFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  repeatInterval?: number | null;
  daysOfWeek?: string[] | null;
  rrule?: string | null;
  lastDoneAt?: any;
  snoozedUntil?: number;
  typeInferredAt?: any;
  // Enhanced fields for v2.1.4+
  sprintId?: string;
  projectId?: string;
  deepLink?: string; // Optional deep link for navigation
  url?: string | null;
  // Legacy fields for backward compatibility
  reference?: string;
  storyId?: string;
  goalId?: string;
  deleted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  tags?: string[];
  // Lifecycle & maintenance
  completedAt?: number; // when status first moved to Done
  deleteAfter?: number; // scheduled deletion timestamp (TTL)
  duplicateFlag?: boolean; // normalized duplicate indicator
  deferredUntil?: any;
  deferredReason?: string;
  deferredBy?: string;
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
  ownerUid?: string;
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
  theme: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home' | string;
  theme_id?: number | string;
  themeId?: number | string;
  category: 'Tribe' | 'Chores' | 'Gaming' | 'Fitness' | 'Wellbeing' | 'Sauna' | 'Sleep' | 'Work Shift' | 'Work (Main Gig)' | 'Side Gig';
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
  title?: string;
  conflictStatus?: string;
  updatedAt: number;
  recurrence?: {
    freq: 'daily' | 'weekly';
    byDay?: string[]; // e.g., ['MO', 'WE']
    until?: number | null; // timestamp (ms) for recurrence end date
  };
  aiScore?: number | null;
  aiReason?: string | null;
  calendarMatchSource?: string;
  calendarMatchNote?: string;
  calendarMatchScore?: number;
  calendarMatchConfidence?: number;
  calendarMatchConfidenceTier?: 'high' | 'medium' | 'low' | string;
}

export interface PlanningPrefs {
  uid: string;
  wakeTime: string; // HH:mm format
  sleepTime: string; // HH:mm format
  quietHours: Array<{ start: string; end: string }>;
  maxHiSessionsPerWeek: number;
  minRecoveryGapHours: number;
  weeklyThemeTargets: {
    Health: number;
    Tribe: number;
    Wealth: number;
    Growth: number;
    Home: number;
  };
  poolHours?: Array<{ day: number; open: string; close: string }>;
  gymHours?: Array<{ day: number; open: string; close: string }>;
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
