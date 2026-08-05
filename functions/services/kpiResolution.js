'use strict';

/**
 * Server-side KPI resolution — WS1 R6.
 *
 * A faithful port of `react-app/src/utils/kpiResolver.ts`, which is the only place KPI
 * values have ever been computed. That resolver runs **in the browser**, so a value exists
 * only while the web app is open: nothing reaches iOS, a notification, or the coach, and
 * a KPI is as current as the last time somebody happened to have a tab open.
 *
 * The semantics are deliberately identical — same candidate-source order, same freshness
 * rules, same output documents (`goal_kpi_metrics`, `weekly_goal_kpi_snapshots`) — so the
 * two cannot disagree. Where they would differ, this one is authoritative because it runs
 * on a schedule.
 *
 * The old server-side attempt, `fitnessKpiSync.js`, is not this: it reads the legacy `kpis`
 * array and infers a metric's meaning from substrings of its display name, so renaming a
 * KPI silently stops it counting.
 */

const admin = require('firebase-admin');
const { DateTime } = require('luxon');

const TZ = 'Europe/London';

function db() {
  return admin.firestore();
}

// ─── Freshness ───────────────────────────────────────────────────────────────
// Ported verbatim in behaviour from utils/kpiFreshness.ts, including the two decisions
// that file records the reasons for.

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') { try { return Number(value.toMillis()); } catch { return null; } }
  if (typeof value?.toDate === 'function') { try { return value.toDate().getTime(); } catch { return null; } }
  if (typeof value?.seconds === 'number') return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Newest of several timestamps, ignoring nulls — never first-non-null.
 *
 * `a || b` lets a field that has stopped being written permanently veto a live one:
 * `healthkitLastSyncAt` sat at 2026-06-06 for eight weeks while health_metrics was written
 * daily, so every HealthKit KPI read as stale. Taking the max means a dead heartbeat can
 * only be ignored, never believed over a live one.
 */
function newestTimestamp(...values) {
  const stamps = values.map(toMillis).filter((ms) => ms != null);
  return stamps.length ? Math.max(...stamps) : null;
}

function isFreshTimestamp(value, windowHours = 24) {
  const ms = toMillis(value);
  if (ms == null) return false;
  return Date.now() - ms <= windowHours * 60 * 60 * 1000;
}

/**
 * Per-signal freshness windows, because signals decay at genuinely different rates and
 * device sync is intermittent — a phone that did not sync is not a body that stopped
 * existing. A flat 24h marks healthy data stale on any day the app was not opened.
 */
const DEFAULT_FRESHNESS_WINDOW_HOURS = {
  hrv: 72,
  sleep: 72,
  steps: 48,
  workout: 240,   // 10 days — a genuine rest week must not read as a broken pipe
  weight: 336,    // 14 days
  bodyfat: 336,
};

function freshnessWindowFor(metricKey, explicitHours) {
  if (explicitHours != null && Number.isFinite(Number(explicitHours))) return Number(explicitHours);
  const key = String(metricKey || '').toLowerCase();
  const match = Object.keys(DEFAULT_FRESHNESS_WINDOW_HOURS).find((k) => key.includes(k));
  return match ? DEFAULT_FRESHNESS_WINDOW_HOURS[match] : 72;
}

// ─── Bindings ────────────────────────────────────────────────────────────────

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampPct(value) {
  if (value == null) return null;
  return Math.max(0, Math.min(200, Math.round(value * 10) / 10));
}

function computeProgressPct(current, target, lowerIsBetter = false) {
  if (current == null || target == null || !Number.isFinite(target) || target === 0) return null;
  return lowerIsBetter
    ? clampPct((target / Math.max(current, 0.0001)) * 100)
    : clampPct((current / target) * 100);
}

function getCandidateSources(kpi) {
  if (Array.isArray(kpi.sourcePriority) && kpi.sourcePriority.length > 0) return kpi.sourcePriority;
  if (kpi.sourceId) return [kpi.sourceId];
  return [];
}

function getDefaultBinding(kpi) {
  const source = (Array.isArray(kpi.sourcePriority) && kpi.sourcePriority[0]) || kpi.sourceId || null;
  if (!source) return null;
  if (kpi.sourceBindings?.[source]) return kpi.sourceBindings[source];
  return {
    source,
    metricKey: String(kpi.metricKey || kpi.metricId || kpi.id || ''),
    collection: kpi.sourceCollection || null,
    fieldPath: kpi.sourceFieldPath || null,
    aggregation: kpi.aggregation,
    timeframe: kpi.timeframe,
    unit: kpi.unit,
    label: kpi.sourceMetricLabel || kpi.name,
  };
}

