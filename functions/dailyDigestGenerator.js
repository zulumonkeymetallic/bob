const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const aiUsageLogger = require('./utils/aiUsageLogger');

/**
 * Daily LLM Email Digest Generator for BOB v3.5.7
 * Sends comprehensive daily summary at 06:30 with AI-powered insights
 */
exports.generateDailyDigest = onSchedule({
  schedule: '30 6 * * *', // Daily at 06:30
  timeZone: 'Europe/London',
  memory: '512MiB',
  timeoutSeconds: 300
}, async (event) => {
  console.log('🌅 Starting daily digest generation at 06:30');
  
  const aiWrapper = aiUsageLogger.wrapAICall('openai', 'gpt-4o-mini');
  
  try {
    const db = admin.firestore();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Get all users who need digests
    const usersSnapshot = await db.collection('profiles').get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userProfile = userDoc.data();
      const userId = userDoc.id;
      
      // Skip if user has disabled daily digests
      if (userProfile.dailyDigestEnabled === false) {
        continue;
      }
      
      console.log(`📧 Generating digest for user: ${userProfile.email || userId}`);
      
      try {
        // Gather user data
        const userData = await gatherUserData(db, userId, today);
        
        // Generate AI insights
        const aiInsights = await aiWrapper(async () => {
          return await generateAIInsights(userData);
        }, {
          functionName: 'generateDailyDigest',
          userId: userId,
          purpose: 'daily_digest_generation',
          metadata: {
            todayStr,
            tasksCount: userData.tasksDueToday.length,
            storiesCount: userData.focusStories.length
          }
        });
        
        // Create digest content
        const digestContent = await createDigestHTML(userData, aiInsights);
        
        // Save digest to database
        const digestDoc = {
          userId,
          date: todayStr,
          content: digestContent,
          aiInsights: aiInsights.choices[0]?.message?.content || '',
          metrics: {
            tasksDueToday: userData.tasksDueToday.length,
            focusStories: userData.focusStories.length,
            calendarBlocks: userData.calendarBlocks.length,
            overdueTasks: userData.overdueTasks.length
          },
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          emailSent: false
        };
        
        await db.collection('daily_digests').add(digestDoc);
        
        // Send email (if email service is configured)
        if (userProfile.email && userProfile.emailDigestEnabled !== false) {
          await sendDigestEmail(userProfile.email, digestContent, userData);
          
          // Update digest as sent
          await db.collection('daily_digests')
            .where('userId', '==', userId)
            .where('date', '==', todayStr)
            .get()
            .then(snapshot => {
              snapshot.docs.forEach(doc => {
                doc.ref.update({ emailSent: true, emailSentAt: admin.firestore.FieldValue.serverTimestamp() });
              });
            });
        }
        
        console.log(`✅ Digest generated successfully for user ${userId}`);
        
      } catch (userError) {
        console.error(`❌ Error generating digest for user ${userId}:`, userError);
      }
    }
    
    console.log('🎉 Daily digest generation completed');
    
  } catch (error) {
    console.error('❌ Daily digest generation failed:', error);
    throw error;
  }
});

/**
 * Gather comprehensive user data for digest
 */
async function gatherUserData(db, userId, today) {
  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Get tasks due today
  const tasksDueTodaySnapshot = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '>=', new Date(todayStr))
    .where('dueDate', '<', new Date(today.getTime() + 24 * 60 * 60 * 1000))
    .where('status', '!=', 'done')
    .orderBy('status')
    .orderBy('priority', 'desc')
    .limit(10)
    .get();
  
  // Get overdue tasks
  const overdueTasks = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '<', new Date(todayStr))
    .where('status', '!=', 'done')
    .orderBy('dueDate')
    .limit(5)
    .get();
  
  // Get focus stories (high priority active stories)
  const focusStoriesSnapshot = await db.collection('stories')
    .where('ownerUid', '==', userId)
    .where('status', '==', 'active')
    .orderBy('points', 'desc')
    .limit(5)
    .get();
  
  // Get today's calendar blocks
  const calendarBlocksSnapshot = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('date', '==', todayStr)
    .orderBy('startTime')
    .get();
  
  // Get current sprint information
  const currentSprintSnapshot = await db.collection('sprints')
    .where('ownerUid', '==', userId)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  
  // Get goals for context
  const goalsSnapshot = await db.collection('goals')
    .where('ownerUid', '==', userId)
    .where('status', '==', 'active')
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get();
  
  // Get habits for today
  const habitsSnapshot = await db.collection('habits')
    .where('ownerUid', '==', userId)
    .where('isActive', '==', true)
    .get();
  
  return {
    tasksDueToday: tasksDueTodaySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    overdueTasks: overdueTasks.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    focusStories: focusStoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    calendarBlocks: calendarBlocksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    currentSprint: currentSprintSnapshot.docs[0] ? { id: currentSprintSnapshot.docs[0].id, ...currentSprintSnapshot.docs[0].data() } : null,
    goals: goalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    habits: habitsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    date: todayStr,
    dayOfWeek: today.toLocaleDateString('en-US', { weekday: 'long' })
  };
}

