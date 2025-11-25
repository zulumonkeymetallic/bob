const admin = require('firebase-admin');

/**
 * Mock sync function that verifies data is ready for Google Calendar sync
 * Reads from 'scheduled_instances' which is the output of the new scheduler
 */
async function syncPlanToGoogleForUser(db, uid, dayStr) {
    console.log(`[MockSync] Syncing plan for ${uid} on ${dayStr}`);

    // 1. Fetch scheduled instances
    // engine.js uses YYYY-MM-DD for dayKey
    const dayKey = dayStr;

    console.log(`[MockSync] Querying scheduled_instances: ownerUid=${uid}, dayKey=${dayKey}, status=planned`);

    const instancesSnap = await db.collection('scheduled_instances')
        .where('ownerUid', '==', uid)
        .where('dayKey', '==', dayKey)
        .where('status', '==', 'planned')
        .get();

    if (instancesSnap.empty) {
        console.log('[MockSync] No instances found to sync');
        return { ok: true, synced: 0 };
    }

    const instances = instancesSnap.docs.map(d => d.data());
    console.log(`[MockSync] Found ${instances.length} instances ready to sync:`);
    instances.forEach(i => {
        console.log(`  - ${i.title}`);
        console.log(`    Time: ${i.plannedStart} - ${i.plannedEnd}`);
        console.log(`    Theme: ${i.theme}`);
        console.log(`    DeepLink: ${i.deepLink || 'N/A'}`);
        if (i.acceptanceCriteria) {
            console.log(`    Acceptance Criteria: Yes (${i.acceptanceCriteria.length} items)`);
        }
    });

    console.log('[MockSync] (Skipping actual Google API call due to missing credentials/secrets in local environment)');
    console.log('[MockSync] Data verification successful ✅');

    return { ok: true, synced: instances.length };
}

module.exports = { syncPlanToGoogleForUser };
