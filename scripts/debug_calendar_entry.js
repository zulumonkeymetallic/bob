const admin = require('firebase-admin');
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function investigate() {
    console.log('🔍 Searching for Story ST-G6DOFD (SNOW Deltas)...');

    // 1. Find the Story
    let storyId = null;
    let story = null;

    // Try ref first
    const refSnap = await db.collection('stories').where('ref', '==', 'ST-G6DOFD').get();
    if (!refSnap.empty) {
        story = refSnap.docs[0].data();
        storyId = refSnap.docs[0].id;
    } else {
        // Try title search
        console.log('Ref search failed, checking title...');
        // This is expensive, but for a script it's ok-ish or we assume ref is correct
        // Actually let's just search all stories? No, too many.
        // Let's assume the user provided Title or Ref is accurate enough to verify manually if needed.
        // The screenshot has 'ST-G6DOFD', so let's try 'ST-G6DOFD' as ID too?
        const docSnap = await db.collection('stories').doc('ST-G6DOFD').get();
        if (docSnap.exists) {
            story = docSnap.data();
            storyId = docSnap.id;
        }
    }

    if (!storyId) {
        console.log('❌ Story not found. Attempting broad title search...');
        const allSnap = await db.collection('stories').get(); // Potentially slow but necessary fallback
        const match = allSnap.docs.find(d => d.data().title.includes('SNOW Deltas'));
        if (match) {
            story = match.data();
            storyId = match.id;
        }
    }

    if (!story) {
        console.error('❌ Could not find story.');
        process.exit(1);
    }

    console.log(`✅ Found Story: ${storyId}`);
    console.log(`- Title: ${story.title}`);
    console.log(`- Priority: ${story.priority}`);
    console.log(`- Theme: ${story.theme}`);
    console.log(`- DueDate: ${story.dueDate ? new Date(story.dueDate).toISOString() : 'None'}`);
    console.log(`- Status: ${story.status}`);

    // 2. Find the Scheduled Instance (Plan Result)
    // We look for instances in 'scheduled_instances' collection with sourceId == storyId
    console.log('\n🔍 Searching Scheduled Instances...');
    const instSnap = await db.collection('scheduled_instances')
        .where('sourceId', '==', storyId)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

    if (instSnap.empty) {
        console.log('⚠️ No scheduled instances found.');
    } else {
        instSnap.docs.forEach(d => {
            const data = d.data();
            console.log(`\nInstance ${d.id}:`);
            console.log(`- Day: ${data.dayKey}`);
            console.log(`- Start: ${data.plannedStart}`);
            console.log(`- BlockID: ${data.blockId}`);
            console.log(`- Context:`, JSON.stringify(data.schedulingContext || {}, null, 2));
        });
    }

    // 3. Find the Calendar Block
    // Use the blockId from the instance
    const latestInst = instSnap.docs[0]?.data();
    if (latestInst && latestInst.blockId) {
        console.log(`\n🔍 Fetching Block: ${latestInst.blockId}`);
        const blockSnap = await db.collection('calendar_blocks').doc(latestInst.blockId).get();
        /* 
           Note: The engine uses "templates" (blocks arg) which might be different from "calendar_blocks" (output). 
           But let's see what's stored in the DB.
        */
        if (blockSnap.exists) {
            const b = blockSnap.data();
            console.log(`- Block Title: ${b.title || b.name}`);
            console.log(`- Block Theme: ${b.theme}`);
            console.log(`- Block Priority: ${b.priority}`);
            console.log(`- Block Constraints:`, JSON.stringify(b.constraints || {}, null, 2));
        } else {
            console.log('⚠️ Block doc not found.');
        }
    }

}

investigate().catch(console.error);
