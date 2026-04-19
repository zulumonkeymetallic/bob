/**
 * Agentic Ironman Coach — Telegram Briefing & Alerts
 *
 * Scheduled functions:
 *  - sendCoachMorningBriefing  07:00 — daily HRV/sleep/macros briefing
 *  - sendWeeklyPhaseProgress   08:00 Sunday — weekly KPI check-in
 *  - checkKpiOffTrack          20:00 Wednesday — mid-week KPI gate
 *
 * Callable functions:
 *  - triggerCoachBriefingNow   — manual test trigger
 *
 * Internal helper exported:
 *  - handleCoachCommand(uid, chatId) — /coach Telegram command handler
 */

'use strict';

const admin = require('firebase-admin');
const httpsV2 = require('firebase-functions/v2/https');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const { DateTime } = require('luxon');

const TZ = 'Europe/London';
const REGION = 'europe-west2';

function db() {
  return admin.firestore();
}

function todayStr(tz = TZ) {
  return DateTime.now().setZone(tz).toISODate();
}

async function sendTelegram(chatId, text) {
  try {
    const { sendTelegramMessage } = require('../agent/telegramWebhook');
    await sendTelegramMessage(chatId, text);
  } catch (e) {
    console.warn('[coachBriefing] sendTelegram failed:', e?.message);
  }
}

/** Load all Telegram-linked sessions as [{uid, chatId}] */
async function getAllLinkedSessions() {
  const snap = await db().collection('telegram_sessions').get();
  return snap.docs
    .map(d => ({ uid: d.data()?.uid, chatId: d.data()?.chatId }))
    .filter(s => s.uid && s.chatId);
}

// ─── Morning Briefing — 07:00 ─────────────────────────────────────────────────

async function _sendMorningBriefingForUser(uid, chatId) {
  const today = todayStr();
  const coachSnap = await db().collection('coach_daily').doc(`${uid}_${today}`).get();
  if (!coachSnap.exists) return;

  const data = coachSnap.data();
  await sendTelegram(chatId, data.briefingText);
}

exports.sendCoachMorningBriefing = schedulerV2.onSchedule(
  { schedule: '0 7 * * *', timeZone: TZ, region: REGION },
  async () => {
    const sessions = await getAllLinkedSessions();
    for (const { uid, chatId } of sessions) {
      try {
        await _sendMorningBriefingForUser(uid, chatId);
      } catch (e) {
        console.warn(`[coachBriefing] morning uid=${uid} failed:`, e?.message);
      }
    }
  }
);

// ─── Weekly Phase Progress — Sunday 08:00 ─────────────────────────────────────

