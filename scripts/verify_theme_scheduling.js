const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const { planSchedule } = require('../functions/scheduler/engine');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const uid = '3L3nnXSuTPfr08c8DTXG5zYX37A2';

async function run() {
    const today = DateTime.fromISO('2025-11-24T22:45:00Z'); // Current time (Mon night)
    const windowStart = today.plus({ days: 1 }).startOf('day'); // Tuesday start
    const windowEnd = today.plus({ days: 1 }).endOf('day'); // Tuesday end

    console.log('🔍 Finding a story...');
    const storiesSnap = await db.collection('stories')
        .where('ownerUid', '==', uid)
        .where('status', 'in', ['todo', 'in_progress'])
        .limit(1)
        .get();

    let storyId, storyTheme, storyTitle;
    if (storiesSnap.empty) {
        console.log('⚠️ No stories found. Creating one...');
        const res = await db.collection('stories').add({
            ownerUid: uid,
            title: 'Test Theme Story',
            theme: 'Deep Work',
            status: 'todo',
            createdAt: Date.now(),
            startDate: windowStart.toISODate() // Set to tomorrow to match window
        });
        storyId = res.id;
        storyTheme = 'Deep Work';
        storyTitle = 'Test Theme Story';
    } else {
        const doc = storiesSnap.docs[0];
        storyId = doc.id;
        storyTheme = doc.data().theme || 'Deep Work';
        storyTitle = doc.data().title;
        console.log(`✅ Found story: ${storyTitle} (${storyId}) with theme: ${storyTheme}`);

        // Ensure theme is set
        if (!doc.data().theme) {
            console.log('   - Updating story theme to Deep Work');
            await doc.ref.update({ theme: 'Deep Work' });
            storyTheme = 'Deep Work';
        }
        console.log('   - Updating story startDate to tomorrow for testing');
        await doc.ref.update({ startDate: windowStart.toISODate() });
    }

    // Set Theme Allocation for Tuesday (Day 2)
    // 0=Sun, 1=Mon, 2=Tue.
    console.log(`📅 Setting Theme Allocation for Tuesday (Deep Work)...`);
    await db.collection('theme_allocations').doc(uid).set({
        allocations: [{
            dayOfWeek: 2, // Tuesday
            startTime: '10:00',
            endTime: '12:00',
            theme: storyTheme
        }]
    });

    console.log('🚀 Running Scheduler Logic...');

    // First, check what themes are available in user settings
    console.log('🎨 Checking available themes...');
    const themesSnap = await db.collection('themes').where('ownerUid', '==', uid).get();
    const availableThemes = themesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log('Available themes:', availableThemes.map(t => `${t.name} (id: ${t.id})`).join(', '));

    // Use first available theme or fallback
    if (availableThemes.length > 0 && !availableThemes.find(t => t.name === storyTheme)) {
        console.log(`⚠️ Theme "${storyTheme}" not found in settings. Using "${availableThemes[0].name}" instead.`);
        storyTheme = availableThemes[0].name;
        // Update story and allocation with valid theme
        await db.collection('stories').doc(storyId).update({ theme: storyTheme });
        await db.collection('theme_allocations').doc(uid).set({
            allocations: [{
                dayOfWeek: 2,
                startTime: '10:00',
                endTime: '12:00',
                theme: storyTheme
            }]
        });
    }

    // Fetch allocations
    const taDoc = await db.collection('theme_allocations').doc(uid).get();
    const themeAllocations = taDoc.data().allocations;

    const plan = await planSchedule({
        db,
        userId: uid,
        windowStart,
        windowEnd,
        busy: [],
        themeAllocations
    });

    console.log('📊 Plan Result:');
    const scheduled = plan.planned.filter(i => i.storyId === storyId);

    if (scheduled.length > 0) {
        console.log(`✅ Story scheduled!`);
        scheduled.forEach(s => {
            console.log(`   - ${s.title}: ${s.dayKey} ${s.plannedStart ? DateTime.fromISO(s.plannedStart).toFormat('HH:mm') : '??'} - ${s.plannedEnd ? DateTime.fromISO(s.plannedEnd).toFormat('HH:mm') : '??'} (Theme: ${s.theme})`);
        });

        // Save to DB to allow user to see it
        console.log('💾 Saving to Firestore...');
        const batch = db.batch();

        // Save Blocks
        plan.blocks.forEach(b => {
            const ref = db.collection('calendar_blocks').doc(b.id);
            batch.set(ref, b);
        });

        // Save Instances
        plan.planned.forEach(i => {
            const ref = db.collection('scheduled_instances').doc(i.id);
            batch.set(ref, i);
        });

        await batch.commit();
        console.log('✅ Saved to Firestore. User should see it in Unified Planner.');

        // Trigger Sync (Simulated)
        console.log('🔄 To sync to Google, user should click "Sync Google" or wait for hourly job.');

    } else {
        console.log(`❌ Story NOT scheduled.`);
        console.log('Debug info:');
        console.log('  - Story ID:', storyId);
        console.log('  - Story Theme:', storyTheme);
        console.log('  - Window:', windowStart.toISO(), 'to', windowEnd.toISO());
        console.log('  - All planned instances:', plan.planned.length);
        console.log('  - Unscheduled:', plan.unscheduled?.length || 0);
        console.log('  - Conflicts:', plan.conflicts?.length || 0);
        if (plan.planned.length > 0) {
            console.log('  - Planned items:');
            plan.planned.forEach(i => console.log(`    * ${i.title} (${i.sourceType}) - Theme: ${i.theme}, Story: ${i.storyId}`));
        }
        if (plan.unscheduled && plan.unscheduled.length > 0) {
            console.log('  - Unscheduled items:');
            plan.unscheduled.forEach(i => console.log(`    * ${i.title} (${i.sourceType}) - Theme: ${i.theme}`));
        }
        console.log('  - Blocks created:', plan.blocks.length);
        plan.blocks.forEach(b => console.log(`    * ${b.title || b.id} - Theme: ${b.theme}, Priority: ${b.priority}`));
    }
}

run().catch(console.error);