/** Period key, matching metricValueAggregation and the client's toPeriodKey exactly. */
function toPeriodKey(timeframe, ms = Date.now()) {
  const dt = DateTime.fromMillis(ms).setZone(TZ);
  if (timeframe === 'daily') return dt.toFormat('yyyy-MM-dd');
  if (timeframe === 'weekly' || timeframe === 'sprint') return dt.startOf('week').toFormat('yyyy-MM-dd');
  if (timeframe === 'monthly') return dt.toFormat('yyyy-MM');
  if (timeframe === 'quarterly') return `${dt.year}-Q${dt.quarter}`;
  return String(dt.year);
}

// ─── Sources ─────────────────────────────────────────────────────────────────

/** `metric_values` — the primary path for healthkit, strava and user_input. */
async function resolveObservationSource(ownerUid, source, binding, timeframe) {
  const periodKey = toPeriodKey(binding.timeframe || timeframe || 'daily');
  const snap = await db().collection('metric_values')
    .where('ownerUid', '==', ownerUid)
    .where('metricKey', '==', binding.metricKey)
    .where('source', '==', source)
    .where('periodKey', '==', periodKey)
    .orderBy('observedAt', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ docs: [] }));
  const row = snap.docs[0]?.data();
  if (!row) return null;
  return {
    source,
    currentValue: toNumber(row.value),
    unit: binding.unit || row.unit || '',
    observedAt: row.observedAt || null,
    isFresh: source === 'user_input' || source === 'manual_task'
      ? true
      : isFreshTimestamp(newestTimestamp(row.syncedAt, row.observedAt), freshnessWindowFor(binding.metricKey)),
  };
}

/** A scalar on `profiles` — the fallback when no metric_value exists for the period. */
async function resolveProfileSource(ownerUid, source, binding, freshnessWindowHours) {
  const snap = await db().collection('profiles').doc(ownerUid).get().catch(() => null);
  if (!snap?.exists) return null;
  const profile = snap.data() || {};
  const fieldPath = String(binding.fieldPath || '').trim();
  const value = fieldPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), profile);
  const currentValue = toNumber(value);
  if (currentValue == null) return null;
  const automatedTimestamp = source === 'strava'
    ? newestTimestamp(profile.stravaLastSyncAt, profile.stravaUpdatedAt)
    : newestTimestamp(profile.healthkitLastSyncAt, profile.updatedAt);
  const windowHours = freshnessWindowFor(binding.metricKey, freshnessWindowHours);
  return {
    source,
    currentValue,
    unit: binding.unit || '',
    observedAt: toMillis(profile.updatedAt),
    isFresh: (source === 'healthkit' || source === 'strava')
      ? isFreshTimestamp(automatedTimestamp, windowHours)
      : true,
  };
}

const TIMEFRAME_LOOKBACK_DAYS = {
  daily: 1, weekly: 7, sprint: 14, monthly: 30, quarterly: 90, annual: 365,
};

/** Hours of calendar time booked against this goal — the designer's duration field. */
async function resolveCalendarDurationSource(ownerUid, goalId, binding, kpi) {
  const sinceMs = Date.now() - (TIMEFRAME_LOOKBACK_DAYS[kpi.timeframe] || 7) * 86400000;
  const snap = await db().collection('calendar_blocks')
    .where('ownerUid', '==', ownerUid)
    .where('goalId', '==', goalId)
    .get()
    .catch(() => ({ docs: [] }));
  let hours = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const start = Number(d.start || 0), end = Number(d.end || 0);
    if (!start || !end || end <= start || start < sinceMs) continue;
    hours += (end - start) / 3600000;
  }
  return {
    source: 'task_progress',
    currentValue: Math.round(hours * 10) / 10,
    unit: binding.unit || kpi.unit || 'hours',
    observedAt: Date.now(),
    isFresh: true,
  };
}

