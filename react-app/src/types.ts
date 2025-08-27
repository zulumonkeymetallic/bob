export interface Goal {
  id: string;
  title: string;
  description?: string;
  ownerUid: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'archived';
  dueDate?: number;
  category?: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface Story {
  id: string;
  title: string;
  goalId: string;
  sprintId?: string;
  ownerUid: string;
  dueDate?: number; // Added dueDate
  status: string; // Added status for Kanban board
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

export interface Task {
  id: string;
  title: string;
  reference: string;
  storyId?: string;
  goalId?: string;
  status: 'Not Started' | 'In Progress' | 'Done' | 'Blocked';
  deleted?: boolean;
  ownerUid: string;
  startDate?: number;
  dueDate?: number;
  effort: 'small' | 'medium' | 'large';
  createdAt: number;
  updatedAt: number;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
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