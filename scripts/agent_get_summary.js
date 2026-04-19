const admin = require('firebase-admin');
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function run() {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const snapshot = await db.collection('calendar_blocks')
        .where('ownerUid', '==', '3L3nnXSuTPfr08c8DTXG5zYX37A2')
        .where('start', '>=', today.getTime())
        .orderBy('start')
        .get();
        
    const blocks = snapshot.docs.map(d => ({ title: d.data().title, time: new Date(d.data().start).toLocaleTimeString() }));
    console.log(JSON.stringify({ blocks }));
}
run();
