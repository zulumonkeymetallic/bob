// Cloud Functions: server-side Google Calendar OAuth + helpers + stubs
const functionsV2 = require("firebase-functions/v2");
const httpsV2 = require("firebase-functions/v2/https");
const schedulerV2 = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");

functionsV2.setGlobalOptions({ region: "europe-west2", maxInstances: 10 });
admin.initializeApp();

// Secrets
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const TRAKT_CLIENT_ID = defineSecret("TRAKT_CLIENT_ID");
const STEAM_WEB_API_KEY = defineSecret("STEAM_WEB_API_KEY");

// ===== Utilities
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function stateEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function stateDecode(s) {
  try { return JSON.parse(Buffer.from(String(s || ""), "base64url").toString("utf8")); } catch { return {}; }
}

// ===== OAuth: start
exports.oauthStart = httpsV2.onRequest({ secrets: [GOOGLE_OAUTH_CLIENT_ID] }, async (req, res) => {
  try {
    const uid = String(req.query.uid || "");
    const nonce = String(req.query.nonce || "");
    if (!uid || !nonce) return res.status(400).send("Missing uid/nonce");
    const projectId = process.env.GCLOUD_PROJECT;
    const redirectUri = `https://europe-west2-${projectId}.cloudfunctions.net/oauthCallback`;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const state = stateEncode({ uid, nonce });
    const scope = encodeURIComponent("https://www.googleapis.com/auth/calendar");
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&access_type=offline&include_granted_scopes=true&prompt=consent&scope=${scope}&state=${state}`;
    res.redirect(authUrl);
  } catch (e) {
    res.status(500).send("OAuth start error: " + e.message);
  }
});

// ===== OAuth: callback
exports.oauthCallback = httpsV2.onRequest({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const state = stateDecode(req.query.state);
    const uid = state.uid;
    if (!code || !uid) return res.status(400).send("Missing code/uid");

    const projectId = process.env.GCLOUD_PROJECT;
    const redirectUri = `https://europe-west2-${projectId}.cloudfunctions.net/oauthCallback`;

    const tokenData = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const refresh = tokenData.refresh_token;
    const access = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 3600;
    if (!refresh) {
      return res.status(400).send("No refresh_token returned. Ensure prompt=consent and access_type=offline.");
    }

    const db = admin.firestore();
    await db.collection("tokens").doc(uid).set({
      provider: "google",
      refresh_token: refresh,
      access_token: access || null,
      access_at: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).send("<script>window.close();</script>Connected. You can close this window.");
  } catch (e) {
    res.status(500).send("OAuth callback error: " + e.message);
  }
});

// ===== AI Planning Function
exports.planCalendar = functionsV2.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new functionsV2.https.HttpsError("unauthenticated", "Must be authenticated");
  }

  const { 
    persona = "personal", 
    horizonDays = 7, 
    applyIfScoreGe = 0.8,
    focusGoalId = null,
    goalTimeRequest = null
  } = request.data;
  
  try {
    const db = admin.firestore();
    
    // 1. Assemble context for planning
    const context = await assemblePlanningContext(uid, persona, horizonDays);
    
    // 2. Generate AI plan
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const aiResponse = await generateAIPlan(openai, context, { focusGoalId, goalTimeRequest });
    
    // 3. Validate proposed blocks
    const validationResult = await validateCalendarBlocks(aiResponse.blocks, context);
    
    // 4. Apply if score is high enough
    let applied = false;
    let blocksCreated = 0;
    if (validationResult.score >= applyIfScoreGe && validationResult.errors.length === 0) {
      blocksCreated = await applyCalendarBlocks(uid, persona, aiResponse.blocks);
      applied = true;
    }
    
    return {
      proposedBlocks: aiResponse.blocks,
      rationale: aiResponse.rationale,
      validator: validationResult,
      applied,
      blocksCreated,
      score: validationResult.score,
      focusGoalId: focusGoalId || null
    };
    
  } catch (error) {
    console.error('Calendar planning error:', error);
    throw new functionsV2.https.HttpsError("internal", error.message);
  }
});

