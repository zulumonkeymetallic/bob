const admin = require('firebase-admin');
const { DateTime } = require('luxon');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const uid = '3L3nnXSuTPfr08c8DTXG5zYX37A2';

async function run() {
    // Check what theme allocations exist
    const taDoc = await db.collection('theme_allocations').doc(uid).get();
    const allocations = taDoc.exists ? taDoc.data().allocations : [];

    console.log('📋 Theme Allocations:');
    allocations.forEach(a => {
        console.log(`  - Day ${a.dayOfWeek}: ${a.startTime}-${a.endTime} = ${a.theme}`);

        // Calculate duration
        const [sh, sm] = a.startTime.split(':').map(Number);
        const [eh, em] = a.endTime.split(':').map(Number);
        const duration = (eh * 60 + em) - (sh * 60 + sm);
        console.log(`    Duration: ${duration} minutes`);
    });

    // Check the story we created
    const storiesSnap = await db.collection('stories')
        .where('ownerUid', '==', uid)
        .where('title', '==', 'Play through Portal 2')
        .get();

    if (!storiesSnap.empty) {
        const story = storiesSnap.docs[0].data();
        console.log('\n📚 Story: "Play through Portal 2"');
        console.log('  - Theme:', story.theme);
        console.log('  - Start Date:', story.startDate);
        console.log('  - Estimated Hours:', story.estimatedHours);
        console.log('  - Estimated Minutes:', (story.estimatedHours || 2) * 60);
    }
}

run().catch(console.error);
