'use strict';

/**
 * bobAssistVertex.js
 *
 * BOB in-app assistant powered by Vertex AI Gemini with native function calling.
 * Replaces the Google AI Studio path in sendAssistantMessage with a proper
 * aiplatform.googleapis.com call — visible to the SGC Vertex AI connector.
 *
 * Tools implemented (mirrors Hermes skills):
 *   get_priorities       — bob-priorities-report
 *   search_stories       — bob-data-access
 *   get_story_detail     — bob-data-access (with tasks)
 *   get_goals            — bob-data-access
 *   create_story         — bob-story-task-creator
 *   update_story         — bob-story-task-creator
 *   create_task          — bob-story-task-creator
 *   get_finance_summary  — bob-finance-analysis
 *   get_daily_plan       — bob-daily-plan-generator
 *
 * Invoked as:  exports.sendAssistantMessageV2 (onCall, firebase-functions v2)
 * Auth:        Firebase ID token (req.auth.uid)
 * Region:      europe-west2
 * Model:       gemini-2.5-flash (via Vertex AI ADC — no API key required)
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { VertexAI } = require('@google-cloud/vertexai');

if (!admin.apps.length) admin.initializeApp();

const PROJECT   = 'bob20250810';
const LOCATION  = 'europe-west2';
const MODEL     = 'gemini-2.5-flash';
const OWNER_UID = '3L3nnXSuTPfr08c8DTXG5zYX37A2';
const BASE_URL  = 'https://bob.jc1.tech';
const MAX_TOOL_TURNS = 5;

// ---------------------------------------------------------------------------
// Priority helpers (mirrors CLAUDE.md contract)
// ---------------------------------------------------------------------------

function priorityKey(p) {
  if (p == null) return 99;
  const n = parseInt(p, 10);
  if (!isNaN(n)) return n;
  const s = String(p).toUpperCase().trim();
  if (s.startsWith('P')) { const v = parseInt(s.slice(1), 10); if (!isNaN(v)) return v; }
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[s] ?? 99;
}

const IN_PROGRESS = new Set([1, '1', 'in-progress', 'in_progress']);
const BACKLOG     = new Set([0, '0', 'backlog', 'todo']);

function storyLink(s) {
  return `[${s.ref || s.id}](${BASE_URL}/stories/${s.id})`;
}

// ---------------------------------------------------------------------------
// Tool implementations — each reads Firestore directly
// ---------------------------------------------------------------------------

async function getPriorities({ count = 5 }, uid) {
  const db = admin.firestore();
  const snap = await db.collection('stories')
    .where('ownerUid', '==', uid)
    .where('status', 'in', [0, 1, '0', '1', 'backlog', 'in-progress', 'in_progress', 'todo'])
    .limit(200)
    .get();

  const stories = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const pinned = stories
    .filter(s => s.userPriorityFlag)
    .sort((a, b) => (a.userPriorityRank || 99) - (b.userPriorityRank || 99));

  const pinnedIds = new Set(pinned.map(s => s.id));

  const inProgress = stories
    .filter(s => IN_PROGRESS.has(s.status) && !pinnedIds.has(s.id))
    .sort((a, b) => (b.aiCriticalityScore || 0) - (a.aiCriticalityScore || 0) || priorityKey(a.priority) - priorityKey(b.priority));

  const backlog = stories
    .filter(s => BACKLOG.has(s.status) && !pinnedIds.has(s.id))
    .sort((a, b) => (b.aiCriticalityScore || 0) - (a.aiCriticalityScore || 0) || priorityKey(a.priority) - priorityKey(b.priority));

  const ordered = [...pinned, ...inProgress, ...backlog].slice(0, count);

  return {
    priorities: ordered.map(s => ({
      ref: s.ref || s.id,
      title: s.title,
      status: s.status,
      priority: s.priority,
      aiCriticalityScore: s.aiCriticalityScore,
      pinned: !!s.userPriorityFlag,
      link: `${BASE_URL}/stories/${s.id}`,
      goalTitle: s.goalTitle || null,
      dueDate: s.dueDate || null,
    })),
  };
}

async function searchStories({ query, status, limit = 20 }, uid) {
  const db = admin.firestore();
  let ref = db.collection('stories').where('ownerUid', '==', uid);

  const statusMap = { backlog: [0, '0', 'backlog', 'todo'], 'in-progress': [1, '1', 'in-progress', 'in_progress'], review: [2, '2', 'review'] };
  if (status && statusMap[status]) ref = ref.where('status', 'in', statusMap[status]);

  const snap = await ref.limit(100).get();
  const lq = (query || '').toLowerCase();
  const stories = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => !lq || (s.title || '').toLowerCase().includes(lq) || (s.description || '').toLowerCase().includes(lq))
    .slice(0, limit);

  return {
    stories: stories.map(s => ({
      ref: s.ref || s.id,
      title: s.title,
      status: s.status,
      priority: s.priority,
      link: `${BASE_URL}/stories/${s.id}`,
      goalTitle: s.goalTitle || null,
    })),
    count: stories.length,
  };
}

async function getStoryDetail({ storyRef }, uid) {
  const db = admin.firestore();
  let storyDoc;

  if (storyRef.startsWith('ST-')) {
    const snap = await db.collection('stories').where('ownerUid', '==', uid).where('ref', '==', storyRef).limit(1).get();
    if (snap.empty) return { error: `Story ${storyRef} not found` };
    storyDoc = { id: snap.docs[0].id, ...snap.docs[0].data() };
  } else {
    const doc = await db.collection('stories').doc(storyRef).get();
    if (!doc.exists || doc.data().ownerUid !== uid) return { error: `Story ${storyRef} not found` };
    storyDoc = { id: doc.id, ...doc.data() };
  }

  const tasksSnap = await db.collection('tasks').where('storyId', '==', storyDoc.id).where('ownerUid', '==', uid).get();
  const tasks = tasksSnap.docs.map(d => ({
    ref: d.data().ref || d.id,
    title: d.data().title,
    status: d.data().status,
    priority: d.data().priority,
    link: `${BASE_URL}/tasks/${d.id}`,
  }));

  return {
    ref: storyDoc.ref || storyDoc.id,
    title: storyDoc.title,
    description: (storyDoc.description || '').slice(0, 500),
    status: storyDoc.status,
    priority: storyDoc.priority,
    aiCriticalityScore: storyDoc.aiCriticalityScore,
    goalTitle: storyDoc.goalTitle || null,
    dueDate: storyDoc.dueDate || null,
    link: `${BASE_URL}/stories/${storyDoc.id}`,
    tasks,
  };
}

async function getGoals({ status, limit = 20 }, uid) {
  const db = admin.firestore();
  let ref = db.collection('goals').where('ownerUid', '==', uid);
  if (status !== 'all') ref = ref.where('status', 'not-in', [4, '4', 'bin']);

  const snap = await ref.limit(limit).get();
  return {
    goals: snap.docs.map(d => ({
      ref: d.data().ref || d.id,
      title: d.data().title,
      status: d.data().status,
      progress: d.data().progress || 0,
      link: `${BASE_URL}/goals/${d.id}`,
    })),
  };
}

async function createStory({ title, goalRef, priority = 'MEDIUM', description = '' }, uid) {
  const db = admin.firestore();

  let goalId = null;
  let goalTitle = null;
  if (goalRef) {
    const gSnap = goalRef.startsWith('GR-')
      ? await db.collection('goals').where('ownerUid', '==', uid).where('ref', '==', goalRef).limit(1).get()
      : await db.collection('goals').doc(goalRef).get().then(d => ({ empty: !d.exists, docs: [d] }));

    if (!gSnap.empty) {
      const gDoc = gSnap.docs[0];
      goalId = gDoc.id;
      goalTitle = gDoc.data().title;
    }
  }

  const counterSnap = await db.collection('counters').doc(`stories_${uid}`).get();
  const nextNum = (counterSnap.exists ? (counterSnap.data().count || 0) : 0) + 1;
  const ref = `ST-${String(nextNum).padStart(5, '0')}`;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const storyRef = db.collection('stories').doc();
  await storyRef.set({
    ref,
    title,
    description,
    priority,
    status: 0,
    ownerUid: uid,
    goalId: goalId || null,
    goalTitle: goalTitle || null,
    aiCriticalityScore: 0,
    userPriorityFlag: false,
    flaggedToAi: false,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('counters').doc(`stories_${uid}`).set({ count: nextNum }, { merge: true });

  await db.collection('activity_stream').doc().set({
    entityId: storyRef.id,
    entityType: 'story',
    activityType: 'created',
    userId: uid,
    ownerUid: uid,
    description: `Created story: ${ref} — ${title}`,
    referenceNumber: ref,
    source: 'ai',
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true, ref, id: storyRef.id, link: `${BASE_URL}/stories/${storyRef.id}` };
}

async function updateStory({ storyRef: sRef, status, priority, title, flaggedToAi }, uid) {
  const db = admin.firestore();

  let docId;
  if (sRef.startsWith('ST-')) {
    const snap = await db.collection('stories').where('ownerUid', '==', uid).where('ref', '==', sRef).limit(1).get();
    if (snap.empty) return { error: `Story ${sRef} not found` };
    docId = snap.docs[0].id;
  } else {
    docId = sRef;
  }

  const STATUS_MAP = { backlog: 0, 'in-progress': 1, review: 2, done: 3, bin: 4 };
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (status != null) updates.status = STATUS_MAP[status] ?? status;
  if (priority != null) updates.priority = priority;
  if (title != null) updates.title = title;
  if (flaggedToAi != null) updates.flaggedToAi = flaggedToAi;

  await db.collection('stories').doc(docId).update(updates);
  return { ok: true, id: docId, link: `${BASE_URL}/stories/${docId}` };
}

async function createTask({ storyRef: sRef, title, priority = 'MEDIUM', description = '' }, uid) {
  const db = admin.firestore();

  let storyId, storyTitle;
  if (sRef.startsWith('ST-')) {
    const snap = await db.collection('stories').where('ownerUid', '==', uid).where('ref', '==', sRef).limit(1).get();
    if (snap.empty) return { error: `Story ${sRef} not found` };
    storyId = snap.docs[0].id;
    storyTitle = snap.docs[0].data().title;
  } else {
    const doc = await db.collection('stories').doc(sRef).get();
    if (!doc.exists) return { error: `Story ${sRef} not found` };
    storyId = doc.id;
    storyTitle = doc.data().title;
  }

  const counterSnap = await db.collection('counters').doc(`tasks_${uid}`).get();
  const nextNum = (counterSnap.exists ? (counterSnap.data().count || 0) : 0) + 1;
  const ref = `TK-${String(nextNum).padStart(5, '0')}`;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const taskRef = db.collection('tasks').doc();
  await taskRef.set({
    ref,
    title,
    description,
    priority,
    status: 0,
    ownerUid: uid,
    storyId,
    storyTitle,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('counters').doc(`tasks_${uid}`).set({ count: nextNum }, { merge: true });

  return { ok: true, ref, id: taskRef.id, link: `${BASE_URL}/tasks/${taskRef.id}` };
}

async function getFinanceSummary({ days = 30 }, uid) {
  const db = admin.firestore();

  const since = new Date();
  since.setDate(since.getDate() - days);

  const txnSnap = await db.collection('monzo_transactions')
    .where('ownerUid', '==', uid)
    .where('created', '>=', since.toISOString())
    .orderBy('created', 'desc')
    .limit(500)
    .get();

  const txns = txnSnap.docs.map(d => d.data());

  const totalSpend = txns
    .filter(t => (t.amount || 0) < 0)
    .reduce((s, t) => s + Math.abs(t.amount || 0), 0) / 100;

  const totalIn = txns
    .filter(t => (t.amount || 0) > 0)
    .reduce((s, t) => s + (t.amount || 0), 0) / 100;

  // Top categories
  const byCat = {};
  for (const t of txns.filter(t => (t.amount || 0) < 0)) {
    const cat = t.category || 'other';
    byCat[cat] = (byCat[cat] || 0) + Math.abs(t.amount || 0) / 100;
  }
  const topCategories = Object.entries(byCat)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }));

  return {
    periodDays: days,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalIn: Math.round(totalIn * 100) / 100,
    transactionCount: txns.length,
    topCategories,
  };
}

async function getDailyPlan(_, uid) {
  const db = admin.firestore();

  const [priorities, goals] = await Promise.all([
    getPriorities({ count: 5 }, uid),
    getGoals({ status: 'active' }, uid),
  ]);

  // Pull today's calendar blocks from Firestore
  const today = new Date().toISOString().slice(0, 10);
  const calSnap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('date', '==', today)
    .orderBy('startTime', 'asc')
    .get();

  const calBlocks = calSnap.docs.map(d => ({
    title: d.data().title,
    startTime: d.data().startTime,
    endTime: d.data().endTime,
  }));

  return {
    date: today,
    topPriorities: priorities.priorities.slice(0, 3),
    calendarBlocks: calBlocks,
    activeGoalCount: goals.goals.length,
  };
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

const TOOL_HANDLERS = {
  get_priorities:    getPriorities,
  search_stories:    searchStories,
  get_story_detail:  getStoryDetail,
  get_goals:         getGoals,
  create_story:      createStory,
  update_story:      updateStory,
  create_task:       createTask,
  get_finance_summary: getFinanceSummary,
  get_daily_plan:    getDailyPlan,
};

async function dispatchTool(name, args, uid) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  try {
    return await handler(args || {}, uid);
  } catch (e) {
    console.error(`[bobAssistVertex] tool ${name} error:`, e?.message);
    return { error: e?.message || 'Tool execution failed' };
  }
}

// ---------------------------------------------------------------------------
// Vertex AI function declarations
// ---------------------------------------------------------------------------

const TOOL_DECLARATIONS = [
  {
    name: 'get_priorities',
    description: 'Get Jim\'s top priority stories from BOB, ordered by pinned flag, in-progress status, and AI criticality score.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'integer', description: 'Number of priorities to return (default 5, max 20)' },
      },
    },
  },
  {
    name: 'search_stories',
    description: 'Search BOB stories by keyword and/or status.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search in title or description' },
        status: { type: 'string', enum: ['backlog', 'in-progress', 'review'], description: 'Filter by status' },
        limit: { type: 'integer', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'get_story_detail',
    description: 'Get full detail for a story including its tasks. Accepts ST-XXXXX ref or Firestore ID.',
    parameters: {
      type: 'object',
      properties: {
        storyRef: { type: 'string', description: 'Story ref (ST-XXXXX) or Firestore document ID' },
      },
      required: ['storyRef'],
    },
  },
  {
    name: 'get_goals',
    description: 'List Jim\'s goals in BOB.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'all'], description: 'Filter by status (default: active)' },
        limit: { type: 'integer', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'create_story',
    description: 'Create a new story in BOB. Always confirm with Jim before creating unless he explicitly asked.',
    parameters: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Story title' },
        goalRef:     { type: 'string', description: 'Parent goal ref (GR-XXXXX) or Firestore ID' },
        priority:    { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], description: 'Priority level' },
        description: { type: 'string', description: 'Story description' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_story',
    description: 'Update a story\'s status, priority, or title in BOB.',
    parameters: {
      type: 'object',
      properties: {
        storyRef:    { type: 'string', description: 'Story ref (ST-XXXXX) or Firestore ID' },
        status:      { type: 'string', enum: ['backlog', 'in-progress', 'review', 'done', 'bin'] },
        priority:    { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
        title:       { type: 'string' },
        flaggedToAi: { type: 'boolean', description: 'Flag story for Hermes AI delegation' },
      },
      required: ['storyRef'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a task under an existing BOB story.',
    parameters: {
      type: 'object',
      properties: {
        storyRef:    { type: 'string', description: 'Parent story ref (ST-XXXXX) or Firestore ID' },
        title:       { type: 'string', description: 'Task title' },
        priority:    { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
        description: { type: 'string' },
      },
      required: ['storyRef', 'title'],
    },
  },
  {
    name: 'get_finance_summary',
    description: 'Get a summary of Jim\'s Monzo spending for the last N days.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Lookback window in days (default 30)' },
      },
    },
  },
  {
    name: 'get_daily_plan',
    description: 'Generate Jim\'s daily plan — top priorities, calendar blocks for today, and active goal count.',
    parameters: { type: 'object', properties: {} },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are BOB Assistant, Jim's personal productivity AI, powered by Vertex AI.
You have full access to Jim's BOB system — stories, tasks, goals, finance, and daily planning.

Key facts:
- Jim is based in Belfast (Europe/London timezone)
- BOB is his personal productivity system at bob.jc1.tech
- Stories are tracked work items (ST-XXXXX), tasks are sub-items (TK-XXXXX), goals are OKR-style containers (GR-XXXXX)
- Status codes: 0/backlog, 1/in-progress, 2/review, 4/bin

Behaviour:
- Always use tools to fetch live data — never fabricate story refs, titles, or scores
- For write operations (create/update), confirm with Jim first unless he explicitly asked you to do it
- Present story links as markdown: [ST-XXXXX](url)
- Keep responses concise and direct — Jim is analytical and dislikes fluff
- When returning priorities, always show: ref, title, status, and link`;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

exports.sendAssistantMessageV2 = onCall(
  {
    region: 'europe-west2',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const message = String(req?.data?.message || '').trim();
    const history = Array.isArray(req?.data?.history) ? req.data.history : [];
    if (!message) throw new HttpsError('invalid-argument', 'message is required');

    const db = admin.firestore();
    const threadRef = db.collection('assistant_chats').doc(uid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Persist user message
    await threadRef.collection('messages').add({
      ownerUid: uid,
      role: 'user',
      content: message,
      source: 'vertex',
      createdAt: now,
    });

    // Build conversation history for Vertex AI
    const chatHistory = history
      .filter(m => m.role && m.content)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // Init Vertex AI
    const vertexAI = new VertexAI({ project: PROJECT, location: LOCATION });
    const generativeModel = vertexAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    });

    const chat = generativeModel.startChat({ history: chatHistory });

    // Agentic loop — up to MAX_TOOL_TURNS rounds of function calling
    let currentMessage = message;
    let finalReply = null;
    let toolsUsed = [];

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const result = turn === 0
        ? await chat.sendMessage(currentMessage)
        : await chat.sendMessage(currentMessage);

      const candidate = result.response?.candidates?.[0];
      if (!candidate) { finalReply = 'No response from model.'; break; }

      const parts = candidate.content?.parts || [];
      const textParts = parts.filter(p => p.text);
      const fnCalls = parts.filter(p => p.functionCall);

      if (fnCalls.length === 0) {
        // No more tool calls — extract final text
        finalReply = textParts.map(p => p.text).join('').trim() || 'Done.';
        break;
      }

      // Execute all function calls in parallel
      const fnResponses = await Promise.all(
        fnCalls.map(async (part) => {
          const { name, args } = part.functionCall;
          toolsUsed.push(name);
          console.log(`[bobAssistVertex] tool call: ${name}`, JSON.stringify(args).slice(0, 200));
          const toolResult = await dispatchTool(name, args, uid);
          return {
            functionResponse: {
              name,
              response: { content: JSON.stringify(toolResult) },
            },
          };
        }),
      );

      // Feed results back to the model
      currentMessage = fnResponses;
    }

    if (!finalReply) finalReply = 'I reached the maximum number of steps. Please try a more specific question.';

    // Persist assistant reply
    await threadRef.collection('messages').add({
      ownerUid: uid,
      role: 'assistant',
      content: finalReply,
      source: 'vertex',
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : null,
      createdAt: now,
    });

    return {
      ok: true,
      reply: finalReply,
      toolsUsed,
      source: 'vertex',
    };
  },
);