/**
 * Generate AI insights using OpenAI
 */
async function generateAIInsights(userData) {
  const OpenAI = require('openai');
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  
  const prompt = `As an AI productivity coach, analyze this user's day and provide insights:

**Tasks Due Today (${userData.tasksDueToday.length}):**
${userData.tasksDueToday.map(task => `- ${task.title} (Priority: ${task.priority || 'normal'}, Theme: ${task.theme || 'none'})`).join('\n')}

**Overdue Tasks (${userData.overdueTasks.length}):**
${userData.overdueTasks.map(task => `- ${task.title} (Due: ${task.dueDate})`).join('\n')}

**Focus Stories (${userData.focusStories.length}):**
${userData.focusStories.map(story => `- ${story.title} (${story.points || 0} points)`).join('\n')}

**Calendar Blocks (${userData.calendarBlocks.length}):**
${userData.calendarBlocks.map(block => `- ${block.title} (${block.startTime}-${block.endTime})`).join('\n')}

**Current Sprint:** ${userData.currentSprint ? userData.currentSprint.title : 'No active sprint'}

**Active Goals:** ${userData.goals.map(goal => goal.title).join(', ')}

Please provide:
1. **Priority Focus**: What should they tackle first today and why?
2. **Time Management**: How to optimize their calendar blocks?
3. **Risk Assessment**: What might derail their day?
4. **Motivation**: One encouraging insight about their progress
5. **Quick Wins**: 1-2 small tasks they can complete quickly

Keep it concise, actionable, and encouraging. Write in second person ("you should...").`;

  return await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert productivity coach who provides concise, actionable daily guidance. Focus on priorities, time management, and motivation.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_tokens: 500,
    temperature: 0.7
  });
}

/**
 * Create HTML digest content
 */
