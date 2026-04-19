const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkDuplicateTasks() {
    try {
        console.log(`Searching for tasks with missing 'ref' and title containing 'Book my'...\n`);

        const snapshot = await db.collection('tasks').get();

        const tasks = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const title = (data.title || '').toLowerCase();
            // Check for missing ref and title match
            if ((!data.ref) && title.includes('book my')) {
                tasks.push({
                    id: doc.id,
                    ref: data.ref, // Should be undefined/null
                    generatedRef: `TASK-${doc.id.slice(-4).toUpperCase()}`,
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
        });

        console.log(`Found ${tasks.length} matching tasks:\n`);

        tasks.forEach(task => {
            console.log('---');
            console.log('ID:', task.id);
            console.log('Generated Ref:', task.generatedRef);
            console.log('Title:', task.title);
            console.log('Status:', task.status);
            console.log('Deleted:', task.deleted);
            console.log('DuplicateOf:', task.duplicateOf);
            console.log('Created:', task.createdAt);
            console.log('ReminderId:', task.reminderId);
        });

        // Check if these match the screenshot refs
        const screenshotRefs = ['TASK-TZHF', 'TASK-VG1W', 'TASK-A3SB', 'TASK-1M5C'];
        const foundRefs = tasks.map(t => t.generatedRef);
        const matches = foundRefs.filter(r => screenshotRefs.includes(r));

        console.log(`\nMatches with screenshot refs: ${matches.length} / ${screenshotRefs.length}`);
        if (matches.length > 0) {
            console.log(`Found matches: ${matches.join(', ')}`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkDuplicateTasks();