async function assemblePlanningContext(uid, persona, horizonDays) {
  const db = admin.firestore();
  const startDate = new Date();
  const endDate = new Date(Date.now() + (horizonDays * 24 * 60 * 60 * 1000));
  
  // Get user's planning preferences
  const prefsDoc = await db.collection('planning_prefs').doc(uid).get();
  const prefs = prefsDoc.exists ? prefsDoc.data() : getDefaultPlanningPrefs();
  
  // Get tasks for this persona
  const tasksQuery = await db.collection('tasks')
    .where('ownerUid', '==', uid)
    .where('persona', '==', persona)
    .where('status', 'in', ['planned', 'in_progress'])
    .get();
  
  const tasks = tasksQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  // Get goals (if personal)
  let goals = [];
  if (persona === 'personal') {
    const goalsQuery = await db.collection('goals')
      .where('ownerUid', '==', uid)
      .where('status', 'in', ['new', 'active'])
      .get();
    goals = goalsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  
  // Get existing calendar blocks
  const blocksQuery = await db.collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('persona', '==', persona)
    .where('start', '>=', startDate.getTime())
    .where('start', '<=', endDate.getTime())
    .get();
  
  const existingBlocks = blocksQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  // Get Google Calendar events (if connected)
  let gcalEvents = [];
  try {
    gcalEvents = await fetchGoogleCalendarEvents(uid, startDate, endDate);
  } catch (error) {
    console.log('No Google Calendar access:', error.message);
  }
  
  return {
    uid,
    persona,
    prefs,
    tasks,
    goals,
    existingBlocks,
    gcalEvents,
    timeWindow: { start: startDate.getTime(), end: endDate.getTime() }
  };
}

async function generateAIPlan(openai, context, options = {}) {
  const { focusGoalId, goalTimeRequest } = options;
  
  let systemPrompt = `You are an AI planning assistant for BOB, a personal productivity system.

CONTEXT:
- Persona: ${context.persona}
- Tasks: ${context.tasks.length} pending
- Goals: ${context.goals.length} active
- Time window: ${Math.ceil((context.timeWindow.end - context.timeWindow.start) / (1000 * 60 * 60 * 24))} days`;

  if (focusGoalId) {
    const focusGoal = context.goals.find(g => g.id === focusGoalId);
    if (focusGoal) {
      systemPrompt += `

🎯 FOCUS MODE: GOAL-SPECIFIC SCHEDULING
Primary Goal: "${focusGoal.title}"
- Theme: ${focusGoal.theme}
- Status: ${focusGoal.status}
- Priority: ${focusGoal.priority}
- Time to Master: ${focusGoal.timeToMasterHours || 'Not specified'} hours
- Requested Weekly Time: ${goalTimeRequest || 120} minutes

PRIORITY: Create time blocks specifically for this goal and related tasks.`;
    }
  }

  systemPrompt += `

PLANNING PREFERENCES:
- Wake time: ${context.prefs.wakeTime || '07:00'}
- Sleep time: ${context.prefs.sleepTime || '23:00'}
- Quiet hours: ${JSON.stringify(context.prefs.quietHours || [])}
- Weekly theme targets: ${JSON.stringify(context.prefs.weeklyThemeTargets || {})}

GOALS TO CONSIDER:
${context.goals.map(goal => `- ${goal.title} (${goal.theme}, ${goal.status}, ${goal.priority}${goal.id === focusGoalId ? ' ⭐ FOCUS GOAL' : ''})`).join('\n')}

TASKS TO SCHEDULE:
${context.tasks.map(task => `- ${task.title} (${task.effort}, ${task.priority}, ${task.theme || 'No theme'}${task.goalId === focusGoalId ? ' ⭐ FOCUS TASK' : ''})`).join('\n')}

CONSTRAINTS:
1. Only schedule between wake and sleep times
2. Avoid quiet hours
3. Respect existing calendar events
4. Balance weekly theme targets
5. Consider task effort and priority`;

  if (focusGoalId) {
    systemPrompt += `
6. 🎯 PRIORITIZE blocks for the focus goal and its related tasks
7. Create dedicated goal work sessions of 25-90 minutes
8. Include goal-themed activities (reading, planning, skill building)`;
  }

  systemPrompt += `

Generate a plan as JSON with:
{
  "blocks": [
    {
      "taskId": "task_id_or_null",
      "goalId": "${focusGoalId || 'goal_id_or_null'}",
      "theme": "Health|Growth|Wealth|Tribe|Home",
      "category": "Task Work|Goal Focus|Skill Building|Planning",
      "title": "Block title",
      "start": timestamp,
      "end": timestamp,
      "rationale": "Why this time slot"
    }
  ],
  "rationale": "Overall planning rationale"
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: focusGoalId ? 
        `Please generate an optimal schedule focused on the goal "${context.goals.find(g => g.id === focusGoalId)?.title}". Create specific time blocks for goal work, skill building, and related tasks.` :
        "Please generate an optimal schedule for these tasks and goals." }
    ],
    temperature: 0.3
  });

  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
}

async function validateCalendarBlocks(blocks, context) {
  const errors = [];
  const warnings = [];
  let score = 1.0;
  
  // Check for conflicts with existing events
  for (const block of blocks) {
    // Check Google Calendar conflicts
    for (const event of context.gcalEvents) {
      if (isTimeOverlap(block.start, block.end, event.start.getTime(), event.end.getTime())) {
        errors.push(`Block conflicts with Google Calendar event: ${event.summary}`);
        score -= 0.2;
      }
    }
    
    // Check existing blocks
    for (const existing of context.existingBlocks) {
      if (isTimeOverlap(block.start, block.end, existing.start, existing.end)) {
        errors.push(`Block conflicts with existing calendar block`);
        score -= 0.1;
      }
    }
    
    // Check time constraints
    const blockDate = new Date(block.start);
    const hour = blockDate.getHours();
    const minute = blockDate.getMinutes();
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    
    const wakeTime = context.prefs.wakeTime || '07:00';
    const sleepTime = context.prefs.sleepTime || '23:00';
    
    if (timeStr < wakeTime || timeStr > sleepTime) {
      errors.push(`Block outside wake/sleep hours: ${timeStr}`);
      score -= 0.1;
    }
    
    // Check quiet hours
    for (const quietPeriod of context.prefs.quietHours || []) {
      if (timeStr >= quietPeriod.start && timeStr <= quietPeriod.end) {
        warnings.push(`Block during quiet hours: ${timeStr}`);
        score -= 0.05;
      }
    }
  }
  
  return { errors, warnings, score: Math.max(0, score) };
}

async function applyCalendarBlocks(uid, persona, blocks) {
  const db = admin.firestore();
  const batch = db.batch();
  
  for (const block of blocks) {
    const blockRef = db.collection('calendar_blocks').doc();
    batch.set(blockRef, {
      ...block,
      id: blockRef.id,
      persona,
      ownerUid: uid,
      status: 'applied',
      createdBy: 'ai',
      version: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  await batch.commit();
  return blocks.length; // Return count of blocks created
}

function getDefaultPlanningPrefs() {
  return {
    wakeTime: '07:00',
    sleepTime: '23:00',
    quietHours: [{ start: '22:00', end: '07:00' }],
    maxHiSessionsPerWeek: 3,
    minRecoveryGapHours: 24,
    weeklyThemeTargets: {
      Health: 300,
      Growth: 240,
      Wealth: 300,
      Tribe: 180,
      Home: 120
    },
    autoApplyThreshold: 0.8
  };
}

function isTimeOverlap(start1, end1, start2, end2) {
  return start1 < end2 && start2 < end1;
}

async function fetchGoogleCalendarEvents(uid, startDate, endDate) {
  try {
    const accessToken = await getAccessToken(uid);
    const timeMin = startDate.toISOString();
    const timeMax = endDate.toISOString();
    
    const eventsResponse = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    return eventsResponse.items.map(event => ({
      id: event.id,
      summary: event.summary || 'Untitled Event',
      start: new Date(event.start.dateTime || event.start.date),
      end: new Date(event.end.dateTime || event.end.date)
    }));
  } catch (error) {
    return [];
  }
}
async function getAccessToken(uid) {
  const db = admin.firestore();
  const doc = await db.collection("tokens").doc(uid).get();
  if (!doc.exists) throw new Error("No token for user");
  const refresh = doc.data().refresh_token;
  if (!refresh) throw new Error("No refresh token");

  const token = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }).toString(),
  });
  return token.access_token;
}

// ===== Calendar callables
exports.calendarStatus = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const doc = await admin.firestore().collection("tokens").doc(req.auth.uid).get();
  return { connected: doc.exists && !!doc.data().refresh_token };
});

exports.createCalendarEvent = httpsV2.onCall({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const { summary, start, end } = req.data || {};
  if (!summary || !start || !end) throw new httpsV2.HttpsError("invalid-argument", "summary/start/end required");
  const access = await getAccessToken(req.auth.uid);
  const ev = await fetchJson("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { "Authorization": "Bearer " + access, "Content-Type": "application/json" },
    body: JSON.stringify({ summary, start: { dateTime: start }, end: { dateTime: end } }),
  });
  return { ok: true, event: ev };
});

exports.listUpcomingEvents = httpsV2.onCall({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const maxResults = Math.min(Number(req.data?.maxResults || 20), 100);
  const access = await getAccessToken(req.auth.uid);
  const now = new Date().toISOString();
  const data = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(now)}&maxResults=${maxResults}`, {
    headers: { "Authorization": "Bearer " + access },
  });
  return { ok: true, items: data.items || [] };
});

