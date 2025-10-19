// Quick runtime migration helpers for handling mixed string/number status values
// This allows the build to work while we transition from strings to numbers
import { GLOBAL_THEMES } from '../constants/globalThemes';

export const isStatus = (actualStatus: any, expectedStatus: string): boolean => {
  // Normalize expected status to handle hyphens/underscores/spaces
  const exp = String(expectedStatus || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_+/g, '-');

  // Handle numeric status values
  if (typeof actualStatus === 'number') {
    // Heuristic: numbers >= 4 are almost certainly story/goal space; <= 3 likely tasks
    const likelyTask = actualStatus <= 3;

    // Goal status mapping (string names)
    if (exp === 'new') return actualStatus === 0;
    if (exp === 'work-in-progress') return actualStatus === 1;
    if (exp === 'complete') return actualStatus === 2;
    if (exp === 'blocked') return actualStatus === 3;
    if (exp === 'deferred') return actualStatus === 4;

    // Story status mapping (0..4)
    if (exp === 'backlog') return actualStatus === 0;
    if (exp === 'planned') return actualStatus === 1;
    if (exp === 'active' || exp === 'in-progress') return actualStatus === 2;
    if (exp === 'testing') return actualStatus === 3;
    if (exp === 'done') return actualStatus === 4;

    // Task status mapping (0..3)
    if (exp === 'todo' || exp === 'planned') return actualStatus === 0;
    if (exp === 'in-progress') return actualStatus === 1;
    if (exp === 'done') return likelyTask && actualStatus === 2;
    if (exp === 'blocked') return actualStatus === 3;

    // Sprint status mapping
    if (exp === 'planning') return actualStatus === 0;
    if (exp === 'active') return actualStatus === 1;
    if (exp === 'closed') return actualStatus === 2;
    if (exp === 'cancelled') return actualStatus === 3;

    return false;
  }

  // Handle string status values (legacy)
  const act = String(actualStatus || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/_+/g, '-');
  return act === exp;
};

export const isPriority = (actualPriority: any, expectedPriority: string): boolean => {
  // Handle numeric priority values
  if (typeof actualPriority === 'number') {
    if (expectedPriority === 'Critical') return actualPriority === 4;
    if (expectedPriority === 'High') return actualPriority === 3;
    if (expectedPriority === 'Medium') return actualPriority === 2;
    if (expectedPriority === 'Low') return actualPriority === 1;
    if (expectedPriority === 'None') return actualPriority === 0;
    
    // Alternative priority naming
    if (expectedPriority === 'high') return actualPriority === 3;
    if (expectedPriority === 'med') return actualPriority === 2;
    if (expectedPriority === 'medium') return actualPriority === 2;
    if (expectedPriority === 'low') return actualPriority === 1;
    
    return false;
  }
  
  // Handle string priority values (legacy)
  return actualPriority === expectedPriority;
};

export const isTheme = (actualTheme: any, expectedTheme: string): boolean => {
  // Handle numeric theme values
  if (typeof actualTheme === 'number') {
    if (expectedTheme === 'Health') return actualTheme === 1;
    if (expectedTheme === 'Growth') return actualTheme === 2;
    if (expectedTheme === 'Wealth') return actualTheme === 3;
    if (expectedTheme === 'Tribe') return actualTheme === 4;
    if (expectedTheme === 'Home') return actualTheme === 5;
    return false;
  }
  
  // Handle string theme values (legacy)
  return actualTheme === expectedTheme;
};

// Helper to get theme class name for styling
export const getThemeClass = (theme: any): string => {
  if (typeof theme === 'number') {
    switch (theme) {
      case 1: return 'health';
      case 2: return 'growth';
      case 3: return 'wealth';
      case 4: return 'tribe';
      case 5: return 'home';
      default: return 'default';
    }
  }
  
  // Handle string themes (legacy)
  return typeof theme === 'string' ? theme.toLowerCase() : 'default';
};

// Helper to get theme display name

