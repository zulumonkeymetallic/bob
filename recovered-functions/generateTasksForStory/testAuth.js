const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

// Generate test login token (non-production only)
exports.generateTestToken = functions.https.onCall(async (data, context) => {
    // Only allow in development/test environments
    if (process.env.NODE_ENV === 'production') {
        throw new functions.https.HttpsError('permission-denied', 'Test tokens not available in production');
    }

    const { uid, scope } = data;
    
    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'UID is required');
    }

    try {
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

        await db.collection('test_login_tokens').add({
            token,
            uid,
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            scope: scope || 'full',
            createdAt: admin.firestore.Timestamp.now()
        });

        return { token, expiresAt: expiresAt.toISOString() };
    } catch (error) {
        console.error('Error generating test token:', error);
        throw new functions.https.HttpsError('internal', 'Failed to generate test token');
    }
});

// Test login endpoint
exports.testLogin = functions.https.onRequest(async (req, res) => {
    // Only allow in development/test environments
    if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ error: 'Test login not available in production' });
        return;
    }

    const { token } = req.query;
    
    if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
    }

    try {
        // Find the token in the database
        const tokensSnapshot = await db.collection('test_login_tokens')
            .where('token', '==', token)
            .where('expiresAt', '>', admin.firestore.Timestamp.now())
            .limit(1)
            .get();

        if (tokensSnapshot.empty) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        const tokenDoc = tokensSnapshot.docs[0];
        const tokenData = tokenDoc.data();

        // Create a custom token for the user
        const customToken = await admin.auth().createCustomToken(tokenData.uid);

        // Clean up the test token (one-time use)
        await tokenDoc.ref.delete();

        res.json({ 
            customToken,
            uid: tokenData.uid,
            scope: tokenData.scope 
        });

    } catch (error) {
        console.error('Error processing test login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Cleanup expired test tokens
exports.cleanupTestTokens = functions.pubsub.schedule('every 6 hours').onRun(async (context) => {
    try {
        const expiredTokens = await db.collection('test_login_tokens')
            .where('expiresAt', '<', admin.firestore.Timestamp.now())
            .get();

        const batch = db.batch();
        expiredTokens.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`Cleaned up ${expiredTokens.size} expired test tokens`);
    } catch (error) {
        console.error('Error cleaning up test tokens:', error);
    }
});