exports.onStorySprintChange = functionsV2.firestore.onDocumentUpdated("stories/{storyId}", async (event) => {
  const storyId = event.params.storyId;
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();

  if (beforeData.sprintId !== afterData.sprintId) {
    const db = admin.firestore();
    const newSprintId = afterData.sprintId;

    let newDueDate = null;
    if (newSprintId) {
      const sprintDoc = await db.collection("sprints").doc(newSprintId).get();
      if (sprintDoc.exists) {
        newDueDate = sprintDoc.data().endDate;
      }
    }

    const tasksRef = db.collection("tasks").where("storyId", "==", storyId);
    const tasksSnapshot = await tasksRef.get();

    if (!tasksSnapshot.empty) {
      const batch = db.batch();
      tasksSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { sprintId: newSprintId, dueDate: newDueDate });
      });
      await batch.commit();
    }
  }
});

// ===== AI helpers (as before, simplified)
exports.prioritizeBacklog = httpsV2.onCall({ secrets: [OPENAI_API_KEY] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  let tasks = (req.data && Array.isArray(req.data.tasks)) ? req.data.tasks : [];
  if (tasks.length > 50) tasks = tasks.slice(0,50);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = "Score tasks 0-100 and bucket TODAY/NEXT/LATER. Return JSON {items:[{id,score,bucket}]}\nTasks: " + JSON.stringify(tasks);
  const resp = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.2 });
  let out = { items: [] }; try { out = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch {}
  return out;
});

