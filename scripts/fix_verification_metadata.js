const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function fixMetadata() {
    try {
        const userId = '3L3nnXSuTPfr08c8DTXG5zYX37A2';
        const title = 'Work on: Verify End-to-End Planning Flow [Bot]';

        // Find the block
        const snapshot = await db.collection('calendar_blocks')
            .where('ownerUid', '==', userId)
            .where('title', '==', title)
            .limit(1)
            .get();

        if (snapshot.empty) {
            console.log('Block not found!');
            return;
        }

        const blockDoc = snapshot.docs[0];
        const blockData = blockDoc.data();
        const storyId = blockData.storyId;

        console.log(`Found block: ${blockDoc.id} (Story: ${storyId})`);

        // Construct Metadata (simulating syncPlanToGoogleCalendar logic)
        const deepLink = `bob://stories/${storyId}`;
        const webLink = `https://bob20250810.web.app/stories?storyId=${storyId}`;

        const extendedProperties = {
            private: {
                'bob-block-id': blockDoc.id,
                'bob-story-id': storyId,
                'bob-deep-link': webLink, // Using web link as primary deep link often
                'bob-mobile-deep-link': deepLink
            }
        };

        // Update the block
        await blockDoc.ref.update({
            extendedProperties: extendedProperties,
            deepLink: deepLink, // Some frontends might use this top-level
            googleEventId: 'simulated_sync_pending', // Indicating it needs sync
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('✅ Updated block with Deep Links and Metadata.');
        console.log(`   Deep Link: ${deepLink}`);
        console.log(`   Web Link: ${webLink}`);

        console.log('\nNOTE: To see this on Google Calendar, please press the "Sync to Google Calendar" button in the app, or wait for the hourly sync.');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

fixMetadata();
