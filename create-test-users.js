const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
    admin.initializeApp();
}

async function createTestUsers() {
    const testUsers = [
        {
            email: 'test1@bob.local',
            password: 'test123456',
            displayName: 'Test User 1',
            emailVerified: true
        },
        {
            email: 'test2@bob.local', 
            password: 'test123456',
            displayName: 'Test User 2',
            emailVerified: true
        },
        {
            email: 'tester@bob.local',
            password: 'password123',
            displayName: 'Tester',
            emailVerified: true
        }
    ];

    console.log('Creating test users...');

    for (const userData of testUsers) {
        try {
            // Check if user already exists
            try {
                const existingUser = await admin.auth().getUserByEmail(userData.email);
                console.log(`✅ User ${userData.email} already exists with UID: ${existingUser.uid}`);
                continue;
            } catch (error) {
                if (error.code !== 'auth/user-not-found') {
                    throw error;
                }
            }

            // Create new user
            const userRecord = await admin.auth().createUser(userData);
            console.log(`✅ Created user: ${userData.email} with UID: ${userRecord.uid}`);

        } catch (error) {
            console.error(`❌ Error creating user ${userData.email}:`, error.message);
        }
    }

    console.log('✨ Test user creation complete!');
    process.exit(0);
}

createTestUsers().catch(console.error);
