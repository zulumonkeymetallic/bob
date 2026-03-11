/**
 * KPI Handler System
 * Each KPI type has its own handler for sync/calculation logic
 */

import { Kpi, KpiStatus, BaseKpi, ProgressKpi, FinancialKpi, TimeKpi, FitnessKpi } from '../types/KpiTypes';

export interface KpiHandlerResult {
  current: number;
  progress: number;
  status: KpiStatus;
  metadata?: any;
}

/**
 * Base handler interface
 */
export abstract class KpiHandler {
  abstract type: string;
  abstract sync(kpi: Kpi, context: KpiContext): Promise<KpiHandlerResult>;
  
  /**
   * Calculate status based on progress percentage
   */
  protected calculateStatus(progress: number): KpiStatus {
    if (progress < 0) return 'no-data';
    if (progress >= 100) return 'on-target';
    if (progress >= 80) return 'good';
    if (progress >= 50) return 'ok';
    return 'behind';
  }
}

/**
 * Context passed to handlers
 */
export interface KpiContext {
  userId: string;
  goalId?: string;
  db?: any;  // Firebase DB instance
  data?: {
    stories?: any[];     // Related stories
    tasks?: any[];       // Related tasks
    workouts?: any[];    // Fitness workouts
    transactions?: any[]; // Financial transactions
    [key: string]: any;
  };
}

/**
 * Story Points Handler
 * Calculates % of story points completed for a goal
 */
export class StoryPointsHandler extends KpiHandler {
  type = 'story_points';

