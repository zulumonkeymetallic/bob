'use strict';

/**
 * telegramWebhook.js
 *
 * Telegram Bot integration for the BOB Agent Integration Layer.
 *
 * Exports (Cloud Functions):
 *   telegramWebhook       — onRequest (public) — receives all Telegram Bot API updates
 *   linkTelegramAccount   — onCall — generates a link code for the web app UI
 *   unlinkTelegramAccount — onCall — removes a telegram_sessions document
 *
 * Exports (internal helpers):
 *   sendTelegramMessage(chatId, text, options)
 *   getTelegramBotToken()   — used by approvalWorker for message editing
 *
 * Account linking flow:
 *   1. User calls linkTelegramAccount callable from web app → gets a 6-char code
 *   2. Code stored on profiles/{uid}.telegramLinkCode with 10-min TTL
 *   3. User sends /start <code> in Telegram
 *   4. Bot creates telegram_sessions/{chatId}, deletes link code, replies "Linked!"
 *
 * Security:
 *   - Webhook URL contains TELEGRAM_WEBHOOK_SECRET as query param
 *   - All BOB data access requires session lookup — no anonymous data access
 *   - Rate limiting via existing checkAndIncrementQuota (agent_context cost)
 */

const { defineSecret } = require('firebase-functions/params');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const { logAgentAction } = require('./agentAudit');
const { getAgentTodayContext } = require('./agentContext');
const { executeApprovedActions } = require('./approvalWorker');
const { processAgentRequestInternal } = require('../transcriptIngestion');

const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
const TELEGRAM_WEBHOOK_SECRET = defineSecret('TELEGRAM_WEBHOOK_SECRET');
const GEMINI_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');

const SESSIONS_COLLECTION = 'telegram_sessions';
const APPROVALS_COLLECTION = 'pending_approvals';
const PROFILES_COLLECTION = 'profiles';

// ---------------------------------------------------------------------------
// Webhook receiver
// ---------------------------------------------------------------------------

exports.telegramWebhook = onRequest(
  {
    region: 'europe-west2',
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, GEMINI_API_KEY],
    invoker: 'public',
    timeoutSeconds: 30,
    memory: '512MiB',
  },
  async (req, res) => {
    // Must respond 200 immediately — Telegram times out after 5 seconds.
    // All heavy processing happens asynchronously after the response.

    // Validate secret query param
    const providedSecret = req.query.secret;
    if (!providedSecret || providedSecret !== TELEGRAM_WEBHOOK_SECRET.value().trim()) {
      return res.status(403).send('Forbidden');
    }

    if (req.method !== 'POST') {
      return res.status(200).send('ok');
    }

    // Respond immediately
    res.status(200).send('ok');

    // Async processing — errors here do not affect the HTTP response
    const update = req.body;
    if (!update) return;

    try {
      await _handleUpdate(update);
    } catch (err) {
      console.error('[telegramWebhook] handleUpdate error:', err?.message || err);
    }
  },
);

// ---------------------------------------------------------------------------
// Account linking callables
// ---------------------------------------------------------------------------

