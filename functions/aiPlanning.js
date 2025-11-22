const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { planSchedule } = require('./scheduler/engine');
const { generateDailyDigest } = require('./dailyDigestGenerator');
const aiUsageLogger = require('./utils/aiUsageLogger');

const GOOGLE_AI_STUDIO_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');

/**
 * Nightly AI Scheduler
 * Runs every night at 02:00 to generate the schedule for the next 7 days.
 */
exports.runNightlyScheduler = onSchedule({
    schedule: '0 2 * * *',
    timeZone: 'Europe/London',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [GOOGLE_AI_STUDIO_API_KEY]
}, async (event) => {
    console.log('🌙 Starting Nightly AI Scheduler...');
    const db = admin.firestore();

    // 1. Get all active users
    const usersSnap = await db.collection('users').get(); // In prod, filter by active status

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        try {
            console.log(`Processing user: ${userId}`);

            // 2. Generate Story Blocks (High Priority)
            await generateStoryBlocks(db, userId);

            // 3. Generate Routine & Chore Tasks for tomorrow
            await generateRoutineTasks(db, userId);

            // 4. Rebuild Rolling 7-Day Calendar
            const today = new Date();
            const windowStart = new Date(today);
            const windowEnd = new Date(today);
            windowEnd.setDate(today.getDate() + 7);

            await planSchedule({
                db,
                userId,
                windowStart,
                windowEnd,
                busy: [] // TODO: Fetch Google Calendar busy times if needed here, or let engine handle it
            });

            console.log(`✅ Nightly schedule built for ${userId}`);
        } catch (error) {
            console.error(`❌ Error in nightly scheduler for ${userId}:`, error);
        }
    }
});

/**
 * Morning Daily AI Planner
 * Runs every morning at 06:00 to finalize today's plan.
 */
exports.runMorningPlanner = onSchedule({
    schedule: '0 6 * * *',
    timeZone: 'Europe/London',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [GOOGLE_AI_STUDIO_API_KEY]
}, async (event) => {
    console.log('☀️ Starting Morning AI Planner...');
    const db = admin.firestore();

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        try {
            // 1. Evaluate Today's Schedule & Enforce "Task Due Today"
            await enforceTaskDueToday(db, userId);

            // 2. Re-run Prioritisation (Lightweight)
            // This is implicitly done by planSchedule if we re-run it, or we can trust nightly
            // For now, let's trust nightly unless "Task Due Today" forced a change.

            // 3. Generate Daily Digest (Email)
            // Note: dailyDigestGenerator is also scheduled, but we can trigger it here to ensure sequence
            // Or let it run on its own schedule (06:30). 
            // Requirement says "Produce the daily summary email". 
            // We'll let the existing scheduled function handle it to avoid double sending, 
            // OR we can call the logic directly if we want tight coupling.
            // Given existing code, let's leave it to the separate scheduler but ensure data is ready.

            console.log(`✅ Morning planning complete for ${userId}`);
        } catch (error) {
            console.error(`❌ Error in morning planner for ${userId}:`, error);
        }
    }
});

/**
 * Helper: Generate Story Blocks for High Priority Stories
 */
