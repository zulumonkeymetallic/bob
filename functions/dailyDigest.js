const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

// Email transporter configuration (using Gmail as example)
const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
        user: functions.config().email.user,
        pass: functions.config().email.password
    }
});

// Daily digest generation and email function
exports.generateDailyDigest = functions.pubsub.schedule('30 6 * * *')
    .timeZone('America/New_York') // Adjust timezone as needed
    .onRun(async (context) => {
        console.log('Generating daily digest...');
        
        try {
            // Get all users who have opted in for daily digest
            const usersSnapshot = await db.collection('users').where('emailDigest', '==', true).get();
            
            for (const userDoc of usersSnapshot.docs) {
                const userId = userDoc.id;
                const userData = userDoc.data();
                
                await generateUserDigest(userId, userData);
            }
            
            console.log('Daily digest generation completed');
        } catch (error) {
            console.error('Error generating daily digest:', error);
        }
    });

async function generateUserDigest(userId, userData) {
    try {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

        // Get tasks due today
        const tasksSnapshot = await db.collection('tasks')
            .where('ownerUid', '==', userId)
            .where('dueDate', '>=', startOfDay.getTime())
            .where('dueDate', '<', endOfDay.getTime())
            .orderBy('priority')
            .limit(10)
            .get();

        const tasksDue = tasksSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Get focus stories (top priority active stories)
        const storiesSnapshot = await db.collection('stories')
            .where('ownerUid', '==', userId)
            .where('status', 'in', ['active', 'backlog'])
            .orderBy('priority')
            .orderBy('points', 'desc')
            .limit(5)
            .get();

        const storiesFocus = storiesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Get today's calendar blocks
        const blocksSnapshot = await db.collection('calendar_blocks')
            .where('ownerUid', '==', userId)
            .where('start', '>=', startOfDay.getTime())
            .where('start', '<', endOfDay.getTime())
            .orderBy('start')
            .get();

        const calendarBlocks = blocksSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Calculate velocity snapshot (simple version)
        const sprintsSnapshot = await db.collection('sprints')
            .where('ownerUid', '==', userId)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        let velocitySnapshot = {};
        if (!sprintsSnapshot.empty) {
            const activeSprint = sprintsSnapshot.docs[0].data();
            const sprintStories = await db.collection('stories')
                .where('ownerUid', '==', userId)
                .where('sprintId', '==', sprintsSnapshot.docs[0].id)
                .get();

            const totalPoints = sprintStories.docs.reduce((sum, doc) => sum + (doc.data().points || 0), 0);
            const completedPoints = sprintStories.docs
                .filter(doc => doc.data().status === 'done')
                .reduce((sum, doc) => sum + (doc.data().points || 0), 0);

            velocitySnapshot = {
                sprintName: activeSprint.name,
                totalPoints,
                completedPoints,
                progress: totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0
            };
        }

        // Generate HTML email content
        const html = generateDigestHTML({
            userData,
            tasksDue,
            storiesFocus,
            calendarBlocks,
            velocitySnapshot,
            date: today
        });

        // Save digest to database
        await db.collection('digests').add({
            ownerUid: userId,
            date: admin.firestore.Timestamp.fromDate(today),
            tasksDue,
            storiesFocus,
            calendarBlocks,
            velocitySnapshot,
            html,
            createdAt: admin.firestore.Timestamp.now()
        });

        // Send email
        if (userData.email) {
            await transporter.sendMail({
                from: functions.config().email.user,
                to: userData.email,
                subject: `BOB Daily Digest - ${today.toLocaleDateString()}`,
                html: html
            });
            
            console.log(`Daily digest sent to ${userData.email}`);
        }

    } catch (error) {
        console.error(`Error generating digest for user ${userId}:`, error);
    }
}

