/**
 * Multi-Type KPI System - Firestore Schema Reference
 * 
 * This document outlines the complete Firestore data structure
 * for the unified multi-type KPI system supporting:
 * - Fitness tracking
 * - Progress metrics (story points, tasks)
 * - Financial tracking (savings, budgets)
 * - Time tracking
 * - Habit streaks
 * - Routine compliance (NEW)
 * - Content production (NEW)
 */

// ============================================================================
// GOALS COLLECTION - Extended with KPIs V2
// ============================================================================

db.collection('goals').doc('{goalId}').set({
  // Existing fields
  id: string,
  persona: 'personal' | 'work',
  title: string,
  description: string,
  theme: number,                    // 1-5
  size: number,
  confidence: number,
  status: number,                   // 0-4
  ownerUid: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,

  // NEW: Multi-type KPIs (kpisV2)
  kpisV2: [
    // ========================================================================
    // KPI TYPE: routine_compliance
    // Tracks adherence to routine tasks and their impact on outcomes
    // ========================================================================
    {
      id: string,                           // Unique within goal
      name: string,                         // "Gym Routine Adherence"
      description: string,
      type: 'routine_compliance',
      timeframe: 'daily' | 'weekly' | 'monthly' | 'sprint' | 'quarterly' | 'annual',
      target: number,                       // 80 (for 80% compliance)
      unit: string,                         // "%"

      // Routine tracking
      linkedRoutineIds: string[],           // ["routine-gym-3x-weekly"]
      lookbackDays: number,                 // 100 (evaluate over 100 days)
      complianceThreshold: number,          // 80 (target compliance %)
      completedDays: number,                // 82 (days routine was completed)
      missedDays: number,                   // 18 (days routine was missed)
      compliancePercent: number,            // 82 (auto-calculated: 82/100*100)

      // Linked physical outcome
      linkedMetric: string,                 // "body_fat_percent"
      linkedMetricCurrent: number,          // 22 (current body fat %)
      linkedMetricTarget: number,           // 20 (target body fat %)

      // KPI status
      current: number,                      // 82 (days completed)
      progress: number,                     // 102 (% of target: 82/80*100)
      status: 'on-target' | 'good' | 'ok' | 'behind' | 'no-data',
      lastUpdated: Timestamp,               // When sync last ran

      // Metadata
      tags: string[],                       // ["fitness", "gym", "focus-goal"]
      icon: string,                         // "dumbbell"
      color: string                         // "success"
    },

    // ========================================================================
    // KPI TYPE: content_production
    // Tracks consistent content creation and publishing
    // ========================================================================
    {
      id: string,                           // Unique within goal
      name: string,                         // "Write Substack 2x/Week"
      description: string,
      type: 'content_production',
      timeframe: 'daily' | 'weekly' | 'monthly' | 'sprint' | 'quarterly' | 'annual',
      target: number,                       // 2 (2x per week)
      unit: string,                         // "articles"

      // Content tracking
      contentType: string,                  // "article", "post", "episode", "video"
      platform: string,                     // "substack", "medium", "linkedin", "podcast"
      linkedTaskIds: string[],              // ["task-substack-1", "task-substack-2"]
      itemsProduced: number,                // 4 (articles published this period)
      qualityScore: number,                 // 8.5 (average quality 1-10)
      backlogCount: number,                 // 3 (articles in draft)
      lastPublished: Timestamp,             // When last item published

      // KPI status
      current: number,                      // 4 (items produced)
      progress: number,                     // 200 (% of target: 4/2*100)
      status: 'on-target' | 'good' | 'ok' | 'behind' | 'no-data',
      lastUpdated: Timestamp,

      // Metadata
      tags: string[],                       // ["content", "substack", "writing"]
      icon: string,                         // "pencil"
      color: string                         // "info"
    },

    // ========================================================================
    // KPI TYPE: fitness_* (existing)
    // Tracks fitness workouts with auto-sync
    // ========================================================================
    {
      id: string,
      name: string,                         // "Run 5km Daily"
      type: 'fitness_running' | 'fitness_steps' | 'fitness_cycling' | 'fitness_swimming' | 'fitness_walking' | 'fitness_workouts',
      timeframe: 'daily' | 'weekly' | 'monthly',
      target: number,                       // 5 (km)
      unit: string,                         // "km"

      // Fitness-specific
      source: 'strava' | 'healthkit' | 'garmin' | 'fitbit',
      recentWorkoutCount: number,           // 1 (workouts today/this period)
      weeklyPattern: string,                // "MTWRFSS" showing active days

      // Status
      current: number,                      // 4.2 (km run today)
      progress: number,                     // 84 (% of target)
      status: 'on-target' | 'good' | 'ok' | 'behind' | 'no-data',
      lastUpdated: Timestamp,

      tags: string[],
      icon: string,
      color: string
    },

    // ========================================================================
    // KPI TYPE: story_points (existing)
    // Tracks progress on goal stories
    // ========================================================================
    {
      id: string,
      name: string,                         // "Complete Story Points"
      type: 'story_points',
      timeframe: 'sprint' | 'monthly' | 'quarterly',
      target: number,                       // 100 (%)
      unit: string,                         // "%"

      // Progress tracking
      goalId: string,                       // Parent goal
      linkedStories: string[],              // ["story-1", "story-2"]
      totalPoints: number,                  // 50 (total story points)
      completedPoints: number,              // 39 (points marked done)
      storiesCount: number,                 // 5 (total stories)
      completedCount: number,               // 4 (stories completed)

      current: number,                      // 39 (completed points)
      progress: number,                     // 78 (% of target)
      status: 'on-target' | 'good' | 'ok' | 'behind' | 'no-data',
      lastUpdated: Timestamp,

      tags: string[],
      icon: string,
      color: string
    },

    // ========================================================================
    // KPI TYPE: savings_target (existing)
    // Tracks progress toward savings goal
    // ========================================================================
    {
      id: string,
      name: string,                         // "Save £5,000 This Quarter"
      type: 'savings_target',
      timeframe: 'monthly' | 'quarterly' | 'annual',
      target: number,                       // 5000 (£5,000)
      unit: string,                         // "GBP"

      // Financial tracking
      potId: string,                        // Monzo pot ID if linked
      currencyCode: string,                 // "GBP"
      currentAmount: number,                // 3200 (amount saved so far)
      startingAmount: number,               // 0

      current: number,                      // 3200
      progress: number,                     // 64 (% of target)
      status: 'on-target' | 'good' | 'ok' | 'behind' | 'no-data',
      lastUpdated: Timestamp,

      tags: string[],
      icon: string,
      color: string
    },

    // ========================================================================
    // KPI TYPE: habit_streak (existing)
    // Tracks daily habit consistency
    // ========================================================================
    {
      id: string,
      name: string,                         // "Meditate Daily"
      type: 'habit_streak',
      timeframe: 'daily' | 'weekly' | 'monthly',
      target: number,                       // 10 (days)
      unit: string,                         // "days"

      // Habit tracking
      currentStreak: number,                // 7 (current streak)
      longestStreak: number,                // 45 (best streak)
      completionDays: string[],             // ["2026-03-09", "2026-03-08", ...]
      weeklyGoal: number,                   // 5 (days per week)
      weeklyCompletion: number,             // 5 (this week)

      current: number,                      // 7 (streak)
      progress: number,                     // 70 (% of target: 7/10*100)
      status: 'on-target' | 'good' | 'ok' | 'behind' | 'no-data',
      lastUpdated: Timestamp,

      tags: string[],
      icon: string,
      color: string
    }
  ],

  // KPI sync tracking
  kpisLastSyncedAt: Timestamp,              // When last KPI sync ran
  kpiSyncErrors: string[]                   // ["routine_compliance: routine not found"]
});

