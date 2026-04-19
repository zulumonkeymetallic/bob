/**
 * Scheduler → Firestore Bridge
 * 
 * Wires the output of planSchedule() into:
 * 1. scheduled_instances collection (new model)
 * 2. calendar_blocks collection (legacy, for iOS compatibility)
 * 3. Google Calendar sync (future)
 * 
 * Task/Story Hierarchy:
 * ─ If story has tasks: sync ONLY the tasks to clients
 * ─ If story has NO tasks: sync the story itself as actionable
 */

const admin = require('firebase-admin');
const { writeConsolidatedCalendarBlocks, calculateBlockCapacity, getDayCapacityWarnings } = require('./blockConsolidation');

/**
 * Write scheduled instances to Firestore.
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} userId 
 * @param {Array} scheduledInstances - output from planSchedule()
 * @param {Object} context - { sprint, timestamp, source }
 */
async function writeScheduledInstances(db, userId, scheduledInstances, context = {}) {
  if (!scheduledInstances || !scheduledInstances.length) {
    return { written: 0, errors: 0 };
  }

  const batch = db.batch();
  let written = 0;
  let errors = 0;

  for (const instance of scheduledInstances) {
    try {
      const ref = db.collection('scheduled_instances').doc(instance.id);
      const payload = {
        ...instance,
        ownerUid: userId,
        userId,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: context.source || 'scheduler_engine',
        sprintId: context.sprint?.id || null,
      };
      batch.set(ref, payload, { merge: false });
      written++;
    } catch (error) {
      console.warn(`[syncToFirestore] Failed to write instance ${instance.id}:`, error?.message);
      errors++;
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error('[syncToFirestore] Batch commit failed:', error?.message);
    errors += Math.max(1, written);
    written = 0;
  }

  return { written, errors };
}

/**
 * Create calendar_blocks from scheduled_instances for iOS compatibility.
 * Implements task/story hierarchy:
 * - If story has tasks, generate block for each task
 * - If story has no tasks, generate block for the story
 * 
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} userId 
 * @param {Array} scheduledInstances 
 * @param {Object} tasksByStoryId - map of storyId → [tasks]
 */
async function writeLegacyCalendarBlocks(db, userId, scheduledInstances, tasksByStoryId = {}) {
  if (!scheduledInstances || !scheduledInstances.length) {
    return { created: 0, errors: 0 };
  }

  const batch = db.batch();
  let created = 0;
  let errors = 0;

  for (const instance of scheduledInstances) {
    try {
      // Skip chores - they don't map to calendar_blocks
      if (instance.sourceType === 'chore') {
        continue;
      }

      // HIERARCHY LOGIC:
      // If this is a story with associated tasks, skip it
      // (tasks will generate their own blocks)
      if (instance.sourceType === 'story') {
        const storyId = instance.sourceId;
        const associatedTasks = tasksByStoryId[storyId] || [];
        
        if (associatedTasks.length > 0) {
          // Story has tasks - skip creating a block for the story itself
          // Tasks will be scheduled individually
          continue;
        }
        // Story has NO tasks - create a block for the story
      }

      const blockId = db.collection('calendar_blocks').doc().id;
      const blockRef = db.collection('calendar_blocks').doc(blockId);

      // Determine entity type and IDs based on source type
      let entityType = instance.sourceType; // 'task', 'story', 'routine'
      let taskId = null;
      let storyId = null;
      let routineId = null;
      
      if (instance.sourceType === 'task') {
        taskId = instance.sourceId;
        entityType = 'task';
      } else if (instance.sourceType === 'story') {
        storyId = instance.sourceId;
        entityType = 'story';
      } else if (instance.sourceType === 'routine') {
        routineId = instance.sourceId;
        storyId = instance.storyId || null; // Pass through story context if routine is linked to story
        entityType = 'routine';
      }

      const blockPayload = {
        id: blockId,
        ownerUid: userId,
        entityType,
        taskId,
        storyId,
        routineId,
        title: instance.title,
        start: new Date(instance.plannedStart).getTime(),
        end: new Date(instance.plannedEnd).getTime(),
        blockId: instance.blockId,
        theme: instance.theme || null,
        goalId: instance.goalId || null,
        status: 'planned',
        aiGenerated: true,
        aiScore: null,
        deepLink: instance.deepLink || null,
        persona: instance.persona || 'personal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncedFromScheduler: true,
        sourceInstanceId: instance.id, // Link back to scheduled_instance
      };

      batch.set(blockRef, blockPayload, { merge: false });
      created++;
    } catch (error) {
      console.warn(`[writeLegacyCalendarBlocks] Failed to write block for instance ${instance.id}:`, error?.message);
      errors++;
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error('[writeLegacyCalendarBlocks] Batch commit failed:', error?.message);
    errors += Math.max(1, created);
    created = 0;
  }

  return { created, errors };
}

/**
 * Update planner_stats document with scheduling results.
 * Shows unscheduled count and shortfall minutes for insufficient capacity banner.
 * 
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} userId 
 * @param {Object} result - { planned, unscheduled }
 */
async function updatePlannerStats(db, userId, result) {
  const statsRef = db.collection('planner_stats').doc(userId);

  const unscheduledCount = (result.unscheduled || []).length;
  
  // Estimate shortfall in minutes (assume 60 min per item avg)
  const shortfallMinutes = unscheduledCount * 60;

  try {
    await statsRef.set({
      unscheduledStories: (result.unscheduled || []).filter(u => u.sourceType === 'story').length,
      unscheduledTasks: (result.unscheduled || []).filter(u => u.sourceType === 'task').length,
      shortfallMinutes,
      lastRunAt: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return true;
  } catch (error) {
    console.error('[updatePlannerStats] Failed:', error?.message);
    return false;
  }
}

/**
 * Fetch tasks grouped by story ID.
 * Used to implement task/story hierarchy.
 * 
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} userId 
 * @returns {Promise<Map<string, Array>>} storyId → [tasks]
 */
async function groupTasksByStory(db, userId) {
  const tasksByStory = {};

  try {
    const tasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', userId)
      .where('storyId', '!=', null)
      .get();

    for (const doc of tasksSnap.docs) {
      const task = doc.data();
      const storyId = task.storyId;
      if (!tasksByStory[storyId]) {
        tasksByStory[storyId] = [];
      }
      tasksByStory[storyId].push(task);
    }
  } catch (error) {
    console.warn('[groupTasksByStory] Failed to fetch tasks:', error?.message);
  }

  return tasksByStory;
}

/**
 * Write scheduled times back to source documents (tasks, stories, chores).
 * Updates actual scheduled start time + inferred time_of_day bucket.
 * 
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} userId 
 * @param {Array} scheduledInstances 
 * @returns {Promise<{updated: number, errors: number}>}
 */
async function writeScheduledTimesToSources(db, userId, scheduledInstances) {
  if (!scheduledInstances || !scheduledInstances.length) {
    return { updated: 0, errors: 0 };
  }

  const { classifyHourToTimeOfDay } = require('../services/timeOfDayPopulator');

  let updated = 0;
  let errors = 0;

  for (const instance of scheduledInstances) {
    try {
      const { sourceType, sourceId, plannedStart } = instance;
      if (!sourceId || !plannedStart) continue;

      // Determine source collection
      let collection = null;
      if (sourceType === 'task') collection = 'tasks';
      else if (sourceType === 'story') collection = 'stories';
      else if (sourceType === 'chore') collection = 'chores';
      else if (sourceType === 'routine') collection = 'routines';
      else continue;

      // Extract hour from plannedStart to infer time_of_day
      let scheduledStartTime = null;
      let inferredTimeOfDay = null;
      let plannedDateMidnightMs = null;
      try {
        const startDate = new Date(plannedStart);
        scheduledStartTime = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
        const hour = startDate.getHours();
        inferredTimeOfDay = classifyHourToTimeOfDay(hour);
        // midnight of the planned date (for dueDate writeback)
        plannedDateMidnightMs = new Date(
          startDate.getFullYear(), startDate.getMonth(), startDate.getDate()
        ).getTime();
      } catch (dateErr) {
        console.warn(`[writeScheduledTimesToSources] Failed to parse date for ${sourceId}:`, dateErr?.message);
      }

      // Read current doc to check lock flag before writing dueDate
      let isLocked = false;
      try {
        const snap = await db.collection(collection).doc(sourceId).get();
        const data = snap.exists ? snap.data() : {};
        isLocked = !!(data.dueDateLocked || data.lockDueDate || data.immovable);
      } catch (_) { /* ignore — treat as unlocked */ }

      const updatePayload = {
        actualScheduledStart: plannedStart,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Update time field based on source type
      if (sourceType === 'task') {
        updatePayload.scheduledTime = scheduledStartTime;
      } else if (sourceType === 'story') {
        updatePayload.plannedTime = scheduledStartTime;
      } else if (sourceType === 'chore' || sourceType === 'routine') {
        updatePayload.scheduledTime = scheduledStartTime;
      }

      // Update time_of_day if inferred
      if (inferredTimeOfDay) {
        updatePayload.timeOfDay = inferredTimeOfDay;
      }

      // Write dueDate from scheduled block date, unless user has locked it
      if (plannedDateMidnightMs && !isLocked) {
        if (sourceType === 'story') {
          updatePayload.targetDate = plannedDateMidnightMs;
        } else {
          updatePayload.dueDate = plannedDateMidnightMs;
        }
      }

      await db.collection(collection).doc(sourceId).update(updatePayload);
      updated++;
    } catch (error) {
      console.warn(`[writeScheduledTimesToSources] Failed to update ${instance.sourceType} ${instance.sourceId}:`, error?.message);
      errors++;
    }
  }

  return { updated, errors };
}

module.exports = {
  writeScheduledInstances,
  writeLegacyCalendarBlocks,
  writeConsolidatedCalendarBlocks,
  calculateBlockCapacity,
  getDayCapacityWarnings,
  updatePlannerStats,
  groupTasksByStory,
  writeScheduledTimesToSources,
};
