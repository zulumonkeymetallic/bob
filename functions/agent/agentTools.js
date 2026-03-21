'use strict';

/**
 * agentTools.js
 *
 * Single HTTP dispatcher for all V1 BOB Agent tools.
 * Authenticated via X-Agent-Secret header + AGENT_API_SECRET Firebase Secret.
 *
 * All tools are invoked via:
 *   POST /agentTool
 *   Headers: X-Agent-Secret: <secret>
 *   Body: { tool, ownerUid, ...params }
 *
 * Response envelope:
 *   { ok, tool, actionId, idempotencyKey, result, requiresApproval, approvalId, error? }
 *
 * Tool categories:
 *   READ-ONLY  — auto-execute, never require approval
 *   AUTO-WRITE — execute immediately (append-only or easily reversible)
 *   APPROVAL   — create pending_approvals document; mutations only after user confirms
 */

const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const { logAgentAction, resolveIdempotency, commitIdempotencyKey } = require('./agentAudit');
const { getAgentTodayContext } = require('./agentContext');
const { checkAndIncrementQuota } = require('../utils/perUserQuota');
const { processAgentRequestInternal } = require('../transcriptIngestion');

const AGENT_API_SECRET = defineSecret('AGENT_API_SECRET');

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

exports.agentTool = onRequest(
  {
    region: 'europe-west2',
    secrets: [AGENT_API_SECRET],
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    // Only POST
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Auth: X-Agent-Secret header
    const providedSecret = req.headers['x-agent-secret'];
    if (!providedSecret || providedSecret !== AGENT_API_SECRET.value()) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const { tool, ownerUid, idempotencyKey, ...params } = req.body || {};

    if (!tool) return res.status(400).json({ ok: false, error: 'tool is required' });
    if (!ownerUid) return res.status(400).json({ ok: false, error: 'ownerUid is required' });

    // Validate ownerUid exists
    const db = admin.firestore();
    try {
      const profileSnap = await db.collection('profiles').doc(ownerUid).get();
      const userSnap = profileSnap.exists ? profileSnap : await db.collection('users').doc(ownerUid).get();
      if (!profileSnap.exists && !userSnap.exists) {
        return res.status(403).json({ ok: false, error: 'Unknown ownerUid' });
      }
    } catch (e) {
      console.error('[agentTools] ownerUid validation error:', e?.message);
      return res.status(500).json({ ok: false, error: 'Internal error validating user' });
    }

    // Idempotency check
    if (idempotencyKey) {
      const { isDuplicate, resolvedActionId } = await resolveIdempotency(idempotencyKey, ownerUid, tool);
      if (isDuplicate) {
        return res.status(200).json({
          ok: true,
          tool,
          actionId: resolvedActionId,
          idempotencyKey,
          result: null,
          requiresApproval: false,
          approvalId: null,
          _duplicate: true,
        });
      }
    }

    const startMs = Date.now();
    let actionId = null;
    let responseStatus = 'ok';
    let responsePayload = null;
    let errorMessage = null;

    try {
      const result = await _dispatch(tool, ownerUid, params, db);
      responsePayload = result;

      const requiresApproval = !!result?.requiresApproval;
      if (requiresApproval) responseStatus = 'pending_approval';

      actionId = await logAgentAction({
        ownerUid,
        source: 'api',
        tool,
        intent: params.intent || null,
        requestPayload: { ...params, idempotencyKey },
        responseStatus,
        responsePayload: result,
        approvalId: result?.approvalId || null,
        llmTokensUsed: result?._llmTokens || null,
        durationMs: Date.now() - startMs,
        idempotencyKey: idempotencyKey || null,
      });

      if (idempotencyKey) {
        await commitIdempotencyKey(idempotencyKey, ownerUid, actionId);
      }

      return res.status(200).json({
        ok: true,
        tool,
        actionId,
        idempotencyKey: idempotencyKey || null,
        result,
        requiresApproval: !!result?.requiresApproval,
        approvalId: result?.approvalId || null,
      });

    } catch (err) {
      errorMessage = err?.message || String(err);
      responseStatus = 'error';
      console.error(`[agentTools] tool=${tool} error:`, errorMessage);

      actionId = await logAgentAction({
        ownerUid,
        source: 'api',
        tool,
        requestPayload: { ...params, idempotencyKey },
        responseStatus: 'error',
        durationMs: Date.now() - startMs,
        idempotencyKey: idempotencyKey || null,
        errorMessage,
      });

      return res.status(500).json({ ok: false, tool, actionId, error: errorMessage });
    }
  },
);

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function _dispatch(tool, ownerUid, params, db) {
  switch (tool) {
    // READ-ONLY
    case 'get_today_context':       return _getTodayContext(ownerUid, params);
    case 'get_priorities':          return _getPriorities(ownerUid, params, db);
    case 'get_focus_goals':         return _getFocusGoals(ownerUid, db);
    case 'get_agent_permissions':   return _getAgentPermissions(ownerUid, db);
    case 'get_weekly_review':       return _getWeeklyReview(ownerUid, params, db);

    // AUTO-WRITE
    case 'capture_task':            return _captureTask(ownerUid, params);
    case 'capture_journal':         return _captureJournal(ownerUid, params);
    case 'capture_story':           return _captureStory(ownerUid, params);
    case 'record_agent_execution_result': return _recordExecutionResult(ownerUid, params);

    // APPROVAL REQUIRED
    case 'propose_task_triage':     return _proposeTaskTriage(ownerUid, params, db);
    case 'propose_reschedule':      return _proposeReschedule(ownerUid, params, db);
    case 'submit_schedule_change_for_approval': return _submitGenericApproval(ownerUid, params, db);
    case 'apply_approved_actions':  return _applyApprovedActions(ownerUid, params, db);

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

// ---------------------------------------------------------------------------
// READ-ONLY tools
// ---------------------------------------------------------------------------

async function _getTodayContext(ownerUid, { dateIso, timezone, bypassCache } = {}) {
  return getAgentTodayContext(ownerUid, { dateIso, timezone, bypassCache: !!bypassCache });
}

async function _getPriorities(ownerUid, { count = 3 } = {}, db) {
  const todayIso = _todayIso();

  const [tasksSnap, storiesSnap] = await Promise.all([
    db.collection('tasks')
      .where('ownerUid', '==', ownerUid)
      .where('aiTop3ForDay', '==', true)
      .where('aiTop3Date', '==', todayIso)
      .limit(10)
      .get()
      .catch(() => ({ docs: [] })),
    db.collection('stories')
      .where('ownerUid', '==', ownerUid)
      .where('aiTop3ForDay', '==', true)
      .where('aiTop3Date', '==', todayIso)
      .limit(10)
      .get()
      .catch(() => ({ docs: [] })),
  ]);

  let items = [
    ...tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id, entityType: 'task' })),
    ...storiesSnap.docs.map((d) => ({ ...d.data(), id: d.id, entityType: 'story' })),
  ].sort((a, b) => (b.aiCriticalityScore || 0) - (a.aiCriticalityScore || 0));

  // Fallback to criticality score sort if AI top3 is empty
  if (items.length === 0) {
    const fallbackSnap = await db.collection('tasks')
      .where('ownerUid', '==', ownerUid)
      .where('status', '<', 2)
      .orderBy('status')
      .orderBy('aiCriticalityScore', 'desc')
      .limit(Number(count) || 3)
      .get()
      .catch(() => ({ docs: [] }));
    items = fallbackSnap.docs.map((d) => ({ ...d.data(), id: d.id, entityType: 'task' }));
  }

  const n = Math.min(Number(count) || 3, 10);
  return {
    items: items.slice(0, n).map((item) => ({
      id:                item.id,
      ref:               item.ref || null,
      title:             item.title || '(untitled)',
      entityType:        item.entityType,
      aiCriticalityScore:item.aiCriticalityScore ?? null,
      priority:          item.priority ?? null,
      dueDate:           _toIso(item.dueDate || item.dueDateMs),
      storyTitle:        item.storyTitle || null,
      goalId:            item.goalId || item.parentGoalId || null,
    })),
  };
}