// ===== Import items (goals, okrs, tasks, resources, trips) – same schema as earlier
exports.importItems = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const type = String(req.data?.type || ""); let items = req.data?.items || [];
  if (!type || !Array.isArray(items) || items.length === 0) return { ok: true, written: 0 };
  if (items.length > 500) items = items.slice(0,500);
  const db = admin.firestore();
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const S = (v)=> (v==null?'':String(v)); const N=(v)=>{ const n=Number(v); return isNaN(n)?null:n; };
  const D=(v)=>{ if(!v)return null; const d=new Date(v); return isNaN(d.getTime())?null:d.toISOString().slice(0,10); };

  const norm = {
    goals: x=>({ ownerUid:req.auth.uid, text:S(x.text||x.goal||x.title), area:S(x.area||x.category||''), confidence:N(x.confidence)||0, createdAt:now, source:S(x.source||'import') }),
    okrs:  x=>({ ownerUid:req.auth.uid, title:S(x.title||x.objective||x.okr||x.name), goalId:S(x.goalId||''), goalTitle:S(x.goalTitle||x.goal||''), kr1:S(x.kr1||x.keyResult1||''), kr2:S(x.kr2||x.keyResult2||''), kr3:S(x.kr3||x.keyResult3||''), sprint:S(x.sprint||''), priority:N(x.priority)||null, createdAt:now, source:S(x.source||'import') }),
    tasks: x=>{ let st=S(x.status).toLowerCase(); if(st!=='doing'&&st!=='done') st='backlog'; return ({ ownerUid:req.auth.uid, title:S(x.title||x.task||x.name), storyId:S(x.storyId||''), goalId:S(x.goalId||''), goalArea:S(x.goalArea||x.area||''), status:st, effort:N(x.effort)||1, dueDate:D(x.dueDate||x.due||x.when), createdAt:now, source:S(x.source||'import') }); },
    resources: x=>({ ownerUid:req.auth.uid, type:(S(x.type||x.kind).toLowerCase()||'reading'), title:S(x.title||x.name), url:S(x.url||x.link||x.href), source:S(x.source||'import'), createdAt:now }),
    trips: x=>({ ownerUid:req.auth.uid, title:S(x.title||x.trip||x.name), startDate:D(x.start||x.startDate), endDate:D(x.end||x.endDate), notes:S(x.notes||''), createdAt:now, source:S(x.source||'import') }),
  };

  for (const row of items) {
    const doc = norm[type] ? norm[type](row) : null;
    if (!doc) throw new httpsV2.HttpsError("invalid-argument","Unknown type: "+type);
    batch.set(db.collection(type).doc(), doc);
  }
  await batch.commit();
  return { ok: true, written: items.length, type };
});

