const admin = require('firebase-admin');
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();
const auth = admin.auth();

async function seedTestData() {
    console.log('🚀 Seeding Test User Data for V5 Roadmap Verification...');

    // 1. Get User UID
    const email = 'agenticaitestuser@jc1.tech';
    let user;
    try {
        user = await auth.getUserByEmail(email);
        console.log(`✅ User found: ${user.uid}`);
    } catch (e) {
        console.error('❌ User not found, aborting.');
        process.exit(1);
    }
    const uid = user.uid;

    // 2. Check & Clear Existing Goals
    const existingGoals = await db.collection('goals').where('ownerUid', '==', uid).get();
    if (!existingGoals.empty) {
        console.log(`🧹 Clearing ${existingGoals.size} existing goals...`);
        const batch = db.batch();
        existingGoals.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
    }

    // 3. Create Seed Data
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const batch = db.batch();

    // Goal 1: Health (Theme 1)
    const g1Ref = db.collection('goals').doc();
    batch.set(g1Ref, {
        ownerUid: uid,
        title: 'Run a Marathon',
        theme: 1, // Health
        startDate: now,
        endDate: now + 90 * DAY,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Goal 2: Wealth (Theme 3)
    const g2Ref = db.collection('goals').doc();
    batch.set(g2Ref, {
        ownerUid: uid,
        title: 'Save $10k',
        theme: 3, // Wealth
        startDate: now + 10 * DAY,
        endDate: now + 60 * DAY,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Goal 3: Career (Theme 2)
    const g3Ref = db.collection('goals').doc();
    batch.set(g3Ref, {
        ownerUid: uid,
        title: 'Get Promoted',
        theme: 2, // Career
        startDate: now - 10 * DAY,
        endDate: now + 40 * DAY,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Story for Goal 1
    const s1Ref = db.collection('stories').doc();
    batch.set(s1Ref, {
        ownerUid: uid,
        title: 'Training Week 1',
        goalId: g1Ref.id,
        points: 5,
        status: 'done',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();
    console.log('✅ Seeded 3 Goals and 1 Story.');
    process.exit(0);
}

seedTestData().catch(e => {
    console.error('Failed', e);
    process.exit(1);
});
