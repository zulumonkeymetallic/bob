const admin = require('firebase-admin');
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function runTests() {
    console.log('🚀 Starting End-to-End System Verification...');
    const testRunId = Date.now().toString();
    const userId = 'test_user_verification'; // Using a test user ID to avoid messing with real data too much

    // --- TEST 1: Large Task Conversion ---
    console.log('\n--- TEST 1: Large Task Conversion Logic ---');
    const largeTaskRef = db.collection('tasks').doc(`test_large_${testRunId}`);
    await largeTaskRef.set({
        title: `Test Large Task ${testRunId}`,
        estimateMin: 300, // 5 hours
        status: 'todo',
        ownerUid: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`1. Created Large Task: ${largeTaskRef.id} (300 mins)`);

    // Simulate Conversion Logic (copied from aiPlanning.js)
    console.log('2. Running Conversion Logic...');
    const tasksSnap = await db.collection('tasks')
        .where('ownerUid', '==', userId) // Limit to test user
        .get();

    const batch = db.batch();
    let convertedCount = 0;
    let newStoryId = null;

    for (const doc of tasksSnap.docs) {
        const task = doc.data();
        // Client-side filtering to avoid index creation
        if (task.status !== 'todo') continue;
        if (task.storyId) continue;
        if (!task.estimateMin || task.estimateMin <= 240) continue;
        if (doc.id !== largeTaskRef.id) continue; // Only process our test task

        const newStoryRef = db.collection('stories').doc();
        newStoryId = newStoryRef.id;

        batch.set(newStoryRef, {
            ownerUid: task.ownerUid,
            title: task.title,
            description: task.description || '',
            status: 'active',
            points: 5,
            estimateMin: task.estimateMin,
            unlinked: true,
            convertedFromTaskId: doc.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        batch.update(doc.ref, {
            storyId: newStoryRef.id,
            convertedToStoryId: newStoryRef.id,
            status: 'done',
            notes: (task.notes || '') + '\n[Auto-Converted]'
        });
        convertedCount++;
    }

    if (convertedCount > 0) {
        await batch.commit();
        console.log(`3. ✅ Converted ${convertedCount} task(s).`);

        // Verify
        const updatedTask = await largeTaskRef.get();
        const createdStory = await db.collection('stories').doc(newStoryId).get();

        console.log(`4. Verification Results:`);
        console.log(`   - Task Status: ${updatedTask.data().status} (Expected: done)`);
        console.log(`   - Task Linked Story: ${updatedTask.data().storyId}`);
        console.log(`   - Story Created: ${createdStory.exists}`);
        console.log(`   - Story Unlinked Flag: ${createdStory.data().unlinked}`);
    } else {
        console.error('3. ❌ No tasks converted (Test Failed)');
    }

    // --- TEST 2: Story Block Scheduling ---
    console.log('\n--- TEST 2: Story Block Scheduling Logic ---');
    const storyRef = db.collection('stories').doc(`test_story_${testRunId}`);
    await storyRef.set({
        title: `Test Story ${testRunId}`,
        points: 5,
        status: 'active',
        ownerUid: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`1. Created Active Story: ${storyRef.id} (5 points)`);

    // Simulate Blocking Logic (copied from aiPlanning.js)
    console.log('2. Running Blocking Logic...');
    const points = 5;
    const blocksNeeded = Math.ceil(points / 2); // 3 blocks
    console.log(`   - Calculated Blocks Needed: ${blocksNeeded}`);

    // Create blocks
    const blockBatch = db.batch();
    const createdBlockIds = [];
    const today = new Date();

    for (let b = 0; b < blocksNeeded; b++) {
        const blockRef = db.collection('calendar_blocks').doc();
        createdBlockIds.push(blockRef.id);
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + b + 1);
        targetDate.setHours(10, 0, 0, 0);

        blockBatch.set(blockRef, {
            ownerUid: userId,
            storyId: storyRef.id,
            title: `Test Story ${testRunId}`,
            start: targetDate.getTime(),
            end: targetDate.getTime() + (2 * 60 * 60 * 1000), // 2 hours
            status: 'planned',
            aiGenerated: true
        });
    }
    await blockBatch.commit();
    console.log(`3. ✅ Created ${blocksNeeded} calendar blocks.`);

    // Verify
    const blocksSnap = await db.collection('calendar_blocks')
        .where('storyId', '==', storyRef.id)
        .get();
    console.log(`4. Verification Results:`);
    console.log(`   - Blocks Found in DB: ${blocksSnap.size} (Expected: ${blocksNeeded})`);
    blocksSnap.docs.forEach((d, i) => {
        console.log(`     Block ${i + 1}: ${new Date(d.data().start).toISOString()} - ${d.data().title}`);
    });

    // Cleanup
    console.log('\n--- Cleanup ---');
    await largeTaskRef.delete();
    if (newStoryId) await db.collection('stories').doc(newStoryId).delete();
    await storyRef.delete();
    for (const bid of createdBlockIds) {
        await db.collection('calendar_blocks').doc(bid).delete();
    }
    console.log('✅ Cleanup complete.');
}

runTests().catch(console.error);