// ============================================================================
// ROUTINES COLLECTION (existing, referenced by routine_compliance KPI)
// ============================================================================

db.collection('routines').doc('{routineId}').set({
  id: string,
  ownerUid: string,
  persona: 'personal' | 'work',
  name: string,                             // "Gym 3x/Week"
  description: string,
  schedule: 'daily' | 'weekly' | 'biweekly' | 'monthly',
  frequency: number,                        // 3 (times per period)
  period: 'day' | 'week' | 'month',        // "week"
  
  // Links
  linkedGoalIds: string[],                  // Goals this routine supports
  linkedTaskIds: string[],                  // Template tasks to create
  
  // Tracking
  isActive: boolean,
  completionDates: string[],                // ["2026-03-09", "2026-03-08", ...]
  currentStreak: number,                    // 15 (days in a row)
  
  createdAt: Timestamp,
  updatedAt: Timestamp
});

// ============================================================================
// TASKS COLLECTION (existing, extended for content production)
// ============================================================================

db.collection('tasks').doc('{taskId}').set({
  // Existing fields
  id: string,
  ownerUid: string,
  title: string,
  description: string,
  status: number,                           // 4 = Done
  createdAt: Timestamp,
  updatedAt: Timestamp,
  completedAt: Timestamp,                   // NEW: when marked done

  // NEW: Content production metadata
  contentType: string,                      // "article", "post", "episode"
  platform: string,                         // "substack", "linkedin", "podcast"
  contentUrl: string,                       // Link to published content
  qualityScore: number,                     // 1-10 rating

  // Routine reference
  linkedRoutineId: string,                  // Reference to routine template
  linkedGoalIds: string[]                   // Goals this supports
});