async function createDigestHTML(userData, aiInsights) {
  const aiAdvice = aiInsights.choices[0]?.message?.content || 'Focus on your priorities and make today count!';
  
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BOB Daily Digest - ${userData.date}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .section { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 6px; border-left: 4px solid #667eea; }
        .task-item { background: white; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 3px solid #28a745; }
        .overdue { border-left-color: #dc3545; }
        .story-item { background: white; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 3px solid #ffc107; }
        .calendar-block { background: white; padding: 10px; margin: 5px 0; border-radius: 4px; border-left: 3px solid #17a2b8; }
        .ai-insights { background: #e3f2fd; padding: 15px; border-radius: 6px; border-left: 4px solid #2196f3; }
        .metric { display: inline-block; background: white; padding: 8px 12px; margin: 4px; border-radius: 4px; font-weight: bold; }
        .btn { display: inline-block; padding: 8px 16px; background: #667eea; color: white; text-decoration: none; border-radius: 4px; margin: 5px; }
        @media (max-width: 600px) { body { padding: 10px; } .header { padding: 15px; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>🌅 BOB Daily Digest</h1>
        <p><strong>${userData.dayOfWeek}, ${userData.date}</strong></p>
        <div>
            <span class="metric">${userData.tasksDueToday.length} Due Today</span>
            <span class="metric">${userData.overdueTasks.length} Overdue</span>
            <span class="metric">${userData.focusStories.length} Focus Stories</span>
            <span class="metric">${userData.calendarBlocks.length} Calendar Blocks</span>
        </div>
    </div>

    <div class="ai-insights">
        <h3>🤖 AI Productivity Insights</h3>
        <p>${aiAdvice.replace(/\n/g, '<br>')}</p>
    </div>

    ${userData.overdueTasks.length > 0 ? `
    <div class="section">
        <h3>🚨 Overdue Tasks (${userData.overdueTasks.length})</h3>
        ${userData.overdueTasks.map(task => `
        <div class="task-item overdue">
            <strong>${task.title}</strong><br>
            <small>Due: ${task.dueDate} | Priority: ${task.priority || 'normal'} | Theme: ${task.theme || 'none'}</small>
            <br><a href="https://bob20250810.web.app/tasks-management?task=${task.id}" class="btn">View Task</a>
        </div>
        `).join('')}
    </div>
    ` : ''}

    ${userData.tasksDueToday.length > 0 ? `
    <div class="section">
        <h3>📋 Tasks Due Today (${userData.tasksDueToday.length})</h3>
        ${userData.tasksDueToday.map(task => `
        <div class="task-item">
            <strong>${task.title}</strong><br>
            <small>Priority: ${task.priority || 'normal'} | Theme: ${task.theme || 'none'} | Effort: ${task.estimatedEffort || 'not set'}</small>
            <br><a href="https://bob20250810.web.app/tasks-management?task=${task.id}" class="btn">View Task</a>
        </div>
        `).join('')}
    </div>
    ` : ''}

    ${userData.focusStories.length > 0 ? `
    <div class="section">
        <h3>⭐ Focus Stories (${userData.focusStories.length})</h3>
        ${userData.focusStories.map(story => `
        <div class="story-item">
            <strong>${story.title}</strong><br>
            <small>Points: ${story.points || 0} | Theme: ${story.theme || 'none'}</small>
            <br><a href="https://bob20250810.web.app/stories?story=${story.id}" class="btn">View Story</a>
        </div>
        `).join('')}
    </div>
    ` : ''}

    ${userData.calendarBlocks.length > 0 ? `
    <div class="section">
        <h3>📅 Today's Calendar (${userData.calendarBlocks.length} blocks)</h3>
        ${userData.calendarBlocks.map(block => `
        <div class="calendar-block">
            <strong>${block.title}</strong><br>
            <small>${block.startTime} - ${block.endTime} | Theme: ${block.theme || 'none'}</small>
        </div>
        `).join('')}
    </div>
    ` : ''}

    ${userData.currentSprint ? `
    <div class="section">
        <h3>🏃‍♂️ Current Sprint</h3>
        <div style="background: white; padding: 10px; border-radius: 4px;">
            <strong>${userData.currentSprint.title}</strong><br>
            <small>Sprint Goal: ${userData.currentSprint.goal || 'Not set'}</small>
            <br><a href="https://bob20250810.web.app/current-sprint" class="btn">View Sprint</a>
        </div>
    </div>
    ` : ''}

    <div class="section">
        <h3>🎯 Quick Actions</h3>
        <a href="https://bob20250810.web.app/dashboard" class="btn">📊 Dashboard</a>
        <a href="https://bob20250810.web.app/tasks-management" class="btn">✅ Tasks</a>
        <a href="https://bob20250810.web.app/calendar" class="btn">📅 Calendar</a>
        <a href="https://bob20250810.web.app/current-sprint" class="btn">🏃‍♂️ Sprint</a>
    </div>

    <div style="text-align: center; margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 6px;">
        <p><small>Generated by BOB AI at ${new Date().toLocaleString()}</small></p>
        <p><small>Make today count! 🚀</small></p>
    </div>
</body>
</html>
  `;
}

/**
 * Send digest email (placeholder - integrate with your email service)
 */
async function sendDigestEmail(email, htmlContent, userData) {
  console.log(`📧 Would send digest email to: ${email}`);
  console.log(`📊 Email metrics: ${userData.tasksDueToday.length} tasks, ${userData.focusStories.length} stories`);
  
  // TODO: Integrate with email service (SendGrid, Mailgun, etc.)
  // For now, just log that email would be sent
  // In production, implement actual email sending here
  
  return Promise.resolve();
}
