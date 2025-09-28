// Cloud Functions: server-side Google Calendar OAuth + helpers + stubs
const functionsV2 = require("firebase-functions/v2");
const httpsV2 = require("firebase-functions/v2/https");
const schedulerV2 = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const firestoreV2 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");
const aiUsageLogger = require("./utils/aiUsageLogger");
const { rrulestr } = require('rrule');
const { DateTime } = require('luxon');
const { planSchedule, makeInstanceId: schedulerMakeInstanceId } = require('./scheduler/engine');
const DEFAULT_TIMEZONE = 'Europe/London';

// Import the daily digest generator
const { generateDailyDigest } = require("./dailyDigestGenerator");

functionsV2.setGlobalOptions({ region: "europe-west2", maxInstances: 10 });
admin.initializeApp();

// Secrets
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
// Google AI Studio (Gemini) for Issue #124
const GOOGLE_AI_STUDIO_API_KEY = defineSecret("GOOGLEAISTUDIOAPIKEY");
const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const TRAKT_CLIENT_ID = defineSecret("TRAKT_CLIENT_ID");
const STEAM_WEB_API_KEY = defineSecret("STEAM_WEB_API_KEY");
const N8N_WEBHOOK_SECRET = defineSecret("N8N_WEBHOOK_SECRET");
const N8N_OUTBOUND_WEBHOOK_URL = defineSecret("N8N_OUTBOUND_WEBHOOK_URL");
const N8N_SCHEDULE_STEAM_URL = defineSecret("N8N_SCHEDULE_STEAM_URL");
// Strava integration secrets
const STRAVA_CLIENT_ID = defineSecret("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET = defineSecret("STRAVA_CLIENT_SECRET");
// Monzo integration secrets
const MONZO_CLIENT_ID = defineSecret("MONZO_CLIENT_ID");
const MONZO_CLIENT_SECRET = defineSecret("MONZO_CLIENT_SECRET");
const STRAVA_WEBHOOK_VERIFY_TOKEN = defineSecret("STRAVA_WEBHOOK_VERIFY_TOKEN");
// No secrets required for Parkrun
const REMINDERS_WEBHOOK_SECRET = defineSecret("REMINDERS_WEBHOOK_SECRET");

// Scheduler utils (deterministic id + day key)
function makePlanId(userId, date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}-${userId}`;
}
function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
function makeAssignmentId({ planId, itemType, itemId }) {
  const raw = `${planId}:${itemType}:${itemId}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ===== Deterministic Scheduler (Issue #152 - Phase 1)
exports.buildPlan = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const day = req?.data?.day || new Date().toISOString().slice(0,10); // YYYY-MM-DD
  const useLLM = !!req?.data?.useLLM;
  const date = new Date(day);
  if (isNaN(date.getTime())) throw new httpsV2.HttpsError('invalid-argument', 'Invalid day');

  const db = admin.firestore();
  const dayKey = toDayKey(date);
  const planId = makePlanId(uid, date);

  // Load blocks for the day (calendar_blocks)
  const start = new Date(date); start.setHours(0,0,0,0);
  const end = new Date(date); end.setHours(23,59,59,999);
  const blocksSnap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', start.getTime())
    .where('start', '<=', end.getTime())
    .get();
  const blocks = blocksSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
    .sort((a,b) => a.start - b.start);

  // Load candidate tasks (status not done)
  const tasksSnap = await db.collection('tasks')
    .where('ownerUid', '==', uid)
    .get();
  const tasks = tasksSnap.docs
    .map(d => ({ id: d.id, ...(d.data() || {}) }))
    .filter(t => t && t.status !== 2 && t.status !== 'done');

  // Load chores due for the selected day
  const choresSnap = await db.collection('chores')
    .where('ownerUid', '==', uid)
    .get();
  const sod = new Date(date); sod.setHours(0,0,0,0);
  const eod = new Date(date); eod.setHours(23,59,59,999);
  function nextDue(rruleText, dtstartMs, fromMs) {
    try {
      const hasDt = /DTSTART/i.test(String(rruleText||''));
      const text = !hasDt && dtstartMs
        ? `DTSTART:${new Date(dtstartMs).toISOString().replace(/[-:]/g,'').split('.')[0]}Z\n${rruleText}`
        : rruleText;
      const rule = rrulestr(text);
      const next = rule.after(new Date(fromMs), true);
      return next ? next.getTime() : null;
    } catch { return null; }
  }
  const chores = choresSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }))
    .map(c => {
      const due = nextDue(c.rrule, c.dtstart || c.createdAt || undefined, sod.getTime()-1);
      return { ...c, _due: due };
    })
    .filter(c => c._due && c._due >= sod.getTime() && c._due <= eod.getTime());

  // Load habits (daily, active) and derive preferred start time
  const habitsSnap = await db.collection('habits')
    .where('userId','==', uid)
    .where('isActive','==', true)
    .get();
  function toTimeMs(hhmm) {
    const [hh, mm] = String(hhmm || '07:00').split(':').map(x=>Number(x));
    const t = new Date(sod);
    t.setHours(hh||7, mm||0, 0, 0);
    return t.getTime();
  }
  const habits = habitsSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }))
    .filter(h => (h.frequency||'daily') === 'daily' || ((h.frequency||'') === 'weekly' && Array.isArray(h.daysOfWeek) && h.daysOfWeek.includes(new Date(sod).getDay())))
    .map(h => ({ ...h, _preferredStart: toTimeMs(h.scheduleTime || '07:00') }));

  // Score deterministically
  function scoreTask(t) {
    let s = 0;
    // Due date proximity
    if (t.dueDate) {
      const dd = Number(t.dueDate);
      if (dd) {
        const days = Math.ceil((dd - Date.now()) / (24*60*60*1000));
        if (days <= 0) s += 60; else if (days === 1) s += 45; else if (days <= 7) s += 25;
      }
    }
    // Priority
    if (t.priority === 1 || t.priority === 'high' || t.priority === 'P1') s += 25;
    else if (t.priority === 2 || t.priority === 'medium' || t.priority === 'P2') s += 15;
    else s += 5;
    // Effort inverse (favor small)
    if (t.effort === 'S') s += 15; else if (t.effort === 'M') s += 8; else s += 2;
    // Goal alignment bonus
    if (t.hasGoal || t.goalId) s += 10;
    return s;
  }

  let ranked = tasks.map(t => ({ ...t, _score: scoreTask(t) }))
    .sort((a,b) => b._score - a._score);

  // Optional: soft LLM re-rank within a 20% band – omitted in Phase 1 to keep deterministic behavior

  // Pack into blocks greedily
  const items = [
    ...ranked.map(t => ({
      type: 'task',
      id: t.id,
      title: t.title || 'Task',
      minutes: Number(t.estimateMin) || (t.effort === 'S' ? 20 : t.effort === 'M' ? 45 : 90),
    })),
    ...chores.map(c => ({
      type: 'chore',
      id: c.id,
      title: c.title || 'Chore',
      minutes: Number(c.estimatedMinutes) || 15
    })),
    ...habits.map(h => ({
      type: 'habit',
      id: h.id,
      title: h.name || 'Habit',
      minutes: 15,
      preferredStart: h._preferredStart
    }))
  ];

  const assignments = [];
  const blockFree = new Map();
  for (const b of blocks) {
    const free = Math.max(0, Math.floor((Number(b.end) - Number(b.start)) / 60000));
    blockFree.set(b.id, { free, cursor: Number(b.start) });
  }

  for (const it of items) {
    // Find earliest block with enough remaining minutes
    let placed = false;
    // Try to respect preferredStart if provided (habits)
    if (it.preferredStart) {
      for (const b of blocks) {
        const state = blockFree.get(b.id);
        if (!state) continue;
        if (it.preferredStart >= b.start && (it.preferredStart + it.minutes*60000) <= b.end) {
          // place at max(cursor, preferredStart)
          const startMs = Math.max(state.cursor, it.preferredStart);
          const endMs = startMs + it.minutes*60000;
          if (endMs <= b.end && (endMs - startMs)/60000 <= state.free) {
            assignments.push({
              id: makeAssignmentId({ planId, itemType: it.type, itemId: it.id }),
              planId, dayKey, userId: uid, ownerUid: uid,
              itemType: it.type, itemId: it.id, title: it.title,
              estimatedMinutes: it.minutes, blockId: b.id, start: startMs, end: endMs,
              status: 'planned', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            state.free -= Math.floor((endMs-startMs)/60000);
            state.cursor = endMs;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        // schedule without a block at preferredStart
        const startMs = it.preferredStart;
        const endMs = startMs + it.minutes*60000;
        assignments.push({
          id: makeAssignmentId({ planId, itemType: it.type, itemId: it.id }),
          planId, dayKey, userId: uid, ownerUid: uid,
          itemType: it.type, itemId: it.id, title: it.title,
          estimatedMinutes: it.minutes, start: startMs, end: endMs,
          status: 'planned', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        placed = true;
      }
    }
    if (placed) continue;
    for (const b of blocks) {
      const state = blockFree.get(b.id);
      if (!state) continue;
      if (state.free >= it.minutes) {
        const startMs = state.cursor;
        const endMs = startMs + it.minutes * 60000;
        assignments.push({
          id: makeAssignmentId({ planId, itemType: it.type, itemId: it.id }),
          planId,
          dayKey,
          userId: uid,
          ownerUid: uid,
          itemType: it.type,
          itemId: it.id,
          title: it.title,
          estimatedMinutes: it.minutes,
          blockId: b.id,
          start: startMs,
          end: endMs,
          status: 'planned',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        state.free -= it.minutes;
        state.cursor = endMs;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Defer (overflow)
      assignments.push({
        id: makeAssignmentId({ planId, itemType: it.type, itemId: it.id }),
        planId,
        dayKey,
        userId: uid,
        ownerUid: uid,
        itemType: it.type,
        itemId: it.id,
        title: it.title,
        estimatedMinutes: it.minutes,
        status: 'deferred',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  // Persist plan assignments idempotently
  const batch = db.batch();
  for (const a of assignments) {
    const ref = db.collection('plans').doc(dayKey).collection('assignments').doc(a.id);
    batch.set(ref, a, { merge: true });
  }
  await batch.commit();

  // Audit trail
  const activityRef = db.collection('activity_stream').doc();
  await activityRef.set({
    id: activityRef.id,
    entityId: planId,
    entityType: 'plan',
    activityType: 'scheduler_plan_built',
    userId: uid,
    description: `Built plan with ${assignments.length} assignments for ${dayKey}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { planId, dayKey, assignments: assignments.map(a => ({ id: a.id, blockId: a.blockId, status: a.status })) };
});

async function fetchGoogleBusy(uid, start, end) {
  try {
    const accessToken = await getAccessToken(uid);
    if (!accessToken) return [];
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: start.toUTC().toISO(),
        timeMax: end.toUTC().toISO(),
        items: [{ id: 'primary' }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`freeBusy ${res.status}: ${text}`);
    }
    const payload = await res.json();
    return payload?.calendars?.primary?.busy || [];
  } catch (err) {
    console.warn('[planBlocksV2] busy fetch failed', err.message || err);
    return [];
  }
}

exports.planBlocksV2 = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const timezone = req?.data?.timezone || DEFAULT_TIMEZONE;
  const startDate = req?.data?.startDate || DateTime.now().setZone(timezone).toISODate();
  const days = Math.min(Math.max(Number(req?.data?.days || 7), 1), 30);
  const start = DateTime.fromISO(startDate, { zone: timezone }).startOf('day');
  if (!start.isValid) {
    throw new httpsV2.HttpsError('invalid-argument', 'Invalid startDate');
  }
  const end = start.plus({ days: days - 1 }).endOf('day');

  const db = admin.firestore();
  const busy = req?.data?.includeBusy === false ? [] : await fetchGoogleBusy(uid, start, end);

  const plan = await planSchedule({
    db,
    userId: uid,
    windowStart: start,
    windowEnd: end,
    busy,
  });

  const existingIds = new Set(plan.existingIds || []);
  const batch = db.batch();
  const nowMs = Date.now();

  for (const instance of plan.planned) {
    const ref = db.collection('scheduled_instances').doc(instance.id);
    const isExisting = existingIds.has(instance.id);
    const payload = {
      ...instance,
      status: instance.status || 'planned',
      userId: uid,
      ownerUid: uid,
      updatedAt: nowMs,
    };
    if (!isExisting) {
      payload.createdAt = nowMs;
    }
    batch.set(ref, payload, { merge: true });
  }

  for (const unscheduled of plan.unscheduled) {
    const id = schedulerMakeInstanceId({
      userId: uid,
      sourceType: unscheduled.sourceType,
      sourceId: unscheduled.sourceId,
      occurrenceDate: unscheduled.dayKey,
    });
    const ref = db.collection('scheduled_instances').doc(id);
    const isExisting = existingIds.has(id);
    const payload = {
      id,
      userId: uid,
      ownerUid: uid,
      sourceType: unscheduled.sourceType,
      sourceId: unscheduled.sourceId,
      title: unscheduled.title || null,
      occurrenceDate: unscheduled.dayKey,
      status: 'unscheduled',
      statusReason: unscheduled.reason,
      durationMinutes: 0,
      priority: 5,
      requiredBlockId: unscheduled.requiredBlockId || null,
      candidateBlockIds: unscheduled.candidateBlockIds || [],
      updatedAt: nowMs,
    };
    if (!isExisting) {
      payload.createdAt = nowMs;
    }
    batch.set(ref, payload, { merge: true });
  }

  await batch.commit();

  const jobDocId = `${uid}__${start.toISODate()}`;
  await db.collection('planning_jobs').doc(jobDocId).set({
    id: jobDocId,
    userId: uid,
    planningDate: start.toISODate(),
    windowStart: start.toISODate(),
    windowEnd: end.toISODate(),
    solverRunId: plan.solverRunId,
    status: 'succeeded',
    startedAt: nowMs,
    completedAt: nowMs,
    plannedCount: plan.planned.length,
    unscheduledCount: plan.unscheduled.length,
    createdAt: nowMs,
    updatedAt: nowMs,
  }, { merge: true });

  return {
    solverRunId: plan.solverRunId,
    planned: plan.planned,
    unscheduled: plan.unscheduled,
    conflicts: plan.conflicts,
  };
});

// Reconcile assignments with Google Calendar: if child events were deleted externally,
// mark assignments as deferred and clear the external.googleEventId
exports.reconcilePlanFromGoogleCalendar = httpsV2.onCall({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const uid = req.auth.uid;
  const day = req?.data?.day || new Date().toISOString().slice(0,10);
  const date = new Date(day);
  if (isNaN(date.getTime())) throw new httpsV2.HttpsError('invalid-argument', 'Invalid day');
  const db = admin.firestore();
  const dayKey = toDayKey(date);
  const access = await getAccessToken(uid);
  const asSnap = await db.collection('plans').doc(dayKey).collection('assignments').where('ownerUid','==',uid).get();
  const toCheck = asSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })).filter(a => a?.external?.googleEventId);
  let cleared = 0;
  for (const a of toCheck) {
    const eid = a.external.googleEventId;
    try {
      // GET returns 404 if deleted
      await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eid)}`, {
        headers: { 'Authorization': 'Bearer ' + access }
      });
    } catch (e) {
      // Treat as deleted -> clear and mark deferred
      await db.collection('plans').doc(dayKey).collection('assignments').doc(a.id)
        .set({ status: 'deferred', external: { googleEventId: null }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      cleared++;
    }
  }
  return { ok: true, checked: toCheck.length, cleared };
});

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
exports.oauthStart = httpsV2.onRequest({ secrets: [GOOGLE_OAUTH_CLIENT_ID], invoker: 'public' }, async (req, res) => {
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
exports.oauthCallback = httpsV2.onRequest({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET], invoker: 'public' }, async (req, res) => {
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

// ===== Monzo OAuth Start
exports.monzoOAuthStart = httpsV2.onRequest({ secrets: [MONZO_CLIENT_ID], invoker: 'public' }, async (req, res) => {
  try {
    const uid = String(req.query.uid || "");
    const nonce = String(req.query.nonce || "");
    if (!uid || !nonce) return res.status(400).send("Missing uid/nonce");
    const projectId = process.env.GCLOUD_PROJECT;
    const region = "europe-west2";
    const redirectUri = `https://${region}-${projectId}.cloudfunctions.net/monzoOAuthCallback`;
    const clientId = process.env.MONZO_CLIENT_ID;
    const state = stateEncode({ uid, nonce });
    // Monzo OAuth authorize
    const authUrl = `https://auth.monzo.com/?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
    res.redirect(authUrl);
  } catch (e) {
    res.status(500).send("Monzo OAuth start error: " + e.message);
  }
});

// ===== Monzo OAuth Callback
exports.monzoOAuthCallback = httpsV2.onRequest({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] , invoker: 'public' }, async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const state = stateDecode(req.query.state);
    const uid = state.uid;
    if (!code || !uid) return res.status(400).send("Missing code/uid");

    const projectId = process.env.GCLOUD_PROJECT;
    const region = "europe-west2";
    const redirectUri = `https://${region}-${projectId}.cloudfunctions.net/monzoOAuthCallback`;

    const tokenData = await fetchJson("https://api.monzo.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: process.env.MONZO_CLIENT_ID,
        client_secret: process.env.MONZO_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }).toString(),
    });

    const refresh = tokenData.refresh_token;
    const access = tokenData.access_token;
    const expiresIn = tokenData.expires_in; // seconds
    const user_id = tokenData.user_id || null;
    if (!refresh) return res.status(400).send("No refresh_token from Monzo. Check app setup.");

    const db = admin.firestore();
    const tokenRef = db.collection("tokens").doc(`${uid}_monzo`);
    const expires_at = Math.floor(Date.now()/1000) + (Number(expiresIn)||0);
    await tokenRef.set({
      provider: "monzo",
      ownerUid: uid,
      monzo_user_id: user_id,
      refresh_token: refresh,
      access_token: access || null,
      expires_at,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Mark profile integration flag
    await db.collection('profiles').doc(uid).set({
      monzoConnected: true,
      monzoLastSyncAt: null
    }, { merge: true });

    res.status(200).send("<script>window.close();</script>Monzo connected. You can close this window.");
  } catch (e) {
    console.error('Monzo OAuth callback error:', e);
    res.status(500).send("Monzo OAuth callback error: " + e.message);
  }
});

async function getMonzoAccessToken(uid) {
  const db = admin.firestore();
  const tokenRef = db.collection('tokens').doc(`${uid}_monzo`);
  const snap = await tokenRef.get();
  if (!snap.exists) throw new Error('Monzo not connected');
  const data = snap.data() || {};
  const now = Math.floor(Date.now()/1000) + 60; // 60s skew
  if (data.access_token && data.expires_at && data.expires_at > now) {
    return data.access_token;
  }
  // refresh
  const refresh = data.refresh_token;
  if (!refresh) throw new Error('Missing refresh_token');
  const tokenData = await fetchJson("https://api.monzo.com/oauth2/token", {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: process.env.MONZO_CLIENT_ID,
      client_secret: process.env.MONZO_CLIENT_SECRET,
    }).toString(),
  });
  const access = tokenData.access_token;
  const expiresIn = tokenData.expires_in;
  const newRefresh = tokenData.refresh_token || refresh;
  const expires_at = Math.floor(Date.now()/1000) + (Number(expiresIn)||0);
  await tokenRef.set({ access_token: access, refresh_token: newRefresh, expires_at, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return access;
}

// ===== Monzo: list accounts and store basics
exports.monzoListAccounts = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const access = await getMonzoAccessToken(uid);
  const res = await fetch('https://api.monzo.com/accounts', { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new httpsV2.HttpsError('internal', 'Monzo accounts fetch failed: ' + res.status);
  const data = await res.json();
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  const db = admin.firestore();
  const batch = db.batch();
  for (const acc of accounts) {
    const ref = db.collection('finance_accounts').doc(`${uid}_${acc.id}`);
    batch.set(ref, { ownerUid: uid, provider: 'monzo', account: acc, updatedAt: Date.now() }, { merge: true });
  }
  await batch.commit();
  return { ok: true, count: accounts.length, accounts };
});

// ===== Monzo: sync transactions for account
exports.monzoSyncTransactions = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const accountId = String(req?.data?.accountId || '');
  const since = req?.data?.since ? new Date(req.data.since).toISOString() : undefined;
  if (!accountId) throw new httpsV2.HttpsError('invalid-argument', 'accountId required');
  const access = await getMonzoAccessToken(uid);
  const url = new URL('https://api.monzo.com/transactions');
  url.searchParams.set('account_id', accountId);
  if (since) url.searchParams.set('since', since);
  url.searchParams.set('expand[]', 'merchant');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new httpsV2.HttpsError('internal', `Monzo transactions failed: ${res.status}`);
  const data = await res.json();
  const txs = Array.isArray(data?.transactions) ? data.transactions : [];
  const db = admin.firestore();
  const batch = db.batch();
  for (const t of txs) {
    const txId = `${uid}_${t.id}`;
    const ref = db.collection('finance_transactions').doc(txId);
    const norm = {
      ownerUid: uid,
      provider: 'monzo',
      accountId,
      transactionId: t.id,
      created: t.created ? new Date(t.created).getTime() : Date.now(),
      amount: t.amount, // in minor units (pence)
      currency: t.currency,
      description: t.description,
      category: t.category,
      is_load: t.is_load || false,
      settled: t.settled || null,
      notes: t.notes || '',
      merchant: t.merchant ? { id: t.merchant.id || null, name: t.merchant.name || null, category: t.merchant.category || null } : null,
      raw: t,
      updatedAt: Date.now(),
    };
    batch.set(ref, norm, { merge: true });
  }
  await batch.commit();
  // update last sync
  await db.collection('profiles').doc(uid).set({ monzoLastSyncAt: Date.now() }, { merge: true });
  return { ok: true, count: txs.length };
});

// ===== Strava OAuth Start
exports.stravaOAuthStart = httpsV2.onRequest({ secrets: [STRAVA_CLIENT_ID], invoker: 'public' }, async (req, res) => {
  try {
    const uid = String(req.query.uid || "");
    const nonce = String(req.query.nonce || "");
    if (!uid || !nonce) return res.status(400).send("Missing uid/nonce");
    const projectId = process.env.GCLOUD_PROJECT;
    const region = "europe-west2";
    const redirectUri = `https://${region}-${projectId}.cloudfunctions.net/stravaOAuthCallback`;
    const clientId = process.env.STRAVA_CLIENT_ID;
    const state = stateEncode({ uid, nonce });
    const scope = encodeURIComponent("read,activity:read");
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
    res.redirect(authUrl);
  } catch (e) {
    res.status(500).send("Strava OAuth start error: " + e.message);
  }
});

// ===== Strava OAuth Callback
exports.stravaOAuthCallback = httpsV2.onRequest({ secrets: [STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET], invoker: 'public' }, async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const state = stateDecode(req.query.state);
    const uid = state.uid;
    if (!code || !uid) return res.status(400).send("Missing code/uid");

    const projectId = process.env.GCLOUD_PROJECT;
    const region = "europe-west2";
    const redirectUri = `https://${region}-${projectId}.cloudfunctions.net/stravaOAuthCallback`;

    const tokenData = await fetchJson("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const refresh = tokenData.refresh_token;
    const access = tokenData.access_token;
    const expiresAt = tokenData.expires_at; // seconds epoch
    const athlete = tokenData.athlete || {};
    if (!refresh) {
      return res.status(400).send("No refresh_token from Strava. Ensure correct scopes and app settings.");
    }

    const db = admin.firestore();
    const tokenRef = db.collection("tokens").doc(`${uid}_strava`);
    await tokenRef.set({
      provider: "strava",
      ownerUid: uid,
      athleteId: athlete.id || null,
      athlete: athlete || null,
      refresh_token: refresh,
      access_token: access || null,
      expires_at: expiresAt || null,
      scope: tokenData.scope || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Mark profile integration flag
    await db.collection('profiles').doc(uid).set({
      stravaConnected: true,
      stravaAthleteId: athlete.id || null,
      stravaLastSyncAt: null
    }, { merge: true });

    res.status(200).send("<script>window.close();</script>Strava connected. You can close this window.");
  } catch (e) {
    console.error('Strava OAuth callback error:', e);
    res.status(500).send("Strava OAuth callback error: " + e.message);
  }
});

// ===== Monzo OAuth Start
exports.monzoOAuthStart = httpsV2.onRequest({ secrets: [MONZO_CLIENT_ID], invoker: 'public' }, async (req, res) => {
  try {
    const uid = String(req.query.uid || "");
    const nonce = String(req.query.nonce || "");
    if (!uid || !nonce) return res.status(400).send("Missing uid/nonce");

    const projectId = process.env.GCLOUD_PROJECT;
    const region = "europe-west2";
    const forwardedHost = req.get('x-forwarded-host');
    const forwardedProto = req.get('x-forwarded-proto') || 'https';
    const isHostingRewrite = forwardedHost && !forwardedHost.includes(`${region}-${projectId}.cloudfunctions.net`);
    const redirectUri = isHostingRewrite
      ? `${forwardedProto}://${forwardedHost}/api/monzo/callback`
      : `https://${region}-${projectId}.cloudfunctions.net/monzoOAuthCallback`;

    const clientId = process.env.MONZO_CLIENT_ID;
    if (!clientId) return res.status(500).send("Monzo client ID not configured");

    const state = stateEncode({ uid, nonce });
    const scope = encodeURIComponent("openid profile accounts:read balance:read transactions:read pots:read");
    const authUrl = `https://auth.monzo.com/?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
    res.redirect(authUrl);
  } catch (e) {
    console.error('Monzo OAuth start error:', e);
    res.status(500).send("Monzo OAuth start error: " + e.message);
  }
});

// ===== Monzo OAuth Callback
exports.monzoOAuthCallback = httpsV2.onRequest({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET], invoker: 'public' }, async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const state = stateDecode(req.query.state);
    const uid = state.uid;
    if (!code || !uid) return res.status(400).send("Missing code/uid");

    const projectId = process.env.GCLOUD_PROJECT;
    const region = "europe-west2";
    const forwardedHost = req.get('x-forwarded-host');
    const forwardedProto = req.get('x-forwarded-proto') || 'https';
    const isHostingRewrite = forwardedHost && !forwardedHost.includes(`${region}-${projectId}.cloudfunctions.net`);
    const redirectUri = isHostingRewrite
      ? `${forwardedProto}://${forwardedHost}/api/monzo/callback`
      : `https://${region}-${projectId}.cloudfunctions.net/monzoOAuthCallback`;

    const tokenData = await fetchJson("https://api.monzo.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.MONZO_CLIENT_ID,
        client_secret: process.env.MONZO_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    const refresh = tokenData.refresh_token;
    const access = tokenData.access_token;
    const expiresIn = Number(tokenData.expires_in || 0);
    const expiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null;
    const monzoUserId = tokenData.user_id || null;
    if (!refresh || !access) {
      return res.status(400).send("Monzo tokens missing from response");
    }

    const db = admin.firestore();
    await db.collection('tokens').doc(`${uid}_monzo`).set({
      provider: 'monzo',
      ownerUid: uid,
      monzoUserId,
      refresh_token: refresh,
      access_token: access,
      expires_at: expiresAt,
      scope: tokenData.scope || null,
      token_type: tokenData.token_type || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('profiles').doc(uid).set({
      monzoConnected: true,
      monzoUserId,
      monzoLastSyncAt: null,
    }, { merge: true });

    await db.collection('monzo_sync_jobs').add({
      ownerUid: uid,
      type: 'initial-sync',
      state: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).send("<script>window.close();</script>Monzo connected. You can close this window.");
  } catch (e) {
    console.error('Monzo OAuth callback error:', e);
    res.status(500).send("Monzo OAuth callback error: " + e.message);
  }
});

async function ensureMonzoAccessToken(uid) {
  const db = admin.firestore();
  const tokenRef = db.collection('tokens').doc(`${uid}_monzo`);
  const snap = await tokenRef.get();
  if (!snap.exists) {
    throw new httpsV2.HttpsError('failed-precondition', 'Monzo is not connected for this user');
  }

  const data = snap.data() || {};
  const nowSeconds = Math.floor(Date.now() / 1000);
  let accessToken = data.access_token || null;
  let expiresAt = Number(data.expires_at || 0);

  const needsRefresh = !accessToken || !expiresAt || expiresAt <= nowSeconds + 90;
  if (!needsRefresh) {
    return { accessToken, tokenRef, tokenData: data };
  }

  const refreshToken = data.refresh_token;
  if (!refreshToken) {
    throw new httpsV2.HttpsError('failed-precondition', 'Missing Monzo refresh token');
  }
  if (!process.env.MONZO_CLIENT_ID || !process.env.MONZO_CLIENT_SECRET) {
    throw new httpsV2.HttpsError('failed-precondition', 'Monzo API credentials not configured');
  }

  const refreshed = await fetchJson('https://api.monzo.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.MONZO_CLIENT_ID,
      client_secret: process.env.MONZO_CLIENT_SECRET,
      refresh_token: refreshToken,
    }).toString(),
  });

  accessToken = refreshed.access_token;
  const newRefresh = refreshed.refresh_token || refreshToken;
  const expiresIn = Number(refreshed.expires_in || 0);
  expiresAt = expiresIn ? nowSeconds + expiresIn : null;

  await tokenRef.set({
    access_token: accessToken,
    refresh_token: newRefresh,
    expires_at: expiresAt,
    scope: refreshed.scope || data.scope || null,
    token_type: refreshed.token_type || data.token_type || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { accessToken, tokenRef, tokenData: { ...data, access_token: accessToken, refresh_token: newRefresh, expires_at: expiresAt } };
}

async function monzoApi(accessToken, path, query = {}) {
  const url = new URL(`https://api.monzo.com${path}`);
  if (query instanceof URLSearchParams) {
    for (const [key, value] of query.entries()) {
      url.searchParams.append(key, value);
    }
  } else {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, String(v)));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }

  return fetchJson(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Register a Monzo webhook for an account (callable)
exports.monzoRegisterWebhook = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const accountId = String(req.data?.accountId || '').trim();
  const targetUrl = String(req.data?.url || '').trim();
  if (!accountId || !targetUrl) throw new httpsV2.HttpsError('invalid-argument', 'accountId and url are required');
  const { accessToken } = await ensureMonzoAccessToken(uid);
  const res = await fetch('https://api.monzo.com/webhooks', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, url: targetUrl })
  });
  if (!res.ok) throw new httpsV2.HttpsError('internal', `Webhook register failed: ${res.status}`);
  const data = await res.json();
  await admin.firestore().collection('monzo_webhooks').doc(`${uid}_${accountId}`).set({ ownerUid: uid, accountId, webhook: data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, webhook: data };
});

// Webhook receiver (hosting rewrite supported)
exports.monzoWebhook = httpsV2.onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const accountId = String(body?.data?.account_id || body?.account_id || '').trim();
    if (!accountId) return res.status(400).send('Missing account_id');
    const db = admin.firestore();
    const snap = await db.collection('monzo_accounts').where('accountId','==',accountId).limit(1).get();
    if (snap.empty) { await db.collection('webhook_logs').add({ source: 'monzo', direction: 'in', ts: Date.now(), warn: 'account not found', accountId }); return res.json({ ok: true }); }
    const docRef = snap.docs[0];
    const uid = (docRef.data() || {}).ownerUid;
    if (!uid) { await db.collection('webhook_logs').add({ source: 'monzo', direction: 'in', ts: Date.now(), warn: 'ownerUid missing', accountId }); return res.json({ ok: true }); }
    // Trigger incremental sync without since to fetch latest
    try { await syncMonzoDataForUser(uid); } catch (e) { await db.collection('webhook_logs').add({ source: 'monzo', direction: 'in', ts: Date.now(), error: String(e?.message||e) }); }
    return res.json({ ok: true });
  } catch (e) {
    try { await admin.firestore().collection('webhook_logs').add({ source: 'monzo', direction: 'in', ts: Date.now(), error: String(e?.message||e) }); } catch {}
    return res.status(500).send('error');
  }
});

// Callable: revoke Monzo access (delete tokens, attempt token revocation)
exports.revokeMonzoAccess = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const db = admin.firestore();
  try {
    await db.collection('tokens').doc(`${uid}_monzo`).delete();
  } catch {}
  await db.collection('profiles').doc(uid).set({ monzoConnected: false, monzoUserId: null }, { merge: true });
  await db.collection('webhook_logs').add({ source: 'monzo', direction: 'internal', ts: Date.now(), event: 'revoked', uid });
  return { ok: true };
});

// Callable: delete finance data (accounts, pots, transactions, analytics)
exports.deleteFinanceData = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const db = admin.firestore();
  const cols = ['monzo_accounts', 'monzo_pots', 'monzo_transactions', 'monzo_budget_summary', 'monzo_goal_alignment'];
  for (const col of cols) {
    const snap = await db.collection(col).where('ownerUid','==', uid).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  await db.collection('webhook_logs').add({ source: 'finance', direction: 'internal', ts: Date.now(), event: 'deleted_finance_data', uid });
  return { ok: true };
});

// GDPR Export: return a JSON bundle of finance docs (small export)
exports.exportFinanceData = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const db = admin.firestore();
  const result = {};
  const cols = ['monzo_accounts', 'monzo_pots', 'monzo_transactions', 'monzo_budget_summary', 'monzo_goal_alignment'];
  for (const col of cols) {
    const snap = await db.collection(col).where('ownerUid','==', uid).get();
    result[col] = snap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }));
  }
  return { ok: true, data: result };
});

// 15-min backstop transaction sync
exports.monzoBackstopSync = schedulerV2.onSchedule('every 15 minutes', async () => {
  const db = admin.firestore();
  const tokens = await db.collection('tokens').where('provider','==','monzo').get();
  for (const t of tokens.docs) {
    const data = t.data() || {};
    const uid = data.ownerUid || String(t.id).replace(/_monzo$/, '');
    if (!uid) continue;
    try { await syncMonzoDataForUser(uid); } catch (e) { await db.collection('webhook_logs').add({ source: 'monzo', direction: 'internal', ts: Date.now(), error: String(e?.message||e) }); }
  }
  return { ok: true, users: tokens.size };
});

const MONZO_CATEGORY_TYPE_MAP = {
  bills: 'mandatory',
  entertainment: 'optional',
  expenses: 'mandatory',
  family: 'mandatory',
  transport: 'mandatory',
  groceries: 'mandatory',
  eating_out: 'optional',
  holidays: 'optional',
  shopping: 'optional',
  personal_care: 'optional',
  cash: 'optional',
  general: 'optional',
  investments: 'savings',
  transfers: 'savings',
  savings: 'savings',
  charity: 'mandatory',
  business: 'mandatory',
};

function inferDefaultCategoryType(tx) {
  const cat = String(tx.category || '').toLowerCase();
  if (MONZO_CATEGORY_TYPE_MAP[cat]) return MONZO_CATEGORY_TYPE_MAP[cat];
  // Monzo uses negative for spend, positive for income/pot transfers
  if (Number(tx.amount || 0) >= 0) return 'income';
  return 'optional';
}

function inferDefaultCategoryLabel(tx) {
  if (tx.merchant && tx.merchant.name) return tx.merchant.name;
  if (tx.description) return tx.description;
  if (tx.category) return tx.category;
  return 'Uncategorised';
}

function toMonthKey(isoTs) {
  try {
    const date = new Date(isoTs);
    if (Number.isNaN(date.getTime())) return null;
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  } catch (e) {
    return null;
  }
}

async function syncMonzoTransactionsForAccount({ uid, accountId, accessToken, since }) {
  const db = admin.firestore();
  const transactionsCol = db.collection('monzo_transactions');
  const limit = 200;
  let cursor = since || null;
  let prevCursor = cursor || null;
  let total = 0;
  let lastCreated = since || null;

  while (true) {
    const params = new URLSearchParams();
    params.set('account_id', accountId);
    params.set('limit', String(limit));
    if (cursor) params.set('since', cursor);
    params.append('expand[]', 'merchant');

    const data = await monzoApi(accessToken, '/transactions', params);
    const transactions = data.transactions || [];
    if (!transactions.length) break;

    const batch = db.batch();
    for (const tx of transactions) {
      const docRef = transactionsCol.doc(`${uid}_${tx.id}`);
      const defaultCategoryType = inferDefaultCategoryType(tx);
      const defaultCategoryLabel = inferDefaultCategoryLabel(tx);
      const amountMinorRaw = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount || 0);
      if (!Number.isFinite(amountMinorRaw)) continue;
      const amountMinor = Math.trunc(amountMinorRaw);
      const amount = amountMinor / 100;
      const metadataRaw = tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : null;
      const metadataSanitised = {};
      if (metadataRaw) {
        for (const [rawKey, rawValue] of Object.entries(metadataRaw)) {
          const safeKey = rawKey.replace(/[.$\[\]]/g, '_');
          metadataSanitised[safeKey] = typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
            ? rawValue
            : JSON.stringify(rawValue);
        }
      }
      const docData = {
        ownerUid: uid,
        accountId,
        transactionId: tx.id,
        amountMinor,
        amount,
        currency: tx.currency,
        description: tx.description || null,
        category: tx.category || null,
        notes: tx.notes || null,
        isLoad: !!tx.is_load,
        isSettled: !!tx.settled,
        settledISO: tx.settled || null,
        createdISO: tx.created || null,
        scheme: tx.scheme || null,
        declineReason: tx.decline_reason || null,
        counterparty: tx.counterparty || null,
        metadata: Object.keys(metadataSanitised).length ? metadataSanitised : null,
        defaultCategoryType,
        defaultCategoryLabel,
        monthKey: tx.created ? toMonthKey(tx.created) : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        raw: tx,
      };
      if (tx.created) {
        docData.createdAt = admin.firestore.Timestamp.fromDate(new Date(tx.created));
      }
      if (tx.settled) {
        docData.settledAt = admin.firestore.Timestamp.fromDate(new Date(tx.settled));
      }
      if (tx.merchant && typeof tx.merchant === 'object') {
        docData.merchant = {
          id: tx.merchant.id || null,
          name: tx.merchant.name || null,
          emoji: tx.merchant.emoji || null,
          logo: tx.merchant.logo || null,
          category: tx.merchant.category || null,
        };
        docData.merchantRaw = tx.merchant;
      } else {
        docData.merchant = null;
      }

      batch.set(docRef, docData, { merge: true });
    }

    await batch.commit();

    total += transactions.length;
    const lastTx = transactions[transactions.length - 1];
    if (lastTx?.created) {
      lastCreated = lastTx.created;
      prevCursor = cursor;
      const nextDate = new Date(lastTx.created);
      cursor = new Date(nextDate.getTime() + 1).toISOString();
      if (cursor === prevCursor) break;
    } else {
      break;
    }

    if (transactions.length < limit) break;
  }

  return { count: total, lastCreated };
}

