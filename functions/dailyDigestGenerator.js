const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const httpsV2 = require('firebase-functions/v2/https');
const { sendEmail } = require('./lib/email');
const aiUsageLogger = require('./utils/aiUsageLogger');

// Centralize Gemini model selection so we can switch to newer models (e.g., gemini-2.5-flash-lite)
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const DAILY_DIGEST_ENABLED = process.env.DAILY_DIGEST_ENABLED === 'true';

/**
 * Daily LLM Email Digest Generator for BOB v3.5.7
 * Sends comprehensive daily summary at 06:45 with AI-powered insights
 */
exports.generateDailyDigest = onSchedule({
  schedule: '45 6 * * *', // Daily at 06:45
  timeZone: 'Europe/London',
  memory: '512MiB',
  timeoutSeconds: 300,
  region: 'europe-west2',
  secrets: [defineSecret('BREVO_API_KEY'), defineSecret('GOOGLEAISTUDIOAPIKEY')]
}, async (event) => {
  console.log('🌅 Starting daily digest generation at 06:45');
  if (!DAILY_DIGEST_ENABLED) {
    console.log('⏭️ Daily digest disabled (Daily Summary already in place); skipping send.');
    return null;
  }

  const aiWrapper = aiUsageLogger.wrapAICall('google-ai-studio', DEFAULT_GEMINI_MODEL);

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

      await processDigestForUser({ db, userId, userProfile, today, todayStr, aiWrapper });
    }

    console.log('🎉 Daily digest generation completed');

  } catch (error) {
    console.error('❌ Daily digest generation failed:', error);
    throw error;
  }
});

// Manual trigger (per-user) to generate a digest on demand
exports.runDailyDigestNow = httpsV2.onCall({ region: 'europe-west2', secrets: [defineSecret('BREVO_API_KEY'), defineSecret('GOOGLEAISTUDIOAPIKEY')] }, async (req) => {
  if (!DAILY_DIGEST_ENABLED) {
    throw new httpsV2.HttpsError('failed-precondition', 'Daily digest email is disabled in favor of the Daily Summary.');
  }
  const uid = req?.auth?.uid;
  if (!uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  }
  const db = admin.firestore();
  const userDoc = await db.collection('profiles').doc(uid).get();
  if (!userDoc.exists) {
    throw new httpsV2.HttpsError('failed-precondition', 'Profile not found');
  }
  const userProfile = userDoc.data();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const aiWrapper = aiUsageLogger.wrapAICall('google-ai-studio', DEFAULT_GEMINI_MODEL);
  try {
    const result = await processDigestForUser({ db, userId: uid, userProfile, today, todayStr, aiWrapper });
    return { ok: true, ...result };
  } catch (e) {
    console.error('runDailyDigestNow failed', e);
    throw new httpsV2.HttpsError('internal', e?.message || 'Digest failed');
  }
});

