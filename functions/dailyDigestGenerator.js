const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { sendEmail } = require('./lib/email');
const aiUsageLogger = require('./utils/aiUsageLogger');

/**
 * Daily LLM Email Digest Generator for BOB v3.5.7
 * Sends comprehensive daily summary at 06:30 with AI-powered insights
 */
exports.generateDailyDigest = onSchedule({
  schedule: '30 6 * * *', // Daily at 06:30
  timeZone: 'Europe/London',
  memory: '512MiB',
  timeoutSeconds: 300,
  secrets: [defineSecret('BREVO_API_KEY'), defineSecret('GOOGLEAISTUDIOAPIKEY')]
}, async (event) => {
  console.log('🌅 Starting daily digest generation at 06:30');

  const aiWrapper = aiUsageLogger.wrapAICall('google-ai-studio', 'gemini-1.5-flash');

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
const { fetchWeather, fetchNews } = require('./services/newsWeather');

/**
 * Gather comprehensive user data for digest
 */
/**
 * Gather comprehensive user data for digest
 */
async function gatherUserData(db, userId, today) {
  const todayStr = today.toISOString().split('T')[0];
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  // Parallel fetch for external data
  const [weather, news] = await Promise.all([
    fetchWeather(), // Defaults to London for now
    fetchNews(5)
  ]);

  // Get tasks due today
  const tasksDueTodaySnapshot = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '>=', new Date(todayStr))
    .where('dueDate', '<', new Date(today.getTime() + 24 * 60 * 60 * 1000))
    .where('status', '!=', 'done')
    .orderBy('status')
    .orderBy('priority', 'desc')
    .limit(20)
    .get();

  // Get overdue tasks
  const overdueTasks = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '<', new Date(todayStr))
    .where('status', '!=', 'done')
    .orderBy('dueDate')
    .limit(10)
    .get();

  // Get active stories (started or planned)
  const activeStoriesSnapshot = await db.collection('stories')
    .where('ownerUid', '==', userId)
    .where('status', 'in', ['active', 'in-progress', 'planned'])
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get();

  const stories = activeStoriesSnapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      ...d,
      isStarted: ['active', 'in-progress'].includes(d.status)
    };
  });

  // Get 7-day calendar blocks (Rolling Window)
  // Note: We fetch 'calendar_blocks' which are the instances.
  const calendarBlocksSnapshot = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('start', '>=', today.getTime())
    .where('start', '<=', nextWeek.getTime())
    .orderBy('start')
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
    .limit(5)
    .get();

  return {
    tasksDueToday: tasksDueTodaySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    overdueTasks: overdueTasks.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    stories,
    calendarBlocks: calendarBlocksSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      startDate: new Date(doc.data().start).toISOString().split('T')[0],
      startTime: new Date(doc.data().start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      endTime: new Date(doc.data().end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    })),
    currentSprint: currentSprintSnapshot.docs[0] ? { id: currentSprintSnapshot.docs[0].id, ...currentSprintSnapshot.docs[0].data() } : null,
    goals: goalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    weather,
    news,
    date: todayStr,
    dayOfWeek: today.toLocaleDateString('en-US', { weekday: 'long' })
  };
}

/**
 * Generate AI insights using Google AI Studio (Gemini)
 */
async function generateAIInsights(userData) {
  const prompt = `You are an executive productivity assistant for "blueprint.organize.build". 
  Your goal is to craft a personalized, data-driven daily briefing. 
  
  **CONTEXT DATA:**
  
  **Date:** ${userData.dayOfWeek}, ${userData.date}
  **Weather:** ${userData.weather ? userData.weather.description : 'Not available'}
  **Top News:**
  ${userData.news.map(n => `- ${n.title}`).join('\n')}
  
  **Sprint Context:**
  ${userData.currentSprint ? `Current Sprint: "${userData.currentSprint.title}" (Goal: ${userData.currentSprint.goal || 'None'})` : 'No active sprint.'}
  
  **Active Stories (Highest Priority if Started):**
  ${userData.stories.map(s => `- [${s.isStarted ? 'STARTED' : 'PLANNED'}] ${s.title} (Status: ${s.status})`).join('\n')}
  
  **Calendar (Next 7 Days):**
  ${userData.calendarBlocks.slice(0, 20).map(b => `- [${b.startDate}] ${b.startTime}-${b.endTime}: ${b.title} ${b.conflictStatus === 'requires_review' ? '(CONFLICT)' : ''}`).join('\n')}
  
  **Tasks (Due Today: ${userData.tasksDueToday.length}, Overdue: ${userData.overdueTasks.length}):**
  Overdue: ${userData.overdueTasks.map(t => t.title).join(', ')}
  Due Today: ${userData.tasksDueToday.map(t => t.title).join(', ')}
  
  **INSTRUCTIONS:**
  1. **Determine the Single Highest Priority**: Look at "Active Stories" (especially if STARTED) and "Overdue Tasks". Pick ONE thing they MUST do. Explain WHY based on the data (e.g. "Because Story X is already started...").
  2. **Placement Reasoning**: Briefly explain why the schedule is set this way. If there are CONFLICTS, propose a resolution.
  3. **Craft a Narrative Message**: Do NOT use generic headings like "Time Management". Write a cohesive briefing paragraph.
  4. **Integrate News/Weather**: Weave the weather or a major news headline into the intro or outro naturally.
  5. **Tone**: Professional, concise, encouraging, but direct. No fluff.
  6. **Structure**:
     - **The Briefing**: A paragraph weaving weather/news and the main focus.
     - **The Plan**: Bullet points of the specific actions for the priority items.
     - **Heads Up**: Mention any risks (overdue items, tight calendar, conflicts).
  
  Do NOT give generic tips like "Drink water" or "Take breaks". Stick to the user's actual data.`;

  const apiKey = process.env.GOOGLEAISTUDIOAPIKEY;
  if (!apiKey) {
    return { choices: [{ message: { content: 'Gemini key not configured.' } }] };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      { role: 'user', parts: [{ text: 'You are an expert executive assistant. Be precise and data-driven.' }] },
      { role: 'user', parts: [{ text: prompt }] }
    ],
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini HTTP ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  const textOut = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { choices: [{ message: { content: textOut } }] };
}