async function syncMonzoDataForUser(uid, { since } = {}) {
  const { accessToken } = await ensureMonzoAccessToken(uid);
  const db = admin.firestore();
  const summary = { accounts: 0, pots: 0, transactions: 0, accountsSynced: [] };

  const accountsResp = await monzoApi(accessToken, '/accounts', { account_type: 'uk_retail' });
  const accounts = accountsResp.accounts || [];
  summary.accounts = accounts.length;

  if (accounts.length) {
    const batch = db.batch();
    for (const account of accounts) {
      const docRef = db.collection('monzo_accounts').doc(`${uid}_${account.id}`);
      const docData = {
        ownerUid: uid,
        accountId: account.id,
        name: account.description || account.name || null,
        type: account.type || null,
        accountNumber: account.account_number || null,
        sortCode: account.sort_code || null,
        closed: !!account.closed,
        raw: account,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (account.created) {
        docData.accountCreatedAt = admin.firestore.Timestamp.fromDate(new Date(account.created));
        docData.accountCreatedISO = account.created;
      }
      batch.set(docRef, docData, { merge: true });
    }
    await batch.commit();
  }

  const potsResp = await monzoApi(accessToken, '/pots');
  const pots = potsResp.pots || [];
  summary.pots = pots.length;
  if (pots.length) {
    const batch = db.batch();
    for (const pot of pots) {
      const docRef = db.collection('monzo_pots').doc(`${uid}_${pot.id}`);
      const docData = {
        ownerUid: uid,
        potId: pot.id,
        name: pot.name || null,
        balance: pot.balance,
        currency: pot.currency || null,
        accountId: pot.current_account_id || null,
        goalAmount: pot.goal_amount || null,
        goalCurrency: pot.goal_currency || pot.currency || null,
        roundUpEnabled: pot.round_up?.enabled || false,
        deleted: !!pot.deleted,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        raw: pot,
      };
      if (pot.created) {
        docData.potCreatedAt = admin.firestore.Timestamp.fromDate(new Date(pot.created));
        docData.potCreatedISO = pot.created;
      }
      batch.set(docRef, docData, { merge: true });
    }
    await batch.commit();
  }

  for (const account of accounts) {
    const accountId = account.id;
    const syncStateRef = db.collection('monzo_sync_state').doc(`${uid}_${accountId}`);
    const syncSnap = await syncStateRef.get();
    const stateData = syncSnap.data() || {};
    const sinceCursor = since || stateData.lastTransactionCreated || null;

    const txSummary = await syncMonzoTransactionsForAccount({ uid, accountId, accessToken, since: sinceCursor });
    summary.transactions += txSummary.count;
    summary.accountsSynced.push({ accountId, transactions: txSummary.count, lastCreated: txSummary.lastCreated || null });

    const update = {
      ownerUid: uid,
      accountId,
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncCount: txSummary.count,
      lastSyncSince: sinceCursor || null,
    };
    if (txSummary.lastCreated) {
      update.lastTransactionCreated = txSummary.lastCreated;
      update.lastTransactionTs = admin.firestore.Timestamp.fromDate(new Date(txSummary.lastCreated));
    }

    await syncStateRef.set(update, { merge: true });
  }

  await db.collection('profiles').doc(uid).set({
    monzoLastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const analytics = await computeMonzoAnalytics(uid);
    summary.analytics = analytics.summarySnapshot || null;
  } catch (error) {
    console.error(`Failed to compute Monzo analytics for user ${uid}`, error);
  }

  return summary;
}

const THEME_NAME_MAP = {
  1: 'Health',
  2: 'Growth',
  3: 'Finance & Wealth',
  4: 'Tribe',
  5: 'Home',
};

async function computeMonzoAnalytics(uid) {
  const db = admin.firestore();
  const txSnap = await db.collection('monzo_transactions').where('ownerUid', '==', uid).get();
  const potSnap = await db.collection('monzo_pots').where('ownerUid', '==', uid).get();
  const goalsSnap = await db.collection('goals').where('ownerUid', '==', uid).get();

  const totals = { mandatory: 0, optional: 0, savings: 0, income: 0 };
  const categoryTotals = new Map();
  const monthly = {};
  const pendingClassification = [];
  let pendingCount = 0;

  txSnap.forEach((doc) => {
    const data = doc.data() || {};
    const amount = Number(data.amount != null ? data.amount : (data.amountMinor || 0) / 100);
    const catType = String(data.userCategoryType || data.categoryType || data.defaultCategoryType || inferDefaultCategoryType(data.raw || {}));
    const canonType = ['mandatory', 'optional', 'savings', 'income'].includes(catType) ? catType : (amount >= 0 ? 'income' : 'optional');
    const absAmount = amount < 0 ? Math.abs(amount) : amount;

    totals[canonType] = (totals[canonType] || 0) + absAmount;

    const categoryLabel = data.userCategoryLabel || data.userCategory || data.defaultCategoryLabel || data.merchant?.name || data.description || 'Uncategorised';
    const current = categoryTotals.get(categoryLabel) || { amount: 0, count: 0, type: canonType };
    current.amount += absAmount;
    current.count += 1;
    current.type = canonType;
    categoryTotals.set(categoryLabel, current);

    const monthKey = data.monthKey || (data.createdISO ? toMonthKey(data.createdISO) : null);
    if (monthKey) {
      if (!monthly[monthKey]) {
        monthly[monthKey] = { mandatory: 0, optional: 0, savings: 0, income: 0 };
      }
      monthly[monthKey][canonType] += absAmount;
    }

    const hasUserCategory = !!data.userCategoryType;
    if (!hasUserCategory && amount < 0) {
      pendingCount += 1;
      if (pendingClassification.length < 25) {
        pendingClassification.push({
          transactionId: data.transactionId,
          description: data.description || categoryLabel,
          amount: absAmount,
          createdISO: data.createdISO || null,
          defaultCategoryType: data.defaultCategoryType || null,
          defaultCategoryLabel: data.defaultCategoryLabel || null,
        });
      }
    }
  });

  const categories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 50)
    .map(([label, stats]) => ({ label, amount: stats.amount, count: stats.count, type: stats.type }));

  const summaryDoc = {
    ownerUid: uid,
    totals,
    categories,
    monthly,
    pendingClassification,
    pendingCount,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('monzo_budget_summary').doc(uid).set(summaryDoc, { merge: true });

  // Goal alignment
  const pots = potSnap.docs.map((p) => ({ id: p.id, ...(p.data() || {}) }));
  const potIndex = new Map();
  pots.forEach((potDoc) => {
    const pot = potDoc || {};
    const key = String(pot.potId || pot.id || '').toLowerCase();
    if (key) potIndex.set(key, pot);
    if (pot.name) potIndex.set(pot.name.toLowerCase(), pot);
  });

  const goals = goalsSnap.docs.map((g) => ({ id: g.id, ...(g.data() || {}) }));
  const goalSummaries = [];
  const themeTotals = {};

  goals.forEach((goal) => {
    const estimatedCost = Number(goal.estimatedCost || goal.targetValue || goal.target || 0);
    const themeId = Number(goal.theme || 0);
    const title = goal.title || 'Goal';
    const normalizedTitle = title.toLowerCase();
    let matchedPot = null;

    // Prefer explicit pot mapping if provided
    const explicitPotId = String(goal.potId || goal.pot_id || '').toLowerCase();
    if (explicitPotId && potIndex.has(explicitPotId)) {
      matchedPot = potIndex.get(explicitPotId);
    }

    if (!matchedPot) {
      for (const pot of pots) {
        const potName = String(pot.name || '').toLowerCase();
        if (potName && (normalizedTitle.includes(potName) || potName.includes(normalizedTitle))) {
          matchedPot = pot;
          break;
        }
      }
    }

    const potBalanceMinor = matchedPot?.balance != null ? Number(matchedPot.balance) : 0;
    const potBalance = potBalanceMinor / 100;
    const fundedAmount = estimatedCost ? Math.min(potBalance, estimatedCost) : potBalance;
    const shortfall = estimatedCost ? Math.max(estimatedCost - potBalance, 0) : 0;
    const fundedPercent = estimatedCost ? Math.min((potBalance / estimatedCost) * 100, 100) : null;

    goalSummaries.push({
      goalId: goal.id,
      title,
      themeId,
      themeName: THEME_NAME_MAP[themeId] || 'General',
      estimatedCost,
      potId: matchedPot?.potId || matchedPot?.id || null,
      potName: matchedPot?.name || null,
      potBalance,
      fundedAmount,
      fundedPercent,
      shortfall,
    });

    if (!themeTotals[themeId]) {
      themeTotals[themeId] = {
        themeId,
        themeName: THEME_NAME_MAP[themeId] || 'General',
        goalCount: 0,
        totalEstimatedCost: 0,
        totalPotBalance: 0,
        totalShortfall: 0,
      };
    }
    const agg = themeTotals[themeId];
    agg.goalCount += 1;
    agg.totalEstimatedCost += estimatedCost;
    agg.totalPotBalance += potBalance;
    agg.totalShortfall += shortfall;
  });

  const alignmentDoc = {
    ownerUid: uid,
    goals: goalSummaries,
    themes: Object.values(themeTotals),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('monzo_goal_alignment').doc(uid).set(alignmentDoc, { merge: true });

  return { summarySnapshot: summaryDoc, alignmentDoc };
}

exports.syncMonzo = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;

  const sinceInput = req.data?.since || null;
  let sinceIso = null;
  if (sinceInput) {
    const sinceDate = new Date(sinceInput);
    if (isNaN(sinceDate.getTime())) {
      throw new httpsV2.HttpsError('invalid-argument', 'since must be a valid date or ISO string');
    }
    sinceIso = sinceDate.toISOString();
  }

  const jobId = req.data?.jobId ? String(req.data.jobId) : null;
  const db = admin.firestore();
  let jobRef = null;
  if (jobId) {
    jobRef = db.collection('monzo_sync_jobs').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new httpsV2.HttpsError('not-found', 'Monzo sync job not found');
    }
    const jobData = jobSnap.data() || {};
    if (jobData.ownerUid && jobData.ownerUid !== uid) {
      throw new httpsV2.HttpsError('permission-denied', 'Cannot run a Monzo sync job for another user');
    }
    await jobRef.set({
      state: 'in-progress',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  try {
    const summary = await syncMonzoDataForUser(uid, { since: sinceIso });
    if (jobRef) {
      await jobRef.set({
        state: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastResult: summary,
      }, { merge: true });
    }
    return { ok: true, ...summary };
  } catch (error) {
    if (jobRef) {
      await jobRef.set({
        state: 'failed',
        error: String(error?.message || error),
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (error instanceof httpsV2.HttpsError) throw error;
    throw new httpsV2.HttpsError('internal', error.message || 'Monzo sync failed');
  }
});

exports.updateMonzoTransactionCategory = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const transactionId = String(req.data?.transactionId || '').trim();
  const categoryType = String(req.data?.categoryType || '').trim().toLowerCase();
  const label = req.data?.label ? String(req.data.label).trim() : null;

  const allowed = new Set(['mandatory', 'optional', 'savings', 'income']);
  if (!transactionId) throw new httpsV2.HttpsError('invalid-argument', 'transactionId is required');
  if (!allowed.has(categoryType)) throw new httpsV2.HttpsError('invalid-argument', 'categoryType must be mandatory, optional, savings, or income');

  const db = admin.firestore();
  const docRef = db.collection('monzo_transactions').doc(`${uid}_${transactionId}`);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new httpsV2.HttpsError('not-found', 'Transaction not found');
  }

  await docRef.set({
    userCategoryType: categoryType,
    userCategoryLabel: label,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await computeMonzoAnalytics(uid);

  return { ok: true };
});

exports.recomputeMonzoAnalytics = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const analytics = await computeMonzoAnalytics(uid);
  return { ok: true, analytics };
});

// Nightly analytics refresh for all users with Monzo connected
exports.nightlyMonzoAnalytics = schedulerV2.onSchedule('every day 02:30', async () => {
  const db = admin.firestore();
  const tokens = await db.collection('tokens').where('provider','==','monzo').get();
  let ok = 0, fail = 0;
  for (const t of tokens.docs) {
    try {
      const data = t.data() || {};
      const uid = data.ownerUid || String(t.id).replace(/_monzo$/, '');
      if (!uid) continue;
      await computeMonzoAnalytics(uid);
      ok++;
    } catch (e) {
      fail++;
      try { await db.collection('webhook_logs').add({ source: 'monzo', direction: 'internal', ts: Date.now(), error: String(e?.message||e) }); } catch {}
    }
  }
  return { ok, fail, scanned: tokens.size };
});

// ===== AI Planning Function
exports.planCalendar = functionsV2.https.onCall({ secrets: [OPENAI_API_KEY, GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
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
    context.userId = uid; // Add userId to context for logging
    
    // 2. Generate AI plan
    const aiResponse = await generateAIPlan(context, { focusGoalId, goalTimeRequest });
    
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

// ===== Story Generation for Goal (AI)
exports.generateStoriesForGoal = functionsV2.https.onCall({ secrets: [OPENAI_API_KEY, GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new functionsV2.https.HttpsError("unauthenticated", "Must be authenticated");
  }
  const { goalId, promptOverride } = request.data || {};
  if (!goalId) {
    throw new functionsV2.https.HttpsError('invalid-argument', 'goalId is required');
  }

  try {
    const db = admin.firestore();
    const goalSnap = await db.collection('goals').doc(goalId).get();
    if (!goalSnap.exists) {
      throw new Error('Goal not found');
    }
    const goal = goalSnap.data();
    if (goal.ownerUid !== uid) {
      throw new functionsV2.https.HttpsError('permission-denied', 'Not your goal');
    }

    // Optional per-user prompt
    let basePrompt = null;
    try {
      const settingsDoc = await db.collection('user_settings').doc(uid).get();
      basePrompt = settingsDoc.exists ? (settingsDoc.data().storyGenPrompt || null) : null;
    } catch {}

    const prompt = promptOverride || basePrompt || (
      `Generate between 3 and 6 user stories for the following personal goal. ` +
      `Each story must include a clear title and a 1-2 sentence description. ` +
      `Return STRICT JSON: {"stories":[{"title":"...","description":"..."}, ...]}. ` +
      `Do not include markdown or prose, JSON only.`
    );

    const userContent = `Goal Title: ${goal.title}\nGoal Description: ${goal.description || ''}\nTheme: ${goal.theme}\nPriority: ${goal.priority || ''}`;
    const text = await callLLMJson({
      system: prompt,
      user: userContent,
      purpose: 'generateStoriesForGoal',
      userId: uid,
      expectJson: true
    });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('AI did not return valid JSON');
    }
    const stories = Array.isArray(parsed?.stories) ? parsed.stories : [];

    const batch = db.batch();
    const now = Date.now();
    let created = 0;
    for (const s of stories) {
      if (!s?.title) continue;
      const ref = db.collection('stories').doc();
      batch.set(ref, {
        id: ref.id,
        ref: `STY-${now}-${Math.floor(Math.random()*10000)}`,
        persona: 'personal',
        title: String(s.title).slice(0, 140),
        description: String(s.description || ''),
        goalId: goalId,
        theme: goal.theme,
        status: 0, // backlog
        priority: 2,
        points: 1,
        wipLimit: 10,
        orderIndex: now + created,
        ownerUid: uid,
        createdAt: now,
        updatedAt: now,
        taskCount: 0,
        doneTaskCount: 0,
        aiGenerated: true
      });
      created += 1;
    }
    if (created > 0) {
      await batch.commit();
    }

    return { created };
  } catch (error) {
    console.error('generateStoriesForGoal error:', error);
    throw new functionsV2.https.HttpsError('internal', error.message);
  }
});

// ===== Story Acceptance Criteria Generation (AI)
exports.generateStoryAcceptanceCriteria = functionsV2.https.onCall({ secrets: [OPENAI_API_KEY, GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new functionsV2.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const {
    title,
    description = '',
    persona = 'personal',
    maxItems = 4
  } = request.data || {};

  if (!title || typeof title !== 'string') {
    throw new functionsV2.https.HttpsError('invalid-argument', 'title is required');
  }

  try {
    const safeTitle = String(title).trim().slice(0, 200);
    const safeDescription = String(description || '').trim().slice(0, 1200);
    const count = Math.min(Math.max(Number(maxItems) || 4, 1), 8);

    const systemPrompt = `You are an agile coach creating crisp acceptance criteria for a user story. ` +
      `Return JSON with an "acceptanceCriteria" array of ${count} or fewer clear Given/When/Then statements. ` +
      `Keep each item under 140 characters and avoid markdown bullets.`;

    const userPrompt = `Story Title: ${safeTitle}\n` +
      `Story Description: ${safeDescription || 'N/A'}\n` +
      `Persona: ${persona}`;

    const text = await callLLMJson({
      system: systemPrompt,
      user: userPrompt,
      purpose: 'generateStoryAcceptanceCriteria',
      userId: uid,
      expectJson: true,
      temperature: 0.2
    });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.warn('generateStoryAcceptanceCriteria: JSON parse failed', parseError);
      parsed = {};
    }

    const criteriaRaw = Array.isArray(parsed?.acceptanceCriteria) ? parsed.acceptanceCriteria : [];
    const acceptanceCriteria = criteriaRaw
      .map(item => String(item || '').trim())
      .filter(item => item.length > 0)
      .slice(0, count);

    return { acceptanceCriteria };

  } catch (error) {
    console.error('generateStoryAcceptanceCriteria error:', error);
    throw new functionsV2.https.HttpsError('internal', error.message);
  }
});

// ===== Task Description Enhancement (AI)
exports.enhanceTaskDescription = functionsV2.https.onCall({ secrets: [OPENAI_API_KEY, GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new functionsV2.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const {
    title,
    description = '',
    persona = 'personal',
    context = ''
  } = request.data || {};

  if (!title || typeof title !== 'string') {
    throw new functionsV2.https.HttpsError('invalid-argument', 'title is required');
  }

  try {
    const safeTitle = String(title).trim().slice(0, 200);
    const safeDescription = String(description || '').trim().slice(0, 1200);
    const safeContext = String(context || '').trim().slice(0, 600);

    const systemPrompt = `You are a productivity coach helping refine task descriptions. ` +
      `Return JSON with a concise "description" summarising the key steps and, if useful, a "checklist" array of action items. ` +
      `Keep each checklist item to under 100 characters.`;

    const userPrompt = `Task Title: ${safeTitle}\n` +
      `Existing Description: ${safeDescription || 'N/A'}\n` +
      `Persona: ${persona}\n` +
      `Additional Context: ${safeContext || 'None'}\n` +
      `Deadline: tomorrow`;

    const text = await callLLMJson({
      system: systemPrompt,
      user: userPrompt,
      purpose: 'enhanceTaskDescription',
      userId: uid,
      expectJson: true,
      temperature: 0.3
    });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.warn('enhanceTaskDescription: JSON parse failed', parseError);
      parsed = {};
    }

    const enhancedDescription = String(parsed?.description || safeDescription || safeTitle).trim();
    const checklist = Array.isArray(parsed?.checklist)
      ? parsed.checklist.map(item => String(item || '').trim()).filter(item => item.length > 0).slice(0, 7)
      : [];

    return { description: enhancedDescription, checklist };

  } catch (error) {
    console.error('enhanceTaskDescription error:', error);
    throw new functionsV2.https.HttpsError('internal', error.message);
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

async function generateAIPlan(context, options = {}) {
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

  const userMsg = focusGoalId ? 
    `Please generate an optimal schedule focused on the goal "${context.goals.find(g => g.id === focusGoalId)?.title}". Create specific time blocks for goal work, skill building, and related tasks.` :
    "Please generate an optimal schedule for these tasks and goals.";

  const text = await callLLMJson({
    system: systemPrompt,
    user: userMsg,
    purpose: 'planCalendar',
    userId: context.userId,
    expectJson: true,
    temperature: 0.3
  });

  try {
    return JSON.parse(text);
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

// Map numeric theme to canonical label
function themeLabelFromNumber(n) {
  switch (Number(n)) {
    case 1: return 'Health';
    case 2: return 'Growth';
    case 3: return 'Wealth';
    case 4: return 'Tribe';
    case 5: return 'Home';
    default: return 'Growth';
  }
}

async function applyCalendarBlocks(uid, persona, blocks) {
  const db = admin.firestore();
  const batch = db.batch();

  // Helper: derive title, theme, goal link for a proposed block
  async function enrichBlock(proposed) {
    let title = proposed.title || null;
    let theme = proposed.theme || null; // may be string already
    let goalId = proposed.goalId || null;
    let storyId = proposed.storyId || null;
    let taskId = proposed.taskId || null;
    let habitId = proposed.habitId || null;
    let linkUrl = null;

    // Preferred order: task → story → habit
    if (taskId) {
      try {
        const t = await db.collection('tasks').doc(String(taskId)).get();
        if (t.exists) {
          const td = t.data();
          const ref = td.ref || td.reference || '';
          const tTitle = td.title || 'Task';
          title = `${ref ? ref + ' · ' : ''}${tTitle}`;
          // Derive story/goal from task parent
          if (td.parentType === 'story' && td.parentId) storyId = td.parentId;
          if (!goalId && (td.goalId || td.alignedToGoal)) {
            goalId = td.goalId || null;
          }
          linkUrl = `/tasks?taskId=${t.id}`;
        }
      } catch {}
    }

    if (!title && storyId) {
      try {
        const s = await db.collection('stories').doc(String(storyId)).get();
        if (s.exists) {
          const sd = s.data();
          const ref = sd.ref || '';
          const sTitle = sd.title || 'Story';
          title = `${ref ? ref + ' · ' : ''}${sTitle}`;
          if (!goalId && sd.goalId) goalId = sd.goalId;
          linkUrl = `/stories?storyId=${s.id}`;
        }
      } catch {}
    }

    if (!title && habitId) {
      try {
        const h = await db.collection('habits').doc(String(habitId)).get();
        if (h.exists) {
          const hd = h.data();
          const hTitle = hd.name || hd.title || 'Habit';
          title = hTitle;
          if (!goalId && hd.linkedGoalId) goalId = hd.linkedGoalId;
          linkUrl = `/habits?habitId=${h.id}`;
        }
      } catch {}
    }

    // Resolve theme from goal if needed
    if (!theme && goalId) {
      try {
        const g = await db.collection('goals').doc(String(goalId)).get();
        if (g.exists) {
          const gd = g.data();
          theme = themeLabelFromNumber(gd.theme);
        }
      } catch {}
    }
    // Ensure string theme label
    if (typeof theme === 'number') theme = themeLabelFromNumber(theme);
    if (!theme) theme = 'Growth';

    return { title, theme, goalId, storyId, taskId, habitId, linkUrl };
  }

  // We will also log to activity_stream once
  const activityRef = db.collection('activity_stream').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  let createdCount = 0;
  for (const proposed of blocks) {
    const enriched = await enrichBlock(proposed);
    const blockRef = db.collection('calendar_blocks').doc();

    batch.set(blockRef, {
      ...proposed,
      id: blockRef.id,
      persona,
      ownerUid: uid,
      status: 'applied',
      createdBy: 'ai',
      version: 1,
      title: enriched.title || proposed.title || `${proposed.category || 'Block'} (${enriched.theme})`,
      theme: enriched.theme,
      goalId: enriched.goalId || proposed.goalId || null,
      storyId: enriched.storyId || proposed.storyId || null,
      taskId: enriched.taskId || proposed.taskId || null,
      habitId: enriched.habitId || proposed.habitId || null,
      updatedAt: now,
      createdAt: now
    });

    // Create scheduled_items doc if a linked entity exists
    let linkType = null, refId = null, linkTitle = null, linkUrl = enriched.linkUrl || null;
    if (enriched.taskId) { linkType = 'task'; refId = enriched.taskId; }
    else if (enriched.storyId) { linkType = 'story'; refId = enriched.storyId; }
    else if (enriched.habitId) { linkType = 'habit'; refId = enriched.habitId; }

    if (linkType && refId) {
      linkTitle = enriched.title || null;
      const schedRef = db.collection('scheduled_items').doc();
      batch.set(schedRef, {
        id: schedRef.id,
        ownerUid: uid,
        blockId: blockRef.id,
        type: linkType,
        refId: String(refId),
        title: linkTitle,
        linkUrl: linkUrl,
        createdAt: now,
        updatedAt: now
      });
    }
    createdCount += 1;
  }

  // Activity summary entry for this AI application
  batch.set(activityRef, {
    id: activityRef.id,
    entityId: 'calendar',
    entityType: 'calendar_block',
    activityType: 'calendar_ai_applied',
    userId: uid,
    description: `AI applied ${createdCount} calendar blocks`,
    source: 'ai',
    createdAt: now,
    updatedAt: now
  });

  await batch.commit();
  return createdCount;
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

async function importGoogleCalendarEvents(uid, { startDate, endDate }) {
  const db = admin.firestore();

  const events = await fetchGoogleCalendarEvents(uid, startDate, endDate);
  const seenDocIds = new Set();
  const seenEventIds = new Set();

  for (const event of events) {
    if (!event || !event.id) continue;
    const eventId = String(event.id);
    const docId = `${uid}_gcal_${Buffer.from(eventId).toString('base64url')}`;
    const docRef = db.collection('calendar_blocks').doc(docId);

    const startMs = event.start instanceof Date ? event.start.getTime() : null;
    const endMs = event.end instanceof Date ? event.end.getTime() : startMs;
    const startIso = startMs ? new Date(startMs).toISOString() : null;
    const endIso = endMs ? new Date(endMs).toISOString() : null;

    const payload = {
      ownerUid: uid,
      persona: 'personal',
      title: event.summary || 'Calendar Event',
      description: event.description || null,
      theme: 'Growth',
      category: 'Calendar',
      source: 'gcal',
      status: 'synced',
      createdBy: 'google',
      syncToGoogle: false,
      googleEventId: eventId,
      start: startMs,
      end: endMs,
      startISO: startIso,
      endISO: endIso,
      startTime: startIso,
      endTime: endIso,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      isAiGenerated: false,
      externalLink: event.htmlLink || null,
    };

    await docRef.set(payload, { merge: true });
    seenDocIds.add(docId);
    seenEventIds.add(eventId);

    // Deduplicate any stray blocks pointing to the same Google event
    try {
      const dupSnap = await db.collection('calendar_blocks')
        .where('ownerUid', '==', uid)
        .where('googleEventId', '==', eventId)
        .get();

      for (const dup of dupSnap.docs) {
        if (dup.id !== docId) {
          await dup.ref.delete();
        }
      }
    } catch (error) {
      console.warn(`[gcal-sync] failed duplicate cleanup for ${uid}/${eventId}`, error.message);
    }
  }

  // Remove stale Google-synced blocks that were not returned this run
  try {
    const existingSnap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', uid)
      .where('source', '==', 'gcal')
      .get();

    const deletions = [];
    existingSnap.forEach((doc) => {
      if (!seenDocIds.has(doc.id)) {
        deletions.push(doc.ref.delete());
      }
    });
    if (deletions.length) await Promise.allSettled(deletions);
  } catch (error) {
    console.warn(`[gcal-sync] failed stale cleanup for ${uid}`, error.message);
  }

  await db.collection('profiles').doc(uid).set({
    googleCalendarLastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    googleCalendarEventCount: seenDocIds.size,
  }, { merge: true });

  return { events: events.length, stored: seenDocIds.size };
}

// Scheduled: reconcile Google Calendar deletions for all users every 15 minutes
exports.reconcileAllCalendars = schedulerV2.onSchedule({ schedule: 'every 15 minutes', timeZone: 'UTC', secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (event) => {
  const db = admin.firestore();
  // Find users with Google tokens
  const snap = await db.collection('tokens').where('provider','==','google').get().catch(()=>null);
  if (!snap || snap.empty) return;
  const today = new Date();
  const work = [];
  for (const d of snap.docs) {
    const uid = d.id.split('_')[0] || d.id; // tokens doc is uid
    work.push((async () => {
      try {
        const dayKey = toDayKey(today);
        // Perform reconciliation similar to reconcilePlanFromGoogleCalendar
        const access = await getAccessToken(uid);
        const asSnap = await db.collection('plans').doc(dayKey).collection('assignments').where('ownerUid','==',uid).get();
        const toCheck = asSnap.docs.map(x=>({ id:x.id, ...(x.data()||{}) })).filter(a => a?.external?.googleEventId);
        for (const a of toCheck) {
          try {
            await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(a.external.googleEventId)}`, { headers: { 'Authorization': 'Bearer '+access } });
          } catch {
            await db.collection('plans').doc(dayKey).collection('assignments').doc(a.id)
              .set({ status:'deferred', external:{ googleEventId: null }, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          }
        }
      } catch {}
    })());
  }
  await Promise.allSettled(work);
});

exports.syncGoogleCalendarsHourly = schedulerV2.onSchedule({ schedule: 'every 60 minutes', timeZone: 'UTC', secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async () => {
  const db = admin.firestore();
  const tokensSnap = await db.collection('tokens').where('provider', '==', 'google').get().catch(() => null);
  if (!tokensSnap || tokensSnap.empty) return;

  const startDate = new Date(Date.now() - 6 * 60 * 60 * 1000); // past 6 hours to pick updates
  const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // next two weeks

  for (const doc of tokensSnap.docs) {
    const tokenId = doc.id;
    const uid = tokenId.includes('_') ? tokenId.split('_')[0] : tokenId;
    try {
      await importGoogleCalendarEvents(uid, { startDate, endDate });
    } catch (error) {
      console.warn(`[gcal-sync] hourly sync failed for ${uid}`, error.message);
    }
  }
});

// ===== Duplicate Detection for iOS Reminders (AC11 - Issue #124)
exports.detectDuplicateReminders = httpsV2.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  try {
    const db = admin.firestore();
    const snap = await db.collection('tasks').where('ownerUid', '==', uid).get();
    const crypto = require('crypto');
    const tasks = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    const reminderTasks = tasks.filter(t => t.source === 'ios_reminder');
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const hash = (s) => crypto.createHash('sha1').update(String(s || '')).digest('hex');
    const groups = new Map();

    for (const t of reminderTasks) {
      const key1 = t.reminderId ? `rid:${t.reminderId}` : null;
      const key2 = `title:${norm(t.title)}|src:${norm(t.sourceRef || '')}`;
      const key3 = `title:${norm(t.title)}|hash:${hash((t.description || '') + '|' + JSON.stringify(t.checklist || []))}`;
      for (const k of [key1, key2, key3].filter(Boolean)) {
        if (!groups.has(k)) groups.set(k, new Set());
        groups.get(k).add(t.id);
      }
    }

    let created = 0;
    for (const [k, idSet] of groups.entries()) {
      const ids = Array.from(idSet);
      if (ids.length < 2) continue;
      const docId = `dup_${uid}_${hash(k)}`;
      await db.collection('potential_duplicates').doc(docId).set({
        id: docId,
        ownerUid: uid,
        key: k,
        method: k.startsWith('rid:') ? 'reminderId' : (k.includes('|src:') ? 'title+sourceRef' : 'title+hash'),
        taskIds: ids,
        count: ids.length,
        status: 'open',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      created += 1;
    }

    return { groupsCreated: created };
  } catch (e) {
    console.error('detectDuplicateReminders error:', e);
    throw new httpsV2.HttpsError('internal', e.message);
  }
});

// ===== LLM Provider Helpers (Google AI Studio or OpenAI)
async function callLLMJson({ system, user, purpose, userId, expectJson = false, temperature = 0.2 }) {
  const preferGemini = !!process.env.GOOGLEAISTUDIOAPIKEY;
  const attempts = 3; // initial + 2 retries
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      if (preferGemini) {
        const text = await callGemini({ system, user, expectJson, temperature });
        // lightweight usage log
        const wrapped = aiUsageLogger.wrapAICall('google-ai-studio', 'gemini-1.5-flash');
        await wrapped(async () => ({ ok: true }), { userId, functionName: purpose, purpose });
        return text;
      } else {
        return await callOpenAI({ system, user, expectJson, temperature, userId, purpose });
      }
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
  if (expectJson) return '{}';
  throw lastErr || new Error('LLM unavailable');
}

async function callGemini({ system, user, expectJson, temperature }) {
  const apiKey = process.env.GOOGLEAISTUDIOAPIKEY;
  if (!apiKey) throw new Error('GOOGLEAISTUDIOAPIKEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
    generationConfig: Object.assign({}, expectJson ? { responseMimeType: 'application/json' } : {}, { temperature: temperature ?? 0.2 })
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text).join('');
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

async function callOpenAI({ system, user, expectJson, temperature, userId, purpose }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const requestData = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: temperature ?? 0.2,
    ...(expectJson ? { response_format: { type: 'json_object' } } : {})
  };
  const aiWrapper = aiUsageLogger.wrapAICall('openai', 'gpt-4o-mini');
  const resp = await aiWrapper(() => openai.chat.completions.create(requestData), { userId, functionName: purpose, request: requestData, purpose });
  return resp?.choices?.[0]?.message?.content || '';
}

// ===== Strava Helpers
async function getStravaTokenDoc(uid) {
  const db = admin.firestore();
  const snap = await db.collection('tokens').doc(`${uid}_strava`).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function getStravaAccessToken(uid) {
  const db = admin.firestore();
  const doc = await getStravaTokenDoc(uid);
  if (!doc) throw new Error('Strava not connected for this user');
  const nowSec = Math.floor(Date.now() / 1000);
  if (doc.access_token && doc.expires_at && doc.expires_at > nowSec + 60) {
    return doc.access_token;
  }
  // Refresh token
  const refreshed = await fetchJson("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: doc.refresh_token,
    }).toString(),
  });
  const tokenRef = db.collection('tokens').doc(`${uid}_strava`);
  await tokenRef.set({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || doc.refresh_token,
    expires_at: refreshed.expires_at,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return refreshed.access_token;
}

async function upsertWorkout(uid, activity) {
  const db = admin.firestore();
  const activityId = String(activity.id);
  const docId = `${uid}_${activityId}`;
  const ref = db.collection('metrics_workouts').doc(docId);
  const payload = {
    id: docId,
    ownerUid: uid,
    provider: 'strava',
    stravaActivityId: activityId,
    name: activity.name,
    type: activity.type,
    startDate: new Date(activity.start_date).getTime(),
    utcStartDate: new Date(activity.start_date).toISOString(),
    distance_m: activity.distance || null,
    movingTime_s: activity.moving_time || null,
    elapsedTime_s: activity.elapsed_time || null,
    elevationGain_m: activity.total_elevation_gain || null,
    averageSpeed_mps: activity.average_speed || null,
    maxSpeed_mps: activity.max_speed || null,
    avgHeartrate: activity.average_heartrate || null,
    maxHeartrate: activity.max_heartrate || null,
    hasHeartrate: !!(activity.has_heartrate || activity.average_heartrate || activity.max_heartrate),
    calories: activity.calories || null,
    commute: activity.commute || false,
    gearId: activity.gear_id || null,
    isTrainer: activity.trainer || false,
    isCommute: activity.commute || false,
    isManual: activity.manual || false,
    visibility: activity.visibility || null,
    source: 'strava',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(payload, { merge: true });
  return docId;
}

async function fetchStravaActivities(uid, { afterSec = null, perPage = 100, maxPages = 3 } = {}) {
  const accessToken = await getStravaAccessToken(uid);
  let page = 1;
  let total = 0;
  let lastDocId = null;
  while (page <= maxPages) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
    });
    if (afterSec) params.append('after', String(afterSec));
    const url = `https://www.strava.com/api/v3/athlete/activities?${params.toString()}`;
    const rows = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const act of rows) {
      lastDocId = await upsertWorkout(uid, act);
      total += 1;
    }
    if (rows.length < perPage) break;
    page += 1;
  }
  const db = admin.firestore();
  await db.collection('profiles').doc(uid).set({ stravaLastSyncAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, imported: total, lastDocId };
}

// Callable to sync Strava activities
exports.syncStrava = httpsV2.onCall({ secrets: [STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const after = req.data?.after || null; // ms or sec accepted
  let afterSec = null;
  if (after) {
    afterSec = (String(after).length > 10) ? Math.floor(Number(after) / 1000) : Number(after);
  }
  console.log('[syncStrava] uid', req.auth.uid, 'after', after, 'afterSec', afterSec);
  return await fetchStravaActivities(req.auth.uid, { afterSec });
});

// Retrieve HR stream for an activity and compute zone times; store on metrics_workouts doc
async function getUserMaxHr(uid) {
  const prof = await admin.firestore().collection('profiles').doc(uid).get();
  const d = prof.exists ? prof.data() : {};
  const maxHr = Number(d?.maxHr) || null;
  if (maxHr) return maxHr;
  const age = Number(d?.age || (d?.birthYear ? (new Date().getFullYear() - Number(d.birthYear)) : null)) || null;
  return age ? Math.round(220 - age) : 190; // fallback
}

function hrZonesFromMax(maxHr) {
  return [
    { name: 'Z1', min: 0.50*maxHr, max: 0.60*maxHr },
    { name: 'Z2', min: 0.60*maxHr, max: 0.70*maxHr },
    { name: 'Z3', min: 0.70*maxHr, max: 0.80*maxHr },
    { name: 'Z4', min: 0.80*maxHr, max: 0.90*maxHr },
    { name: 'Z5', min: 0.90*maxHr, max: 1.00*maxHr + 1 },
  ];
}

async function enrichActivityHr(uid, activityId) {
  const db = admin.firestore();
  const docId = `${uid}_${activityId}`;
  const ref = db.collection('metrics_workouts').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'not_found' };
  const data = snap.data();
  if (data.hrZones && data.hrZones.z1Time_s != null) return { ok: true, reason: 'already_enriched' };

  const accessToken = await getStravaAccessToken(uid);
  let streams;
  try {
    const url = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=time,heartrate&key_by_type=true`;
    streams = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (e) {
    // If fails (permissions), skip quietly
    return { ok: false, reason: 'no_streams' };
  }
  const hr = Array.isArray(streams?.heartrate?.data) ? streams.heartrate.data : null;
  const tm = Array.isArray(streams?.time?.data) ? streams.time.data : null;
  if (!hr || !tm || hr.length === 0) return { ok: false, reason: 'empty_stream' };

  const maxHr = await getUserMaxHr(uid);
  const zones = hrZonesFromMax(maxHr);
  const totals = { z1Time_s:0, z2Time_s:0, z3Time_s:0, z4Time_s:0, z5Time_s:0 };
  for (let i=1; i<tm.length; i++) {
    const dt = Math.max(1, (tm[i] - tm[i-1]));
    const h = hr[Math.min(i, hr.length-1)];
    const zIdx = zones.findIndex(z => h >= z.min && h < z.max);
    if (zIdx === 0) totals.z1Time_s += dt;
    else if (zIdx === 1) totals.z2Time_s += dt;
    else if (zIdx === 2) totals.z3Time_s += dt;
    else if (zIdx === 3) totals.z4Time_s += dt;
    else totals.z5Time_s += dt;
  }
  await ref.set({ hrZones: totals, maxHrUsed: maxHr }, { merge: true });
  return { ok: true, hrZones: totals };
}

// Enrich recent Strava runs with HR zone breakdown
exports.enrichStravaHR = httpsV2.onCall({ secrets: [STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const days = Math.min(Number(req.data?.days || 30), 365);
  console.log('[enrichStravaHR] uid', uid, 'days', days);
  const since = Date.now() - days*24*60*60*1000;
  const db = admin.firestore();
  const q = await db.collection('metrics_workouts')
    .where('ownerUid', '==', uid)
    .where('provider', '==', 'strava')
    .get();
  let enriched = 0, scanned = 0;
  for (const d of q.docs) {
    const w = d.data();
    if ((w.startDate||0) < since) continue;
    if (!w.hasHeartrate && !w.avgHeartrate) continue;
    scanned++;
    const actId = String(w.stravaActivityId || '').trim();
    if (!actId) continue;
    const r = await enrichActivityHr(uid, actId).catch(()=>null);
    if (r?.ok) enriched++;
  }
  return { ok: true, enriched, scanned };
});

// Strava Webhook endpoint (verification + events)
exports.stravaWebhook = httpsV2.onRequest({ secrets: [STRAVA_WEBHOOK_VERIFY_TOKEN, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET], invoker: 'public' }, async (req, res) => {
  try {
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode !== 'subscribe') return res.status(400).send('Invalid mode');
      if (String(token) !== String(process.env.STRAVA_WEBHOOK_VERIFY_TOKEN)) return res.status(403).send('Invalid verify token');
      return res.status(200).json({ 'hub.challenge': challenge });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.object_type === 'activity') {
        const athleteId = String(body.owner_id);
        const aspect = String(body.aspect_type);
        // Find user by athleteId
        const db = admin.firestore();
        const q = await db.collection('tokens').where('provider', '==', 'strava').where('athleteId', '==', Number(athleteId)).limit(1).get();
        if (!q.empty) {
          const uid = q.docs[0].data().ownerUid;
          if (aspect === 'create' || aspect === 'update') {
            // Fetch single activity details
            try {
              const accessToken = await getStravaAccessToken(uid);
              const act = await fetchJson(`https://www.strava.com/api/v3/activities/${body.object_id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
              await upsertWorkout(uid, act);
            } catch (e) {
              console.error('Failed to upsert Strava activity from webhook:', e);
            }
          } else if (aspect === 'delete') {
            const docId = `${uid}_${body.object_id}`;
            await db.collection('metrics_workouts').doc(docId).delete().catch(()=>{});
          }
        } else {
          console.warn('Webhook for unknown Strava athlete:', athleteId);
        }
      }
      return res.status(200).json({ received: true });
    }
    return res.status(405).send('Method not allowed');
  } catch (e) {
    console.error('Strava webhook error:', e);
    return res.status(500).send('Server error');
  }
});
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

async function _syncParkrunInternal(uid, athleteId, countryBaseUrl) {
  const base = countryBaseUrl || 'https://www.parkrun.org.uk';
  const url = `${base}/results/athleteeventresultshistory/?athleteNumber=${encodeURIComponent(athleteId)}&eventNumber=0`;
  const html = await (await fetch(url)).text();
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  let rows = [];
  $('table#results tbody tr').each((_, el) => rows.push(el));
  if (rows.length === 0) {
    $('table tbody tr').each((_, el) => rows.push(el));
  }
  const db = admin.firestore();
  let imported = 0;
  const slugify = (s)=> String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

  async function getParticipantsFromResultUrl(href) {
    if (!href) return { participants: null, resultUrl: null, runSeq: null };
    let full = href.startsWith('http') ? href : (href.startsWith('/') ? `https://www.parkrun.org.uk${href}` : `${base}/${href}`);
    try {
      const page = await (await fetch(full)).text();
      const $p = cheerio.load(page);
      const count = $p('table#results tbody tr').length;
      const m = full.match(/\/results\/(\d+)/);
      const runSeq = m ? Number(m[1]) : null;
      return { participants: count || null, resultUrl: full, runSeq };
    } catch { return { participants: null, resultUrl: null, runSeq: null }; }
  }
  for (const el of rows) {
    const tds = $(el).find('td');
    if (tds.length < 5) continue;
    const dateText = $(tds[0]).text().trim();
    const eventCell = $(tds[1]);
    const eventText = eventCell.text().trim();
    const eventHref = eventCell.find('a').attr('href') || '';
    const timeText = $(tds[2]).text().trim();
    const positionText = $(tds[3]).text().trim();
    const ageGradeText = $(tds[4]).text().trim();
    const ageCatText = tds.length >= 6 ? $(tds[5]).text().trim() : null;
    if (!dateText || !eventText || !timeText) continue;
    let dateMs = Date.parse(dateText);
    if (isNaN(dateMs)) {
      const m = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) {
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        dateMs = d.getTime();
      }
    }
    if (!dateMs || isNaN(dateMs)) continue;
    let secs = 0;
    const parts = timeText.split(':').map(x => Number(x));
    if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    else continue;
    const eventSlug = slugify(eventText);
    const docId = `${uid}_parkrun_${new Date(dateMs).toISOString().slice(0,10)}_${eventSlug}`;
    // Try to derive participants from a direct result URL if the row links to it
    let participantsCount = null; let eventResultUrl = null; let eventRunSeqNumber = null;
    if (eventHref && /\/results\//.test(eventHref)) {
      const info = await getParticipantsFromResultUrl(eventHref);
      participantsCount = info.participants;
      eventResultUrl = info.resultUrl;
      eventRunSeqNumber = info.runSeq;
    }

    const payload = {
      id: docId,
      ownerUid: uid,
      provider: 'parkrun',
      parkrunAthleteId: athleteId,
      event: eventText,
      eventSlug,
      eventResultUrl: eventResultUrl || null,
      eventRunSeqNumber: eventRunSeqNumber || null,
      name: `parkrun ${eventText}`,
      type: 'Run',
      startDate: dateMs,
      utcStartDate: new Date(dateMs).toISOString(),
      elapsedTime_s: secs,
      movingTime_s: secs,
      distance_m: 5000,
      position: positionText ? Number(positionText) || null : null,
      ageGrade: ageGradeText || null,
      ageCategory: ageCatText || null,
      participantsCount: participantsCount || null,
      percentileTop: (participantsCount && positionText) ? Number((((participantsCount - (Number(positionText)||0) + 1)/participantsCount)*100).toFixed(2)) : null,
      source: 'parkrun',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection('metrics_workouts').doc(docId).set(payload, { merge: true });
    imported += 1;
  }
  await db.collection('profiles').doc(uid).set({ parkrunAthleteId: athleteId, parkrunLastSyncAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, imported };
}

// ===== Parkrun Sync (HTML parse)
exports.syncParkrun = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const uid = req.auth.uid;
  let { athleteId, profileUrl, countryBaseUrl } = req.data || {};
  console.log('[syncParkrun] uid', uid, 'athleteId', athleteId, 'profileUrl?', !!profileUrl, 'base?', countryBaseUrl);
  athleteId = (athleteId || '').toString().trim();
  profileUrl = (profileUrl || '').toString().trim();
  countryBaseUrl = (countryBaseUrl || '').toString().trim();
  if (!athleteId && profileUrl) {
    const match1 = profileUrl.match(/athleteNumber=(\d+)/i);
    const match2 = profileUrl.match(/parkrunner\/(\d+)/i);
    athleteId = match1?.[1] || match2?.[1] || '';
  }
  if (!athleteId) {
    throw new httpsV2.HttpsError('invalid-argument', 'Provide Parkrun athleteId or profileUrl containing athleteNumber.');
  }
  return await _syncParkrunInternal(uid, athleteId, countryBaseUrl);
});

// Fitness Overview aggregator
exports.getFitnessOverview = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const days = Math.min(Number(req.data?.days || 90), 365);
  return await _getFitnessOverview(uid, days);
});

async function _getFitnessOverview(uid, days) {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const db = admin.firestore();
  const workoutsSnap = await db.collection('metrics_workouts').where('ownerUid', '==', uid).limit(1000).get();
  const workouts = workoutsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(w => (w.startDate || 0) >= sinceMs && (w.provider === 'strava' || w.provider === 'parkrun'))
    .sort((a,b) => (a.startDate||0) - (b.startDate||0));
  const hrvSnap = await db.collection('metrics_hrv').where('ownerUid', '==', uid).limit(1000).get();
  const hrv = hrvSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(x => {
      const t = x.timestamp || x.date || x.day || x.measuredAt || null;
      const ms = typeof t === 'number' ? (t > 1e12 ? t : t*1000) : (t?.toMillis ? t.toMillis() : (Date.parse(t) || null));
      x._ms = ms;
      return ms && ms >= sinceMs;
    })
    .sort((a,b) => a._ms - b._ms);
  const km = (m)=> (typeof m === 'number' ? m/1000 : 0);
  const sec = (s)=> (typeof s === 'number' ? s : 0);
  const weekly = new Map();
  let totalKm = 0, totalSec = 0, sessions = 0;
  for (const w of workouts) {
    const d = new Date(w.startDate || Date.now());
    const ws = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    ws.setUTCDate(ws.getUTCDate() - ws.getUTCDay());
    const key = ws.toISOString().slice(0,10);
    const dist = km(w.distance_m);
    const time = sec(w.movingTime_s || w.elapsedTime_s);
    const agg = weekly.get(key) || { distanceKm:0, timeSec:0, sessions:0 };
    agg.distanceKm += dist; agg.timeSec += time; agg.sessions += 1;
    weekly.set(key, agg); totalKm += dist; totalSec += time; sessions += 1;
  }
  const since30 = Date.now() - 30*24*60*60*1000;
  const last30 = workouts.filter(w => (w.startDate||0) >= since30);
  const dist30 = last30.reduce((s,w)=> s + km(w.distance_m), 0);
  const time30 = last30.reduce((s,w)=> s + sec(w.movingTime_s || w.elapsedTime_s), 0);
  const avgPaceMinPerKm = dist30 > 0 ? (time30/60) / dist30 : null;
  const toVal = (x)=> Number(x?.value ?? x?.rMSSD ?? x?.hrv ?? null) || null;
  const last7Ms = Date.now() - 7*24*60*60*1000;
  const last30Ms = since30;
  const hrvLast7 = hrv.filter(x => x._ms >= last7Ms).map(toVal).filter(Boolean);
  const hrvLast30 = hrv.filter(x => x._ms >= last30Ms).map(toVal).filter(Boolean);
  const avg = (arr)=> arr.length? (arr.reduce((a,b)=>a+b,0)/arr.length): null;
  const hrv7 = avg(hrvLast7);
  const hrv30 = avg(hrvLast30);
  const hrvTrendPct = (hrv7 && hrv30) ? ((hrv7 - hrv30) / hrv30) * 100 : null;
  const weeks = Array.from(weekly.values());
  const recentWeeks = weeks.slice(-4);
  const volKm = recentWeeks.reduce((s,x)=> s + x.distanceKm, 0) / Math.max(recentWeeks.length,1);
  const volScore = Math.max(0, Math.min(1, volKm / 50));
  const hrvScore = (hrvTrendPct == null) ? 0.5 : Math.max(0, Math.min(1, (hrvTrendPct + 10) / 20));
  const fitnessScore = Math.round((volScore*0.6 + hrvScore*0.4) * 100);
  const zoneTotals = { z1Time_s:0, z2Time_s:0, z3Time_s:0, z4Time_s:0, z5Time_s:0 };
  for (const w of workouts) {
    if (w.hrZones) {
      zoneTotals.z1Time_s += Number(w.hrZones.z1Time_s||0);
      zoneTotals.z2Time_s += Number(w.hrZones.z2Time_s||0);
      zoneTotals.z3Time_s += Number(w.hrZones.z3Time_s||0);
      zoneTotals.z4Time_s += Number(w.hrZones.z4Time_s||0);
      zoneTotals.z5Time_s += Number(w.hrZones.z5Time_s||0);
    }
  }
  return {
    rangeDays: days,
    totals: { distanceKm: Number(totalKm.toFixed(2)), timeHours: Number((totalSec/3600).toFixed(2)), sessions },
    last30: { distanceKm: Number(dist30.toFixed(2)), avgPaceMinPerKm: avgPaceMinPerKm ? Number(avgPaceMinPerKm.toFixed(2)) : null, workouts: last30.length },
    hrv: { last7Avg: hrv7 ? Number(hrv7.toFixed(1)) : null, last30Avg: hrv30 ? Number(hrv30.toFixed(1)) : null, trendPct: hrvTrendPct != null ? Number(hrvTrendPct.toFixed(1)) : null },
    hrZones: zoneTotals,
    weekly: Array.from(weekly.entries()).map(([weekStart, w]) => ({ weekStart, ...w, paceMinPerKm: w.distanceKm>0 ? Number(((w.timeSec/60)/w.distanceKm).toFixed(2)) : null })),
    fitnessScore
  };
}

// Correlate Parkrun 5k times with Strava HR data to estimate fitness/effort relationship
exports.getRunFitnessAnalysis = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const days = Math.min(Number(req.data?.days || 180), 730);
  return await _getRunFitnessAnalysis(uid, days);
});

// Enable automation defaults for the authenticated user
exports.enableFitnessAutomationDefaults = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const db = admin.firestore();

  // Try to infer defaults from existing Parkrun docs
  let defaultSlug = null;
  let defaultRunSeq = null;
  try {
    const snap = await db.collection('metrics_workouts')
      .where('ownerUid','==',uid)
      .where('provider','==','parkrun')
      .orderBy('startDate','desc')
      .limit(1)
      .get();
    if (!snap.empty) {
      const d = snap.docs[0].data();
      defaultSlug = d.eventSlug || null;
      defaultRunSeq = d.eventRunSeqNumber || null;
    }
  } catch {}

  const payload = {
    stravaAutoSync: true,
    parkrunAutoSync: true,
    parkrunAutoComputePercentiles: true,
    autoEnrichStravaHR: true,
    autoComputeFitnessMetrics: true,
  };
  if (defaultSlug && defaultRunSeq) {
    payload['parkrunDefaultEventSlug'] = defaultSlug;
    payload['parkrunDefaultStartRun'] = defaultRunSeq;
  }

  await db.collection('profiles').doc(uid).set(payload, { merge: true });
  return { ok: true, defaults: payload };
});

// Backward-compatibility stub for legacy function present in project
exports.generateGoalStoriesAndKPIs = httpsV2.onCall(async (req) => {
  return { ok: true, message: 'Legacy stub active' };
});

async function _getRunFitnessAnalysis(uid, days) {
  const sinceMs = Date.now() - days*24*60*60*1000;
  const db = admin.firestore();
  const wSnap = await db.collection('metrics_workouts').where('ownerUid','==',uid).get();
  const all = wSnap.docs.map(d=>({ id:d.id, ...d.data() }));
  const parkruns = all.filter(x => x.provider==='parkrun' && (x.startDate||0) >= sinceMs);
  const runs = all.filter(x => x.provider==='strava' && (x.startDate||0) >= sinceMs && (x.type==='Run' || x.run===true));
  const pairs = [];
  for (const p of parkruns) {
    const pStart = p.startDate || 0;
    const rCandidates = runs.filter(r => Math.abs((r.startDate||0)-pStart) <= 12*3600*1000);
    let best = null, bestScore = 1e12;
    for (const r of rCandidates) {
      const dist = Number(r.distance_m||0);
      const dScore = Math.abs(dist - 5000) + Math.abs((r.startDate||0) - pStart)/1000;
      if (dScore < bestScore) { best = r; bestScore = dScore; }
    }
    if (best) pairs.push({ parkrun: p, strava: best });
  }
  const xs = [], ys = [];
  let zoneAgg = { z1Time_s:0, z2Time_s:0, z3Time_s:0, z4Time_s:0, z5Time_s:0 };
  for (const pair of pairs) {
    const timeSec = Number(pair.parkrun.elapsedTime_s || pair.parkrun.movingTime_s || 0);
    const avgHr = Number(pair.strava.avgHeartrate || 0);
    if (timeSec>0 && avgHr>0) { xs.push(timeSec); ys.push(avgHr); }
    if (pair.strava.hrZones) {
      zoneAgg.z1Time_s += Number(pair.strava.hrZones.z1Time_s||0);
      zoneAgg.z2Time_s += Number(pair.strava.hrZones.z2Time_s||0);
      zoneAgg.z3Time_s += Number(pair.strava.hrZones.z3Time_s||0);
      zoneAgg.z4Time_s += Number(pair.strava.hrZones.z4Time_s||0);
      zoneAgg.z5Time_s += Number(pair.strava.hrZones.z5Time_s||0);
    }
  }
  function pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (!n) return null;
    const mx = x.reduce((a,b)=>a+b,0)/n;
    const my = y.reduce((a,b)=>a+b,0)/n;
    let num=0, dx=0, dy=0;
    for (let i=0;i<n;i++){ const a=x[i]-mx, b=y[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
    const den = Math.sqrt(dx*dy);
    return den? num/den : null;
  }
  const corr = pearson(xs, ys);
  const byMonth = new Map();
  for (const p of parkruns) {
    const d = new Date(p.startDate || Date.now());
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
    const arr = byMonth.get(key) || [];
    arr.push(Number(p.elapsedTime_s || p.movingTime_s || 0));
    byMonth.set(key, arr);
  }
  const monthly = Array.from(byMonth.entries()).map(([month, arr])=>{
    const sorted = arr.filter(Boolean).sort((a,b)=>a-b);
    const med = sorted.length? sorted[Math.floor(sorted.length/2)] : null;
    return { month, parkrunMedianSec: med };
  }).sort((a,b)=> a.month.localeCompare(b.month));
  return {
    pairs: pairs.map(p => ({
      parkrun: { date: new Date(p.parkrun.startDate).toISOString(), timeSec: p.parkrun.elapsedTime_s || p.parkrun.movingTime_s, position: p.parkrun.position || null, participants: p.parkrun.participantsCount || null, percentileTop: p.parkrun.percentileTop || null, ageGrade: p.parkrun.ageGrade || null },
      strava: { activityId: p.strava.stravaActivityId, avgHeartrate: p.strava.avgHeartrate || null, hrZones: p.strava.hrZones || null }
    })),
    correlationTimeVsAvgHR: corr,
    hrZonesAggregate: zoneAgg,
    monthly
  };
}

// Compute participants and percentile by scanning event results pages backwards
exports.computeParkrunPercentiles = httpsV2.onCall(async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const eventSlug = String(req.data?.eventSlug || '').trim().toLowerCase();
  const startRun = Number(req.data?.startRun || 0);
  const base = String(req.data?.baseUrl || 'https://www.parkrun.org.uk').trim().replace(/\/$/, '');
  const maxBack = Math.min(Number(req.data?.maxBack || 120), 500);
  const onlyMissing = !!req.data?.onlyMissing;
  console.log('[computeParkrunPercentiles] uid', uid, 'eventSlug', eventSlug, 'startRun', startRun, 'maxBack', maxBack);
  if (!eventSlug || !startRun) {
    throw new httpsV2.HttpsError('invalid-argument', 'eventSlug and startRun are required');
  }
  return await _computeParkrunPercentilesInternal(uid, { eventSlug, startRun, base, maxBack, onlyMissing });
});

async function _computeParkrunPercentilesInternal(uid, { eventSlug, startRun, base = 'https://www.parkrun.org.uk', maxBack = 120, onlyMissing = false }) {
  const cheerio = require('cheerio');
  function dateOnly(ms) {
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  function sameDay(aMs, bMs) { return dateOnly(aMs).getTime() === dateOnly(bMs).getTime(); }

  async function fetchRun(runNum) {
    const url = `${String(base).replace(/\/$/,'')}/${eventSlug}/results/${runNum}`;
    const html = await (await fetch(url)).text();
    const $ = cheerio.load(html);
    const contentText = $('#content').text() || $('body').text();
    let dateMs = null;
    const m = contentText.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
    if (m) { const parsed = Date.parse(m[1]); if (!isNaN(parsed)) dateMs = parsed; }
    if (!dateMs) {
      const t = $('time').first().attr('datetime') || $('time').first().text();
      const parsed = Date.parse(t || '');
      if (!isNaN(parsed)) dateMs = parsed;
    }
    const participants = $('table#results tbody tr').length || null;
    return { runNum, url, dateMs, participants };
  }

  const db = admin.firestore();
  const snap = await db.collection('metrics_workouts').where('ownerUid','==',uid).where('provider','==','parkrun').get();
  const items = snap.docs.map(d=>({ id:d.id, ref:d.ref, ...d.data() }));
  const slugify = (s)=> String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const targets = items.filter(x => (x.eventSlug ? x.eventSlug === eventSlug : slugify(x.event) === eventSlug));

  let updated = 0, examined = 0;
  for (const w of targets) {
    examined++;
    if (onlyMissing && w.participantsCount) continue;
    const targetMs = w.startDate || 0;
    let found = null;
    for (let i=0; i<maxBack; i++) {
      const runNum = startRun - i;
      if (runNum <= 0) break;
      let info;
      try { info = await fetchRun(runNum); } catch { continue; }
      if (info.dateMs && sameDay(info.dateMs, targetMs)) { found = info; break; }
      if (info.dateMs && info.dateMs < (targetMs - 14*24*60*60*1000)) break;
    }
    if (found && found.participants && w.position) {
      const percentileTop = Number((((found.participants - (Number(w.position)||0) + 1)/found.participants)*100).toFixed(2));
      await w.ref.set({
        participantsCount: found.participants,
        percentileTop,
        eventResultUrl: found.url,
        eventRunSeqNumber: found.runNum,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      updated++;
    }
  }
  return { ok: true, examined, updated };
}

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

// Update an existing Google Calendar event (summary/start/end minimal patch)
exports.updateCalendarEvent = httpsV2.onCall({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const { eventId, summary, start, end } = req.data || {};
  if (!eventId) throw new httpsV2.HttpsError("invalid-argument", "eventId required");
  const access = await getAccessToken(req.auth.uid);
  const body = {};
  if (summary) body.summary = summary;
  if (start) body.start = { dateTime: start };
  if (end) body.end = { dateTime: end };
  const ev = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "Authorization": "Bearer " + access, "Content-Type": "application/json" },
    body: JSON.stringify(body)
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

// Delete a Google Calendar event
exports.deleteCalendarEvent = httpsV2.onCall({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const { eventId } = req.data || {};
  if (!eventId) throw new httpsV2.HttpsError("invalid-argument", "eventId required");
  const access = await getAccessToken(req.auth.uid);
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + access }
  });
  return { ok: true };
});

// Sync plan assignments for a day to Google Calendar as child events under parent block events
exports.syncPlanToGoogleCalendar = httpsV2.onCall({ secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const uid = req.auth.uid;
  const day = req?.data?.day || new Date().toISOString().slice(0,10);
  const date = new Date(day);
  if (isNaN(date.getTime())) throw new httpsV2.HttpsError('invalid-argument', 'Invalid day');
  const dayKey = toDayKey(date);
  const access = await getAccessToken(uid);
  const db = admin.firestore();

  // Load assignments for the day
  const asSnap = await db.collection('plans').doc(dayKey).collection('assignments').where('ownerUid','==',uid).get();
  const assignments = asSnap.docs.map(d => ({ id:d.id, ...(d.data()||{}) }));
  if (assignments.length === 0) return { ok: true, created: 0, updated: 0, parentsCreated: 0 };

  // Group by blockId
  const byBlock = new Map();
  for (const a of assignments) {
    const key = a.blockId || 'none';
    if (!byBlock.has(key)) byBlock.set(key, []);
    byBlock.get(key).push(a);
  }

  let parentsCreated = 0, created = 0, updated = 0;
  for (const [blockId, list] of byBlock.entries()) {
    let parentEventId = null;
    let blockDoc = null;
    if (blockId && blockId !== 'none') {
      const bSnap = await db.collection('calendar_blocks').doc(blockId).get();
      if (bSnap.exists) {
        blockDoc = { id: bSnap.id, ...(bSnap.data()||{}) };
        parentEventId = blockDoc.googleEventId || null;
      }
      // Create parent block event if missing
      if (!parentEventId && blockDoc) {
        const body = {
          summary: blockDoc.title || `${blockDoc.theme || 'Block'}: ${blockDoc.category || ''}`.trim(),
          description: blockDoc.rationale || 'BOB block',
          start: { dateTime: new Date(blockDoc.start).toISOString() },
          end: { dateTime: new Date(blockDoc.end).toISOString() },
          extendedProperties: { private: { bobBlockId: blockId } }
        };
        const parent = await fetchJson('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + access, 'Content-Type':'application/json' }, body: JSON.stringify(body)
        });
        parentEventId = parent.id;
        parentsCreated++;
        await db.collection('calendar_blocks').doc(blockId).set({ googleEventId: parentEventId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    for (const a of list) {
      if (!a.start || !a.end) continue; // skip deferred/unscheduled
      const ext = a.external || {};
      const eid = ext.googleEventId || null;
      const evBody = {
        summary: a.title || 'Assignment',
        start: { dateTime: new Date(a.start).toISOString() },
        end: { dateTime: new Date(a.end).toISOString() },
        description: 'BOB assignment',
        extendedProperties: { private: { bobAssignmentId: a.id, bobBlockId: blockId || '' } }
      };
      if (eid) {
        try {
          await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eid)}`, {
            method: 'PATCH', headers: { 'Authorization': 'Bearer ' + access, 'Content-Type':'application/json' }, body: JSON.stringify(evBody)
          });
          updated++;
        } catch {
          // If patch fails (deleted externally), recreate
          const createdEv = await fetchJson('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + access, 'Content-Type':'application/json' }, body: JSON.stringify(evBody)
          });
          created++;
          await db.collection('plans').doc(dayKey).collection('assignments').doc(a.id).set({ external: { ...(a.external||{}), googleEventId: createdEv.id } }, { merge: true });
        }
      } else {
        const createdEv = await fetchJson('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + access, 'Content-Type':'application/json' }, body: JSON.stringify(evBody)
        });
        created++;
        await db.collection('plans').doc(dayKey).collection('assignments').doc(a.id).set({ external: { ...(a.external||{}), googleEventId: createdEv.id } }, { merge: true });
      }
    }
  }
  return { ok: true, parentsCreated, created, updated };
});

// iOS Reminders bridge (public HTTPS): Shortcuts can call these endpoints
exports.remindersPush = httpsV2.onRequest({ secrets: [REMINDERS_WEBHOOK_SECRET], invoker: 'public' }, async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('Method not allowed');
    const uid = String(req.query.uid || req.body?.uid || '');
    const secret = process.env.REMINDERS_WEBHOOK_SECRET;
    const provided = String(req.headers['x-reminders-secret'] || req.query.secret || req.body?.secret || '');
    if (!uid) return res.status(400).json({ error: 'uid required' });
    if (secret && provided !== secret) return res.status(403).json({ error: 'forbidden' });
    const db = admin.firestore();
    // Return tasks that need pushing: no reminderId and due today or overdue
    const now = Date.now();
    const start = new Date(); start.setHours(0,0,0,0);
    const tasksSnap = await db.collection('tasks').where('ownerUid','==',uid).get();
    const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...(d.data()||{}) }));
    const toPush = tasks.filter(t => !t.reminderId && t.status !== 2 && ((t.dueDate||0) <= (start.getTime()+24*3600*1000)));
    const payload = toPush.map(t => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate || null,
      ref: `TK-${String(t.id||'').slice(0,6).toUpperCase()}`,
      createdAt: t.createdAt || null,
      storyId: t.storyId || null,
      goalId: t.goalId || null
    }));
    return res.json({ ok: true, tasks: payload });
  } catch (e) {
    console.error('remindersPush error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

exports.remindersPull = httpsV2.onRequest({ secrets: [REMINDERS_WEBHOOK_SECRET], invoker: 'public' }, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    const uid = String(req.query.uid || req.body?.uid || '');
    const secret = process.env.REMINDERS_WEBHOOK_SECRET;
    const provided = String(req.headers['x-reminders-secret'] || req.query.secret || req.body?.secret || '');
    if (!uid) return res.status(400).json({ error: 'uid required' });
    if (secret && provided !== secret) return res.status(403).json({ error: 'forbidden' });
    const updates = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const db = admin.firestore();
    let updated = 0;
    for (const u of updates) {
      const id = String(u.id || '');
      const reminderId = u.reminderId ? String(u.reminderId) : null;
      const completed = !!u.completed;
      if (!id && !reminderId) continue;
      let ref = null;
      if (id) ref = db.collection('tasks').doc(id);
      else {
        const snap = await db.collection('tasks').where('ownerUid','==',uid).where('reminderId','==',reminderId).limit(1).get();
        if (!snap.empty) ref = snap.docs[0].ref;
      }
      if (ref) {
        const data = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (reminderId) data['reminderId'] = reminderId;
        if (completed) data['status'] = 2;
        await ref.set(data, { merge: true });
        updated++;
      }
    }
    return res.json({ ok: true, updated });
  } catch (e) {
    console.error('remindersPull error', e);
    return res.status(500).json({ error: 'server_error' });
  }
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
  
  const requestData = {
    model: "gpt-4o-mini", 
    messages: [{ role: "user", content: prompt }], 
    temperature: 0.2
  };

  // Wrap the AI call with comprehensive logging
  const aiWrapper = aiUsageLogger.wrapAICall('openai', 'gpt-4o-mini');
  
  const resp = await aiWrapper(
    () => client.chat.completions.create(requestData),
    {
      userId: req.auth.uid,
      functionName: 'prioritizeBacklog',
      request: requestData,
      purpose: 'Task prioritization and bucketing',
      metadata: {
        taskCount: tasks.length,
        persona: req.data?.persona || 'unknown'
      }
    }
  );
  
  let out = { items: [] }; 
  try { 
    out = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); 
  } catch (parseError) {
    console.error('Failed to parse AI response:', parseError);
  }
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

  await db.collection('profiles').doc(uid).set({
    traktLastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    traktSyncCount: history.length,
  }, { merge: true });

  return { ok: true, written: history.length };
}

async function _syncSteam(uid) {
  const db = admin.firestore();
  const profile = await db.collection('profiles').doc(uid).get();
  const steamId = profile.data()?.steamId;

  if (!steamId) {
    throw new Error("SteamID not found in profile.");
  }

  const url = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env.STEAM_WEB_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
  const data = await fetchJson(url);

  const games = data.response.games || [];

  // Fetch richer metadata for top-played titles (limit to avoid excessive calls)
  const detailTargets = [...games]
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .slice(0, 50);

  const detailsMap = new Map();
  await Promise.all(detailTargets.map(async (game) => {
    try {
      const detailResp = await fetchJson(`https://store.steampowered.com/api/appdetails?cc=us&l=en&appids=${game.appid}`);
      const payload = detailResp?.[game.appid];
      if (payload?.success && payload?.data) {
        detailsMap.set(game.appid, payload.data);
      }
    } catch (error) {
      console.error(`Failed to fetch store metadata for app ${game.appid}`, error);
    }
  }));

  const batch = db.batch();
  for (const item of games) {
    const docRef = db.collection('steam').doc(`${uid}_${item.appid}`);
    const appData = detailsMap.get(item.appid) || null;

    const iconUrl = item.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${item.appid}/${item.img_icon_url}.jpg`
      : null;
    const logoUrl = item.img_logo_url
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/${item.img_logo_url}.jpg`
      : null;
    const headerUrl = appData?.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/header.jpg`;
    const coverUrl = appData?.library_asset || `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`;
    const capsuleUrl = appData?.capsule_image || null;

    const docData = {
      ownerUid: uid,
      appid: item.appid,
      name: item.name || `App ${item.appid}`,
      iconUrl,
      logoUrl,
      headerUrl,
      coverUrl,
      capsuleUrl,
      playtimeForever: item.playtime_forever || 0,
      playtimeTwoWeeks: item.playtime_2weeks || 0,
      playtimeHours: Math.round(((item.playtime_forever || 0) / 60) * 10) / 10,
      lastPlayedAt: item.rtime_last_played
        ? admin.firestore.Timestamp.fromMillis((item.rtime_last_played || 0) * 1000)
        : admin.firestore.FieldValue.delete(),
      genres: Array.isArray(appData?.genres)
        ? appData.genres.map((g) => g.description).filter(Boolean)
        : [],
      releaseDate: appData?.release_date?.date || null,
      isFree: typeof appData?.is_free === 'boolean' ? appData.is_free : null,
      shortDescription: appData?.short_description || null,
      storeUrl: `https://store.steampowered.com/app/${item.appid}`,
      libraryStatus: 'owned',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      raw: {
        playtimeWindowsForever: item.playtime_windows_forever || null,
        playtimeMacForever: item.playtime_mac_forever || null,
        playtimeLinuxForever: item.playtime_linux_forever || null,
      }
    };

    batch.set(docRef, docData, { merge: true });
  }
  await batch.commit();

  await db.collection('profiles').doc(uid).set({
    steamLastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
    steamLibrarySize: games.length,
  }, { merge: true });

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

// ===== n8n: inbound webhook for Calendar Blocks
exports.n8nCalendarWebhook = httpsV2.onRequest({ secrets: [N8N_WEBHOOK_SECRET], invoker: 'public' }, async (req, res) => {
  try {
    const provided = String(req.get('x-webhook-secret') || req.query.secret || '');
    const expected = process.env.N8N_WEBHOOK_SECRET || '';
    if (!expected || provided !== expected) {
      return res.status(401).send('Invalid or missing secret');
    }
    const body = (typeof req.body === 'string') ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || '').toLowerCase();
    const ownerUid = String(body.ownerUid || '');
    const id = String(body.id || body.block?.id || '');
    const block = body.block || {};
    if (!ownerUid) return res.status(400).send('Missing ownerUid');
    const db = admin.firestore();
    if (action === 'create') {
      const doc = { ...block, ownerUid, createdAt: Date.now(), updatedAt: Date.now() };
      const ref = await db.collection('calendar_blocks').add(doc);
      return res.json({ ok: true, id: ref.id });
    } else if (action === 'update') {
      if (!id) return res.status(400).send('Missing id');
      await db.collection('calendar_blocks').doc(id).set({ ...block, ownerUid, updatedAt: Date.now() }, { merge: true });
      return res.json({ ok: true, id });
    } else if (action === 'delete') {
      if (!id) return res.status(400).send('Missing id');
      await db.collection('calendar_blocks').doc(id).delete();
      return res.json({ ok: true, id });
    } else {
      return res.status(400).send('Invalid action');
    }
  } catch (e) {
    try {
      await admin.firestore().collection('webhook_logs').add({ source: 'n8n', direction: 'in', ts: Date.now(), error: String(e?.message || e) });
    } catch {}
    return res.status(500).send('Webhook error');
  }
});

// Outbound notifications to n8n on calendar_blocks writes (optional)
exports.onCalendarBlockWritten = firestoreV2.onDocumentWritten('calendar_blocks/{id}', { secrets: [N8N_OUTBOUND_WEBHOOK_URL, N8N_WEBHOOK_SECRET] }, async (event) => {
  const url = process.env.N8N_OUTBOUND_WEBHOOK_URL;
  if (!url) return;
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const id = event.params.id;
  const action = !before && after ? 'created' : (before && !after ? 'deleted' : 'updated');
  const ownerUid = (after?.ownerUid || before?.ownerUid || null);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': process.env.N8N_WEBHOOK_SECRET || '' },
      body: JSON.stringify({ id, action, ownerUid, before, after, ts: Date.now() }),
    });
  } catch (e) {
    try { await admin.firestore().collection('webhook_logs').add({ source: 'n8n', direction: 'out', ts: Date.now(), id, action, error: String(e?.message || e) }); } catch {}
  }
});

// Callable: schedule Steam games via n8n to Calendar Blocks
exports.scheduleSteamGamesViaN8n = httpsV2.onCall({ secrets: [N8N_SCHEDULE_STEAM_URL, N8N_WEBHOOK_SECRET] }, async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const items = Array.isArray(req?.data?.items) ? req.data.items : [];
  const settings = req?.data?.settings || { durationMinutes: 120 };
  if (!items.length) throw new httpsV2.HttpsError('invalid-argument', 'No items provided');
  const url = process.env.N8N_SCHEDULE_STEAM_URL;
  if (!url) throw new httpsV2.HttpsError('failed-precondition', 'N8N_SCHEDULE_STEAM_URL not configured');
  let result;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': process.env.N8N_WEBHOOK_SECRET || '' },
      body: JSON.stringify({ ownerUid: uid, items, settings })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    result = await res.json();
  } catch (e) {
    throw new httpsV2.HttpsError('internal', 'n8n scheduling failed: ' + (e?.message || e));
  }
  const blocks = Array.isArray(result?.blocks) ? result.blocks : [];
  const db = admin.firestore();
  const created = [];
  for (const b of blocks) {
    const doc = {
      ownerUid: uid,
      persona: 'personal',
      theme: b.theme || 'Growth',
      category: b.category || 'Gaming',
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
      flexibility: 'soft',
      status: 'applied',
      createdBy: 'automation',
      source: 'steam',
      note: b.note || b.title || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const ref = await db.collection('calendar_blocks').add(doc);
    created.push(ref.id);
  }
  return { ok: true, created, count: created.length };
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

    if (data.stravaConnected && data.stravaAutoSync) {
      try {
        await fetchStravaActivities(uid, { maxPages: 2 });
      } catch (error) {
        console.error(`Failed to sync Strava for user ${uid}`, error);
      }
    }

    if (data.parkrunAthleteId && data.parkrunAutoSync) {
      try {
        await _syncParkrunInternal(uid, data.parkrunAthleteId, data.parkrunBaseUrl || undefined);
      } catch (error) {
        console.error(`Failed to sync Parkrun for user ${uid}`, error);
      }
    }

    if (data.parkrunAutoComputePercentiles && data.parkrunDefaultEventSlug && data.parkrunDefaultStartRun) {
      try {
        await _computeParkrunPercentilesInternal(uid, {
          eventSlug: String(data.parkrunDefaultEventSlug).toLowerCase(),
          startRun: Number(data.parkrunDefaultStartRun),
          base: data.parkrunBaseUrl || 'https://www.parkrun.org.uk',
          onlyMissing: true,
          maxBack: 200
        });
      } catch (error) {
        console.error(`Failed to compute Parkrun percentiles for user ${uid}`, error);
      }
    }

    if (data.autoEnrichStravaHR) {
      try {
        // Enrich last 30 days for HR if missing
        // reuse callable's logic
        await exports.enrichStravaHR.run({ auth: { uid }, data: { days: 30 } });
      } catch (error) {
        // Swallow, enrichStravaHR may not be directly invocable here; fall back to inline
        try { await (async ()=>{ /* optional future inline */ })(); } catch{}
      }
    }

    if (data.autoComputeFitnessMetrics) {
      try {
        const overview = await _getFitnessOverview(uid, 90);
        await db.collection('fitness_overview').doc(uid).set({ ...overview, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        const analysis = await _getRunFitnessAnalysis(uid, 365);
        await db.collection('run_analysis').doc(uid).set({ ...analysis, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch (error) {
        console.error(`Failed to compute fitness metrics for user ${uid}`, error);
      }
    }

    if (data.monzoConnected) {
      try {
        await syncMonzoDataForUser(uid);
      } catch (error) {
        console.error(`Failed to sync Monzo for user ${uid}`, error);
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

// Export the daily digest function
exports.generateDailyDigest = generateDailyDigest;
