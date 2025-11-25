const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkIndexIntegrity() {
    try {
        console.log(`Searching 'sprint_task_index' for "flu"...\n`);

        const snapshot = await db.collection('sprint_task_index').get();

        const indexTasks = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if ((data.title || '').toLowerCase().includes('flu')) {
                indexTasks.push({
                    id: doc.id,
                    title: data.title,
                    ref: data.ref,
                    sprintId: data.sprintId,
                    status: data.status
                });
            }
        });

        console.log(`Found ${indexTasks.length} tasks in index:\n`);

        for (const task of indexTasks) {
            console.log(`Checking Task [${task.id}] "${task.title}"...`);
            const taskDoc = await db.collection('tasks').doc(task.id).get();
            if (taskDoc.exists) {
                console.log(`  ✅ Exists in 'tasks' collection.`);
                const data = taskDoc.data();
                console.log(`     Ref: ${data.ref}`);
                console.log(`     ReminderId: ${data.reminderId}`);
            } else {
                console.log(`  ❌ MISSING from 'tasks' collection! (Orphan index entry)`);
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkIndexIntegrity();
