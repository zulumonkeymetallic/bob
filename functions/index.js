// Cloud Functions: server-side Google Calendar OAuth + helpers + stubs
const functionsV2 = require("firebase-functions/v2");
const httpsV2 = require("firebase-functions/v2/https");
const schedulerV2 = require("firebase-functions/v2/scheduler");
const { loadThemesForUser, mapThemeLabelToId } = require('./services/themeManager');
const { defineSecret } = require("firebase-functions/params");
const firestoreV2 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
// OpenAI removed (Gemini-only)
const aiUsageLogger = require("./utils/aiUsageLogger");
const { rrulestr } = require('rrule');
const { DateTime } = require('luxon');
const { planSchedule, makeInstanceId: schedulerMakeInstanceId } = require('./scheduler/engine');
const { computeMonzoAnalytics } = require('./monzo/analytics');
const {
  inferDefaultCategoryType,
  inferDefaultCategoryLabel,
  toMonthKey,
  normaliseMerchantName,
} = require('./monzo/shared');
const DEFAULT_TIMEZONE = 'Europe/London';
const {
  buildDailySummaryData,
  buildDataQualitySnapshot,
  loadSchedulerInputs,
  ensureFirestore,
  resolveTimezone,
} = require('./lib/reporting');
const { renderDailySummaryEmail, renderDataQualityEmail } = require('./lib/templates');
const { importFromSteam, importFromTrakt, importFromGoodreadsLike } = require('./services/mediaImportController');
const { sendEmail } = require('./lib/email');
const { coerceZone, toDateTime } = require('./lib/time');
const crypto = require('crypto');

// Import the daily digest generator
const { generateDailyDigest } = require("./dailyDigestGenerator");

functionsV2.setGlobalOptions({ region: "europe-west2", maxInstances: 10 });
admin.initializeApp();

// Secrets
// Google AI Studio (Gemini)
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
const NYLAS_API_KEY = defineSecret('NYLAS_API_KEY');
const GITHUB_TOKEN = defineSecret('GITHUB_TOKEN');

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

const MS_IN_MINUTE = 60 * 1000;
const MS_IN_DAY = 24 * 60 * 60 * 1000;
const CHORE_LOOKAHEAD_DAYS = 90;
const AI_PRIORITY_MODEL = 'gemini-1.5-flash';

function toMillis(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toDate === 'function') {
    try {
      const d = value.toDate();
      return d instanceof Date ? d.getTime() : null;
    } catch { return null; }
  }
  if (value && typeof value === 'object' && typeof value.seconds === 'number') {
    const seconds = Number(value.seconds);
    const nanos = Number(value.nanoseconds || value.nanos || 0);
    return seconds * 1000 + Math.round(nanos / 1e6);
  }
  return null;
}

function makeRef(type) {
  const prefixMap = { story: 'ST', task: 'TK', goal: 'GR', sprint: 'SP' };
  const prefix = prefixMap[type] || 'ID';
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-4);
  const randomPart = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `${prefix}-${timestampPart}${randomPart}`;
}

async function generateStoryRef(db, ownerUid) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = makeRef('story');
    const snap = await db.collection('stories')
      .where('ownerUid', '==', ownerUid)
      .where('ref', '==', candidate)
      .limit(1)
      .get();
    if (snap.empty) return candidate;
  }
  return `ST-${Date.now().toString(36).toUpperCase()}`;
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
  const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
  const startOfDayMs = dayStart.getTime();
  const endOfDayMs = startOfDayMs + MS_IN_DAY - 1;
  const nowMs = Date.now();

  function scoreTask(t) {
    let score = 0;

    const dueMs = toMillis(t.dueDate);
    if (dueMs) {
      if (dueMs < startOfDayMs) {
        score += 45; // overdue
      } else if (dueMs <= endOfDayMs) {
        score += 38; // due today
      } else {
        const daysUntil = Math.floor((dueMs - endOfDayMs) / MS_IN_DAY) + 1;
        if (daysUntil <= 2) score += 28;
        else if (daysUntil <= 7) score += 18;
        else if (daysUntil <= 14) score += 10;
        else score += 4;
      }
    } else {
      score += 6; // no due date, keep on radar
    }

    const priority = String(t.priority ?? '').toLowerCase();
    if (priority === '1' || priority === 'p1' || priority === 'high' || t.priority === 1) score += 22;
    else if (priority === '2' || priority === 'p2' || priority === 'medium' || t.priority === 2) score += 14;
    else score += 7;

    if (t.effort === 'S') score += 10;
    else if (t.effort === 'M') score += 6;
    else score += 2;

    const createdMs = toMillis(t.reminderCreatedAt) ?? toMillis(t.createdAt) ?? toMillis(t.serverUpdatedAt);
    if (createdMs) {
      const ageDays = Math.floor((nowMs - createdMs) / MS_IN_DAY);
      if (ageDays >= 60) score += 22;
      else if (ageDays >= 30) score += 18;
      else if (ageDays >= 14) score += 14;
      else if (ageDays >= 7) score += 10;
      else if (ageDays >= 3) score += 6;
      else if (ageDays >= 1) score += 3;
    }

    if (t.storyId || (t.parentType === 'story' && t.parentId)) score += 12;
    else if (t.goalId || t.hasGoal) score += 8;
    else score += 3;

    if (t.sprintId) score += 6;
    if (t.source === 'ios_reminder' || t.source === 'MacApp' || t.source === 'mac_app') score += 4;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  let ranked = tasks.map(t => ({ ...t, _score: scoreTask(t) }))
    .sort((a,b) => b._score - a._score);

  const importantSet = new Set();
  const importanceLimit = Number(req?.data?.importantLimit || 12);

  const enriched = ranked.map(t => {
    const dueMs = toMillis(t.dueDate);
    const isOverdue = dueMs ? dueMs < startOfDayMs : false;
    const isDueToday = dueMs ? (dueMs >= startOfDayMs && dueMs <= endOfDayMs) : false;
    const createdMs = toMillis(t.reminderCreatedAt) ?? toMillis(t.createdAt) ?? toMillis(t.serverUpdatedAt);
    const ageDays = createdMs ? Math.floor((nowMs - createdMs) / MS_IN_DAY) : 0;
    const storyLinked = !!(t.storyId || (t.parentType === 'story' && t.parentId));
    const shouldFlag = (
      isOverdue ||
      isDueToday ||
      t._score >= 72 ||
      (storyLinked && t._score >= 58) ||
      (ageDays >= 14 && t._score >= 55)
    );
    if (shouldFlag && importantSet.size < importanceLimit) importantSet.add(t.id);
    return { ...t, _isOverdue: isOverdue, _isDueToday: isDueToday, _ageDays: ageDays, _storyLinked: storyLinked };
  });

  // Ensure at least top 5 tasks are surfaced
  for (const t of enriched.slice(0, 5)) importantSet.add(t.id);

  ranked = enriched;

  const importanceUpdates = [];
  for (const t of ranked) {
    const desiredScore = t._score;
    const desiredImportant = importantSet.has(t.id);
    const existingScore = typeof t.importanceScore === 'number' ? Math.round(t.importanceScore) : null;
    const existingImportant = !!t.isImportant;
    if (existingScore !== desiredScore || existingImportant !== desiredImportant) {
      importanceUpdates.push({
        id: t.id,
        data: {
          importanceScore: desiredScore,
          isImportant: desiredImportant,
          importanceUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      });
    }
  }

  if (importanceUpdates.length && !req?.data?.skipImportanceWrite) {
    const bulk = db.bulkWriter();
    for (const update of importanceUpdates) {
      const ref = db.collection('tasks').doc(update.id);
      bulk.set(ref, update.data, { merge: true });
    }
    await bulk.close();
  }

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

  const importantTasks = ranked
    .filter(t => importantSet.has(t.id))
    .map(t => ({
      id: t.id,
      title: t.title || 'Task',
      score: t._score,
      dueDate: toMillis(t.dueDate),
      ageDays: t._ageDays,
      storyId: t.storyId || null
    }));

  return {
    planId,
    dayKey,
    assignments: assignments.map(a => ({ id: a.id, blockId: a.blockId, status: a.status })),
    importantTasks
  };
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

function coercePersonaTimezone(entity) {
  return entity?.timezone || entity?.recurrence?.timezone || DEFAULT_TIMEZONE;
}

function computeNextDueAt(recurrence = null, dtstart, fromMillis, lookAheadDays = 60) {
  if (!recurrence || !recurrence.rrule) return null;
  const zone = coerceZone(recurrence.timezone);
  const start = DateTime.fromMillis(fromMillis, { zone }).startOf('day');
  const end = start.plus({ days: lookAheadDays }).endOf('day');
  const occurrences = expandRecurrence({ ...recurrence, dtstart }, start, end);
  if (!occurrences.length) return null;
  const next = occurrences.find((occ) => occ.toMillis() >= fromMillis);
  return (next || occurrences[0]).toMillis();
}

function calculateStreakMetrics(entity, completionMillis) {
  const zone = coercePersonaTimezone(entity);
  const last = entity?.lastCompletedAt || null;
  let streak = Number(entity?.completedStreak || 0);
  let longest = Number(entity?.longestStreak || 0);
  if (!last) {
    streak = 1;
    return { streak, longest: Math.max(longest, streak) };
  }
  const lastDay = DateTime.fromMillis(last, { zone }).startOf('day');
  const currentDay = DateTime.fromMillis(completionMillis, { zone }).startOf('day');
  const diff = currentDay.diff(lastDay, 'days').days;
  if (diff <= 0) {
    streak = Number(entity?.completedStreak || 1);
  } else if (diff === 1) {
    streak = Number(entity?.completedStreak || 0) + 1;
  } else {
    streak = 1;
  }
  longest = Math.max(longest, streak);
  return { streak, longest };
}

async function getChoresCollection(uid) {
  const db = admin.firestore();
  const snap = await db.collection('chores').where('ownerUid', '==', uid).get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

async function getRoutinesCollection(uid) {
  const db = admin.firestore();
  const snap = await db.collection('routines').where('ownerUid', '==', uid).get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
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
    const schedulingContext = {
      solverRunId: plan.solverRunId,
      policyMode: 'policyMode' in unscheduled ? unscheduled.policyMode || null : null,
    };
    if (unscheduled.deepLink) {
      schedulingContext.deepLink = unscheduled.deepLink;
    }
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
      deepLink: unscheduled.deepLink || null,
      mobileCheckinUrl: unscheduled.mobileCheckinUrl || null,
      schedulingContext,
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

// ===== Chores & Routines Helpers
exports.listChoresWithStats = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const db = admin.firestore();
  const [chores, trackerSnap] = await Promise.all([
    getChoresCollection(uid),
    db.collection('users').doc(uid).collection('tracker').doc('choreStats').get().catch(() => null),
  ]);
  const trackerData = trackerSnap?.exists ? trackerSnap.data() || {} : {};
  const now = Date.now();
  const items = chores.map((chore) => {
    const dtstart = toMillis(chore.recurrence?.dtstart || chore.dtstart || chore.createdAt);
    const nextComputed = computeNextDueAt(chore.recurrence, dtstart, Math.max(now, Number(chore.nextDueAt || now)), CHORE_LOOKAHEAD_DAYS);
    const stats = {
      completedStreak: Number(chore.completedStreak || 0),
      longestStreak: Number(chore.longestStreak || 0),
      completedCount: Number(chore.completedCount || 0),
      missedCount: Number(chore.missedCount || 0),
      lastCompletedAt: chore.lastCompletedAt || null,
      nextDueAt: chore.nextDueAt || nextComputed || null,
    };
    return {
      id: chore.id,
      title: chore.title || 'Chore',
      cadence: chore.recurrence?.rrule || null,
      durationMinutes: Number(chore.durationMinutes || 15),
      priority: chore.priority || 3,
      tags: chore.tags || [],
      requiredBlockId: chore.requiredBlockId || null,
      eligibleBlockIds: chore.eligibleBlockIds || [],
      policy: chore.policy || null,
      timezone: coercePersonaTimezone(chore),
      stats,
      tracker: trackerData?.[chore.id] || null,
    };
  });
  return { items };
});

exports.listRoutinesWithStats = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const [routines, trackerSnap] = await Promise.all([
    getRoutinesCollection(uid),
    admin.firestore().collection('users').doc(uid).collection('tracker').doc('routineStats').get().catch(() => null),
  ]);
  const trackerData = trackerSnap?.exists ? trackerSnap.data() || {} : {};
  const now = Date.now();
  const items = routines.map((routine) => {
    const dtstart = toMillis(routine.recurrence?.dtstart || routine.dtstart || routine.createdAt);
    const nextComputed = computeNextDueAt(routine.recurrence, dtstart, Math.max(now, Number(routine.nextDueAt || now)), CHORE_LOOKAHEAD_DAYS);
    const stats = {
      completedStreak: Number(routine.completedStreak || 0),
      longestStreak: Number(routine.longestStreak || 0),
      completedCount: Number(routine.completedCount || 0),
      missedCount: Number(routine.missedCount || 0),
      lastCompletedAt: routine.lastCompletedAt || null,
      nextDueAt: routine.nextDueAt || nextComputed || null,
    };
    return {
      id: routine.id,
      name: routine.name || 'Routine',
      cadence: routine.recurrence?.rrule || null,
      durationMinutes: Number(routine.durationMinutes || 30),
      priority: routine.priority || 3,
      theme: routine.theme || null,
      goalId: routine.goalId || null,
      tags: routine.tags || [],
      policy: routine.policy || null,
      timezone: coercePersonaTimezone(routine),
      stats,
      tracker: trackerData?.[routine.id] || null,
    };
  });
  return { items };
});

exports.completeChore = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const choreId = String(req?.data?.choreId || '').trim();
  if (!choreId) throw new httpsV2.HttpsError('invalid-argument', 'choreId is required');
  const db = admin.firestore();
  const choreRef = db.collection('chores').doc(choreId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(choreRef);
    if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Chore not found');
    const data = snap.data() || {};
    if (data.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Cannot modify this chore');
    const { streak, longest } = calculateStreakMetrics(data, now);
    const dtstart = toMillis(data.recurrence?.dtstart || data.dtstart || data.createdAt || now);
    const nextDue = computeNextDueAt(data.recurrence, dtstart, now + MS_IN_MINUTE, CHORE_LOOKAHEAD_DAYS);
    const stats = {
      lastCompletedAt: now,
      nextDueAt: nextDue || null,
      completedStreak: streak,
      longestStreak: longest,
      completedCount: Number(data.completedCount || 0) + 1,
      missedCount: Number(data.missedCount || 0),
    };
    tx.update(choreRef, { ...stats, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return stats;
  });
  return { ok: true, stats: result };
});

exports.completeRoutine = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const routineId = String(req?.data?.routineId || '').trim();
  if (!routineId) throw new httpsV2.HttpsError('invalid-argument', 'routineId is required');
  const db = admin.firestore();
  const routineRef = db.collection('routines').doc(routineId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(routineRef);
    if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Routine not found');
    const data = snap.data() || {};
    if (data.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Cannot modify this routine');
    const { streak, longest } = calculateStreakMetrics(data, now);
    const dtstart = toMillis(data.recurrence?.dtstart || data.dtstart || data.createdAt || now);
    const nextDue = computeNextDueAt(data.recurrence, dtstart, now + MS_IN_MINUTE, CHORE_LOOKAHEAD_DAYS);
    const stats = {
      lastCompletedAt: now,
      nextDueAt: nextDue || null,
      completedStreak: streak,
      longestStreak: longest,
      completedCount: Number(data.completedCount || 0) + 1,
      missedCount: Number(data.missedCount || 0),
    };
    tx.update(routineRef, { ...stats, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return stats;
  });
  return { ok: true, stats: result };
});

exports.skipRoutine = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const routineId = String(req?.data?.routineId || '').trim();
  if (!routineId) throw new httpsV2.HttpsError('invalid-argument', 'routineId is required');
  const db = admin.firestore();
  const routineRef = db.collection('routines').doc(routineId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(routineRef);
    if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Routine not found');
    const data = snap.data() || {};
    if (data.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Cannot modify this routine');
    const dtstart = toMillis(data.recurrence?.dtstart || data.dtstart || data.createdAt || now);
    const nextDue = computeNextDueAt(data.recurrence, dtstart, now + MS_IN_MINUTE, CHORE_LOOKAHEAD_DAYS);
    const stats = {
      nextDueAt: nextDue || null,
      completedStreak: 0,
      missedCount: Number(data.missedCount || 0) + 1,
    };
    tx.update(routineRef, { ...stats, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return stats;
  });
  return { ok: true, stats: result };
});