exports.linkTelegramAccount = onCall(
  { region: 'europe-west2' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const code = _randomCode(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const db = admin.firestore();
    await db.collection(PROFILES_COLLECTION).doc(uid).set(
      {
        telegramLinkCode: code,
        telegramLinkCodeExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      },
      { merge: true },
    );

    return { code, expiresAt: expiresAt.toISOString() };
  },
);

exports.unlinkTelegramAccount = onCall(
  { region: 'europe-west2' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const db = admin.firestore();

    // Find and delete the session for this user
    const sessionsSnap = await db.collection(SESSIONS_COLLECTION)
      .where('ownerUid', '==', uid)
      .limit(5)
      .get()
      .catch(() => ({ docs: [] }));

    const batch = db.batch();
    sessionsSnap.docs.forEach((d) => batch.delete(d.ref));

    // Clear link code from profile
    batch.update(db.collection(PROFILES_COLLECTION).doc(uid), {
      telegramLinkCode: admin.firestore.FieldValue.delete(),
      telegramLinkCodeExpiresAt: admin.firestore.FieldValue.delete(),
    });

    await batch.commit();
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Internal: exported for approvalWorker message editing
// ---------------------------------------------------------------------------

function getTelegramBotToken() {
  try {
    return TELEGRAM_BOT_TOKEN.value();
  } catch (e) {
    return null;
  }
}
exports.getTelegramBotToken = getTelegramBotToken;

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

async function sendTelegramMessage(chatId, text, { replyMarkup, parseMode } = {}) {
  const token = TELEGRAM_BOT_TOKEN.value();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body = {
    chat_id: chatId,
    text: String(text || '').slice(0, 4096),
    parse_mode: parseMode || 'Markdown',
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    return json?.result?.message_id || null;
  } catch (e) {
    console.error('[telegramWebhook] sendMessage error:', e?.message);
    return null;
  }
}
exports.sendTelegramMessage = sendTelegramMessage;

/** Fire-and-forget typing indicator — shows "BOB is typing…" in Telegram immediately. */
async function sendChatAction(chatId, action = 'typing') {
  const token = TELEGRAM_BOT_TOKEN.value();
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (_) { /* non-critical */ }
}

async function editTelegramMessage(chatId, messageId, text, { replyMarkup } = {}) {
  const token = TELEGRAM_BOT_TOKEN.value();
  const url = `https://api.telegram.org/bot${token}/editMessageText`;

  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: String(text || '').slice(0, 4096),
    parse_mode: 'Markdown',
    reply_markup: replyMarkup || { inline_keyboard: [] },
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('[telegramWebhook] editMessageText error:', e?.message);
  }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  const token = TELEGRAM_BOT_TOKEN.value();
  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (e) { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Update dispatcher
// ---------------------------------------------------------------------------

async function _handleUpdate(update) {
  const db = admin.firestore();
  const startMs = Date.now();

  // Callback query (inline keyboard button press)
  if (update.callback_query) {
    const callbackQuery = update.callback_query;
    const chatId = callbackQuery.message?.chat?.id;
    if (!chatId) return;

    const session = await _getSession(db, chatId);
    if (!session) {
      await answerCallbackQuery(callbackQuery.id, 'Session not found. Please re-link your account.');
      return;
    }

    await _handleApprovalCallback(db, callbackQuery, session);
    return;
  }

  // Regular message
  if (update.message) {
    const message = update.message;
    const chatId = message.chat?.id;
    const text = message.text || '';

    if (!chatId) return;

    // Handle /start <code> before session check (linking flow)
    if (text.startsWith('/start')) {
      await _handleStartCommand(db, chatId, message, text);
      return;
    }

    // All other commands and free text require an existing session
    const session = await _getSession(db, chatId);
    if (!session) {
      await sendTelegramMessage(
        chatId,
        '👋 Please link your account first.\n\nGo to BOB → Settings → Integrations → Telegram to get your link code.',
      );
      return;
    }

    // Update last seen
    await db.collection(SESSIONS_COLLECTION).doc(String(chatId)).update({
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageText: (text || '[voice]').slice(0, 200),
    }).catch(() => { /* non-fatal */ });

    // Voice note / audio message → transcribe then route as text
    const audioObject = message.voice || message.audio;
    if (audioObject) {
      await _handleVoiceMessage(db, message, session, chatId, audioObject, startMs);
      return;
    }

    await _handleInboundMessage(db, message, session, chatId, text);
  }
}

// ---------------------------------------------------------------------------
// Voice note handler
// ---------------------------------------------------------------------------

async function _handleVoiceMessage(db, message, session, chatId, audioObject, startMs) {
  const ownerUid = session.ownerUid;

  try {
    await sendTelegramMessage(chatId, '🎙️ Transcribing…');

    const transcript = await _transcribeAudio(audioObject.file_id);

    if (!transcript) {
      await sendTelegramMessage(chatId, '⚠️ Could not transcribe the voice note. Please try sending as text.');
      return;
    }

    // Echo back what was heard so user can confirm
    await sendTelegramMessage(chatId, `_Heard: "${_esc(transcript)}"_`);

    // Route through the same free-text pipeline
    await _handleFreeText(db, chatId, ownerUid, session, transcript, message.message_id, startMs);

  } catch (err) {
    console.error('[telegramWebhook] voiceMessage error:', err?.message);
    await sendTelegramMessage(chatId, '⚠️ Voice transcription failed. Please try again or send as text.');
  }
}

/**
 * Download a Telegram file and transcribe it using Gemini's audio understanding.
 * Telegram voice notes are OGG/Opus; Gemini 1.5 Flash supports audio natively.
 */
async function _transcribeAudio(fileId) {
  const token = TELEGRAM_BOT_TOKEN.value();

  // Step 1: Get the file path from Telegram
  const fileInfoResp = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
  );
  const fileInfo = await fileInfoResp.json();
  if (!fileInfo.ok) throw new Error(`getFile failed: ${JSON.stringify(fileInfo)}`);

  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  // Step 2: Download the audio bytes
  const audioResp = await fetch(fileUrl);
  if (!audioResp.ok) throw new Error(`Audio download failed: ${audioResp.status}`);
  const audioBuffer = await audioResp.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString('base64');

  // Step 3: Send to Gemini for transcription
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) throw new Error('Gemini API key not available for transcription');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'audio/ogg',
        data: audioBase64,
      },
    },
    'Transcribe this voice note accurately. Return only the transcribed text, no commentary.',
  ]);

  return result.response.text()?.trim() || null;
}

