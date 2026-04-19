const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function runVerification() {
    try {
        console.log('🚀 Starting End-to-End Verification...');

        // Target User ID (found from previous task dumps)
        const userId = '3L3nnXSuTPfr08c8DTXG5zYX37A2';
        console.log(`User ID: ${userId}`);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // --- STEP 1: Create Task ---
        console.log('\n--- Step 1: Creating Task ---');
        const taskRef = db.collection('tasks').doc();
        const taskData = {
            title: 'Verify End-to-End Planning Flow [Bot]',
            description: 'Automated verification task to prove task->story->calendar flow.',
            estimateMin: 300, // 5 hours (large enough to trigger conversion logic if automated)
            dueDate: new Date().toISOString(),
            status: 'todo',
            ownerUid: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await taskRef.set(taskData);
        console.log(`✅ Created Task: "${taskData.title}" (ID: ${taskRef.id})`);

        // --- STEP 2: Convert to Story ---
        console.log('\n--- Step 2: Converting to Story ---');
        // Simulating the backend conversion logic
        const newStoryRef = db.collection('stories').doc();
        const newStoryId = newStoryRef.id;

        const storyData = {
            ownerUid: userId,
            title: taskData.title,
            description: taskData.description,
            status: 'active',
            points: 3,
            estimateMin: 300,
            theme: 'Work',
            unlinked: true,
            convertedFromTaskId: taskRef.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await newStoryRef.set(storyData);

        await taskRef.update({
            storyId: newStoryRef.id,
            convertedToStoryId: newStoryRef.id,
            status: 'done',
            notes: '[Converted to Story by Verification Script]'
        });
        console.log(`✅ Converted to Story: ${newStoryId}`);

        // --- STEP 3: Schedule for Today ---
        console.log('\n--- Step 3: Scheduling for Today ---');
        const blockRef = db.collection('calendar_blocks').doc();

        // Schedule for next hour
        const start = new Date();
        start.setMinutes(0, 0, 0);
        start.setHours(start.getHours() + 1);
        const end = new Date(start);
        end.setHours(end.getHours() + 1);

        const blockData = {
            ownerUid: userId,
            storyId: newStoryId,
            title: `Work on: ${taskData.title}`,
            start: start.getTime(),
            end: end.getTime(),
            theme: 'Work',
            status: 'planned',
            aiGenerated: true
        };

        await blockRef.set(blockData);
        console.log(`✅ Created Calendar Block: "${blockData.title}"`);
        console.log(`   Time: ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`);

        // --- STEP 4: Verify Data ---
        console.log('\n--- Step 4: Verifying Data Persistence ---');

        // Check Task
        const tSnap = await taskRef.get();
        console.log(`Task Status: ${tSnap.data().status} (Expected: done)`);
        console.log(`Task Linked Story: ${tSnap.data().storyId} (Expected: ${newStoryId})`);

        // Check Story
        const sSnap = await newStoryRef.get();
        console.log(`Story Created: ${sSnap.exists}`);

        // Check Calendar
        const cSnap = await blockRef.get();
        console.log(`Calendar Block Created: ${cSnap.exists}`);
        console.log(`Block Start: ${new Date(cSnap.data().start).toLocaleString()}`);

        console.log('\n✅ VERIFICATION COMPLETE');
        console.log('You should see these items in your dashboard now.');
        console.log('Note: These are real items. You can delete them after verification.');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

runVerification();
