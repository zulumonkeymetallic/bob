const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function cleanupOrphans() {
    try {
        console.log(`Scanning 'sprint_task_index' for orphans...`);

        // Get all index entries
        const snapshot = await db.collection('sprint_task_index').get();
        console.log(`Total index entries: ${snapshot.size}`);

        const orphans = [];
        const batchSize = 500;
        let checked = 0;

        // Check in batches
        const chunks = [];
        for (let i = 0; i < snapshot.size; i += batchSize) {
            chunks.push(snapshot.docs.slice(i, i + batchSize));
        }

        for (const chunk of chunks) {
            const refs = chunk.map(doc => db.collection('tasks').doc(doc.id));
            const tasksSnap = await db.getAll(...refs);

            tasksSnap.forEach((doc, index) => {
                if (!doc.exists) {
                    orphans.push(chunk[index]);
                }
            });
            checked += chunk.length;
            if (checked % 1000 === 0) console.log(`Checked ${checked}/${snapshot.size}...`);
        }

        console.log(`\nFound ${orphans.length} orphan entries.`);

        if (orphans.length > 0) {
            console.log('Sample orphans:');
            orphans.slice(0, 5).forEach(doc => console.log(`- [${doc.id}] ${doc.data().title}`));

            // Delete orphans
            console.log(`\nDeleting ${orphans.length} orphans...`);
            const bulk = db.bulkWriter();
            orphans.forEach(doc => {
                bulk.delete(doc.ref);
            });
            await bulk.close();
            console.log('✅ Deletion complete.');
        } else {
            console.log('✅ No orphans found.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

cleanupOrphans();
