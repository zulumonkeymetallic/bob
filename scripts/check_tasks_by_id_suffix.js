const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkDuplicateTasks() {
    try {
        const suffixes = ['TZHF', 'VG1W', 'A3SB', '1M5C'];
        console.log(`Searching for tasks with ID ending in: ${suffixes.join(', ')}...\n`);

        const snapshot = await db.collection('tasks').get();

        const tasks = [];
        snapshot.docs.forEach(doc => {
            const id = doc.id;
            if (suffixes.some(s => id.endsWith(s))) {
                const data = doc.data();
                tasks.push({
                    id: doc.id,
                    ref: data.ref,
                    title: data.title,
                    status: data.status,
                    deleted: data.deleted,
                    ownerUid: data.ownerUid,
                    reminderId: data.reminderId
                });
            }
        });

        console.log(`Found ${tasks.length} matching tasks in 'tasks' collection:\n`);
        tasks.forEach(t => console.log(t));

        // Check sprint_task_index just in case
        console.log(`\nChecking 'sprint_task_index' collection...`);
        const indexSnap = await db.collection('sprint_task_index').get();
        const indexTasks = [];
        indexSnap.docs.forEach(doc => {
            const id = doc.id;
            if (suffixes.some(s => id.endsWith(s))) {
                const data = doc.data();
                indexTasks.push({
                    id: doc.id,
                    title: data.title,
                    ref: data.ref
                });
            }
        });
        console.log(`Found ${indexTasks.length} matching tasks in 'sprint_task_index'.`);
        indexTasks.forEach(t => console.log(t));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkDuplicateTasks();