/** Story and task completion against the goal. */
async function resolveExecutionSource(ownerUid, goalId, source, binding, kpi) {
  if (source === 'story_progress') {
    const snap = await db().collection('stories')
      .where('ownerUid', '==', ownerUid).where('goalId', '==', goalId).get()
      .catch(() => ({ docs: [] }));
    const stories = snap.docs.map((d) => d.data());
    // Story status 4 is Done — the story scale, not the task scale. Never merge them.
    const done = stories.filter((s) => Number(s.status || 0) >= 4);
    const totalPoints = stories.reduce((sum, s) => sum + (Number(s.points || 0) || 0), 0);
    const completedPoints = done.reduce((sum, s) => sum + (Number(s.points || 0) || 0), 0);
    return {
      source,
      currentValue: kpi.type === 'story_points' ? completedPoints : done.length,
      unit: binding.unit || kpi.unit,
      observedAt: Date.now(),
      isFresh: true,
      totalPoints,
      completedPoints,
    };
  }
  if (source === 'task_progress' || source === 'manual_task') {
    if (kpi.type === 'time_tracked') return resolveCalendarDurationSource(ownerUid, goalId, binding, kpi);
    const snap = await db().collection('tasks')
      .where('ownerUid', '==', ownerUid).where('goalId', '==', goalId).get()
      .catch(() => ({ docs: [] }));
    const tasks = snap.docs.map((d) => d.data());
    // Task status 2 is Done on the TASK scale; >= 4 tolerates legacy rows.
    const completed = tasks.filter((t) => {
      const status = Number(t.status || 0);
      return status === 2 || status >= 4;
    }).length;
    return {
      source,
      currentValue: completed,
      unit: binding.unit || kpi.unit,
      observedAt: Date.now(),
      isFresh: true,
      totalTasks: tasks.length,
      completedTasks: completed,
    };
  }
  return null;
}

/** Habit occurrences — habits are tasks of type habit/routine, never chores. */
async function resolveHabitSource(ownerUid, goalId, binding, kpi) {
  const lookbackDays = Number(kpi.lookbackDays) || 30;
  const sinceMs = Date.now() - lookbackDays * 86400000;
  const snap = await db().collection('tasks')
    .where('ownerUid', '==', ownerUid)
    .get()
    .catch(() => ({ docs: [] }));
  const linked = new Set([...(kpi.linkedHabitIds || []), ...(kpi.linkedRoutineIds || [])]);
  const habits = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => ['habit', 'routine'].includes(String(t.type || '').toLowerCase()))
    .filter((t) => (linked.size > 0 ? linked.has(t.id) : t.goalId === goalId));
  if (habits.length === 0) return null;

  let occurrences = 0;
  for (const habit of habits) {
    if (Array.isArray(habit.completions)) {
      occurrences += habit.completions.filter((c) => {
        const ms = toMillis(c?.date || c?.completedAt);
        return ms != null && ms >= sinceMs;
      }).length;
    } else if (Number(habit.completedCount) > 0) {
      occurrences += Number(habit.completedCount);
    }
  }
  return {
    source: 'habit_occurrence',
    currentValue: occurrences,
    unit: binding.unit || kpi.unit || 'occurrences',
    observedAt: Date.now(),
    isFresh: true,
    habitCount: habits.length,
  };
}

/** Savings and budget progress against a linked pot. */
async function resolveFinanceSource(ownerUid, goal, binding) {
  const potId = goal.linkedPotId || binding.fieldPath || null;
  if (!potId) return null;
  const snap = await db().collection('pots').doc(String(potId)).get().catch(() => null);
  const balance = snap?.exists ? toNumber(snap.data()?.currentBalance) : null;
  if (balance == null) return null;
  return {
    source: 'finance',
    // Pots are stored in integer pence; KPI targets are in pounds.
    currentValue: balance / 100,
    unit: binding.unit || 'GBP',
    observedAt: toMillis(snap.data()?.updatedAt) || Date.now(),
    isFresh: true,
  };
}

// ─── Resolution ──────────────────────────────────────────────────────────────