async function _getFocusGoals(ownerUid, db) {
  const snap = await db.collection('focusGoals')
    .where('ownerUid', '==', ownerUid)
    .where('isActive', '==', true)
    .limit(10)
    .get()
    .catch(() => ({ docs: [] }));

  const goals = snap.docs.map((d) => {
    const fg = { ...d.data(), id: d.id };
    const endMs = _toMs(fg.endDate);
    const daysRemaining = endMs
      ? Math.max(0, Math.ceil((endMs - Date.now()) / 86400000))
      : null;
    return {
      id:           fg.id,
      title:        fg.title || null,
      timeframe:    fg.timeframe || null,
      isActive:     fg.isActive !== false,
      daysRemaining,
      progressPct:  fg.progressPct ?? null,
    };
  });

  return { goals };
}

async function _getAgentPermissions(ownerUid, db) {
  // Check for per-user overrides on profile
  let profileData = {};
  try {
    const snap = await db.collection('profiles').doc(ownerUid).get();
    profileData = snap.exists ? (snap.data() || {}) : {};
  } catch (e) { /* ignore */ }

  const level = profileData.agentPermissions?.level || 'standard';

  const defaults = {
    standard: {
      autoActionTools: [
        'get_today_context', 'get_priorities', 'get_focus_goals',
        'get_weekly_review', 'get_agent_permissions',
        'capture_task', 'capture_journal', 'capture_story',
        'record_agent_execution_result',
      ],
      approvalRequiredTools: [
        'propose_task_triage', 'propose_reschedule',
        'submit_schedule_change_for_approval', 'apply_approved_actions',
      ],
      forbiddenTools: [
        'delete_goal', 'delete_sprint', 'modify_finance',
        'change_sprint_status', 'modify_user_settings',
      ],
    },
  };

  const perms = profileData.agentPermissions || defaults[level] || defaults.standard;

  return {
    permissionLevel: level,
    autoActionTools: perms.autoActionTools || defaults.standard.autoActionTools,
    approvalRequiredTools: perms.approvalRequiredTools || defaults.standard.approvalRequiredTools,
    forbiddenTools: perms.forbiddenTools || defaults.standard.forbiddenTools,
  };
}

