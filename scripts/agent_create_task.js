const admin = require('firebase-admin');
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const args = require('minimist')(process.argv.slice(2));
const title = args.title;
const due = args.due_date || new Date().toISOString();
const persona = args.persona || 'personal';

async function run() {
    if (!title) { console.error('Error: Title required'); process.exit(1); }
    
    // Parse Date logic here (simplified)
    const dueDateObj = new Date(due); 
    
    const docRef = await db.collection('tasks').add({
        title,
        dueDate: dueDateObj.toISOString(),
        persona,
        status: 'todo',
        source: 'agent_claw',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ownerUid: '3L3nnXSuTPfr08c8DTXG5zYX37A2' // Hardcoded for your user, ideally passed in
    });
    
    console.log(JSON.stringify({ success: true, taskId: docRef.id, message: 'Task created' }));
}
run();
