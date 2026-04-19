'use strict';

/**
 * agentBriefing.js
 *
 * Proactive scheduled Telegram briefings for the BOB Agent Integration Layer.
 *
 * Exports:
 *   sendMorningBriefing — schedulerV2.onSchedule (07:00 Europe/London daily)
 *   sendWeeklyReview    — schedulerV2.onSchedule (18:00 Europe/London Sundays)
 *   triggerBriefingNow  — onCall (manual trigger for testing)
 *
 * Design:
 *   - Queries telegram_sessions for all linked accounts
 *   - Calls getAgentTodayContext per user (bypassCache=true for fresh data)
 *   - Formats a structured markdown message
 *   - Sends via Telegram Bot API (no incoming webhook involved)
 *   - Logs to agent_action_log
 */

const { defineSecret } = require('firebase-functions/params');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const { getAgentTodayContext } = require('./agentContext');
const { sendTelegramMessage } = require('./telegramWebhook');
const { logAgentAction } = require('./agentAudit');

const SESSIONS_COLLECTION = 'telegram_sessions';

// ---------------------------------------------------------------------------
// Morning briefing — 07:00 Europe/London
// ---------------------------------------------------------------------------

exports.sendMorningBriefing = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: 'Europe/London',
    region: 'europe-west2',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    await _runBriefingForAllUsers('morning');
  },
);

// ---------------------------------------------------------------------------
// Weekly review — 18:00 Europe/London on Sundays
// ---------------------------------------------------------------------------

exports.sendWeeklyReview = onSchedule(
  {
    schedule: '0 18 * * 0',
    timeZone: 'Europe/London',
    region: 'europe-west2',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    await _runBriefingForAllUsers('weekly');
  },
);

// ---------------------------------------------------------------------------
// Manual trigger (callable) for testing
// ---------------------------------------------------------------------------

