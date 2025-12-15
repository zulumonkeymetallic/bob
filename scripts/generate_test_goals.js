const admin = require('firebase-admin');
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

const THEMES = [
    { id: 'theme_health', title: 'Health & Fitness', color: '#10B981' },
    { id: 'theme_career', title: 'Career Growth', color: '#3B82F6' },
    { id: 'theme_finance', title: 'Financial Freedom', color: '#F59E0B' },
    { id: 'theme_personal', title: 'Personal Development', color: '#8B5CF6' }
];

const USER_EMAIL = 'agenticaitestuser@jc1.tech';

async function generateGoals() {
    try {
        // 1. Get User UID
        const userRecord = await admin.auth().getUserByEmail(USER_EMAIL);
        const uid = userRecord.uid;
        console.log(`Found user ${USER_EMAIL} with UID: ${uid}`);

        // 2. Generate 12 Goals (to satisfy 3 per theme for 4 themes)
        const goals = [];
        const now = new Date();

        for (let i = 0; i < 12; i++) {
            const themeIndex = i % 4;
            const theme = THEMES[themeIndex];

            // Random Dates over 10 years
            const startOffset = Math.random() * (9 * 365 * 24 * 60 * 60 * 1000);
            const startDate = new Date(now.getTime() + startOffset);

            // Duration: 1 month to 1 year
            const duration = (30 + Math.random() * 335) * 24 * 60 * 60 * 1000;
            const endDate = new Date(startDate.getTime() + duration);

            const goal = {
                title: `Test Goal ${i + 1}: ${theme.title}`,
                description: `Automated test goal for roadmap assessment. Focus on ${theme.title}.`,
                theme: theme.id,
                themeColor: theme.color,
                startDate: admin.firestore.Timestamp.fromDate(startDate),
                endDate: admin.firestore.Timestamp.fromDate(endDate),
                targetDate: admin.firestore.Timestamp.fromDate(endDate),
                status: 'Not Started',
                progress: Math.floor(Math.random() * 100),
                ownerUid: uid,
                persona: 'professional',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                isTest: true
            };

            goals.push(goal);
        }

        // 3. Batch Write
        const batch = db.batch();
        goals.forEach(g => {
            const ref = db.collection('goals').doc();
            batch.set(ref, g);
        });

        await batch.commit();
        console.log(`Successfully created ${goals.length} test goals for ${USER_EMAIL}`);

    } catch (error) {
        console.error('Error generating goals:', error);
        process.exit(1);
    }
}

generateGoals();