exports.rolloverChoresAndRoutines = schedulerV2.onSchedule('every day 05:00', async () => {
  const db = admin.firestore();
  const [choresSnap, routinesSnap] = await Promise.all([
    db.collection('chores').get(),
    db.collection('routines').get(),
  ]);
  const now = Date.now();
  const updates = [];
  for (const snap of choresSnap.docs) {
    const data = snap.data() || {};
    const dtstart = toMillis(data.recurrence?.dtstart || data.dtstart || data.createdAt || now);
    const nextDue = computeNextDueAt(data.recurrence, dtstart, Math.max(now, Number(data.nextDueAt || now)), CHORE_LOOKAHEAD_DAYS);
    const needsReset = data.nextDueAt && data.nextDueAt < now && (!data.policy || data.policy.mode !== 'hold');
    const update = {
      nextDueAt: nextDue || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (needsReset) {
      update.completedStreak = 0;
      update.missedCount = Number(data.missedCount || 0) + 1;
    }
    updates.push({ ref: snap.ref, update });
  }
  for (const snap of routinesSnap.docs) {
    const data = snap.data() || {};
    const dtstart = toMillis(data.recurrence?.dtstart || data.dtstart || data.createdAt || now);
    const nextDue = computeNextDueAt(data.recurrence, dtstart, Math.max(now, Number(data.nextDueAt || now)), CHORE_LOOKAHEAD_DAYS);
    const needsReset = data.nextDueAt && data.nextDueAt < now && (!data.policy || data.policy.mode !== 'hold');
    const update = {
      nextDueAt: nextDue || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (needsReset) {
      update.completedStreak = 0;
      update.missedCount = Number(data.missedCount || 0) + 1;
    }
    updates.push({ ref: snap.ref, update });
  }
  const batch = db.batch();
  updates.forEach(({ ref, update }) => batch.set(ref, update, { merge: true }));
  await batch.commit();
  return { ok: true, processed: updates.length };
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

// Public approval endpoint for planning jobs (email CTA)
exports.approvePlanningJob = httpsV2.onRequest({ invoker: 'public' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const db = ensureFirestore();
    const jobId = String(req.query.jobId || '');
    const uid = String(req.query.uid || '');
    const token = String(req.query.token || '');
    if (!jobId || !uid || !token) return res.status(400).json({ error: 'Missing parameters' });

    const ref = db.collection('planning_jobs').doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Job not found' });
    const job = snap.data() || {};
    if (job.userId !== uid) return res.status(403).json({ error: 'Forbidden' });
    if (!job.approvalToken || job.approvalToken !== token) return res.status(403).json({ error: 'Invalid token' });

    const profileSnap = await db.collection('profiles').doc(uid).get();
    const profile = profileSnap.exists ? (profileSnap.data() || {}) : {};
    const timezone = job?.preview?.timezone || profile.timezone || 'UTC';
    const proposedBlocks = Array.isArray(job.proposedBlocks) ? job.proposedBlocks : [];
    let previewBlocks = Array.isArray(job?.preview?.blocks) ? job.preview.blocks : null;
    if (!previewBlocks || previewBlocks.length === 0) {
      previewBlocks = await buildBlockPreviews(uid, proposedBlocks, { timezone });
    }

    const validator = job.validator || null;

    const sendPreview = (statusCode = 200) => {
      return res.status(statusCode).json({
        status: job.status || 'unknown',
        jobId,
        timezone,
        proposedCount: proposedBlocks.length,
        validator,
        preview: {
          timezone,
          blocks: previewBlocks,
        },
        appliedBlocks: job.appliedBlocks || 0,
        approvedAt: job.approvedAt || null,
      });
    };

    const queryApprove = String(req.query.approve || '').toLowerCase();
    const queryAction = String(req.query.action || '').toLowerCase();
    const approveRequested = req.method === 'POST' || queryApprove === '1' || queryApprove === 'true' || queryAction === 'approve';
    const previewRequested = req.method === 'GET' && !approveRequested;

    if (!approveRequested || previewRequested || String(req.query.preview || '').toLowerCase() === 'true') {
      return sendPreview();
    }

    if (job.status !== 'proposed') {
      return sendPreview();
    }

    const applied = await applyCalendarBlocks(
      uid,
      'personal',
      proposedBlocks.map((b) => ({
        ...b,
        entry_method: 'calendar_ai',
        confidence_score: (validator?.score || 0.8),
      })),
    );
    await ref.set(
      {
        status: 'approved',
        appliedBlocks: applied,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        preview: {
          timezone,
          blocks: previewBlocks,
        },
      },
      { merge: true },
    );

    if (req.method === 'GET') {
      const origin = process.env.APP_BASE_URL || 'https://bob20250810.web.app';
      const html = `
        <html>
          <head><title>Plan Applied</title></head>
          <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 32px;">
            <h2>✅ Plan Applied</h2>
            <p>${applied} block${applied === 1 ? '' : 's'} were added to your calendar.</p>
            <p><a href="${origin}/calendar/integration">Open calendar view in BOB</a></p>
          </body>
        </html>`;
      return res.status(200).send(html);
    }

    return res.status(200).json({ ok: true, status: 'approved', appliedBlocks: applied });
  } catch (e) {
    console.error('[approvePlanningJob] failed', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Optional: callable to create a tracking GitHub issue for this feature
exports.createTrackingIssue = httpsV2.onCall({ secrets: [GITHUB_TOKEN] }, async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const repo = process.env.GITHUB_REPO || null; if (!repo) throw new httpsV2.HttpsError('failed-precondition', 'GITHUB_REPO not configured');
  const title = String(req?.data?.title || 'BOB: Goal Orchestration & Nightly Planning Approvals');
  const body = String(req?.data?.body || `
## Summary
- Goal-level orchestration (research → stories/tasks → schedule)
- Nightly plan email proposals with approval link
- Roadmap V3 icon+text actions
- Deep-link read-only sidebar with mobile overlay

## Server
- functions/index.js: orchestrateGoalPlanning, sendGoalChatMessage, dailyPlanningJob (approval flow), approvePlanningJob
- functions/services/mediaImportController.js: Trakt/Goodreads-like imports
- functions/services/themeManager.js: dynamic themes

## Client
- GoalRoadmapV3: icon+text quick actions + AI Orchestrate menu
- GlobalSidebar: AI Goal Chat modal, mobile overlay

## Follow-ups
- Add UI badges for pending plan approvals
- Optional: audio interface for goal chat
`);
  const resApi = await createGithubIssue({ token: process.env.GITHUB_TOKEN, repo, title, body });
  return { ok: true, issue: { number: resApi.number, url: resApi.html_url } };
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

// (Removed older Monzo OAuth start/callback – consolidated below with hosting rewrite support)

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
    // Force a new consent screen to maximise chance of receiving a refresh_token
    const authUrl = `https://auth.monzo.com/?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&prompt=consent`;
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
      try { await recordIntegrationLog(uid, 'monzo', 'error', 'Token exchange missing tokens', { keys: Object.keys(tokenData || {}) }); } catch {}
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
    await recordIntegrationLog(uid, 'monzo', 'success', 'Monzo sync completed', {
      accounts: summary?.accounts || 0,
      transactions: summary?.transactions || 0,
      since: sinceIso,
      jobId,
    });
    if (jobRef) {
      await jobRef.set({
        state: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastResult: summary,
      }, { merge: true });
    }
    return { ok: true, ...summary };
  } catch (error) {
    await recordIntegrationLog(uid, 'monzo', 'error', error?.message || 'Monzo sync failed', {
      since: sinceIso,
      jobId,
    });
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

// Helper to apply a single merchant mapping across existing transactions
async function applyMappingToExisting(uid, merchantKey, categoryType, label) {
  const db = admin.firestore();
  const col = db.collection('monzo_transactions');
  const q = col.where('ownerUid', '==', uid).where('merchantKey', '==', merchantKey);
  const snap = await q.get();
  let updated = 0;
  const MAX_BATCH = 400;
  let batch = db.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      userCategoryType: categoryType,
      userCategoryLabel: label || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ops++; updated++;
    if (ops >= MAX_BATCH) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();
  return updated;
}

// Upsert a mapping for a merchant (auto-categorise going forward)
exports.setMerchantMapping = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const merchantName = String(req.data?.merchantName || req.data?.merchant || req.data?.name || '').trim();
  const merchantKeyRaw = String(req.data?.merchantKey || '').trim();
  const categoryType = String(req.data?.categoryType || req.data?.type || '').trim().toLowerCase();
  const label = req.data?.label ? String(req.data.label).trim() : null;
  const applyToExisting = !!req.data?.applyToExisting;

  const allowed = new Set(['mandatory', 'optional', 'savings', 'income']);
  if (!merchantName && !merchantKeyRaw) throw new httpsV2.HttpsError('invalid-argument', 'merchantName or merchantKey is required');
  if (!allowed.has(categoryType)) throw new httpsV2.HttpsError('invalid-argument', 'categoryType must be mandatory, optional, savings, or income');

  const merchantKey = merchantKeyRaw || normaliseMerchantName(merchantName);
  if (!merchantKey) throw new httpsV2.HttpsError('invalid-argument', 'merchantKey resolved empty');

  const db = admin.firestore();
  const docRef = db.collection('merchant_mappings').doc(`${uid}_${merchantKey}`);
  await docRef.set({
    ownerUid: uid,
    merchantKey,
    label: label || merchantName || merchantKey,
    categoryType,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  try { await recordIntegrationLog(uid, 'monzo', 'success', 'Set merchant mapping', { merchantKey, categoryType, label }); } catch {}

  let updated = 0;
  if (applyToExisting) {
    updated = await applyMappingToExisting(uid, merchantKey, categoryType, label);
    try { await computeMonzoAnalytics(uid); } catch {}
  }

  return { ok: true, merchantKey, updated };
});

// Bulk upsert merchant mappings from CSV or UI array
exports.bulkUpsertMerchantMappings = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const rows = Array.isArray(req.data?.rows) ? req.data.rows : [];
  const apply = !!req.data?.apply;
  if (!rows.length) return { ok: true, upserts: 0, updated: 0 };

  const db = admin.firestore();
  const batch = db.batch();
  let upserts = 0, updated = 0;
  const allowed = new Set(['mandatory', 'optional', 'savings', 'income']);
  for (const r of rows) {
    const name = String(r.merchantName || r.merchant || r.name || '').trim();
    const keyRaw = String(r.merchantKey || '').trim();
    const key = keyRaw || normaliseMerchantName(name);
    if (!key) continue;
    const type = String(r.categoryType || r.type || '').trim().toLowerCase();
    if (!allowed.has(type)) continue;
    const label = r.label ? String(r.label).trim() : (name || key);
    const ref = db.collection('merchant_mappings').doc(`${uid}_${key}`);
    batch.set(ref, {
      ownerUid: uid,
      merchantKey: key,
      label,
      categoryType: type,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    upserts++;
  }
  if (upserts) await batch.commit();
  if (apply) {
    // Apply each mapping
    const snaps = await db.collection('merchant_mappings').where('ownerUid', '==', uid).get();
    for (const d of snaps.docs) {
      const m = d.data() || {};
      if (!m.merchantKey || !m.categoryType) continue;
      updated += await applyMappingToExisting(uid, m.merchantKey, m.categoryType, m.label || null);
    }
    try { await computeMonzoAnalytics(uid); } catch {}
  }
  try { await recordIntegrationLog(uid, 'monzo', 'success', 'Bulk upsert merchant mappings', { upserts, applied: apply }); } catch {}
  return { ok: true, upserts, updated };
});

// Explicit apply (all or one merchant)
exports.applyMerchantMappings = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const merchantKeyIn = String(req.data?.merchantKey || '').trim();
  const db = admin.firestore();
  let updated = 0;
  if (merchantKeyIn) {
    const snap = await db.collection('merchant_mappings').doc(`${uid}_${merchantKeyIn}`).get();
    if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Mapping not found');
    const m = snap.data() || {};
    updated += await applyMappingToExisting(uid, merchantKeyIn, m.categoryType, m.label || null);
  } else {
    const snaps = await db.collection('merchant_mappings').where('ownerUid', '==', uid).get();
    for (const d of snaps.docs) {
      const m = d.data() || {};
      if (!m.merchantKey || !m.categoryType) continue;
      updated += await applyMappingToExisting(uid, m.merchantKey, m.categoryType, m.label || null);
    }
  }
  try { await computeMonzoAnalytics(uid); } catch {}
  try { await recordIntegrationLog(uid, 'monzo', 'success', 'Applied merchant mappings', { updated }); } catch {}
  return { ok: true, updated };
});

// Backfill merchantKey for older transactions (run once per user if needed)
exports.backfillMerchantKeys = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const db = admin.firestore();
  const col = db.collection('monzo_transactions');
  const snap = await col.where('ownerUid', '==', uid).get();
  let updated = 0;
  let batch = db.batch();
  let ops = 0;
  const MAX = 400;
  for (const d of snap.docs) {
    const data = d.data() || {};
    if (data.merchantKey) continue;
    const name = data?.merchant?.name || data?.counterparty?.name || data?.description || null;
    const key = name ? normaliseMerchantName(name) : null;
    if (!key) continue;
    batch.update(d.ref, { merchantKey: key, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    ops++; updated++;
    if (ops >= MAX) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();
  try { await recordIntegrationLog(uid, 'monzo', 'success', 'Backfilled merchant keys', { updated }); } catch {}
  return { ok: true, updated };
});

exports.generateMonzoAuditReport = httpsV2.onCall({ secrets: [MONZO_CLIENT_ID, MONZO_CLIENT_SECRET] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const analytics = await computeMonzoAnalytics(uid);
  const summary = analytics.summarySnapshot || {};
  const alignment = analytics.alignmentDoc || {};

  const recommendations = [];
  const pendingCount = Number(summary.pendingCount || 0);
  if (pendingCount > 0) {
    recommendations.push(`Categorise ${pendingCount} pending transaction${pendingCount === 1 ? '' : 's'} to improve budget accuracy.`);
  }

  const budgetAlerts = (summary.budgetProgress || []).filter((entry) => Number(entry.variance) < 0);
  if (budgetAlerts.length) {
    const labels = budgetAlerts.map((entry) => entry.key).slice(0, 5).join(', ');
    recommendations.push(`Over-budget categories detected: ${labels}. Review allocations or reclassify upcoming spends.`);
  }

  const themeShortfalls = (alignment.themes || []).filter((theme) => Number(theme.totalShortfall) > 0);
  if (themeShortfalls.length) {
    const labels = themeShortfalls.map((theme) => `${theme.themeName}: £${Number(theme.totalShortfall || 0).toFixed(2)}`).slice(0, 5).join('; ');
    recommendations.push(`Theme funding gaps identified — prioritise transfers: ${labels}.`);
  }

  const merchantGaps = (summary.pendingClassification || []).slice(0, 10);

  const audit = {
    totals: summary.totals || {},
    netCashflow: summary.netCashflow || 0,
    pendingCount,
    pendingClassification: merchantGaps,
    budgetAlerts,
    themeProgress: alignment.themes || [],
    recommendations,
  };

  const db = admin.firestore();
  await db.collection('monzo_audit_reports').doc(uid).set({
    ownerUid: uid,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    audit,
  }, { merge: true });

  return {
    ok: true,
    audit: {
      ...audit,
      generatedAt: new Date().toISOString(),
    },
  };
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

async function syncMonzoTransactionsForAccount({ uid, accountId, accessToken, since }) {
  const db = admin.firestore();
  const transactionsCol = db.collection('monzo_transactions');
  const limit = 200;
  let cursor = since || null;
  let prevCursor = cursor || null;
  let total = 0;
  let lastCreated = since || null;

  // Preload merchant mappings for this user to auto-apply categorisation
  const merchantMappingsSnap = await db.collection('merchant_mappings')
    .where('ownerUid', '==', uid)
    .get();
  const merchantMap = new Map();
  merchantMappingsSnap.forEach((d) => {
    const data = d.data() || {};
    const key = String(data.merchantKey || '').trim();
    if (!key) return;
    merchantMap.set(key, {
      type: data.categoryType || data.type || 'optional',
      label: data.label || data.categoryLabel || null,
    });
  });

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
      // Merchant key for mapping and analytics
      const merchantName = tx?.merchant?.name || tx?.counterparty?.name || tx?.description || null;
      const merchantKey = merchantName ? normaliseMerchantName(merchantName) : (tx?.merchant?.id ? normaliseMerchantName(tx.merchant.id) : null);

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
        merchantKey: merchantKey || null,
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

      // Apply user mapping if present so future analytics use user's choice
      if (merchantKey && merchantMap.has(merchantKey)) {
        const m = merchantMap.get(merchantKey);
        docData.userCategoryType = m.type;
        if (m.label) docData.userCategoryLabel = m.label;
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

// ===== AI Planning Function
exports.planCalendar = functionsV2.https.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
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
    try { await recordAiLog(uid, 'planCalendar', 'info', 'Planning started', { persona, horizonDays, focusGoalId, goalTimeRequest }); } catch {}
    
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
    
    const resultPayload = {
      proposedBlocks: aiResponse.blocks,
      rationale: aiResponse.rationale,
      validator: validationResult,
      applied,
      blocksCreated,
      score: validationResult.score,
      focusGoalId: focusGoalId || null
    };
    try { await recordAiLog(uid, 'planCalendar', applied ? 'success' : 'warning', applied ? 'AI plan applied' : 'AI plan proposed (not applied)', { blocksProposed: aiResponse.blocks?.length || 0, blocksCreated, score: validationResult.score, focusGoalId }); } catch {}
    return resultPayload;
    
  } catch (error) {
    console.error('Calendar planning error:', error);
    try { await recordAiLog(uid, 'planCalendar', 'error', 'Planning failed', { error: String(error?.message || error) }); } catch {}
    throw new functionsV2.https.HttpsError("internal", error.message);
  }
});

// ===== Story Generation for Goal (AI)
exports.generateStoriesForGoal = functionsV2.https.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
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
exports.generateStoryAcceptanceCriteria = functionsV2.https.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
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
exports.enhanceTaskDescription = functionsV2.https.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (request) => {
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

SCHEDULING RULES:
- Place chores and routines in morning or pre-evening slots.
- Avoid scheduling hobbies on weekdays during work hours; prefer weekends or leisure evenings.
- Prefer learning and study blocks on weeknights ("school night" logic).
- Insert routines at their habit times when known; otherwise, prefer consistency by time of day.
- Cluster tasks with similar effort or aligned to the same goal to reduce context switching.
- Respect existing calendar events and quiet hours; schedule only between wake and sleep times.
- Do not overbook: keep reasonable buffers; prioritize high-impact items.

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
      "theme": "General|Health & Fitness|Career & Professional|Finance & Wealth|Learning & Education|Family & Relationships|Hobbies & Interests|Travel & Adventure|Home & Living|Spiritual & Personal Growth|Chores|Routine|Dev Tasks",
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

// Orchestrated Goal Planning: research → stories/tasks → schedule → (optional) GitHub issues
exports.orchestrateGoalPlanning = functionsV2.https.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY, NYLAS_API_KEY, GITHUB_TOKEN] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const goalId = String(req?.data?.goalId || '').trim();
  if (!goalId) throw new httpsV2.HttpsError('invalid-argument', 'goalId is required');

  const db = ensureFirestore();
  const goalSnap = await db.collection('goals').doc(goalId).get();
  if (!goalSnap.exists) throw new httpsV2.HttpsError('not-found', 'Goal not found');
  const goal = goalSnap.data() || {};
  if (goal.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Not your goal');

  // 1) Generate research package (prompt, questions, outline, next actions, doc)
  const researchPlanJson = await callLLMJson({
    system: 'You are a research planning agent. Return strict JSON only. Design a short research plan for the provided goal, including a research_prompt to dig deep, key_questions (max 5), a concise outline list, and initial_next_actions (3-7 items) each with title and estimated_minutes. Do not add prose or Markdown outside the JSON.',
    user: `Goal: ${goal.title}\nDescription: ${goal.description || ''}\nTheme: ${goal.theme}`,
    purpose: 'goalResearchPlan',
    userId: uid,
    expectJson: true,
  });
  let researchPlan;
  try { researchPlan = JSON.parse(researchPlanJson); } catch (e) { throw new httpsV2.HttpsError('internal', 'AI failed to produce research plan JSON'); }
  const researchPrompt = String(researchPlan?.research_prompt || '').slice(0, 4000);
  const questions = Array.isArray(researchPlan?.key_questions) ? researchPlan.key_questions : [];
  const outline = Array.isArray(researchPlan?.outline) ? researchPlan.outline : [];
  const nextActions = Array.isArray(researchPlan?.initial_next_actions) ? researchPlan.initial_next_actions : [];

  const researchDocMd = await callLLMJson({
    system: 'You are an expert researcher. Compose a crisp, actionable research brief in Markdown. Begin with a 3-5 bullet executive summary, then key findings (placeholders allowed), then recommended next actions. Keep it under 800 words.',
    user: `Goal: ${goal.title}\nResearch Prompt: ${researchPrompt}\nOutline: ${JSON.stringify(outline)}\nKnown Context: ${goal.description || ''}`,
    purpose: 'goalResearchDoc',
    userId: uid,
    expectJson: false,
    temperature: 0.3,
  });

  // 2) Persist research doc and email it
  const researchRef = db.collection('research_docs').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await researchRef.set({
    id: researchRef.id,
    ownerUid: uid,
    goalId,
    title: `Research: ${goal.title}`,
    researchPrompt,
    questions,
    outline,
    docMd: researchDocMd,
    createdAt: now,
    updatedAt: now,
  });

  // Email to user
  try {
    const profileSnap = await db.collection('profiles').doc(uid).get();
    const email = profileSnap.exists ? (profileSnap.data() || {}).email : null;
    if (email) {
      const html = `<h2>Research Brief: ${escapeHtml(goal.title)}</h2>`+
        `<p><strong>Questions:</strong></p><ul>`+
        questions.map((q) => `<li>${escapeHtml(String(q))}</li>`).join('')+
        `</ul><hr/><div style="white-space:pre-wrap;font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">${escapeHtml(researchDocMd)}</div>`+
        `<p style="margin-top:16px;">Open in BOB: <a href="/goals/${goal.ref || goalId}">/goals/${goal.ref || goalId}</a></p>`;
      await sendEmail({ to: email, subject: `Research Brief · ${goal.title}`, html });
    }
  } catch (e) {
    console.warn('[orchestrateGoalPlanning] email send failed', e?.message || e);
  }

  // 3) Create a primary Research story and tasks
  const storyRef = db.collection('stories').doc();
  const baseTheme = goal.theme || 'Learning & Education';
  await storyRef.set({
    id: storyRef.id,
    ownerUid: uid,
    persona: 'personal',
    title: `Deep Research: ${goal.title}`,
    description: `Auto-generated research package for goal. Research Doc: /research/${researchRef.id}`,
    goalId,
    theme: baseTheme,
    status: 1,
    priority: 2,
    orderIndex: Date.now(),
    createdAt: now,
    updatedAt: now,
  });

  const createdTasks = [];
  for (const a of nextActions.slice(0, 12)) {
    const tRef = db.collection('tasks').doc();
    await tRef.set({
      id: tRef.id,
      ownerUid: uid,
      persona: 'personal',
      title: String(a?.title || 'Next step'),
      description: 'Auto-generated from research plan',
      storyId: storyRef.id,
      status: 0,
      priority: 2,
      effort: 'S',
      estimated_duration: Number(a?.estimated_minutes || 30),
      entry_method: 'ai_research',
      task_type: 'task',
      theme: baseTheme,
      goalId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
    createdTasks.push(tRef.id);
  }

  // Optional: create GitHub issues for Dev tasks
  const ghToken = process.env.GITHUB_TOKEN || null;
  const ghRepo = process.env.GITHUB_REPO || null; // e.g., "owner/repo"
  let ghResults = [];
  if (ghToken && ghRepo) {
    for (const taskId of createdTasks) {
      const t = await db.collection('tasks').doc(taskId).get();
      const td = t.data() || {};
      const themeName = String(td.theme || baseTheme).toLowerCase();
      if (themeName.includes('dev')) {
        try {
          const res = await createGithubIssue({ token: ghToken, repo: ghRepo, title: td.title, body: `Goal: ${goal.title}\nStory: ${storyRef.id}\nTask: ${taskId}` });
          ghResults.push({ taskId, issueNumber: res.number });
          await t.ref.set({ githubIssue: res.number }, { merge: true });
        } catch (err) {
          console.warn('[orchestrateGoalPlanning] github issue failed', err?.message || err);
        }
      }
    }
  }

  // 4) Schedule into calendar/backlog via AI plan (short horizon, high score)
  const context = await assemblePlanningContext(uid, 'personal', 2);
  const aiBlocks = await generateAIPlan(context, {});
  const validation = await validateCalendarBlocks(aiBlocks.blocks || [], context);
  let appliedBlocks = 0;
  if (validation.errors.length === 0) {
    appliedBlocks = await applyCalendarBlocks(uid, 'personal', (aiBlocks.blocks || []).map(b => ({ ...b, entry_method: 'calendar_ai', confidence_score: validation.score })));
  }

  await recordAiLog(uid, 'orchestrateGoalPlanning', 'success', 'Goal research, stories, tasks generated and scheduled', {
    goalId,
    researchDocId: researchRef.id,
    storyId: storyRef.id,
    tasks: createdTasks.length,
    appliedBlocks,
    githubCreated: ghResults.length,
  });

  return { ok: true, researchDocId: researchRef.id, storyId: storyRef.id, tasksCreated: createdTasks.length, appliedBlocks, github: ghResults };
});

// Orchestrated Story Planning: (optional) brief research → tasks → schedule
exports.orchestrateStoryPlanning = functionsV2.https.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY, NYLAS_API_KEY, GITHUB_TOKEN] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const storyId = String(req?.data?.storyId || '').trim();
  const research = req?.data?.research === true; // optional lightweight research
  const researchOnly = req?.data?.researchOnly === true; // generate/update research doc only
  if (!storyId) throw new httpsV2.HttpsError('invalid-argument', 'storyId is required');

  const db = ensureFirestore();
  const storySnap = await db.collection('stories').doc(storyId).get();
  if (!storySnap.exists) throw new httpsV2.HttpsError('not-found', 'Story not found');
  const story = storySnap.data() || {};
  if (story.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Not your story');
  const goalId = story.goalId || null;

  // 1) Optional: Lightweight research brief for the story
  let researchDocId = null;
  if (research || researchOnly) {
    const systemR = 'You are an expert assistant. Compose a short research brief in Markdown (<= 500 words) for the given story with: context, assumptions, quick sources to check, and next actions (3–6 bullets).';
    const userR = `Story: ${story.title}\nDescription: ${story.description || ''}\nGoal: ${goalId || '(none)'}`;
    const docMd = await callLLMJson({ system: systemR, user: userR, purpose: 'storyResearchDoc', userId: uid, expectJson: false, temperature: 0.3 });
    const ref = db.collection('research_docs').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      id: ref.id,
      ownerUid: uid,
      storyId,
      goalId: goalId || null,
      title: `Research: ${story.title}`,
      docMd,
      createdAt: now,
      updatedAt: now,
    });
    researchDocId = ref.id;
    // Email optional
    try {
      const profileSnap = await db.collection('profiles').doc(uid).get();
      const email = profileSnap.exists ? (profileSnap.data() || {}).email : null;
      if (email) {
        const html = `<h2>Research Brief: ${escapeHtml(story.title)}</h2>`+
          `<div style="white-space:pre-wrap;font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">${escapeHtml(docMd)}</div>`+
          `<p style="margin-top:16px;">Open in BOB: <a href="/stories?storyId=${storyId}">/stories?storyId=${storyId}</a></p>`;
        await sendEmail({ to: email, subject: `Research Brief · ${story.title}`, html });
      }
    } catch (e) { console.warn('[orchestrateStoryPlanning] email send failed', e?.message || e); }
  }
  if (researchOnly) {
    return { ok: true, researchDocId };
  }

  // 2) Generate tasks for this story
  const system = [
    'You are a planning assistant. Return STRICT JSON only.',
    '{',
    '  "tasks": [{"title": string, "estimated_minutes": number, "priority": "P1"|"P2"|"P3" }],',
    '  "notes"?: string',
    '}',
  ].join('\n');
  const user = `Story: ${story.title}\nDescription: ${story.description || ''}\nTheme: ${story.theme || ''}\nGoal: ${goalId || ''}\nPlease propose 3–8 concrete tasks.`;
  const raw = await callLLMJson({ system, user, purpose: 'storyTasks', userId: uid, expectJson: true, temperature: 0.2 });
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { tasks: [] }; }
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];

  const createdTasks = [];
  for (const t of tasks.slice(0, 12)) {
    const tref = db.collection('tasks').doc();
    await tref.set({
      id: tref.id,
      ownerUid: uid,
      persona: story.persona || 'personal',
      title: String(t?.title || 'Next step'),
      description: 'AI-generated from story orchestration',
      storyId,
      status: 0,
      priority: (String(t?.priority || 'P2')), // safe as string; UI maps variants
      effort: 'S',
      estimated_duration: Number(t?.estimated_minutes || 30),
      entry_method: 'ai_story_orchestration',
      task_type: 'task',
      theme: story.theme || 'Growth',
      goalId: goalId || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
    createdTasks.push(tref.id);
  }

  // 3) Schedule blocks with focus on the parent goal (if available)
  // Use a short horizon and requested minutes from tasks
  const context = await assemblePlanningContext(uid, story.persona || 'personal', 2);
  context.userId = uid;
  let goalTimeRequest = 0;
  for (const t of tasks) { goalTimeRequest += Number(t?.estimated_minutes || 30); }
  if (!goalTimeRequest) goalTimeRequest = 120;
  const aiPlan = await generateAIPlan(context, { focusGoalId: goalId || null, goalTimeRequest });
  const validation = await validateCalendarBlocks(aiPlan.blocks || [], context);
  let appliedBlocks = 0;
  if (validation.errors.length === 0) {
    appliedBlocks = await applyCalendarBlocks(uid, story.persona || 'personal', (aiPlan.blocks || []).map(b => ({ ...b, storyId, entry_method: 'calendar_ai', confidence_score: validation.score })));
  }

  await recordAiLog(uid, 'orchestrateStoryPlanning', 'success', 'Story tasks generated and schedule applied', {
    storyId,
    tasks: createdTasks.length,
    researchDocId,
    appliedBlocks,
  });

  return { ok: true, storyId, tasksCreated: createdTasks.length, appliedBlocks, researchDocId };
});

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

async function createGithubIssue({ token, repo, title, body }) {
  const url = `https://api.github.com/repos/${repo}/issues`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  });
  if (!res.ok) throw new Error(`GitHub issue create failed: ${res.status}`);
  return await res.json();
}

// Minimal goal chat: store message and respond with clarifying Q/A
exports.sendGoalChatMessage = httpsV2.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const goalId = String(req?.data?.goalId || '');
  const message = String(req?.data?.message || '').trim();
  if (!goalId || !message) throw new httpsV2.HttpsError('invalid-argument', 'goalId and message required');
  const db = ensureFirestore();
  const goalSnap = await db.collection('goals').doc(goalId).get();
  if (!goalSnap.exists) throw new httpsV2.HttpsError('not-found', 'Goal not found');
  if (goalSnap.data().ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Not your goal');

  const threadRef = db.collection('goal_chats').doc(goalId);
  const msgRef = threadRef.collection('messages').doc();
  await msgRef.set({ id: msgRef.id, ownerUid: uid, role: 'user', content: message, createdAt: admin.firestore.FieldValue.serverTimestamp() });

  const system = [
    'You are a goal planning assistant. Keep answers under 120 words.',
    'Return STRICT JSON with this shape only:',
    '{',
    '  "reply": string,',
    '  "suggested_tasks": [{"title": string, "estimateMin": number}] ,',
    '  "actions": {',
    '     "orchestrate": boolean,',
    '     "create_story"?: {"title": string, "description"?: string},',
    '     "plan_minutes"?: number',
    '  }',
    '}',
  ].join('\n');
  const user = `Goal: ${goalSnap.data().title}\nKnown theme: ${goalSnap.data().theme || 'Growth'}\nUser: ${message}`;
  const raw = await callLLMJson({ system, user, purpose: 'goalChat', userId: uid, expectJson: true, temperature: 0.2 });
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { reply: raw, suggested_tasks: [], actions: {} }; }
  const reply = String(parsed?.reply || '').slice(0, 1200);
  await threadRef.collection('messages').add({ ownerUid: uid, role: 'assistant', content: reply, createdAt: admin.firestore.FieldValue.serverTimestamp() });

  // Create any suggested tasks quickly under this goal
  const tasks = Array.isArray(parsed?.suggested_tasks) ? parsed.suggested_tasks : [];
  const created = [];
  for (const t of tasks.slice(0, 5)) {
    const taskRef = db.collection('tasks').doc();
    const est = Number(t?.estimateMin || 30);
    await taskRef.set({
      id: taskRef.id,
      ownerUid: uid,
      persona: 'personal',
      title: String(t?.title || 'Follow-up'),
      description: 'AI-suggested from goal chat',
      status: 0,
      priority: 2,
      effort: 'S',
      estimated_duration: est,
      entry_method: 'ai_chat',
      task_type: 'task',
      theme: goalSnap.data().theme || 'Growth',
      goalId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(est <= 240 ? {
        reminderSyncDirective: 'upsert',
        reminderTitle: `[${goalSnap.data().theme || 'Growth'}] – ${String(t?.title || 'Follow-up')}`,
        reminderNote: `Goal: ${goalSnap.data().title || goalId}`
      } : {}),
    }, { merge: true });
    created.push(taskRef.id);
  }
  const actions = parsed?.actions && typeof parsed.actions === 'object' ? parsed.actions : {};
  return { ok: true, reply, tasksCreated: created.length, actions };
});

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
  const userThemes = await loadThemesForUser(uid);

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

    // If we have a goal but no more granular entity, provide a deep link to the goal
    if (!linkUrl && goalId) {
      linkUrl = `/goals/roadmap?goalId=${goalId}`;
    }

    return { title, theme, goalId, storyId, taskId, habitId, linkUrl };
  }

  // We will also log to activity_stream once
  const activityRef = db.collection('activity_stream').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  let createdCount = 0;
  for (const proposed of blocks) {
    const enriched = await enrichBlock(proposed);
    const blockRef = db.collection('calendar_blocks').doc();
    const theme_id = mapThemeLabelToId(enriched.theme, userThemes);

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
      theme_id,
      entry_method: proposed.entry_method || 'calendar_ai',
      confidence_score: typeof proposed.confidence_score === 'number' ? proposed.confidence_score : 0.85,
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
    else if (enriched.goalId) { linkType = 'goal'; refId = enriched.goalId; }

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
        entry_method: 'calendar_ai',
        theme_id,
        createdAt: now,
        updatedAt: now
      });
    }

    // If linked to a task, update due date and set reminders sync directive
    if (enriched.taskId) {
      const tRef = db.collection('tasks').doc(String(enriched.taskId));
      batch.set(tRef, {
        dueDate: proposed.start || null,
        entry_method: 'calendar_ai',
        confidence_score: typeof proposed.confidence_score === 'number' ? proposed.confidence_score : 0.85,
        theme_id,
        reminderSyncDirective: 'upsert',
        reminderTitle: `[${enriched.theme}] – ${linkTitle || enriched.taskId}`,
        reminderNote: `Deep link: ${linkUrl || ''}`.trim(),
        updatedAt: now,
      }, { merge: true });
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

async function buildBlockPreviews(uid, blocks, { timezone = 'UTC' } = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  const db = ensureFirestore();
  const taskIds = new Set();
  const storyIds = new Set();
  const goalIds = new Set();

  for (const block of blocks) {
    if (block?.taskId) taskIds.add(String(block.taskId));
    if (block?.storyId) storyIds.add(String(block.storyId));
    if (block?.goalId) goalIds.add(String(block.goalId));
  }

  const fetchDocs = async (collectionName, ids) => {
    if (ids.size === 0) return new Map();
    const snapshots = await Promise.all(
      Array.from(ids).map(async (id) => {
        try {
          return await db.collection(collectionName).doc(id).get();
        } catch (err) {
          console.warn(`[buildBlockPreviews] failed to load ${collectionName}/${id}`, err?.message || err);
          return null;
        }
      })
    );
    const map = new Map();
    snapshots.forEach((snap) => {
      if (snap && snap.exists) {
        map.set(snap.id, snap.data());
      }
    });
    return map;
  };

  const [taskMap, storyMap, goalMap] = await Promise.all([
    fetchDocs('tasks', taskIds),
    fetchDocs('stories', storyIds),
    fetchDocs('goals', goalIds),
  ]);

  const makeDeepLink = ({ taskId, storyId, goalId }) => {
    if (taskId) return `/tasks?taskId=${taskId}`;
    if (storyId) return `/stories?storyId=${storyId}`;
    if (goalId) return `/goals/roadmap?goalId=${goalId}`;
    return null;
  };

  const zone = coerceZone(timezone || 'UTC');
  return blocks.map((block) => {
    const task = block?.taskId ? taskMap.get(String(block.taskId)) : null;
    const story = block?.storyId ? storyMap.get(String(block.storyId)) : null;
    const goal = block?.goalId ? goalMap.get(String(block.goalId)) : null;
    const theme = block?.theme || goal?.theme || story?.theme || task?.theme || 'Growth';

    const start = typeof block?.start === 'number' ? DateTime.fromMillis(block.start, { zone }) : null;
    const end = typeof block?.end === 'number' ? DateTime.fromMillis(block.end, { zone }) : null;
    const durationMinutes = start && end ? Math.max(15, Math.round(end.diff(start, 'minutes').minutes)) : null;

    return {
      title: block?.title || task?.title || story?.title || (goal ? `Goal: ${goal.title}` : 'Scheduled Block'),
      theme,
      start: block?.start || null,
      end: block?.end || null,
      displayStart: start && start.isValid ? start.toLocaleString(DateTime.DATETIME_MED) : null,
      displayEnd: end && end.isValid ? end.toLocaleString(DateTime.DATETIME_MED) : null,
      durationMinutes,
      goal: goal
        ? {
            id: String(block.goalId),
            title: goal.title || goal.name || 'Goal',
            ref: goal.ref || null,
          }
        : null,
      story: story
        ? {
            id: String(block.storyId),
            title: story.title || 'Story',
            ref: story.ref || null,
          }
        : null,
      task: task
        ? {
            id: String(block.taskId),
            title: task.title || 'Task',
            ref: task.ref || null,
          }
        : null,
      deepLink: makeDeepLink({
        taskId: block?.taskId ? String(block.taskId) : null,
        storyId: block?.storyId ? String(block.storyId) : null,
        goalId: block?.goalId ? String(block.goalId) : null,
      }),
    };
  });
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
    try { await recordIntegrationLog(uid, 'google', 'error', 'Failed to fetch Google Calendar events', { start: startDate?.toISOString?.(), end: endDate?.toISOString?.(), error: String(error?.message || error) }); } catch {}
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

  try {
    const level = events.length === 0 ? 'warning' : 'success';
    await recordIntegrationLog(uid, 'google', level, 'Imported Google Calendar events', { requestedStart: startDate?.toISOString?.(), requestedEnd: endDate?.toISOString?.(), eventsFetched: events.length, blocksStored: seenDocIds.size });
  } catch {}

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
      try { await recordIntegrationLog(uid, 'google', 'success', 'Hourly Google Calendar sync ran', { start: startDate.toISOString(), end: endDate.toISOString() }); } catch {}
    } catch (error) {
      console.warn(`[gcal-sync] hourly sync failed for ${uid}`, error.message);
      try { await recordIntegrationLog(uid, 'google', 'error', 'Hourly Google Calendar sync failed', { error: String(error?.message || error) }); } catch {}
    }
  }
});