/**
 * Create HTML digest content
 */
async function createDigestHTML(userData, aiInsights) {
  const aiAdvice = aiInsights.choices[0]?.message?.content || 'Focus on your priorities.';
  // Convert markdown-style bolding to HTML
  const formattedAdvice = aiAdvice
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daily Briefing - ${userData.date}</title>
    <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f3f4f6; }
        .container { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .header { background: #1e3a8a; color: white; padding: 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
        .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
        .content { padding: 24px; }
        .briefing-card { background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin-bottom: 24px; border-radius: 4px; }
        .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 700; margin: 24px 0 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
        .item { padding: 12px; border-bottom: 1px solid #f3f4f6; display: flex; justify-content: space-between; align-items: center; }
        .item:last-child { border-bottom: none; }
        .item-title { font-weight: 500; color: #111827; }
        .item-meta { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .tag { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
        .tag-started { background: #dbeafe; color: #1e40af; }
        .tag-overdue { background: #fee2e2; color: #991b1b; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
        .btn { display: inline-block; padding: 8px 16px; background: #1e3a8a; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>blueprint.organize.build</h1>
            <p>${userData.dayOfWeek}, ${userData.date}</p>
            ${userData.weather ? `<p style="font-size:12px;margin-top:4px">📍 London • ${userData.weather.temp}</p>` : ''}
        </div>
        
        <div class="content">
            <div class="briefing-card">
                ${formattedAdvice}
            </div>

            ${userData.stories.length > 0 ? `
            <div class="section-title">Active Stories</div>
            ${userData.stories.map(s => `
            <div class="item">
                <div>
                    <div class="item-title">${s.title}</div>
                    <div class="item-meta">${s.status} • ${s.points || 0} pts</div>
                </div>
                ${s.isStarted ? '<span class="tag tag-started">Started</span>' : ''}
            </div>
            `).join('')}
            ` : ''}

            ${userData.calendarBlocks.length > 0 ? `
            <div class="section-title">7-Day Schedule</div>
            ${(() => {
        const grouped = {};
        userData.calendarBlocks.forEach(b => {
          if (!grouped[b.startDate]) grouped[b.startDate] = [];
          grouped[b.startDate].push(b);
        });
        return Object.keys(grouped).slice(0, 7).map(date => `
                <div style="font-size:11px; font-weight:bold; color:#6b7280; margin-top:12px; padding-left:12px;">${new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                ${grouped[date].map(b => `
                <div class="item">
                    <div>
                        <div class="item-title">${b.title} ${b.conflictStatus === 'requires_review' ? '<span style="color:red">⚠</span>' : ''}</div>
                    </div>
                    <div class="tag" style="background:#f3f4f6">${b.startTime}</div>
                </div>
                `).join('')}
              `).join('');
      })()}
            ` : ''}

            <div style="text-align:center">
                <a href="https://bob20250810.web.app/dashboard" class="btn">Open Dashboard</a>
            </div>
        </div>
        
        <div class="footer">
            Generated by BOB AI • ${new Date().toLocaleTimeString()}
        </div>
    </div>
</body>
</html>
  `;
}

/**
 * Send digest email (placeholder - integrate with your email service)
 */
async function sendDigestEmail(email, htmlContent, userData) {
  if (!email) return;
  await sendEmail({
    to: email,
    subject: `Daily Briefing: ${userData.dayOfWeek}, ${userData.date}`,
    html: htmlContent,
  });
}