export const getThemeName = (theme: any): string => {
  if (typeof theme === 'number') {
    const match = GLOBAL_THEMES.find(t => t.id === theme);
    return match ? match.label : 'Unknown';
  }
  // Handle string themes (legacy)
  return typeof theme === 'string' ? theme : 'Unknown';
};

// Helper to get priority display name
export const getPriorityName = (priority: any): string => {
  if (typeof priority === 'number') {
    switch (priority) {
      case 4: return 'Critical';
      case 3: return 'High';
      case 2: return 'Medium';
      case 1: return 'Low';
      case 0: return 'None';
      default: return 'Unknown';
    }
  }
  
  // Handle string priority (legacy)
  return typeof priority === 'string' ? priority : 'Unknown';
};

// Helper to get status display name
export const getStatusName = (status: any): string => {
  if (typeof status === 'number') {
    switch (status) {
      case 0: return 'New';
      case 1: return 'Work in Progress';
      case 2: return 'Complete';
      case 3: return 'Blocked';
      case 4: return 'Deferred';
      default: return 'Unknown';
    }
  }
  
  // Handle string status (legacy)
  return typeof status === 'string' ? status : 'Unknown';
};

// Helper to get priority color
export const getPriorityColor = (priority: any): string => {
  if (typeof priority === 'number') {
    switch (priority) {
      case 4: return 'danger';    // Critical
      case 3: return 'danger';    // High  
      case 2: return 'warning';   // Medium
      case 1: return 'secondary'; // Low
      case 0: return 'light';     // None
      default: return 'light';
    }
  }
  
  // Handle string priority (legacy)
  if (priority === 'high' || priority === 'High') return 'danger';
  if (priority === 'med' || priority === 'Medium') return 'warning';
  if (priority === 'low' || priority === 'Low') return 'secondary';
  
  return 'light';
};

// Helper to get priority icon
export const getPriorityIcon = (priority: any): string => {
  if (typeof priority === 'number') {
    switch (priority) {
      case 4: return '🔴';  // Critical
      case 3: return '🟠';  // High  
      case 2: return '🟡';  // Medium
      case 1: return '🔵';  // Low
      case 0: return '⚪';  // None
      default: return '⚪';
    }
  }
  
  // Handle string priority (legacy)
  if (priority === 'high' || priority === 'High') return '🔴';
  if (priority === 'med' || priority === 'Medium') return '🟡';
  if (priority === 'low' || priority === 'Low') return '🔵';
  
  return '⚪';
};

// Helper to get status badge color
export const getBadgeVariant = (status: any): string => {
  if (typeof status === 'number') {
    switch (status) {
      case 0: return 'secondary'; // New/Todo
      case 1: return 'primary';   // In Progress
      case 2: return 'success';   // Complete/Done
      case 3: return 'danger';    // Blocked
      case 4: return 'warning';   // Deferred
      default: return 'light';
    }
  }
  
  // Handle string status (legacy)
  if (status === 'done' || status === 'Complete') return 'success';
  if (status === 'in-progress' || status === 'Work in Progress') return 'primary';
  if (status === 'blocked' || status === 'Blocked') return 'danger';
  if (status === 'todo' || status === 'New') return 'secondary';
  
  return 'light';
};

// Helper to get priority badge class
export const getPriorityBadge = (priority: any): { bg: string; text: string } => {
  if (typeof priority === 'number') {
    switch (priority) {
      case 4: return { bg: 'danger', text: 'Critical' };
      case 3: return { bg: 'danger', text: 'High' };
      case 2: return { bg: 'warning', text: 'Medium' };
      case 1: return { bg: 'secondary', text: 'Low' };
      default: return { bg: 'light', text: 'None' };
    }
  }
  
  // Handle string priorities (legacy)
  if (priority === 'high' || priority === 'High') return { bg: 'danger', text: 'High' };
  if (priority === 'med' || priority === 'Medium') return { bg: 'warning', text: 'Medium' };
  if (priority === 'low' || priority === 'Low') return { bg: 'secondary', text: 'Low' };
  
  return { bg: 'light', text: String(priority || 'None') };
};