async function _getWeeklyReview(ownerUid, { weekStartIso, goalIds } = {}, db) {
  const weekStart = weekStartIso
    ? new Date(weekStartIso)
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() - d.getDay()); // Sunday
        d.setHours(0, 0, 0, 0);
        return d;
      })();
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

  const startTs = admin.firestore.Timestamp.fromDate(weekStart);
  const endTs = admin.firestore.Timestamp.fromDate(weekEnd);

  const [completedTasksSnap, completedStoriesSnap, goalsSnap] = await Promise.all([
    db.collection('tasks')
      .where('ownerUid', '==', ownerUid)
      .where('status', '>=', 2)
      .where('completedAt', '>=', startTs)
      .where('completedAt', '<', endTs)
      .get()
      .catch(() => ({ docs: [] })),
    db.collection('stories')
      .where('ownerUid', '==', ownerUid)
      .where('status', '>=', 4)
      .where('completedAt', '>=', startTs)
      .where('completedAt', '<', endTs)
      .get()
      .catch(() => ({ docs: [] })),
    db.collection('goals')
      .where('ownerUid', '==', ownerUid)
      .get()
      .catch(() => ({ docs: [] })),
  ]);

  const completedTasks = completedTasksSnap.docs.length;
  const completedStories = completedStoriesSnap.docs.length;

  const allGoals = goalsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const filteredGoals = goalIds?.length
    ? allGoals.filter((g) => goalIds.includes(g.id))
    : allGoals.filter((g) => g.status === 1); // WIP goals only

  const goalProgress = filteredGoals.map((g) => ({
    goalId:     g.id,
    title:      g.title || null,
    status:     g.status ?? null,
    theme:      g.theme ?? null,
    kpiSummary: null, // extended in Phase 4 with goalKpiStatus
    progressPct:null,
  }));

  const weekIso = weekStart.toISOString().split('T')[0];

  return {
    weekIso,
    completedTasks,
    completedStories,
    goalProgress,
    sprintVelocity: null, // calculated in Phase 4
    highlights: [],       // LLM-generated in Phase 4
  };
}

// ---------------------------------------------------------------------------
// AUTO-WRITE tools
// ---------------------------------------------------------------------------

