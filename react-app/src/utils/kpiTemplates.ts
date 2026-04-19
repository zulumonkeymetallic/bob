/**
 * KPI Templates
 * Pre-configured KPI setups for common use cases
 */

import { KpiTemplate } from '../types/KpiTypes';

export const kpiTemplates: KpiTemplate[] = [
  // ====================
  // HEALTH & FITNESS
  // ====================
  {
    id: 'fitness_steps_daily',
    name: 'Walk 10k Steps Daily',
    description: 'Hit 10,000 steps per day from HealthKit',
    type: 'fitness_steps',
    timeframe: 'daily',
    target: 10000,
    unit: 'steps',
    icon: 'footprints',
    category: 'fitness',
    examples: ['Daily step goal', 'Sedentary lifestyle improvement']
  },
  {
    id: 'fitness_running_daily',
    name: 'Run 5km Daily',
    description: 'Complete a 5km run from Strava',
    type: 'fitness_running',
    timeframe: 'daily',
    target: 5,
    unit: 'km',
    icon: 'zap',
    category: 'fitness',
    examples: ['Daily running target', 'Marathon training']
  },
  {
    id: 'fitness_running_weekly',
    name: 'Run 30km Weekly',
    description: 'Complete 30km of running per week',
    type: 'fitness_running',
    timeframe: 'weekly',
    target: 30,
    unit: 'km',
    icon: 'zap',
    category: 'fitness',
    examples: ['Weekly mileage target', 'Race preparation']
  },
  {
    id: 'fitness_cycling_weekly',
    name: 'Cycle 100km Weekly',
    description: 'Cycle 100km per week',
    type: 'fitness_cycling',
    timeframe: 'weekly',
    target: 100,
    unit: 'km',
    icon: 'bike',
    category: 'fitness',
    examples: ['Weekly cycling target', 'Fitness improvement']
  },
  {
    id: 'fitness_workouts_weekly',
    name: '5 Workouts Weekly',
    description: 'Complete 5 workouts per week (any type)',
    type: 'fitness_workouts',
    timeframe: 'weekly',
    target: 5,
    unit: 'workouts',
    icon: 'dumbbell',
    category: 'fitness',
    examples: ['Weekly workout count', 'Consistent training']
  },

  // ====================
  // PROGRESS & GOALS
  // ====================
  {
    id: 'story_points_sprint',
    name: 'Complete Story Points This Sprint',
    description: 'Track % of story points completed',
    type: 'story_points',
    timeframe: 'sprint',
    target: 100,
    unit: '%',
    icon: 'target',
    category: 'progress',
    examples: ['Sprint planning', 'Development velocity']
  },
  {
    id: 'tasks_completed_sprint',
    name: '80% Tasks Done This Sprint',
    description: 'Complete 80% of planned tasks',
    type: 'tasks_completed',
    timeframe: 'sprint',
    target: 80,
    unit: '%',
    icon: 'check',
    category: 'progress',
    examples: ['Sprint completion', 'Task closure rate']
  },
  {
    id: 'tasks_completed_weekly',
    name: 'Complete 20 Tasks Weekly',
    description: 'Finish 20 tasks per week',
    type: 'tasks_completed',
    timeframe: 'weekly',
    target: 20,
    unit: 'tasks',
    icon: 'list-check',
    category: 'progress',
    examples: ['Weekly productivity', 'Task throughput']
  },

  // ====================
  // FINANCIAL
  // ====================
  {
    id: 'savings_quarterly',
    name: 'Save £5,000 This Quarter',
    description: 'Accumulate £5,000 in savings pot',
    type: 'savings_target',
    timeframe: 'quarterly',
    target: 5000,
    unit: 'GBP',
    icon: 'piggy-bank',
    category: 'financial',
    examples: ['Holiday fund', 'Emergency savings', 'Goal investment']
  },
  {
    id: 'savings_annual',
    name: 'Save £20,000 This Year',
    description: 'Accumulate £20,000 in annual savings',
    type: 'savings_target',
    timeframe: 'annual',
    target: 20000,
    unit: 'GBP',
    icon: 'piggy-bank',
    category: 'financial',
    examples: ['Annual savings goal', 'Down payment fund']
  },
  {
    id: 'budget_groceries_monthly',
    name: 'Keep Groceries Under £300/Month',
    description: 'Budget no more than £300 for groceries',
    type: 'budget_tracking',
    timeframe: 'monthly',
    target: 300,
    unit: 'GBP',
    icon: 'shopping-basket',
    category: 'financial',
    examples: ['Budget constraint', 'Spending control']
  },
  {
    id: 'budget_dining_monthly',
    name: 'Limit Dining Out to £200/Month',
    description: 'Spend no more than £200 on dining/restaurants',
    type: 'budget_tracking',
    timeframe: 'monthly',
    target: 200,
    unit: 'GBP',
    icon: 'utensils',
    category: 'financial',
    examples: ['Discretionary budget', 'Lifestyle spending']
  },

  // ====================
  // TIME & HABITS
  // ====================
  {
    id: 'time_learning_monthly',
    name: 'Learn 20 Hours This Month',
    description: 'Invest 20 hours in skill development',
    type: 'time_tracked',
    timeframe: 'monthly',
    target: 20,
    unit: 'hours',
    icon: 'book',
    category: 'time',
    examples: ['Skill building', 'Course completion', 'Self-improvement']
  },
  {
    id: 'time_project_sprint',
    name: 'Spend 40 Hours on Project This Sprint',
    description: 'Dedicate 40 hours to project work',
    type: 'time_tracked',
    timeframe: 'sprint',
    target: 40,
    unit: 'hours',
    icon: 'clock',
    category: 'time',
    examples: ['Project time allocation', 'Sprint commitment']
  },
  {
    id: 'habit_meditation_daily',
    name: 'Meditate Daily (10-day streak)',
    description: 'Maintain a 10-day meditation streak',
    type: 'habit_streak',
    timeframe: 'daily',
    target: 10,
    unit: 'days',
    icon: 'leaf',
    category: 'habit',
    examples: ['Daily habit building', 'Consistency tracking']
  },
  {
    id: 'habit_reading_weekly',
    name: 'Read 3 Days Per Week',
    description: 'Read on at least 3 days per week',
    type: 'habit_streak',
    timeframe: 'weekly',
    target: 3,
    unit: 'days',
    icon: 'book-open',
    category: 'habit',
    examples: ['Reading consistency', 'Learning habit']
  },

  // ====================
  // ROUTINE-DRIVEN (linked to actual outcomes)
  // ====================
  {
    id: 'routine_gym_bodyfat',
    name: 'Reduce Body Fat to 20% (via gym routine)',
    description: 'Achieve 20% body fat by maintaining 80% gym routine adherence over 100 days',
    type: 'routine_compliance',
    timeframe: 'quarterly',
    target: 80,
    unit: '%',
    icon: 'dumbbell',
    category: 'routine-driven',
    examples: ['Body composition transformation', 'Gym routine adherence']
  },
  {
    id: 'routine_meal_prep',
    name: 'Maintain Meal Prep 90% Adherence',
    description: 'Stick to meal prep routine 90% of days (align with 1800 cal budget)',
    type: 'routine_compliance',
    timeframe: 'monthly',
    target: 90,
    unit: '%',
    icon: 'utensils',
    category: 'routine-driven',
    examples: ['Nutrition consistency', 'Dietary habit building']
  },
  {
    id: 'routine_sleep_hygiene',
    name: 'Sleep Routine 85% Adherence',
    description: 'Follow sleep routine 85% of nights (bed by 11pm, 8hr sleep)',
    type: 'routine_compliance',
    timeframe: 'monthly',
    target: 85,
    unit: '%',
    icon: 'moon',
    category: 'routine-driven',
    examples: ['Sleep consistency', 'Recovery improvement']
  },

  // ====================
  // CONTENT PRODUCTION
  // ====================
  {
    id: 'content_substack_weekly',
    name: 'Write Substack Article 2x/Week',
    description: 'Publish 2 articles to Substack per week',
    type: 'content_production',
    timeframe: 'weekly',
    target: 2,
    unit: 'articles',
    icon: 'pencil',
    category: 'content-production',
    examples: ['Transformation journey documentation', 'Thought leadership']
  },
  {
    id: 'content_blog_monthly',
    name: 'Publish 4 Blog Posts Monthly',
    description: 'Write and publish 4 blog posts per month',
    type: 'content_production',
    timeframe: 'monthly',
    target: 4,
    unit: 'posts',
    icon: 'file-text',
    category: 'content-production',
    examples: ['Content strategy', 'Audience engagement']
  },
  {
    id: 'content_podcast_monthly',
    name: 'Record 2 Podcast Episodes Monthly',
    description: 'Record and publish 2 podcast episodes per month',
    type: 'content_production',
    timeframe: 'monthly',
    target: 2,
    unit: 'episodes',
    icon: 'radio',
    category: 'content-production',
    examples: ['Podcast consistency', 'Personal brand']
  },
  {
    id: 'content_linkedin_weekly',
    name: 'Post to LinkedIn 3x/Week',
    description: 'Share insights and updates to LinkedIn 3 times per week',
    type: 'content_production',
    timeframe: 'weekly',
    target: 3,
    unit: 'posts',
    icon: 'share2',
    category: 'content-production',
    examples: ['Professional networking', 'Thought leadership']
  },
];

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: string): KpiTemplate[] {
  return kpiTemplates.filter(t => t.category === category);
}

/**
 * Get template by ID
 */
export function getTemplateById(id: string): KpiTemplate | undefined {
  return kpiTemplates.find(t => t.id === id);
}

/**
 * Get all unique categories
 */
export function getTemplateCategories(): string[] {
  const categories = new Set(kpiTemplates.map(t => t.category));
  return Array.from(categories).sort();
}
