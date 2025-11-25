const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkUserConnection() {
    try {
        const userId = '3L3nnXSuTPfr08c8DTXG5zYX37A2';

        // Check User Settings
        const settingsSnap = await db.collection('user_settings').doc(userId).get();
        if (settingsSnap.exists) {
            console.log('User Settings:', settingsSnap.data());
        } else {
            console.log('User Settings: Not found');
        }

        // Check Google Auth (usually in a separate collection or field)
        // Based on code: `const access = await getAccessToken(uid);`
        // Let's see where getAccessToken looks.
        // It usually looks in `oauth_tokens` or `users/{uid}/tokens`

        const tokensSnap = await db.collection('oauth_tokens').doc(userId).get();
        if (tokensSnap.exists) {
            console.log('OAuth Tokens: Found');
            const data = tokensSnap.data();
            console.log('Google Connected:', !!data.google_refresh_token);
        } else {
            console.log('OAuth Tokens: Not found');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkUserConnection();
