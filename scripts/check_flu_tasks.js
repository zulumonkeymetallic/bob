const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkDuplicateTasks() {
    try {
        console.log(`Searching for ANY tasks containing "flu" (case insensitive)...\n`);

        const snapshot = await db.collection('tasks').get();

        const tasks = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const title = (data.title || '').toLowerCase();
            if (title.includes('flu')) {
                tasks.push({
                    id: doc.id,
                    ref: data.ref,
                    title: data.title,
                    status: data.status,
                    ownerUid: data.ownerUid
                });
            }
        });

        console.log(`Found ${tasks.length} matching tasks:\n`);

        tasks.forEach(task => {
            console.log(`- [${task.ref || task.id}] ${task.title} (Status: ${task.status})`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkDuplicateTasks();
