/**
 * Agentic Ironman Coach — Orchestrator
 *
 * Scheduled daily at 05:00 Europe/London. For each active user:
 *  1. Computes Readiness Score (R) from HRV + sleep
 *  2. Adapts next fitness calendar_block accordingly
 *  3. Calculates dynamic macros from HealthKit + tomorrow's training load
 *  4. Determines active phase from the Ironman goal hierarchy
 *  5. Writes coach_daily/{uid}_{date}
 *
 * Also exports:
 *  - logHealthMetric   (callable) — iOS writes HRV + sleep
 *  - getCoachToday     (callable) — returns today's coach state (hydrates if absent)
 *  - provisionIronmanGoals (callable) — idempotent goal hierarchy setup
 *  - analyzeBodyPhoto  (callable) — Vision AI body fat estimation
 *  - sendCoachNudges   (two schedulers) — 12:00 + 18:00 macro nudges
 */

'use strict';

const admin = require('firebase-admin');
const { randomUUID } = require('crypto');
const httpsV2 = require('firebase-functions/v2/https');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const { DateTime } = require('luxon');
const TZ = 'Europe/London';
const REGION = 'europe-west2';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function db() {
  return admin.firestore();
}

function todayStr(tz = TZ) {
  return DateTime.now().setZone(tz).toISODate();
}

function weekStartMs(tz = TZ) {
  const now = DateTime.now().setZone(tz);
  return now.startOf('week').toMillis(); // Monday
}

/** Send a Telegram message via the existing telegramWebhook helper */
async function sendTelegram(chatId, text) {
  try {
    const { sendTelegramMessage } = require('../agent/telegramWebhook');
    await sendTelegramMessage(chatId, text);
  } catch (e) {
    console.warn('[coach] sendTelegram failed:', e?.message);
  }
}