// ============================================================================
// KPI SYNC RESULTS (for monitoring and debugging)
// ============================================================================

db.collection('kpi_sync_logs').doc('{logId}').set({
  userId: string,
  goalId: string,
  kpiId: string,
  kpiType: 'routine_compliance' | 'content_production' | 'fitness_running' | ...,
  
  success: boolean,
  error: string,                            // Error message if failed
  
  previousValue: number,
  newValue: number,
  previousStatus: string,
  newStatus: string,
  
  metadata: {
    // routine_compliance
    completedDays: number,
    totalDays: number,
    compliancePercent: number,
    
    // content_production
    itemsProduced: number,
    linkedTasksCount: number,
    
    // any type
    syncDurationMs: number
  },
  
  syncedAt: Timestamp,
  createdAt: Timestamp
});

// ============================================================================
// FIRESTORE INDEXES (required for efficient queries)
// ============================================================================

// Index for routine compliance calculations
db.collection('goals').index([
  { path: 'ownerUid', order: 'Ascending' },
  { path: 'kpisV2.type', order: 'Ascending' },
  { path: 'updatedAt', order: 'Descending' }
]);

// Index for content production queries
db.collection('tasks').index([
  { path: 'ownerUid', order: 'Ascending' },
  { path: 'linkedGoalIds', order: 'Ascending' },
  { path: 'completedAt', order: 'Descending' }
]);

// Index for routine tracking
db.collection('routines').index([
  { path: 'ownerUid', order: 'Ascending' },
  { path: 'isActive', order: 'Ascending' },
  { path: 'linkedGoalIds', order: 'Ascending' }
]);

// ============================================================================
// EXAMPLE: COMPLETE GOAL WITH ROUTINE & CONTENT KPIS
// ============================================================================

{
  "id": "goal-transformation-q2",
  "persona": "personal",
  "title": "Body Fat Transformation + Build Substack Audience",
  "description": "Document my 90-day transformation journey while building an engaged Substack audience around fitness and lifestyle",
  "theme": 1,                           // Health
  "size": 3,                            // Large
  "confidence": 3,                      // High
  "status": 1,                          // Work in Progress
  "ownerUid": "user-123",
  
  "kpisV2": [
    {
      "id": "kpi-gym-routine",
      "name": "Gym Routine Adherence (80% over 100 days)",
      "type": "routine_compliance",
      "timeframe": "quarterly",
      "target": 80,
      "unit": "%",
      "linkedRoutineIds": ["routine-gym-3x-weekly"],
      "lookbackDays": 100,
      "complianceThreshold": 80,
      "linkedMetric": "body_fat_percent",
      "linkedMetricCurrent": 22,
      "linkedMetricTarget": 20,
      "current": 82,
      "progress": 102,
      "status": "on-target",
      "tags": ["fitness", "routine", "focus-goal"]
    },
    {
      "id": "kpi-substack-articles",
      "name": "Write Substack Article 2x/Week",
      "type": "content_production",
      "timeframe": "weekly",
      "target": 2,
      "unit": "articles",
      "contentType": "article",
      "platform": "substack",
      "linkedTaskIds": ["task-substack-1", "task-substack-2"],
      "itemsProduced": 4,
      "qualityScore": 8.5,
      "backlogCount": 3,
      "current": 4,
      "progress": 200,
      "status": "on-target",
      "tags": ["content", "writing", "substack"]
    },
    {
      "id": "kpi-story-points",
      "name": "Complete 75% of Story Points",
      "type": "story_points",
      "timeframe": "quarterly",
      "target": 75,
      "unit": "%",
      "linkedStories": ["story-gym-routine", "story-nutrition", "story-content"],
      "totalPoints": 40,
      "completedPoints": 31,
      "current": 31,
      "progress": 78,
      "status": "on-target"
    }
  ],
  
  "createdAt": Timestamp,
  "updatedAt": Timestamp,
  "kpisLastSyncedAt": Timestamp
}
