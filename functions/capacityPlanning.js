const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

const parseToMinutes = (value) => {
    if (!value) return null;
    if (typeof value === 'number') return Number(value);
    const [hours = '0', minutes = '0'] = String(value).split(':');
    const h = Number(hours);
    const m = Number(minutes);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const getWeeklyPlannerMinutes = async (db, userId) => {
    try {
        const allocDoc = await db.collection('theme_allocations').doc(userId).get();
        if (!allocDoc.exists) return 0;
        const allocations = allocDoc.data()?.allocations;
        if (!Array.isArray(allocations) || !allocations.length) return 0;
        return allocations.reduce((sum, alloc) => {
            const start = parseToMinutes(alloc.startTime);
            const end = parseToMinutes(alloc.endTime);
            if (start === null || end === null) return sum;
            return sum + Math.max(0, end - start);
        }, 0);
    } catch (err) {
        console.warn('Failed to load planner allocations:', err.message || err);
        return 0;
    }
};

/**
 * Calculate Capacity for a specific Sprint
 * Callable Function: Can be called from frontend or other functions
 */
exports.calculateSprintCapacity = onCall({
    region: 'europe-west2'
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in.');
    }
    const userId = request.auth.uid;
    const sprintId = request.data.sprintId;

    if (!sprintId) {
        throw new HttpsError('invalid-argument', 'Sprint ID is required.');
    }

    const db = admin.firestore();
    return await calculateCapacityInternal(db, userId, sprintId);
});

/**
 * Internal Helper to Calculate Capacity
 */