// ===== Duplicate Detection for iOS Reminders (AC11 - Issue #124)
exports.detectDuplicateReminders = httpsV2.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  try {
    const db = admin.firestore();
    return await detectDuplicateRemindersForUser({ db, userId: uid });
  } catch (e) {
    console.error('detectDuplicateReminders error:', e);
    throw new httpsV2.HttpsError('internal', e.message);
  }
});

async function deduplicateUserTasks({ db, userId, dryRun = false, hardDelete = false, logActivity = true, activityActor = 'AI_Agent', runId = null }) {
  const tasksSnap = await db.collection('tasks').where('ownerUid', '==', userId).get();
  const taskDocs = tasksSnap.docs.map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }));
  if (!taskDocs.length) {
    return { ok: true, processed: 0, duplicatesResolved: 0, dryRun, groups: [] };
  }

  const taskById = new Map(taskDocs.map(doc => [doc.id, { id: doc.id, ...doc.data }]));
  const keyMap = new Map();

  const addKey = (key, taskId) => {
    if (!key || !taskId) return;
    const normalized = key.toLowerCase();
    if (!keyMap.has(normalized)) keyMap.set(normalized, new Set());
    keyMap.get(normalized).add(taskId);
  };

  for (const doc of taskDocs) {
    const data = doc.data;
    const id = doc.id;
    const reminderKey = data.reminderId ? `reminder:${String(data.reminderId).trim().toLowerCase()}` : null;
    const refValue = data.ref || data.reference || null;
    const refKey = refValue ? `ref:${String(refValue).trim().toLowerCase()}` : null;
    const sourceRefKey = data.sourceRef ? `sourceref:${String(data.sourceRef).trim().toLowerCase()}` : null;
    const externalKey = data.taskId ? `external:${String(data.taskId).trim().toLowerCase()}` : null;
    const iosKey = data.iosReminderId ? `ios:${String(data.iosReminderId).trim().toLowerCase()}` : null;

    const comboParts = [];
    if (reminderKey) comboParts.push(reminderKey.split(':')[1]);
    if (refKey) comboParts.push(refKey.split(':')[1]);
    if (sourceRefKey) comboParts.push(sourceRefKey.split(':')[1]);
    if (comboParts.length >= 2) addKey(`combo:${comboParts.join('|')}`, id);

    for (const key of [reminderKey, refKey, sourceRefKey, externalKey, iosKey]) {
      addKey(key, id);
    }
  }

  const signatureMap = new Map();
  for (const [key, idSet] of keyMap.entries()) {
    const ids = Array.from(idSet);
    if (ids.length < 2) continue;
    const sorted = ids.slice().sort();
    const signature = sorted.join('|');
    if (!signatureMap.has(signature)) {
      signatureMap.set(signature, { ids: sorted, keys: new Set([key]) });
    } else {
      signatureMap.get(signature).keys.add(key);
    }
  }

  const groups = Array.from(signatureMap.values());
  if (!groups.length) {
    return { ok: true, processed: taskDocs.length, duplicatesResolved: 0, dryRun, groups: [] };
  }

  const canonicalNotes = new Map();
  const duplicateUpdates = [];
  const summary = [];
  const duplicateReminderMappings = [];

  for (const group of groups) {
    const ids = group.ids.map(id => id);
    const tasks = ids.map(id => taskById.get(id)).filter(Boolean);
    if (tasks.length < 2) continue;

    const canonical = tasks.slice().sort((a, b) => {
      const deletedDiff = (a.deleted ? 1 : 0) - (b.deleted ? 1 : 0);
      if (deletedDiff !== 0) return deletedDiff;
      const statusA = String(a.status ?? '').toLowerCase();
      const statusB = String(b.status ?? '').toLowerCase();
      const doneA = statusA === 'done' || statusA === 'complete' || Number(a.status) === 2;
      const doneB = statusB === 'done' || statusB === 'complete' || Number(b.status) === 2;
      if (doneA !== doneB) return doneA - doneB;
      const createdA = toMillis(a.reminderCreatedAt) ?? toMillis(a.createdAt) ?? toMillis(a.serverUpdatedAt) ?? Number.MAX_SAFE_INTEGER;
      const createdB = toMillis(b.reminderCreatedAt) ?? toMillis(b.createdAt) ?? toMillis(b.serverUpdatedAt) ?? Number.MAX_SAFE_INTEGER;
      if (createdA !== createdB) return createdA - createdB;
      return a.id.localeCompare(b.id);
    })[0];

    const duplicates = tasks.filter(t => t.id !== canonical.id);
    if (!duplicates.length) continue;

    summary.push({ kept: canonical.id, removed: duplicates.map(d => d.id), keys: Array.from(group.keys) });

    const canonicalRefValue = canonical.ref || canonical.reference || canonical.displayId || canonical.id;

    duplicates.forEach(dup => {
      duplicateUpdates.push({
        id: dup.id,
        data: {
          duplicateOf: canonical.id,
          duplicateKey: Array.from(group.keys).join(','),
          duplicateResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          reminderSyncDirective: 'complete',
          syncState: 'dirty',
          status: 2,
          deleted: true,
          serverUpdatedAt: Date.now()
        }
      });
      duplicateReminderMappings.push({
        duplicateId: dup.id,
        canonicalId: canonical.id,
        canonicalRef: canonicalRefValue,
        canonicalTitle: canonical.title || canonicalRefValue,
      });
    });

    if (!canonicalNotes.has(canonical.id)) {
      canonicalNotes.set(canonical.id, { children: new Set(), keys: new Set() });
    }
    const note = canonicalNotes.get(canonical.id);
    duplicates.forEach(dup => note.children.add(dup.id));
    Array.from(group.keys).forEach(k => note.keys.add(k));
  }

  if (dryRun) {
    return { ok: true, dryRun: true, processed: taskDocs.length, duplicatesResolved: duplicateUpdates.length, groups: summary };
  }

  if (!duplicateUpdates.length) {
    return { ok: true, processed: taskDocs.length, duplicatesResolved: 0, groups: summary, hardDelete };
  }

  const bulk = db.bulkWriter();
  for (const update of duplicateUpdates) {
    const ref = db.collection('tasks').doc(update.id);
    if (hardDelete) {
      bulk.delete(ref);
    } else {
      bulk.set(ref, update.data, { merge: true });
    }
  }

  for (const [canonicalId, info] of canonicalNotes.entries()) {
    if (!info.children.size) continue;
    const ref = db.collection('tasks').doc(canonicalId);
    const payload = {
      duplicateChildren: admin.firestore.FieldValue.arrayUnion(...Array.from(info.children)),
      duplicateResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      duplicateKey: Array.from(info.keys).join(','),
      duplicateOf: admin.firestore.FieldValue.delete(),
      deleted: false
    };
    bulk.set(ref, payload, { merge: true });
  }

  await bulk.close();

  if (duplicateReminderMappings.length) {
    const reminderUpdates = [];
    for (const mapping of duplicateReminderMappings) {
      try {
        const remindersSnap = await db.collection('reminders').where('taskId', '==', mapping.duplicateId).get();
        remindersSnap.forEach((reminderDoc) => {
          const reminderData = reminderDoc.data() || {};
          const existingNote = reminderData.note || '';
          const mergeNote = `Merged into ${mapping.canonicalRef || mapping.canonicalId}`;
          const note = existingNote.includes(mergeNote)
            ? existingNote
            : `${existingNote}\n${mergeNote}`.trim();
          reminderUpdates.push(reminderDoc.ref.set({
            status: 'completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            note,
            syncState: 'dirty',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true }));
        });
      } catch (error) {
        console.warn('[dedupe] reminder sync failed', { taskId: mapping.duplicateId, error: error?.message || error });
      }
    }
    if (reminderUpdates.length) {
      await Promise.all(reminderUpdates);
    }
  }

  if (logActivity) {
    const activityRef = db.collection('activity_stream').doc();
    await activityRef.set({
      id: activityRef.id,
      entityId: `tasks_${userId}`,
      entityType: 'task',
      activityType: 'deduplicate_tasks',
      userId,
      actor: activityActor,
      description: `Resolved ${duplicateUpdates.length} duplicate tasks across ${summary.length} groups`,
      metadata: { groups: summary, hardDelete, runId },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return {
    ok: true,
    processed: taskDocs.length,
    duplicatesResolved: duplicateUpdates.length,
    groups: summary,
    hardDelete,
    dryRun,
  };
}

async function prioritizeTasksForUser({ db, userId, runId = null }) {
  const tasksSnap = await db.collection('tasks').where('ownerUid', '==', userId).get();
  const tasks = tasksSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((task) => {
      const status = String(task.status ?? '').toLowerCase();
      const done = status === 'done' || status === 'complete' || Number(task.status) === 2 || task.deleted === true;
      return !done;
    });

  if (!tasks.length) {
    return { ok: true, considered: 0, updated: 0, items: [] };
  }

  const sorted = tasks
    .slice()
    .sort((a, b) => {
      const aDue = toMillis(a.dueDate || a.dueDateMs || a.targetDate) || Number.MAX_SAFE_INTEGER;
      const bDue = toMillis(b.dueDate || b.dueDateMs || b.targetDate) || Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });

  const payload = sorted.slice(0, 50).map((task) => ({
    id: task.id,
    ref: task.ref || task.reference || null,
    title: task.title || task.description || 'Task',
    dueDate: task.dueDate || task.targetDate || null,
    priority: task.priority ?? null,
    status: task.status || 'todo',
    theme: task.theme || null,
    goalId: task.goalId || null,
    storyId: task.storyId || null,
    persona: task.persona || null,
  }));

  const idMap = new Map();
  const detailById = new Map();
  payload.forEach((task) => {
    idMap.set(task.id, task.id);
    if (task.ref) idMap.set(task.ref.toUpperCase(), task.id);
    detailById.set(task.id, task);
  });

  const prompt = 'Score tasks 0-100 and bucket TODAY/NEXT/LATER. Return JSON {items:[{id,score,bucket}]}.\nTasks: ' + JSON.stringify(payload);

  let parsed = {};
  try {
    const raw = await callLLMJson({
      system: 'You prioritise tasks for the day. Respond with concise JSON only.',
      user: prompt,
      purpose: 'nightlyTaskPrioritization',
      userId,
      expectJson: true,
      temperature: 0.1,
    });
    parsed = raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn('[priority] LLM prioritisation failed', { userId, error: error?.message || error });
    return { ok: false, considered: payload.length, updated: 0, error: error?.message || String(error) };
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (!items.length) {
    return { ok: true, considered: payload.length, updated: 0, items: [] };
  }

  const updates = [];
  const bulk = db.bulkWriter();
  items.slice(0, 20).forEach((item, index) => {
    const key = (item?.id || item?.ref || '').toString().trim();
    if (!key) return;
    const matchedId = idMap.get(key) || idMap.get(key.toUpperCase());
    if (!matchedId) return;
    const score = Number(item.score ?? item.priority ?? item.value ?? 0);
    const bucketRaw = (item.bucket || item.category || '').toString().trim();
    const bucket = bucketRaw ? bucketRaw.toUpperCase() : 'NEXT';
    const docRef = db.collection('tasks').doc(matchedId);
    bulk.set(docRef, {
      aiPriorityScore: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
      aiPriorityBucket: bucket,
      aiPriorityRank: index + 1,
      aiPriorityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      aiPriorityRunId: runId || null,
    }, { merge: true });
    const base = detailById.get(matchedId) || {};
    updates.push({
      taskId: matchedId,
      score,
      bucket,
      rank: index + 1,
      title: base.title || null,
      ref: base.ref || null,
      dueDate: base.dueDate || null,
      persona: base.persona || null,
    });
  });
  await bulk.close();

  await db.collection('task_priority_runs').add({
    userId,
    runId: runId || null,
    considered: payload.length,
    updated: updates.length,
    items: updates,
    model: AI_PRIORITY_MODEL,
    raw: items.slice(0, 20),
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (updates.length) {
    try {
      const activityRef = db.collection('activity_stream').doc();
      await activityRef.set({
        id: activityRef.id,
        entityId: `tasks_${userId}`,
        entityType: 'task',
        activityType: 'ai_priority_update',
        actor: 'AI_Agent',
        userId,
        description: `AI reprioritised ${updates.length} tasks`,
        metadata: {
          runId,
          model: AI_PRIORITY_MODEL,
          top: updates.slice(0, 5),
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.warn('[priority] activity stream log failed', { userId, error: error?.message || error });
    }
  }

  return { ok: true, considered: payload.length, updated: updates.length, items: updates };
}

async function adjustTopTaskDueDates({ db, userId, profile, priorityResult, runId }) {
  const zone = resolveTimezone(profile, DEFAULT_TIMEZONE);
  const nowLocal = DateTime.now().setZone(coerceZone(zone)).startOf('day');

  const topLimit = Math.max(1, Math.min(Number(profile.aiFocusTopCount || 5), 10));
  const list = Array.isArray(priorityResult?.items) ? priorityResult.items : [];

  // Maintain an ascending list of top N items by rank without sorting the whole array
  const topItems = [];
  for (const it of list) {
    const rank = it && typeof it.rank === 'number' ? it.rank : Number.MAX_SAFE_INTEGER;
    // Insert into the correct position (small N so O(N^2) is acceptable)
    let inserted = false;
    for (let i = 0; i < topItems.length; i++) {
      const curRank = topItems[i] && typeof topItems[i].rank === 'number' ? topItems[i].rank : Number.MAX_SAFE_INTEGER;
      if (rank < curRank) {
        topItems.splice(i, 0, it);
        inserted = true;
        break;
      }
    }
    if (!inserted) topItems.push(it);
    if (topItems.length > topLimit) topItems.pop();
  }
  if (!topItems.length) {
    return { adjustedTop: 0, deferred: 0, locked: 0 };
  }

  const tasksSnap = await db.collection('tasks').where('ownerUid', '==', userId).get();
  const tasks = new Map();
  tasksSnap.forEach((doc) => {
    const data = doc.data() || {};
    tasks.set(doc.id, { id: doc.id, ...data });
  });

  const topTaskIds = new Set();
  let adjustedTop = 0;
  let lockedTop = 0;

  for (let index = 0; index < topItems.length; index += 1) {
    const entry = topItems[index];
    const taskId = entry?.taskId || entry?.id || entry?.ref;
    if (!taskId) continue;
    const task = tasks.get(taskId);
    if (!task || isTaskLocked(task)) {
      if (task && isTaskLocked(task)) lockedTop += 1;
      continue;
    }

    const desired = nowLocal.endOf('day');
    const newDueDateMs = desired.toMillis();

    await updateTaskDueDate(db, task.id, {
      newDueDateMs,
      reason: 'ai_focus_top',
      userId,
      runId,
      itemRef: task.ref || task.id,
    });

    topTaskIds.add(task.id);
    adjustedTop += 1;
  }

  const demoteCutoff = nowLocal.plus({ days: 1 }).endOf('day').toMillis();
  const deferTarget = nowLocal.plus({ days: 4 }).endOf('day').toMillis();
  let deferred = 0;

  for (const task of tasks.values()) {
    if (topTaskIds.has(task.id)) continue;
    if (isTaskLocked(task)) continue;
    const dueMs = toMillis(task.dueDate || task.dueDateMs || task.targetDate);
    if (!dueMs) continue;
    if (dueMs > demoteCutoff) continue;

    await updateTaskDueDate(db, task.id, {
      newDueDateMs: deferTarget,
      reason: 'ai_focus_defer',
      userId,
      runId,
      itemRef: task.ref || task.id,
    });

    deferred += 1;
  }

  return { adjustedTop, deferred, locked: lockedTop };
}

async function detectDuplicateRemindersForUser({ db, userId }) {
  const snap = await db.collection('tasks').where('ownerUid', '==', userId).get();
  const tasks = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const reminderTasks = tasks.filter((t) => t.source === 'ios_reminder' || t.source === 'MacApp' || t.source === 'mac_app');
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = (s) => crypto.createHash('sha1').update(String(s || '')).digest('hex');
  const groups = new Map();

  for (const task of reminderTasks) {
    const key1 = task.reminderId ? `rid:${task.reminderId}` : null;
    const key2 = `title:${norm(task.title)}|src:${norm(task.sourceRef || '')}`;
    const key3 = `title:${norm(task.title)}|hash:${hash((task.description || '') + '|' + JSON.stringify(task.checklist || []))}`;
    for (const key of [key1, key2, key3].filter(Boolean)) {
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(task.id);
    }
  }

  let created = 0;
  for (const [key, idSet] of groups.entries()) {
    const ids = Array.from(idSet);
    if (ids.length < 2) continue;
    const docId = `dup_${userId}_${hash(key)}`;
    await db.collection('potential_duplicates').doc(docId).set({
      id: docId,
      ownerUid: userId,
      key,
      method: key.startsWith('rid:') ? 'reminderId' : (key.includes('|src:') ? 'title+sourceRef' : 'title+hash'),
      taskIds: ids,
      count: ids.length,
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    created += 1;
  }

  return { groupsCreated: created, reminderTasks: reminderTasks.length };
}

async function autoConvertOversizedTasksForUser({ db, userId, profile, runId, maxConversions = 5 }) {
  if (profile.autoConversionEnabled === false) {
    return { processed: 0, converted: 0, conversions: [] };
  }
  const thresholdMinutes = Number(profile.autoConversionThresholdMinutes || 240);
  const pointsThreshold = Number(profile.autoConversionThresholdPoints || 2);

  const tasksSnap = await db.collection('tasks').where('ownerUid', '==', userId).get();
  const candidates = tasksSnap.docs.filter((taskDoc) => {
    const data = taskDoc.data() || {};
    if (data.autoConverted || data.convertedToStoryId) return false;
    if (data.autoConversionSkip === true) return false;
    const status = data.status;
    if (status === 2 || status === 3 || status === 'done' || status === 'completed') return false;
    const estMinutes = Number(data.estimateMin || 0);
    const estHours = Number(data.estimatedHours || 0);
    const points = Number(data.points || 0);
    if (estMinutes >= thresholdMinutes) return true;
    if (estHours >= 4) return true;
    if (points > pointsThreshold) return true;
    return false;
  });

  const conversions = [];
  const profileSnapshot = profile || {};

  for (const taskDoc of candidates.slice(0, maxConversions)) {
    try {
      const conversion = await autoConvertTask({ db, taskDoc, profile: profileSnapshot, runId });
      if (conversion) conversions.push(conversion);
    } catch (error) {
      console.error('[auto-convert] nightly task failed', { userId, taskId: taskDoc.id, error });
    }
  }

  return {
    processed: candidates.length,
    converted: conversions.length,
    conversions,
  };
}

async function generateCalendarPlanForUser({ db, userId, profile, runId }) {
  const zone = resolveTimezone(profile, DEFAULT_TIMEZONE);
  const windowStart = DateTime.now().setZone(coerceZone(zone)).startOf('day');
  const windowEnd = windowStart.plus({ days: 6 }).endOf('day');

  let busy = [];
  try {
    busy = await fetchGoogleBusy(userId, windowStart.toJSDate(), windowEnd.toJSDate());
  } catch (error) {
    console.warn('[calendar-plan] busy lookup failed', { userId, error: error?.message || error });
  }

  const plan = await planSchedule({
    db,
    userId,
    windowStart,
    windowEnd,
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
      userId,
      ownerUid: userId,
      updatedAt: nowMs,
      runId,
    };
    if (!isExisting) {
      payload.createdAt = nowMs;
    }
    batch.set(ref, payload, { merge: true });
  }

  for (const unscheduled of plan.unscheduled) {
    const id = schedulerMakeInstanceId({
      userId,
      sourceType: unscheduled.sourceType,
      sourceId: unscheduled.sourceId,
      occurrenceDate: unscheduled.dayKey,
    });
    const ref = db.collection('scheduled_instances').doc(id);
    const isExisting = existingIds.has(id);
    const schedulingContext = {
      solverRunId: plan.solverRunId,
      policyMode: unscheduled.policyMode || null,
      deepLink: unscheduled.deepLink || null,
    };
    const payload = {
      id,
      userId,
      ownerUid: userId,
      sourceType: unscheduled.sourceType,
      sourceId: unscheduled.sourceId,
      title: unscheduled.title || null,
      occurrenceDate: unscheduled.dayKey,
      status: 'unscheduled',
      statusReason: unscheduled.reason,
      durationMinutes: 0,
      priority: unscheduled.priority || 5,
      requiredBlockId: unscheduled.requiredBlockId || null,
      candidateBlockIds: unscheduled.candidateBlockIds || [],
      deepLink: unscheduled.deepLink || null,
      mobileCheckinUrl: unscheduled.mobileCheckinUrl || null,
      schedulingContext,
      updatedAt: nowMs,
      runId,
    };
    if (!isExisting) payload.createdAt = nowMs;
    batch.set(ref, payload, { merge: true });
  }

  await batch.commit();

  const jobDocId = `${userId}__${windowStart.toISODate()}`;
  await db.collection('planning_jobs').doc(jobDocId).set({
    id: jobDocId,
    userId,
    planningDate: windowStart.toISODate(),
    windowStart: windowStart.toISODate(),
    windowEnd: windowEnd.toISODate(),
    solverRunId: plan.solverRunId,
    status: 'succeeded',
    startedAt: nowMs,
    completedAt: nowMs,
    plannedCount: plan.planned.length,
    unscheduledCount: plan.unscheduled.length,
    conflicts: plan.conflicts || [],
    createdAt: nowMs,
    updatedAt: nowMs,
    runId,
  }, { merge: true });

  return {
    planned: plan.planned.length,
    unscheduled: plan.unscheduled.length,
    conflicts: Array.isArray(plan.conflicts) ? plan.conflicts.length : 0,
  };
}

async function getLatestMaintenanceSummary({ db, userId }) {
  try {
    const statusDoc = await db.collection('automation_status').doc(`nightly_task_maintenance_${userId}`).get();
    if (!statusDoc.exists) return null;
    const lastRunId = statusDoc.data()?.lastRunId || statusDoc.data()?.lastRunIdIso || null;
    if (!lastRunId) return null;
    const runDoc = await db.collection('automation_runs').doc(lastRunId).get();
    if (!runDoc.exists) return null;
    const data = runDoc.data() || {};
    return data.maintenanceSummary || data.summary || null;
  } catch (error) {
    console.warn('[maintenance] failed to load maintenance summary', { userId, error: error?.message || error });
    return null;
  }
}

async function runNightlyMaintenanceForUser({ db, userId, profile, nowUtc, runId }) {
  const duplicateReminders = await detectDuplicateRemindersForUser({ db, userId });

  const dedupeResult = await deduplicateUserTasks({
    db,
    userId,
    dryRun: false,
    hardDelete: false,
    logActivity: true,
    activityActor: 'NightlyMaintenance',
    runId,
  });

  const priorityResult = await prioritizeTasksForUser({ db, userId, runId });

  const dueDateAdjustments = await adjustTopTaskDueDates({ db, userId, profile, priorityResult, runId });

  const conversionResult = await autoConvertOversizedTasksForUser({ db, userId, profile, runId });

  const calendarPlan = await generateCalendarPlanForUser({ db, userId, profile, runId });

  const topLimit = Math.max(1, Math.min(Number(profile.aiFocusTopCount || 5), 10));
  const maintenanceSummary = {
    reminders: duplicateReminders,
    dedupe: {
      processed: dedupeResult.processed,
      resolved: dedupeResult.duplicatesResolved,
      groups: Array.isArray(dedupeResult.groups) ? dedupeResult.groups.length : 0,
    },
    priority: {
      considered: priorityResult.considered,
      updated: priorityResult.updated,
      top: priorityResult.items ? priorityResult.items.slice(0, topLimit) : [],
    },
    dueDates: dueDateAdjustments,
    conversions: conversionResult,
    calendar: calendarPlan,
    runId,
    completedAt: nowUtc.toISO(),
  };

  try {
    const activityRef = db.collection('activity_stream').doc();
    await activityRef.set({
      id: activityRef.id,
      entityId: `tasks_${userId}`,
      entityType: 'task',
      activityType: 'nightly_task_maintenance',
      actor: 'AI_Agent',
      userId,
      description: `Nightly maintenance reprioritised ${priorityResult.updated} tasks and adjusted ${dueDateAdjustments.adjustedTop} due dates.`,
      metadata: maintenanceSummary,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn('[maintenance] failed to log activity stream', { userId, error: error?.message || error });
  }

  return {
    summary: maintenanceSummary,
    duplicateReminders,
    dedupeResult,
    priorityResult,
    dueDateAdjustments,
    conversionResult,
    calendarPlan,
  };
}

exports.deduplicateTasks = httpsV2.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const dryRun = !!request?.data?.dryRun;
  const hardDelete = !!request?.data?.hardDelete;

  const db = admin.firestore();
  return deduplicateUserTasks({ db, userId: uid, dryRun, hardDelete, logActivity: true, activityActor: uid });
});

exports.suggestTaskStoryConversions = httpsV2.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const limitInput = Number(req?.data?.limit || 8);
  const limit = Math.max(1, Math.min(Number.isFinite(limitInput) ? limitInput : 8, 15));
  const persona = req?.data?.persona ? String(req.data.persona) : null;
  const singleTaskId = req?.data?.taskId ? String(req.data.taskId) : null;
  const explicitTaskIds = Array.isArray(req?.data?.taskIds)
    ? req.data.taskIds.map((id) => String(id)).filter(Boolean)
    : [];
  const targetTaskIds = new Set([
    ...explicitTaskIds,
    ...(singleTaskId ? [singleTaskId] : [])
  ]);

  const db = admin.firestore();
  let queryRef = db.collection('tasks').where('ownerUid', '==', uid);
  if (persona) queryRef = queryRef.where('persona', '==', persona);

  const tasksSnap = await queryRef.get();
  const allTasks = tasksSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  const candidates = allTasks
    .filter(t => {
      const status = String(t.status ?? '').toLowerCase();
      const isDone = status === 'done' || status === 'complete' || Number(t.status) === 2;
      const alreadyConverted = !!t.convertedToStoryId;
      const hasStory = !!(t.storyId || (t.parentType === 'story' && t.parentId));
      return !isDone && !alreadyConverted && !hasStory;
    })
    .filter(t => (targetTaskIds.size ? targetTaskIds.has(t.id) : true))
    .sort((a, b) => (Number(b.estimateMin || 0) - Number(a.estimateMin || 0)))
    .filter((_, index) => targetTaskIds.size ? true : index < limit);

  if (!candidates.length) {
    return { suggestions: [], evaluatedCount: allTasks.length };
  }

  const goalIds = Array.from(new Set(candidates.map(t => t.goalId).filter(Boolean))).slice(0, 10);
  const goalTitleById = {};
  await Promise.all(goalIds.map(async (goalId) => {
    try {
      const snap = await db.collection('goals').doc(goalId).get();
      if (snap.exists) goalTitleById[goalId] = snap.data().title || '';
    } catch { /* noop */ }
  }));

  const taskSummaries = candidates.map(task => {
    const dueMs = toMillis(task.dueDate);
    const createdMs = toMillis(task.reminderCreatedAt) ?? toMillis(task.createdAt) ?? toMillis(task.serverUpdatedAt);
    const ageDays = createdMs ? Math.floor((Date.now() - createdMs) / MS_IN_DAY) : null;
    return {
      id: task.id,
      title: task.title || 'Task',
      description: (task.description || '').slice(0, 400),
      estimateMin: task.estimateMin || null,
      estimatedHours: task.estimatedHours || (task.estimateMin ? Number((task.estimateMin / 60).toFixed(2)) : null),
      dueDate: dueMs ? new Date(dueMs).toISOString().split('T')[0] : null,
      ageDays,
      goal: task.goalId ? { id: task.goalId, title: goalTitleById[task.goalId] || '' } : null,
      persona: task.persona || 'personal',
      source: task.source || 'web',
      checklistCount: Array.isArray(task.checklist) ? task.checklist.length : 0
    };
  });

  const systemPrompt = `You are an agile coach helping a user convert oversized tasks into well-formed user stories. ` +
    `Only recommend conversion when a task represents a multi-step deliverable.`;

  const userPrompt = [
    `Persona: ${persona || (candidates[0]?.persona || 'personal')}`,
    `Tasks:`,
    JSON.stringify(taskSummaries, null, 2),
    `Guidelines:`,
    `- Recommend conversion only when the task outcome requires multiple steps or coordinated work`,
    `- Skip tasks that are atomic check-list items`,
    `- Provide a concise story title (<100 chars) and a 1-2 sentence description`,
    `- Respond with JSON: {"suggestions":[{"taskId":string,"convert":boolean,"confidence":0-1,"storyTitle":string,"storyDescription":string,"rationale":string,"goalId"?:string}]}`
  ].join('\n');

  const raw = await callLLMJson({
    system: systemPrompt,
    user: userPrompt,
    purpose: 'suggestTaskStoryConversions',
    userId: uid,
    expectJson: true,
    temperature: 0.2
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('suggestTaskStoryConversions parse error', error);
    parsed = {};
  }

  const suggestionsRaw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const candidateById = new Map(taskSummaries.map(t => [t.id, t]));

  const sanitizeConfidence = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return 0.5;
    return Math.max(0, Math.min(1, num));
  };

  const suggestions = suggestionsRaw
    .filter(item => {
      if (!item) return false;
      const convert = item.convert ?? item.shouldConvert;
      return convert === true || convert === 'true' || convert === 'yes';
    })
    .map(item => {
      const summary = candidateById.get(item.taskId);
      const taskTitle = summary?.title || item.taskTitle || 'Task';
      const storyTitle = (item.storyTitle || taskTitle).slice(0, 140);
      const storyDescription = (item.storyDescription || summary?.description || '').slice(0, 600);
      const goalId = item.goalId || (summary?.goal?.id || null);
      return {
        taskId: item.taskId,
        taskTitle,
        storyTitle,
        storyDescription,
        confidence: sanitizeConfidence(item.confidence),
        rationale: item.rationale || '',
        goalId,
        goalTitle: goalId ? (goalTitleById[goalId] || summary?.goal?.title || '') : null
      };
    })
    .filter(s => s.taskId);

  return {
    suggestions,
    evaluatedCount: candidates.length,
    totalOpen: allTasks.length
  };
});

exports.convertTasksToStories = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const conversions = Array.isArray(req?.data?.conversions) ? req.data.conversions : [];
  if (!conversions.length) throw new httpsV2.HttpsError('invalid-argument', 'conversions array required');
  if (conversions.length > 10) throw new httpsV2.HttpsError('invalid-argument', 'conversion limit exceeded (max 10)');

  const db = admin.firestore();
  const batch = db.batch();
  const results = [];

  for (const conversion of conversions) {
    const taskId = String(conversion?.taskId || '').trim();
    const storyTitle = String(conversion?.storyTitle || '').trim().slice(0, 140);
    const storyDescription = String(conversion?.storyDescription || '').trim().slice(0, 1200);
    if (!taskId || !storyTitle) {
      results.push({ taskId, status: 'skipped', reason: 'invalid_payload' });
      continue;
    }

    const taskRef = db.collection('tasks').doc(taskId);
    const taskSnap = await taskRef.get();
    if (!taskSnap.exists) {
      results.push({ taskId, status: 'skipped', reason: 'task_missing' });
      continue;
    }

    const taskData = taskSnap.data() || {};
    if (taskData.ownerUid !== uid) {
      results.push({ taskId, status: 'skipped', reason: 'not_owner' });
      continue;
    }
    if (taskData.convertedToStoryId) {
      results.push({ taskId, status: 'skipped', reason: 'already_converted', storyId: taskData.convertedToStoryId });
      continue;
    }

    const persona = taskData.persona || 'personal';
    let goalId = conversion?.goalId || taskData.goalId || null;
    let sprintId = conversion?.sprintId || taskData.sprintId || null;
    let theme = taskData.theme || null;

    if (!goalId && taskData.storyId) {
      try {
        const storySnap = await db.collection('stories').doc(taskData.storyId).get();
        if (storySnap.exists) {
          const storyData = storySnap.data() || {};
          goalId = storyData.goalId || goalId;
          theme = theme || storyData.theme || null;
          sprintId = sprintId || storyData.sprintId || null;
        }
      } catch { /* ignore */ }
    }

    if (goalId && !theme) {
      try {
        const goalSnap = await db.collection('goals').doc(goalId).get();
        if (goalSnap.exists) {
          theme = goalSnap.data().theme || theme;
        }
      } catch { /* ignore */ }
    }

    const storyRef = db.collection('stories').doc();
    const storyRefValue = await generateStoryRef(db, uid);

    const storyPayload = {
      ref: storyRefValue,
      title: storyTitle,
      description: storyDescription || taskData.description || '',
      goalId: goalId || null,
      sprintId: sprintId || null,
      priority: conversion?.priority ? Number(conversion.priority) : 2,
      points: conversion?.points ? Number(conversion.points) : Math.max(1, Math.min(8, Math.round((Number(taskData.estimateMin || 90) || 90) / 45))),
      status: 0,
      theme: theme || taskData.theme || 1,
      persona,
      ownerUid: uid,
      orderIndex: Date.now(),
      tags: Array.isArray(conversion?.tags) ? conversion.tags.slice(0, 10) : [],
      acceptanceCriteria: Array.isArray(conversion?.acceptanceCriteria) ? conversion.acceptanceCriteria.slice(0, 10) : [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    batch.set(storyRef, storyPayload);

    batch.set(taskRef, {
      status: 2,
      convertedToStoryId: storyRef.id,
      reminderSyncDirective: 'complete',
      syncState: 'dirty',
      deleted: true,
      duplicateOf: admin.firestore.FieldValue.delete(),
      duplicateKey: admin.firestore.FieldValue.delete(),
      duplicateResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      serverUpdatedAt: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    results.push({ taskId, storyId: storyRef.id, storyRef: storyRefValue, status: 'converted' });
  }

  await batch.commit();

  const convertedCount = results.filter(r => r.status === 'converted').length;
  const activityRef = db.collection('activity_stream').doc();
  await activityRef.set({
    id: activityRef.id,
    entityId: `tasks_${uid}`,
    entityType: 'task',
    activityType: 'task_to_story_conversion',
    userId: uid,
    description: `Converted ${convertedCount} tasks into stories`,
    metadata: { results },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true, results };
});

// ===== LLM Provider Helpers (Gemini-only)
async function callLLMJson({ system, user, purpose, userId, expectJson = false, temperature = 0.2 }) {
  const attempts = 3; // initial + 2 retries
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = await callGemini({ system, user, expectJson, temperature });
      // lightweight usage log
      const wrapped = aiUsageLogger.wrapAICall('google-ai-studio', 'gemini-1.5-flash');
      await wrapped(async () => ({ ok: true }), { userId, functionName: purpose, purpose });
      return text;
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

// OpenAI fallback removed: Gemini is required.

function flattenHierarchyTasks(hierarchy) {
  const tasks = [];
  (hierarchy || []).forEach((themeNode) => {
    const theme = themeNode?.theme || 'General';
    (themeNode?.goals || []).forEach((goalNode) => {
      const goalTitle = goalNode?.goalTitle || 'Goal';
      (goalNode?.stories || []).forEach((storyNode) => {
        const storyTitle = storyNode?.storyTitle || 'Story';
        (storyNode?.tasks || []).forEach((task) => {
          if (!task?.ref) return;
          tasks.push({
            ref: task.ref,
            title: task.description || task.title || 'Task',
            dueIso: task.dueDateIso || null,
            dueDisplay: task.dueDateDisplay || null,
            status: (task.status || '').toLowerCase(),
            deepLink: task.deepLink || null,
            theme,
            goalTitle,
            storyTitle,
          });
        });
      });
    });
  });
  return tasks;
}

function buildHeuristicFocus(summaryData, note) {
  const nowIso = new Date().toISOString();
  const items = [];
  if (Array.isArray(summaryData?.priorities)) {
    summaryData.priorities.slice(0, 3).forEach((item) => {
      if (!item?.ref) return;
      items.push({
        ref: item.ref,
        title: item.title || 'Task',
        bucket: 'Today',
        reason: item.dueDateDisplay ? `Due ${item.dueDateDisplay}` : 'High priority candidate',
        nextStep: null,
        confidence: null,
        dueDisplay: item.dueDateDisplay || null,
        deepLink: item.deepLink || null,
      });
    });
  }

  if (!items.length) {
    const flattened = flattenHierarchyTasks(summaryData?.hierarchy || [])
      .filter((task) => task.ref && !['done', 'completed', 'complete', 'archived'].includes(task.status));

    flattened
      .sort((a, b) => {
        const zone = summaryData?.metadata?.timezone || 'UTC';
        const aMs = a.dueIso ? DateTime.fromISO(a.dueIso, { zone, setZone: true }).toMillis() : Number.MAX_SAFE_INTEGER;
        const bMs = b.dueIso ? DateTime.fromISO(b.dueIso, { zone, setZone: true }).toMillis() : Number.MAX_SAFE_INTEGER;
        return aMs - bMs;
      })
      .slice(0, 3)
      .forEach((task) => {
        items.push({
          ref: task.ref,
          title: task.title,
          bucket: 'Today',
          reason: task.dueDisplay ? `Due ${task.dueDisplay}` : `Theme ${task.theme}`,
          nextStep: null,
          confidence: null,
          dueDisplay: task.dueDisplay || null,
          deepLink: task.deepLink || null,
        });
      });
  }

  return {
    mode: 'fallback',
    model: 'heuristic',
    generatedAt: nowIso,
    summary: note || 'AI focus unavailable; showing heuristic priorities.',
    ask: items.length ? 'Tackle these priorities first to stay on track.' : 'No urgent work detected—use the time for strategic planning.',
    items,
  };
}

async function buildDailySummaryAiFocus({ summaryData, userId }) {
  try {
    const flattened = flattenHierarchyTasks(summaryData?.hierarchy || [])
      .filter((task) => task.ref && !['done', 'completed', 'complete', 'archived'].includes(task.status));

    if (!flattened.length) return null;

    const zone = summaryData?.metadata?.timezone || 'UTC';
    flattened.sort((a, b) => {
      const aMs = a.dueIso ? DateTime.fromISO(a.dueIso, { zone, setZone: true }).toMillis() : Number.MAX_SAFE_INTEGER;
      const bMs = b.dueIso ? DateTime.fromISO(b.dueIso, { zone, setZone: true }).toMillis() : Number.MAX_SAFE_INTEGER;
      return aMs - bMs;
    });

    const context = flattened.slice(0, 12).map((task) => ({
      ref: task.ref,
      title: task.title,
      due: task.dueIso || 'none',
      status: task.status || 'unknown',
      goal: task.goalTitle,
      story: task.storyTitle,
      theme: task.theme,
    }));

    if (!context.length) return null;

    const system = 'You are an executive productivity assistant. Rank daily work and provide crisp instructions. Respond in JSON only.';
    const prompt = [
      `Today is ${summaryData?.metadata?.dayIso || DateTime.now().toISODate()} in timezone ${zone}.`,
      'Analyse the tasks below and select the most impactful focus items for today.',
      'Return JSON object {"items":[{"ref":string,"bucket":"Today"|"Watch"|"Defer","rationale":string,"nextStep":string,"confidence":number}],"ask":string,"summary":string}.',
      'Constraints: use only provided refs; limit items to 3-5; rationale <=120 chars; nextStep <=80 chars; confidence 0-1.',
      'Tasks:',
      JSON.stringify(context),
    ].join('\n');

    const raw = await callLLMJson({
      system,
      user: prompt,
      purpose: 'dailySummaryFocus',
      userId,
      expectJson: true,
      temperature: 0.2,
    });

    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn('[daily-summary-ai] JSON parse failed', error?.message || error);
      return buildHeuristicFocus(summaryData, 'AI response could not be parsed.');
    }

    const candidateMap = new Map();
    flattened.slice(0, 12).forEach((task) => {
      candidateMap.set(task.ref.toUpperCase(), task);
    });

    const aiItems = Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.focus)
      ? parsed.focus
      : [];

    const normalised = aiItems
      .map((item) => {
        const key = (item?.ref || item?.id || '').toString().trim();
        if (!key) return null;
        const base = candidateMap.get(key.toUpperCase());
        if (!base) return null;
        const rationale = (item.rationale || item.reason || item.explanation || '').toString().trim();
        const nextStep = (item.nextStep || item.action || '').toString().trim();
        let confidence = null;
        if (item.confidence != null) confidence = Number(item.confidence);
        else if (item.score != null) confidence = Number(item.score);
        if (Number.isFinite(confidence)) {
          confidence = Math.min(1, Math.max(0, confidence));
        } else {
          confidence = null;
        }
        const bucket = (item.bucket || item.category || 'Today').toString().trim() || 'Today';
        return {
          ref: base.ref,
          title: base.title,
          bucket,
          reason: rationale || (base.dueDisplay ? `Due ${base.dueDisplay}` : `Theme ${base.theme}`),
          nextStep: nextStep || null,
          confidence,
          dueDisplay: base.dueDisplay || null,
          deepLink: base.deepLink || null,
        };
      })
      .filter(Boolean)
      .slice(0, 5);

    if (!normalised.length) {
      return buildHeuristicFocus(summaryData, 'AI produced no actionable items; fallback applied.');
    }

    const askText = parsed.ask || parsed.callToAction || (normalised.length ? 'Commit to finishing these focus items today.' : null);
    const summaryText = parsed.summary || parsed.note || null;

    return {
      mode: 'ai',
      model: AI_PRIORITY_MODEL,
      generatedAt: new Date().toISOString(),
      summary: summaryText,
      ask: askText,
      items: normalised,
    };
  } catch (error) {
    console.warn('[daily-summary-ai] focus generation failed', error?.message || error);
    return buildHeuristicFocus(summaryData, 'AI focus generation failed; showing heuristic priorities.');
  }
}

function assembleDailyChecklist(summaryData) {
  const timezone = summaryData?.metadata?.timezone || DEFAULT_TIMEZONE;
  const zone = coerceZone(timezone);
  const nowIso = new Date().toISOString();

  const tasksDue = Array.isArray(summaryData?.tasksDue) ? summaryData.tasksDue : [];
  const choresDue = Array.isArray(summaryData?.choresDue) ? summaryData.choresDue : [];
  const routinesDue = Array.isArray(summaryData?.routinesDue) ? summaryData.routinesDue : [];
  const reminders = Array.isArray(summaryData?.reminders) ? summaryData.reminders : [];
  const storiesToStart = Array.isArray(summaryData?.storiesToStart) ? summaryData.storiesToStart : [];

  const items = [];
  const usedKeys = new Set();

  const focusLimitRaw = Number(summaryData?.profile?.aiFocusTopCount || 5);
  const focusLimit = Math.max(1, Math.min(Number.isFinite(focusLimitRaw) ? focusLimitRaw : 5, 7));

  const tasksById = new Map();
  const tasksByRef = new Map();
  tasksDue.forEach((task) => {
    if (!task?.id) return;
    tasksById.set(task.id, task);
    if (task.ref) tasksByRef.set(String(task.ref).toUpperCase(), task);
  });

  const aiFocusItems = Array.isArray(summaryData?.aiFocus?.items) ? summaryData.aiFocus.items : [];
  const focusByRef = new Map();
  aiFocusItems.forEach((focus) => {
    if (!focus?.ref) return;
    focusByRef.set(String(focus.ref).toUpperCase(), focus);
  });

  const maintenanceTop = Array.isArray(summaryData?.maintenance?.priority?.top)
    ? summaryData.maintenance.priority.top
    : [];

  const focusCandidates = [];
  maintenanceTop.forEach((entry, index) => {
    const task = entry?.taskId ? tasksById.get(entry.taskId) : null;
    const refUpper = entry?.ref ? String(entry.ref).toUpperCase() : null;
    const fallback = refUpper ? tasksByRef.get(refUpper) : null;
    const target = task || fallback;
    if (!target) return;
    focusCandidates.push({ target, meta: entry, origin: 'maintenance', order: index });
  });

  aiFocusItems.forEach((entry, index) => {
    const refUpper = entry?.ref ? String(entry.ref).toUpperCase() : null;
    if (!refUpper) return;
    if (focusCandidates.some((candidate) => candidate.target?.ref && candidate.target.ref.toUpperCase() === refUpper)) {
      return;
    }
    const target = tasksByRef.get(refUpper);
    if (!target) return;
    focusCandidates.push({ target, meta: entry, origin: 'ai', order: maintenanceTop.length + index });
  });

  const pushItem = (payload) => {
    if (!payload || !payload.key || usedKeys.has(payload.key)) return;
    payload.order = items.length;
    items.push(payload);
    usedKeys.add(payload.key);
  };

  const buildTaskPayload = (task, meta = {}, origin = 'manual') => {
    if (!task?.id) return null;
    const refUpper = task.ref ? String(task.ref).toUpperCase() : null;
    const focusMeta = refUpper ? focusByRef.get(refUpper) : null;
    const bucket = focusMeta?.bucket || meta?.bucket || 'Today';
    const reason = focusMeta?.reason || meta?.reason || (task.dueDisplay ? `Due ${task.dueDisplay}` : `Bucket ${bucket}`);
    return {
      key: `task:${task.id}`,
      type: 'task',
      category: 'Focus',
      title: task.title || 'Task',
      ref: task.ref || null,
      sourceId: task.id,
      dueMs: task.dueMs || null,
      dueDisplay: task.dueDisplay || null,
      reason,
      nextStep: focusMeta?.nextStep || meta?.nextStep || null,
      bucket,
      deepLink: task.deepLink || null,
      persona: task.persona || null,
      highlight: origin === 'maintenance',
      checkable: true,
      meta: { origin },
    };
  };

  focusCandidates
    .sort((a, b) => a.order - b.order)
    .forEach((candidate) => {
      if (items.filter((item) => item.category === 'Focus').length >= focusLimit) return;
      pushItem(buildTaskPayload(candidate.target, candidate.meta, candidate.origin));
    });

  if (items.filter((item) => item.category === 'Focus').length < focusLimit) {
    tasksDue
      .filter((task) => !usedKeys.has(`task:${task.id}`))
      .sort((a, b) => (a.dueMs || Number.MAX_SAFE_INTEGER) - (b.dueMs || Number.MAX_SAFE_INTEGER))
      .forEach((task) => {
        if (items.filter((item) => item.category === 'Focus').length >= focusLimit) return;
        pushItem(buildTaskPayload(task, {}, 'fallback'));
      });
  }

  const formatDueTime = (millis) => {
    if (!millis) return null;
    const dt = DateTime.fromMillis(millis, { zone });
    return dt.isValid ? dt.toLocaleString(DateTime.TIME_SIMPLE) : null;
  };

  const pushCollection = (collection, { category, type, checkable = true, reasonBuilder }) => {
    (collection || []).forEach((entry) => {
      if (!entry?.id) return;
      const key = `${type}:${entry.id}`;
      if (usedKeys.has(key)) return;
      const dueMs = entry.dueMs || (entry.dueIso ? DateTime.fromISO(entry.dueIso, { zone }).toMillis() : null);
      const dueDisplay = entry.dueDisplay || formatDueTime(dueMs);
      pushItem({
        key,
        type,
        category,
        title: entry.title || entry.name || 'Item',
        sourceId: entry.id,
        dueMs: dueMs || null,
        dueDisplay,
        reason: reasonBuilder ? reasonBuilder(entry, dueDisplay) : null,
        deepLink: entry.deepLink || null,
        checkable,
      });
    });
  };

  pushCollection(choresDue.slice(0, 4), {
    category: 'Chores',
    type: 'chore',
    reasonBuilder: (entry, dueDisplay) => (dueDisplay ? `Due ${dueDisplay}` : (entry.cadence || null)),
  });

  pushCollection(routinesDue.slice(0, 4), {
    category: 'Routines',
    type: 'routine',
    reasonBuilder: (entry, dueDisplay) => (dueDisplay ? `Run ${dueDisplay}` : (entry.cadence || null)),
  });

  const reminderEntries = reminders
    .filter((rem) => !rem.relatedTaskId || !usedKeys.has(`task:${rem.relatedTaskId}`))
    .slice(0, 4)
    .map((rem) => {
      const dueDt = toDateTime(rem.dueDate || rem.dueAt, { zone, defaultValue: null });
      return {
        id: rem.id,
        title: rem.title || 'Reminder',
        dueMs: dueDt ? dueDt.toMillis() : null,
        dueDisplay: dueDt ? dueDt.toLocaleString(DateTime.TIME_SIMPLE) : null,
        reason: rem.relatedTaskId ? 'Linked to task' : null,
      };
    });

  pushCollection(reminderEntries, { category: 'Reminders', type: 'reminder', checkable: true });

  storiesToStart.slice(0, 3).forEach((story) => {
    if (!story?.id) return;
    const key = `story:${story.id}`;
    if (usedKeys.has(key)) return;
    const dueDt = story.sprintDueDateIso ? DateTime.fromISO(story.sprintDueDateIso, { zone }) : null;
    pushItem({
      key,
      type: 'story',
      category: 'Stories',
      title: story.title || 'Story',
      sourceId: story.id,
      dueMs: dueDt && dueDt.isValid ? dueDt.toMillis() : null,
      dueDisplay: story.sprintDueDateDisplay || (dueDt && dueDt.isValid ? dueDt.toLocaleString(DateTime.DATE_MED) : null),
      reason: story.goal ? `Goal ${story.goal}` : null,
      deepLink: story.deepLink || null,
      checkable: false,
    });
  });

  return {
    generatedAt: nowIso,
    timezone,
    items,
    stats: {
      total: items.length,
      focus: items.filter((entry) => entry.category === 'Focus').length,
      chores: items.filter((entry) => entry.type === 'chore').length,
      routines: items.filter((entry) => entry.type === 'routine').length,
      reminders: items.filter((entry) => entry.type === 'reminder').length,
      stories: items.filter((entry) => entry.type === 'story').length,
    },
  };
}

async function buildDailyChecklistBriefing({ summaryData, checklist, userId }) {
  try {
    if (!checklist || !Array.isArray(checklist.items) || !checklist.items.length) {
      return null;
    }

    const timezone = summaryData?.metadata?.timezone || DEFAULT_TIMEZONE;
    const focusItems = checklist.items.filter((item) => item.category === 'Focus').slice(0, 5);
    const choreItems = checklist.items.filter((item) => item.type === 'chore').slice(0, 3);
    const routineItems = checklist.items.filter((item) => item.type === 'routine').slice(0, 3);
    const storyItems = checklist.items.filter((item) => item.type === 'story').slice(0, 2);

    const agenda = Array.isArray(summaryData?.calendarBlocks)
      ? summaryData.calendarBlocks.slice(0, 4).map((block) => ({
          title: block.title || 'Block',
          start: block.startDisplay || block.startIso || null,
          end: block.endDisplay || block.endIso || null,
          theme: block.theme || null,
        }))
      : [];

    const financeTotals = summaryData?.monzo?.totals
      ? {
          spent: summaryData.monzo.totals.spent || null,
          budget: summaryData.monzo.totals.budget || null,
          remaining: summaryData.monzo.totals.remaining || null,
        }
      : null;

    const payload = {
      date: summaryData?.metadata?.dayIso || DateTime.now().setZone(coerceZone(timezone)).toISODate(),
      timezone,
      focus: focusItems.map((item) => ({ title: item.title, reason: item.reason, due: item.dueDisplay })),
      chores: choreItems.map((item) => ({ title: item.title, due: item.dueDisplay })),
      routines: routineItems.map((item) => ({ title: item.title, due: item.dueDisplay })),
      stories: storyItems.map((item) => ({ title: item.title, due: item.dueDisplay })),
      agenda,
      finance: financeTotals,
      stats: checklist.stats || null,
    };

    const systemPrompt = 'You are an encouraging executive assistant. Write a concise morning briefing (<=80 words). Respond with JSON {"headline":string,"body":string,"checklist":string}.';
    const userPrompt = `Context: ${JSON.stringify(payload)}`;

    const raw = await callLLMJson({
      system: systemPrompt,
      user: userPrompt,
      purpose: 'dailyChecklistBriefing',
      userId,
      expectJson: true,
      temperature: 0.3,
    });

    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn('[daily-briefing] JSON parse failed', error?.message || error);
      parsed = {};
    }

    const headline = parsed.headline || parsed.title || null;
    const body = parsed.body || parsed.summary || null;
    const checklistNote = parsed.checklist || parsed.actions || null;

    return {
      mode: 'ai',
      model: 'gemini-1.5-flash',
      generatedAt: new Date().toISOString(),
      headline: headline || 'Stay on target today',
      body: body || 'Lead with your focus items, then clear the supporting chores and routines to keep momentum.',
      checklist: checklistNote || 'Work the focus list top to bottom and tick items the moment they are done so sync stays tight.',
    };
  } catch (error) {
    console.warn('[daily-briefing] generation failed', error?.message || error);
    const stats = checklist?.stats || {};
    const focusCount = Number(stats.focus || 0);
    const upkeepCount = Number((stats.chores || 0) + (stats.routines || 0));
    const bodyParts = [];
    if (focusCount) bodyParts.push(`You have ${focusCount} focus ${focusCount === 1 ? 'task' : 'tasks'} to ship—knock those out before midday.`);
    if (upkeepCount) bodyParts.push(`There are ${upkeepCount} upkeep items queued; clear them in one sweep to keep automations happy.`);
    if (!bodyParts.length) bodyParts.push('Use the open space for planning or recovery; no urgent items detected.');
    return {
      mode: 'fallback',
      model: 'heuristic',
      generatedAt: new Date().toISOString(),
      headline: focusCount ? 'Focus, then upkeep' : 'A light agenda',
      body: bodyParts.join(' '),
      checklist: 'Review the list once an hour and tick items so iOS Reminders stays mirrored.',
    };
  }
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
  const uid = req.auth.uid;
  const after = req.data?.after || null; // ms or sec accepted
  let afterSec = null;
  if (after) {
    afterSec = (String(after).length > 10) ? Math.floor(Number(after) / 1000) : Number(after);
  }
  console.log('[syncStrava] uid', uid, 'after', after, 'afterSec', afterSec);
  try {
    const result = await fetchStravaActivities(uid, { afterSec });
    await recordIntegrationLog(uid, 'strava', 'success', 'Strava sync completed', {
      imported: result?.imported || 0,
      after: afterSec,
    });
    return result;
  } catch (error) {
    await recordIntegrationLog(uid, 'strava', 'error', error?.message || 'Strava sync failed', {
      after: afterSec,
    });
    if (error instanceof httpsV2.HttpsError) throw error;
    throw new httpsV2.HttpsError('internal', error?.message || 'Failed to sync Strava');
  }
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
  try {
    const result = await _syncParkrunInternal(uid, athleteId, countryBaseUrl);
    await recordIntegrationLog(uid, 'parkrun', 'success', 'Parkrun results synced', {
      imported: result?.imported || 0,
      athleteId,
      countryBaseUrl,
    });
    return result;
  } catch (error) {
    await recordIntegrationLog(uid, 'parkrun', 'error', error?.message || 'Parkrun sync failed', {
      athleteId,
      countryBaseUrl,
    });
    if (error instanceof httpsV2.HttpsError) throw error;
    throw new httpsV2.HttpsError('internal', error?.message || 'Failed to sync Parkrun results');
  }
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
    const payload = toPush.map(t => {
      const themeLabel = t.theme || t.theme_id || 'General';
      const title = `[${themeLabel}] – ${t.title || 'Task'}`;
      const url = t.deepLink || (t.ref ? `/tasks?ref=${encodeURIComponent(t.ref)}` : `/tasks?taskId=${encodeURIComponent(t.id)}`);
      const noteLines = [
        t.reminderNote || '',
        `BOB: ${url}`,
        t.storyId ? `Story: ${t.storyId}` : '',
        t.goalId ? `Goal: ${t.goalId}` : '',
      ].filter(Boolean);
      return ({
        id: t.id,
        title,
        dueDate: t.dueDate || null,
        ref: t.ref || `TK-${String(t.id||'').slice(0,6).toUpperCase()}`,
        createdAt: t.createdAt || null,
        storyId: t.storyId || null,
        goalId: t.goalId || null,
        note: noteLines.join('\n')
      });
    });
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
    const classifyType = (title) => {
      const t = String(title || '').toLowerCase();
      const choreHints = ['laundry', 'trash', 'garbage', 'recycling', 'clean', 'dishes', 'vacuum', 'mop', 'tidy'];
      const routineHints = ['routine', 'meditate', 'journal', 'stretch', 'hydrate', 'water plants'];
      if (choreHints.some(k => t.includes(k))) return 'chore';
      if (routineHints.some(k => t.includes(k))) return 'routine';
      return 'reminder';
    };
    for (const u of updates) {
      const id = String(u.id || '');
      const reminderId = u.reminderId ? String(u.reminderId) : null;
      const completed = !!u.completed;
      const title = String(u.title || '');
      if (!id && !reminderId) continue;
      let ref = null;
      if (id) ref = db.collection('tasks').doc(id);
      else {
        const snap = await db.collection('tasks').where('ownerUid','==',uid).where('reminderId','==',reminderId).limit(1).get();
        if (!snap.empty) ref = snap.docs[0].ref;
      }
      if (ref) {
        const task_type = classifyType(title);
        const data = { updatedAt: admin.firestore.FieldValue.serverTimestamp(), task_type };
        if (reminderId) data['reminderId'] = reminderId;
        if (completed) data['status'] = 2;
        await ref.set(data, { merge: true });
        updated++;
      } else if (reminderId || title) {
        // Auto-import new task from Reminders
        const newRef = db.collection('tasks').doc();
        const task_type = classifyType(title);
        await newRef.set({
          id: newRef.id,
          ownerUid: uid,
          persona: 'personal',
          title: title || 'Reminder',
          status: completed ? 2 : 0,
          task_type,
          entry_method: 'import:reminders',
          source: 'ios_reminder',
          reminderId: reminderId || null,
          reminderCreatedAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
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
exports.prioritizeBacklog = httpsV2.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  let tasks = (req.data && Array.isArray(req.data.tasks)) ? req.data.tasks : [];
  if (tasks.length > 50) tasks = tasks.slice(0, 50);

  const systemPrompt = 'You prioritise tasks using weighted scoring and return strict JSON only.';
  const userPrompt = [
    'Score the following tasks with an integer score 0-100 and bucket into TODAY, NEXT, or LATER based on urgency and importance. Return JSON {"items":[{"id":string,"score":number,"bucket":"TODAY|NEXT|LATER"}]}',
    'Tasks:',
    JSON.stringify(tasks)
  ].join('\n');

  const raw = await callLLMJson({
    system: systemPrompt,
    user: userPrompt,
    purpose: 'prioritizeBacklog',
    userId: req.auth.uid,
    expectJson: true,
    temperature: 0.2,
  });

  let out = { items: [] };
  try {
    out = JSON.parse(raw);
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

const LOG_RETENTION_DAYS = 30;

const createExpiryTimestamp = (days = LOG_RETENTION_DAYS) => {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return admin.firestore.Timestamp.fromDate(expiresAt);
};

async function recordIntegrationLog(uid, integration, status, message, metadata = {}) {
  try {
    const db = admin.firestore();
    const ref = db.collection('integration_logs').doc();
    const level = status === 'error' ? 'error' : (status === 'warning' ? 'warning' : 'info');
    const expiresAt = createExpiryTimestamp();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      id: ref.id,
      ownerUid: uid,
      integration,
      status,
      level,
      source: integration,
      message,
      metadata,
      createdAt: now,
      ts: now,
      expiresAt,
    });
  } catch (error) {
    console.error('Failed to write integration log', { integration, status, message, metadata, error });
  }
}

async function recordAiLog(uid, event, status, message, metadata = {}) {
  try {
    const db = admin.firestore();
    const ref = db.collection('ai_logs').doc();
    const level = status === 'error' ? 'error' : (status === 'warning' ? 'warning' : 'info');
    const expiresAt = createExpiryTimestamp();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({
      id: ref.id,
      ownerUid: uid,
      event,
      status,
      level,
      message,
      metadata,
      createdAt: now,
      ts: now,
      expiresAt,
    });
  } catch (error) {
    console.error('Failed to write AI log', { event, status, message, metadata, error });
  }
}

async function _syncSteam(uid) {
  const db = admin.firestore();
  const profile = await db.collection('profiles').doc(uid).get();
  const steamId = profile.data()?.steamId;

  if (!steamId) {
    throw new Error("SteamID not found in profile.");
  }

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env.STEAM_WEB_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;

  const startedAt = Date.now();
  try {
    const data = await fetchJson(url);

    const games = data?.response?.games || [];

    const batch = db.batch();
    for (const item of games) {
      const docRef = db.collection('steam').doc(`${uid}_${item.appid}`);
      batch.set(docRef, {
        ...item,
        ownerUid: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();

    await db.collection('profiles').doc(uid).set({
      steamLastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      steamLibrarySize: games.length,
    }, { merge: true });

    await recordIntegrationLog(uid, 'steam', 'success', `Synced ${games.length} Steam games`, {
      durationMs: Date.now() - startedAt,
      librarySize: games.length,
    });

    return { ok: true, written: games.length };
  } catch (error) {
    await recordIntegrationLog(uid, 'steam', 'error', error.message || 'Steam sync failed', {
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

exports.syncTrakt = httpsV2.onCall({ secrets: [TRAKT_CLIENT_ID] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  const uid = req.auth.uid;
  try {
    const result = await _syncTrakt(uid);
    await recordIntegrationLog(uid, 'trakt', 'success', 'Trakt history sync completed', {
      imported: result?.written || 0,
    });
    return result;
  } catch (error) {
    await recordIntegrationLog(uid, 'trakt', 'error', error?.message || 'Trakt sync failed', {});
    if (error instanceof httpsV2.HttpsError) throw error;
    throw new httpsV2.HttpsError('internal', error?.message || 'Failed to sync Trakt');
  }
});

exports.syncSteam = httpsV2.onCall({ secrets: [STEAM_WEB_API_KEY] }, async (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError("unauthenticated", "Sign in required.");
  return await _syncSteam(req.auth.uid);
});

exports.getSteamAppDetails = httpsV2.onCall(async (req) => {
  if (!req?.auth?.uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const appIdRaw = req?.data?.appId;
  const appId = String(appIdRaw || '').trim();
  if (!appId) {
    throw new httpsV2.HttpsError('invalid-argument', 'appId is required');
  }

  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&cc=us&l=en`;
  const data = await fetchJson(url);
  const entry = data?.[appId];
  if (!entry || !entry.success || !entry.data) {
    throw new httpsV2.HttpsError('not-found', `No Steam app found for ${appId}`);
  }

  const payload = entry.data;
  return {
    appId,
    name: payload.name,
    headerImage: payload.header_image,
    capsuleImage: payload.capsule_image,
    shortDescription: payload.short_description,
    genres: payload.genres || [],
    releaseDate: payload.release_date || null,
    website: payload.website || null,
  };
});

// Media Import Controller: Generate Stories + Tasks from connected sources
exports.mediaImportGenerateStories = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const sources = Array.isArray(req?.data?.sources) ? req.data.sources : ['steam', 'trakt'];
  const goodreadsItems = Array.isArray(req?.data?.goodreadsItems) ? req.data.goodreadsItems : [];
  const results = {};
  if (sources.includes('steam')) {
    results.steam = await importFromSteam(uid, {});
  }
  if (sources.includes('trakt')) {
    results.trakt = await importFromTrakt(uid, {});
  }
  if (goodreadsItems.length) {
    results.goodreads = await importFromGoodreadsLike(uid, goodreadsItems);
  }
  return { ok: true, results };
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

// Theme-based Calendar Planner (runs daily at 01:00 UTC)
exports.dailyPlanningJob = schedulerV2.onSchedule({ schedule: '0 1 * * *', timeZone: 'UTC', secrets: [GOOGLE_AI_STUDIO_API_KEY, NYLAS_API_KEY] }, async () => {
  const db = ensureFirestore();
  const profilesSnap = await db.collection('profiles').get();
  const runStartedAt = admin.firestore.FieldValue.serverTimestamp();
  for (const doc of profilesSnap.docs) {
    const uid = doc.id;
    const profile = doc.data() || {};
    if (profile.calendarPlannerEnabled === false) continue;

    const runId = `${uid}_${Date.now()}_dailyPlanner`;
    try {
      const persona = 'personal';
      const horizonDays = 1;
      const context = await assemblePlanningContext(uid, persona, horizonDays);
      context.userId = uid;
      const aiResponse = await generateAIPlan(context, {});
      const validation = await validateCalendarBlocks(aiResponse.blocks || [], context);
      const proposedBlocks = Array.isArray(aiResponse.blocks) ? aiResponse.blocks : [];
      const timezone = profile.timezone || context?.prefs?.timezone || 'UTC';
      const previewBlocks = await buildBlockPreviews(uid, proposedBlocks, { timezone });
      const approvalRequired = profile.calendarPlannerApprovalRequired === true;
      if (approvalRequired) {
        // Save proposal and email summary with approve link
        const token = crypto.randomBytes(16).toString('hex');
        const jobDoc = {
          id: runId,
          userId: uid,
          startedAt: runStartedAt,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'proposed',
          appliedBlocks: 0,
          validator: validation,
          rationale: aiResponse.rationale || null,
          source: 'daily_planner',
          approvalToken: token,
          proposedBlocks: aiResponse.blocks || [],
          preview: {
            timezone,
            blocks: previewBlocks,
          },
        };
        await db.collection('planning_jobs').doc(runId).set(jobDoc, { merge: true });
        const origin = process.env.APP_BASE_URL || 'https://bob20250810.web.app';
        const approveUrl = `${origin}/planning/approval?jobId=${encodeURIComponent(runId)}&uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`;

        try {
          const email = profile.email || null;
          if (email) {
            const directApproveUrl = `${origin}/api/approve-planning?jobId=${encodeURIComponent(runId)}&uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}&approve=1`;
            const blockRows = previewBlocks.slice(0, 10).map((block) => {
              const label = block.displayStart && block.displayEnd
                ? `${block.displayStart} → ${block.displayEnd}`
                : block.displayStart || 'Scheduled block';
              const detailParts = [
                block.title,
                block.theme ? `Theme: ${block.theme}` : null,
                block.task?.title ? `Task: ${block.task.title}` : null,
                block.goal?.title ? `Goal: ${block.goal.title}` : null,
              ].filter(Boolean);
              return `<li><strong>${escapeHtml(label)}</strong><br/>${detailParts.map(escapeHtml).join(' · ')}</li>`;
            }).join('');
            const totalBlocks = previewBlocks.length;
            const blockCountLine = totalBlocks
              ? `<p><strong>${totalBlocks}</strong> block${totalBlocks === 1 ? '' : 's'} proposed for ${timezone}.</p>`
              : '<p>No blocks proposed.</p>';
            const html = `
              <h2>BOB · Daily Plan Proposal</h2>
              <p>We prepared a plan for your calendar. Validation score: ${(validation.score || 0).toFixed(2)}</p>
              ${blockCountLine}
              ${blockRows ? `<ul>${blockRows}</ul>` : ''}
              <p>
                <a href="${approveUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;">
                  Review & Approve in BOB
                </a>
              </p>
              <p>If you prefer to approve directly, <a href="${directApproveUrl}">use this quick link</a>.</p>
              <p>This will add the proposed time blocks to your calendar.</p>`;
            await sendEmail({ to: email, subject: 'BOB · Daily Plan Proposal (Approval Needed)', html });
          }
        } catch (e) { console.warn('[dailyPlanningJob] email proposal failed', e?.message || e); }

        try {
          const goalSummaries = new Map();
          previewBlocks.forEach((block) => {
            const goalId = block?.goal?.id;
            if (!goalId) return;
            if (!goalSummaries.has(goalId)) goalSummaries.set(goalId, []);
            goalSummaries.get(goalId).push(block);
          });
          const nowTs = admin.firestore.FieldValue.serverTimestamp();
          for (const [goalId, blocksForGoal] of goalSummaries.entries()) {
            const sentences = blocksForGoal.slice(0, 3).map((block) => {
              const when = block.displayStart ? block.displayStart : 'Upcoming';
              return `• ${when}: ${block.title}`;
            }).join('\n');
            const content = `Nightly planner prepared ${blocksForGoal.length} session${blocksForGoal.length === 1 ? '' : 's'} for this goal.\n${sentences}\n\nApprove: ${approveUrl}`;
            await db.collection('goal_chats').doc(goalId).collection('messages').add({
              ownerUid: uid,
              role: 'assistant',
              content,
              createdAt: nowTs,
              jobId: runId,
              type: 'planning_proposal',
            });
          }
        } catch (chatErr) {
          console.warn('[dailyPlanningJob] goal chat notification failed', chatErr?.message || chatErr);
        }
      } else {
        let applied = 0;
        if (validation.errors.length === 0) {
          // attach confidence score to each block
          const blocks = proposedBlocks.map(b => ({ ...b, confidence_score: validation.score, entry_method: 'calendar_ai' }));
          applied = await applyCalendarBlocks(uid, persona, blocks);
        }
        await db.collection('planning_jobs').doc(runId).set({
          id: runId,
          userId: uid,
          startedAt: runStartedAt,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'completed',
          appliedBlocks: applied,
          validator: validation,
          rationale: aiResponse.rationale || null,
          source: 'daily_planner',
          preview: {
            timezone,
            blocks: previewBlocks,
          },
        }, { merge: true });
      }
    } catch (error) {
      await db.collection('planning_jobs').doc(runId).set({
        id: runId,
        userId: uid,
        startedAt: runStartedAt,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'error',
        error: error?.message || String(error),
        source: 'daily_planner',
      }, { merge: true });
    }
  }
});

// ===== Daily Summary Email Automation (Issue #204)

exports.nightlyTaskMaintenance = schedulerV2.onSchedule({
  schedule: '0 2 * * *',
  timeZone: 'UTC',
  memory: '1GiB',
  secrets: [GOOGLE_AI_STUDIO_API_KEY],
}, async () => {
  const db = ensureFirestore();
  const nowUtc = DateTime.now().setZone('UTC');
  const profilesSnap = await db.collection('profiles').get();

  for (const doc of profilesSnap.docs) {
    const profile = doc.data() || {};
    if (profile.nightlyMaintenanceEnabled === false) continue;
    const userId = doc.id;

    const runId = await logAutomationRun(db, {
      automation: 'nightly_task_maintenance',
      userId,
      status: 'started',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const maintenance = await runNightlyMaintenanceForUser({ db, userId, profile, nowUtc, runId });

      await recordAutomationStatus(db, {
        userId,
        automation: 'nightly_task_maintenance',
        dayIso: nowUtc.toISODate(),
        status: 'success',
        runId,
      });

      await db.collection('automation_runs').doc(runId).set({
        status: 'success',
        maintenanceSummary: maintenance.summary,
        reminderDuplicates: maintenance.duplicateReminders,
        dedupe: maintenance.dedupeResult,
        prioritization: maintenance.priorityResult,
        dueDateAdjustments: maintenance.dueDateAdjustments,
        conversions: maintenance.conversionResult,
        calendarPlan: maintenance.calendarPlan,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error('[nightly-maintenance] failed', { userId, error });
      await recordAutomationStatus(db, {
        userId,
        automation: 'nightly_task_maintenance',
        dayIso: nowUtc.toISODate(),
        status: 'error',
        message: error?.message || String(error),
        runId,
      });
      await db.collection('automation_runs').doc(runId).set({
        status: 'error',
        error: error?.message || String(error),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
});

exports.runNightlyMaintenanceNow = httpsV2.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY, defineSecret("NYLAS_API_KEY")] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const sendSummary = req?.data?.sendSummary !== false;
  const db = ensureFirestore();
  const nowUtc = DateTime.now().setZone('UTC');

  const profileSnap = await db.collection('profiles').doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};

  const runId = await logAutomationRun(db, {
    automation: 'nightly_task_maintenance',
    userId: uid,
    status: 'started',
    triggeredBy: 'callable',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    const maintenance = await runNightlyMaintenanceForUser({ db, userId: uid, profile, nowUtc, runId });

    let summaryResult = null;
    if (sendSummary) {
      summaryResult = await dispatchDailySummaryForUser({
        db,
        userId: uid,
        profile,
        nowUtc,
        runContext: { trigger: 'manual_maintenance', runId, force: true, maintenanceSummary: maintenance.summary },
      });
    }

    await recordAutomationStatus(db, {
      userId: uid,
      automation: 'nightly_task_maintenance',
      dayIso: nowUtc.toISODate(),
      status: 'success',
      runId,
    });

    await db.collection('automation_runs').doc(runId).set({
      status: 'success',
      maintenanceSummary: maintenance.summary,
      reminderDuplicates: maintenance.duplicateReminders,
      dedupe: maintenance.dedupeResult,
      prioritization: maintenance.priorityResult,
      dueDateAdjustments: maintenance.dueDateAdjustments,
      conversions: maintenance.conversionResult,
      calendarPlan: maintenance.calendarPlan,
      manualTrigger: true,
      dailySummary: summaryResult,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await recordAiLog(uid, 'nightly_maintenance_manual', 'success', 'Manual nightly maintenance completed', {
      runId,
      sendSummary,
      maintenance: maintenance?.summary || null,
      dailySummary: summaryResult?.dayIso || null,
    });

    return {
      ok: true,
      maintenance,
      dailySummary: summaryResult,
      runId,
    };
  } catch (error) {
    console.error('[run-nightly-maintenance-now] failed', error);
    await recordAiLog(uid, 'nightly_maintenance_manual', 'error', error?.message || 'Manual nightly maintenance failed', {
      runId,
      sendSummary,
    });
    await recordAutomationStatus(db, {
      userId: uid,
      automation: 'nightly_task_maintenance',
      dayIso: nowUtc.toISODate(),
      status: 'error',
      message: error?.message || String(error),
      runId,
    });
    await db.collection('automation_runs').doc(runId).set({
      status: 'error',
      error: error?.message || String(error),
      manualTrigger: true,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new httpsV2.HttpsError('internal', error?.message || 'Failed to run nightly maintenance');
  }
});

const DAILY_SUMMARY_TARGET_MINUTES = 6 * 60;
const DATA_QUALITY_TARGET_MINUTES = 19 * 60;
const DISPATCH_WINDOW_MINUTES = 10;

function shouldTriggerWindow(nowLocal, targetMinutes, alreadySentDayIso) {
  if (!nowLocal) return { shouldSend: false, dayIso: null };
  const dayIso = nowLocal.toISODate();
  if (alreadySentDayIso === dayIso) return { shouldSend: false, dayIso };
  const minutesSinceMidnight = nowLocal.hour * 60 + nowLocal.minute;
  const diff = Math.abs(minutesSinceMidnight - targetMinutes);
  return { shouldSend: diff <= DISPATCH_WINDOW_MINUTES, dayIso };
}

async function recordAutomationStatus(db, { userId, automation, dayIso, status, message, runId }) {
  const statusRef = db.collection('automation_status').doc(`${automation}_${userId}`);
  const payload = {
    userId,
    automation,
    lastStatus: status,
    lastMessage: message || null,
    lastRunId: runId || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (status === 'success' && dayIso) payload.lastSentDayIso = dayIso;
  if (status === 'error') payload.lastErrorAt = admin.firestore.FieldValue.serverTimestamp();
  if (status === 'skipped') payload.lastSkippedAt = admin.firestore.FieldValue.serverTimestamp();
  await statusRef.set({
    ...payload,
  }, { merge: true });
}

async function logAutomationRun(db, payload) {
  const ref = db.collection('automation_runs').doc();
  await ref.set({
    id: ref.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...payload,
  });
  return ref.id;
}

async function dispatchDailySummaryForUser({ db, userId, profile, nowUtc, runContext }) {
  const zone = resolveTimezone(profile, DEFAULT_TIMEZONE);
  const nowLocal = nowUtc.setZone(coerceZone(zone));
  const statusSnap = await db.collection('automation_status').doc(`daily_summary_${userId}`).get();
  const lastSentDay = statusSnap.exists ? statusSnap.data().lastSentDayIso || null : null;
  const { shouldSend, dayIso } = shouldTriggerWindow(nowLocal, DAILY_SUMMARY_TARGET_MINUTES, lastSentDay);
  if (!shouldSend && !runContext?.force) return { skipped: true, reason: 'window_miss' };

  const summaryData = await buildDailySummaryData(db, userId, {
    day: nowLocal,
    timezone: zone,
    locale: profile.locale || profile.language || 'en-GB',
  });

  const aiFocus = await buildDailySummaryAiFocus({ summaryData, userId });
  if (aiFocus) {
    summaryData.aiFocus = aiFocus;
  }

  if (runContext?.maintenanceSummary) {
    summaryData.maintenance = runContext.maintenanceSummary;
  } else {
    const latestMaintenance = await getLatestMaintenanceSummary({ db, userId });
    if (latestMaintenance) {
      summaryData.maintenance = latestMaintenance;
    }
  }

  summaryData.dailyChecklist = assembleDailyChecklist(summaryData);
  try {
    const briefing = await buildDailyChecklistBriefing({ summaryData, checklist: summaryData.dailyChecklist, userId });
    if (briefing) {
      summaryData.dailyBriefing = briefing;
    }
  } catch (error) {
    console.warn('[daily-summary] briefing generation failed', error?.message || error);
  }

  const html = renderDailySummaryEmail(summaryData);
  const subject = `Daily Summary · ${summaryData.metadata.dayIso}`;

  let emailResult = null;
  if (profile.email) {
    emailResult = await sendEmail({ to: profile.email, subject, html });
  }

  await db.collection('daily_summaries').add({
    userId,
    dayIso: summaryData.metadata.dayIso,
    timezone: summaryData.metadata.timezone,
    locale: summaryData.metadata.locale,
    summary: summaryData,
    email: profile.email || null,
    emailResult: emailResult ? { messageId: emailResult.messageId || null, response: emailResult.response || null } : null,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    runContext,
  });

  return { skipped: false, dayIso: summaryData.metadata.dayIso };
}

async function dispatchDataQualityForUser({ db, userId, profile, nowUtc, force = false }) {
  const zone = resolveTimezone(profile, DEFAULT_TIMEZONE);
  const nowLocal = nowUtc.setZone(coerceZone(zone));
  const statusSnap = await db.collection('automation_status').doc(`data_quality_${userId}`).get();
  const lastSentDay = statusSnap.exists ? statusSnap.data().lastSentDayIso || null : null;
  const { shouldSend, dayIso } = shouldTriggerWindow(nowLocal, DATA_QUALITY_TARGET_MINUTES, lastSentDay);
  const effectiveDayIso = dayIso || nowUtc.toISODate();
  if (!shouldSend && !force) return { skipped: true, reason: 'window_miss' };

  const snapshot = await buildDataQualitySnapshot(db, userId, { windowEnd: nowUtc });
  const html = renderDataQualityEmail({ profile, snapshot });
  const subject = `Data Quality · ${snapshot.window.endIso?.slice(0, 16) || ''}`;

  let emailResult = null;
  if (profile.email) {
    emailResult = await sendEmail({ to: profile.email, subject, html });
  }

  await db.collection('data_quality_reports').add({
    userId,
    window: snapshot.window,
    summary: snapshot.summaryStats,
    payload: snapshot,
    email: profile.email || null,
    emailResult: emailResult ? { messageId: emailResult.messageId || null } : null,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { skipped: false, dayIso: effectiveDayIso };
}

exports.dispatchDailySummaryEmail = schedulerV2.onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'UTC',
  memory: '512MiB',
  secrets: [defineSecret('NYLAS_API_KEY')],
}, async () => {
  const db = ensureFirestore();
  const nowUtc = DateTime.now().setZone('UTC');
  const profilesSnap = await db.collection('profiles').get();
  for (const doc of profilesSnap.docs) {
    const profile = doc.data() || {};
    const userId = doc.id;
    if (profile.dailySummaryEnabled === false) continue;
    if (!profile.email && profile.dailySummaryRequireEmail !== false) continue;

    const runId = await logAutomationRun(db, {
      automation: 'daily_summary',
      userId,
      status: 'started',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const result = await dispatchDailySummaryForUser({ db, userId, profile, nowUtc, runContext: { trigger: 'scheduled', runId } });
      if (!result.skipped) {
        await recordAutomationStatus(db, { userId, automation: 'daily_summary', dayIso: result.dayIso, status: 'success', runId });
      }
      await db.collection('automation_runs').doc(runId).set({ status: result.skipped ? 'skipped' : 'success', result, completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error('[daily-summary] failed', { userId, error });
      await db.collection('automation_runs').doc(runId).set({ status: 'error', error: error.message || String(error), completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await recordAutomationStatus(db, { userId, automation: 'daily_summary', dayIso: nowUtc.toISODate(), status: 'error', message: error.message || String(error), runId });
    }
  }
});

exports.dispatchDataQualityEmail = schedulerV2.onSchedule({
  schedule: 'every 30 minutes',
  timeZone: 'UTC',
  memory: '512MiB',
  secrets: [defineSecret('NYLAS_API_KEY')],
}, async () => {
  const db = ensureFirestore();
  const nowUtc = DateTime.now().setZone('UTC');
  const profilesSnap = await db.collection('profiles').get();
  for (const doc of profilesSnap.docs) {
    const profile = doc.data() || {};
    const userId = doc.id;
    if (profile.dataQualityEmailEnabled === false) continue;
    if (!profile.email && profile.dataQualityRequireEmail !== false) continue;

    const runId = await logAutomationRun(db, {
      automation: 'data_quality',
      userId,
      status: 'started',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const result = await dispatchDataQualityForUser({ db, userId, profile, nowUtc });
      if (!result.skipped) {
        await recordAutomationStatus(db, { userId, automation: 'data_quality', dayIso: result.dayIso, status: 'success', runId });
      }
      await db.collection('automation_runs').doc(runId).set({ status: result.skipped ? 'skipped' : 'success', result, completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error('[data-quality] failed', { userId, error });
      await db.collection('automation_runs').doc(runId).set({ status: 'error', error: error.message || String(error), completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await recordAutomationStatus(db, { userId, automation: 'data_quality', dayIso: nowUtc.toISODate(), status: 'error', message: error.message || String(error), runId });
    }
  }
});

exports.sendDailySummaryNow = httpsV2.onCall({ secrets: [defineSecret('NYLAS_API_KEY')] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get();
  if (!profileSnap.exists) throw new httpsV2.HttpsError('not-found', 'Profile not found');
  const profile = profileSnap.data() || {};
  const nowUtc = DateTime.now().setZone('UTC');
  let runId = null;
  try {
    runId = await logAutomationRun(db, {
      automation: 'daily_summary',
      userId: uid,
      status: 'manual_start',
      triggeredBy: 'callable',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    const result = await dispatchDailySummaryForUser({ db, userId: uid, profile, nowUtc, runContext: { trigger: 'manual', runId, force: true } });
    await recordAutomationStatus(db, { userId: uid, automation: 'daily_summary', dayIso: result.dayIso || nowUtc.toISODate(), status: 'success', runId });
    await db.collection('automation_runs').doc(runId).set({ status: 'success', result, completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await recordAiLog(uid, 'daily_summary_manual', 'success', 'Manual daily summary generated', {
      runId,
      dayIso: result.dayIso || nowUtc.toISODate(),
      skipped: result.skipped || false,
    });
    return { ok: true, result };
  } catch (error) {
    console.error('[daily-summary-now] failed', error);
    await recordAiLog(uid, 'daily_summary_manual', 'error', error?.message || 'Failed to send daily summary', {
      runId,
    });
    throw new httpsV2.HttpsError('internal', error.message || 'Failed to send daily summary');
  }
});

exports.sendDataQualityNow = httpsV2.onCall({ secrets: [defineSecret('NYLAS_API_KEY')] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get();
  if (!profileSnap.exists) throw new httpsV2.HttpsError('not-found', 'Profile not found');
  const profile = profileSnap.data() || {};
  const nowUtc = DateTime.now().setZone('UTC');
  let runId = null;
  try {
    runId = await logAutomationRun(db, {
      automation: 'data_quality',
      userId: uid,
      status: 'manual_start',
      triggeredBy: 'callable',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    const result = await dispatchDataQualityForUser({ db, userId: uid, profile, nowUtc, force: true });
    if (!result.skipped) {
      await recordAutomationStatus(db, { userId: uid, automation: 'data_quality', dayIso: result.dayIso || nowUtc.toISODate(), status: 'success', runId });
    }
    await db.collection('automation_runs').doc(runId).set({ status: result.skipped ? 'skipped' : 'success', result, completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await recordAiLog(uid, 'data_quality_manual', result.skipped ? 'warning' : 'success', result.skipped ? 'Manual data quality skipped (window miss)' : 'Manual data quality report generated', {
      runId,
      dayIso: result.dayIso || nowUtc.toISODate(),
      skipped: result.skipped || false,
    });
    return { ok: true, result };
  } catch (error) {
    console.error('[data-quality-now] failed', error);
    await recordAiLog(uid, 'data_quality_manual', 'error', error?.message || 'Failed to send data quality report', {
      runId,
    });
    throw new httpsV2.HttpsError('internal', error.message || 'Failed to send data quality report');
  }
});

exports.previewDailySummary = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get();
  if (!profileSnap.exists) throw new httpsV2.HttpsError('not-found', 'Profile not found');
  const profile = profileSnap.data() || {};
  const zone = resolveTimezone(profile, DEFAULT_TIMEZONE);
  const summary = await buildDailySummaryData(db, uid, {
    day: DateTime.now().setZone(coerceZone(zone)),
    timezone: zone,
    locale: profile.locale || profile.language || 'en-GB',
  });
  const html = renderDailySummaryEmail(summary);
  return { ok: true, summary, html };
});

exports.previewDataQualityReport = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get();
  if (!profileSnap.exists) throw new httpsV2.HttpsError('not-found', 'Profile not found');
  const profile = profileSnap.data() || {};
  const snapshot = await buildDataQualitySnapshot(db, uid, { windowEnd: DateTime.now().setZone('UTC') });
  const html = renderDataQualityEmail({ profile, snapshot });
  return { ok: true, snapshot, html };
});

exports.sendTestEmail = httpsV2.onCall({ secrets: [defineSecret('NYLAS_API_KEY')] }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};
  const email = req?.data?.email || profile.email;
  if (!email) {
    throw new httpsV2.HttpsError('failed-precondition', 'No email configured on profile.');
  }

  const html = `
    <h1>BOB Email Test</h1>
    <p>This is a test email sent via Nylas at ${new Date().toISOString()}.</p>
    <p>Recipient: ${email}</p>
  `;

  try {
    const result = await sendEmail({ to: email, subject: 'BOB Email Test (Nylas)', html, text: 'Email delivery via Nylas successful.' });
    await db.collection('email_tests').add({
      userId: uid,
      email,
      result: { messageId: result?.messageId || null, response: result?.response || null },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await recordIntegrationLog(uid, 'email', 'success', 'Nylas test email sent', {
      messageId: result?.messageId || null,
      to: email,
    });
    return { ok: true, messageId: result?.messageId || null };
  } catch (error) {
    console.error('[email-test] failed', error);
    await recordIntegrationLog(uid, 'email', 'error', error?.message || 'Email test failed', {
      to: email,
    });
    throw new httpsV2.HttpsError('internal', error?.message || 'Failed to send test email');
  }
});

// Deprecated: SMTP settings are no longer used. Use NYLAS_API_KEY secret instead.
exports.saveEmailSettings = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const db = ensureFirestore();
  const profileSnap = await db.collection('profiles').doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};
  const isAdmin = Boolean(profile.isAdmin || profile.admin || (profile.role && String(profile.role).toLowerCase() === 'admin'));
  if (!isAdmin) {
    throw new httpsV2.HttpsError('permission-denied', 'Only admins can update email settings');
  }
  // Hard deprecate: do not persist SMTP settings anymore
  await recordIntegrationLog(uid, 'email', 'warning', 'Attempted to update SMTP settings (deprecated). Use NYLAS_API_KEY secret.', {});
  throw new httpsV2.HttpsError('failed-precondition', 'SMTP settings have been removed. Configure NYLAS_API_KEY secret instead.');
});

exports.cleanupUserLogs = schedulerV2.onSchedule({
  schedule: '0 4 * * *',
  timeZone: 'UTC',
}, async () => {
  const db = ensureFirestore();
  const collections = ['integration_logs', 'ai_logs'];
  const cutoff = admin.firestore.Timestamp.now();

  for (const collectionName of collections) {
    let hasMore = true;
    while (hasMore) {
      const snap = await db.collection(collectionName)
        .where('expiresAt', '<=', cutoff)
        .limit(500)
        .get();
      if (snap.empty) {
        hasMore = false;
        break;
      }
      const batch = db.batch();
      snap.docs.forEach((docRef) => batch.delete(docRef.ref));
      await batch.commit();
      hasMore = snap.size === 500;
    }
  }
});

// ===== New v3.0.2 Functions =====

// Daily Digest Email Generation (uses Nylas)
exports.generateDailyDigest = schedulerV2.onSchedule({ schedule: "30 6 * * *", timeZone: 'UTC', secrets: [defineSecret('NYLAS_API_KEY')] }, async () => {
  try {
    const usersSnapshot = await admin.firestore().collection('users').where('emailDigest', '==', true).get();
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      await generateUserDigest(userId, userData);
    }
    console.log('Daily digest generation completed');
  } catch (error) {
    console.error('Error generating daily digest:', error);
  }
});

async function generateUserDigest(userId, userData) {
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

    // Send email if user has email (Nylas)
    if (userData.email) {
      await sendEmail({
        to: userData.email,
        subject: `BOB Daily Digest - ${today.toLocaleDateString()}`,
        html,
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

// ===== Task → Story Conversion Automation (Issue #206)

async function generateAcceptanceCriteria(task, goal, { userId }) {
  const existing = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.filter(Boolean)
    : typeof task.acceptanceCriteria === 'string'
    ? task.acceptanceCriteria.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  if (existing.length) return existing.slice(0, 10);

  const prompt = [
    `Task title: ${task.title || 'Untitled task'}`,
    task.description ? `Description: ${task.description}` : null,
    goal?.title ? `Goal: ${goal.title}` : null,
    `Effort estimate: ${task.estimateMin ? `${Math.round(task.estimateMin / 60)} hours` : task.estimatedHours ? `${task.estimatedHours} hours` : 'unknown'}`,
    `Persona: ${task.persona || 'personal'}`,
    `Theme: ${task.theme || goal?.theme || 'General'}`,
    '',
    'Create 3-5 acceptance criteria as bullet strings. Keep each under 140 characters.',
  ].filter(Boolean).join('\n');

  try {
    const response = await callLLMJson({
      system: 'You draft crisp, testable acceptance criteria for agile user stories. Return JSON {"criteria":[...]}',
      user: prompt,
      purpose: 'autoAcceptanceCriteria',
      userId,
      expectJson: true,
      temperature: 0.1,
    });
    const parsed = JSON.parse(response || '{}');
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria.map((c) => String(c).trim()).filter(Boolean) : [];
    if (criteria.length) return criteria.slice(0, 6);
  } catch (error) {
    console.warn('[auto-convert] LLM acceptance criteria failed', error?.message || error);
  }
  return [
    'Define clear “done” outcome and validation steps.',
    'Include success metrics or completion signal.',
    'Address dependencies and blockers before sign-off.',
  ];
}

function deriveStorySize(task) {
  const hours = task.estimatedHours || (task.estimateMin ? task.estimateMin / 60 : null);
  if (!hours) return 'medium';
  if (hours <= 3) return 'small';
  if (hours <= 8) return 'medium';
  return 'large';
}

async function autoConvertTask({ db, taskDoc, profile, runId }) {
  const task = taskDoc.data() || {};
  const userId = task.ownerUid;
  if (!userId) return null;

  const now = Date.now();
  const goalSnap = task.goalId ? await db.collection('goals').doc(task.goalId).get().catch(() => null) : null;
  const goal = goalSnap && goalSnap.exists ? goalSnap.data() : null;
  const acceptanceCriteria = await generateAcceptanceCriteria(task, goal, { userId });

  const storyRef = db.collection('stories').doc();
  const storyRefValue = await generateStoryRef(db, userId);
  const size = deriveStorySize(task);

  const storyPayload = {
    ref: storyRefValue,
    title: task.title || 'Story created from task',
    description: task.description || '',
    goalId: task.goalId || null,
    sprintId: task.sprintId || null,
    priority: task.priority || 2,
    points: task.points || Math.max(1, Math.round((task.estimateMin || 240) / 90)),
    status: 0,
    theme: task.theme || goal?.theme || 1,
    persona: task.persona || profile?.persona || 'personal',
    ownerUid: userId,
    orderIndex: now,
    tags: Array.isArray(task.tags) ? task.tags.slice(0, 10) : [],
    acceptanceCriteria,
    storySize: size,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    automation: {
      source: 'task_auto_conversion',
      taskId: taskDoc.id,
      runId,
    },
  };

  if (task.dueDate) storyPayload.targetDate = task.dueDate;
  if (task.attachments) storyPayload.attachments = task.attachments;

  const batch = db.batch();
  batch.set(storyRef, storyPayload);

  const taskUpdate = {
    status: 2,
    convertedToStoryId: storyRef.id,
    autoConvertedAt: admin.firestore.FieldValue.serverTimestamp(),
    autoConvertedRunId: runId,
    autoConverted: true,
    reminderSyncDirective: 'complete',
    syncState: 'dirty',
    deleted: true,
    serverUpdatedAt: now,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  batch.set(taskDoc.ref, taskUpdate, { merge: true });

  await batch.commit();

  // Reminders: close and annotate
  try {
    const remindersSnap = await db.collection('reminders').where('taskId', '==', taskDoc.id).get();
    for (const reminder of remindersSnap.docs) {
      await reminder.ref.set({
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        note: `${reminder.data().note || ''}\nConverted to Story ${storyRefValue}`.trim(),
        syncState: 'dirty',
      }, { merge: true });
    }
  } catch (error) {
    console.warn('[auto-convert] reminder sync failed', { taskId: taskDoc.id, error });
  }

  const activityRef = db.collection('activity_stream').doc();
  await activityRef.set({
    id: activityRef.id,
    entityId: storyRef.id,
    entityType: 'story',
    activityType: 'task_to_story_conversion',
    actor: 'AI_Agent',
    userId,
    description: `Auto-converted task ${task.ref || taskDoc.id} to story ${storyRefValue}`,
    metadata: {
      taskId: taskDoc.id,
      storyId: storyRef.id,
      runId,
      acceptanceCriteria,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('automation_events').add({
    type: 'task_auto_conversion',
    userId,
    taskId: taskDoc.id,
    storyId: storyRef.id,
    runId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (!task.goalId) {
    await db.collection('automation_alerts').add({
      type: 'missing_goal_link',
      userId,
      storyId: storyRef.id,
      taskId: taskDoc.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      resolved: false,
      message: 'Story created from task without goal linkage',
    });
  }

  return { taskId: taskDoc.id, storyId: storyRef.id, storyRef: storyRefValue };
}

exports.autoConvertOversizedTasks = schedulerV2.onSchedule({
  schedule: 'every 30 minutes',
  timeZone: 'UTC',
  memory: '512MiB',
}, async () => {
  const db = ensureFirestore();
  const profilesSnap = await db.collection('profiles').get();
  for (const doc of profilesSnap.docs) {
    const profile = doc.data() || {};
    if (profile.autoConversionEnabled === false) continue;
    const userId = doc.id;

    const thresholdMinutes = Number(profile.autoConversionThresholdMinutes || 240);
    const pointsThreshold = Number(profile.autoConversionThresholdPoints || 2);

    const runId = await logAutomationRun(db, {
      automation: 'task_auto_conversion',
      userId,
      status: 'started',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      thresholdMinutes,
      pointsThreshold,
    });

    try {
      const tasksSnap = await db.collection('tasks')
        .where('ownerUid', '==', userId)
        .get();

      const candidates = tasksSnap.docs.filter((taskDoc) => {
        const data = taskDoc.data() || {};
        if (data.autoConverted || data.convertedToStoryId) return false;
        if (data.autoConversionSkip === true) return false;
        const status = data.status;
        if (status === 2 || status === 3 || status === 'done' || status === 'completed') return false;
        const estMinutes = Number(data.estimateMin || 0);
        const estHours = Number(data.estimatedHours || 0);
        const points = Number(data.points || 0);
        if (estMinutes >= thresholdMinutes) return true;
        if (estHours >= 4) return true;
        if (points > pointsThreshold) return true;
        return false;
      });

      const results = [];
      for (const taskDoc of candidates.slice(0, 10)) {
        try {
          const conversion = await autoConvertTask({ db, taskDoc, profile, runId });
          if (conversion) results.push(conversion);
        } catch (error) {
          console.error('[auto-convert] task failed', { taskId: taskDoc.id, error });
          await db.collection('automation_exceptions').add({
            automation: 'task_auto_conversion',
            userId,
            taskId: taskDoc.id,
            message: error.message || String(error),
            runId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      await db.collection('automation_runs').doc(runId).set({
        status: 'success',
        converted: results,
        processed: candidates.length,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error('[auto-convert] run failed', { userId, error });
      await db.collection('automation_runs').doc(runId).set({
        status: 'error',
        error: error.message || String(error),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
});

// Ensure every goal/story/task has a human-readable ref (e.g., GR-26LGIP, ST-XXXX, TK-XXXX)
exports.ensureEntityRefs = schedulerV2.onSchedule({ schedule: 'every 2 hours', timeZone: 'UTC' }, async () => {
  const db = ensureFirestore();
  const prefixFor = (col) => (col === 'goals' ? 'GR' : col === 'stories' ? 'ST' : 'TK');
  const makeRefLocal = (prefix) => {
    const ts = Date.now().toString(36).toUpperCase().slice(-4);
    const rnd = Math.random().toString(36).toUpperCase().slice(2, 4);
    return `${prefix}-${ts}${rnd}`;
  };

  const collections = ['goals', 'stories', 'tasks'];
  for (const col of collections) {
    const snap = await db.collection(col).limit(1000).get();
    const missing = snap.docs.filter((d) => {
      const data = d.data() || {};
      return !data.ref || typeof data.ref !== 'string' || data.ref.trim() === '';
    });
    if (!missing.length) continue;

    const batch = db.batch();
    const activityBatch = db.batch();
    const prefix = prefixFor(col);
    for (const docSnap of missing.slice(0, 200)) { // cap per run
      const id = docSnap.id;
      const data = docSnap.data() || {};
      const ref = makeRefLocal(prefix);
      batch.set(docSnap.ref, { ref, updatedAt: Date.now() }, { merge: true });
      const actRef = db.collection('activity_stream').doc();
      activityBatch.set(actRef, {
        id: actRef.id,
        entityId: id,
        entityType: col === 'goals' ? 'goal' : col === 'stories' ? 'story' : 'task',
        activityType: 'updated',
        userId: data.ownerUid || 'system',
        description: `Assigned reference ${ref}`,
        fieldName: 'ref',
        oldValue: null,
        newValue: ref,
        ownerUid: data.ownerUid || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'function',
      });
    }
    await batch.commit();
    await activityBatch.commit();
  }
});

// ===== Scheduler Adjustments (Issue #207)

const WORKDAY_MINUTES_DEFAULT = 8 * 60;

function isTaskLocked(task) {
  return task.dueDateLocked || task.lockDueDate || task.immovable === true || task.status === 'immovable';
}

function buildBlockedMinutes(calendarBlocks, zone) {
  const map = new Map();
  for (const block of calendarBlocks) {
    const start = toDateTime(block.start || block.startIso || block.startAt, { zone });
    const end = toDateTime(block.end || block.endIso || block.endAt, { zone });
    if (!start || !end) continue;
    const day = start.toISODate();
    const minutes = Math.max(0, end.diff(start, 'minutes').minutes);
    const current = map.get(day) || 0;
    map.set(day, current + minutes);
  }
  return map;
}

function isNonWorkingDay(dt, profile) {
  if (!dt) return false;
  const weekendDisabled = profile?.workWeekends === true ? [] : [6, 7];
  return weekendDisabled.includes(dt.weekday);
}

function findNextWorkingDate(startDt, context) {
  const { blockedMinutes, workdayMinutes, profile } = context;
  let candidate = startDt;
  for (let i = 0; i < 14; i++) {
    const day = candidate.toISODate();
    const blocked = blockedMinutes.get(day) || 0;
    if (!isNonWorkingDay(candidate, profile) && blocked < workdayMinutes) {
      return candidate;
    }
    candidate = candidate.plus({ days: 1 });
  }
  return startDt;
}

async function updateTaskDueDate(db, taskId, { newDueDateMs, reason, userId, runId, itemRef }) {
  const taskRef = db.collection('tasks').doc(taskId);
  await taskRef.set({
    dueDate: newDueDateMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    serverUpdatedAt: Date.now(),
    scheduler: {
      lastRunId: runId,
      lastReason: reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    syncState: 'dirty',
  }, { merge: true });

  try {
    const remindersSnap = await db.collection('reminders').where('taskId', '==', taskId).get();
    for (const reminder of remindersSnap.docs) {
      await reminder.ref.set({
        dueDate: newDueDateMs,
        dueAt: newDueDateMs,
        note: `${reminder.data().note || ''}\nDue date adjusted by scheduler (${reason}).`.trim(),
        syncState: 'dirty',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  } catch (error) {
    console.warn('[scheduler] reminder update failed', { taskId, error });
  }

  const activityRef = db.collection('activity_stream').doc();
  await activityRef.set({
    id: activityRef.id,
    entityId: taskId,
    entityType: 'task',
    activityType: 'scheduler_due_date_adjustment',
    actor: 'AI_Scheduler',
    userId,
    description: `Scheduler moved ${itemRef || taskId} due date (${reason}).`,
    metadata: { taskId, reason, runId, dueDate: newDueDateMs },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

exports.runDailySchedulerAdjustments = schedulerV2.onSchedule({
  schedule: 'every 30 minutes',
  timeZone: 'UTC',
  memory: '1GiB',
}, async () => {
  const db = ensureFirestore();
  const nowUtc = DateTime.now().setZone('UTC');
  const profilesSnap = await db.collection('profiles').get();

  for (const doc of profilesSnap.docs) {
    const profile = doc.data() || {};
    const userId = doc.id;
    if (profile.schedulerEnabled === false) continue;

    const zone = resolveTimezone(profile, DEFAULT_TIMEZONE);
    const nowLocal = nowUtc.setZone(coerceZone(zone));
    const statusSnap = await db.collection('automation_status').doc(`scheduler_${userId}`).get();
    const lastSentDay = statusSnap.exists ? statusSnap.data().lastSentDayIso || null : null;
    const { shouldSend, dayIso } = shouldTriggerWindow(nowLocal, DAILY_SUMMARY_TARGET_MINUTES, lastSentDay);
    if (!shouldSend) continue;

    const runId = await logAutomationRun(db, {
      automation: 'scheduler_adjustments',
      userId,
      status: 'started',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const { tasks, stories, dependencies } = await loadSchedulerInputs(db, userId, { timezone: zone });
      const calendarSnap = await db.collection('calendar_blocks')
        .where('ownerUid', '==', userId)
        .where('start', '>=', nowLocal.minus({ days: 1 }).startOf('day').toMillis())
        .where('start', '<=', nowLocal.plus({ days: 14 }).endOf('day').toMillis())
        .get()
        .catch(() => ({ docs: [] }));
      const calendarBlocks = calendarSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const blockedMinutes = buildBlockedMinutes(calendarBlocks, zone);
      const workdayMinutes = Number(profile.workdayMinutes || WORKDAY_MINUTES_DEFAULT);
      const context = { blockedMinutes, workdayMinutes, profile };

      const taskDueMap = new Map();
      const storyDueMap = new Map();
      tasks.forEach((task) => {
        const dueMs = toMillis(task.dueDate || task.dueDateMs || task.targetDate);
        if (dueMs) taskDueMap.set(task.id, DateTime.fromMillis(dueMs, { zone }));
      });
      stories.forEach((story) => {
        const dueMs = toMillis(story.sprintDueDate || story.targetDate || story.plannedStartDate);
        if (dueMs) storyDueMap.set(story.id, DateTime.fromMillis(dueMs, { zone }));
      });

      const today = nowLocal.startOf('day');
      const changes = [];

      for (const task of tasks) {
        if (isTaskLocked(task)) continue;
        const dueMs = toMillis(task.dueDate || task.dueDateMs || task.targetDate);
        const dueDt = dueMs ? DateTime.fromMillis(dueMs, { zone }) : null;
        let candidate = dueDt || today.plus({ days: 1 });
        let reason = '';

        if (!dueDt) {
          reason = 'missing_due_date';
        } else if (dueDt < today) {
          candidate = today.plus({ days: 1 });
          reason = 'overdue_pull_forward';
        }

        const depKey = dependencies.get(`task:${task.id}`) || [];
        let latestDependency = null;
        for (const dep of depKey) {
          const targetId = dep.dependsOn;
          const depTask = taskDueMap.get(targetId);
          const depStory = storyDueMap.get(targetId);
          const depDate = depTask || depStory || null;
          if (depDate && (!latestDependency || depDate > latestDependency)) {
            latestDependency = depDate;
          }
        }
        if (latestDependency && candidate <= latestDependency) {
          candidate = latestDependency.plus({ days: 1 });
          reason = reason || 'dependency_alignment';
        }

        candidate = findNextWorkingDate(candidate, context);
        const candidateIso = candidate.toISODate();
        const blocked = blockedMinutes.get(candidateIso) || 0;
        if (blocked >= workdayMinutes) {
          candidate = findNextWorkingDate(candidate.plus({ days: 1 }), context);
          reason = reason || 'capacity_conflict';
        }

        const newDueMs = candidate.endOf('day').toMillis();
        if (!dueDt || Math.abs(candidate.toMillis() - dueDt.toMillis()) > 60 * 1000) {
          await updateTaskDueDate(db, task.id, {
            newDueDateMs: newDueMs,
            reason: reason || 'normalized',
            userId,
            runId,
            itemRef: task.ref || task.id,
          });
          taskDueMap.set(task.id, candidate);
          changes.push({
            itemId: task.id,
            itemRef: task.ref || task.id,
            previousDue: dueDt ? dueDt.toISODate() : null,
            newDue: candidateIso,
            reason: reason || 'normalized',
          });
        }
      }

      await db.collection('scheduler_runs').add({
        userId,
        dayIso,
        runId,
        timezone: zone,
        changes,
        metrics: {
          totalTasks: tasks.length,
          adjustedTasks: changes.length,
          blockedDays: blockedMinutes.size,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await recordAutomationStatus(db, { userId, automation: 'scheduler', dayIso, status: 'success', runId });
      await db.collection('automation_runs').doc(runId).set({
        status: 'success',
        changes,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error('[scheduler] run failed', { userId, error });
      await recordAutomationStatus(db, { userId, automation: 'scheduler', dayIso: nowLocal.toISODate(), status: 'error', message: error.message || String(error) });
      await db.collection('automation_runs').doc(runId).set({
        status: 'error',
        error: error.message || String(error),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
});