async function _captureTask(ownerUid, { title, description, priority, theme, storyId, dueDateIso, persona } = {}) {
  if (!title) throw new Error('title is required for capture_task');

  // Build a natural language prompt for processAgentRequestInternal
  let transcript = `Add task: ${title}`;
  if (description) transcript += `. ${description}`;
  if (dueDateIso) transcript += ` Due: ${dueDateIso}.`;

  const result = await processAgentRequestInternal({
    uid:             ownerUid,
    transcript,
    persona:         persona || 'personal',
    source:          'telegram',
    sourceProvidedId:`agent_capture_task_${Date.now()}`,
    channel:         'agent_api',
    authMode:        'agent_service',
  });

  return {
    task: result?.taskCreated || result?.entity || null,
    spokenResponse: result?.spokenResponse || `Task added: ${title}`,
    _raw: null, // strip internal fields
  };
}

async function _captureJournal(ownerUid, { text, persona } = {}) {
  if (!text) throw new Error('text is required for capture_journal');

  const result = await processAgentRequestInternal({
    uid:             ownerUid,
    transcript:      text,
    persona:         persona || 'personal',
    source:          'telegram',
    sourceProvidedId:`agent_journal_${Date.now()}`,
    channel:         'agent_api',
    authMode:        'agent_service',
  });

  return {
    journalId:      result?.journalId || result?.entity?.id || null,
    oneLineSummary: result?.spokenResponse || 'Journal entry saved.',
    moodScore:      result?.moodScore || null,
  };
}

async function _captureStory(ownerUid, { title, description, goalId, sprintId, persona } = {}) {
  if (!title) throw new Error('title is required for capture_story');

  let transcript = `Create story: ${title}`;
  if (description) transcript += `. ${description}`;
  if (goalId) transcript += ` [goalId:${goalId}]`;

  const result = await processAgentRequestInternal({
    uid:             ownerUid,
    transcript,
    persona:         persona || 'personal',
    source:          'telegram',
    sourceProvidedId:`agent_capture_story_${Date.now()}`,
    channel:         'agent_api',
    authMode:        'agent_service',
  });

  return {
    story: result?.storyCreated || result?.entity || null,
    spokenResponse: result?.spokenResponse || `Story created: ${title}`,
  };
}

async function _recordExecutionResult(ownerUid, { tool, intent, rationale, result, parentActionId } = {}) {
  // This is purely an audit write — logAgentAction is called by the dispatcher for every tool,
  // but the orchestrator may also want to log its reasoning explicitly.
  const { logAgentAction: log } = require('./agentAudit');
  const actionId = await log({
    ownerUid,
    source: 'api',
    tool: `orchestrator:${tool || 'unknown'}`,
    intent: intent || null,
    requestPayload: { rationale, parentActionId },
    responseStatus: 'ok',
    responsePayload: { result },
    durationMs: 0,
  });
  return { actionId };
}

// ---------------------------------------------------------------------------
// APPROVAL-REQUIRED tools
// ---------------------------------------------------------------------------

async function _proposeTaskTriage(ownerUid, { filter = 'overdue', action = 'defer', targetDateIso } = {}, db) {
  // Identify candidate tasks
  let query = db.collection('tasks').where('ownerUid', '==', ownerUid);

  const now = Date.now();
  const todayIso = _todayIso();

  let tasksSnap;
  if (filter === 'overdue') {
    const todayTs = admin.firestore.Timestamp.fromDate(new Date(todayIso));
    tasksSnap = await query
      .where('status', '<', 2)
      .where('dueDate', '<', todayTs)
      .limit(20)
      .get()
      .catch(() => ({ docs: [] }));
  } else if (filter === 'today') {
    const startTs = admin.firestore.Timestamp.fromDate(new Date(todayIso + 'T00:00:00Z'));
    const endTs = admin.firestore.Timestamp.fromDate(new Date(todayIso + 'T23:59:59Z'));
    tasksSnap = await query
      .where('status', '<', 2)
      .where('dueDate', '>=', startTs)
      .where('dueDate', '<=', endTs)
      .limit(20)
      .get()
      .catch(() => ({ docs: [] }));
  } else {
    // sprint — tasks in active sprint
    tasksSnap = await query
      .where('status', '<', 2)
      .limit(30)
      .get()
      .catch(() => ({ docs: [] }));
  }

  const tasks = tasksSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((t) => !t.deleted && t.status < 2);

  if (!tasks.length) {
    return { requiresApproval: false, result: 'No tasks matched the filter.', affectedCount: 0, items: [] };
  }

  const targetDate = targetDateIso || _nextWeekdayIso();
  const actionLabel = action === 'defer' ? `defer to ${targetDate}` : 'deprioritise';

  const proposalSummary = `${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} ${tasks.length} ${filter} task(s): ${tasks.slice(0, 3).map((t) => t.title || t.ref || t.id).join(', ')}${tasks.length > 3 ? ` +${tasks.length - 3} more` : ''}`;

  const approvalActions = tasks.map((t) =>
    action === 'defer'
      ? { type: 'defer_task', payload: { taskId: t.id, targetDateIso: targetDate, ownerUid } }
      : { type: 'deprioritise_task', payload: { taskId: t.id, ownerUid } },
  );

  const approvalId = await _createApproval(db, {
    ownerUid,
    tool: 'propose_task_triage',
    proposalSummary,
    actions: approvalActions,
  });

  return {
    requiresApproval: true,
    approvalId,
    proposalSummary,
    affectedCount: tasks.length,
    items: tasks.slice(0, 10).map((t) => ({
      id: t.id, ref: t.ref || null, title: t.title || '(untitled)',
      dueDate: _toIso(t.dueDate),
    })),
  };
}

