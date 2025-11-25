const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

async function checkDuplicateTasks() {
    try {
        // Search for title pattern from screenshot
        const titlePattern = 'Book my fiu job and check that it goes in the Bob';

        console.log(`Searching for tasks with title containing "fiu"...\n`);

        const snapshot = await db.collection('tasks').get();

        const tasks = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const title = data.title || '';
            if (title.toLowerCase().includes('fiu') || title.toLowerCase().includes('book my') && title.toLowerCase().includes('bob')) {
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

        if (tasks.length === 0) {
            console.log('No tasks found. Showing a sample of all tasks:');
            const sample = snapshot.docs.slice(0, 5);
            sample.forEach(doc => {
                const data = doc.data();
                console.log(`  - ${data.ref || doc.id}: ${(data.title || 'No title').substring(0, 60)}`);
            });
            return;
        }

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
            console.log(`Ref: ${task.ref}`);
            console.log(`ReminderId: ${task.reminderId || 'null'}`);

            if (!normalizedTitles.has(norm)) normalizedTitles.set(norm, []);
            normalizedTitles.get(norm).push(task.ref);
        });

        console.log(`\n\n=== Analysis ===`);
        console.log(`Total tasks: ${tasks.length}`);
        console.log(`Unique normalized titles: ${normalizedTitles.size}`);

        normalizedTitles.forEach((refs, title) => {
            if (refs.length > 1) {
                console.log(`\n✅ DUPLICATES FOUND:`);
                console.log(`  Title: "${title}"`);
                console.log(`  Refs: ${refs.join(', ')}`);
                console.log(`  Count: ${refs.length}`);
            }
        });

        // Check if these tasks should have been deduplicated
        const uniqueReminderIds = new Set(tasks.map(t => t.reminderId).filter(Boolean));
        console.log(`\n  Unique reminder IDs: ${uniqueReminderIds.size}`);

        if (normalizedTitles.size === 1 && tasks.length > 1) {
            console.log('\n❌ DEDUPLICATION FAILURE:');
            console.log('All tasks have the same normalized title but are still showing as separate!');
            console.log('\nPossible reasons:');
            if (uniqueReminderIds.size === tasks.length) {
                console.log('❌ Each task has a different reminderId - preventing strong-key dedupe');
            }
            console.log('❌ Title-based dedupe may not be running or has a bug');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await admin.app().delete();
    }
}

checkDuplicateTasks();
