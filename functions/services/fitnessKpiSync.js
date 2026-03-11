const admin = require('firebase-admin');

/**
 * Fitness KPI Sync Service
 * Links Strava/HealthKit workouts to goal KPIs
 * - Steps: daily step count from HealthKit/apple-health workouts
 * - Running: distance from Strava running activities
 * - Cycling: distance from Strava cycling activities
 * - Swimming: distance from Strava swimming activities
 */

// Timeframe windows for KPI calculations
const TIMEFRAMES = {
  daily: 1,      // Last 24 hours
  weekly: 7,     // Last 7 days
  monthly: 30,   // Last 30 days
  sprint: 14,    // Last 14 days (typical sprint)
};

/**
 * Calculate KPI progress from actual workout data
 * @param {string} kpiType - 'steps', 'running_distance', 'cycling_distance', 'swimming_distance'
 * @param {number} target - KPI target value
 * @param {string} unit - 'km', 'miles', 'steps', 'hours'
 * @param {string} timeframe - 'daily', 'weekly', 'monthly', 'sprint'
 * @param {Array} workouts - WorkoutDoc array
 * @returns {Object} { current, target, progress, unit, timeframe }
 */
function calculateKpiProgress(kpiType, target, unit, timeframe, workouts) {
  if (!workouts || workouts.length === 0) {
    return {
      current: 0,
      target,
      progress: 0,
      unit,
      timeframe,
      lastUpdated: new Date().toISOString(),
      status: 'no-data'
    };
  }

  // Filter workouts by timeframe
  const days = TIMEFRAMES[timeframe] || TIMEFRAMES.daily;
  const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const recentWorkouts = workouts.filter(w => {
    const workoutTime = w.startDate || (w.utcStartDate ? new Date(w.utcStartDate).getTime() : 0);
    return workoutTime > cutoffMs;
  });

  let current = 0;

  // Calculate based on KPI type
  switch (kpiType.toLowerCase()) {
    case 'steps':
      // Sum all steps from HealthKit/Apple Health entries
      current = recentWorkouts
        .filter(w => w.type === 'steps' || w.sportType === 'steps')
        .reduce((sum, w) => sum + (Number(w.stepCount) || 0), 0);
      break;

    case 'running_distance':
      // Sum distance from Strava running activities
      current = recentWorkouts
        .filter(w => {
          const type = (w.type || w.sportType || '').toLowerCase();
          return type.includes('run') && (w.provider === 'strava' || w.provider === 'healthkit');
        })
        .reduce((sum, w) => {
          const distKm = (w.distance_m || 0) / 1000;
          return sum + distKm;
        }, 0);
      break;

    case 'cycling_distance':
      current = recentWorkouts
        .filter(w => {
          const type = (w.type || w.sportType || '').toLowerCase();
          return type.includes('cyc') && (w.provider === 'strava' || w.provider === 'healthkit');
        })
        .reduce((sum, w) => {
          const distKm = (w.distance_m || 0) / 1000;
          return sum + distKm;
        }, 0);
      break;

    case 'swimming_distance':
      current = recentWorkouts
        .filter(w => {
          const type = (w.type || w.sportType || '').toLowerCase();
          return type.includes('swim') && (w.provider === 'strava' || w.provider === 'healthkit');
        })
        .reduce((sum, w) => {
          const distKm = (w.distance_m || 0) / 1000;
          return sum + distKm;
        }, 0);
      break;

    case 'walking_distance':
      current = recentWorkouts
        .filter(w => {
          const type = (w.type || w.sportType || '').toLowerCase();
          return (type.includes('walk') || type.includes('hike')) && (w.provider === 'strava' || w.provider === 'healthkit');
        })
        .reduce((sum, w) => {
          const distKm = (w.distance_m || 0) / 1000;
          return sum + distKm;
        }, 0);
      break;

    case 'workout_count':
      // Count number of workouts
      current = recentWorkouts.length;
      break;

    default:
      return {
        current: 0,
        target,
        progress: 0,
        unit,
        timeframe,
        lastUpdated: new Date().toISOString(),
        status: 'unknown-type'
      };
  }

  // Round for display
  current = Math.round(current * 100) / 100;

  // Calculate progress percentage
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  // Determine status
  let status = 'behind';
  if (progress >= 100) status = 'on-target';
  else if (progress >= 80) status = 'good';
  else if (progress >= 50) status = 'ok';

  return {
    current,
    target,
    progress,
    unit,
    timeframe,
    lastUpdated: new Date().toISOString(),
    status,
    recentWorkoutCount: recentWorkouts.length
  };
}

