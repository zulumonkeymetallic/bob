const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkDuplicateTasks() {
    try {
        // Corrected search term from 'fiu' to 'flu'
        const titlePattern = 'Book my flu job';

        console.log(`Searching for tasks with title containing "${titlePattern}"...\n`);

        const snapshot = await db.collection('tasks').get();

        const tasks = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const title = data.title || '';
            if (title.toLowerCase().includes(titlePattern.toLowerCase())) {
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
                    ownerUid: data.ownerUid,
                    iosReminderId: data.iosReminderId,
                    taskId: data.taskId
                });
            }
        });

        console.log(`Found ${tasks.length} matching tasks:\n`);

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
            console.log('iOS ReminderId:', task.iosReminderId);
        });

        // Test normalization
        console.log('\n\n=== Testing Title Normalization ===');
        const normalizeTitleHardened = (s) => {
            if (!s) return '';
            let str = String(s);
            try { str = str.normalize('NFKD'); } catch { }
            str = str.replace(/[\u0300-\u036f]/g, '');
            str = str.replace(/[\u200B-\u200D\uFEFF\u00AD\u061C\u2060-\u206F\uFE0E\uFE0F]/g, '');
            str = str.toLowerCase();
            str = str.replace(/https?:\/\/\S+/g, ' ');
            str = str.replace(/www\.[^\s]+/g, ' ');
            str = str.replace(/[\[\]{}()\\"'`""''.,!?;:<>_~*^#%\/\\|+\-=]/g, ' ');
            return str.replace(/\s+/g, ' ').trim();
        };

        const normalizedTitles = new Map();  // norm -> [refs]

        tasks.forEach(task => {
            const norm = normalizeTitleHardened(task.title);
            console.log(`\nOriginal: "${task.title}"`);
            console.log(`Normalized: "${norm}"`);

            if (!normalizedTitles.has(norm)) normalizedTitles.set(norm, []);
            normalizedTitles.get(norm).push(task.ref || task.id);
        });

        console.log(`\n\n=== Analysis ===`);
        console.log(`Total tasks: ${tasks.length}`);
        console.log(`Unique normalized titles: ${normalizedTitles.size}`);

        if (normalizedTitles.size === 1 && tasks.length > 1) {
            console.log('\n✅ All titles normalize to the same value.');
            console.log('These SHOULD be deduplicated by title-based logic.');
        } else {
            console.log('❌ Titles normalize to different values or no duplicates found.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkDuplicateTasks();