async function calculateCapacityInternal(db, userId, sprintId) {
    try {
        // 1. Fetch Sprint Data
        const sprintDoc = await db.collection('sprints').doc(sprintId).get();
        if (!sprintDoc.exists) {
            throw new HttpsError('not-found', 'Sprint not found');
        }
        const sprint = sprintDoc.data();

        // Convert sprint dates (they're stored as milliseconds or Firestore Timestamps)
        const convertToDate = (value) => {
            if (!value) return null;
            if (typeof value === 'number') return new Date(value);
            if (value.toDate) return value.toDate(); // Firestore Timestamp
            if (value instanceof Date) return value;
            return new Date(value);
        };

        const startDate = convertToDate(sprint.startDate);
        const endDate = convertToDate(sprint.endDate);

        if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw new HttpsError('invalid-argument', 'Invalid sprint dates');
        }

        // 2. Fetch "Work" / "Main Gig" Blocks for Capacity Deduction
        // We look for blocks in the sprint range that match specific keywords.
        let workBlocks = [];
        try {
            const blocksSnap = await db.collection('calendar_blocks')
                .where('ownerUid', '==', userId)
                .where('start', '>=', startDate.getTime())
                .where('start', '<=', endDate.getTime())
                .get();

            workBlocks = blocksSnap.docs.filter(doc => {
                const title = (doc.data().title || '').toLowerCase();
                return title.includes('work') || title.includes('main gig');
            });
        } catch (err) {
            console.warn('Failed to fetch work blocks, continuing without them:', err.message);
            // Continue without work blocks - will use default 8h M-F
        }

        // Map work blocks by day for easy lookup
        const workBlocksByDay = {};
        workBlocks.forEach(doc => {
            try {
                const blockData = doc.data();
                if (blockData.start && blockData.end) {
                    const d = new Date(blockData.start).toISOString().split('T')[0];
                    if (!workBlocksByDay[d]) workBlocksByDay[d] = 0;
                    const durationHours = (blockData.end - blockData.start) / (1000 * 60 * 60);
                    workBlocksByDay[d] += durationHours;
                }
            } catch (err) {
                console.warn('Skipping invalid work block:', err.message);
            }
        });

        const weeksInSprint = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7)));
        const weeklyPlannerMinutes = await getWeeklyPlannerMinutes(db, userId);
        const plannerCapacityHours = weeklyPlannerMinutes > 0 ? (weeklyPlannerMinutes / 60) * weeksInSprint : null;
        let totalCapacityHours = 0;
        let currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const day = currentDate.getDay(); // 0=Sun, 6=Sat
            const isWeekend = (day === 0 || day === 6);

            let available = 16; // 24 - 8 Sleep

            // Check for explicit work blocks
            if (workBlocksByDay[dateStr]) {
                available -= workBlocksByDay[dateStr];
            } else {
                // Fallback: If M-F and no explicit blocks, assume 8h work
                if (!isWeekend) {
                    available -= 8;
                }
            }

            // Ensure we don't go negative
            if (available < 0) available = 0;

            totalCapacityHours += available;
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // 4. Calculate Allocated Capacity & Progress
        const storiesSnap = await db.collection('stories')
            .where('ownerUid', '==', userId)
            .where('sprintId', '==', sprintId)
            .get();

        let allocatedHours = 0;
        let completedHours = 0; // Based on completed points

        const breakdownByGoal = {}; // { goalId: { allocated: 0, utilized: 0 } }
        const breakdownByTheme = {};

        for (const doc of storiesSnap.docs) {
            const story = doc.data();

            // Calculate Story Effort
            let storyHours = 0;
            if (story.estimateMin) {
                storyHours = story.estimateMin / 60;
            } else {
                storyHours = (story.points || 0) * 2; // Default 2 hours per point
            }

            allocatedHours += storyHours;

            // Calculate Progress (Completed Points)
            // If status is 'done' (4), all points are completed.
            // If we want partial, we'd need a 'completedPoints' field. 
            // For now, assume binary: Done = All Points, Else = 0.
            // User said "progress is measured by completed points".
            let pointsDone = 0;
            if (story.status === 4 || story.status === 'done') {
                pointsDone = story.points || 0;
            }
            // If we had a partial field, we'd use it here.

            const utilizedHours = pointsDone * 2; // Assuming 2h per point logic holds
            completedHours += utilizedHours;

            // Breakdown by Goal
            const goalId = story.goalId || 'Unlinked';
            if (!breakdownByGoal[goalId]) breakdownByGoal[goalId] = { allocated: 0, utilized: 0 };
            breakdownByGoal[goalId].allocated += storyHours;
            breakdownByGoal[goalId].utilized += utilizedHours;

            // Breakdown by Theme
            const theme = story.theme || 'Uncategorized';
            if (!breakdownByTheme[theme]) breakdownByTheme[theme] = 0;
            breakdownByTheme[theme] += storyHours;
        }

        // Map storyId -> goalId/theme for scheduled block rollups
        const storyGoalMap = {};
        const storyThemeMap = {};
        storiesSnap.docs.forEach((d) => {
            const st = d.data() || {};
            storyGoalMap[d.id] = st.goalId || null;
            storyThemeMap[d.id] = st.theme || null;
        });

        // Scheduled hours from calendar blocks in sprint window
        const blocksSnap = await db.collection('calendar_blocks')
            .where('ownerUid', '==', userId)
            .where('start', '>=', startDate.getTime())
            .where('start', '<=', endDate.getTime())
            .get()
            .catch(() => ({ docs: [] }));

        let scheduledHours = 0;
        const scheduledByGoal = {};
        const scheduledByTheme = {};

        blocksSnap.docs.forEach((doc) => {
            const b = doc.data() || {};
            if (!b.start || !b.end) return;
            const isChoreLike = ['chore', 'routine', 'habit'].includes(String(b.entityType || '').toLowerCase());
            if (b.source === 'gcal' || isChoreLike) return; // external busy/routines are not sprint capacity
            const isWorkItem = b.storyId || b.taskId;
            if (!isWorkItem) return;
            const hours = (b.end - b.start) / (1000 * 60 * 60);
            scheduledHours += hours;
            const goalId = b.goalId || (b.storyId ? storyGoalMap[b.storyId] : null) || 'Unlinked';
            const theme = b.theme || (b.storyId ? storyThemeMap[b.storyId] : 'Uncategorized') || 'Uncategorized';
            scheduledByGoal[goalId] = (scheduledByGoal[goalId] || 0) + hours;
            scheduledByTheme[theme] = (scheduledByTheme[theme] || 0) + hours;
        });

        const plannedCapacityHours = plannerCapacityHours ?? totalCapacityHours;
        const plannedFreeHours = Math.max(0, plannedCapacityHours - scheduledHours);
        const plannedUtilization = plannedCapacityHours > 0 ? scheduledHours / plannedCapacityHours : 0;
        const weeklyPlannerHours = weeklyPlannerMinutes / 60;

        return {
            sprintId,
            totalCapacityHours,
            allocatedHours,
            utilizedHours: completedHours,
            remainingHours: allocatedHours - completedHours,
            freeCapacityHours: totalCapacityHours - allocatedHours,
            utilization: totalCapacityHours > 0 ? (allocatedHours / totalCapacityHours) : 0,
            progressPercent: allocatedHours > 0 ? (completedHours / allocatedHours) : 0,
            breakdownByGoal,
            breakdownByTheme,
            scheduledHours,
            scheduledByGoal,
            scheduledByTheme,
            weeklyPlannerMinutes,
            weeklyPlannerHours,
            plannerCapacityHours,
            plannedCapacityHours,
            plannedFreeHours,
            plannedUtilization,
            sprintWeeks
        };
    } catch (error) {
        console.error('Error in calculateCapacityInternal:', error);
        // Re-throw HttpsError as-is, wrap others
        if (error.code && error.code.startsWith('functions/')) {
            throw error;
        }
        throw new HttpsError('internal', `Capacity calculation failed: ${error.message}`);
    }
}