exports.triggerBriefingNow = onCall(
  { region: 'europe-west2' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const type = request.data?.type || 'morning';
    await _runBriefingForUser(uid, type);
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Core briefing logic
// ---------------------------------------------------------------------------

async function _runBriefingForAllUsers(type) {
  const db = admin.firestore();

  const sessionsSnap = await db.collection(SESSIONS_COLLECTION)
    .limit(100) // Reasonable upper bound for a personal app
    .get()
    .catch((e) => {
      console.error('[agentBriefing] Failed to query sessions:', e?.message);
      return { docs: [] };
    });

  if (!sessionsSnap.docs.length) {
    console.log('[agentBriefing] No linked Telegram sessions found.');
    return;
  }

  console.log(`[agentBriefing] Sending ${type} briefing to ${sessionsSnap.docs.length} user(s)`);

  for (const doc of sessionsSnap.docs) {
    const session = doc.data();
    const chatId = parseInt(doc.id, 10);
    if (!session.ownerUid || !chatId) continue;

    try {
      await _runBriefingForUser(session.ownerUid, type, chatId, session);
    } catch (err) {
      console.error(`[agentBriefing] Briefing failed for uid=${session.ownerUid}:`, err?.message);
    }
  }
}

async function _runBriefingForUser(ownerUid, type = 'morning', chatIdOverride = null, sessionOverride = null) {
  const db = admin.firestore();
  const startMs = Date.now();

  // Resolve chatId from session if not provided
  let chatId = chatIdOverride;
  let session = sessionOverride;

  if (!chatId) {
    const sessionsSnap = await db.collection(SESSIONS_COLLECTION)
      .where('ownerUid', '==', ownerUid)
      .limit(1)
      .get()
      .catch(() => ({ docs: [] }));

    if (!sessionsSnap.docs.length) {
      console.warn(`[agentBriefing] No Telegram session for uid=${ownerUid}`);
      return;
    }

    const sessionDoc = sessionsSnap.docs[0];
    chatId = parseInt(sessionDoc.id, 10);
    session = sessionDoc.data();
  }

  const timezone = session?.timezone || 'Europe/London';

  // Fetch fresh context
  const ctx = await getAgentTodayContext(ownerUid, { timezone, bypassCache: true });

  const message = type === 'weekly'
    ? _formatWeeklyMessage(ctx, timezone)
    : _formatMorningMessage(ctx, timezone);

  await sendTelegramMessage(chatId, message);

  await logAgentAction({
    ownerUid,
    source: 'scheduled',
    tool: type === 'weekly' ? 'send_weekly_briefing' : 'send_morning_briefing',
    responseStatus: 'ok',
    responsePayload: { chatId, type },
    durationMs: Date.now() - startMs,
    telegramChatId: chatId,
  });
}

// ---------------------------------------------------------------------------
// Message formatters
// ---------------------------------------------------------------------------

function _formatMorningMessage(ctx, timezone) {
  const greeting = _greeting();
  const dateStr = ctx.date || new Date().toISOString().split('T')[0];

  const lines = [`${greeting} *${dateStr}*`];

  // Sprint
  if (ctx.activeSprint) {
    const sp = ctx.activeSprint;
    lines.push(`\n🏃 *Sprint:* ${_esc(sp.name || 'Active')} — ${sp.daysRemaining ?? '?'}d remaining`);
  }

  // Top 3
  if (ctx.top3?.length) {
    lines.push('\n*🎯 Top priorities:*');
    ctx.top3.forEach((item, i) => {
      const dot = item.priority >= 4 ? '🔴' : item.priority >= 3 ? '🟠' : '🟡';
      lines.push(`${i + 1}. ${dot} ${_esc(item.title)}`);
    });
  } else {
    lines.push('\n_No top priorities set for today._');
  }

  // Calendar
  if (ctx.calendarToday?.length) {
    lines.push('\n*📅 Calendar:*');
    ctx.calendarToday.slice(0, 4).forEach((block) => {
      const start = block.start
        ? new Date(block.start).toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: timezone,
          })
        : '?';
      lines.push(`  ${start} — ${_esc(block.title)}`);
    });
    if (ctx.calendarToday.length > 4) {
      lines.push(`  _+${ctx.calendarToday.length - 4} more_`);
    }
  }

  // Overdue warning
  if (ctx.overdueTaskCount > 0) {
    lines.push(`\n⚠️ *${ctx.overdueTaskCount} overdue* task(s)`);
    if (ctx.overdueTaskTitles?.length) {
      lines.push(`_${ctx.overdueTaskTitles.slice(0, 2).map(_esc).join(', ')}_`);
    }
    lines.push('Send "Move overdue tasks" to triage them.');
  }

  // Focus goal
  const activeGoal = ctx.focusGoals?.find((g) => g.isActive);
  if (activeGoal) {
    const pct = activeGoal.progressPct != null ? ` (${activeGoal.progressPct}%)` : '';
    lines.push(`\n🎯 *Focus:* ${_esc(activeGoal.title)}${pct}`);
  }

  // Capacity warning
  if (ctx.capacityWarning) {
    lines.push(`\n⚠️ ${_esc(ctx.capacityWarning)}`);
  }

  lines.push('\n_Reply with a task, log, or question. /help for commands._');

  return lines.join('\n');
}

function _formatWeeklyMessage(ctx, timezone) {
  const lines = [
    '📊 *Weekly Review*',
    `Week ending ${ctx.date || new Date().toISOString().split('T')[0]}`,
  ];

  if (ctx.top3?.length) {
    lines.push('\n*Coming into next week:*');
    ctx.top3.forEach((item, i) => {
      lines.push(`${i + 1}. ${_esc(item.title)}`);
    });
  }

  if (ctx.goalKpiStatus?.length) {
    lines.push('\n*Goal status:*');
    ctx.goalKpiStatus.slice(0, 5).forEach((g) => {
      const icon = g.tone === 'success' ? '✅' : g.tone === 'danger' ? '❌' : '➖';
      lines.push(`${icon} ${_esc(g.title || '')}${g.label ? ` — ${g.label}` : ''}`);
    });
  }

  lines.push('\n_Send /today for your full day context._');

  return lines.join('\n');
}

function _greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning!';
  if (hour < 17) return 'Good afternoon!';
  return 'Good evening!';
}

function _esc(text) {
  if (!text) return '';
  return String(text).replace(/([_*`])/g, '\\$1');
}
