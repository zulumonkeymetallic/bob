'use strict';

/**
 * agentContext.js
 *
 * Context aggregation layer for the BOB Agent Integration Layer.
 *
 * The primary export is `getAgentTodayContext`, which wraps `buildDailySummaryData`
 * (from lib/reporting.js) and maps its email-oriented shape to a clean agent-facing
 * response schema. Results are cached in `agent_context_cache/{uid}` for 30 minutes
 * to prevent hammering Firestore on every Telegram message.
 *
 * Cache invalidation is handled externally via a Firestore trigger on tasks/stories
 * that deletes (or marks stale) the cache document when data changes (Phase 5).
 */

const admin = require('firebase-admin');
const { buildDailySummaryData } = require('../lib/reporting');

const CACHE_COLLECTION = 'agent_context_cache';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Retrieve today's full context for the agent, with caching.
 *
 * @param {string} uid         - Firebase UID
 * @param {object} [options]
 * @param {string} [options.dateIso]   - Override date (YYYY-MM-DD); defaults to today
 * @param {string} [options.timezone]  - Olson TZ; defaults to user's profile timezone
 * @param {boolean} [options.bypassCache] - Skip cache (for scheduled briefings)
 * @returns {Promise<object>} agent context object
 */
async function getAgentTodayContext(uid, { dateIso, timezone, bypassCache = false } = {}) {
  const db = admin.firestore();

  // --- Cache check ---
  if (!bypassCache) {
    try {
      const cacheSnap = await db.collection(CACHE_COLLECTION).doc(uid).get();
      if (cacheSnap.exists) {
        const cached = cacheSnap.data();
        const age = Date.now() - (cached._cachedAt || 0);
        if (age < CACHE_TTL_MS) {
          return { ...cached, _fromCache: true };
        }
      }
    } catch (e) {
      // Cache miss is acceptable — proceed to fresh fetch
      console.warn('[agentContext] Cache read failed:', e?.message);
    }
  }

  // --- Resolve timezone from profile if not provided ---
  let tz = timezone;
  if (!tz) {
    try {
      const profileSnap = await db.collection('profiles').doc(uid).get();
      tz = profileSnap.exists ? (profileSnap.data()?.timezone || 'Europe/London') : 'Europe/London';
    } catch (e) {
      tz = 'Europe/London';
    }
  }

  const day = dateIso || _todayIso(tz);

  // --- Fetch full daily summary ---
  const summary = await buildDailySummaryData(db, uid, { day, timezone: tz });

  // --- Fetch AI top-3 (pre-scored by deltaPriorityRescore) ---
  const top3 = await _fetchAiTop3(db, uid, day);

  // --- Map to agent context shape ---
  const ctx = _mapToAgentContext(summary, top3, day, tz);

  // --- Write to cache ---
  try {
    await db.collection(CACHE_COLLECTION).doc(uid).set({
      ...ctx,
      _cachedAt: Date.now(),
      _fromCache: false,
    });
  } catch (e) {
    console.warn('[agentContext] Cache write failed:', e?.message);
  }

  return ctx;
}

/**
 * Invalidate the context cache for a user (called from triggers or mutations).
 * @param {string} uid
 */
async function invalidateContextCache(uid) {
  const db = admin.firestore();
  try {
    await db.collection(CACHE_COLLECTION).doc(uid).delete();
  } catch (e) {
    console.warn('[agentContext] Cache invalidation failed:', e?.message);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Query tasks and stories flagged aiTop3ForDay == true for today.
 * Falls back to top-3 by aiCriticalityScore if no AI top-3 flags are set.
 */
async function _fetchAiTop3(db, uid, dayIso) {
  try {
    const [tasksSnap, storiesSnap] = await Promise.all([
      db.collection('tasks')
        .where('ownerUid', '==', uid)
        .where('aiTop3ForDay', '==', true)
        .where('aiTop3Date', '==', dayIso)
        .limit(10)
        .get()
        .catch(() => ({ docs: [] })),
      db.collection('stories')
        .where('ownerUid', '==', uid)
        .where('aiTop3ForDay', '==', true)
        .where('aiTop3Date', '==', dayIso)
        .limit(10)
        .get()
        .catch(() => ({ docs: [] })),
    ]);

    const items = [
      ...tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id, _type: 'task' })),
      ...storiesSnap.docs.map((d) => ({ ...d.data(), id: d.id, _type: 'story' })),
    ]
      .sort((a, b) => (b.aiCriticalityScore || 0) - (a.aiCriticalityScore || 0))
      .slice(0, 3);

    if (items.length > 0) return items;

    // Fallback: highest aiCriticalityScore across open tasks
    const fallbackSnap = await db.collection('tasks')
      .where('ownerUid', '==', uid)
      .where('status', '<', 2)
      .orderBy('status')
      .orderBy('aiCriticalityScore', 'desc')
      .limit(3)
      .get()
      .catch(() => ({ docs: [] }));

    return fallbackSnap.docs.map((d) => ({ ...d.data(), id: d.id, _type: 'task' }));
  } catch (e) {
    console.warn('[agentContext] _fetchAiTop3 error:', e?.message);
    return [];
  }
}

