// Quick runtime migration helpers for handling mixed string/number status values
// This allows the build to work while we transition from strings to numbers
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { normalizePriorityValue } from './priorityUtils';

export const isStatus = (actualStatus: any, expectedStatus: string): boolean => {
  // Handle numeric status values (legacy, mixed across entities)
  if (typeof actualStatus === 'number') {
    // Goal status mapping
    if (expectedStatus === 'New') return actualStatus === 0;
    if (expectedStatus === 'Work in Progress') return actualStatus === 1;
    if (expectedStatus === 'Complete') return actualStatus === 2;
    if (expectedStatus === 'Blocked') return actualStatus === 3;
    if (expectedStatus === 'Deferred') return actualStatus === 4;

    // Story status mapping
    if (expectedStatus === 'backlog') return actualStatus === 0;
    if (expectedStatus === 'planned') return actualStatus === 1;
    if (expectedStatus === 'active') return actualStatus === 2;
    if (expectedStatus === 'in-progress') return actualStatus === 2;
    if (expectedStatus === 'testing') return actualStatus === 3;
    if (expectedStatus === 'done') return actualStatus === 4;

    // Task status mapping
    if (expectedStatus === 'todo') return actualStatus === 0;
    if (expectedStatus === 'planned') return actualStatus === 0;
    if (expectedStatus === 'in_progress') return actualStatus === 1;
    if (expectedStatus === 'in-progress') return actualStatus === 1;
    if (expectedStatus === 'done') return actualStatus === 2;
    if (expectedStatus === 'blocked') return actualStatus === 3;

    // Sprint status mapping
    if (expectedStatus === 'planning') return actualStatus === 0;
    if (expectedStatus === 'active') return actualStatus === 1;
    if (expectedStatus === 'closed') return actualStatus === 2;
    if (expectedStatus === 'cancelled') return actualStatus === 3;

    return false;
  }

  // Handle string status values with normalization (treat synonyms consistently)
  const normalize = (s: any): string => {
    const v = String(s || '').trim().toLowerCase();
    if (!v) return '';
    const x = v.replace(/_/g, '-');
    if (x === 'active' || x === 'in-progress' || x === 'in progress' || x === 'wip' || x === 'work in progress' || x === 'testing') return 'in-progress';
    if (x === 'todo' || x === 'backlog' || x === 'planned' || x === 'new') return 'backlog';
    if (x === 'done' || x === 'complete' || x === 'completed' || x === 'closed') return 'done';
    if (x === 'blocked' || x === 'paused') return 'blocked';
    return x;
  };

  return normalize(actualStatus) === normalize(expectedStatus);
};

export const isPriority = (actualPriority: any, expectedPriority: string): boolean => {
  const normalizedActual = normalizePriorityValue(actualPriority);
  const normalizedExpected = normalizePriorityValue(expectedPriority);
  return normalizedActual === normalizedExpected;
};

export const isTheme = (actualTheme: any, expectedTheme: string): boolean => {
  const normalizeThemeId = (value: any): number | null => {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);
    const lower = raw.toLowerCase();
    const direct = GLOBAL_THEMES.find((t) => t.label.toLowerCase() === lower || t.name.toLowerCase() === lower);
    if (direct) return direct.id;
    const legacy: Record<string, number> = {
      health: 1,
      growth: 2,
      wealth: 3,
      tribe: 4,
      home: 5,
    };
    if (legacy[lower] != null) return legacy[lower];
    const partial = GLOBAL_THEMES.find((t) =>
      t.label.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower)
    );
    return partial ? partial.id : null;
  };

  const actualId = normalizeThemeId(actualTheme);
  const expectedId = normalizeThemeId(expectedTheme);
  if (actualId != null && expectedId != null) return actualId === expectedId;

  const actualStr = String(actualTheme || '').trim().toLowerCase();
  const expectedStr = String(expectedTheme || '').trim().toLowerCase();
  if (!actualStr || !expectedStr) return false;
  return actualStr === expectedStr;
};

// Helper to get theme class name for styling
export const getThemeClass = (theme: any): string => {
  const resolveLabel = (value: any): string => {
    if (typeof value === 'number') {
      const match = GLOBAL_THEMES.find((t) => t.id === value);
      return match?.label || '';
    }
    return String(value || '').trim();
  };
  const label = resolveLabel(theme);
  const lower = label.toLowerCase();

  if (lower.includes('health')) return 'health';
  if (lower.includes('growth')) return 'growth';
  if (lower.includes('wealth') || lower.includes('finance')) return 'wealth';
  if (lower.includes('tribe') || lower.includes('family') || lower.includes('relationship')) return 'tribe';
  if (lower.includes('home')) return 'home';
  if (lower.includes('side gig') || lower.includes('sidegig') || lower.includes('side-gig')) return 'sidegig';
  if (lower.includes('work')) return 'work';
  if (lower.includes('sleep')) return 'sleep';
  if (lower.includes('random')) return 'random';
  if (lower.includes('hobby')) return 'hobbies';
  if (lower.includes('travel') || lower.includes('adventure')) return 'travel';
  if (lower.includes('spirit')) return 'spiritual';
  if (lower.includes('chore')) return 'chores';
  if (lower.includes('rest') || lower.includes('recovery')) return 'rest';
  return 'default';
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
  // Numeric goal status mapping retained as-is
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

  // Strings: normalise and map to canonical display labels used app-wide
  const raw = String(status || '').trim();
  if (!raw) return 'Unknown';
  const v = raw.toLowerCase().replace(/_/g, '-');
  if (['backlog', 'todo', 'planned', 'new'].includes(v)) return 'Backlog';
  if (['in-progress', 'in progress', 'active', 'wip', 'testing', 'qa', 'review'].includes(v)) return 'In Progress';
  if (['blocked', 'paused', 'on-hold', 'onhold', 'stalled', 'waiting'].includes(v)) return 'Blocked';
  if (['done', 'complete', 'completed', 'closed', 'finished'].includes(v)) return 'Done';
  // Title-case fallback
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  const normalized = normalizePriorityValue(priority);
  switch (normalized) {
    case 4: return { bg: 'danger', text: 'Critical' };
    case 3: return { bg: 'danger', text: 'High' };
    case 2: return { bg: 'warning', text: 'Medium' };
    case 1: return { bg: 'secondary', text: 'Low' };
    default: return { bg: 'light', text: 'None' };
  }
};