async function generateStoryBlocks(db, userId) {
    const storiesSnap = await db.collection('stories')
        .where('ownerUid', '==', userId)
        .where('status', 'in', ['active', 'in-progress'])
        .get();

    const today = new Date();
    const next7Days = [];
    for (let i = 1; i <= 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        next7Days.push(d);
    }

    for (const doc of storiesSnap.docs) {
        const story = doc.data();
        // Simple heuristic: If story is "in-progress" and has no blocks in the next 3 days, schedule one.
        // In a real implementation, this would check 'points' remaining vs 'hours' scheduled.

        const blocksSnap = await db.collection('calendar_blocks')
            .where('ownerUid', '==', userId)
            .where('storyId', '==', doc.id)
            .where('start', '>', today.getTime())
            .get();

        if (blocksSnap.empty) {
            // Schedule a block for tomorrow or next available slot
            // For now, we just log it as a "Suggestion" or create a "Planned" block
            // We'll use the planSchedule engine to actually place it, but we need to create the "Demand"
            // The current engine uses 'stories' collection directly. 
            // So we might not need to manually create blocks here if the engine handles it.
            // BUT, the requirements say "Nightly AI Scheduler: Generate story blocks".
            // So let's create a "proposed" block.

            const targetDate = next7Days[0]; // Tomorrow
            const start = new Date(targetDate);
            start.setHours(10, 0, 0, 0); // Default 10am
            const end = new Date(start);
            end.setHours(12, 0, 0, 0); // 2 hours default

            await db.collection('calendar_blocks').add({
                ownerUid: userId,
                storyId: doc.id,
                title: story.title,
                start: start.getTime(),
                end: end.getTime(),
                theme: story.theme || 'Work',
                status: 'planned', // Engine will move this if needed
                aiGenerated: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`🤖 Auto-generated block for story: ${story.title}`);
        }
    }
}

/**
 * Helper: Generate Routine & Chore Tasks
 */
async function generateRoutineTasks(db, userId) {
    // This is handled by `upsertChoreBlocksForTask` in engine.js usually, 
    // but we need to ensure they exist as Tasks if they are due.
    // For now, we will rely on the engine's existing logic which we call in the main function.
    // We can add specific logic here if we need "Task" entities for every chore instance.
}

/**
 * Helper: Enforce "Task Due Today"
 */
async function enforceTaskDueToday(db, userId) {
    const todayStr = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(todayStr);
    const endOfDay = new Date(todayStr);
    endOfDay.setHours(23, 59, 59, 999);

    const tasksSnap = await db.collection('tasks')
        .where('ownerUid', '==', userId)
        .where('dueDate', '>=', startOfDay)
        .where('dueDate', '<=', endOfDay)
        .where('status', '!=', 'done')
        .get();

    for (const doc of tasksSnap.docs) {
        const task = doc.data();
        if (task.storyId) {
            // Check if story block exists today
            const blocksSnap = await db.collection('calendar_blocks')
                .where('ownerUid', '==', userId)
                .where('storyId', '==', task.storyId)
                .where('start', '>=', startOfDay.getTime())
                .where('start', '<=', endOfDay.getTime())
                .get();

            if (blocksSnap.empty) {
                console.warn(`⚠️ Task ${task.title} due today but no story block! Force inserting...`);
                // Force insert logic here
                await forceInsertStoryBlock(db, userId, task.storyId, todayStr);
            }
        }
    }
}

async function forceInsertStoryBlock(db, userId, storyId, dateStr) {
    // 1. Find a slot (even if it conflicts)
    // 2. Create block with "Conflict - Requires Review" if needed
    // 3. Notify user (via digest)

    const storyDoc = await db.collection('stories').doc(storyId).get();
    if (!storyDoc.exists) return;
    const story = storyDoc.data();

    // Default to 1 hour block at 9am if no other logic
    const start = new Date(`${dateStr}T09:00:00`);
    const end = new Date(`${dateStr}T10:00:00`);

    await db.collection('calendar_blocks').add({
        ownerUid: userId,
        storyId: storyId,
        title: story.title,
        start: start.getTime(),
        end: end.getTime(),
        theme: story.theme || 'Work',
        status: 'force-inserted',
        conflictStatus: 'requires_review',
        placementReason: 'Task due today mandatory block',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

// Expose other triggers for Story/Task enrichment
exports.onStoryWrite = functions.firestore.document('stories/{storyId}').onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return;

    // If new story or description changed, and no acceptance criteria, generate it
    if ((!after.acceptanceCriteria || after.acceptanceCriteria.length === 0) && after.description) {
        await enrichStory(change.after.ref, after);
    }
});

async function enrichStory(ref, story) {
    const systemPrompt = `You are an expert Agile Product Owner. 
  Analyze the following User Story and generate:
  1. A set of clear, testable Acceptance Criteria (AC).
  2. A list of sub-tasks required to complete the story.
  3. A theme classification (Growth, Health, Wealth, Tribe, Home, Work).
  4. An estimation of complexity points (1, 2, 3, 5, 8).
  
  Return ONLY valid JSON in this format:
  {
    "acceptanceCriteria": ["AC1", "AC2"],
    "tasks": [{"title": "Task 1", "estimateMin": 30}, ...],
    "theme": "Work",
    "points": 3
  }`;

    const userPrompt = `Story Title: ${story.title}\nDescription: ${story.description || 'No description'}`;

    try {
        const { callLLM } = require('./utils/llmHelper');

        const result = await callLLM(systemPrompt, userPrompt);
        const data = JSON.parse(result);

        await ref.update({
            acceptanceCriteria: data.acceptanceCriteria,
            theme: data.theme || story.theme,
            points: story.points || data.points,
            aiEnriched: true,
            aiMetadata: {
                generatedAt: new Date().toISOString(),
                reasoning: "Auto-generated by BOB AI"
            }
        });

        // Create Tasks
        if (data.tasks && Array.isArray(data.tasks)) {
            const db = admin.firestore(); // Get db instance here as it's not passed directly
            const batch = db.batch();
            data.tasks.forEach(task => {
                const taskRef = db.collection('tasks').doc();
                batch.set(taskRef, {
                    ownerUid: story.ownerUid,
                    title: task.title,
                    storyId: ref.id,
                    estimateMin: task.estimateMin,
                    status: 'todo',
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }

    } catch (e) {
        console.error("Failed to enrich story:", e);
    }
}

module.exports = {
    runNightlyScheduler: exports.runNightlyScheduler,
    runMorningPlanner: exports.runMorningPlanner,
    onStoryWrite: exports.onStoryWrite
};