// ---------------------------------------------------------------------------
// Linking: /start <code>
// ---------------------------------------------------------------------------

async function _handleStartCommand(db, chatId, message, text) {
  const parts = text.trim().split(/\s+/);
  const code = parts[1] || '';

  if (!code) {
    await sendTelegramMessage(
      chatId,
      'Welcome to BOB! To link your account, go to BOB → Settings → Integrations → Telegram and send the code you receive here.',
    );
    return;
  }

  // Find profile with this link code
  const profilesSnap = await db.collection(PROFILES_COLLECTION)
    .where('telegramLinkCode', '==', code)
    .limit(1)
    .get()
    .catch(() => ({ docs: [] }));

  if (!profilesSnap.docs.length) {
    await sendTelegramMessage(chatId, '❌ Invalid or expired link code. Please generate a new one in BOB.');
    return;
  }

  const profileDoc = profilesSnap.docs[0];
  const profile = profileDoc.data();
  const uid = profileDoc.id;

  // Check expiry
  const expiresAt = profile.telegramLinkCodeExpiresAt;
  if (expiresAt && expiresAt.toMillis() < Date.now()) {
    await sendTelegramMessage(chatId, '❌ Link code expired. Please generate a new one in BOB.');
    return;
  }

  // Create session
  await db.collection(SESSIONS_COLLECTION).doc(String(chatId)).set({
    ownerUid: uid,
    telegramUserId: message.from?.id || null,
    telegramUsername: message.from?.username || null,
    linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageText: text.slice(0, 200),
    conversationState: 'idle',
    pendingApprovalId: null,
    timezone: profile.timezone || 'Europe/London',
    persona: profile.defaultPersona || 'personal',
  });

  // Remove link code from profile
  await profileDoc.ref.update({
    telegramLinkCode: admin.firestore.FieldValue.delete(),
    telegramLinkCodeExpiresAt: admin.firestore.FieldValue.delete(),
  });

  const name = message.from?.first_name || 'there';
  await sendTelegramMessage(
    chatId,
    `✅ Account linked, ${name}!\n\nYou can now:\n• Send tasks: "Add task: book swim coaching"\n• Ask priorities: /top3\n• Get your day: /today\n• See help: /help`,
  );
}

// ---------------------------------------------------------------------------
// Inbound message routing
// ---------------------------------------------------------------------------

