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
    region: 'europe-west2',
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

            // Fetch Theme Allocations
            let themeAllocations = [];
            try {
                const taDoc = await db.collection('theme_allocations').doc(userId).get();
                if (taDoc.exists) themeAllocations = taDoc.data().allocations || [];
            } catch (e) { console.warn('Failed to fetch theme allocations', e); }

            const scheduleResult = await planSchedule({
                db,
                userId,
                windowStart,
                windowEnd,
                busy: [], // TODO: Fetch Google Calendar busy times if needed here
                themeAllocations
            });

            // 5. Save Schedule to Firestore
            await saveScheduleToFirestore(db, userId, scheduleResult);

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
    region: 'europe-west2',
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

        // SMART BLOCKING LOGIC
        // 1. Calculate needed blocks: Points / 2 (e.g. 3 pts = 2 blocks, 5 pts = 3 blocks)
        // Default to 1 block if points missing.
        const points = Number(story.points) || 1;
        const blocksNeeded = Math.ceil(points / 2);

        // 2. Check existing blocks in future
        const blocksSnap = await db.collection('calendar_blocks')
            .where('ownerUid', '==', userId)
            .where('storyId', '==', doc.id)
            .where('start', '>', today.getTime())
            .get();

        const blocksExisting = blocksSnap.size;
        const blocksToCreate = blocksNeeded - blocksExisting;

        if (blocksToCreate > 0) {
            console.log(`🤖 Story "${story.title}" (${points} pts) needs ${blocksNeeded} blocks. Has ${blocksExisting}. Creating ${blocksToCreate}...`);

            for (let b = 0; b < blocksToCreate; b++) {
                // Simple placement: Spread over next few days
                // Day index = (Existing + b) % 7
                const dayIndex = (blocksExisting + b) % 7;
                const targetDate = next7Days[dayIndex];

                const start = new Date(targetDate);
                start.setHours(10, 0, 0, 0); // Default 10am
                const end = new Date(start);
                end.setHours(12, 0, 0, 0); // 2 hours default

                await db.collection('calendar_blocks').add({
                    ownerUid: userId,
                    storyId: doc.id,
                    title: story.title, // + ` (Part ${blocksExisting + b + 1})`,
                    start: start.getTime(),
                    end: end.getTime(),
                    theme: story.theme || 'Work',
                    status: 'planned',
                    aiGenerated: true,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Log to Activity Stream
                await db.collection('activity_stream').add({
                    ownerUid: userId,
                    type: 'system_event',
                    category: 'scheduling',
                    message: `Scheduled block for story "${story.title}"`,
                    relatedId: doc.id,
                    relatedType: 'story',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            }
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
  3. A theme classification (General, Health & Fitness, Career & Professional, Finance & Wealth, Learning & Education, Family & Relationships, Hobbies & Interests, Travel & Adventure, Home & Living, Spiritual & Personal Growth, Chores, Rest & Recovery, Work (Main Gig), Side Gig, Sleep, Random).
  4. An estimation of complexity points (1, 2, 3, 5, 8).
  
  Return ONLY valid JSON in this format:
  {
    "acceptanceCriteria": ["AC1", "AC2"],
    "tasks": [{"title": "Task 1", "estimateMin": 30}, ...],
    "theme": "Work (Main Gig)",
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
            points: Number(data.points) || story.points || 1, // Ensure numeric
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

/**
 * Helper: Save Schedule Results to Firestore
 */
async function saveScheduleToFirestore(db, userId, result) {
    try {
        const { planned, conflicts } = result;
        const batch = db.batch();
        let opCount = 0;
        const MAX_BATCH = 400;

        console.log(`💾 Saving ${planned.length} items and ${conflicts.length} conflicts...`);

        // 1. Save Planned Items
        for (const item of planned) {
            // We use a deterministic ID to avoid duplicates: sourceId_date
            // But calendar_blocks usually have random IDs. 
            // To avoid thrashing, we'll try to match existing blocks or just create new ones if they don't map.
            // For this implementation, we'll use the engine's instance ID as the doc ID.

            const docRef = db.collection('calendar_blocks').doc(item.id);

            const start = new Date(item.plannedStart).getTime();
            const end = new Date(item.plannedEnd).getTime();

            batch.set(docRef, {
                ownerUid: userId,
                title: item.title,
                start,
                end,
                sourceType: item.sourceType,
                sourceId: item.sourceId,
                storyId: item.storyId || null,
                taskId: item.sourceType === 'task' ? item.sourceId : null,
                theme: item.theme || null,
                status: 'planned',
                aiGenerated: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            opCount++;
            if (opCount >= MAX_BATCH) {
                await batch.commit();
                opCount = 0;
            }

            // NEW: Write back to Task if it was auto-rescheduled
            if (item.sourceType === 'task' && item.sourceId) {
                const taskRef = db.collection('tasks').doc(item.sourceId);
                taskRef.update({
                    scheduledStart: new Date(item.plannedStart).toISOString(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }).catch(e => console.warn(`Failed to update task schedule ${item.sourceId}`, e));
            }
        }

        // 2. Save Conflicts (as blocks requiring review)
        for (const conflict of conflicts) {
            // Create a "Conflict" block at the requested time (or start of day if no time)
            // Conflicts from engine usually have 'dayKey'.
            // We'll place them at 09:00 for visibility if no specific time.

            const dateStr = conflict.dayKey;
            const start = new Date(`${dateStr}T09:00:00`).getTime();
            const end = new Date(`${dateStr}T10:00:00`).getTime();

            // Unique ID for conflict
            const conflictId = `conflict_${userId}_${conflict.dayKey}_${conflict.sourceId || 'unknown'}`;
            const docRef = db.collection('calendar_blocks').doc(conflictId);

            batch.set(docRef, {
                ownerUid: userId,
                title: `⚠️ Conflict: ${conflict.message || 'Scheduling failed'}`,
                start,
                end,
                status: 'conflict',
                conflictStatus: 'requires_review',
                conflictReason: conflict.reason,
                aiGenerated: true,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            opCount++;
            if (opCount >= MAX_BATCH) {
                await batch.commit();
                opCount = 0;
            }
        }

        if (opCount > 0) {
            await batch.commit();
        }
        console.log('✅ Schedule saved.');
    } catch (e) {
        console.error("Failed to save schedule:", e);
    }
}

/**
 * NEW: Trigger to Auto-Enrich Tasks
 */
exports.onTaskWrite = functions.firestore.document('tasks/{taskId}').onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;

    if (!after) return; // Deleted

    // Check if estimateMin is missing and wasn't just removed (avoid loops)
    const needsEstimate = !after.estimateMin && !after.estimatedHours && !after.points;
    const justCreated = !before;

    // Only trigger on creation or if description changed significantly
    if (needsEstimate && (justCreated || (before && before.description !== after.description))) {
        console.log(`✨ Auto-enriching task: ${after.title}`);
        // We call the existing autoEnrichTasks logic via a direct function call if possible, 
        // or we can implement a lightweight version here.
        // For now, let's call the LLM helper directly.

        try {
            const { callLLM } = require('./utils/llmHelper');
            const systemPrompt = `Estimate the time in minutes for this task. Return ONLY a number.`;
            const userPrompt = `Task: ${after.title}\nDescription: ${after.description || ''}`;

            const result = await callLLM(systemPrompt, userPrompt);
            const minutes = parseInt(result.replace(/[^0-9]/g, ''));

            if (!isNaN(minutes) && minutes > 0) {
                await change.after.ref.update({
                    estimateMin: minutes,
                    aiEnriched: true,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Log to Activity Stream
                await admin.firestore().collection('activity_stream').add({
                    ownerUid: after.ownerUid,
                    type: 'ai_event',
                    category: 'enrichment',
                    message: `AI estimated task "${after.title}" at ${minutes} minutes`,
                    relatedId: change.after.ref.id,
                    relatedType: 'task',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (e) {
            console.error("Failed to auto-enrich task:", e);
        }
    }
});

/**
 * NEW: Scheduled Function to Convert Small Tasks to Stories
 * Runs nightly to group small tasks into a larger story.
 */
exports.convertTasksToStories = onSchedule({
    schedule: '0 3 * * *', // 3 AM
    timeZone: 'Europe/London',
    secrets: [GOOGLE_AI_STUDIO_API_KEY]
}, async (event) => {
    const db = admin.firestore();
    console.log('🏗️ Starting Task-to-Story Conversion for Large Tasks...');

    // 1. Find large, unconnected tasks (> 4 hours = 240 mins)
    const tasksSnap = await db.collection('tasks')
        .where('status', '==', 'todo')
        .where('storyId', '==', null)
        .where('estimateMin', '>', 240)
        .limit(50)
        .get();

    if (tasksSnap.empty) {
        console.log('✅ No large tasks found for conversion.');
        return;
    }

    const batch = db.batch();
    let convertedCount = 0;

    for (const doc of tasksSnap.docs) {
        const task = doc.data();

        // Double check constraints just in case
        if (task.storyId) continue;

        console.log(`🔄 Converting Task "${task.title}" (${task.estimateMin} min) to Unlinked Story...`);

        // Create new Story
        const newStoryRef = db.collection('stories').doc();
        const newStory = {
            ownerUid: task.ownerUid,
            title: task.title,
            description: task.description || '',
            status: 'active', // Ready to work on
            points: 5, // Default to 5 points for large items
            estimateMin: task.estimateMin,
            theme: task.theme || 'Work',
            unlinked: true, // Flag for "Unlinked Story"
            convertedFromTaskId: doc.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        batch.set(newStoryRef, newStory);

        // Update original Task
        batch.update(doc.ref, {
            storyId: newStoryRef.id,
            convertedToStoryId: newStoryRef.id,
            status: 'done', // Mark as done so it doesn't clutter
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            notes: (task.notes || '') + '\n\n[Auto-Converted to Story due to size > 4 hours]'
        });

        // Log to Activity Stream
        batch.set(db.collection('activity_stream').doc(), {
            ownerUid: task.ownerUid,
            type: 'system_event',
            category: 'conversion',
            message: `Converted large task "${task.title}" to Story`,
            relatedId: newStoryRef.id,
            relatedType: 'story',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        convertedCount++;
    }

    if (convertedCount > 0) {
        await batch.commit();
        console.log(`✅ Converted ${convertedCount} large tasks to stories.`);
    }
});

/**
 * NEW: Smart Blocking Logic (Replacement for generateStoryBlocks)
 */
// We need to replace the existing generateStoryBlocks function. 
// Since I am appending here, I will rename this to `generateStoryBlocksSmart` 
// and I will need to update the call site in `runNightlyScheduler` in a separate edit.
// WAIT - I can just overwrite the existing function if I target the right lines.
// But I am currently replacing the END of the file. 
// So I will just close the file here and do the other edits separately.

module.exports = {
    runNightlyScheduler: exports.runNightlyScheduler,
    runMorningPlanner: exports.runMorningPlanner,
    onStoryWrite: exports.onStoryWrite,
    onTaskWrite: exports.onTaskWrite,
    convertTasksToStories: exports.convertTasksToStories
};