exports.importDevelopmentFeatures = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const items = req.data?.items || [];
  if (!Array.isArray(items) || items.length === 0) return { ok: true, written: 0 };
  if (items.length > 500) items = items.slice(0,500);

  const db = admin.firestore();
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const item of items) {
    const doc = {
        feature: item.feature || null,
        description: item.description || null,
        implemented: item.implemented || false,
        uatStatus: item.uatStatus || 'In Progress',
        version: item.version || null,
        createdAt: now,
        ownerUid: req.auth.uid,
    };
    batch.set(db.collection("development_features").doc(), doc);
  }

  await batch.commit();
  return { ok: true, written: items.length };
});

// ===== Trakt and Steam Sync
async function _syncTrakt(uid) {
  const db = admin.firestore();
  const profile = await db.collection('profiles').doc(uid).get();
  const traktUser = profile.data()?.traktUser;

  if (!traktUser) {
    throw new Error("Trakt username not found in profile.");
  }

  const url = `https://api.trakt.tv/users/${traktUser}/history`;
  const headers = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': process.env.TRAKT_CLIENT_ID,
  };

  const history = await fetchJson(url, { headers });

  const batch = db.batch();
  for (const item of history) {
    const docRef = db.collection('trakt').doc(`${uid}_${item.id}`);
    batch.set(docRef, { ...item, ownerUid: uid }, { merge: true });
  }
  await batch.commit();

  return { ok: true, written: history.length };
}