async function resolveKpiForGoal(ownerUid, goal, kpi) {
  const sources = getCandidateSources(kpi);
  const explicitWindow = Number.isFinite(Number(kpi.freshnessWindowHours))
    ? Number(kpi.freshnessWindowHours)
    : null;
  const sourceFreshness = {};
  let resolved = null;

  for (const source of sources) {
    const binding = kpi.sourceBindings?.[source] || (source === sources[0] ? getDefaultBinding(kpi) : null);
    if (!binding) continue;
    let candidate = null;
    if (source === 'user_input') {
      candidate = await resolveObservationSource(ownerUid, source, binding, binding.timeframe || kpi.timeframe);
    } else if (source === 'healthkit' || source === 'strava') {
      candidate = await resolveObservationSource(ownerUid, source, binding, binding.timeframe || kpi.timeframe);
      if (!candidate) candidate = await resolveProfileSource(ownerUid, source, binding, explicitWindow);
    } else if (source === 'story_progress' || source === 'task_progress' || source === 'manual_task') {
      candidate = await resolveExecutionSource(ownerUid, goal.id, source, binding, kpi);
    } else if (source === 'habit_occurrence') {
      candidate = await resolveHabitSource(ownerUid, goal.id, binding, kpi);
    } else if (source === 'finance') {
      candidate = await resolveFinanceSource(ownerUid, goal, binding);
    }
    if (!candidate) continue;

    sourceFreshness[source] = { observedAt: candidate.observedAt || null, isFresh: candidate.isFresh === true };
    // First *fresh* source wins; a stale one is held as a fallback rather than accepted,
    // so a live lower-priority source can still beat a dead higher-priority one.
    if (candidate.isFresh || source === 'user_input' || source === 'manual_task') {
      resolved = candidate;
      break;
    }
    resolved = resolved || candidate;
  }

  const currentValue = toNumber(resolved?.currentValue ?? kpi.current);
  const targetValue = toNumber(kpi.target);
  const healthy = resolved?.isFresh === true
    || resolved?.source === 'user_input'
    || resolved?.source === 'manual_task';

  return {
    id: kpi.id,
    name: kpi.name,
    metricKey: kpi.metricKey || kpi.metricId || kpi.id,
    source: resolved?.source || null,
    sourceLabel: kpi.sourceLabel || kpi.sourceId || null,
    unit: resolved?.unit || kpi.unit,
    currentValue,
    target: targetValue,
    progressPct: computeProgressPct(currentValue, targetValue, kpi.targetDirection === 'decrease'),
    healthy,
    stale: !healthy,
    observedAt: resolved?.observedAt || null,
    resolvedAt: new Date().toISOString(),
    resolvedBy: 'server',
    sourceFreshness,
  };
}

/** ISO week key, matching the client's `yyyy-'W'II`. */
function weeklySnapshotKey(ms = Date.now()) {
  const dt = DateTime.fromMillis(ms).setZone(TZ);
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`;
}

async function resolveAndPersistForOwner(ownerUid, options = {}) {
  const firestore = db();
  const goalsSnap = await firestore.collection('goals').where('ownerUid', '==', ownerUid).get();
  const weekKey = weeklySnapshotKey();
  let goalsResolved = 0;
  let kpisResolved = 0;
  let legacyOnlyGoals = 0;

  for (const doc of goalsSnap.docs) {
    const goal = { id: doc.id, ...doc.data() };
    const kpis = Array.isArray(goal.kpisV2) ? goal.kpisV2 : [];
    if (kpis.length === 0) {
      // A goal carrying only the legacy `kpis` array cannot be resolved from declared
      // bindings — there are none. Counted rather than silently skipped so the migration
      // backlog (WS2 R1) is visible.
      if (Array.isArray(goal.kpis) && goal.kpis.length > 0) legacyOnlyGoals += 1;
      continue;
    }
    if (Array.isArray(options.goalIds) && !options.goalIds.includes(goal.id)) continue;

    const resolvedKpis = [];
    for (const kpi of kpis) {
      resolvedKpis.push(await resolveKpiForGoal(ownerUid, goal, kpi));
    }

    const payload = {
      ownerUid,
      goalId: goal.id,
      goalTitle: goal.title || null,
      goalRef: goal.ref || null,
      resolvedKpis,
    };
    // The same two documents the client writes, so existing readers keep working and the
    // two paths cannot diverge into separate stores.
    await firestore.collection('goal_kpi_metrics').doc(`${ownerUid}_${goal.id}`)
      .set({ ...payload, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await firestore.collection('weekly_goal_kpi_snapshots').doc(`${ownerUid}_${weekKey}_${goal.id}`)
      .set({
        ...payload,
        weekKey,
        snapshotType: 'weekly',
        snapshotAt: new Date().toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    goalsResolved += 1;
    kpisResolved += resolvedKpis.length;
  }

  return { goalsResolved, kpisResolved, legacyOnlyGoals, weekKey };
}

module.exports = {
  resolveKpiForGoal,
  resolveAndPersistForOwner,
  toPeriodKey,
  weeklySnapshotKey,
  freshnessWindowFor,
  newestTimestamp,
  computeProgressPct,
};