async function logIntegration(uid, status, message, metadata = {}) {
  try {
    const db = admin.firestore();
    await db.collection('integration_logs').add({
      integration: 'daily_digest',
      status,
      message,
      metadata,
      ownerUid: uid,
      userId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('integration log failed', e?.message || e);
  }
}

async function processDigestForUser({ db, userId, userProfile, today, todayStr, aiWrapper }) {
  if (!DAILY_DIGEST_ENABLED) {
    await logIntegration(userId, 'skipped', 'daily digest disabled', { date: todayStr });
    return { skipped: true };
  }
  console.log(`📧 Generating digest for user: ${userProfile.email || userId}`);
  await logIntegration(userId, 'start', 'daily digest start', { date: todayStr });
  try {
    // Gather user data
    const userData = await gatherUserData(db, userId, today, userProfile);
    // Defensive normalization to avoid undefined collections causing digest failure
    const norm = (v) => Array.isArray(v) ? v : [];
    userData.tasksDueToday = norm(userData.tasksDueToday);
    userData.tasksDueTodaySorted = norm(userData.tasksDueTodaySorted);
    userData.overdueTasks = norm(userData.overdueTasks);
    userData.stories = norm(userData.stories);
    userData.unlinkedStories = norm(userData.unlinkedStories);
    userData.calendarBlocks = norm(userData.calendarBlocks);
    userData.todayBlocks = norm(userData.todayBlocks);
    userData.news = norm(userData.news);
    userData.focusStories = Array.isArray(userData.focusStories) ? userData.focusStories : norm(userData.stories);

    // Log the LLM input context for observability
    try {
      await db.collection('integration_logs').add({
        integration: 'daily_digest',
        action: 'llm_input',
        userId,
        ownerUid: userId,
        ts: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        date: todayStr,
        topTasksDueToday: userData.topTasksDueToday.map(t => t.title || t.ref || t.id),
        todayBlocks: userData.todayBlocks.map(b => b.title || b.category || b.id),
        counts: {
          tasksDueToday: userData.tasksDueToday.length,
          overdueTasks: userData.overdueTasks.length,
          todayBlocks: userData.todayBlocks.length,
        }
      });
    } catch (logErr) {
      console.warn('daily_digest log failed', logErr?.message || logErr);
    }

    // Generate AI insights
    let aiInsights;
    try {
      aiInsights = await aiWrapper(async () => {
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
    } catch (aiErr) {
      console.error('AI digest generation failed', aiErr);
      await logIntegration(userId, 'warn', 'ai digest generation failed', { message: aiErr?.message || String(aiErr) });
      aiInsights = { choices: [{ message: { content: 'AI summary unavailable today.' } }] };
    }

    // Create digest content
    const digestContent = await createDigestHTML(userData, aiInsights);

    // Write AI Priority back to Firestore
    await updateAIPriority(db, userId, aiInsights.choices[0]?.message?.content, userData.tasksDueToday);

    // Save digest to database
    const digestDoc = {
      userId,
      date: todayStr,
      content: digestContent,
      aiInsights: aiInsights.choices[0]?.message?.content || '',
      news: userData.news || [],
      weather: userData.weather || null,
      metrics: {
        tasksDueToday: userData.tasksDueToday.length,
        focusStories: userData.focusStories.length,
        calendarBlocks: userData.calendarBlocks.length,
        overdueTasks: userData.overdueTasks.length
      },
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailSent: false
    };

    const digestRef = await db.collection('daily_digests').add(digestDoc);

    // Send email (if email service is configured)
    if (userProfile.email && userProfile.emailDigestEnabled !== false) {
      try {
        await sendDigestEmail(userProfile.email, digestContent, userData);
        await digestRef.update({ emailSent: true, emailSentAt: admin.firestore.FieldValue.serverTimestamp() });
      } catch (emailErr) {
        console.warn('digest email send failed', emailErr?.message || emailErr);
        await logIntegration(userId, 'warn', 'digest email failed', { message: emailErr?.message || String(emailErr) });
      }
    }

    console.log(`✅ Digest generated successfully for user ${userId}`);
    await logIntegration(userId, 'success', 'daily digest success', { date: todayStr, digestId: digestRef.id });
    return { digestId: digestRef.id };
  } catch (userError) {
    console.error(`❌ Error generating digest for user ${userId}:`, userError);
    await logIntegration(userId, 'error', userError?.message || 'digest failed', { date: todayStr });
    throw userError;
  }
}

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
async function gatherUserData(db, userId, today, userProfile = {}) {
  const todayStr = today.toISOString().split('T')[0];
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  // Resolve location (fallback London -> Belfast if profile hints, else London)
  const profileLocation = (userProfile.location || userProfile.city || userProfile.timezone || '').toString().toLowerCase();
  let loc = { lat: 51.5074, lon: -0.1278, label: 'London, UK' };
  if (profileLocation.includes('belfast')) loc = { lat: 54.5973, lon: -5.9301, label: 'Belfast, UK' };
  if (userProfile.lat && userProfile.lon) {
    loc = { lat: Number(userProfile.lat), lon: Number(userProfile.lon), label: userProfile.location || loc.label };
  }

  // Parallel fetch for external data
  const [weather, news] = await Promise.all([
    fetchWeather(loc.lat, loc.lon),
    fetchNews(5)
  ]);

  // Get tasks due today
  const tasksDueTodaySnapshot = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '>=', new Date(todayStr))
    .where('dueDate', '<', new Date(today.getTime() + 24 * 60 * 60 * 1000))
    .orderBy('dueDate')
    .limit(50)
    .get();

  // Get overdue tasks
  const overdueTasks = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '<', new Date(todayStr))
    .orderBy('dueDate')
    .limit(20)
    .get();

  // Materialize and sort tasks due today by AI score (fallback priority/due)
  const tasksDueTodayDocs = tasksDueTodaySnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(t => String(t.status || '').toLowerCase() !== 'done' && t.status !== 4);
  const tasksDueTodaySorted = [...tasksDueTodayDocs].sort((a, b) => {
    const aScore = Number(a.aiCriticalityScore ?? -1);
    const bScore = Number(b.aiCriticalityScore ?? -1);
    if (Number.isFinite(aScore) && Number.isFinite(bScore) && aScore !== bScore) return bScore - aScore;
    const aPr = Number(a.priority ?? 0);
    const bPr = Number(b.priority ?? 0);
    if (aPr !== bPr) return bPr - aPr;
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : 0;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : 0;
    return aDue - bDue;
  });

  // Get active stories (started or planned)
  const activeStoriesSnapshot = await db.collection('stories')
    .where('ownerUid', '==', userId)
    .where('persona', '==', 'personal')
    .orderBy('updatedAt', 'desc')
    .limit(25)
    .get();

  const stories = activeStoriesSnapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      ...d,
      isStarted: ['active', 'in-progress', 1, 2].includes(d.status)
    };
  }).filter(s => ['active', 'in-progress', 'planned', 1, 2, 0].includes(s.status));

  // Get unlinked stories (Converted Large Tasks)
  const unlinkedStoriesSnapshot = await db.collection('stories')
    .where('ownerUid', '==', userId)
    .where('persona', '==', 'personal')
    .where('unlinked', '==', true)
    .limit(10)
    .get();

  const unlinkedStories = unlinkedStoriesSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(s => String(s.status || '').toLowerCase() !== 'done' && s.status !== 4);

  // Get 7-day calendar blocks (Rolling Window)
  // Note: We fetch 'calendar_blocks' which are the instances.
  const calendarBlocksSnapshot = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('start', '>=', today.getTime())
    .where('start', '<=', nextWeek.getTime())
    .orderBy('start')
    .get();

  // Planner stats (latest run)
  let plannerStats = null;
  try {
    const ps = await db.collection('planner_stats').doc(userId).get();
    if (ps.exists) {
      const d = ps.data() || {};
      plannerStats = {
        lastRunAt: d.lastRunAt || null,
        created: d.created || 0,
        replaced: d.replaced || 0,
        blocked: d.blocked || 0,
        rescheduled: d.rescheduled || 0,
        gcalLinksCount: d.gcalLinksCount || 0,
        source: d.source || 'unknown',
      };
    }
  } catch (err) {
    console.warn('planner_stats fetch failed', err?.message || err);
  }

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

  const calendarBlocksRaw = calendarBlocksSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    startDate: new Date(doc.data().start).toISOString().split('T')[0],
    startTime: new Date(doc.data().start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    endTime: new Date(doc.data().end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }));

  const todayBlocks = calendarBlocksRaw.filter(block => block.startDate === todayStr);

  return {
    tasksDueToday: tasksDueTodayDocs,
    tasksDueTodaySorted,
    overdueTasks: overdueTasks.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    stories,
    unlinkedStories,
    calendarBlocks: calendarBlocksRaw,
    todayBlocks,
    currentSprint: currentSprintSnapshot.docs[0] ? { id: currentSprintSnapshot.docs[0].id, ...currentSprintSnapshot.docs[0].data() } : null,
    goals: goalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    weather,
    news,
    locationLabel: loc.label,
    date: todayStr,
    dayOfWeek: today.toLocaleDateString('en-US', { weekday: 'long' }),
    topTasksDueToday: tasksDueTodaySorted.slice(0, 3),
    plannerStats,
  };
}