async function _buildWeeklyProgressMessage(uid) {
  const firestore = db();
  const now = DateTime.now().setZone(TZ);
  const weekStartIso = now.startOf('week').toISODate(); // "2026-03-16"

  // Load all data in parallel — use fitness_overview (pre-computed) to avoid re-aggregating
  const [profileSnap, fitnessOverviewSnap] = await Promise.all([
    firestore.collection('profiles').doc(uid).get(),
    firestore.collection('fitness_overview').doc(uid).get(),
  ]);
  const profile = profileSnap.data() || {};
  const fo = fitnessOverviewSnap.exists ? fitnessOverviewSnap.data() : {};
  const umbrellaGoalId = profile.ironmanUmbrellaGoalId;
  if (!umbrellaGoalId) return null;

  const phasesSnap = await firestore
    .collection('goals')
    .where('ownerUid', '==', uid)
    .where('parentGoalId', '==', umbrellaGoalId)
    .get();

  const nowMs = Date.now();
  const activePhase = phasesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.startDate && p.endDate)
    .sort((a, b) => a.startDate - b.startDate)
    .find(p => p.startDate <= nowMs && p.endDate >= nowMs);

  if (!activePhase) return null;

  // Read current week from fitness_overview.weekly[] (pre-aggregated, no 1000-doc query needed)
  const weeklyEntries = fo.weekly || [];
  const thisWeekEntry = weeklyEntries.find(w => w.weekStart === weekStartIso);

  // sport totals: prefer this week's entry, fall back to last-30 / direct query as last resort
  let runKm = 0, bikeKm = 0, swimKm = 0;
  if (thisWeekEntry) {
    // fitness_overview.weekly only stores total distance — split by sport from last30 ratios
    // Use sportTotals.last30 for current week approximation when individual-week sport split unavailable
    const last30 = fo.sportTotals?.last30 || {};
    const totalLast30 = (last30.runKm || 0) + (last30.bikeKm || 0) + (last30.swimKm || 0);
    if (totalLast30 > 0) {
      const weekTotal = thisWeekEntry.distanceKm || 0;
      runKm = weekTotal * ((last30.runKm || 0) / totalLast30);
      bikeKm = weekTotal * ((last30.bikeKm || 0) / totalLast30);
      swimKm = weekTotal * ((last30.swimKm || 0) / totalLast30);
    }
  } else {
    // Fallback: query this week's workouts (only if fitness_overview is stale)
    const weekStartMs = now.startOf('week').toMillis();
    const workoutsSnap = await firestore
      .collection('metrics_workouts')
      .where('ownerUid', '==', uid)
      .where('startDate', '>=', weekStartMs)
      .get();
    for (const doc of workoutsSnap.docs) {
      const w = doc.data();
      const dist = (w.distance_m || 0) / 1000;
      const type = (w.sportType || w.type || '').toLowerCase();
      if (type.includes('run')) runKm += dist;
      else if (type.includes('ride') || type.includes('cyc')) bikeKm += dist;
      else if (type.includes('swim')) swimKm += dist;
    }
  }

  // Body fat from profile (already in profiles from HealthKit sync)
  const bfPct = profile.healthkitBodyFatPct ?? profile.manualBodyFatPct;

  // Build message lines
  const phase = activePhase;
  const kpis = phase.kpisV2 || phase.kpis || [];
  const lines = [`📊 ${phase.title} — Weekly Check-in`];

  for (const kpi of kpis) {
    const name = (kpi.name || '').toLowerCase();
    let actual = null;
    let icon = '';

    if (name.includes('run')) { actual = runKm; icon = '🏃'; }
    else if (name.includes('bike') || name.includes('cyc')) { actual = bikeKm; icon = '🚴'; }
    else if (name.includes('swim')) { actual = swimKm; icon = '🏊'; }
    else if (name.includes('body fat') || name.includes('bf')) { actual = bfPct; icon = '💪'; }

    if (actual === null) continue;
    const target = kpi.target;
    const unit = kpi.unit || '';
    const pct = target > 0 ? actual / target : 1;
    const status = pct >= 1 ? '✓' : pct >= 0.7 ? '⚠️' : '❌';
    lines.push(`${icon} ${kpi.name}: ${actual.toFixed(1)}/${target}${unit} ${status}`);
  }

  lines.push('Keep pushing 🔥');
  return lines.join('\n');
}

exports.sendWeeklyPhaseProgress = schedulerV2.onSchedule(
  { schedule: '0 8 * * 0', timeZone: TZ, region: REGION }, // Sundays
  async () => {
    const sessions = await getAllLinkedSessions();
    for (const { uid, chatId } of sessions) {
      try {
        const msg = await _buildWeeklyProgressMessage(uid);
        if (msg) await sendTelegram(chatId, msg);
      } catch (e) {
        console.warn(`[coachBriefing] weekly uid=${uid} failed:`, e?.message);
      }
    }
  }
);

// ─── Mid-week KPI Gate — Wednesday 20:00 ──────────────────────────────────────

