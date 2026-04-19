const admin = require('firebase-admin');
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function runDemo() {
    console.log('🐵 Starting Monkey Task Demo...');
    const userId = 'test_user_verification'; // Use the same test user
    const todayStr = new Date().toISOString().split('T')[0];
    const todayDate = new Date(todayStr);

    // --- STEP 1: Create Task ---
    console.log('\n--- Step 1: Creating Task ---');
    const taskRef = db.collection('tasks').doc();
    await taskRef.set({
        title: 'Determine how monkeys are human',
        description: 'Deep research into primate evolution and genetic similarity.',
        estimateMin: 360, // 6 hours
        dueDate: todayDate.toISOString(), // Due Today
        status: 'todo',
        ownerUid: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Created Task: "${taskRef.id}" (6 hours, Due Today)`);

    // --- STEP 2: Convert to Story ---
    console.log('\n--- Step 2: Triggering Conversion (Simulated) ---');
    // Logic from convertTasksToStories
    const newStoryRef = db.collection('stories').doc();
    const newStoryId = newStoryRef.id;

    await newStoryRef.set({
        ownerUid: userId,
        title: 'Determine how monkeys are human',
        description: 'Deep research into primate evolution and genetic similarity.',
        status: 'active',
        points: 5, // Default for large task
        estimateMin: 360,
        theme: 'Work',
        unlinked: true,
        convertedFromTaskId: taskRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await taskRef.update({
        storyId: newStoryRef.id,
        convertedToStoryId: newStoryRef.id,
        status: 'done',
        notes: '[Auto-Converted to Story due to size > 4 hours]'
    });

    // Log to Activity Stream (as per recent fix)
    await db.collection('activity_stream').add({
        ownerUid: userId,
        type: 'system_event',
        category: 'conversion',
        message: `Converted large task "Determine how monkeys are human" to Story`,
        relatedId: newStoryRef.id,
        relatedType: 'story',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Converted to Story: ${newStoryId}`);

    // --- STEP 3: Enrich Story (Simulated LLM) ---
    console.log('\n--- Step 3: Triggering AI Enrichment (Simulated) ---');
    // Logic from enrichStory
    const mockAC = [
        "Identify 5 key genetic markers shared between humans and monkeys.",
        "Compare social structures of chimpanzees and early humans.",
        "Draft a 2-page summary of findings."
    ];

    await newStoryRef.update({
        acceptanceCriteria: mockAC,
        aiEnriched: true,
        aiMetadata: {
            generatedAt: new Date().toISOString(),
            reasoning: "Simulated LLM for Demo"
        }
    });
    console.log(`✅ Enriched Story with ${mockAC.length} Acceptance Criteria.`);

    // --- STEP 4: Generate Calendar Blocks ---
    console.log('\n--- Step 4: Generating Calendar Blocks ---');
    // Logic from generateStoryBlocks
    const blocksNeeded = Math.ceil(5 / 2); // 3 blocks
    const blockBatch = db.batch();
    const createdBlocks = [];

    for (let b = 0; b < blocksNeeded; b++) {
        const blockRef = db.collection('calendar_blocks').doc();
        const targetDate = new Date(todayDate);
        targetDate.setDate(todayDate.getDate() + b); // Start today
        targetDate.setHours(10, 0, 0, 0);
        const endDate = new Date(targetDate);
        endDate.setHours(12, 0, 0, 0);

        const blockData = {
            ownerUid: userId,
            storyId: newStoryId,
            title: 'Determine how monkeys are human',
            start: targetDate.getTime(),
            end: endDate.getTime(),
            theme: 'Work',
            status: 'planned',
            aiGenerated: true,
            // Simulate GCal Sync Metadata
            googleEventId: `mock_gcal_event_${b}`,
            extendedProperties: {
                private: {
                    'bob-block-id': blockRef.id,
                    'deepLink': `bob://stories/${newStoryId}`
                }
            }
        };

        blockBatch.set(blockRef, blockData);
        createdBlocks.push(blockData);

        // Log to Activity Stream
        await db.collection('activity_stream').add({
            ownerUid: userId,
            type: 'system_event',
            category: 'scheduling',
            message: `Scheduled block for story "Determine how monkeys are human"`,
            relatedId: blockRef.id,
            relatedType: 'story',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    await blockBatch.commit();
    console.log(`✅ Created ${blocksNeeded} Calendar Blocks.`);
    console.log(`   - Sample Deep Link: bob://stories/${newStoryId}`);

    // --- STEP 5: Generate Email Content (Simulated) ---
    console.log('\n--- Step 5: Generating Daily Digest Content ---');
    // We simulate what the email generator would find
    const unlinkedStories = await db.collection('stories')
        .where('ownerUid', '==', userId)
        .where('unlinked', '==', true)
        .get();

    const myStory = unlinkedStories.docs.find(d => d.id === newStoryId);

    if (myStory) {
        console.log('📧 [Daily Digest Section: Unlinked Stories]');
        console.log(`   - 🔴 ${myStory.data().title} (5 pts)`);
        console.log(`     "This large item was converted from a task. Please review."`);
    } else {
        console.error('❌ Story not found in Unlinked Stories query!');
    }

    const todaysBlocks = await db.collection('calendar_blocks')
        .where('ownerUid', '==', userId)
        .where('start', '>=', todayDate.getTime())
        .where('start', '<', todayDate.getTime() + 86400000)
        .get();

    console.log('📧 [Daily Digest Section: Today\'s Schedule]');
    todaysBlocks.docs.forEach(d => {
        const data = d.data();
        console.log(`   - 🕒 ${new Date(data.start).toLocaleTimeString()} - ${data.title} (Story Block)`);
    });

    // Cleanup
    console.log('\n--- Cleanup ---');
    await taskRef.delete();
    await newStoryRef.delete();
    // (Skipping block cleanup for brevity, or we can do it)
    console.log('✅ Demo Complete.');
}

runDemo().catch(console.error);
