import type {
  KpiAggregation,
  KpiTargetDirection,
  KpiSourceFieldType,
  KpiTimeframe,
  KpiType,
  KpiVisualizationType,
} from '../types/KpiTypes';

export interface KpiFieldCatalogEntry {
  id: string;
  label: string;
  fieldPath: string;
  collection: string;
  dataType: KpiSourceFieldType;
  unit?: string;
  description: string;
}

export interface KpiMetricCatalogEntry {
  id: string;
  label: string;
  description: string;
  kpiType: KpiType;
  unit: string;
  defaultTarget: number;
  defaultTimeframe: KpiTimeframe;
  defaultAggregation: KpiAggregation;
  defaultTargetDirection: KpiTargetDirection;
  defaultVisualization: KpiVisualizationType;
  tags?: string[];
}

export interface KpiSourceCatalogEntry {
  id: string;
  label: string;
  description: string;
  metrics: KpiMetricCatalogEntry[];
  fields: KpiFieldCatalogEntry[];
}

export const KPI_VISUALIZATION_OPTIONS: Array<{ value: KpiVisualizationType; label: string; description: string }> = [
  { value: 'metric', label: 'Metric card', description: 'Single headline value with goal context.' },
  { value: 'progress', label: 'Progress card', description: 'Headline value with progress bar to target.' },
  { value: 'line', label: 'Line chart', description: 'Show recent weekly trend as a sparkline.' },
  { value: 'bar', label: 'Bar chart', description: 'Show recent buckets as compact bars.' },
  { value: 'table', label: 'Table', description: 'Best for operational count-style KPIs.' },
];