/**
 * Sync KPI progress for a user's goals
 * Called daily by nightly orchestration
 */
async function syncUserFitnessKpis(userId) {
  const db = admin.firestore();
  
  try {
    // 1. Load user's goals with KPIs
    const goalsSnap = await db.collection('goals')
      .where('ownerUid', '==', userId)
      .where('kpis', '!=', null)
      .get();

    if (goalsSnap.empty) {
      return { synced: 0, goalId: [] };
    }

    // 2. Load user's recent workouts (last 90 days)
    const cutoffDate = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const workoutsSnap = await db.collection('workouts')
      .where('ownerUid', '==', userId)
      .get();

    const workouts = workoutsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(w => {
        const workoutTime = w.startDate || (w.utcStartDate ? new Date(w.utcStartDate).getTime() : 0);
        return workoutTime > cutoffDate;
      });

    // 3. For each goal, update KPI progress
    let syncedCount = 0;
    const syncedGoals = [];

    for (const goalDoc of goalsSnap.docs) {
      const goal = goalDoc.data();
      const kpis = goal.kpis || [];

      // Check if any KPI is fitness-related
      const fitnessKpis = kpis.filter(kpi => {
        const name = (kpi.name || '').toLowerCase();
        return name.includes('step') || name.includes('run') || name.includes('walk') || 
               name.includes('cycle') || name.includes('swim') || name.includes('distance');
      });

      if (fitnessKpis.length === 0) continue;

      // Calculate progress for each fitness KPI
      const updatedKpis = kpis.map(kpi => {
        const name = (kpi.name || '').toLowerCase();
        
        // Detect KPI type from name
        let kpiType = null;
        if (name.includes('step')) kpiType = 'steps';
        else if (name.includes('run') && name.includes('5k')) kpiType = 'running_distance';
        else if (name.includes('run')) kpiType = 'running_distance';
        else if (name.includes('cycle')) kpiType = 'cycling_distance';
        else if (name.includes('swim')) kpiType = 'swimming_distance';
        else if (name.includes('walk')) kpiType = 'walking_distance';
        
        if (!kpiType) return kpi;

        // Default timeframe is daily, can be inferred from name
        let timeframe = 'daily';
        if (name.includes('week')) timeframe = 'weekly';
        else if (name.includes('month')) timeframe = 'monthly';
        else if (name.includes('sprint')) timeframe = 'sprint';

        // Calculate progress
        const progress = calculateKpiProgress(
          kpiType,
          kpi.target,
          kpi.unit || 'km',
          timeframe,
          workouts
        );

        return {
          ...kpi,
          ...progress
        };
      });

      // Update goal with new KPI progress
      await db.collection('goals').doc(goalDoc.id).update({
        kpis: updatedKpis,
        kpisLastSyncedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      syncedCount++;
      syncedGoals.push(goalDoc.id);
    }

    return { synced: syncedCount, goalIds: syncedGoals };

  } catch (error) {
    console.error(`❌ Fitness KPI sync failed for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Batch sync all users' fitness KPIs
 * Called nightly
 */
async function syncAllUsersFitnessKpis() {
  const db = admin.firestore();
  
  try {
    // Get all users
    const usersSnap = await db.collection('profiles').get();
    
    let totalSynced = 0;
    const results = [];

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const result = await syncUserFitnessKpis(userId);
      totalSynced += result.synced;
      if (result.synced > 0) {
        results.push({ userId, synced: result.synced });
      }
    }

    console.log(`✅ Fitness KPI sync completed: ${totalSynced} goals updated across ${results.length} users`);
    return { totalSynced, userResults: results };

  } catch (error) {
    console.error('❌ Batch fitness KPI sync failed:', error);
    throw error;
  }
}

module.exports = {
  calculateKpiProgress,
  syncUserFitnessKpis,
  syncAllUsersFitnessKpis,
  TIMEFRAMES
};