async function _handleInboundMessage(db, message, session, chatId, text) {
  const ownerUid = session.ownerUid;
  const startMs = Date.now();

  // Command routing
  if (text === '/top3' || text === '/priorities') {
    return _handleTop3Command(db, chatId, ownerUid, session, startMs);
  }

  if (text === '/today' || text === '/context') {
    return _handleTodayCommand(db, chatId, ownerUid, session, startMs);
  }

  if (text.startsWith('/plan')) {
    return _handlePlanCommand(db, chatId, ownerUid, session, startMs);
  }

  if (text === '/week' || text === '/weekly') {
    return _handleWeeklyCommand(db, chatId, ownerUid, session, startMs);
  }

  if (text === '/help' || text === '/start') {
    return sendTelegramMessage(chatId, _helpText());
  }

  if (text === '/coach') {
    try {
      const { handleCoachCommand } = require('../coach');
      return handleCoachCommand(ownerUid, chatId);
    } catch (e) {
      console.warn('[telegramWebhook] /coach handler not available:', e?.message);
      return sendTelegramMessage(chatId, '🏊 Coach module is not available right now.');
    }
  }

  // Free text → processAgentRequestInternal (existing transcript pipeline)
  await _handleFreeText(db, chatId, ownerUid, session, text, message.message_id, startMs);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function _handleTop3Command(db, chatId, ownerUid, session, startMs) {
  try {
    const todayIso = new Date().toISOString().split('T')[0];
    const [tasksSnap, storiesSnap] = await Promise.all([
      db.collection('tasks')
        .where('ownerUid', '==', ownerUid)
        .where('aiTop3ForDay', '==', true)
        .where('aiTop3Date', '==', todayIso)
        .limit(5)
        .get()
        .catch(() => ({ docs: [] })),
      db.collection('stories')
        .where('ownerUid', '==', ownerUid)
        .where('aiTop3ForDay', '==', true)
        .where('aiTop3Date', '==', todayIso)
        .limit(5)
        .get()
        .catch(() => ({ docs: [] })),
    ]);

    const items = [
      ...tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
      ...storiesSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
    ]
      .sort((a, b) => (b.aiCriticalityScore || 0) - (a.aiCriticalityScore || 0))
      .slice(0, 3);

    let reply;
    if (items.length === 0) {
      reply = '📋 No AI top-3 for today yet. Check back after the nightly scoring runs, or use /today for full context.';
    } else {
      const lines = items.map((item, i) => {
        const priority = item.priority >= 4 ? '🔴' : item.priority >= 3 ? '🟠' : '🟡';
        return `${i + 1}. ${priority} *${_esc(item.title || '(untitled)')}*`;
      });
      reply = `*Top priorities for today:*\n\n${lines.join('\n')}`;
    }

    await sendTelegramMessage(chatId, reply);
    await logAgentAction({
      ownerUid,
      source: 'telegram',
      tool: 'get_priorities',
      responseStatus: 'ok',
      responsePayload: { count: items.length },
      durationMs: Date.now() - startMs,
      telegramChatId: chatId,
    });
  } catch (err) {
    console.error('[telegramWebhook] top3 error:', err?.message);
    await sendTelegramMessage(chatId, '⚠️ Could not fetch priorities. Please try again.');
  }
}

async function _handleTodayCommand(db, chatId, ownerUid, session, startMs) {
  try {
    const ctx = await getAgentTodayContext(ownerUid, { timezone: session.timezone });

    const sprintLine = ctx.activeSprint
      ? `🏃 *Sprint:* ${_esc(ctx.activeSprint.name || 'Active')} — ${ctx.activeSprint.daysRemaining ?? '?'}d left`
      : null;

    const top3Lines = ctx.top3.length
      ? ctx.top3.map((t, i) => `${i + 1}. *${_esc(t.title)}*`).join('\n')
      : '_No top-3 items yet_';

    const calLines = ctx.calendarToday.length
      ? ctx.calendarToday.slice(0, 5).map((b) => {
          const start = b.start ? new Date(b.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: session.timezone || 'Europe/London' }) : '?';
          return `  ${start} — ${_esc(b.title)}`;
        }).join('\n')
      : '  _No blocks today_';

    const overdueNote = ctx.overdueTaskCount > 0
      ? `\n⚠️ *${ctx.overdueTaskCount} overdue* task(s)${ctx.overdueTaskTitles.length ? ': ' + ctx.overdueTaskTitles.slice(0, 2).map(_esc).join(', ') : ''}`
      : '';

    const reply = [
      `📅 *${ctx.date}*`,
      sprintLine,
      '',
      '*Top priorities:*',
      top3Lines,
      '',
      '*Calendar today:*',
      calLines,
      overdueNote,
    ].filter((l) => l !== null).join('\n');

    await sendTelegramMessage(chatId, reply);
    await logAgentAction({
      ownerUid,
      source: 'telegram',
      tool: 'get_today_context',
      responseStatus: 'ok',
      durationMs: Date.now() - startMs,
      telegramChatId: chatId,
    });
  } catch (err) {
    console.error('[telegramWebhook] today error:', err?.message);
    await sendTelegramMessage(chatId, '⚠️ Could not load today\'s context. Please try again.');
  }
}