async function _proposeReschedule(ownerUid, { taskIds, targetDateIso } = {}, db) {
  if (!Array.isArray(taskIds) || !taskIds.length) throw new Error('taskIds[] is required');
  if (!targetDateIso) throw new Error('targetDateIso is required');

  const taskDocs = await Promise.all(
    taskIds.slice(0, 20).map((id) => db.collection('tasks').doc(id).get()),
  );
  const tasks = taskDocs
    .filter((d) => d.exists && d.data()?.ownerUid === ownerUid)
    .map((d) => ({ ...d.data(), id: d.id }));

  if (!tasks.length) return { requiresApproval: false, result: 'No matching tasks found.', approvalId: null };

  const proposalSummary = `Move ${tasks.length} task(s) to ${targetDateIso}: ${tasks.slice(0, 3).map((t) => t.title || t.ref || t.id).join(', ')}${tasks.length > 3 ? ` +${tasks.length - 3} more` : ''}`;

  const approvalActions = tasks.map((t) => ({
    type: 'defer_task',
    payload: { taskId: t.id, targetDateIso, ownerUid },
  }));

  const approvalId = await _createApproval(db, {
    ownerUid,
    tool: 'propose_reschedule',
    proposalSummary,
    actions: approvalActions,
  });

  return { requiresApproval: true, approvalId, proposalSummary, affectedCount: tasks.length };
}

async function _submitGenericApproval(ownerUid, { proposalSummary, actions, contextNote } = {}, db) {
  if (!proposalSummary) throw new Error('proposalSummary is required');
  if (!Array.isArray(actions) || !actions.length) throw new Error('actions[] is required');

  const approvalId = await _createApproval(db, {
    ownerUid,
    tool: 'submit_schedule_change_for_approval',
    proposalSummary,
    actions,
    contextNote: contextNote || null,
  });

  return { requiresApproval: true, approvalId, proposalSummary };
}

async function _applyApprovedActions(ownerUid, { approvalId } = {}, db) {
  if (!approvalId) throw new Error('approvalId is required');

  const ref = db.collection('pending_approvals').doc(approvalId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error(`Approval ${approvalId} not found`);
  const approval = snap.data();
  if (approval.ownerUid !== ownerUid) throw new Error('Approval does not belong to this user');
  if (approval.status === 'completed') return { ok: true, message: 'Already applied', appliedActions: [], failedActions: [] };
  if (approval.status !== 'approved') throw new Error(`Approval is not in approved state (current: ${approval.status})`);

  // Delegate to approvalWorker
  const { executeApprovedActions } = require('./approvalWorker');
  return executeApprovedActions(db, approval, approvalId);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function _createApproval(db, { ownerUid, tool, proposalSummary, actions, contextNote = null }) {
  const { v4: uuidv4 } = require('uuid');
  const approvalId = uuidv4();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await db.collection('pending_approvals').doc(approvalId).set({
    ownerUid,
    status: 'pending',
    tool,
    proposalSummary,
    proposalDetail: { contextNote },
    actions: actions || [],
    telegramChatId: null,       // filled in by telegramWebhook after message is sent
    telegramMessageId: null,
    telegramCallbackQueryId: null,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    decidedAt: null,
    decidedBy: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    actionLogId: null,          // filled in by caller
  });

  return approvalId;
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

function _toIso(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return null;
}

function _toMs(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return null;
}
