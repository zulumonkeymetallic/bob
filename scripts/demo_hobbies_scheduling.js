const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const { planSchedule } = require('../functions/scheduler/engine');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const uid = '3L3nnXSuTPfr08c8DTXG5zYX37A2';

async function run() {
    console.log('🎮 Setting up Hobbies & Interests theme scheduling demo...\n');

    // Current time is Monday November 25, 2025 at 05:49 UTC
    const now = DateTime.fromISO('2025-11-25T05:49:00Z');
    const today = now.startOf('day');

    console.log('📅 Current time:', now.toISO());
    console.log('📅 Planning for:', today.toISO(), '\n');

    // 1. Find or create gaming goal
    const goalsSnap = await db.collection('goals')
        .where('ownerUid', '==', uid)
        .where('title', '==', 'Complete 50% of the games on my steam backlog')
        .get();

    let goalId;
    if (goalsSnap.empty) {
        console.log('Creating gaming goal...');
        const goalRef = await db.collection('goals').add({
            ownerUid: uid,
            title: 'Complete 50% of the games on my steam backlog',
            theme: 6, // Hobbies & Interests
            status: 'active',
            createdAt: Date.now()
        });
        goalId = goalRef.id;
    } else {
        goalId = goalsSnap.docs[0].id;
    }
    console.log('✅ Gaming Goal ID:', goalId);

    // 2. Create a story for this goal
    const storyRef = await db.collection('stories').add({
        ownerUid: uid,
        title: 'Play through Portal 2',
        goalId: goalId,
        theme: 'Hobbies & Interests',
        status: 'todo',
        startDate: today.toISODate(), // Today
        estimatedHours: 2,
        createdAt: Date.now()
    });
    const storyId = storyRef.id;
    console.log('✅ Created Story:', storyId, '- "Play through Portal 2"');

    // 3. Set up theme allocation for today afternoon (Hobbies block)
    // Monday = day 1 in JS (0=Sun)
    await db.collection('theme_allocations').doc(uid).set({
        allocations: [{
            dayOfWeek: 1, // Monday
            startTime: '14:00', // 2 PM
            endTime: '17:00', // 5 PM  
            theme: 'Hobbies & Interests'
        }],
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Theme Allocation created: Monday 14:00-17:00 for "Hobbies & Interests"\n');

    // 4. Run the scheduler
    console.log('🚀 Running scheduler for today...');
    const taDoc = await db.collection('theme_allocations').doc(uid).get();
    const themeAllocations = taDoc.data().allocations;

    const plan = await planSchedule({
        db,
        userId: uid,
        windowStart: today,
        windowEnd: today.endOf('day'),
        busy: [],
        themeAllocations
    });

    console.log('\n📊 Scheduler Results:');
    console.log('  - Blocks created:', plan.blocks.length);
    console.log('  - Items planned:', plan.planned.length);
    console.log('  - Items unscheduled:', plan.unscheduled?.length || 0);

    // 5. Check if our story was scheduled
    const ourStory = plan.planned.find(i => i.sourceId === storyId || i.title === 'Play through Portal 2');

    console.log('\n📋 All Planned Items:');
    plan.planned.forEach(i => {
        console.log(`  - ${i.title} (${i.sourceType}): ${i.dayKey}`);
    });

    if (ourStory) {
        console.log('\n✅ SUCCESS! Story was scheduled:');
        console.log('  - Title:', ourStory.title);
        console.log('  - Theme:', ourStory.theme);
        console.log('  - Time:', ourStory.plannedStart ? DateTime.fromISO(ourStory.plannedStart).toFormat('HH:mm') : '??',
            '-', ourStory.plannedEnd ? DateTime.fromISO(ourStory.plannedEnd).toFormat('HH:mm') : '??');
        console.log('  - Day:', ourStory.dayKey);

        // 6. Save to Firestore
        console.log('\n💾 Saving to Firestore...');
        const batch = db.batch();

        // Save theme block
        plan.blocks.forEach(b => {
            const ref = db.collection('calendar_blocks').doc(b.id);
            batch.set(ref, b);
        });

        // Save scheduled instance
        plan.planned.forEach(i => {
            const ref = db.collection('scheduled_instances').doc(i.id);
            batch.set(ref, i);
        });

        await batch.commit();
        console.log('✅ Saved! Check your Unified Planner to see the scheduled story.');
        console.log('\n🔄 Google Calendar sync will happen on next hourly job.');
        console.log('   Or manually trigger sync from the UI.');

    } else {
        console.log('\n❌ Story was NOT scheduled.');
        console.log('Debugging info:');
        console.log('  - All planned items:', plan.planned.map(i => `${i.title} (${i.theme})`));
        console.log('  - Unscheduled:', plan.unscheduled?.map(i => `${i.title} (${i.theme})`));
        console.log('  - Blocks:', plan.blocks.map(b => `${b.title || b.id} - ${b.theme}`));
    }

    console.log('\n✅ Demo setup complete!');
    console.log('📋 Summary:');
    console.log('  - Theme: Hobbies & Interests (ID: 6)');
    console.log('  - Time Block: Monday 14:00-17:00');
    console.log('  - Story: "Play through Portal 2"');
    console.log('  - Goal: "Complete 50% of the games on my steam backlog"');
}

run().catch(console.error);
