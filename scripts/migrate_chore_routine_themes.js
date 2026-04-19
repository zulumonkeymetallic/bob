const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

function inferThemeFromTitle(title, tags, type) {
    // Chores always get theme 10
    if (type === 'chore') return 10;

    const text = `${title || ''} ${(tags || []).join(' ')}`.toLowerCase();

    if (/meditate|meditation|mindful|yoga|prayer/.test(text)) return 9;
    if (/exercise|workout|gym|run|fitness|walk|jog|sport/.test(text)) return 1;
    if (/read|book|study|learn|course|education/.test(text)) return 4;
    if (/sleep|rest|relax|nap|unwind/.test(text)) return 11;
    if (/clean|chore|tidy|laundry|dishes|vacuum/.test(text)) return 10;
    if (/family|kids|children|spouse|partner/.test(text)) return 5;
    if (/work|career|meeting|project/.test(text)) return 2;
    if (/budget|finance|money|invest/.test(text)) return 3;
    if (/hobby|game|fun|play/.test(text)) return 6;

    return 9; // Default: Spiritual & Personal Growth
}

async function migrateChores() {
    console.log('Migrating chores...');
    const choresSnap = await db.collection('chores').get();

    let toUpdate = 0;
    let alreadyHaveTheme = 0;
    const batch = db.batch();

    choresSnap.docs.forEach(doc => {
        const data = doc.data();

        // Skip if already has theme
        if (data.theme != null || data.themeId != null) {
            alreadyHaveTheme++;
            return;
        }

        // All chores get theme 10 (Chores)
        batch.update(doc.ref, { theme: 10 });
        toUpdate++;
    });

    if (toUpdate > 0) {
        await batch.commit();
    }

    console.log(`  ✅ Updated ${toUpdate} chores with Chores theme (ID: 10)`);
    console.log(`  ℹ️  ${alreadyHaveTheme} chores already had themes`);
}

async function migrateRoutines() {
    console.log('\nMigrating routines...');
    const routinesSnap = await db.collection('routines').get();

    let toUpdate = 0;
    let alreadyHaveTheme = 0;
    const batch = db.batch();
    const themeStats = {};

    routinesSnap.docs.forEach(doc => {
        const data = doc.data();

        // Skip if already has theme
        if (data.theme != null || data.themeId != null) {
            alreadyHaveTheme++;
            return;
        }

        const theme = inferThemeFromTitle(data.title, data.tags, 'routine');
        batch.update(doc.ref, { theme });
        toUpdate++;

        // Track theme assignments for summary
        themeStats[theme] = (themeStats[theme] || 0) + 1;
    });

    if (toUpdate > 0) {
        await batch.commit();
    }

    console.log(`  ✅ Updated ${toUpdate} routines with inferred themes`);
    console.log(`  ℹ️  ${alreadyHaveTheme} routines already had themes`);

    if (Object.keys(themeStats).length > 0) {
        console.log('\n  Theme breakdown:');
        const themeNames = {
            1: 'Health & Fitness',
            2: 'Career & Professional',
            3: 'Finance & Wealth',
            4: 'Learning & Education',
            5: 'Family & Relationships',
            6: 'Hobbies & Interests',
            9: 'Spiritual & Personal Growth',
            10: 'Chores',
            11: 'Rest & Recovery'
        };
        Object.entries(themeStats).forEach(([themeId, count]) => {
            console.log(`    ${count}x ${themeNames[themeId] || `Theme ${themeId}`}`);
        });
    }
}

async function run() {
    console.log('🎨 Chores & Routines Theme Migration\n');
    console.log('This will assign themes to existing chores and routines.');
    console.log('Items with existing themes will be skipped.\n');

    try {
        await migrateChores();
        await migrateRoutines();

        console.log('\n✅ Migration complete!');
        console.log('\nNext steps:');
        console.log('  1. Create theme blocks in /calendar/planner (e.g., "Chores" Monday 9-10 AM)');
        console.log('  2. Run "Auto Plan with AI" to schedule chores/routines into theme blocks');
        console.log('  3. Check calendar to see chores/routines in their theme-colored blocks');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

run().catch(console.error);
