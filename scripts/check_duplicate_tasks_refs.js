const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkDuplicateTasks() {
    try {
        // Corrected refs from screenshot
        const refs = ['TASK-TZHF', 'TASK-VG1W', 'TASK-A3SB', 'TASK-1M5C'];
        console.log(`Searching for refs: ${refs.join(', ')}...\n`);

        const tasks = [];
        for (const ref of refs) {
            // Try searching by 'ref' field
            let snap = await db.collection('tasks').where('ref', '==', ref).limit(1).get();
            if (snap.empty) {
                // Try searching by ID just in case the ref is actually the ID (unlikely for TASK- prefix but possible)
                const doc = await db.collection('tasks').doc(ref).get();
                if (doc.exists) {
                    snap = { empty: false, docs: [doc] };
                }
            }

            if (!snap.empty) {
                const doc = snap.docs[0];
                const data = doc.data();
                tasks.push({
                    id: doc.id,
                    ref: data.ref,
                    title: data.title,
                    status: data.status,
                    deleted: data.deleted,
                    duplicateOf: data.duplicateOf,
                    createdAt: data.createdAt?.toDate?.() || data.createdAt,
                    reminderId: data.reminderId,
                    sourceRef: data.sourceRef,
                    ownerUid: data.ownerUid
                });
            }
        }

        console.log(`Found ${tasks.length} matching tasks by ref.\n`);

        if (tasks.length === 0) {
            console.log("No tasks found by ref. Listing recent tasks (last 24h)...");
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const recentSnap = await db.collection('tasks')
                .where('createdAt', '>', yesterday)
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();

            recentSnap.docs.forEach(doc => {
                const data = doc.data();
                console.log(`  - ${data.ref || doc.id}: ${data.title}`);
            });
        } else {
            tasks.forEach(task => {
                console.log('---');
                console.log('ID:', task.id);
                console.log('Ref:', task.ref);
                console.log('Title:', task.title);
                console.log('Status:', task.status);
                console.log('Deleted:', task.deleted);
                console.log('DuplicateOf:', task.duplicateOf);
                console.log('Created:', task.createdAt);
                console.log('ReminderId:', task.reminderId);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkDuplicateTasks();
