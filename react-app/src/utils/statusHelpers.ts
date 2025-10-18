// Quick runtime migration helpers for handling mixed string/number status values
// This allows the build to work while we transition from strings to numbers
import { GLOBAL_THEMES } from '../constants/globalThemes';

export const isStatus = (actualStatus: any, expectedStatus: string): boolean => {
  // Handle numeric status values
  if (typeof actualStatus === 'number') {
    // Goal status mapping
    if (expectedStatus === 'New') return actualStatus === 0;
    if (expectedStatus === 'Work in Progress') return actualStatus === 1;
    if (expectedStatus === 'Complete') return actualStatus === 2;
    if (expectedStatus === 'Blocked') return actualStatus === 3;
    if (expectedStatus === 'Deferred') return actualStatus === 4;
    
    // Story status mapping
    if (expectedStatus === 'backlog') return actualStatus === 0;
    if (expectedStatus === 'planned') return actualStatus === 0 || actualStatus === 1;
    if (expectedStatus === 'active') return actualStatus === 1 || actualStatus === 2;
    if (expectedStatus === 'in-progress') return actualStatus === 2;
    if (expectedStatus === 'testing') return actualStatus === 2;
    if (expectedStatus === 'done') return actualStatus === 3 || actualStatus === 4;
    
    // Task status mapping
    if (expectedStatus === 'todo') return actualStatus === 0;
    if (expectedStatus === 'planned') return actualStatus === 0;
    if (expectedStatus === 'in_progress') return actualStatus === 1;
    if (expectedStatus === 'blocked') return actualStatus === 3;
    
    // Sprint status mapping
    if (expectedStatus === 'planning') return actualStatus === 0;
    if (expectedStatus === 'active') return actualStatus === 1;
    if (expectedStatus === 'closed') return actualStatus === 2;
    if (expectedStatus === 'cancelled') return actualStatus === 3;
    
    return false;
  }
  
  // Handle string status values (legacy)
  if (typeof actualStatus === 'string') {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/[_\s]+/g, '-');
    const synonyms = (value: string): string[] => {
      switch (value) {
        case 'backlog':
        case 'todo':
        case 'new':
        case 'planned-backlog':
          return ['backlog', 'todo', 'new'];
        case 'planned':
        case 'ready':
          return ['planned', 'ready'];
        case 'active':
        case 'in-progress':
        case 'inprogress':
        case 'doing':
          return ['active', 'in-progress'];
        case 'testing':
        case 'qa':
        case 'review':
          return ['testing', 'qa', 'review', 'in-progress'];
        case 'done':
        case 'complete':
        case 'completed':
          return ['done', 'complete', 'completed'];
        case 'blocked':
          return ['blocked'];
        default:
          return [value];
      }
    };
    const actual = normalize(actualStatus);
    const expected = normalize(expectedStatus);
    if (actual === expected) return true;
    const actualSynonyms = synonyms(actual);
    const expectedSynonyms = synonyms(expected);
    return expectedSynonyms.some(value => actualSynonyms.includes(value));
  }
  
  return false;
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

// Story-specific helpers to keep modern tables, kanban, and activity feeds aligned
const STORY_STATUS_LABELS: Record<number, string> = {
  0: 'Backlog',
  1: 'Planned',
  2: 'In Progress',
  3: 'Complete',
  4: 'Complete',
};

const STORY_PRIORITY_LABELS: Record<number, string> = {
  4: 'Critical',
  3: 'High',
  2: 'Medium',
  1: 'Low',
  0: 'None',
};

export const storyStatusLabel = (status: any): string => {
  if (typeof status === 'number') {
    return STORY_STATUS_LABELS[status] || `Status ${status}`;
  }
  if (typeof status === 'string') {
    const normalized = status.trim().toLowerCase();
    const entry = Object.entries(STORY_STATUS_LABELS).find(([, label]) => label.toLowerCase() === normalized);
    if (entry) return entry[1];
    if (normalized === 'active') return 'In Progress';
    if (normalized === 'testing') return 'In Progress';
    if (normalized === 'done') return 'Complete';
    if (normalized === 'complete' || normalized === 'completed') return 'Complete';
    return status;
  }
  return 'Backlog';
};

export const storyStatusCodeFromLabel = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const map: Record<string, number> = {
      '0': 0,
      'backlog': 0,
      'new': 0,
      '1': 1,
      'planned': 1,
      'ready': 1,
      '2': 2,
      'active': 2,
      'in progress': 2,
      'in-progress': 2,
      'doing': 2,
      '3': 3,
      'testing': 2,
      'qa': 2,
      'review': 2,
      '4': 4,
      'done': 4,
      'complete': 4,
      'completed': 4,
    };
    if (normalized in map) return map[normalized];
    const entry = Object.entries(STORY_STATUS_LABELS).find(([, label]) => label.toLowerCase() === normalized);
    if (entry) return Number(entry[0]);
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const storyPriorityLabel = (priority: any): string => {
  if (typeof priority === 'number') {
    return STORY_PRIORITY_LABELS[priority] || `Priority ${priority}`;
  }
  if (typeof priority === 'string') {
    const normalized = priority.trim().toLowerCase();
    if (normalized === 'p1') return 'High';
    if (normalized === 'p0') return 'Critical';
    const entry = Object.entries(STORY_PRIORITY_LABELS).find(([, label]) => label.toLowerCase() === normalized);
    if (entry) return entry[1];
    return priority;
  }
  return 'Medium';
};

export const storyPriorityCodeFromLabel = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const map: Record<string, number> = {
      '4': 4,
      'critical': 4,
      'p0': 4,
      'urgent': 4,
      '3': 3,
      'high': 3,
      'p1': 3,
      '2': 2,
      'medium': 2,
      'med': 2,
      'normal': 2,
      '1': 1,
      'low': 1,
      'p2': 1,
      'minor': 1,
      '0': 0,
      'none': 0,
    };
    if (normalized in map) return map[normalized];
    const entry = Object.entries(STORY_PRIORITY_LABELS).find(([, label]) => label.toLowerCase() === normalized);
    if (entry) return Number(entry[0]);
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