exports.checkKpiOffTrack = schedulerV2.onSchedule(
  { schedule: '0 20 * * 3', timeZone: TZ, region: REGION }, // Wednesdays
  async () => {
    const firestore = db();
    const now = DateTime.now().setZone(TZ);
    const weekStart = now.startOf('week').toMillis();
    const daysLeft = 7 - now.weekday; // days remaining in week

    const sessions = await getAllLinkedSessions();
    for (const { uid, chatId } of sessions) {
      try {
        const [profileSnap, foSnap] = await Promise.all([
          firestore.collection('profiles').doc(uid).get(),
          firestore.collection('fitness_overview').doc(uid).get(),
        ]);
        const profile = profileSnap.data() || {};
        const fo = foSnap.exists ? foSnap.data() : {};
        const umbrellaGoalId = profile.ironmanUmbrellaGoalId;
        if (!umbrellaGoalId) continue;

        const phasesSnap = await firestore
          .collection('goals')
          .where('ownerUid', '==', uid)
          .where('parentGoalId', '==', umbrellaGoalId)
          .get();

        const nowMs = Date.now();
        const activePhase = phasesSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.startDate && p.endDate)
          .sort((a, b) => a.startDate - b.startDate)
          .find(p => p.startDate <= nowMs && p.endDate >= nowMs);

        if (!activePhase) continue;

        // Use fitness_overview sport totals (last30 best available approximation for this week)
        const last30 = fo.sportTotals?.last30 || {};
        const weekStartIso = now.startOf('week').toISODate();
        const weeklyEntries = fo.weekly || [];
        const thisWeekEntry = weeklyEntries.find(w => w.weekStart === weekStartIso);
        let runKm = 0, bikeKm = 0, swimKm = 0;
        if (thisWeekEntry) {
          const totalLast30 = (last30.runKm || 0) + (last30.bikeKm || 0) + (last30.swimKm || 0);
          if (totalLast30 > 0) {
            const wt = thisWeekEntry.distanceKm || 0;
            runKm = wt * ((last30.runKm || 0) / totalLast30);
            bikeKm = wt * ((last30.bikeKm || 0) / totalLast30);
            swimKm = wt * ((last30.swimKm || 0) / totalLast30);
          }
        } else {
          // Fallback to direct query
          const workoutsSnap = await firestore
            .collection('metrics_workouts')
            .where('ownerUid', '==', uid)
            .where('startDate', '>=', weekStart)
            .get();
          for (const doc of workoutsSnap.docs) {
            const w = doc.data();
            const dist = (w.distance_m || 0) / 1000;
            const type = (w.sportType || w.type || '').toLowerCase();
            if (type.includes('run')) runKm += dist;
            else if (type.includes('ride') || type.includes('cyc')) bikeKm += dist;
            else if (type.includes('swim')) swimKm += dist;
          }
        }

        const kpis = activePhase.kpisV2 || activePhase.kpis || [];
        const alerts = [];

        for (const kpi of kpis) {
          const name = (kpi.name || '').toLowerCase();
          let actual = null;
          if (name.includes('run')) actual = runKm;
          else if (name.includes('bike') || name.includes('cyc')) actual = bikeKm;
          else if (name.includes('swim')) actual = swimKm;
          if (actual === null) continue;

          const target = kpi.target;
          if (target > 0 && actual < target * 0.50) {
            alerts.push(`${kpi.name}: ${actual.toFixed(1)}/${target}${kpi.unit || ''} with ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`);
          }
        }

        if (alerts.length > 0) {
          const msg = `⚠️ Coach Alert — KPI at risk:\n${alerts.join('\n')}\nYou've got this! 💪`;
          await sendTelegram(chatId, msg);
        }
      } catch (e) {
        console.warn(`[coachBriefing] KPI gate uid=${uid} failed:`, e?.message);
      }
    }
  }
);

// ─── /coach Telegram command handler ─────────────────────────────────────────

/**
 * Called by telegramWebhook.js when user sends /coach to the bot.
 */
exports.handleCoachCommand = async function handleCoachCommand(uid, chatId) {
  const today = todayStr();
  const coachSnap = await db().collection('coach_daily').doc(`${uid}_${today}`).get();

  if (!coachSnap.exists) {
    // Try to hydrate
    try {
      const { _runOrchestratorForUser } = require('./coachOrchestrator');
      await _runOrchestratorForUser(uid);
      const freshSnap = await db().collection('coach_daily').doc(`${uid}_${today}`).get();
      if (freshSnap.exists) {
        return sendTelegram(chatId, freshSnap.data().briefingText);
      }
    } catch (e) {
      console.warn('[handleCoachCommand] hydration failed:', e?.message);
    }
    return sendTelegram(chatId, '🏊 No coach data yet for today. Try again after 05:00.');
  }

  const data = coachSnap.data();
  const readinessPct = Math.round((data.readinessScore || 0) * 100);
  const rl = data.readinessLabel;
  const emoji = rl === 'green' ? '🟢' : rl === 'amber' ? '🟡' : '🔴';
  const phase = data.phase || {};

  const msg =
    `🏊 Today's Coach Report\n` +
    `Readiness: ${readinessPct}% ${emoji}\n` +
    `HRV: ${data.hrvToday !== null ? `${Math.round(data.hrvToday)}ms` : 'n/a'} | Sleep: ${data.sleepToday !== null ? `${data.sleepToday.toFixed(1)}h` : 'n/a'}\n` +
    `Training: ${(data.briefingText || '').split('\n')[2]?.replace('Today: ', '').replace('.', '') || 'Check calendar'}\n` +
    `Macros: P:${data.macros?.proteinG ?? '?'}g C:${data.macros?.carbG ?? '?'}g F:${data.macros?.fatG ?? '?'}g\n` +
    `Phase: ${phase.phaseName || 'Not set'} (Day ${phase.dayInPhase || 0}/${phase.totalDaysInPhase || '?'})`;

  await sendTelegram(chatId, msg);
};

// ─── Manual trigger (for testing) ────────────────────────────────────────────

exports.triggerCoachBriefingNow = httpsV2.onCall({ region: REGION }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const firestore = db();
  const sessionsSnap = await firestore
    .collection('telegram_sessions')
    .where('uid', '==', uid)
    .limit(1)
    .get();

  if (sessionsSnap.empty) {
    return { ok: false, message: 'No Telegram session linked for this user' };
  }

  const chatId = sessionsSnap.docs[0].data()?.chatId;
  await _sendMorningBriefingForUser(uid, chatId);
  return { ok: true, chatId };
});
