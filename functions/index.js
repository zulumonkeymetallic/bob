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
    const redirectUri = `https://${projectId}.web.app/api/oauth/callback`;
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
    const redirectUri = `https://${projectId}.web.app/api/oauth/callback`;

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

// ===== Token refresh helper
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

// ===== AI helpers (as before, simplified)
exports.prioritizeBacklog = httpsV2.onCall({ secrets: [OPENAI_API_KEY] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  let tasks = (req.data && Array.isArray(req.data.tasks)) ? req.data.tasks : [];
  if (tasks.length > 50) tasks = tasks.slice(0,50);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = "Score tasks 0-100 and bucket TODAY/NEXT/LATER. Return JSON {items:[{id,score,bucket}]}\\nTasks: " + JSON.stringify(tasks);
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
