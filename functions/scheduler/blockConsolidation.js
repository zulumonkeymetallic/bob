/**
 * Block Consolidation Service
 * 
 * Consolidates multiple scheduled items in the same planner block into a single
 * calendar_block entry with all items listed. This prevents duplicate GCal events.
 * 
 * Capacity Validation:
 * - 1 hour block can hold: Math.floor(60 / 15) = 4 items at 0.25 points each
 * - Capacity formula: itemCapacity = Math.floor((blockDurationMinutes / 60) * 4)
 * - If items exceed capacity, excess items are flagged for deferral
 */

const admin = require('firebase-admin');

const DEFAULT_POINTS_PER_ITEM = 0.25;
const ITEMS_PER_HOUR = 4; // 1 hour / 0.25 points = 4 items

/**
 * Calculate how many items can fit in a block based on duration and point values
 * @param {number} blockDurationMinutes - Duration of planner block
 * @param {Array} items - Array of { points, title } objects
 * @returns {Object} { itemCapacity, totalPoints, exceeds, itemsToDefer }
 */
function calculateBlockCapacity(blockDurationMinutes, items = []) {
  const blockHours = blockDurationMinutes / 60;
  const itemCapacity = Math.floor(blockHours * ITEMS_PER_HOUR);
  
  // Calculate total points
  const totalPoints = items.reduce((sum, item) => {
    return sum + (item.points || DEFAULT_POINTS_PER_ITEM);
  }, 0);
  
  // Expected capacity in points
  const expectedCapacityPoints = blockHours * 1.0; // 1 hour = 1 point capacity
  
  const exceeds = totalPoints > expectedCapacityPoints;
  
  // If exceeding, identify which items to defer (lowest priority first)
  let itemsToDefer = [];
  if (exceeds) {
    const sorted = [...items]
      .map((item, idx) => ({ ...item, originalIdx: idx }))
      .sort((a, b) => {
        // Sort by: immovable (false first), then by priority (higher first), then by points (higher first)
        if (a.immovable !== b.immovable) return a.immovable ? -1 : 1;
        const aPriority = a.priority || 0;
        const bPriority = b.priority || 0;
        if (aPriority !== bPriority) return bPriority - aPriority;
        return (b.points || DEFAULT_POINTS_PER_ITEM) - (a.points || DEFAULT_POINTS_PER_ITEM);
      });
    
    let runningPoints = 0;
    itemsToDefer = sorted
      .map(item => {
        const wouldExceed = (runningPoints + (item.points || DEFAULT_POINTS_PER_ITEM)) > expectedCapacityPoints;
        if (wouldExceed) {
          return item;
        } else {
          runningPoints += (item.points || DEFAULT_POINTS_PER_ITEM);
          return null;
        }
      })
      .filter(Boolean)
      .map(item => items[item.originalIdx]);
  }
  
  return {
    itemCapacity,
    totalPoints,
    expectedCapacityPoints,
    exceeds,
    itemsToDefer,
    utilizationPercent: Math.round((totalPoints / expectedCapacityPoints) * 100),
  };
}

/**
 * Group scheduled instances by their planner block and consolidate into calendar_blocks
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} userId 
 * @param {Array} scheduledInstances 
 * @param {Object} tasksByStoryId - map of storyId → [tasks]
 * @returns {Promise<Object>} { consolidated: count, skipped: count, overCapacity: count, errors: count }
 */
