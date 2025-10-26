const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { https } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { sendEmail } = require('./lib/email');

// Daily email summary (ported from existing generator without logic changes)

exports.dailyEmailSummary = onSchedule({
  schedule: '30 6 * * *', // Daily at 06:30
  timeZone: 'Europe/London',
  memory: '512MiB',
  timeoutSeconds: 300,
  secrets: [defineSecret('BREVO_API_KEY'), defineSecret('GOOGLEAISTUDIOAPIKEY')]
}, async () => {
  const db = admin.firestore();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  console.log('🌅 Starting daily digest (chores codebase)');

  const usersSnapshot = await db.collection('profiles').get();
  for (const userDoc of usersSnapshot.docs) {
    const userProfile = userDoc.data() || {};
    const userId = userDoc.id;
    if (userProfile.dailyDigestEnabled === false) continue;
    try {
      const userData = await gatherUserData(db, userId, today);
      const aiInsights = await generateAIInsights(userData);
      const digestContent = await createDigestHTML(userData, aiInsights);
      await db.collection('daily_digests').add({
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
      });
      if (userProfile.email && userProfile.emailDigestEnabled !== false) {
        await sendDigestEmail(userProfile.email, digestContent, userData);
        const snap = await db.collection('daily_digests')
          .where('userId', '==', userId)
          .where('date', '==', todayStr)
          .get();
        for (const d of snap.docs) {
          await d.ref.update({ emailSent: true, emailSentAt: admin.firestore.FieldValue.serverTimestamp() });
        }
      }
      console.log(`✅ Digest generated for ${userId}`);
    } catch (e) {
      console.error(`❌ Digest failed for ${userId}:`, e);
    }
  }
});

exports.sendDailySummaryNow = https.onCall({ secrets: [defineSecret('BREVO_API_KEY'), defineSecret('GOOGLEAISTUDIOAPIKEY')] }, async (req) => {
  const uid = String(req?.data?.userId || req?.auth?.uid || '').trim();
  if (!uid) throw new https.HttpsError('invalid-argument', 'userId or auth required');
  const db = admin.firestore();
  const today = new Date();
  const userData = await gatherUserData(db, uid, today);
  const aiInsights = await generateAIInsights(userData);
  const digestContent = await createDigestHTML(userData, aiInsights);
  const profileSnap = await db.collection('profiles').doc(uid).get();
  const email = profileSnap.exists ? (profileSnap.data() || {}).email : null;
  if (email) await sendDigestEmail(email, digestContent, userData);
  return { ok: true, userId: uid, emailSent: !!email };
});

async function gatherUserData(db, userId, today) {
  const todayStr = today.toISOString().split('T')[0];
  const tasksDueTodaySnapshot = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '>=', new Date(todayStr))
    .where('dueDate', '<', new Date(today.getTime() + 24 * 60 * 60 * 1000))
    .where('status', '!=', 'done')
    .orderBy('status')
    .orderBy('priority', 'desc')
    .limit(10)
    .get();
  const overdueTasks = await db.collection('tasks')
    .where('ownerUid', '==', userId)
    .where('dueDate', '<', new Date(todayStr))
    .where('status', '!=', 'done')
    .orderBy('dueDate')
    .limit(5)
    .get();
  const focusStoriesSnapshot = await db.collection('stories')
    .where('ownerUid', '==', userId)
    .where('status', '==', 'active')
    .orderBy('points', 'desc')
    .limit(5)
    .get();
  const calendarBlocksSnapshot = await db.collection('calendar_blocks')
    .where('ownerUid', '==', userId)
    .where('date', '==', todayStr)
    .orderBy('startTime')
    .get();
  const currentSprintSnapshot = await db.collection('sprints')
    .where('ownerUid', '==', userId)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  const goalsSnapshot = await db.collection('goals')
    .where('ownerUid', '==', userId)
    .where('status', '==', 'active')
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get();
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

async function generateAIInsights(userData) {
  const prompt = `As an AI productivity coach, analyze this user's day and provide insights:\n\n**Tasks Due Today (${userData.tasksDueToday.length}):**\n${userData.tasksDueToday.map(task => `- ${task.title} (Priority: ${task.priority || 'normal'}, Theme: ${task.theme || 'none'})`).join('\n')}\n\n**Overdue Tasks (${userData.overdueTasks.length}):**\n${userData.overdueTasks.map(task => `- ${task.title} (Due: ${task.dueDate})`).join('\n')}\n\n**Focus Stories (${userData.focusStories.length}):**\n${userData.focusStories.map(story => `- ${story.title} (${story.points || 0} points)`).join('\n')}\n\n**Calendar Blocks (${userData.calendarBlocks.length}):**\n${userData.calendarBlocks.map(block => `- ${block.title} (${block.startTime}-${block.endTime})`).join('\n')}\n\n**Current Sprint:** ${userData.currentSprint ? userData.currentSprint.title : 'No active sprint'}\n\n**Active Goals:** ${userData.goals.map(goal => goal.title).join(', ')}\n\nPlease provide:\n1. **Priority Focus**: What should they tackle first today and why?\n2. **Time Management**: How to optimize their calendar blocks?\n3. **Risk Assessment**: What might derail their day?\n4. **Motivation**: One encouraging insight about their progress\n5. **Quick Wins**: 1-2 small tasks they can complete quickly\n\nKeep it concise, actionable, and encouraging. Write in second person ("you should...").`;
  const apiKey = process.env.GOOGLEAISTUDIOAPIKEY;
  if (!apiKey) return { choices: [{ message: { content: 'Gemini key not configured.' } }] };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      { role: 'user', parts: [{ text: 'You are an expert productivity coach who provides concise, actionable daily guidance. Focus on priorities, time management, and motivation.' }] },
      { role: 'user', parts: [{ text: prompt }] }
    ],
    generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
  };
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) { const text = await resp.text(); throw new Error(`Gemini HTTP ${resp.status}: ${text}`); }
  const json = await resp.json();
  const textOut = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { choices: [{ message: { content: textOut } }] };
}

