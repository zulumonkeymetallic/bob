/**
 * Unified KPI Type System
 * Supports multiple KPI categories per goal: fitness, progress, financial, time, custom
 */

export type KpiType = 
  | 'fitness_steps'
  | 'fitness_running'
  | 'fitness_cycling'
  | 'fitness_swimming'
  | 'fitness_walking'
  | 'fitness_workouts'
  | 'story_points'         // Story point completion
  | 'tasks_completed'      // Task completion %
  | 'savings_target'       // Savings pot progress
  | 'budget_tracking'      // Budget progress
  | 'time_tracked'         // Hours/days spent
  | 'habit_streak'         // Day streak tracking
  | 'routine_compliance'   // Routine task adherence % (80% done over N days)
  | 'content_production'   // Articles/posts written (e.g., 2x/week)
  | 'custom';              // Custom numeric metric

export type KpiTimeframe = 'daily' | 'weekly' | 'monthly' | 'sprint' | 'quarterly' | 'annual';
export type KpiStatus = 'on-target' | 'good' | 'ok' | 'behind' | 'no-data' | 'not-started';
export type KpiAggregation = 'sum' | 'average' | 'min' | 'max' | 'count' | 'latest';
export type KpiTargetDirection = 'increase' | 'decrease' | 'maintain';
export type KpiVisualizationType = 'metric' | 'progress' | 'line' | 'bar' | 'table';
export type KpiDesignerMode = 'curated' | 'registry';
export type KpiSourceFieldType = 'number' | 'percentage' | 'duration' | 'count' | 'currency' | 'string' | 'date' | 'boolean';
export type KpiDataSource =
  | 'healthkit'
  | 'strava'
  | 'habit_occurrence'
  | 'manual_task'
  | 'user_input'
  | 'story_progress'
  | 'task_progress'
  | 'finance';

export interface MetricBinding {
  source: KpiDataSource;
  metricKey: string;
  fieldId?: string;
  collection?: string | null;
  fieldPath?: string | null;
  aggregation?: KpiAggregation;
  timeframe?: KpiTimeframe;
  dataType?: KpiSourceFieldType;
  unit?: string;
  label?: string;
}

/**
 * Base KPI interface - all KPI types extend this
 */
export interface BaseKpi {
  id: string;
  name: string;               // Display name: "Run 5km daily"
  description?: string;       // Optional explanation
  type: KpiType;              // KPI category
  timeframe: KpiTimeframe;    // Measurement period
  target: number;             // Target value
  unit: string;               // Unit of measurement: "km", "points", "$", "hours"
  baseline?: number | null;   // Optional starting value for trend display
  sourceId?: string;          // Canonical source key used by KPI designer
  sourceLabel?: string;       // Human-friendly source label
  metricId?: string;          // Canonical metric key used by KPI designer
  sourceCollection?: string;  // Firestore collection or logical source store
  sourceFieldPath?: string;   // Dot-path used by custom KPI builder
  sourceDataType?: KpiSourceFieldType;
  sourceMetricLabel?: string;
  designerMode?: KpiDesignerMode;
  sourcePriority?: KpiDataSource[];
  sourceBindings?: Partial<Record<KpiDataSource, MetricBinding>>;
  freshnessWindowHours?: number;
  resolvedSource?: KpiDataSource | null;
  resolvedAt?: any;
  sourceFreshness?: Partial<Record<KpiDataSource, any>>;
  metricKey?: string;
  aggregation?: KpiAggregation;
  targetDirection?: KpiTargetDirection;
  visualizationType?: KpiVisualizationType;
  displayOnDashboard?: boolean;
  
  // Runtime calculated fields (filled by sync)
  current?: number;           // Current progress
  progress?: number;          // Percentage (0-100+)
  status?: KpiStatus;         // Status badge
  lastUpdated?: any;          // Firebase Timestamp of last sync
  lastValue?: number;         // Last recorded value (for snapshots)
  
  // Metadata
  tags?: string[];            // User tags: ['focus-goal', 'running', etc]
  icon?: string;              // Icon name for UI: 'zap', 'heart', 'target', etc
  color?: string;             // Badge color: 'success', 'info', 'warning', 'danger'
}

/**
 * Fitness KPI - tracks Strava/HealthKit workouts
 */
export interface FitnessKpi extends BaseKpi {
  type: 'fitness_steps' | 'fitness_running' | 'fitness_cycling' | 'fitness_swimming' | 'fitness_walking' | 'fitness_workouts';
  source?: 'strava' | 'healthkit' | 'garmin' | 'fitbit';
  recentWorkoutCount?: number;  // How many workouts in the period
  weeklyPattern?: string;        // "MTWRFSS" showing which days active
}

/**
 * Progress KPI - tracks story points or task completion
 */