  async sync(kpi: ProgressKpi, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const stories = context.data?.stories || [];
      
      // Filter to linked stories if specified
      let targetStories = stories;
      if (kpi.linkedStories?.length) {
        targetStories = stories.filter(s => kpi.linkedStories?.includes(s.id));
      }

      // Calculate total points and completed points
      const totalPoints = targetStories.reduce((sum, s) => sum + (s.points || 0), 0);
      const completedPoints = targetStories
        .filter(s => s.status === 4) // status 4 = Done
        .reduce((sum, s) => sum + (s.points || 0), 0);

      const progress = totalPoints === 0 ? 0 : Math.round((completedPoints / totalPoints) * 100);

      return {
        current: completedPoints,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          totalPoints,
          completedPoints,
          storiesCount: targetStories.length,
          completedCount: targetStories.filter(s => s.status === 4).length
        }
      };
    } catch (error) {
      console.error('Story points sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * Tasks Completed Handler
 * Calculates % of tasks completed
 */
export class TasksCompletedHandler extends KpiHandler {
  type = 'tasks_completed';

  async sync(kpi: ProgressKpi, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const tasks = context.data?.tasks || [];

      // Filter to linked tasks if specified
      let targetTasks = tasks;
      if (kpi.linkedTasks?.length) {
        targetTasks = tasks.filter(t => kpi.linkedTasks?.includes(t.id));
      }

      const totalTasks = targetTasks.length;
      const completedTasks = targetTasks.filter(t => t.status === 4).length;

      const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

      return {
        current: completedTasks,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          totalTasks,
          completedTasks,
          remainingTasks: totalTasks - completedTasks
        }
      };
    } catch (error) {
      console.error('Tasks completed sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * Savings Target Handler
 * Calculates % of savings goal reached
 */
export class SavingsTargetHandler extends KpiHandler {
  type = 'savings_target';

  async sync(kpi: FinancialKpi, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const transactions = context.data?.transactions || [];
      
      // Sum up transactions for the pot (if potId specified)
      let currentAmount = kpi.currentAmount || 0;
      
      if (kpi.potId && transactions.length > 0) {
        const potTransactions = transactions.filter(t => t.potId === kpi.potId);
        currentAmount = potTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      }

      const progress = kpi.target === 0 ? 0 : Math.round((currentAmount / kpi.target) * 100);

      return {
        current: currentAmount,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          targetAmount: kpi.target,
          remaining: Math.max(0, kpi.target - currentAmount),
          percentOfTarget: progress,
          currencyCode: kpi.currencyCode || 'GBP'
        }
      };
    } catch (error) {
      console.error('Savings target sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * Budget Tracking Handler
 * Calculates % of budget spent
 */
export class BudgetTrackingHandler extends KpiHandler {
  type = 'budget_tracking';

  async sync(kpi: FinancialKpi, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const transactions = context.data?.transactions || [];

      // Filter transactions by category and sum
      let spent = 0;
      if (kpi.categoryFilter) {
        spent = transactions
          .filter(t => t.category === kpi.categoryFilter)
          .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
      } else {
        spent = transactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
      }

      const progress = kpi.target === 0 ? 0 : Math.round((spent / kpi.target) * 100);

      return {
        current: spent,
        progress,
        status: progress <= 100 ? this.calculateStatus(progress) : 'behind',
        metadata: {
          budgetLimit: kpi.target,
          spent,
          remaining: Math.max(0, kpi.target - spent),
          category: kpi.categoryFilter,
          currencyCode: kpi.currencyCode || 'GBP'
        }
      };
    } catch (error) {
      console.error('Budget tracking sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * Fitness Handler (Generic)
 * Calculates fitness KPI progress from workouts
 */
export class FitnessHandler extends KpiHandler {
  type = 'fitness_generic';

  async sync(kpi: FitnessKpi, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const workouts = context.data?.workouts || [];

      let totalValue = 0;
      let workoutCount = 0;

      // Map KPI type to workout data extraction
      const kpiType = kpi.type;

      for (const workout of workouts) {
        if (kpiType === 'fitness_steps' && workout.steps) {
          totalValue += workout.steps;
          workoutCount++;
        } else if (kpiType === 'fitness_running' && workout.runningDistance) {
          totalValue += workout.runningDistance;
          workoutCount++;
        } else if (kpiType === 'fitness_cycling' && workout.cyclingDistance) {
          totalValue += workout.cyclingDistance;
          workoutCount++;
        } else if (kpiType === 'fitness_swimming' && workout.swimmingDistance) {
          totalValue += workout.swimmingDistance;
          workoutCount++;
        } else if (kpiType === 'fitness_walking' && workout.walkingDistance) {
          totalValue += workout.walkingDistance;
          workoutCount++;
        } else if (kpiType === 'fitness_workouts') {
          totalValue = workouts.length;
        }
      }

      const progress = kpi.target === 0 ? 0 : Math.round((totalValue / kpi.target) * 100);

      return {
        current: totalValue,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          targetValue: kpi.target,
          workoutCount,
          weeklyPattern: this.calculateWeeklyPattern(workouts),
          unit: kpi.unit
        }
      };
    } catch (error) {
      console.error('Fitness sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }

  private calculateWeeklyPattern(workouts: any[]): string {
    const pattern = ['M', 'T', 'W', 'R', 'F', 'S', 'S'];
    const seen = new Set();

    for (const workout of workouts) {
      if (workout.date) {
        const date = new Date(workout.date);
        const dayOfWeek = date.getDay();
        seen.add(pattern[dayOfWeek === 0 ? 6 : dayOfWeek - 1]);
      }
    }

    return Array.from(seen).join('');
  }
}

/**
 * Time Tracked Handler
 * Calculates hours/days invested in a goal
 */
export class TimeTrackedHandler extends KpiHandler {
  type = 'time_tracked';

  async sync(kpi: TimeKpi, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      // This would typically come from time tracking data or logged entries
      const hoursLogged = kpi.hoursLogged || 0;
      const daysActive = kpi.daysActive || 0;

      // Calculate progress toward target (in hours or days)
      const progress = kpi.target === 0 ? 0 : Math.round((hoursLogged / kpi.target) * 100);

      return {
        current: hoursLogged,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          hoursLogged,
          daysActive,
          averageDaily: daysActive === 0 ? 0 : hoursLogged / daysActive,
          unit: kpi.unit // 'hours' or 'days'
        }
      };
    } catch (error) {
      console.error('Time tracked sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * Habit Streak Handler
 * Calculates streak and completion
 */
export class HabitStreakHandler extends KpiHandler {
  type = 'habit_streak';

  async sync(kpi: any, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const currentStreak = kpi.currentStreak || 0;
      const weeklyGoal = kpi.weeklyGoal || 7;
      const weeklyCompletion = kpi.weeklyCompletion || 0;

      // Progress based on weekly completion
      const progress = Math.round((weeklyCompletion / weeklyGoal) * 100);

      return {
        current: currentStreak,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          currentStreak,
          longestStreak: kpi.longestStreak || 0,
          weeklyGoal,
          weeklyCompletion,
          percentOfWeeklyGoal: progress
        }
      };
    } catch (error) {
      console.error('Habit streak sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * Routine Compliance Handler
 * Tracks adherence to linked routine tasks
 * Example: "22% body fat" driven by gym routine completion 80% over 100 days
 */
export class RoutineComplianceHandler extends KpiHandler {
  type = 'routine_compliance';

  async sync(kpi: any, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const tasks = context.data?.tasks || [];
      
      // Get routine tasks completed in lookback window
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - (kpi.lookbackDays || 100));

      const tasksInWindow = tasks.filter(t => {
        const taskDate = t.completedAt ? new Date(t.completedAt.toDate?.()) : null;
        return taskDate && taskDate >= lookbackDate;
      });

      const linkedRoutineIds = kpi.linkedRoutineIds || [];
      let completedCount = 0;

      for (const task of tasksInWindow) {
        if (linkedRoutineIds.includes(task.id) && task.status === 4) {
          completedCount++;
        }
      }

      // Calculate compliance % (completed out of expected based on lookback days)
      const lookbackDays = kpi.lookbackDays || 100;
      const expectedCount = lookbackDays; // Assume daily routine
      const compliancePercent = lookbackDays === 0 ? 0 : Math.round((completedCount / lookbackDays) * 100);

      // Use compliance percentage as progress toward target threshold
      const threshold = kpi.complianceThreshold || 80;
      const progress = Math.min(100, Math.round((compliancePercent / threshold) * 100));

      return {
        current: completedCount,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          completedDays: completedCount,
          totalDays: lookbackDays,
          compliancePercent,
          complianceThreshold: threshold,
          linkedMetric: kpi.linkedMetric || 'body composition',
          linkedMetricCurrent: kpi.linkedMetricCurrent,
          linkedMetricTarget: kpi.linkedMetricTarget
        }
      };
    } catch (error) {
      console.error('Routine compliance sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * Content Production Handler
 * Tracks content creation and publication consistency
 * Example: "Write Substack article 2x/week"
 */
export class ContentProductionHandler extends KpiHandler {
  type = 'content_production';

  async sync(kpi: any, context: KpiContext): Promise<KpiHandlerResult> {
    try {
      const tasks = context.data?.tasks || [];
      
      // Get content tasks completed in this period
      const periodStart = new Date();
      
      // Adjust period based on timeframe
      if (kpi.timeframe === 'weekly') {
        periodStart.setDate(periodStart.getDate() - 7);
      } else if (kpi.timeframe === 'monthly') {
        periodStart.setMonth(periodStart.getMonth() - 1);
      } else if (kpi.timeframe === 'sprint') {
        periodStart.setDate(periodStart.getDate() - 14);
      }

      const linkedTaskIds = kpi.linkedTaskIds || [];
      const completedTasks = tasks.filter(t => 
        linkedTaskIds.includes(t.id) && 
        t.status === 4 && 
        t.completedAt && 
        new Date(t.completedAt.toDate?.()) >= periodStart
      );

      const itemsProduced = completedTasks.length;
      const progress = kpi.target === 0 ? 0 : Math.round((itemsProduced / kpi.target) * 100);

      return {
        current: itemsProduced,
        progress,
        status: this.calculateStatus(progress),
        metadata: {
          itemsProduced,
          target: kpi.target,
          contentType: kpi.contentType,
          platform: kpi.platform,
          backlogCount: kpi.backlogCount || 0,
          lastPublished: kpi.lastPublished,
          qualityScore: kpi.qualityScore
        }
      };
    } catch (error) {
      console.error('Content production sync error:', error);
      return { current: 0, progress: 0, status: 'no-data' };
    }
  }
}

/**
 * KPI Handler Registry
 * Maps KPI types to their handlers
 */
export class KpiHandlerRegistry {
  private handlers: Map<string, KpiHandler> = new Map();

  constructor() {
    // Register all handlers
    this.register(new StoryPointsHandler());
    this.register(new TasksCompletedHandler());
    this.register(new SavingsTargetHandler());
    this.register(new BudgetTrackingHandler());
    this.register(new FitnessHandler());
    this.register(new TimeTrackedHandler());
    this.register(new HabitStreakHandler());
    this.register(new RoutineComplianceHandler());
    this.register(new ContentProductionHandler());
  }

  register(handler: KpiHandler) {
    // Register for all fitness types if generic fitness handler
    if (handler.type === 'fitness_generic') {
      const fitnessTypes = ['fitness_steps', 'fitness_running', 'fitness_cycling', 'fitness_swimming', 'fitness_walking', 'fitness_workouts'];
      fitnessTypes.forEach(type => this.handlers.set(type, handler));
    } else {
      this.handlers.set(handler.type, handler);
    }
  }

  getHandler(type: string): KpiHandler | undefined {
    return this.handlers.get(type);
  }

  async syncKpi(kpi: Kpi, context: KpiContext): Promise<KpiHandlerResult> {
    const handler = this.getHandler(kpi.type);
    if (!handler) {
      console.warn(`No handler found for KPI type: ${kpi.type}`);
      return { current: 0, progress: 0, status: 'no-data' };
    }
    return handler.sync(kpi, context);
  }
}

// Singleton registry
export const kpiRegistry = new KpiHandlerRegistry();