async function createDigestHTML(userData, aiInsights) {
  const aiAdvice = aiInsights.choices[0]?.message?.content || 'Focus on your priorities and make today count!';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>BOB Daily Digest - ${userData.date}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:20px;border-radius:8px;margin-bottom:20px}.section{background:#f8f9fa;padding:15px;margin:10px 0;border-radius:6px;border-left:4px solid #667eea}.task-item{background:#fff;padding:10px;margin:5px 0;border-radius:4px;border-left:3px solid #28a745}.overdue{border-left-color:#dc3545}.story-item{background:#fff;padding:10px;margin:5px 0;border-radius:4px;border-left:3px solid #ffc107}.calendar-block{background:#fff;padding:10px;margin:5px 0;border-radius:4px;border-left:3px solid #17a2b8}.ai-insights{background:#e3f2fd;padding:15px;border-radius:6px;border-left:4px solid #2196f3}.metric{display:inline-block;background:#fff;padding:8px 12px;margin:4px;border-radius:4px;font-weight:700}.btn{display:inline-block;padding:8px 16px;background:#667eea;color:#fff;text-decoration:none;border-radius:4px;margin:5px}@media (max-width:600px){body{padding:10px}.header{padding:15px}}</style></head><body><div class="header"><h1>🌅 BOB Daily Digest</h1><p><strong>${userData.dayOfWeek}, ${userData.date}</strong></p><div><span class="metric">${userData.tasksDueToday.length} Due Today</span><span class="metric">${userData.overdueTasks.length} Overdue</span><span class="metric">${userData.focusStories.length} Focus Stories</span><span class="metric">${userData.calendarBlocks.length} Calendar Blocks</span></div></div><div class="ai-insights"><h3>🤖 AI Productivity Insights</h3><p>${aiAdvice.replace(/\n/g,'<br>')}</p></div>${userData.overdueTasks.length>0?`<div class="section"><h3>🚨 Overdue Tasks (${userData.overdueTasks.length})</h3>${userData.overdueTasks.map(task=>`<div class="task-item overdue"><strong>${task.title}</strong><br><small>Due: ${task.dueDate} | Priority: ${task.priority||'normal'} | Theme: ${task.theme||'none'}</small><br><a href="https://bob20250810.web.app/tasks-management?task=${task.id}" class="btn">View Task</a></div>`).join('')}</div>`:''}${userData.tasksDueToday.length>0?`<div class="section"><h3>📋 Tasks Due Today (${userData.tasksDueToday.length})</h3>${userData.tasksDueToday.map(task=>`<div class="task-item"><strong>${task.title}</strong><br><small>Priority: ${task.priority||'normal'} | Theme: ${task.theme||'none'} | Effort: ${task.estimatedEffort||'not set'}</small><br><a href="https://bob20250810.web.app/tasks-management?task=${task.id}" class="btn">View Task</a></div>`).join('')}</div>`:''}${userData.focusStories.length>0?`<div class="section"><h3>⭐ Focus Stories (${userData.focusStories.length})</h3>${userData.focusStories.map(story=>`<div class="story-item"><strong>${story.title}</strong><br><small>Points: ${story.points||0} | Theme: ${story.theme||'none'}</small><br><a href="https://bob20250810.web.app/stories?story=${story.id}" class="btn">View Story</a></div>`).join('')}</div>`:''}${userData.calendarBlocks.length>0?`<div class="section"><h3>📅 Today's Calendar (${userData.calendarBlocks.length} blocks)</h3>${userData.calendarBlocks.map(block=>`<div class="calendar-block"><strong>${block.title}</strong><br><small>${block.startTime} - ${block.endTime} | Theme: ${block.theme||'none'}</small></div>`).join('')}</div>`:''}${userData.currentSprint?`<div class="section"><h3>🏃‍♂️ Current Sprint</h3><div style="background:#fff;padding:10px;border-radius:4px;"><strong>${userData.currentSprint.title}</strong><br><small>Sprint Goal: ${userData.currentSprint.goal||'Not set'}</small><br><a href="https://bob20250810.web.app/current-sprint" class="btn">View Sprint</a></div></div>`:''}<div class="section"><h3>🎯 Quick Actions</h3><a href="https://bob20250810.web.app/dashboard" class="btn">📊 Dashboard</a><a href="https://bob20250810.web.app/tasks-management" class="btn">✅ Tasks</a><a href="https://bob20250810.web.app/calendar" class="btn">📅 Calendar</a><a href="https://bob20250810.web.app/current-sprint" class="btn">🏃‍♂️ Sprint</a></div><div style="text-align:center;margin-top:30px;padding:20px;background:#f8f9fa;border-radius:6px;"><p><small>Generated by BOB AI at ${new Date().toLocaleString()}</small></p><p><small>Make today count! 🚀</small></p></div></body></html>`;
}

async function sendDigestEmail(email, htmlContent, userData) {
  if (!email) return;
  await sendEmail({ to: email, subject: `BOB Daily Digest – ${userData?.date || new Date().toLocaleDateString()}`, html: htmlContent });
}

