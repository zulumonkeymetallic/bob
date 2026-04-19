const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkUserConnection() {
    try {
        const userId = '3L3nnXSuTPfr08c8DTXG5zYX37A2';

        // Check tokens collection
        const tokensSnap = await db.collection('tokens').doc(userId).get();
        if (tokensSnap.exists) {
            console.log('Tokens Doc: Found');
            const data = tokensSnap.data();
            console.log('Refresh Token Present:', !!data.refresh_token);
        } else {
            console.log('Tokens Doc: Not found');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkUserConnection();