async function _handlePlanCommand(db, chatId, ownerUid, session, startMs) {
  // propose_task_triage is the V1 approval tool.
  // propose_day_plan (Phase 4) will be wired here.
  await sendTelegramMessage(
    chatId,
    '📅 Day planning is coming in the next phase. For now, use /today to see your context, then capture tasks with "Add task: ..."',
  );
}

async function _handleWeeklyCommand(db, chatId, ownerUid, session, startMs) {
  await sendTelegramMessage(
    chatId,
    '📊 Weekly review is coming in the next phase. For now try /today for your daily context.',
  );
}

async function _handleFreeText(db, chatId, ownerUid, session, text, messageId, startMs) {
  // Show "BOB is typing…" immediately — fire-and-forget, don't await
  sendChatAction(chatId, 'typing').catch(() => {});

  // Triage shortcut: "move overdue tasks" → propose_task_triage
  const triageMatch = /\b(move|defer|triage|clear)\b.*\b(overdue|nonessential|non-essential|today)\b/i.test(text);
  if (triageMatch) {
    await _sendTriageProposal(db, chatId, ownerUid, session, startMs);
    return;
  }

  // Classify intent so short phrases ("book swim coaching") become tasks
  // without requiring the user to prefix with "Add task:".
  const enrichedText = _enrichTranscriptWithIntent(text);

  // All other free text → processAgentRequestInternal
  try {
    const result = await processAgentRequestInternal({
      uid:             ownerUid,
      transcript:      enrichedText,
      persona:         session.persona || 'personal',
      source:          'telegram',
      sourceProvidedId:`tg_${messageId || Date.now()}`,
      channel:         'telegram',
      authMode:        'agent_service',
    });

    const reply = result?.spokenResponse || result?.message || 'Done.';
    await sendTelegramMessage(chatId, _esc(reply));

    await logAgentAction({
      ownerUid,
      source: 'telegram',
      tool: 'free_text',
      intent: result?.intent || null,
      requestPayload: { text: text.slice(0, 300), enriched: enrichedText.slice(0, 300) },
      responseStatus: 'ok',
      responsePayload: { reply: reply.slice(0, 300) },
      durationMs: Date.now() - startMs,
      telegramChatId: chatId,
      telegramMessageId: messageId || null,
    });
  } catch (err) {
    console.error('[telegramWebhook] freeText error:', err?.message);
    await sendTelegramMessage(chatId, '⚠️ Something went wrong. Please try again.');
  }
}

/**
 * Heuristic intent classifier.
 *
 * Adds a natural-language prefix to help processAgentRequestInternal route
 * correctly without the user having to say "Add task:" explicitly.
 *
 * Rules (evaluated in order, first match wins):
 *   1. Already has a recognised prefix → pass through unchanged
 *   2. Looks like a journal/log entry → prefix "Log: "
 *   3. Looks like a question → pass through (Gemini handles queries well)
 *   4. Looks like a short imperative phrase (≤10 words, no verb of reflection)
 *      → prefix "Add task: "
 *   5. Anything else → pass through unchanged
 */
