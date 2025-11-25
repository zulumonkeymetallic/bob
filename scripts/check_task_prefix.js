const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkTaskPrefix() {
    try {
        console.log(`Searching for tasks with ref starting with "TASK-"...\n`);

        // Firestore doesn't support 'startsWith' natively in all SDK versions easily without range queries
        // We'll just get a batch and check
        const snapshot = await db.collection('tasks').limit(100).get();

        const taskRefs = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.ref && data.ref.startsWith('TASK-')) {
                taskRefs.push({ id: doc.id, ref: data.ref, title: data.title });
            }
        });

        console.log(`Found ${taskRefs.length} tasks with TASK- prefix in first 100 docs.`);
        taskRefs.forEach(t => console.log(`- ${t.ref}: ${t.title}`));

        if (taskRefs.length === 0) {
            console.log("Checking if ANY tasks have 'TASK-' prefix by range query...");
            const rangeSnap = await db.collection('tasks')
                .where('ref', '>=', 'TASK-')
                .where('ref', '<=', 'TASK-\uf8ff')
                .limit(10)
                .get();

            console.log(`Found ${rangeSnap.size} tasks via range query.`);
            rangeSnap.docs.forEach(doc => {
                const data = doc.data();
                console.log(`- ${data.ref}: ${data.title}`);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkTaskPrefix();