/**
 * Map the email-oriented buildDailySummaryData output to the agent context schema.
 */
function _mapToAgentContext(summary, top3Items, dayIso, timezone) {
  const sp = summary.sprintProgress || null;
  const capacityWarningSnap = summary.dashboardAlerts?.find(
    (a) => a.type === 'capacity_warning' || a.type === 'focus_goal',
  );

  // Active sprint
  const activeSprint = sp
    ? {
        id:              sp.sprintId || null,
        name:            sp.sprintName || null,
        startDate:       _toIso(sp.startDate),
        endDate:         _toIso(sp.endDate),
        daysRemaining:   sp.daysRemaining ?? null,
        totalStories:    sp.totalStories ?? null,
        completedStories:sp.completedStories ?? null,
        totalTasks:      sp.totalTasks ?? null,
        completedTasks:  sp.completedTasks ?? null,
        percentComplete: sp.percentComplete ?? null,
      }
    : null;

  // Top-3 items
  const top3 = top3Items.map((item) => ({
    id:                item.id,
    ref:               item.ref || null,
    title:             item.title || '(untitled)',
    entityType:        item._type || 'task',
    aiCriticalityScore:item.aiCriticalityScore ?? null,
    priority:          item.priority ?? null,
    dueDate:           _toIso(item.dueDate || item.dueDateMs),
    storyTitle:        item.storyTitle || null,
    goalId:            item.goalId || item.parentGoalId || null,
  }));

  // Calendar today — calendarBlocks from reporting is already filtered to the day window
  const calendarToday = (summary.calendarBlocks || [])
    .filter((b) => !b.deleted)
    .map((b) => ({
      id:        b.id || null,
      title:     b.title || b.name || '(block)',
      start:     _toIso(b.start || b.startTime),
      end:       _toIso(b.end || b.endTime),
      isAllDay:  !!b.isAllDay,
      theme:     b.theme ?? null,
    }));

  // Overdue tasks
  const overdueTasks = (summary.tasksDue || []).filter(
    (t) => t.isOverdue || t.overdueByDays > 0,
  );

  // Focus goals
  const focusGoals = (summary.hierarchy?.activeFocusGoals || []).map((fg) => ({
    id:           fg.id,
    title:        fg.title || null,
    timeframe:    fg.timeframe || null,
    isActive:     fg.isActive !== false,
    daysRemaining:fg.daysRemaining ?? null,
    progressPct:  fg.progressPct ?? null,
  }));

  // Goal KPI status
  const goalKpiStatus = (summary.goalKpiStatus || []).map((g) => ({
    id:          g.id || g.goalId,
    title:       g.title || null,
    progressPct: g.progressPct ?? null,
    label:       g.label || null,
    tone:        g.tone || null,
    kpiSummary:  g.kpiSummary || null,
  }));

  // Finance snapshot (last 5 days)
  const finance = summary.financeDaily
    ? {
        totalSpendPence:        summary.financeDaily.totalSpendPence ?? null,
        discretionarySpendPence:summary.financeDaily.discretionarySpendPence ?? null,
        windowLabel:            summary.metadata?.financeWindowLabel || null,
      }
    : null;

  return {
    date:             dayIso,
    timezone,
    activeSprint,
    top3,
    calendarToday,
    overdueTaskCount: overdueTasks.length,
    overdueTaskTitles:overdueTasks.slice(0, 5).map((t) => t.title || '(untitled)'),
    focusGoals,
    goalKpiStatus,
    capacityWarning:  capacityWarningSnap?.message || null,
    financeSnapshot:  finance,
    generatedAt:      new Date().toISOString(),
    staleAfterMs:     CACHE_TTL_MS,
  };
}

/** Convert a Firebase Timestamp, epoch ms, or ISO string to ISO string (or null). */
function _toIso(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return null;
}

/** Return today's date as YYYY-MM-DD in the given timezone (approximate). */
function _todayIso(tz) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

module.exports = { getAgentTodayContext, invalidateContextCache };