function _enrichTranscriptWithIntent(text) {
  const t = text.trim();

  // 1. Already prefixed — don't double-wrap
  if (/^(add task|create task|new task|log:|note:|journal:|feeling|task:|story:|add story)/i.test(t)) {
    return t;
  }

  // 2. Journal / reflection indicators
  const journalPattern = /^(log[:\s]|note[:\s]|journal[:\s]|feeling|felt|slept|woke|tired|mood|today i|this morning|this evening|had a|been|i feel|i felt|i am|i'm|not feeling|struggled|great day|bad day|rough|solid session)/i;
  if (journalPattern.test(t)) {
    return t.startsWith('log') || t.startsWith('Log') ? t : `Log: ${t}`;
  }

  // 3. Question — let Gemini handle it as a query
  if (t.endsWith('?') || /^(what|who|when|where|how|why|can you|could you|show me|tell me|give me|do i|am i|is there|are there)/i.test(t)) {
    return t;
  }

  // 4. Short imperative phrase (≤10 words) → treat as task
  // Exclude sentences that are clearly narrative (have "I" as subject or past tense verbs)
  const wordCount = t.split(/\s+/).length;
  const looksNarrative = /^(i |we |he |she |they |it |the )/i.test(t);
  const hasPastTense = /\b(was|were|had|did|went|felt|saw|made|got|came|took|said|told|found|left|ran|finished|completed|worked|talked|called)\b/i.test(t);

  if (wordCount <= 10 && !looksNarrative && !hasPastTense) {
    return `Add task: ${t}`;
  }

  // 5. Pass through — Gemini's own intent detection takes over
  return t;
}

// ---------------------------------------------------------------------------
// Approval proposal via Telegram
// ---------------------------------------------------------------------------

async function _sendTriageProposal(db, chatId, ownerUid, session, startMs) {
  try {
    const todayIso = new Date().toISOString().split('T')[0];
    const todayTs = admin.firestore.Timestamp.fromDate(new Date(todayIso));

    const tasksSnap = await db.collection('tasks')
      .where('ownerUid', '==', ownerUid)
      .where('status', '<', 2)
      .where('dueDate', '<', todayTs)
      .limit(20)
      .get()
      .catch(() => ({ docs: [] }));

    const tasks = tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((t) => !t.deleted);

    if (!tasks.length) {
      await sendTelegramMessage(chatId, '✅ No overdue tasks to triage!');
      return;
    }

    const targetDate = _nextWeekdayIso();
    const proposalSummary = `Defer ${tasks.length} overdue task(s) to ${targetDate}: ${tasks.slice(0, 3).map((t) => t.title || t.ref || t.id).join(', ')}${tasks.length > 3 ? ` +${tasks.length - 3} more` : ''}`;

    const actions = tasks.map((t) => ({
      type: 'defer_task',
      payload: { taskId: t.id, targetDateIso: targetDate, ownerUid },
    }));

    const { v4: uuidv4 } = require('uuid');
    const approvalId = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.collection('pending_approvals').doc(approvalId).set({
      ownerUid,
      status: 'pending',
      tool: 'propose_task_triage',
      proposalSummary,
      proposalDetail: {},
      actions,
      telegramChatId: chatId,
      telegramMessageId: null,
      telegramCallbackQueryId: null,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      decidedAt: null,
      decidedBy: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      actionLogId: null,
    });

    const replyMarkup = {
      inline_keyboard: [[
        { text: '✅ Yes, defer them', callback_data: `approve:${approvalId}` },
        { text: '❌ Cancel',          callback_data: `reject:${approvalId}` },
      ]],
    };

    const msgId = await sendTelegramMessage(
      chatId,
      `📋 *Triage proposal:*\n\n${_esc(proposalSummary)}\n\n_Expires in 15 minutes_`,
      { replyMarkup },
    );

    // Store the message ID so we can edit it on resolution
    if (msgId) {
      await db.collection('pending_approvals').doc(approvalId).update({
        telegramMessageId: msgId,
      });
    }

    // Update session state
    await db.collection(SESSIONS_COLLECTION).doc(String(chatId)).update({
      conversationState: 'awaiting_approval',
      pendingApprovalId: approvalId,
    }).catch(() => { /* non-fatal */ });

    await logAgentAction({
      ownerUid,
      source: 'telegram',
      tool: 'propose_task_triage',
      requestPayload: { filter: 'overdue' },
      responseStatus: 'pending_approval',
      approvalId,
      durationMs: Date.now() - startMs,
      telegramChatId: chatId,
    });
  } catch (err) {
    console.error('[telegramWebhook] triage proposal error:', err?.message);
    await sendTelegramMessage(chatId, '⚠️ Could not create triage proposal. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Approval callback (inline keyboard button)
// ---------------------------------------------------------------------------

async function _handleApprovalCallback(db, callbackQuery, session) {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data || '';
  const ownerUid = session.ownerUid;

  const [actionPart, approvalId] = data.split(':');
  if (!approvalId) {
    await answerCallbackQuery(callbackQuery.id, 'Invalid callback data.');
    return;
  }

  const approvalRef = db.collection(APPROVALS_COLLECTION).doc(approvalId);
  const approvalSnap = await approvalRef.get();

  if (!approvalSnap.exists) {
    await answerCallbackQuery(callbackQuery.id, 'Proposal not found.');
    await editTelegramMessage(chatId, messageId, '_Proposal not found._');
    return;
  }

  const approval = approvalSnap.data();

  if (approval.ownerUid !== ownerUid) {
    await answerCallbackQuery(callbackQuery.id, 'Not your proposal.');
    return;
  }

  if (approval.status !== 'pending') {
    await answerCallbackQuery(callbackQuery.id, `Already ${approval.status}.`);
    await editTelegramMessage(chatId, messageId, `_Proposal already ${approval.status}._`);
    return;
  }

  if (approval.expiresAt?.toMillis() < Date.now()) {
    await approvalRef.update({ status: 'expired', decidedAt: admin.firestore.FieldValue.serverTimestamp() });
    await answerCallbackQuery(callbackQuery.id, 'Proposal expired.');
    await editTelegramMessage(chatId, messageId, '_This proposal expired._');
    return;
  }

  if (actionPart === 'approve') {
    await approvalRef.update({ status: 'approved', decidedAt: admin.firestore.FieldValue.serverTimestamp(), decidedBy: 'user' });
    await answerCallbackQuery(callbackQuery.id, 'Applying...');

    let resultText;
    try {
      const result = await executeApprovedActions(db, approval, approvalId);
      const applied = result.appliedActions.length;
      const failed = result.failedActions.length;
      resultText = failed
        ? `✅ Applied ${applied} action(s). ⚠️ ${failed} failed — check BOB for details.`
        : `✅ Done! ${applied} action(s) applied.`;
    } catch (err) {
      console.error('[telegramWebhook] executeApprovedActions error:', err?.message);
      resultText = '⚠️ Failed to apply some actions. Check BOB for details.';
    }

    await editTelegramMessage(chatId, messageId, resultText);

  } else if (actionPart === 'reject') {
    await approvalRef.update({ status: 'rejected', decidedAt: admin.firestore.FieldValue.serverTimestamp(), decidedBy: 'user' });
    await answerCallbackQuery(callbackQuery.id, 'Cancelled.');
    await editTelegramMessage(chatId, messageId, '_Proposal cancelled._');
  } else {
    await answerCallbackQuery(callbackQuery.id, 'Unknown action.');
  }

  // Reset session state
  await db.collection(SESSIONS_COLLECTION).doc(String(chatId)).update({
    conversationState: 'idle',
    pendingApprovalId: null,
  }).catch(() => { /* non-fatal */ });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function _getSession(db, chatId) {
  try {
    const snap = await db.collection(SESSIONS_COLLECTION).doc(String(chatId)).get();
    return snap.exists ? { ...snap.data(), chatId } : null;
  } catch (e) {
    console.error('[telegramWebhook] getSession error:', e?.message);
    return null;
  }
}

function _randomCode(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function _todayIso() {
  return new Date().toISOString().split('T')[0];
}

function _nextWeekdayIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

/** Escape Markdown special characters for Telegram Markdown mode. */
function _esc(text) {
  if (!text) return '';
  // In Telegram's legacy Markdown mode only * _ ` [ need escaping in limited contexts.
  // We replace stray * and _ that aren't part of intended formatting.
  return String(text).replace(/([_*`])/g, '\\$1');
}

function _helpText() {
  return [
    '*BOB Assistant*',
    '',
    'Commands:',
    '/top3 — Your top 3 priorities today',
    '/today — Full day context (sprint, calendar, priorities)',
    '/help — This message',
    '',
    'Or just send a message:',
    '"Add task: book swim coaching"',
    '"Log: feeling flat, slept 9 hours"',
    '"Move overdue tasks to next week"',
  ].join('\n');
}