async function writeConsolidatedCalendarBlocks(db, userId, scheduledInstances, tasksByStoryId = {}) {
  if (!scheduledInstances || !scheduledInstances.length) {
    return { consolidated: 0, skipped: 0, overCapacity: 0, errors: 0 };
  }

  const batch = db.batch();
  let consolidated = 0;
  let skipped = 0;
  let overCapacity = 0;
  let errors = 0;
  
  // Group instances by blockId + startTime to handle consolidation
  const blockGroups = {};
  
  for (const instance of scheduledInstances) {
    // Skip chores - they don't map to calendar_blocks
    if (instance.sourceType === 'chore') {
      skipped++;
      continue;
    }
    
    // HIERARCHY LOGIC: Skip story if it has associated tasks
    if (instance.sourceType === 'story') {
      const storyId = instance.sourceId;
      const associatedTasks = tasksByStoryId[storyId] || [];
      if (associatedTasks.length > 0) {
        skipped++;
        continue;
      }
    }
    
    // Group by block identifier
    const blockKey = instance.blockId || `${instance.plannedStart}-${instance.theme}`;
    if (!blockGroups[blockKey]) {
      blockGroups[blockKey] = {
        blockId: instance.blockId || null,
        theme: instance.theme || null,
        plannedStart: instance.plannedStart,
        plannedEnd: instance.plannedEnd,
        title: instance.title,
        items: [],
      };
    }
    
    blockGroups[blockKey].items.push({
      instanceId: instance.id,
      sourceId: instance.sourceId,
      sourceType: instance.sourceType,
      title: instance.title,
      points: instance.points || DEFAULT_POINTS_PER_ITEM,
      priority: instance.priority || 0,
      goalId: instance.goalId || null,
      immovable: instance.immovable || false,
      deepLink: instance.deepLink || null,
      storyId: instance.storyId || null,
    });
  }
  
  // Now write consolidated blocks
  for (const blockKey in blockGroups) {
    try {
      const group = blockGroups[blockKey];
      
      // Calculate block duration
      const startMs = new Date(group.plannedStart).getTime();
      const endMs = new Date(group.plannedEnd).getTime();
      const blockDurationMinutes = (endMs - startMs) / (1000 * 60);
      
      // Check capacity
      const capacityCheck = calculateBlockCapacity(blockDurationMinutes, group.items);
      
      if (capacityCheck.exceeds) {
        overCapacity++;
        console.warn(`[BlockConsolidation] Block ${group.blockId} exceeds capacity:`, {
          blockId: group.blockId,
          itemsCount: group.items.length,
          totalPoints: capacityCheck.totalPoints,
          capacity: capacityCheck.expectedCapacityPoints,
          itemsToDefer: capacityCheck.itemsToDefer.map(i => i.title),
        });
      }
      
      // Extract entity type and primary IDs from first item
      const firstItem = group.items[0];
      let entityType = firstItem.sourceType;
      let taskId = null;
      let storyId = null;
      let routineId = null;
      
      if (firstItem.sourceType === 'task') {
        taskId = firstItem.sourceId;
      } else if (firstItem.sourceType === 'story') {
        storyId = firstItem.sourceId;
      } else if (firstItem.sourceType === 'routine') {
        routineId = firstItem.sourceId;
        storyId = firstItem.storyId || null;
      }
      
      // Create single consolidated block
      const blockId = group.blockId || db.collection('calendar_blocks').doc().id;
      const blockRef = db.collection('calendar_blocks').doc(blockId);
      
      const blockPayload = {
        id: blockId,
        ownerUid: userId,
        entityType,
        taskId,
        storyId,
        routineId,
        title: `${group.title} (${group.items.length} items)`,
        start: startMs,
        end: endMs,
        blockId: group.blockId || null,
        theme: group.theme || null,
        goalId: firstItem.goalId || null,
        status: 'planned',
        aiGenerated: true,
        aiScore: null,
        deepLink: firstItem.deepLink || null,
        persona: 'personal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncedFromScheduler: true,
        
        // CONSOLIDATION: Store items as array instead of single item
        items: group.items,
        itemCount: group.items.length,
        totalPoints: capacityCheck.totalPoints,
        blockCapacity: capacityCheck.expectedCapacityPoints,
        capacityExceeded: capacityCheck.exceeds,
        utilizationPercent: capacityCheck.utilizationPercent,
        itemsToDefer: capacityCheck.itemsToDefer,
        
        // Reference back to instances (for sync tracking)
        sourceInstanceIds: group.items.map(i => i.instanceId),
      };
      
      batch.set(blockRef, blockPayload, { merge: false });
      consolidated++;
    } catch (error) {
      console.warn(`[BlockConsolidation] Failed to write consolidated block ${blockKey}:`, error?.message);
      errors++;
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error('[BlockConsolidation] Batch commit failed:', error?.message);
    errors += Math.max(1, consolidated);
    consolidated = 0;
  }

  return {
    consolidated,
    skipped,
    overCapacity,
    errors,
  };
}

/**
 * Get capacity warnings for a specific day
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} userId 
 * @param {Date} date 
 * @returns {Promise<Object>} { dayCapacityWarnin gs, shortfallItems, recommendation }
 */
async function getDayCapacityWarnings(db, userId, date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  
  const snap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('start', '>=', dayStart.getTime())
    .where('start', '<=', dayEnd.getTime())
    .get();
  
  let totalCapacity = 0;
  let totalDemand = 0;
  const overCapacityBlocks = [];
  
  snap.forEach(doc => {
    const block = doc.data();
    if (block.blockCapacity) totalCapacity += block.blockCapacity;
    if (block.totalPoints) totalDemand += block.totalPoints;
    if (block.capacityExceeded) {
      overCapacityBlocks.push({
        blockId: doc.id,
        title: block.title,
        excess: block.totalPoints - block.blockCapacity,
        itemsToDefer: block.itemsToDefer || [],
      });
    }
  });
  
  const shortfall = totalDemand - totalCapacity;
  const hasWarning = shortfall > 0;
  
  return {
    date: date.toISOString().split('T')[0],
    totalCapacity,
    totalDemand,
    shortfall,
    utilizationPercent: totalCapacity > 0 ? Math.round((totalDemand / totalCapacity) * 100) : 0,
    hasWarning,
    overCapacityBlocks,
    recommendation: hasWarning
      ? `Day overbooked by ${shortfall.toFixed(2)} points. Consider: 1) deferring low-priority chores, 2) extending block times, 3) moving items to other days.`
      : null,
  };
}

module.exports = {
  writeConsolidatedCalendarBlocks,
  calculateBlockCapacity,
  getDayCapacityWarnings,
};
