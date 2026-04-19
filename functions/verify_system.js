
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Service Account Path
const serviceAccountPath = '/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json';

if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Service account not found at: ${serviceAccountPath}`);
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function verifySystem() {
    const results = {
        timestamp: new Date().toISOString(),
        checks: {},
        data: {}
    };

    try {
        console.log('Starting System Verification...');

        // Hardcoded target user as requested
        const targetUid = '3L3nnXSuTPfr08c8DTXG5zYX37A2';
        console.log(`Targeting specific user: ${targetUid}`);

        // 1. Verify User Exists
        const userDoc = await db.collection('users').doc(targetUid).get();
        if (userDoc.exists) {
            results.data.users = [{ id: userDoc.id, ...userDoc.data() }];
            console.log('User found.');
        } else {
            console.warn('Target user NOT found in users collection (checking profiles...)');
            const profileDoc = await db.collection('profiles').doc(targetUid).get();
            if (profileDoc.exists) {
                results.data.users = [{ id: profileDoc.id, ...profileDoc.data() }];
                console.log('User profile found.');
            }
        }

        if (targetUid) {
            console.log(`Performing deep dive for user: ${targetUid}`);
            results.checks.targetUser = targetUid;

            // 2. Verify Stories (Active/In-Progress)
            const storiesSnap = await db.collection('stories')
                .where('ownerUid', '==', targetUid)
                .where('status', 'in', ['active', 'in-progress', 'planned'])
                .limit(20)
                .get();

            results.data.stories = storiesSnap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    title: data.title,
                    status: data.status,
                    theme: data.theme,
                    points: data.points,
                    hasAcceptanceCriteria: !!(data.acceptanceCriteria && data.acceptanceCriteria.length),
                    aiEnriched: !!data.aiEnriched
                };
            });

            // 3. Verify Tasks (Due Today / Overdue / Mac Agent)
            const todayStr = new Date().toISOString().split('T')[0];
            const tasksSnap = await db.collection('tasks')
                .where('ownerUid', '==', targetUid)
                .limit(100)
                .get();

            results.data.tasks = tasksSnap.docs
                .map(d => {
                    const data = d.data();
                    return {
                        id: d.id,
                        title: data.title,
                        status: data.status,
                        dueDate: data.dueDate ? new Date(data.dueDate.toDate ? data.dueDate.toDate() : data.dueDate).toISOString() : null,
                        source: data.source,
                        storyId: data.storyId
                    };
                })
                .filter(t => t.status !== 'done' && t.status !== 2);

            // Check for Mac Agent tasks
            results.checks.macAgentTasksCount = results.data.tasks.filter(t => t.source === 'mac_app' || t.source === 'MacApp').length;

            // 4. Verify Calendar Blocks (Next 7 Days)
            const now = new Date();
            const nextWeek = new Date();
            nextWeek.setDate(now.getDate() + 7);

            const blocksSnap = await db.collection('calendar_blocks')
                .where('ownerUid', '==', targetUid)
                .where('start', '>=', now.getTime())
                .where('start', '<=', nextWeek.getTime())
                .orderBy('start')
                .get();

            results.data.calendarBlocks = blocksSnap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    title: data.title,
                    start: new Date(data.start).toISOString(),
                    type: data.entityType || 'block',
                    aiGenerated: data.aiGenerated,
                    status: data.status,
                    storyId: data.storyId, // Critical for proving story blocks
                    aiMetadata: data.aiMetadata
                };
            });

            // 5. Verify AI Specifics & Story Blocks
            console.log('Verifying AI & Advanced Features...');

            // A. Story Blocks in Calendar
            const storyBlocks = results.data.calendarBlocks.filter(b => b.storyId);
            results.checks.storyBlocksCount = storyBlocks.length;
            results.data.storyBlocksSample = storyBlocks.slice(0, 5);

            // B. AI Enrichment on Stories
            const enrichedStories = results.data.stories.filter(s => s.aiEnriched || s.aiMetadata);
            results.checks.enrichedStoriesCount = enrichedStories.length;
            results.data.enrichedStoriesSample = enrichedStories.slice(0, 5);

            // C. Task to Story Conversion Evidence
            // Look for stories that might have 'originalTaskId' or similar provenance
            const convertedStories = storiesSnap.docs
                .map(d => d.data())
                .filter(s => s.originalTaskId || s.source === 'task_conversion');
            results.checks.convertedStoriesCount = convertedStories.length;

            // D. Prioritisation Metadata
            // Check for 'score', 'priorityReasoning' on tasks
            const prioritizedTasks = results.data.tasks.filter(t => t.score || t.aiPriority);
            results.checks.prioritizedTasksCount = prioritizedTasks.length;
            if (prioritizedTasks.length > 0) {
                results.data.prioritizationSample = prioritizedTasks[0];
            }

            // 6. Verify Daily Digests (Latest)
            const digestsSnap = await db.collection('daily_digests')
                .where('userId', '==', targetUid)
                .limit(20)
                .get();

            if (!digestsSnap.empty) {
                const digests = digestsSnap.docs.map(d => d.data());
                digests.sort((a, b) => {
                    const tA = a.generatedAt && a.generatedAt.toDate ? a.generatedAt.toDate().getTime() : 0;
                    const tB = b.generatedAt && b.generatedAt.toDate ? b.generatedAt.toDate().getTime() : 0;
                    return tB - tA;
                });
                const digest = digests[0];
                results.data.latestDigest = {
                    date: digest.date,
                    aiInsightsLength: digest.aiInsights ? digest.aiInsights.length : 0,
                    metrics: digest.metrics,
                    emailSent: digest.emailSent
                };
            }

            // 6. Verify Sprints
            const sprintsSnap = await db.collection('sprints')
                .where('ownerUid', '==', targetUid)
                .where('status', '==', 'active')
                .limit(1)
                .get();

            if (!sprintsSnap.empty) {
                const sprint = sprintsSnap.docs[0].data();
                results.data.activeSprint = {
                    title: sprint.title || sprint.name,
                    goal: sprint.goal || sprint.objective,
                    startDate: sprint.startDate,
                    endDate: sprint.endDate
                };
            }
        }

        // 7. Check for Mac Agent specific collection or docs if any (e.g. integration_status)
        if (targetUid) {
            const integrationSnap = await db.collection('integration_status').doc(`mac_agent_${targetUid}`).get();
            results.data.macAgentStatus = integrationSnap.exists ? integrationSnap.data() : 'Not Found';
        }

        console.log('Verification Complete.');
        fs.writeFileSync('verification_output.json', JSON.stringify(results, null, 2));

    } catch (error) {
        console.error('Verification Failed:', error);
        results.error = error.message;
        fs.writeFileSync('verification_output.json', JSON.stringify(results, null, 2));
    }
}

verifySystem();