/** Write a structured event to integration_logs for observability */
async function logCoachEvent(uid, event, metadata = {}) {
  try {
    await db().collection('integration_logs').add({
      integration: 'coach_scheduler',
      event,
      ownerUid: uid,
      metadata,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn(`[coachOrchestrator] logCoachEvent failed: ${e?.message}`);
  }
}

/** Get all Telegram-linked chat IDs for a uid */
async function getTelegramChatId(uid) {
  const snap = await db()
    .collection('telegram_sessions')
    .where('uid', '==', uid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data()?.chatId || null;
}

/** Determine training type from a calendar block title */
function inferTrainingType(title = '') {
  const t = title.toLowerCase();
  if (!title || t.includes('rest') || t.includes('recovery') || t.includes('mobility')) return 'rest';
  if (t.includes('long run') || t.includes('long bike') || t.includes('long ride') || t.includes('long swim')) return 'long_endurance';
  if (t.includes('interval') || t.includes('threshold') || t.includes('tempo') || t.includes('vo2')) return 'threshold';
  return 'zone2';
}

/** Carb target in g/kg body-weight based on training type */
function carbsPerKg(trainingType) {
  switch (trainingType) {
    case 'rest':            return 3;
    case 'zone2':           return 5;
    case 'threshold':       return 6;
    case 'long_endurance':  return 8;
    default:                return 5;
  }
}

// ─── Anthropic Vision ─────────────────────────────────────────────────────────

async function _callAnthropicVision(base64Data, mimeType, systemPrompt) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64Data },
            },
            { type: 'text', text: 'Analyze this physique image and return the JSON as instructed.' },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${err}`);
  }
  const json = await resp.json();
  return json.content?.[0]?.text || '';
}

// ─── Core per-user orchestration ──────────────────────────────────────────────

async function _runOrchestratorForUser(uid) {
  const firestore = db();
  const today = todayStr();
  const todayDt = DateTime.now().setZone(TZ);
  const docId = `${uid}_${today}`;

  // 1. Load profile
  const profileSnap = await firestore.collection('profiles').doc(uid).get();
  const profile = profileSnap.data() || {};

  // 2. HRV + sleep — prefer health_metrics (written by iOS), fall back to fitness_overview
  const [hmSnap, fitnessOverviewSnap] = await Promise.all([
    firestore.collection('health_metrics').doc(docId).get(),
    firestore.collection('fitness_overview').doc(uid).get(),
  ]);
  const hm = hmSnap.exists ? hmSnap.data() : {};
  const fitnessOverview = fitnessOverviewSnap.exists ? fitnessOverviewSnap.data() : {};

  const hrvToday = hm.hrvMs ?? null;
  const sleepToday = hm.sleepDurationH ?? null;

  // 3. HRV 7-day average — use fitness_overview.hrv.last7Avg (already computed nightly)
  //    Fall back to querying health_metrics if not available
  let hrv7dAvg = fitnessOverview?.hrv?.last7Avg ?? null;
  if (hrv7dAvg === null) {
    const sevenDaysAgo = todayDt.minus({ days: 7 }).toISODate();
    const hmHistSnap = await firestore
      .collection('health_metrics')
      .where('uid', '==', uid)
      .where('date', '>=', sevenDaysAgo)
      .get();
    const hrvValues = hmHistSnap.docs
      .map(d => d.data().hrvMs)
      .filter(v => typeof v === 'number' && v > 0);
    hrv7dAvg = hrvValues.length > 0
      ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length
      : null;
  }

  // 4. Readiness score R
  // If Apple Health provides a readiness score (0-100), use it as the primary signal.
  // Otherwise compute from HRV + sleep.
  const appleReadiness = profile.healthkitReadinessScore ?? null; // 0-100
  let readinessScore;
  if (appleReadiness !== null) {
    readinessScore = Math.min(1.0, appleReadiness / 100);
  } else {
    const w1 = 0.6, w2 = 0.4;
    const hrvRatio = (hrvToday !== null && hrv7dAvg && hrv7dAvg > 0)
      ? hrvToday / hrv7dAvg : 1.0;
    const sleepRatio = (sleepToday !== null) ? sleepToday / 8.0 : 1.0;
    readinessScore = Math.min(1.0, w1 * hrvRatio + w2 * sleepRatio);
  }
  const readinessLabel = readinessScore >= 0.8 ? 'green' : readinessScore >= 0.6 ? 'amber' : 'red';

  // 5. Find next fitness calendar block
  const nowMs = Date.now();
  const blockSnap = await firestore
    .collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>', nowMs)
    .orderBy('start', 'asc')
    .limit(20)
    .get();

  let adaptedBlockId = null;
  let adaptationAction = 'none';
  let todayBlockTitle = 'No training scheduled';

  const fitnessBlock = blockSnap.docs.find(d => {
    const data = d.data();
    const cat = (data.category || data.theme || '').toLowerCase();
    return cat.includes('fitness') || cat.includes('sport') || cat.includes('training') || cat.includes('health');
  });

  if (fitnessBlock) {
    const blockData = fitnessBlock.data();
    todayBlockTitle = blockData.title || 'Training';

    if (readinessScore < 0.6) {
      adaptationAction = 'rest_recovery';
      adaptedBlockId = fitnessBlock.id;
      await fitnessBlock.ref.update({
        title: `[AI ADAPTED] Rest / Active Recovery`,
        rationale: 'Readiness score critical — full rest prescribed by coach.',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      todayBlockTitle = '[AI ADAPTED] Rest / Active Recovery';
    } else if (readinessScore < 0.8) {
      adaptationAction = 'reduce_load';
      adaptedBlockId = fitnessBlock.id;
      const newTitle = blockData.title.startsWith('[AI ADAPTED]')
        ? blockData.title
        : `[AI ADAPTED] ${blockData.title}`;
      await fitnessBlock.ref.update({
        title: newTitle,
        rationale: `${blockData.rationale || ''} (load -30% — readiness ${Math.round(readinessScore * 100)}%)`.trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      todayBlockTitle = newTitle;
    }
  }

  // 6. Find tomorrow's training type for carb scaling
  const tomorrowStart = todayDt.plus({ days: 1 }).startOf('day').toMillis();
  const tomorrowEnd = todayDt.plus({ days: 2 }).startOf('day').toMillis();
  const tomorrowSnap = await firestore
    .collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', tomorrowStart)
    .where('start', '<', tomorrowEnd)
    .limit(10)
    .get();

  const tomorrowFitnessBlock = tomorrowSnap.docs.find(d => {
    const data = d.data();
    const cat = (data.category || data.theme || '').toLowerCase();
    return cat.includes('fitness') || cat.includes('sport') || cat.includes('training') || cat.includes('health');
  });
  const tomorrowTrainingType = tomorrowFitnessBlock
    ? inferTrainingType(tomorrowFitnessBlock.data().title)
    : 'rest';

  // 7. Macros — targets computed from LBM; actuals from HealthKit profile snapshot
  const weightKg = profile.healthkitWeightKg ?? profile.manualWeightKg ?? 79;
  const bodyFatPct = profile.healthkitBodyFatPct ?? profile.manualBodyFatPct ?? null;
  const lbm = bodyFatPct !== null ? weightKg * (1 - bodyFatPct / 100) : weightKg * 0.80;
  const proteinG = Math.round(2.0 * lbm);
  const carbG = Math.round(carbsPerKg(tomorrowTrainingType) * weightKg);
  // TDEE: prefer a static estimate since HealthKit calories = consumed, not burned
  const tdeeKcal = 2500; // reasonable default; override with profile.tdeeKcal if set
  const proteinKcal = proteinG * 4;
  const carbKcal = carbG * 4;
  const fatG = Math.max(40, Math.round((tdeeKcal - proteinKcal - carbKcal) / 9));

  // Actuals — read directly from HealthKit snapshot fields already mirrored to profiles
  const proteinActualG = profile.healthkitProteinTodayG ?? profile.manualProteinG ?? null;
  const carbActualG = profile.healthkitCarbsTodayG ?? profile.manualCarbsG ?? null;
  const fatActualG = profile.healthkitFatTodayG ?? profile.manualFatG ?? null;

  // 8. Muscle atrophy guardrail
  let muscleAtrophyAlert = false;
  const weightLastWeekDocId = `${uid}_${todayDt.minus({ days: 7 }).toISODate()}`;
  const wlSnap = await firestore.collection('health_metrics').doc(weightLastWeekDocId).get();
  const weightLastWeek = wlSnap.exists ? wlSnap.data()?.weightKg : null;
  const proteinToday = profile.healthkitProteinTodayG ?? null;
  if (weightLastWeek && weightKg && (weightLastWeek - weightKg) > 1 &&
      proteinToday !== null && proteinToday < proteinG * 0.9) {
    muscleAtrophyAlert = true;
  }

  // 9. Active phase
  const umbrellaGoalId = profile.ironmanUmbrellaGoalId ?? null;
  let phaseRef = {
    phaseIndex: 0,
    phaseName: 'Phase 0 — Base Building',
    umbrellaGoalId: umbrellaGoalId || '',
    phaseGoalId: '',
    dayInPhase: 0,
    totalDaysInPhase: 90,
  };

  if (umbrellaGoalId) {
    const phasesSnap = await firestore
      .collection('goals')
      .where('ownerUid', '==', uid)
      .where('parentGoalId', '==', umbrellaGoalId)
      .get();

    const nowMs2 = Date.now();
    const phases = phasesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(g => g.startDate && g.endDate)
      .sort((a, b) => a.startDate - b.startDate);

    const activePhase = phases.find(p => p.startDate <= nowMs2 && p.endDate >= nowMs2)
      || phases[0];

    if (activePhase) {
      const phaseIdx = phases.indexOf(activePhase);
      const dayInPhase = Math.max(0, Math.ceil((nowMs2 - activePhase.startDate) / 86400000));
      const totalDays = Math.ceil((activePhase.endDate - activePhase.startDate) / 86400000);
      phaseRef = {
        phaseIndex: phaseIdx,
        phaseName: activePhase.title,
        umbrellaGoalId,
        phaseGoalId: activePhase.id,
        dayInPhase,
        totalDaysInPhase: totalDays,
      };

      // Phase transition check — update FocusGoal leaf if we just entered a new phase
      const prevDayMs = nowMs2 - 86400000;
      const prevPhase = phases.find(p => p.startDate <= prevDayMs && p.endDate >= prevDayMs);
      if (prevPhase && prevPhase.id !== activePhase.id) {
        // Just transitioned — update FocusGoal
        const fgSnap = await firestore
          .collection('focusGoals')
          .where('ownerUid', '==', uid)
          .where('isActive', '==', true)
          .limit(1)
          .get();
        if (!fgSnap.empty) {
          const fg = fgSnap.docs[0];
          const fgData = fg.data();
          const newLeafIds = [
            ...(fgData.focusLeafGoalIds || []).filter(id => id !== prevPhase.id),
            activePhase.id,
          ];
          const newGoalIds = [
            ...(fgData.goalIds || []).filter(id => id !== prevPhase.id),
            activePhase.id,
          ];
          await fg.ref.update({
            focusLeafGoalIds: newLeafIds,
            goalIds: newGoalIds,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        // Send phase transition Telegram notification
        const chatId = await getTelegramChatId(uid);
        if (chatId) {
          const targets = phases[phaseIdx]?.kpis?.map(k => `${k.name}: ${k.target}${k.unit}`).join(' | ') || '';
          await sendTelegram(chatId,
            `🚀 Phase Transition!\nYou're now in ${activePhase.title}.\nNew weekly targets: ${targets}`
          );
        }
      }
    }
  }

  // 10. Weekly photo prompt (Mondays)
  const weeklyPhotoPromptActive = todayDt.weekday === 1;
  if (weeklyPhotoPromptActive) {
    const weekKey = `${todayDt.year}-W${String(todayDt.weekNumber).padStart(2, '0')}`;
    await firestore.collection('coach_weekly_prompts').doc(uid).set({
      uid, weekKey, promptActive: true, dismissedAt: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // 11. Muscle atrophy alert via Telegram
  if (muscleAtrophyAlert) {
    const chatId = await getTelegramChatId(uid);
    if (chatId) {
      await sendTelegram(chatId,
        `⚠️ Coach Alert — Muscle Atrophy Risk!\nWeight dropped >1kg this week & protein compliance is low.\nTarget: ${proteinG}g protein today. Prioritise your intake!`
      );
    }
  }

  // 12a. Load today's fitness programme from cache
  let todayProgramme = null;
  try {
    const cacheSnap = await firestore.collection('fitness_programme_cache').doc(uid).get();
    if (cacheSnap.exists) {
      const cache = cacheSnap.data();
      todayProgramme = {
        runner: (cache.runnerEvents || []).find(e => e.date === today) || null,
        crossFit: (cache.crossFitEvents || []).find(e => e.date === today) || null,
      };
    }
  } catch (e) {
    console.warn('[coachOrchestrator] fitness cache read failed:', e?.message);
  }

  // 12b. Pre-render briefing text
  const readinessPct = Math.round(readinessScore * 100);
  const progParts = [];
  if (todayProgramme?.runner) {
    progParts.push(`Run: ${todayProgramme.runner.title} (${todayProgramme.runner.durationMin}min)`);
  }
  if (todayProgramme?.crossFit) {
    progParts.push(`CrossFit: ${todayProgramme.crossFit.title}`);
  }
  const programmeLine = progParts.length > 0 ? `\nProgramme: ${progParts.join(' + ')}` : '';

  const briefingText =
    `🏊 Coach Briefing\n` +
    `HRV: ${hrvToday !== null ? `${Math.round(hrvToday)}ms` : 'n/a'} (${readinessLabel === 'green' ? '🟢' : readinessLabel === 'amber' ? '🟡' : '🔴'} ${readinessPct}%). ` +
    `Sleep: ${sleepToday !== null ? `${sleepToday.toFixed(1)}h` : 'n/a'}.\n` +
    `Today: ${todayBlockTitle}.\n` +
    `Targets: P:${proteinG}g C:${carbG}g F:${fatG}g\n` +
    `R-Score: ${(readinessScore).toFixed(2)}` +
    programmeLine;

  // 13. Write coach_daily
  const coachDailyData = {
    uid,
    date: today,
    readinessScore,
    readinessLabel,
    hrvToday,
    hrv7dAvg: hrv7dAvg !== null ? Math.round(hrv7dAvg) : null,
    sleepToday,
    adaptedBlockId,
    adaptationAction,
    macros: {
      proteinG, carbG, fatG,
      tdeeKcal,
      tomorrowTrainingType,
      // Actuals from HealthKit (null if not yet logged today)
      proteinActualG,
      carbActualG,
      fatActualG,
    },
    phase: phaseRef,
    // Fitness overview fields surfaced for the UI
    fitnessScore: fitnessOverview?.fitnessScore ?? null,
    fitnessLevel: fitnessOverview?.fitnessLevel ?? null,
    weeklyRunKm: fitnessOverview?.sportTotals?.last30?.runKm ?? null,
    weeklyBikeKm: fitnessOverview?.sportTotals?.last30?.bikeKm ?? null,
    weeklySwimKm: fitnessOverview?.sportTotals?.last30?.swimKm ?? null,
    currentBodyFatPct: bodyFatPct,
    currentWeightKg: weightKg,
    briefingText,
    todayProgramme,
    weeklyPhotoPromptActive,
    muscleAtrophyAlert,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await firestore.collection('coach_daily').doc(docId).set(
    { ...coachDailyData, createdAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return coachDailyData;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Nightly orchestration — 05:00 Europe/London
 */
exports.runCoachOrchestratorNightly = schedulerV2.onSchedule(
  { schedule: '0 5 * * *', timeZone: TZ, region: REGION },
  async () => {
    const firestore = db();
    // Process all users with Strava connected or Telegram linked
    const [stravaSnap, telegramSnap] = await Promise.all([
      firestore.collection('profiles').where('stravaConnected', '==', true).get(),
      firestore.collection('telegram_sessions').get(),
    ]);

    const telegramUids = new Set(telegramSnap.docs.map(d => d.data()?.uid).filter(Boolean));
    const allUids = new Set([
      ...stravaSnap.docs.map(d => d.id),
      ...telegramUids,
    ]);

    console.log(`[coachOrchestrator] Processing ${allUids.size} users`);

    for (const uid of allUids) {
      try {
        await _runOrchestratorForUser(uid);
      } catch (e) {
        console.error(`[coachOrchestrator] Failed for uid=${uid}:`, e?.message);
      }
    }
  }
);

/**
 * iOS callable — write HRV + sleep to health_metrics
 */
exports.logHealthMetric = httpsV2.onCall({ region: REGION }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const { date, hrvMs, sleepDurationH, restingHr, sleepScore, weightKg, source } = req.data || {};
  if (!date) throw new httpsV2.HttpsError('invalid-argument', 'date is required (YYYY-MM-DD)');
  if (hrvMs === undefined && sleepDurationH === undefined && weightKg === undefined) {
    throw new httpsV2.HttpsError('invalid-argument', 'At least one metric (hrvMs, sleepDurationH, weightKg) required');
  }

  const docId = `${uid}_${date}`;
  const payload = {
    uid, date,
    source: source || 'ios_app',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (hrvMs !== undefined) payload.hrvMs = hrvMs;
  if (sleepDurationH !== undefined) payload.sleepDurationH = sleepDurationH;
  if (restingHr !== undefined) payload.restingHr = restingHr;
  if (sleepScore !== undefined) payload.sleepScore = sleepScore;

  // Also mirror weightKg to profiles for macro engine
  const writes = [
    db().collection('health_metrics').doc(docId).set(
      { ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    ),
  ];
  if (weightKg !== undefined) {
    writes.push(
      db().collection('profiles').doc(uid).update({
        healthkitWeightKg: weightKg,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );
  }

  await Promise.all(writes);
  return { ok: true, docId };
});

/**
 * Callable — return today's coach state (hydrates if absent)
 */
exports.getCoachToday = httpsV2.onCall({ region: REGION }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const today = todayStr();
  const docId = `${uid}_${today}`;

  try {
    const snap = await db().collection('coach_daily').doc(docId).get();

    let data;
    if (snap.exists) {
      data = snap.data();
    } else {
      // Only hydrate if user has an umbrella goal — avoids errors for unprovisiond users
      const profileSnap = await db().collection('profiles').doc(uid).get();
      if (!profileSnap.data()?.ironmanUmbrellaGoalId) {
        return { notProvisioned: true };
      }
      data = await _runOrchestratorForUser(uid);
    }

    return {
      readiness: {
        score: data.readinessScore,
        label: data.readinessLabel,
        hrvToday: data.hrvToday,
        hrv7dAvg: data.hrv7dAvg,
        sleepToday: data.sleepToday,
      },
      macros: data.macros,
      todayTraining: {
        blockId: data.adaptedBlockId,
        title: (data.briefingText || '').split('\n')[2]?.replace('Today: ', '').replace('.', '') || 'No training scheduled',
        adapted: data.adaptationAction !== 'none',
        adaptationAction: data.adaptationAction,
      },
      phase: data.phase,
      weeklyPhotoPrompt: data.weeklyPhotoPromptActive,
      briefingText: data.briefingText,
    };
  } catch (e) {
    console.error(`[coachOrchestrator] getCoachToday failed uid=${uid}:`, e?.message);
    await logCoachEvent(uid, 'get_coach_today_error', { error: e?.message });
    throw new httpsV2.HttpsError('internal', `Coach data unavailable: ${e?.message}`);
  }
});

/**
 * Callable — idempotent Ironman goal hierarchy setup
 *
 * Race date is derived from the user's active personal FocusGoal endDate.
 * If no active FocusGoal exists, req.data.raceDate is used as a fallback.
 * req.data: { raceDate?: 'YYYY-MM-DD' }
 */
exports.provisionIronmanGoals = httpsV2.onCall({ region: REGION }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const { raceDate: raceDateOverride, raceEvents = [] } = req.data || {};
  console.log(`[coachOrchestrator] provisionIronmanGoals uid=${uid} raceDate=${raceDateOverride || 'none'}`);
  await logCoachEvent(uid, 'provision_started', { raceDate: raceDateOverride || null });
  const firestore = db();

  // Derive race date from the active FocusGoal endDate
  let raceDate = raceDateOverride || null;
  let sourceFocusGoalId = null;

  const activeFgSnap = await firestore
    .collection('focusGoals')
    .where('ownerUid', '==', uid)
    .where('isActive', '==', true)
    .where('persona', '==', 'personal')
    .orderBy('endDate', 'desc')
    .limit(1)
    .get();

  if (!activeFgSnap.empty) {
    const fg = activeFgSnap.docs[0];
    sourceFocusGoalId = fg.id;
    const fgData = fg.data();
    // endDate may be a Firestore Timestamp or a ms number
    const endDateMs = fgData.endDate?.toMillis
      ? fgData.endDate.toMillis()
      : typeof fgData.endDate === 'number'
        ? fgData.endDate
        : null;
    if (endDateMs) {
      raceDate = DateTime.fromMillis(endDateMs).setZone(TZ).toISODate();
    }
  }

  if (!raceDate) {
    throw new httpsV2.HttpsError(
      'invalid-argument',
      'No active FocusGoal found and no raceDate provided. ' +
      'Either create a FocusGoal with an end date or pass raceDate.'
    );
  }

  // Guard — already provisioned?
  const existingSnap = await firestore
    .collection('goals')
    .where('ownerUid', '==', uid)
    .where('title', '==', 'Ironman 2027')
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const umbrellaId = existingSnap.docs[0].id;
    const phasesSnap = await firestore
      .collection('goals')
      .where('ownerUid', '==', uid)
      .where('parentGoalId', '==', umbrellaId)
      .get();
    const fgSnap = await firestore
      .collection('focusGoals')
      .where('ownerUid', '==', uid)
      .where('isActive', '==', true)
      .limit(1)
      .get();
    await logCoachEvent(uid, 'provision_complete', { umbrellaId, alreadyExisted: true });
    return {
      ok: true,
      alreadyExisted: true,
      umbrellaGoalId: umbrellaId,
      phaseGoalIds: phasesSnap.docs.sort((a, b) => a.data().startDate - b.data().startDate).map(d => d.id),
      focusGoalId: fgSnap.empty ? null : fgSnap.docs[0].id,
    };
  }

  const raceDateMs = new Date(raceDate).getTime();
  const now = Date.now();
  const nowDt = DateTime.now().setZone(TZ);

  // Phase date boundaries (split 18-month window backward from race date)
  const phase0Start = now;
  const phase0End = nowDt.plus({ days: 90 }).toMillis();
  const phase1Start = phase0End + 86400000;
  const phase1End = nowDt.plus({ days: 240 }).toMillis();
  const phase2Start = phase1End + 86400000;
  const phase2End = nowDt.plus({ days: 420 }).toMillis();
  const phase3Start = phase2End + 86400000;
  const phase3End = raceDateMs;

  const ts = admin.firestore.FieldValue.serverTimestamp();

  // Create umbrella goal
  const umbrellaRef = await firestore.collection('goals').add({
    ownerUid: uid,
    persona: 'personal',
    theme: 1, // Health
    size: 3,
    confidence: 2,
    goalKind: 'umbrella',
    timeHorizon: 'multi_year',
    rollupMode: 'children_only',
    title: 'Ironman 2027',
    description: 'Complete a full Ironman triathlon and reach 15% body fat.',
    status: 1, // Work in Progress
    startDate: now,
    endDate: raceDateMs,
    targetDate: raceDate,
    timeToMasterHours: 500,
    kpis: [
      { name: 'Body fat %', target: 15, unit: '%' },
      { name: 'Race completion', target: 1, unit: 'race' },
    ],
    kpisV2: [
      {
        id: randomUUID(),
        name: 'Body fat %',
        type: 'custom',
        timeframe: 'monthly',
        target: 15,
        unit: '%',
        targetDirection: 'decrease',
        sourceCollection: 'profiles',
        sourceFieldPath: 'healthkitBodyFatPct',
        designerMode: 'curated',
        visualizationType: 'metric',
        displayOnDashboard: true,
        tags: ['ironman'],
      },
    ],
    createdAt: ts,
    updatedAt: ts,
  });
  const umbrellaGoalId = umbrellaRef.id;

  // Phase definitions
  const phases = [
    {
      title: 'Phase 0 — Base Building',
      description: 'Establish aerobic foundation and begin body recomposition. Months 1-3.',
      startDate: phase0Start,
      endDate: phase0End,
      timeToMasterHours: 100,
      kpis: [
        { name: 'Weekly run km', target: 30, unit: 'km' },
        { name: 'Weekly swim km', target: 4, unit: 'km' },
        { name: 'Body fat %', target: 20, unit: '%' },
      ],
      kpisV2: [
        { id: randomUUID(), name: 'Weekly running distance', type: 'fitness_running', timeframe: 'weekly', target: 30, unit: 'km', targetDirection: 'increase', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'run'] },
        { id: randomUUID(), name: 'Weekly swim distance', type: 'fitness_swimming', timeframe: 'weekly', target: 4, unit: 'km', targetDirection: 'increase', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'swim'] },
        { id: randomUUID(), name: 'Body fat %', type: 'custom', timeframe: 'monthly', target: 20, unit: '%', targetDirection: 'decrease', sourceCollection: 'profiles', sourceFieldPath: 'healthkitBodyFatPct', designerMode: 'curated', visualizationType: 'metric', displayOnDashboard: true, tags: ['ironman', 'body-composition'] },
      ],
    },
    {
      title: 'Phase 1 — Build',
      description: 'Sport-specific volume and strength. Months 4-8.',
      startDate: phase1Start,
      endDate: phase1End,
      timeToMasterHours: 180,
      kpis: [
        { name: 'Weekly bike km', target: 150, unit: 'km' },
        { name: 'Weekly swim km', target: 8, unit: 'km' },
        { name: 'Weekly run km', target: 50, unit: 'km' },
      ],
      kpisV2: [
        { id: randomUUID(), name: 'Weekly cycling distance', type: 'fitness_cycling', timeframe: 'weekly', target: 150, unit: 'km', targetDirection: 'increase', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'bike'] },
        { id: randomUUID(), name: 'Weekly swim distance', type: 'fitness_swimming', timeframe: 'weekly', target: 8, unit: 'km', targetDirection: 'increase', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'swim'] },
        { id: randomUUID(), name: 'Weekly running distance', type: 'fitness_running', timeframe: 'weekly', target: 50, unit: 'km', targetDirection: 'increase', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'run'] },
      ],
    },
    {
      title: 'Phase 2 — Peak',
      description: 'Race simulation and peak performance. Months 9-14.',
      startDate: phase2Start,
      endDate: phase2End,
      timeToMasterHours: 200,
      kpis: [
        { name: 'Long run km', target: 32, unit: 'km' },
        { name: 'Weekly bike km', target: 200, unit: 'km' },
        { name: 'Body fat %', target: 17, unit: '%' },
      ],
      kpisV2: [
        { id: randomUUID(), name: 'Long run distance', type: 'fitness_running', timeframe: 'weekly', target: 32, unit: 'km', targetDirection: 'increase', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'run'] },
        { id: randomUUID(), name: 'Weekly cycling distance', type: 'fitness_cycling', timeframe: 'weekly', target: 200, unit: 'km', targetDirection: 'increase', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'bike'] },
        { id: randomUUID(), name: 'Body fat %', type: 'custom', timeframe: 'monthly', target: 17, unit: '%', targetDirection: 'decrease', sourceCollection: 'profiles', sourceFieldPath: 'healthkitBodyFatPct', designerMode: 'curated', visualizationType: 'metric', displayOnDashboard: true, tags: ['ironman', 'body-composition'] },
      ],
    },
    {
      title: 'Phase 3 — Taper & Race',
      description: 'Controlled taper and race-day execution. Months 15-18.',
      startDate: phase3Start,
      endDate: phase3End,
      timeToMasterHours: 80,
      kpis: [
        { name: 'Body fat %', target: 15, unit: '%' },
        { name: 'Weekly run km', target: 20, unit: 'km' },
      ],
      kpisV2: [
        { id: randomUUID(), name: 'Body fat %', type: 'custom', timeframe: 'monthly', target: 15, unit: '%', targetDirection: 'decrease', sourceCollection: 'profiles', sourceFieldPath: 'healthkitBodyFatPct', designerMode: 'curated', visualizationType: 'metric', displayOnDashboard: true, tags: ['ironman', 'body-composition'] },
        { id: randomUUID(), name: 'Weekly running distance (taper)', type: 'fitness_running', timeframe: 'weekly', target: 20, unit: 'km', targetDirection: 'maintain', sourcePriority: ['strava', 'healthkit'], designerMode: 'curated', visualizationType: 'progress', displayOnDashboard: true, tags: ['ironman', 'run'] },
      ],
    },
  ];

  const phaseGoalIds = [];
  for (const phase of phases) {
    const ref = await firestore.collection('goals').add({
      ownerUid: uid,
      persona: 'personal',
      theme: 1,
      size: 2,
      confidence: 2,
      goalKind: 'milestone',
      timeHorizon: 'quarter',
      parentGoalId: umbrellaGoalId,
      status: 1,
      ...phase,
      createdAt: ts,
      updatedAt: ts,
    });
    phaseGoalIds.push(ref.id);
  }

  // Race event sub-goals (e.g. sprint tri, 70.3) — shown as star markers on timeline
  // Each event is { title, date: 'YYYY-MM-DD' }; auto-assign to the phase that contains that date
  const phaseRanges = [
    { start: phase0Start, end: phase0End, id: phaseGoalIds[0] },
    { start: phase1Start, end: phase1End, id: phaseGoalIds[1] },
    { start: phase2Start, end: phase2End, id: phaseGoalIds[2] },
    { start: phase3Start, end: phase3End, id: phaseGoalIds[3] },
  ];
  for (const event of raceEvents) {
    if (!event?.title || !event?.date) continue;
    const eventMs = new Date(event.date).getTime();
    if (!eventMs || isNaN(eventMs)) continue;
    // Find the phase that contains this date
    const phase = phaseRanges.find(p => eventMs >= p.start && eventMs <= p.end)
      ?? phaseRanges.reduce((best, p) => {
        // Fallback: nearest phase by distance
        const d = Math.abs(eventMs - (p.start + p.end) / 2);
        return d < Math.abs(eventMs - (best.start + best.end) / 2) ? p : best;
      }, phaseRanges[0]);
    await firestore.collection('goals').add({
      ownerUid: uid,
      persona: 'personal',
      theme: 1,
      size: 1,
      confidence: 3,
      goalKind: 'milestone',
      timeHorizon: 'quarter',
      parentGoalId: phase.id,
      raceEvent: true,
      title: event.title,
      description: `Race event: ${event.title}`,
      status: 1,
      startDate: eventMs,
      endDate: eventMs,
      targetDate: event.date,
      createdAt: ts,
      updatedAt: ts,
    });
    console.log(`[coachOrchestrator] created race event "${event.title}" on ${event.date} → phase ${phaseGoalIds.indexOf(phase.id)}`);
  }

  // Save umbrellaGoalId to profile for quick lookup
  await firestore.collection('profiles').doc(uid).update({
    ironmanUmbrellaGoalId: umbrellaGoalId,
    updatedAt: ts,
  });

  // Link to existing active FocusGoal (already loaded above) or create new one
  let focusGoalId;

  if (sourceFocusGoalId) {
    // Extend the existing FocusGoal to include the Ironman umbrella + active phase
    await firestore.collection('focusGoals').doc(sourceFocusGoalId).update({
      goalIds: admin.firestore.FieldValue.arrayUnion(umbrellaGoalId, phaseGoalIds[0]),
      focusRootGoalIds: admin.firestore.FieldValue.arrayUnion(umbrellaGoalId),
      focusLeafGoalIds: admin.firestore.FieldValue.arrayUnion(phaseGoalIds[0]),
      updatedAt: ts,
    });
    focusGoalId = sourceFocusGoalId;
  } else {
    // No active FocusGoal — create a dedicated one for the Ironman programme
    const fgRef = await firestore.collection('focusGoals').add({
      ownerUid: uid,
      persona: 'personal',
      isActive: true,
      timeframe: 'year',
      title: 'Ironman 2027 Programme',
      goalIds: [umbrellaGoalId, phaseGoalIds[0]],
      focusRootGoalIds: [umbrellaGoalId],
      focusLeafGoalIds: [phaseGoalIds[0]],
      startDate: admin.firestore.Timestamp.fromMillis(now),
      endDate: admin.firestore.Timestamp.fromMillis(raceDateMs),
      createdAt: ts,
      updatedAt: ts,
    });
    focusGoalId = fgRef.id;
  }

  console.log(`[coachOrchestrator] provision complete uid=${uid} umbrella=${umbrellaGoalId} phases=${phaseGoalIds.length}`);
  await logCoachEvent(uid, 'provision_complete', { umbrellaGoalId, phaseCount: phaseGoalIds.length, raceDate });
  return { ok: true, alreadyExisted: false, umbrellaGoalId, phaseGoalIds, focusGoalId };
});

