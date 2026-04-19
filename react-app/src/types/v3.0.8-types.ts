// Enhanced types for v3.0.8 requirements
// Theme Settings and UI State collections

import { Story, Task, Goal, Sprint } from '../types';

interface ThemeSettings {
  id: string;
  ownerUid: string;
  themes: {
    [themeId: string]: {
      name: string;
      primary: string;
      secondary: string;
      light: string;
      lighter: string;
      dark: string;
      darker: string;
    };
  };
  defaultThemeId: string;
  highContrastMode: boolean;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

interface UIState {
  id: string;
  ownerUid: string;
  plannerRowExpansion: {
    [rowKey: string]: boolean; // Format: "theme:goalId" or "theme:goalId:subGoalId"
  };
  plannerVisibleSprints: string[];
  kanbanLaneLabels: {
    [laneId: string]: string;
  };
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

interface SubGoal {
  id: string;
  ref: string; // SUBG-###
  goalId: string;
  title: string;
  description?: string;
  orderIndex: number;
  rank?: number; // For new fractional ranking
  status: 'Not Started' | 'Work in Progress' | 'Complete' | 'Paused';
  ownerUid: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

// Enhanced existing interfaces with new v3.0.8 fields
interface EnhancedStory extends Story {
  rank?: number;
  rankByLane?: Record<string, number>;
  rankByCell?: Record<string, number>; // key: ${sprintId}/${goalId}/${subGoalId}
  dragLockVersion?: number;
  themeId?: string;
  subGoalId?: string;
}

interface EnhancedTask extends Task {
  rank?: number;
  dragLockVersion?: number;
  aiCalculatedImportance?: number;
  recurringPattern?: {
    type: 'daily' | 'weekly' | 'monthly';
    interval: number;
    endDate?: number;
  };
}

interface EnhancedGoal extends Goal {
  rank?: number;
  dragLockVersion?: number;
}

interface EnhancedSprint extends Sprint {
  rank?: number; // Replacing orderIndex
  dragLockVersion?: number;
}

// Drag and Drop Event Types
interface DnDEvent {
  entityType: 'goal' | 'subGoal' | 'story' | 'task' | 'habit' | 'sprint' | 'calendarBlock';
  entityId: string;
  from: {
    scope: string;
    parentIds?: Record<string, string>;
    index?: number;
  };
  to: {
    scope: string;
    parentIds?: Record<string, string>;
    index?: number;
  };
  meta?: {
    source: 'mouse' | 'touch' | 'keyboard';
    reason?: 'reorder' | 'move';
  };
}

// Activity Stream enhancement for DnD
interface ActivityStreamEntry {
  id: string;
  ownerUid: string;
  activityType: 'sprint_changed' | 'backlog_retargeted' | 'reordered_in_cell' | 'goal_created' | 'story_created' | 'task_completed';
  entityType: string;
  entityId: string;
  payload: {
    dnd?: {
      from: DnDEvent['from'];
      to: DnDEvent['to'];
      oldRank?: number;
      newRank?: number;
      scope: string;
    };
    [key: string]: any;
  };
  timestamp: any; // Firebase Timestamp
}

// Calendar integration types
interface CalendarBlock {
  id: string;
  ref: string; // CAL-###
  ownerUid: string;
  title: string;
  description?: string;
  start: number; // timestamp
  end: number; // timestamp
  storyId?: string;
  habitId?: string;
  subTheme?: string;
  googleEventId?: string;
  isAiGenerated?: boolean;
  conflictVersion?: number;
  supersededBy?: string;
  themeId?: string;
  createdAt: any; // Firebase Timestamp
  updatedAt: any; // Firebase Timestamp
}

// Daily digest types
interface DailyDigest {
  id: string;
  ownerUid: string;
  date: string; // YYYY-MM-DD
  content: {
    tasksDueToday: Task[];
    focusStories: Story[];
    todaysCalendarBlocks: CalendarBlock[];
    sprintPulse: {
      currentSprint?: Sprint;
      progress: number;
      storiesCompleted: number;
      storiesTotal: number;
    };
    llmNarrative: string;
  };
  generatedAt: any; // Firebase Timestamp
  emailSent?: boolean;
  emailSentAt?: any;
}

// Health metrics types
interface MetricsHRV {
  id: string;
  ownerUid: string;
  date: string; // YYYY-MM-DD
  hrv: number;
  source: 'strava' | 'fitbit' | 'manual';
  createdAt: any; // Firebase Timestamp
}

interface MetricsWorkout {
  id: string;
  ownerUid: string;
  date: string; // YYYY-MM-DD
  type: 'run' | 'bike' | 'swim' | 'strength' | 'other';
  duration: number; // minutes
  intensity: 'low' | 'medium' | 'high';
  source: 'strava' | 'runna' | 'manual';
  createdAt: any; // Firebase Timestamp
}

interface MetricsNutrition {
  id: string;
  ownerUid: string;
  date: string; // YYYY-MM-DD
  calories: number;
  protein: number; // grams
  carbs: number; // grams
  fat: number; // grams
  source: 'myfitnesspal' | 'manual';
  createdAt: any; // Firebase Timestamp
}

// Test authentication tokens
interface TestLoginToken {
  id: string;
  token: string;
  userId: string;
  expiresAt: any; // Firebase Timestamp
  environment: 'development' | 'staging';
  createdAt: any; // Firebase Timestamp
}

// Export types for external consumption
export type {
  ThemeSettings,
  UIState,
  SubGoal,
  EnhancedStory,
  EnhancedTask,
  EnhancedGoal,
  EnhancedSprint,
  DnDEvent,
  ActivityStreamEntry,
  CalendarBlock,
  DailyDigest,
  MetricsHRV,
  MetricsWorkout,
  MetricsNutrition,
  TestLoginToken
};
