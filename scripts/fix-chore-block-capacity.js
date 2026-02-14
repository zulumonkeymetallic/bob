#!/usr/bin/env node

/**
 * Fix Chore Block Capacity Script
 *
 * Updates calendar blocks with theme=10 (Chores) to have proper daily capacity.
 * Sets dailyCapacityMinutes to 60 (1 hour) instead of default 480 (8 hours).
 *
 * Usage: node scripts/fix-chore-block-capacity.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function fixChoreBlockCapacity() {
  console.log('🔍 Finding chore calendar blocks (theme=10)...\n');

  // Query for blocks with theme=10 (Chores theme)
  const blocksRef = db.collection('calendar_blocks');
  const snapshot = await blocksRef.where('theme', '==', 10).get();

  if (snapshot.empty) {
    console.log('✅ No chore blocks found with theme=10');
    return;
  }

  console.log(`📋 Found ${snapshot.size} chore-related blocks\n`);

  const batch = db.batch();
  let updateCount = 0;
  let skipCount = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    const currentCapacity = data.dailyCapacityMinutes;

    // Only update if capacity is > 60 or not set
    if (!currentCapacity || currentCapacity > 60) {
      batch.update(doc.ref, {
        dailyCapacityMinutes: 60, // 1 hour capacity
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'fix-chore-block-capacity-script',
      });

      console.log(`  ✏️  Block ${doc.id}: ${currentCapacity || 'unset'} → 60 minutes`);
      updateCount++;
    } else {
      console.log(`  ⏭️  Block ${doc.id}: Already at ${currentCapacity} minutes (skipped)`);
      skipCount++;
    }
  });

  if (updateCount > 0) {
    console.log(`\n💾 Committing ${updateCount} updates...`);
    await batch.commit();
    console.log('✅ Batch update complete!\n');
  }

  console.log('📊 Summary:');
  console.log(`   - Updated: ${updateCount} blocks`);
  console.log(`   - Skipped: ${skipCount} blocks`);
  console.log(`   - Total:   ${snapshot.size} blocks\n`);

  console.log('✨ Done! Chore blocks now have 60-minute daily capacity.');
}

// Run the script
fixChoreBlockCapacity()
  .then(() => {
    console.log('\n🎉 Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
