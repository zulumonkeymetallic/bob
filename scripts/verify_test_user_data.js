const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const auth = admin.auth();

async function checkUserData() {
    const email = 'agenticaitestuser@jc1.tech';
    try {
        const user = await auth.getUserByEmail(email);
        console.log(`User found: ${user.email} (UID: ${user.uid})`);

        // Check Goals
        const goalsRef = db.collection('goals').where('ownerUid', '==', user.uid);
        const goalsSnap = await goalsRef.get();
        console.log(`Goals found: ${goalsSnap.size}`);

        // Check Stories
        const storiesRef = db.collection('stories').where('ownerUid', '==', user.uid);
        const storiesSnap = await storiesRef.get();
        console.log(`Stories found: ${storiesSnap.size}`);

        // Check Sprints
        const sprintsRef = db.collection('sprints').where('ownerUid', '==', user.uid);
        const sprintsSnap = await sprintsRef.get();
        console.log(`Sprints found: ${sprintsSnap.size}`);

        // Check Activity Stream
        const activityRef = db.collection('activity_stream').where('ownerUid', '==', user.uid).limit(5);
        const activitySnap = await activityRef.get();
        console.log(`Activity Stream entries found: ${activitySnap.size}`);

    } catch (error) {
        console.error('Error fetching user data:', error);
    }
}

checkUserData();