export const KPI_SOURCE_CATALOG: KpiSourceCatalogEntry[] = [
  {
    id: 'healthkit',
    label: 'HealthKit',
    description: 'Apple Health metrics already mirrored into BOB profiles and workouts.',
    fields: [
      {
        id: 'profile_steps_today',
        label: 'Steps today',
        fieldPath: 'healthkitStepsToday',
        collection: 'profiles',
        dataType: 'count',
        unit: 'steps',
        description: 'Today step count from profile snapshot.',
      },
      {
        id: 'profile_workout_minutes',
        label: 'Workout minutes today',
        fieldPath: 'healthkitWorkoutMinutesToday',
        collection: 'profiles',
        dataType: 'duration',
        unit: 'minutes',
        description: 'Daily workout minutes mirrored to profile.',
      },
      {
        id: 'profile_body_fat',
        label: 'Body fat %',
        fieldPath: 'healthkitBodyFatPct',
        collection: 'profiles',
        dataType: 'percentage',
        unit: '%',
        description: 'Body composition percentage from HealthKit.',
      },
      {
        id: 'profile_calories',
        label: 'Calories today',
        fieldPath: 'healthkitCaloriesTodayKcal',
        collection: 'profiles',
        dataType: 'number',
        unit: 'kcal',
        description: 'Daily calories consumed or burned in profile snapshot.',
      },
      {
        id: 'profile_protein',
        label: 'Protein today',
        fieldPath: 'healthkitProteinTodayG',
        collection: 'profiles',
        dataType: 'number',
        unit: 'g',
        description: 'Protein intake from HealthKit import.',
      },
    ],
    metrics: [
      {
        id: 'steps_daily',
        label: 'Daily steps',
        description: 'Track step count from HealthKit profile metrics.',
        kpiType: 'fitness_steps',
        unit: 'steps',
        defaultTarget: 10000,
        defaultTimeframe: 'daily',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'progress',
        tags: ['health', 'habit'],
      },
      {
        id: 'workout_minutes_daily',
        label: 'Workout minutes',
        description: 'Daily active workout minutes sourced from HealthKit/profile snapshots.',
        kpiType: 'time_tracked',
        unit: 'minutes',
        defaultTarget: 60,
        defaultTimeframe: 'daily',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'metric',
        tags: ['health', 'time'],
      },
      {
        id: 'body_fat_pct',
        label: 'Body fat %',
        description: 'Track body composition reduction or maintenance.',
        kpiType: 'custom',
        unit: '%',
        defaultTarget: 20,
        defaultTimeframe: 'monthly',
        defaultAggregation: 'latest',
        defaultTargetDirection: 'decrease',
        defaultVisualization: 'line',
        tags: ['health', 'body-composition'],
      },
      {
        id: 'sleep_hours',
        label: 'Sleep duration',
        description: 'Track nightly sleep hours against recovery goals.',
        kpiType: 'custom',
        unit: 'hours',
        defaultTarget: 8,
        defaultTimeframe: 'daily',
        defaultAggregation: 'average',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'line',
        tags: ['health', 'recovery'],
      },
    ],
  },
  {
    id: 'strava',
    label: 'Strava',
    description: 'Workout distance and session counts already syncing into workouts.',
    fields: [
      {
        id: 'workouts_running_distance',
        label: 'Running distance',
        fieldPath: 'runningDistance',
        collection: 'workouts',
        dataType: 'number',
        unit: 'km',
        description: 'Running distance stored per workout.',
      },
      {
        id: 'workouts_cycling_distance',
        label: 'Cycling distance',
        fieldPath: 'cyclingDistance',
        collection: 'workouts',
        dataType: 'number',
        unit: 'km',
        description: 'Cycling distance stored per workout.',
      },
      {
        id: 'workouts_swimming_distance',
        label: 'Swimming distance',
        fieldPath: 'swimmingDistance',
        collection: 'workouts',
        dataType: 'number',
        unit: 'km',
        description: 'Swimming distance stored per workout.',
      },
      {
        id: 'workouts_step_count',
        label: 'Step count',
        fieldPath: 'stepCount',
        collection: 'workouts',
        dataType: 'count',
        unit: 'steps',
        description: 'Step count recorded on workout docs.',
      },
      {
        id: 'workouts_provider',
        label: 'Provider',
        fieldPath: 'provider',
        collection: 'workouts',
        dataType: 'string',
        description: 'Workout provider such as Strava or HealthKit.',
      },
    ],
    metrics: [
      {
        id: 'running_distance',
        label: 'Running distance',
        description: 'Running distance per period from Strava or workouts.',
        kpiType: 'fitness_running',
        unit: 'km',
        defaultTarget: 10,
        defaultTimeframe: 'daily',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'line',
        tags: ['fitness', 'running'],
      },
      {
        id: 'cycling_distance',
        label: 'Cycling distance',
        description: 'Cycling distance per period.',
        kpiType: 'fitness_cycling',
        unit: 'km',
        defaultTarget: 100,
        defaultTimeframe: 'weekly',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'line',
        tags: ['fitness', 'cycling'],
      },
      {
        id: 'swimming_distance',
        label: 'Swimming distance',
        description: 'Swimming distance per period.',
        kpiType: 'fitness_swimming',
        unit: 'km',
        defaultTarget: 2,
        defaultTimeframe: 'weekly',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'line',
        tags: ['fitness', 'swimming'],
      },
      {
        id: 'workout_count',
        label: 'Workout count',
        description: 'Count workouts completed in the period.',
        kpiType: 'fitness_workouts',
        unit: 'workouts',
        defaultTarget: 5,
        defaultTimeframe: 'weekly',
        defaultAggregation: 'count',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'bar',
        tags: ['fitness', 'consistency'],
      },
    ],
  },
  {
    id: 'habits',
    label: 'Habit tracking',
    description: 'Habit streaks and completion consistency from BOB habits and entries.',
    fields: [
      {
        id: 'habit_entries_value',
        label: 'Habit entry value',
        fieldPath: 'value',
        collection: 'habit_entries',
        dataType: 'number',
        description: 'Recorded value for a habit entry.',
      },
      {
        id: 'habit_entries_complete',
        label: 'Habit entry completed',
        fieldPath: 'isCompleted',
        collection: 'habit_entries',
        dataType: 'boolean',
        description: 'Completion status on habit entry.',
      },
      {
        id: 'habits_target_value',
        label: 'Habit target value',
        fieldPath: 'targetValue',
        collection: 'habits',
        dataType: 'number',
        description: 'Configured target per habit.',
      },
      {
        id: 'routines_completion_dates',
        label: 'Routine completion dates',
        fieldPath: 'completionDates',
        collection: 'routines',
        dataType: 'count',
        description: 'Dates completed for routines.',
      },
    ],
    metrics: [
      {
        id: 'habit_streak',
        label: 'Habit streak',
        description: 'Track streak length or days completed this week.',
        kpiType: 'habit_streak',
        unit: 'days',
        defaultTarget: 7,
        defaultTimeframe: 'weekly',
        defaultAggregation: 'count',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'progress',
        tags: ['habit', 'consistency'],
      },
      {
        id: 'routine_compliance',
        label: 'Routine compliance',
        description: 'Measure adherence to routines over a rolling window.',
        kpiType: 'routine_compliance',
        unit: '%',
        defaultTarget: 80,
        defaultTimeframe: 'quarterly',
        defaultAggregation: 'average',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'progress',
        tags: ['routine', 'consistency'],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance / Monzo',
    description: 'Budget, savings, and transaction-derived KPIs.',
    fields: [
      {
        id: 'transactions_amount',
        label: 'Transaction amount',
        fieldPath: 'amount',
        collection: 'monzo_transactions',
        dataType: 'currency',
        unit: 'GBP',
        description: 'Amount per Monzo transaction.',
      },
      {
        id: 'transactions_category',
        label: 'Transaction category',
        fieldPath: 'userCategoryType',
        collection: 'monzo_transactions',
        dataType: 'string',
        description: 'Resolved transaction category.',
      },
      {
        id: 'transactions_pot',
        label: 'Pot id',
        fieldPath: 'potId',
        collection: 'monzo_transactions',
        dataType: 'string',
        description: 'Linked pot id on transactions.',
      },
      {
        id: 'budget_optional',
        label: 'Optional spend total',
        fieldPath: 'totals.optional',
        collection: 'monzo_budget_summary',
        dataType: 'currency',
        unit: 'GBP',
        description: 'Optional/discretionary spend from budget summary.',
      },
      {
        id: 'budget_mandatory',
        label: 'Mandatory spend total',
        fieldPath: 'totals.mandatory',
        collection: 'monzo_budget_summary',
        dataType: 'currency',
        unit: 'GBP',
        description: 'Mandatory spend from budget summary.',
      },
    ],
    metrics: [
      {
        id: 'savings_target',
        label: 'Savings target',
        description: 'Track how much of a goal funding target is already saved.',
        kpiType: 'savings_target',
        unit: 'GBP',
        defaultTarget: 5000,
        defaultTimeframe: 'quarterly',
        defaultAggregation: 'latest',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'progress',
        tags: ['finance', 'savings'],
      },
      {
        id: 'budget_tracking',
        label: 'Budget tracking',
        description: 'Keep category or discretionary spending below a ceiling.',
        kpiType: 'budget_tracking',
        unit: 'GBP',
        defaultTarget: 300,
        defaultTimeframe: 'monthly',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'decrease',
        defaultVisualization: 'bar',
        tags: ['finance', 'budget'],
      },
    ],
  },
  {
    id: 'execution',
    label: 'Execution progress',
    description: 'Stories, tasks, and planned time already tracked inside BOB.',
    fields: [
      {
        id: 'stories_points',
        label: 'Story points',
        fieldPath: 'points',
        collection: 'stories',
        dataType: 'number',
        unit: 'points',
        description: 'Story points per story.',
      },
      {
        id: 'stories_status',
        label: 'Story status',
        fieldPath: 'status',
        collection: 'stories',
        dataType: 'count',
        description: 'Current status of the story.',
      },
      {
        id: 'tasks_status',
        label: 'Task status',
        fieldPath: 'status',
        collection: 'tasks',
        dataType: 'count',
        description: 'Current status of the task.',
      },
      {
        id: 'tasks_estimate_minutes',
        label: 'Task estimate minutes',
        fieldPath: 'estimateMin',
        collection: 'tasks',
        dataType: 'duration',
        unit: 'minutes',
        description: 'Estimated task duration.',
      },
      {
        id: 'calendar_duration',
        label: 'Calendar block duration',
        fieldPath: 'durationHours',
        collection: 'calendar_blocks',
        dataType: 'duration',
        unit: 'hours',
        description: 'Hours implied by calendar block start/end.',
      },
    ],
    metrics: [
      {
        id: 'story_points',
        label: 'Story points complete',
        description: 'Track closed story points for the linked goal or sprint.',
        kpiType: 'story_points',
        unit: '%',
        defaultTarget: 100,
        defaultTimeframe: 'sprint',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'progress',
        tags: ['stories', 'delivery'],
      },
      {
        id: 'tasks_completed',
        label: 'Tasks completed',
        description: 'Track task throughput for the linked goal or sprint.',
        kpiType: 'tasks_completed',
        unit: 'tasks',
        defaultTarget: 20,
        defaultTimeframe: 'weekly',
        defaultAggregation: 'count',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'bar',
        tags: ['tasks', 'delivery'],
      },
      {
        id: 'time_tracked',
        label: 'Time invested',
        description: 'Track time blocks or planned hours against a goal.',
        kpiType: 'time_tracked',
        unit: 'hours',
        defaultTarget: 10,
        defaultTimeframe: 'weekly',
        defaultAggregation: 'sum',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'line',
        tags: ['time', 'focus'],
      },
    ],
  },
  {
    id: 'manual',
    label: 'Manual / custom',
    description: 'Use for metrics that do not yet have a first-class sync source.',
    fields: [
      {
        id: 'manual_numeric',
        label: 'Manual numeric value',
        fieldPath: 'manual',
        collection: 'manual',
        dataType: 'number',
        description: 'User-maintained numeric metric.',
      },
    ],
    metrics: [
      {
        id: 'custom_metric',
        label: 'Custom metric',
        description: 'Track a numeric KPI manually or via future automation.',
        kpiType: 'custom',
        unit: 'value',
        defaultTarget: 1,
        defaultTimeframe: 'weekly',
        defaultAggregation: 'latest',
        defaultTargetDirection: 'increase',
        defaultVisualization: 'metric',
        tags: ['manual'],
      },
    ],
  },
];

export const findKpiSource = (sourceId: string | null | undefined): KpiSourceCatalogEntry | undefined =>
  KPI_SOURCE_CATALOG.find((source) => source.id === sourceId);

export const findKpiMetric = (
  sourceId: string | null | undefined,
  metricId: string | null | undefined,
): KpiMetricCatalogEntry | undefined => {
  const source = findKpiSource(sourceId);
  if (!source) return undefined;
  return source.metrics.find((metric) => metric.id === metricId);
};

export const findKpiField = (
  sourceId: string | null | undefined,
  fieldId: string | null | undefined,
): KpiFieldCatalogEntry | undefined => {
  const source = findKpiSource(sourceId);
  if (!source) return undefined;
  return source.fields.find((field) => field.id === fieldId);
};
