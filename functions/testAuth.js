const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

// Create a persistent test user for AI agent testing
exports.createTestUser = functions.https.onCall(async (data, context) => {
    // Only allow in development/test environments
    const isTestEnv = process.env.NODE_ENV !== 'production' || 
                     data.testEnvironment === true ||
                     context.rawRequest?.headers['x-test-environment'] === 'true';
    
    if (!isTestEnv) {
        throw new functions.https.HttpsError('permission-denied', 'Test user creation not available in production');
    }

    try {
        const testUserData = {
            uid: 'ai-test-user-12345abcdef',
            email: 'ai-test-agent@bob.local',
            displayName: 'AI Test Agent',
            emailVerified: true,
            disabled: false
        };

        let userRecord;
        try {
            // Try to get existing user
            userRecord = await admin.auth().getUser(testUserData.uid);
            console.log('🧪 Test user already exists');
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Create new test user
                userRecord = await admin.auth().createUser(testUserData);
                console.log('🧪 Test user created:', userRecord.uid);
            } else {
                throw error;
            }
        }

        // Generate a custom token
        const customToken = await admin.auth().createCustomToken(userRecord.uid, {
            isTestUser: true,
            persona: 'personal',
            testEnvironment: true
        });

        return {
            success: true,
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName
            },
            customToken: customToken
        };

    } catch (error) {
        console.error('❌ Error creating test user:', error);
        throw new functions.https.HttpsError('internal', 'Failed to create test user: ' + error.message);
    }
});

// Generate test login URL with Firebase custom token
exports.generateTestLoginUrl = functions.https.onCall(async (data, context) => {
    const isTestEnv = process.env.NODE_ENV !== 'production' || 
                     data.testEnvironment === true ||
                     context.rawRequest?.headers['x-test-environment'] === 'true';
    
    if (!isTestEnv) {
        throw new functions.https.HttpsError('permission-denied', 'Test URLs not available in production');
    }

    try {
        const baseUrl = data.baseUrl || 'https://bob20250810.web.app';
        
        // Ensure test user exists
        let userRecord;
        try {
            userRecord = await admin.auth().getUser('ai-test-user-12345abcdef');
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Create test user if it doesn't exist
                userRecord = await admin.auth().createUser({
                    uid: 'ai-test-user-12345abcdef',
                    email: 'ai-test-agent@bob.local',
                    displayName: 'AI Test Agent',
                    emailVerified: true
                });
            } else {
                throw error;
            }
        }
        
        // Generate custom token
        const customToken = await admin.auth().createCustomToken(userRecord.uid, {
            isTestUser: true,
            persona: 'personal',
            testEnvironment: true
        });
        
        const testUrl = `${baseUrl}?test-login=${customToken}&test-mode=true`;
        
        return {
            success: true,
            testUrl: testUrl,
            customToken: customToken,
            user: {
                uid: userRecord.uid,
                email: userRecord.email
            }
        };
        
    } catch (error) {
        console.error('❌ Error generating test URL:', error);
        throw new functions.https.HttpsError('internal', 'Failed to generate test URL: ' + error.message);
    }
});

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
    // CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    // Only allow in development/test environments
    if (process.env.NODE_ENV === 'production' && !req.headers['x-test-environment']) {
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