function generateDigestHTML({ userData, tasksDue, storiesFocus, calendarBlocks, velocitySnapshot, date }) {
    const themeColors = {
        'Health': '#22c55e',
        'Growth': '#3b82f6', 
        'Wealth': '#eab308',
        'Tribe': '#8b5cf6',
        'Home': '#f97316'
    };

    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    };

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>BOB Daily Digest</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; }
            .section { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .task-row { padding: 10px; border-left: 4px solid #e5e7eb; margin: 8px 0; background: #f9fafb; }
            .task-high { border-left-color: #ef4444; }
            .task-med { border-left-color: #f59e0b; }
            .task-low { border-left-color: #10b981; }
            .story-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin: 8px 0; }
            .calendar-block { background: #f3f4f6; padding: 10px; margin: 5px 0; border-radius: 4px; }
            .progress-bar { width: 100%; height: 20px; background: #e5e7eb; border-radius: 10px; overflow: hidden; }
            .progress-fill { height: 100%; background: linear-gradient(90deg, #10b981, #059669); }
            .btn { display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 5px; }
            .small-text { font-size: 12px; color: #6b7280; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎯 BOB Daily Digest</h1>
                <p>${date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                <p>Hello ${userData.name || 'there'}! Here's your day ahead.</p>
            </div>

            ${tasksDue.length > 0 ? `
            <div class="section">
                <h2>📋 Tasks Due Today (${tasksDue.length})</h2>
                ${tasksDue.map(task => `
                    <div class="task-row task-${task.priority}">
                        <strong>${task.title}</strong>
                        <div class="small-text">
                            ${task.ref || task.id.slice(-4)} • 
                            Priority: ${task.priority.toUpperCase()} • 
                            Effort: ${task.effort}
                            ${task.dueDate ? ` • Due: ${formatTime(task.dueDate)}` : ''}
                        </div>
                        <a href="${functions.config().app.url}/task/${task.id}" class="btn">View Task</a>
                    </div>
                `).join('')}
            </div>
            ` : ''}

            ${storiesFocus.length > 0 ? `
            <div class="section">
                <h2>🎯 Focus Stories (${storiesFocus.length})</h2>
                ${storiesFocus.map(story => `
                    <div class="story-card">
                        <h3>${story.title}</h3>
                        <div class="small-text">
                            ${story.ref || story.id.slice(-4)} • 
                            ${story.priority} • 
                            ${story.points} points • 
                            Status: ${story.status}
                        </div>
                        ${story.description ? `<p>${story.description.substring(0, 100)}${story.description.length > 100 ? '...' : ''}</p>` : ''}
                        <a href="${functions.config().app.url}/story/${story.id}" class="btn">View Story</a>
                    </div>
                `).join('')}
            </div>
            ` : ''}

            ${calendarBlocks.length > 0 ? `
            <div class="section">
                <h2>📅 Today's Schedule (${calendarBlocks.length} blocks)</h2>
                ${calendarBlocks.map(block => `
                    <div class="calendar-block">
                        <strong>${block.theme} - ${block.category}</strong>
                        ${block.subTheme ? ` (${block.subTheme})` : ''}
                        <div class="small-text">
                            ${formatTime(block.start)} - ${formatTime(block.end)} • 
                            ${block.flexibility} • 
                            ${block.rationale || 'No notes'}
                        </div>
                    </div>
                `).join('')}
            </div>
            ` : ''}

            ${velocitySnapshot.sprintName ? `
            <div class="section">
                <h2>⚡ Sprint Pulse</h2>
                <h3>${velocitySnapshot.sprintName}</h3>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${velocitySnapshot.progress}%"></div>
                </div>
                <p>${velocitySnapshot.completedPoints}/${velocitySnapshot.totalPoints} points completed (${velocitySnapshot.progress}%)</p>
            </div>
            ` : ''}

            <div class="section">
                <h2>🤖 AI Summary</h2>
                <p><strong>Focus Recommendation:</strong> 
                ${tasksDue.length > 0 ? 
                    `Start with your ${tasksDue[0].priority} priority task: "${tasksDue[0].title}". ` : 
                    'Great! No urgent tasks due today. '
                }
                ${storiesFocus.length > 0 ? 
                    `Consider making progress on "${storiesFocus[0].title}" when you have focused time.` : 
                    'Use today to plan ahead or tackle backlog items.'
                }
                </p>
                
                ${calendarBlocks.length > 0 ? `
                <p><strong>Schedule Notes:</strong> 
                You have ${calendarBlocks.length} time blocks scheduled. 
                ${calendarBlocks.filter(b => b.flexibility === 'hard').length > 0 ? 
                    'Some are fixed appointments, so plan accordingly.' : 
                    'All blocks are flexible, giving you room to adjust as needed.'
                }
                </p>
                ` : ''}
            </div>

            <div class="section">
                <p class="small-text">
                    Generated at ${new Date().toLocaleString()} • 
                    <a href="${functions.config().app.url}">Open BOB</a> • 
                    <a href="${functions.config().app.url}/settings">Manage Digest Settings</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
}

// Manual trigger function for testing
exports.triggerDigestForUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = context.auth.uid;
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found');
    }

    await generateUserDigest(userId, userDoc.data());
    
    return { success: true, message: 'Digest generated and sent' };
});