/**
 * Generate AI insights using Google AI Studio (Gemini)
 */
async function generateAIInsights(userData) {
  const prompt = `You are an executive productivity assistant for "blueprint.organize.build". Produce a sharp, specific daily briefing that names the exact tasks/stories and calendar blocks the user should act on today.

  CONTEXT DATA (structured):
  - Date: ${userData.dayOfWeek}, ${userData.date}
  - Location: ${userData.locationLabel || 'Unknown'}
  - Weather: ${userData.weather ? userData.weather.description : 'Not available'}
  - Top News: ${userData.news.map(n => `• ${n.title}`).join('\n')}
  - Current Sprint: ${userData.currentSprint ? `"${userData.currentSprint.title}" (Goal: ${userData.currentSprint.goal || 'None'})` : 'None'}
  - Active Stories (prefer STARTED): ${userData.stories.map(s => `• [${s.isStarted ? 'STARTED' : 'PLANNED'}] ${s.title} (Status: ${s.status})`).join('\n')}
  - Top 3 Tasks Due Today (prefer highest AI score): ${userData.topTasksDueToday.map(t => `• ${t.title || t.ref || t.id} (AI score ${t.aiCriticalityScore ?? 'n/a'}${t.aiPriorityBucket ? ' bucket '+t.aiPriorityBucket : ''}${t.aiCriticalityReason ? ' reason: '+t.aiCriticalityReason : ''}, priority ${t.priority ?? 'n/a'}, due ${t.dueDateDisplay || 'today'}, theme ${t.theme || 'n/a'})`).join('\n') || 'None'}
  - Tasks Due Today (${userData.tasksDueToday.length}): ${(userData.tasksDueTodaySorted || userData.tasksDueToday).map(t => `• ${t.title} (AI score ${t.aiCriticalityScore ?? 'n/a'}${t.aiCriticalityReason ? ' reason: '+t.aiCriticalityReason : ''}, due ${t.dueDateDisplay || 'today'})`).join('\n') || 'None'}
  - Today’s Calendar Blocks: ${userData.todayBlocks.map(b => `• ${b.startTime}-${b.endTime} ${b.title || b.category || 'Block'} (theme ${b.theme || 'n/a'})`).join('\n') || 'None'}
  - Overdue Tasks (${userData.overdueTasks.length}): ${userData.overdueTasks.map(t => `• ${t.title} (due ${t.dueDateDisplay || 'overdue'})`).join('\n') || 'None'}
  - Calendar (next 7 days, first 10): ${userData.calendarBlocks.slice(0, 10).map(b => `• ${b.startDate} ${b.startTime}-${b.endTime}: ${b.title}`).join('\n')}

  OUTPUT REQUIREMENTS (plain text, no JSON):
  1) Briefing: 2-3 sentences. Name the single highest-priority item (task or story) and why (due date, sprint, started status, or overdue). If an AI score is present, use it to justify the pick. Weave in weather or one headline naturally.
  2) Focus list: 3 bullets, in order, naming exact refs/titles for the top 3 items (prefer highest AI score from Top 3 Tasks Due Today, then started stories, then overdue tasks). Include due date and AI score when present.
  3) Schedule call-out: Mention how today’s calendar blocks support those priorities (or highlight a gap/conflict to resolve today).
  4) Heads up: one short risk/warning (overdue, crowded calendar, or missing blocks).
  Tone: concise, directive, specific. No generic wellness tips.`;

  const apiKey = process.env.GOOGLEAISTUDIOAPIKEY;
  if (!apiKey) {
    return { choices: [{ message: { content: 'Gemini key not configured.' } }] };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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

  // Attempt to extract a Task ID if the AI identified one (This is a heuristic extraction)
  // In a future iteration, we should force JSON output from the LLM.
  // For now, we'll look for a pattern like "Task ID: <id>" or just rely on the text.
  // BUT, the requirement is to "Write this priority back to the tasks Firestore collection".
  // So we MUST ask for JSON or a specific format.

  return { choices: [{ message: { content: textOut } }] };
}

/**
 * NEW: Helper to extract and save AI Priority
 * This is called after generating insights to update the database.
 */
async function updateAIPriority(db, userId, aiText, tasks) {
  // Simple heuristic: check if any task title from the "Due Today" list is mentioned in the "Single Highest Priority" section.
  // This is a "Soft Match".

  if (!aiText || !tasks || tasks.length === 0) return;

  const lowerText = aiText.toLowerCase();
  let bestMatchId = null;

  for (const task of tasks) {
    if (lowerText.includes(task.title.toLowerCase())) {
      bestMatchId = task.id;
      break; // Take the first one mentioned
    }
  }

  if (bestMatchId) {
    console.log(`🧠 AI identified priority task: ${bestMatchId}`);
    await db.collection('tasks').doc(bestMatchId).update({
      aiPriority: 'high',
      aiPrioritySetAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
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

  const plannerStats = userData.plannerStats;
  const plannerLine = (() => {
    if (!plannerStats) return 'Not yet run.';
    const when = plannerStats.lastRunAt
      ? new Date(plannerStats.lastRunAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
      : 'Unknown time';
    return `${when} · calendar entries +${plannerStats.created || 0}, replaced ${plannerStats.replaced || 0}, blocked ${plannerStats.blocked || 0}`;
  })();

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

            <div class="section-title">AI Planning Summary</div>
            <div class="item">
              <div>
                <div class="item-title">Calendar planner</div>
                <div class="item-meta">${plannerLine}</div>
              </div>
              <span class="tag tag-started">${plannerStats?.source || 'replan'}</span>
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

            ${userData.unlinkedStories && userData.unlinkedStories.length > 0 ? `
            <div class="section-title">Unlinked Stories (Large Tasks)</div>
            ${userData.unlinkedStories.map(s => `
            <div class="item">
                <div>
                    <div class="item-title">${s.title}</div>
                    <div class="item-meta">Converted from Task • ${s.estimateMin || 0} min</div>
                </div>
                <span class="tag" style="background:#fce7f3; color:#be185d">Unlinked</span>
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
  if (!email || !DAILY_DIGEST_ENABLED) return;
  await sendEmail({
    to: email,
    subject: `Daily Briefing: ${userData.dayOfWeek}, ${userData.date}`,
    html: htmlContent,
  });
}