async function _syncSteam(uid) {
  const db = admin.firestore();
  const profile = await db.collection('profiles').doc(uid).get();
  const steamId = profile.data()?.steamId;

  if (!steamId) {
    throw new Error("SteamID not found in profile.");
  }

  const url = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env.STEAM_WEB_API_KEY}&steamid=${steamId}&format=json`;
  const data = await fetchJson(url);

  const games = data.response.games || [];

  const batch = db.batch();
  for (const item of games) {
    const docRef = db.collection('steam').doc(`${uid}_${item.appid}`);
    batch.set(docRef, { ...item, ownerUid: uid }, { merge: true });
  }
  await batch.commit();

  return { ok: true, written: games.length };
}

exports.syncTrakt = httpsV2.onCall({ secrets: [TRAKT_CLIENT_ID] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  return await _syncTrakt(req.auth.uid);
});

exports.syncSteam = httpsV2.onCall({ secrets: [STEAM_WEB_API_KEY] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  return await _syncSteam(req.auth.uid);
});

// ===== Scheduled Syncs
exports.dailySync = schedulerV2.onSchedule("every day 03:00", async (event) => {
  const db = admin.firestore();
  const profiles = await db.collection('profiles').get();

  for (const profile of profiles.docs) {
    const uid = profile.id;
    const data = profile.data();

    if (data.traktUser) {
      try {
        await _syncTrakt(uid);
      } catch (error) {
        console.error(`Failed to sync Trakt for user ${uid}`, error);
      }
    }

    if (data.steamId) {
      try {
        await _syncSteam(uid);
      } catch (error) {
        console.error(`Failed to sync Steam for user ${uid}`, error);
      }
    }
  }
});

// ===== New v3.0.2 Functions =====

// Daily Digest Email Generation
exports.generateDailyDigest = schedulerV2.onSchedule("30 6 * * *", async (event) => {
  const nodemailer = require('nodemailer');
  
  // Email transporter configuration
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  try {
    // Get all users who have opted in for daily digest
    const usersSnapshot = await admin.firestore().collection('users').where('emailDigest', '==', true).get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      
      await generateUserDigest(userId, userData, transporter);
    }
    
    console.log('Daily digest generation completed');
  } catch (error) {
    console.error('Error generating daily digest:', error);
  }
});

async function generateUserDigest(userId, userData, transporter) {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    // Get tasks due today
    const tasksSnapshot = await admin.firestore().collection('tasks')
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

    // Generate simple HTML digest
    const html = `
      <h1>BOB Daily Digest - ${today.toLocaleDateString()}</h1>
      <h2>Tasks Due Today (${tasksDue.length})</h2>
      ${tasksDue.map(task => `
        <div style="border-left: 4px solid #3b82f6; padding: 10px; margin: 10px 0;">
          <strong>${task.title}</strong><br>
          Priority: ${task.priority} | Effort: ${task.effort}
        </div>
      `).join('')}
      <p>Generated at ${new Date().toLocaleString()}</p>
    `;

    // Save digest to database
    await admin.firestore().collection('digests').add({
      ownerUid: userId,
      date: admin.firestore.Timestamp.fromDate(today),
      tasksDue,
      html,
      createdAt: admin.firestore.Timestamp.now()
    });

    // Send email if user has email
    if (userData.email) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
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

// Test Authentication Functions
exports.generateTestToken = httpsV2.onCall(async (request) => {
  // Only allow in development/test environments
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Test tokens not available in production');
  }

  const { uid, scope } = request.data;
  
  if (!uid) {
    throw new Error('UID is required');
  }

  try {
    const { v4: uuidv4 } = require('uuid');
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    await admin.firestore().collection('test_login_tokens').add({
      token,
      uid,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      scope: scope || 'full',
      createdAt: admin.firestore.Timestamp.now()
    });

    return { token, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    console.error('Error generating test token:', error);
    throw new Error('Failed to generate test token');
  }
});

exports.testLogin = httpsV2.onRequest(async (req, res) => {
  // Only allow in development/test environments
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Test login not available in production' });
    return;
  }

  const { token } = req.query;
  
  if (!token) {
    res.status(400).json({ error: 'Token is required' });
    return;
  }

  try {
    // Find the token in the database
    const tokensSnapshot = await admin.firestore().collection('test_login_tokens')
      .where('token', '==', token)
      .where('expiresAt', '>', admin.firestore.Timestamp.now())
      .limit(1)
      .get();

    if (tokensSnapshot.empty) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const tokenDoc = tokensSnapshot.docs[0];
    const tokenData = tokenDoc.data();

    // Create a custom token for the user
    const customToken = await admin.auth().createCustomToken(tokenData.uid);

    // Clean up the test token (one-time use)
    await tokenDoc.ref.delete();

    res.json({ 
      customToken,
      uid: tokenData.uid,
      scope: tokenData.scope 
    });

  } catch (error) {
    console.error('Error processing test login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cleanup expired test tokens
exports.cleanupTestTokens = schedulerV2.onSchedule("every 6 hours", async (event) => {
  try {
    const expiredTokens = await admin.firestore().collection('test_login_tokens')
      .where('expiresAt', '<', admin.firestore.Timestamp.now())
      .get();

    const batch = admin.firestore().batch();
    expiredTokens.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`Cleaned up ${expiredTokens.size} expired test tokens`);
  } catch (error) {
    console.error('Error cleaning up test tokens:', error);
  }
});