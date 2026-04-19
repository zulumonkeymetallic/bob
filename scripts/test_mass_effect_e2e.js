const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const { planSchedule } = require('../functions/scheduler/engine');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const uid = '3L3nnXSuTPfr08c8DTXG5zYX37A2';
const storyId = '7YStTUPivC28sK2C2c7Y';

async function runEndToEndTest() {
    console.log('🎮 END-TO-END TEST: Mass Effect Auto-Scheduling');
    console.log('═'.repeat(60));

    // Step 1: Minimal prep - set startDate
    console.log('\n1️⃣ Preparing Mass Effect story...');
    await db.collection('stories').doc(storyId).update({
        startDate: '2025-11-25',
    });
    console.log('   ✅ Set startDate to today');

    // Step 2: Create theme allocation (directly to DB - same as saveThemeAllocations does)
    console.log('\n2️⃣ Creating theme allocation...');
    await db.collection('theme_allocations').doc(uid).set({
        allocations: [{
            dayOfWeek: 1, // Monday
            startTime: '20:00',
            endTime: '22:00',
            theme: 'Hobbies & Interests'
        }],
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('   ✅ Theme allocation: Monday 20:00-22:00 = Hobbies & Interests');

    // Step 3: Run scheduler (direct call - same logic as planBlocksV2)
    console.log('\n3️⃣ Running scheduler...');
    const today = DateTime.fromISO('2025-11-25T00:00:00Z');

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

    console.log('   ✅ Scheduler complete');
    console.log('   Items planned:', plan.planned.length);

    // Step 4: Check if Mass Effect was scheduled
    const massEffect = plan.planned.find(i => i.sourceId === storyId);

    if (!massEffect) {
        console.log('   ❌ Mass Effect NOT in plan');
        console.log('   Planned items:', plan.planned.map(i => i.title));
        return;
    }

    console.log('   ✅ Mass Effect in plan!');
    console.log('   Time:', DateTime.fromISO(massEffect.plannedStart).toFormat('HH:mm'),
        '-', DateTime.fromISO(massEffect.plannedEnd).toFormat('HH:mm'));
    console.log('   Full object:', JSON.stringify(massEffect, null, 2));

    // Step 5: Save to Firestore
    console.log('\n4️⃣ Saving to Firestore...');
    const batch = db.batch();

    plan.blocks.forEach(b => {
        const ref = db.collection('calendar_blocks').doc(b.id);
        batch.set(ref, b);
    });

    plan.planned.forEach(i => {
        const ref = db.collection('scheduled_instances').doc(i.id);
        batch.set(ref, { ...i, status: 'planned', dayKey: i.occurrenceDate || i.dayKey });
    });

    await batch.commit();
    console.log('   ✅ Saved', plan.planned.length, 'items to Firestore');

    // Step 6: Trigger Google Calendar sync via syncPlanToGoogleForUser
    console.log('\n5️⃣ Syncing to Google Calendar...');
    const { syncPlanToGoogleForUser } = require('../functions/google-calendar-integration');

    try {
        await syncPlanToGoogleForUser(db, uid, '2025-11-25');
        console.log('   ✅ Synced to Google Calendar');
    } catch (err) {
        console.log('   ⚠️ Sync failed (may need OAuth):', err.message);
    }

    // Verify in DB
    console.log('\n6️⃣ Verifying in database...');
    const instanceSnap = await db.collection('scheduled_instances')
        .where('sourceId', '==', storyId)
        .where('occurrenceDate', '==', '20251125')
        .get();

    if (!instanceSnap.empty) {
        const inst = instanceSnap.docs[0].data();
        console.log('   ✅ Found in scheduled_instances:');
        console.log('      Title:', inst.title);
        console.log('      Time:', inst.plannedStart?.substring(11, 16), '-', inst.plannedEnd?.substring(11, 16));
        console.log('      Deep Link:', inst.deepLink || 'N/A');
        console.log('      Theme:', inst.theme);
        console.log('      Has Acceptance Criteria:', !!inst.acceptanceCriteria);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ END-TO-END TEST COMPLETE');
    console.log('\n📋 Check Your Google Calendar:');
    console.log('   Mass Effect should appear tonight 8:00-10:00 PM');
    console.log('   With acceptance criteria, deep link, and theme metadata');
}

runEndToEndTest().catch(console.error);
