/**
 * Backfill utility for stories and tasks with missing or non-conforming reference numbers
 * Updates stories/tasks with referenceNumber field to match new format: ST-12345, TK-67890
 */

const admin = require('firebase-admin');

/**
 * Generate a 5-digit reference number
 */
function generateRefNumeric(type) {
  const prefixes = {
    story: 'ST',
    task: 'TK',
    sprint: 'SP',
    goal: 'GR'
  };

  const prefix = prefixes[type] || 'XX';
  const timestamp = Date.now() % 100000;
  const random = Math.floor(Math.random() * 100);
  let numericId = (timestamp + random) % 100000;
  const refNum = String(numericId).padStart(5, '0');
  
  return `${prefix}-${refNum}`;
}

/**
 * Check if reference number conforms to new format (e.g., ST-12345)
 */
function isValidRef(ref, type) {
  if (!ref || typeof ref !== 'string') return false;
  const prefixes = {
    story: 'ST',
    task: 'TK',
    sprint: 'SP',
    goal: 'GR'
  };
  const pattern = new RegExp(`^${prefixes[type]}-\\d{5}$`);
  return pattern.test(ref);
}

/**
 * Backfill stories with proper reference numbers
 * Call via: firebase functions:config:set backfill.enabled=true && npm run deploy
 */
async function backfillStoryReferences() {
  const db = admin.firestore();
  const batch = db.batch();
  let updateCount = 0;
  const usedRefs = new Set();

  console.log('🔄 Starting story reference backfill...');

  const storiesSnap = await db.collection('stories').get();
  
  for (const doc of storiesSnap.docs) {
    const data = doc.data();
    const currentRef = data.ref || data.referenceNumber;

    // Skip if already has valid reference
    if (isValidRef(currentRef, 'story')) {
      usedRefs.add(currentRef);
      continue;
    }

    // Generate new reference
    let newRef = generateRefNumeric('story');
    let attempts = 0;
    while (usedRefs.has(newRef) && attempts < 50) {
      newRef = generateRefNumeric('story');
      attempts++;
    }

    if (attempts >= 50) {
      console.warn(`⚠️  Could not generate unique ref for story ${doc.id}, skipping`);
      continue;
    }

    usedRefs.add(newRef);
    batch.update(doc.ref, {
      ref: newRef,
      referenceNumber: newRef,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    updateCount++;

    if (updateCount % 100 === 0) {
      console.log(`✓ Prepared ${updateCount} story updates...`);
    }
  }

  // Commit batch
  if (updateCount > 0) {
    await batch.commit();
    console.log(`✅ Backfilled ${updateCount} stories with proper reference numbers`);
  } else {
    console.log(`✅ All stories already have valid reference numbers`);
  }

  return { updated: updateCount, collection: 'stories' };
}

/**
 * Backfill tasks with proper reference numbers
 */
async function backfillTaskReferences() {
  const db = admin.firestore();
  const batch = db.batch();
  let updateCount = 0;
  const usedRefs = new Set();

  console.log('🔄 Starting task reference backfill...');

  const tasksSnap = await db.collection('tasks').get();
  
  for (const doc of tasksSnap.docs) {
    const data = doc.data();
    const currentRef = data.ref || data.referenceNumber;

    // Skip if already has valid reference
    if (isValidRef(currentRef, 'task')) {
      usedRefs.add(currentRef);
      continue;
    }

    // Generate new reference
    let newRef = generateRefNumeric('task');
    let attempts = 0;
    while (usedRefs.has(newRef) && attempts < 50) {
      newRef = generateRefNumeric('task');
      attempts++;
    }

    if (attempts >= 50) {
      console.warn(`⚠️  Could not generate unique ref for task ${doc.id}, skipping`);
      continue;
    }

    usedRefs.add(newRef);
    batch.update(doc.ref, {
      ref: newRef,
      referenceNumber: newRef,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    updateCount++;

    if (updateCount % 100 === 0) {
      console.log(`✓ Prepared ${updateCount} task updates...`);
    }
  }

  // Commit batch
  if (updateCount > 0) {
    await batch.commit();
    console.log(`✅ Backfilled ${updateCount} tasks with proper reference numbers`);
  } else {
    console.log(`✅ All tasks already have valid reference numbers`);
  }

  return { updated: updateCount, collection: 'tasks' };
}

/**
 * Run both backfills (stories + tasks)
 */
async function backfillAllReferences() {
  try {
    console.log('📊 Starting full reference number backfill...\n');
    
    const storyResult = await backfillStoryReferences();
    console.log('');
    const taskResult = await backfillTaskReferences();
    
    console.log('\n✅ Backfill complete!');
    return {
      status: 'success',
      stories: storyResult,
      tasks: taskResult,
      totalUpdated: storyResult.updated + taskResult.updated
    };
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  }
}

module.exports = {
  backfillStoryReferences,
  backfillTaskReferences,
  backfillAllReferences,
  generateRefNumeric,
  isValidRef
};
