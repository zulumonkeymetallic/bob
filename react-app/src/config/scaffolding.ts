// BOB v3.5.2 - UI Scaffolding Routes Configuration
// Based on requirements from September 1st Business Analysis

export const BOB_ROUTES = {
  // Core Entity Management
  GOALS: {
    TABLE: '/goals/table',
    VISUALIZATION: '/goals/visualization'
  },
  
  STORIES: {
    TABLE: '/stories/table'
  },
  
  TASKS: {
    TABLE: '/tasks/table'
  },
  
  SPRINTS: {
    KANBAN: '/sprints/kanban',
    PLANNER: '/sprints/planner'
  },
  
  // Calendar & Time Management
  CALENDAR: {
    WEEK: '/calendar/week',
    DAY: '/calendar/day'
  },
  
  // New Features
  ROUTINES: '/routines',
  
  // Analytics & Reporting
  ANALYTICS: {
    ACTIVITY: '/analytics/activity',
    TIME: '/analytics/time'
  },
  
  // Configuration
  SETTINGS: {
    THEME: '/settings/theme',
    INTEGRATIONS: '/settings/integrations'
  }
};

// UI Components that need scaffolding
export const SCAFFOLD_COMPONENTS = [
  // Goals UI Components
  'GoalsTableView',
  'GoalsVisualizationView', // Roadmap Timeline
  
  // Stories UI Components  
  'StoriesTableView',
  
  // Tasks UI Components
  'TasksTableView',
  
  // Sprints UI Components
  'SprintsKanbanView', 
  'SprintsPlannerView', // 2D Matrix
  
  // Calendar UI Components
  'CalendarWeekView',
  'CalendarDayView',
  'CalendarBlockEditor',
  
  // Routines UI Components
  'RoutinesManagement',
  'RoutineEditor',
  'RoutineLogger',
  
  // Analytics UI Components
  'ActivityStreamAnalytics',
  'TimeAllocationAnalytics',
  
  // Settings UI Components
  'ThemeSettings',
  'IntegrationsSettings',
  
  // Shared UI Components
  'EntitySidebar', // Details, Activity, Comments tabs
  'ModernTableBase', // Virtualized table with inline editing
  'DragDropBoard', // For Kanban and Planner
  'DevConsoleDrawer', // ?debug=db
  
  // Goal Visualization Specific
  'GoalTimelineGrid',
  'GoalBar',
  'SprintMarker', 
  'InlineStoriesTable',
  'InlineTasksTable',
  'ConfirmationModal',
  'ShareModal',
  'PrintPreview'
];

// Database fields that need UI implementation
export const MISSING_FIELDS = {
  GOALS: [
    'timeAllocatedThisWeek', // FTR-04
    'thisWeekPercent', // FTR-04  
    'weeklyBreakdown', // FTR-04
    'subTheme', // Calendar blocks
    'conflictVersion', // Calendar blocks
    'supersededBy' // Calendar blocks
  ],
  
  STORIES: [
    'ref', // SCH-01
    'subGoalId', // SCH-01
    'plannedSprintId', // SCH-01
    'rank', // SCH-01
    'rankByLane', // SCH-01
    'rankByCell', // SCH-01
    'dragLockVersion', // SCH-01
    'taskCount', // SCH-01
    'doneTaskCount' // SCH-01
  ],
  
  TASKS: [
    'ref', // Auto-generated TASK-###
    'importanceScore', // SCH-02
    'isImportant', // SCH-02
    'reminderId', // iOS Reminders sync
    'rank' // SCH-02
  ],
  
  SPRINTS: [
    'ref', // Auto-generated Sprint references
    'objective', // SCH-03
    'notes', // SCH-03
    'orderIndex', // SCH-03
    'rank' // Alternative to orderIndex
  ],
  
  CALENDAR_BLOCKS: [
    'goalId', // New - direct goal linking
    'habitId', // For habit tracking
    'subTheme', // Granular theme tracking
    'googleEventId', // Bidirectional Google sync
    'isAiGenerated', // AI scheduling marker
    'conflictVersion', // Conflict resolution
    'supersededBy', // Block replacement tracking
    'durationMinutes' // Explicit duration
  ]
};

// CRUD Operations that need implementation
export const CRUD_OPERATIONS = {
  GOALS: {
    CREATE: 'Enhanced goal creation with all fields',
    READ: 'Goal table with time allocation columns', 
    UPDATE: 'Inline editing + bulk operations',
    DELETE: 'Soft delete with confirmation'
  },
  
  STORIES: {
    CREATE: 'Story creation with goal linking',
    READ: 'Stories table with sprint planning',
    UPDATE: 'Drag-drop sprint assignment',
    DELETE: 'Story deletion with task handling'
  },
  
  TASKS: {
    CREATE: 'Task creation with importance scoring',
    READ: 'Tasks table with reminders sync',
    UPDATE: 'iOS Reminders bidirectional sync', 
    DELETE: 'Task completion vs deletion'
  },
  
  SPRINTS: {
    CREATE: 'Sprint creation with objectives',
    READ: 'Sprint Kanban + Planner views',
    UPDATE: 'Sprint timeline adjustments',
    DELETE: 'Sprint closure with story handling'
  },
  
  CALENDAR_BLOCKS: {
    CREATE: 'Time block creation with Google sync',
    READ: 'Week/Day calendar grids',
    UPDATE: 'Block editing with conflict resolution',
    DELETE: 'Block deletion with Google cleanup'
  },
  
  ROUTINES: {
    CREATE: 'Routine creation with recurrence',
    READ: 'Routine management interface',
    UPDATE: 'Routine modification with history',
    DELETE: 'Routine archival vs deletion'
  }
};

export default {
  BOB_ROUTES,
  SCAFFOLD_COMPONENTS, 
  MISSING_FIELDS,
  CRUD_OPERATIONS
};