/**
 * Callable — Vision AI body fat estimation from uploaded photo
 * req.data: { storagePath: 'coach-photos/{uid}/{timestamp}.jpg' }
 */
exports.analyzeBodyPhoto = httpsV2.onCall({ region: REGION }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const { storagePath } = req.data || {};
  if (!storagePath) throw new httpsV2.HttpsError('invalid-argument', 'storagePath required');

  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);

  // Download and encode
  const [buffer] = await file.download();
  const base64Data = buffer.toString('base64');
  const mimeType = storagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

  // Get a signed download URL (1 hour)
  const [downloadUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
  });

  const timestamp = Date.now();
  const photoDocRef = db()
    .collection('coach_photos')
    .doc(uid)
    .collection('photos')
    .doc(String(timestamp));

  // Write pending state
  await photoDocRef.set({
    uid,
    storagePath,
    downloadUrl,
    estimatedBfPct: null,
    observations: null,
    analysisStatus: 'pending',
    analysisError: null,
    capturedAt: admin.firestore.FieldValue.serverTimestamp(),
    analyzedAt: null,
  });

  // Call Claude Haiku vision
  const systemPrompt =
    'Analyze this male physique (43y, 170cm, 79kg). ' +
    'Estimate body fat % based on abdominal definition and vascularity. ' +
    'Return ONLY valid JSON with no markdown: {"estimated_bf": int, "observations": string}';

  try {
    const raw = await _callAnthropicVision(base64Data, mimeType, systemPrompt);
    const parsed = JSON.parse(raw.trim());
    const estimatedBfPct = parsed.estimated_bf ?? null;
    const observations = parsed.observations ?? null;

    await photoDocRef.update({
      estimatedBfPct,
      observations,
      analysisStatus: 'complete',
      analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, estimatedBfPct, observations, downloadUrl };
  } catch (e) {
    await photoDocRef.update({
      analysisStatus: 'error',
      analysisError: e?.message || 'Unknown error',
    });
    throw new httpsV2.HttpsError('internal', `Vision analysis failed: ${e?.message}`);
  }
});

