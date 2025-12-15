const admin = require('firebase-admin');
const serviceAccount = require('./bob-firebase-admin.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkGoals() {
    try {
        // Get the test user's UID
        const userRecord = await admin.auth().getUserByEmail('agenticaitestuser@jc1.tech');
        console.log('Test User UID:', userRecord.uid);
        console.log('');

        // Query goals for this user
        const goalsSnapshot = await db.collection('goals')
            .where('ownerUid', '==', userRecord.uid)
            .get();

        console.log('Goals found for test user:', goalsSnapshot.size);
        console.log('');

        if (goalsSnapshot.empty) {
            console.log('No goals found with ownerUid matching test user.');
            console.log('Checking if there are ANY goals in the database...');

            const allGoals = await db.collection('goals').limit(5).get();
            console.log('Total goals in database (first 5):', allGoals.size);

            allGoals.forEach(doc => {
                const data = doc.data();
                console.log('  - ID:', doc.id);
                console.log('    ownerUid:', data.ownerUid || 'MISSING');
                console.log('    title:', data.title || 'MISSING');
                console.log('');
            });
        } else {
            goalsSnapshot.forEach(doc => {
                const data = doc.data();
                console.log('Goal ID:', doc.id);
                console.log('  Title:', data.title);
                console.log('  Start:', data.startDate?.toDate?.());
                console.log('  End:', data.endDate?.toDate?.());
                console.log('  Owner UID:', data.ownerUid);
                console.log('');
            });
        }
    } catch (error) {
        console.error('Error:', error.message);
    }

    process.exit(0);
}

checkGoals();