export interface ProgressKpi extends BaseKpi {
  type: 'story_points' | 'tasks_completed';
  goalId: string;              // Which goal this tracks
  linkedStories?: string[];    // Story IDs to aggregate
  linkedTasks?: string[];      // Task IDs to aggregate
  completedCount?: number;     // For tasks_completed: how many done
  totalCount?: number;         // For tasks_completed: total tasks
}

/**
 * Financial KPI - tracks savings or budget progress
 */
export interface FinancialKpi extends BaseKpi {
  type: 'savings_target' | 'budget_tracking';
  potId?: string;              // Monzo pot ID if applicable
  currencyCode?: string;       // 'GBP', 'USD', etc
  currentAmount?: number;      // Current saved/spent
  startingAmount?: number;     // Starting balance (for savings)
  categoryFilter?: string;     // Transaction category filter (for budget)
}

/**
 * Time KPI - tracks hours/days invested
 */
export interface TimeKpi extends BaseKpi {
  type: 'time_tracked';
  hoursLogged?: number;        // Total hours tracked
  daysActive?: number;         // Number of days worked on this
  averageDaily?: number;       // Average hours per day
  goalHoursPerDay?: number;    // Daily target
}

/**
 * Habit KPI - tracks streaks and consistency
 */
export interface HabitKpi extends BaseKpi {
  type: 'habit_streak';
  currentStreak?: number;      // Current day streak
  longestStreak?: number;      // Best streak ever
  completionDays?: string[];   // Dates when completed: ["2026-03-09", "2026-03-08", ...]
  weeklyGoal?: number;         // Target days per week (e.g., 5)
  weeklyCompletion?: number;   // Days completed this week
}

/**
 * Routine Compliance KPI - tracks adherence to linked routine tasks
 * Example: "22% body fat" driven by completing gym routine 80% of the last 100 days
 */
export interface RoutineComplianceKpi extends BaseKpi {
  type: 'routine_compliance';
  linkedRoutineIds?: string[];    // Which routine tasks to track
  lookbackDays: number;           // Evaluation window (e.g., 100 days)
  complianceThreshold: number;    // Target compliance % (e.g., 80%)
  completedDays?: number;         // Days routine was completed
  missedDays?: number;            // Days routine was missed
  compliancePercent?: number;     // Actual % compliance
  linkedMetric?: string;          // Physical metric this drives (e.g., "body fat %")
  linkedMetricCurrent?: number;   // Current value of linked metric (e.g., 22%)
  linkedMetricTarget?: number;    // Target value (e.g., 20%)
}

/**
 * Content Production KPI - tracks content creation consistency
 * Example: "Write Substack article 2x/week"
 */
export interface ContentProductionKpi extends BaseKpi {
  type: 'content_production';
  contentType: string;            // Type: 'article', 'post', 'video', 'podcast', etc
  platform?: string;              // Platform: 'substack', 'medium', 'linkedin', etc
  linkedTaskIds?: string[];       // Task IDs for content creation
  itemsProduced?: number;         // Number of items produced in period
  qualityScore?: number;          // Optional: 1-10 quality rating
  lastPublished?: any;            // Timestamp of last publication
  backlogCount?: number;          // Items in draft/backlog
}

/**
 * Union type for all KPI variants
 */
export type Kpi = 
  | FitnessKpi 
  | ProgressKpi 
  | FinancialKpi 
  | TimeKpi 
  | HabitKpi
  | RoutineComplianceKpi
  | ContentProductionKpi
  | CustomKpi;

/**
 * Custom KPI - user-defined numeric metric
 */
export interface CustomKpi extends BaseKpi {
  type: 'custom';
  formula?: string;            // Optional calculation formula
  dataSource?: 'manual' | 'formula' | 'external';  // How values are updated
  lastManualEntry?: number;    // Last manual input value
}

/**
 * KPI Sync Result
 */
export interface KpiSyncResult {
  kpiId: string;
  type: KpiType;
  success: boolean;
  error?: string;
  previousValue?: number;
  newValue?: number;
  previousStatus?: KpiStatus;
  newStatus?: KpiStatus;
  syncedAt?: any;  // Firebase Timestamp
}

/**
 * KPI Template for quick setup
 */
export interface KpiTemplate {
  id: string;
  name: string;
  description: string;
  type: KpiType;
  timeframe: KpiTimeframe;
  target: number;
  unit: string;
  icon: string;
  category: 'fitness' | 'progress' | 'financial' | 'time' | 'habit' | 'routine-driven' | 'content-production' | 'custom';
  examples?: string[];  // Example use cases
}

/**
 * Extended Goal interface compatible with new KPI system
 */
export interface GoalWithKpis {
  id: string;
  kpisV2?: Kpi[];              // New multi-type KPI system
  kpisLastSyncedAt?: any;      // Firebase Timestamp
  kpiSyncErrors?: string[];    // Errors from last sync
}