/**
 * Macro nudge — 12:00 and 18:00 Europe/London
 */
async function _sendMacroNudges() {
  const firestore = db();
  const today = todayStr();

  const sessionsSnap = await firestore.collection('telegram_sessions').get();
  for (const sessionDoc of sessionsSnap.docs) {
    const { uid, chatId } = sessionDoc.data();
    if (!uid || !chatId) continue;

    try {
      const [profileSnap, coachSnap] = await Promise.all([
        firestore.collection('profiles').doc(uid).get(),
        firestore.collection('coach_daily').doc(`${uid}_${today}`).get(),
      ]);

      if (!coachSnap.exists) continue;
      const coachData = coachSnap.data();
      const proteinTarget = coachData?.macros?.proteinG;
      if (!proteinTarget) continue;

      const proteinToday = profileSnap.data()?.healthkitProteinTodayG ?? null;
      if (proteinToday === null || proteinToday >= proteinTarget * 0.60) continue;

      const remaining = Math.round(proteinTarget - proteinToday);
      await sendTelegram(chatId,
        `💪 Macro Check-in\nProtein: ${Math.round(proteinToday)}g / ${proteinTarget}g logged.\n` +
        `You need ${remaining}g more to hit your target today. ` +
        `Grab a protein source! 🥩`
      );
    } catch (e) {
      console.warn(`[coachNudge] uid=${uid} failed:`, e?.message);
    }
  }
}

exports.sendCoachNudgesNoon = schedulerV2.onSchedule(
  { schedule: '0 12 * * *', timeZone: TZ, region: REGION },
  _sendMacroNudges
);

exports.sendCoachNudgesEvening = schedulerV2.onSchedule(
  { schedule: '0 18 * * *', timeZone: TZ, region: REGION },
  _sendMacroNudges
);

// Export internal helper for use by briefing module
exports._runOrchestratorForUser = _runOrchestratorForUser;
exports._sendTelegram = sendTelegram;
exports._getTelegramChatId = getTelegramChatId;