/**
 * Scheduled Job: Update Story Priorities
 * Runs nightly to re-evaluate priority based on urgency.
 */
exports.updateStoryPriorities = onSchedule({
    schedule: '0 4 * * *', // 4 AM
    timeZone: 'Europe/London',
}, async (event) => {
    const db = admin.firestore();
    console.log('⚖️ Starting Algorithmic Priority Update (1-5 Scale)...');

    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        await updatePrioritiesForUser(db, userId);
    }
    console.log('✅ Priority Update Complete.');
});

async function updatePrioritiesForUser(db, userId) {
    const today = new Date();

    // 1. Get Active Stories
    const storiesSnap = await db.collection('stories')
        .where('ownerUid', '==', userId)
        .where('status', 'in', ['active', 'in-progress'])
        .get();

    // 2. Get Active Sprints
    const sprintsSnap = await db.collection('sprints')
        .where('ownerUid', '==', userId)
        .where('status', '==', 'active')
        .get();

    const sprintEndDates = {};
    sprintsSnap.docs.forEach(d => {
        sprintEndDates[d.id] = new Date(d.data().endDate);
    });

    // 3. Get Goals
    const goalsSnap = await db.collection('goals')
        .where('ownerUid', '==', userId)
        .where('status', '==', 'active')
        .get();

    const goalDueDates = {};
    goalsSnap.docs.forEach(d => {
        goalDueDates[d.id] = new Date(d.data().targetDate || d.data().dueDate);
    });

    const batch = db.batch();
    let updateCount = 0;

    for (const doc of storiesSnap.docs) {
        const story = doc.data();

        // Determine Effective Due Date
        let dueDate = null;
        if (story.goalId && goalDueDates[story.goalId]) {
            dueDate = goalDueDates[story.goalId];
        }
        if (!dueDate && story.sprintId && sprintEndDates[story.sprintId]) {
            dueDate = sprintEndDates[story.sprintId];
        }

        if (!dueDate) continue;

        // Calculate Days Remaining
        const diffTime = dueDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysRemaining <= 0) {
            // Overdue! P1 immediately.
            if (story.priority !== 1) {
                batch.update(doc.ref, { priority: 1, priorityReason: 'Overdue' });
                updateCount++;
            }
            continue;
        }

        // Calculate Remaining Effort (Hours)
        // If status is active/in-progress, we assume full effort remains unless we track partials.
        // User said "are we tracking remaining effort".
        // For now, use Total Points * 2.
        const effortHours = (story.points || 1) * 2;

        // Urgency Ratio
        const urgencyRatio = effortHours / daysRemaining;

        // Scale 1-5 (1=Critical, 5=Low)
        let newPriority = 3; // Default Normal
        let reason = 'Normal urgency';

        if (urgencyRatio > 0.8) {
            newPriority = 1;
            reason = `Critical Urgency (Ratio: ${urgencyRatio.toFixed(1)})`;
        } else if (urgencyRatio > 0.6) {
            newPriority = 2;
            reason = `High Urgency (Ratio: ${urgencyRatio.toFixed(1)})`;
        } else if (urgencyRatio > 0.4) {
            newPriority = 3;
            reason = `Medium Urgency (Ratio: ${urgencyRatio.toFixed(1)})`;
        } else if (urgencyRatio > 0.2) {
            newPriority = 4;
            reason = `Low Urgency (Ratio: ${urgencyRatio.toFixed(1)})`;
        } else {
            newPriority = 5;
            reason = `Very Low Urgency (Ratio: ${urgencyRatio.toFixed(1)})`;
        }

        // Special Case: Not Started & Due Soon (< 3 days) -> Bump to P1
        if (story.status === 'active' && daysRemaining < 3) {
            newPriority = 1;
            reason = 'Not Started & Due Soon';
        }

        if (story.priority !== newPriority) {
            batch.update(doc.ref, {
                priority: newPriority,
                priorityReason: reason,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            updateCount++;
        }
    }

    if (updateCount > 0) {
        await batch.commit();
        console.log(`Updated priorities for ${updateCount} stories for user ${userId}`);
    }
}
