const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const { loadThemesForUser, mapThemeIdToLabel, getGoogleColorForThemeId } = require('./services/themeManager');
const { buildAbsoluteUrl, buildEntityUrl } = require('./utils/urlHelpers');

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const GCAL_PAST_DAYS = 14;
const GCAL_FUTURE_DAYS = 90;
const ALLOWED_ROUTINE_TYPES = new Set(['chore', 'routine', 'habit']);
const TASK_TABLE_LIMIT = 12;
const MAX_PRIVATE_TASK_REFS = 6;

function toMillis(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    // If the value looks like a seconds timestamp (10-digit), scale to ms
    if (value > 0 && value < 1e11) return value * 1000;
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') {
      const nanos = Number(value.nanoseconds || value.nanos || 0);
      return value.seconds * 1000 + Math.round(nanos / 1e6);
    }
  }
  return 0;
}

function isValidUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toPrivateString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildPrivateProps(values) {
  const entries = Object.entries(values || {});
  const out = {};
  for (const [key, value] of entries) {
    const asString = toPrivateString(value);
    if (asString === null) continue;
    out[key] = asString;
  }
  return out;
}

function resolveBlockDeepLink(block) {
  if (!block) return null;
  if (block.storyId) {
    return buildEntityUrl('story', String(block.storyId), block.storyRef || block.storyReference || null);
  }
  if (block.taskId) {
    return buildEntityUrl('task', String(block.taskId), block.taskRef || block.taskReference || null);
  }
  const raw = block.deepLink || block.linkUrl || block.url || block.link || null;
  if (raw) return buildAbsoluteUrl(String(raw));
  if (block.choreId) return buildAbsoluteUrl(`/chores?choreId=${encodeURIComponent(String(block.choreId))}`);
  if (block.routineId) return buildAbsoluteUrl(`/routines?routineId=${encodeURIComponent(String(block.routineId))}`);
  if (block.habitId) return buildAbsoluteUrl(`/habits?habitId=${encodeURIComponent(String(block.habitId))}`);
  return null;
}

function normalizeTaskStatus(status) {
  if (typeof status === 'number') {
    if (status === 0) return 'To Do';
    if (status === 1) return 'In Progress';
    if (status === 2) return 'Done';
    if (status === 3) return 'Blocked';
    return 'Unknown';
  }
  const raw = String(status || '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return 'Unknown';
  if (['todo', 'backlog', 'planned', 'new'].includes(raw)) return 'To Do';
  if (['in-progress', 'in progress', 'active', 'wip', 'testing', 'review'].includes(raw)) return 'In Progress';
  if (['blocked', 'paused', 'on-hold', 'stalled'].includes(raw)) return 'Blocked';
  if (['done', 'complete', 'completed', 'closed', 'finished'].includes(raw)) return 'Done';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeTaskPriority(priority) {
  if (typeof priority === 'number') {
    if (priority === 4) return 'Critical';
    if (priority === 3) return 'Low';
    if (priority === 2) return 'Medium';
    if (priority === 1) return 'High';
    if (priority === 0) return 'None';
    return 'Unknown';
  }
  const raw = String(priority || '').trim().toLowerCase();
  if (!raw) return 'Unknown';
  if (raw === 'critical') return 'Critical';
  if (raw === 'high') return 'High';
  if (raw === 'medium' || raw === 'med') return 'Medium';
  if (raw === 'low') return 'Low';
  if (raw === 'none') return 'None';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveTaskDueDate(task) {
  const candidates = [task.dueDateMs, task.dueDate, task.targetDate, task.startDate];
  for (const value of candidates) {
    if (!value) continue;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
      return value;
    }
    const ms = toMillis(value);
    if (ms) return new Date(ms).toISOString().slice(0, 10);
  }
  return '';
}

function safeTableCell(value) {
  return String(value || '')
    .replace(/[|\r\n]+/g, ' ')
    .trim();
}

function resolveTaskRef(task) {
  if (!task) return '';
  return task.ref || task.reference || task.displayId || task.id || '';
}

function buildLinkedTasksTable(tasks) {
  if (!tasks.length) return [];
  const statusRank = (status) => {
    const label = String(normalizeTaskStatus(status)).toLowerCase();
    if (label === 'done') return 2;
    if (label === 'blocked') return 1;
    return 0;
  };
  const priorityRank = (priority) => {
    if (typeof priority === 'number') {
      if (priority === 4) return 0;
      if (priority === 1) return 1;
      if (priority === 2) return 2;
      if (priority === 3) return 3;
      return 4;
    }
    const raw = String(priority || '').toLowerCase();
    if (raw === 'critical') return 0;
    if (raw === 'high') return 1;
    if (raw === 'medium' || raw === 'med') return 2;
    if (raw === 'low') return 3;
    return 4;
  };
  const dueRank = (task) => {
    const ms = toMillis(task.dueDateMs || task.dueDate || task.targetDate || task.startDate);
    return ms || Number.MAX_SAFE_INTEGER;
  };

  const rows = tasks
    .filter((task) => !task.deleted)
    .sort((a, b) => {
      const statusDiff = statusRank(a.status) - statusRank(b.status);
      if (statusDiff !== 0) return statusDiff;
      const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      const dueDiff = dueRank(a) - dueRank(b);
      if (dueDiff !== 0) return dueDiff;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });

  const limited = rows.slice(0, TASK_TABLE_LIMIT);
  const lines = [
    'Linked tasks:',
    '| Ref | Title | Status | Priority | Points | Due |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  limited.forEach((task) => {
    const ref = resolveTaskRef(task);
    const title = task.title || 'Untitled task';
    const status = normalizeTaskStatus(task.status);
    const priority = normalizeTaskPriority(task.priority);
    const points = Number.isFinite(Number(task.points)) ? Number(task.points) : '';
    const due = resolveTaskDueDate(task);
    lines.push(`| ${safeTableCell(ref)} | ${safeTableCell(title)} | ${safeTableCell(status)} | ${safeTableCell(priority)} | ${safeTableCell(points)} | ${safeTableCell(due)} |`);
  });

  if (rows.length > limited.length) {
    lines.push(`...and ${rows.length - limited.length} more linked tasks`);
  }

  return lines;
}

async function fetchLinkedTasksForStory(uid, storyId) {
  const tasksRef = admin.firestore().collection('tasks');
  const fetchSnap = (query) => query.get().catch(() => ({ docs: [] }));
  const [byStory, byParent] = await Promise.all([
    fetchSnap(
      tasksRef
        .where('ownerUid', '==', uid)
        .where('storyId', '==', String(storyId))
        .limit(TASK_TABLE_LIMIT * 2),
    ),
    fetchSnap(
      tasksRef
        .where('ownerUid', '==', uid)
        .where('parentType', '==', 'story')
        .where('parentId', '==', String(storyId))
        .limit(TASK_TABLE_LIMIT * 2),
    ),
  ]);

  const map = new Map();
  [byStory, byParent].forEach((snap) => {
    (snap.docs || []).forEach((doc) => {
      map.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
    });
  });
  return Array.from(map.values());
}

async function logCalendarIntegration(uid, payload) {
  try {
    await admin.firestore().collection('integration_logs').add({
      integration: 'google_calendar',
      userId: uid,
      ownerUid: uid,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...payload,
    });
  } catch (err) {
    console.warn('[calendarSync] failed to write integration log', err?.message || err);
  }
}

async function getCalendarClientForUser(uid) {
  const userDoc = await admin.firestore().collection('users').doc(uid).get();
  const userData = userDoc.data() || {};
  let tokens = userData.googleCalendarTokens || null;
  if (!tokens) {
    try {
      const legacyDoc = await admin.firestore().collection('tokens').doc(uid).get();
      if (legacyDoc.exists) {
        const legacyData = legacyDoc.data() || {};
        tokens = legacyData.googleCalendarTokens || (legacyData.refresh_token ? { refresh_token: legacyData.refresh_token } : null);
      }
    } catch { /* ignore */ }
  }
  if (!tokens) throw new Error('Google Calendar not connected');
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth not configured');
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  return { calendar, userData };
}

async function listAllEvents(calendar, { timeMin, timeMax }) {
  const events = [];
  let pageToken = undefined;
  do {
    const resp = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: 250,
      pageToken,
    });
    events.push(...(resp.data.items || []));
    pageToken = resp.data.nextPageToken;
  } while (pageToken);
  return events;
}

function parseEventTime(timeObj) {
  if (!timeObj) return null;
  if (timeObj.dateTime) return new Date(timeObj.dateTime).getTime();
  if (timeObj.date) return new Date(`${timeObj.date}T00:00:00Z`).getTime();
  return null;
}

function getGoogleOAuthConfig() {
  const projectId = process.env.GCLOUD_PROJECT;
  const region = 'europe-west2';
  const env = process.env || {};
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID || (functions.config().google && functions.config().google.client_id);
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET || (functions.config().google && functions.config().google.client_secret);
  const redirectFromConfig = functions.config().google && functions.config().google.redirect_uri;
  const redirectUri = redirectFromConfig || (projectId ? `https://${region}-${projectId}.cloudfunctions.net/oauthCallback` : undefined);
  return { clientId, clientSecret, redirectUri };
}

async function getActiveSprintId(uid) {
  try {
    const snap = await admin.firestore()
      .collection('sprints')
      .where('ownerUid', '==', uid)
      .where('status', 'in', ['active', 1])
      .orderBy('startDate', 'desc')
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].id;
  } catch (e) {
    console.warn('[getActiveSprintId] failed', e?.message || e);
  }
  return null;
}

// Revised helper to accept block data optionally
async function syncBlockToGoogle(blockId, action, uid, blockData = null) {
  let block = blockData;
  let eventId = null;
  const errorContext = {};
  const debugLogs = [];
  const testMode = !!process.env.CALENDAR_SYNC_TEST_MODE;
  try {
    const { calendar } = await getCalendarClientForUser(uid);

    if (!block && action !== 'delete') {
      const snap = await admin.firestore().collection('calendar_blocks').doc(blockId).get();
      if (!snap.exists) throw new Error('Block not found');
      block = snap.data();
    }

    if (action === 'create') {
      const themes = await loadThemesForUser(uid);
      const themeLabel = block.theme_id ? mapThemeIdToLabel(block.theme_id, themes) : (block.theme || 'General');
      const activityName = block.title || block.category || 'BOB Block';
      const refPart = block.storyRef || block.taskRef || '';
      const summaryParts = [];
      summaryParts.push(activityName);
      if (refPart) summaryParts.push(refPart);
      summaryParts.push(`[${themeLabel}]`);
      const summaryText = summaryParts.filter(Boolean).join(' - ');
      const startMs = toMillis(block.start);
      const endMs = toMillis(block.end);
      let eventDeepLink = resolveBlockDeepLink(block);
      const eventContext = {
        storyRef: block.storyRef || null,
        taskRef: block.taskRef || null,
        goalId: null,
        goalRef: null,
        storyTitle: null,
        taskTitle: null,
        linkedTaskRefs: [],
      };
      errorContext.startMs = startMs;
      errorContext.endMs = endMs;
      errorContext.themeLabel = themeLabel;
      errorContext.activityName = activityName;
      if (!startMs || !endMs || startMs >= endMs) {
        throw new Error('Invalid start/end on block');
      }
      let enrichedDesc = block.rationale || '';
      let aiScoreVal = block.aiScore ?? block.aiCriticalityScore ?? null;
      let aiReasonVal = block.aiReason || block.aiCriticalityReason || block.dueDateReason || '';
      try {
        if (block.storyId) {
          const s = await admin.firestore().collection('stories').doc(String(block.storyId)).get();
          if (s.exists) {
            const sd = s.data() || {};
            const storyRef = sd.ref || s.id;
            const link = buildEntityUrl('story', s.id, storyRef);
            eventContext.storyRef = storyRef;
            eventContext.storyTitle = sd.title || null;
            eventDeepLink = link;
            if (sd.aiCriticalityScore != null) {
              aiScoreVal = aiScoreVal ?? sd.aiCriticalityScore;
            }
            if (!aiReasonVal && sd.aiCriticalityReason) {
              aiReasonVal = sd.aiCriticalityReason || '';
            }
            const acArr = Array.isArray(sd.acceptanceCriteria)
              ? sd.acceptanceCriteria.filter(Boolean).map((x) => String(x)).slice(0, 3)
              : (Array.isArray(sd.acceptance_criteria) ? sd.acceptance_criteria.filter(Boolean).map((x) => String(x)).slice(0, 3) : []);
            const lines = [];
            if (enrichedDesc) lines.push(enrichedDesc);
            lines.push(`Story: ${storyRef} – ${sd.title || 'Story'}`);

            // NEW: Mandatory Deep Links
            lines.push(`Story Link: ${link}`);
            if (sd.goalId) {
              let goalRef = sd.goalId;
              try {
                const g = await admin.firestore().collection('goals').doc(String(sd.goalId)).get();
                if (g.exists) {
                  const gd = g.data() || {};
                  goalRef = gd.ref || gd.reference || goalRef;
                }
              } catch { }
              eventContext.goalId = sd.goalId;
              eventContext.goalRef = goalRef;
              lines.push(`Goal Link: ${buildEntityUrl('goal', sd.goalId, goalRef)}`);
            }
            if (sd.sprintId) lines.push(`Sprint Link: ${buildAbsoluteUrl(`/sprints?sprintId=${sd.sprintId}`)}`);
            lines.push(`Planner: ${buildAbsoluteUrl('/calendar/planner')}`);

            const aiLineParts = [];
            if (aiScoreVal != null) aiLineParts.push(`AI score ${aiScoreVal}/100`);
            if (aiReasonVal) aiLineParts.push(aiReasonVal);
            if (aiLineParts.length) lines.push('', aiLineParts.join(' – '));
            if (block.placementReason) lines.push(`Placement: ${block.placementReason}`);

            const linkedTasks = await fetchLinkedTasksForStory(uid, s.id);
            eventContext.linkedTaskRefs = linkedTasks.map(resolveTaskRef).filter(Boolean);
            const taskTable = buildLinkedTasksTable(linkedTasks);
            if (taskTable.length) {
              lines.push('', ...taskTable);
            }

            if (acArr.length) {
              lines.push('', 'Acceptance criteria:');
              for (const item of acArr) lines.push(`- ${item}`);
            }
            enrichedDesc = lines.join('\n');
          }
        } else if (block.taskId) {
          const t = await admin.firestore().collection('tasks').doc(String(block.taskId)).get();
          if (t.exists) {
            const td = t.data() || {};
            const taskRef = resolveTaskRef(td) || t.id;
            const taskLink = buildEntityUrl('task', t.id, taskRef);
            eventContext.taskRef = taskRef;
            eventContext.taskTitle = td.title || null;
            eventDeepLink = taskLink;
            if (td.aiCriticalityScore != null) {
              aiScoreVal = aiScoreVal ?? td.aiCriticalityScore;
            }
            if (!aiReasonVal && td.aiCriticalityReason) {
              aiReasonVal = td.aiCriticalityReason || '';
            }
            const lines = [];
            if (enrichedDesc) lines.push(enrichedDesc);
            lines.push(`Task: ${taskRef} – ${td.title || 'Task'}`);
            lines.push(`Task Link: ${taskLink}`);
            const storyId = td.storyId || (td.parentType === 'story' ? td.parentId : null);
            if (storyId) {
              try {
                const s = await admin.firestore().collection('stories').doc(String(storyId)).get();
                if (s.exists) {
                  const sd = s.data() || {};
                  const storyRef = sd.ref || s.id;
                  const storyLink = buildEntityUrl('story', s.id, storyRef);
                  eventContext.storyRef = storyRef;
                  eventContext.storyTitle = sd.title || null;
                  lines.push(`Story Link: ${storyLink}`);
                  if (sd.goalId) {
                    let goalRef = sd.goalId;
                    try {
                      const g = await admin.firestore().collection('goals').doc(String(sd.goalId)).get();
                      if (g.exists) {
                        const gd = g.data() || {};
                        goalRef = gd.ref || gd.reference || goalRef;
                      }
                    } catch { }
                    eventContext.goalId = sd.goalId;
                    eventContext.goalRef = goalRef;
                    lines.push(`Goal Link: ${buildEntityUrl('goal', sd.goalId, goalRef)}`);
                  }
                }
              } catch { }
            }
            if (td.goalId && !eventContext.goalId) {
              let goalRef = td.goalId;
              try {
                const g = await admin.firestore().collection('goals').doc(String(td.goalId)).get();
                if (g.exists) {
                  const gd = g.data() || {};
                  goalRef = gd.ref || gd.reference || goalRef;
                }
              } catch { }
              eventContext.goalId = td.goalId;
              eventContext.goalRef = goalRef;
              lines.push(`Goal Link: ${buildEntityUrl('goal', td.goalId, goalRef)}`);
            }
            if (td.sprintId) lines.push(`Sprint Link: ${buildAbsoluteUrl(`/sprints?sprintId=${td.sprintId}`)}`);
            lines.push(`Planner: ${buildAbsoluteUrl('/calendar/planner')}`);

            const aiLineParts = [];
            if (aiScoreVal != null) aiLineParts.push(`AI score ${aiScoreVal}/100`);
            if (aiReasonVal) aiLineParts.push(aiReasonVal);
            if (aiLineParts.length) lines.push('', aiLineParts.join(' – '));
            if (block.placementReason) lines.push(`Placement: ${block.placementReason}`);

            enrichedDesc = lines.join('\n');
          }
        }
      } catch { }
      if (!block.storyId && !block.taskId) {
        if (eventDeepLink) {
          const linkLabel = block.taskId
            ? 'Task Link'
            : block.choreId
              ? 'Chore Link'
              : block.routineId
                ? 'Routine Link'
                : block.habitId
                  ? 'Habit Link'
                  : 'Link';
          const linkLine = `${linkLabel}: ${eventDeepLink}`;
          enrichedDesc = enrichedDesc ? `${enrichedDesc}\n${linkLine}` : linkLine;
        }
        const aiLineParts = [];
        if (aiScoreVal != null) aiLineParts.push(`AI score ${aiScoreVal}/100`);
        if (aiReasonVal) aiLineParts.push(aiReasonVal);
        if (block.placementReason) aiLineParts.push(`Placement: ${block.placementReason}`);
        if (aiLineParts.length) {
          const aiBlock = aiLineParts.join(' – ');
          enrichedDesc = enrichedDesc ? `${enrichedDesc}\n\n${aiBlock}` : aiBlock;
        }
      }
      const minimalEvent = {
        summary: summaryText,
        start: { dateTime: new Date(startMs).toISOString(), timeZone: 'UTC' },
        end: { dateTime: new Date(endMs).toISOString(), timeZone: 'UTC' },
      };

      // Step 1: insert minimal to avoid validation edge-cases (no color, no extended props)
      const createResponse = await calendar.events.insert({ calendarId: 'primary', resource: minimalEvent });
      const createdEvent = createResponse?.data || {};
      eventId = createdEvent.id;
      let gcalHtmlLink = createdEvent.htmlLink || null;
      debugLogs.push({ step: 'insert_minimal_ok', eventId });

      // In test mode, stop after minimal insert so we can validate the API path
      if (testMode) {
        await logCalendarIntegration(uid, {
          action: 'push',
          direction: action,
          status: 'test_insert_only',
          blockId,
          blockTitle: block?.title || null,
          eventId,
          errorContext,
          debug: debugLogs,
        });
        return { success: true, eventId };
      }

      // Step 2: patch with full metadata (rationale, links, acceptance criteria, ext props)
      const entityType = block.storyId
        ? 'story'
        : block.taskId
          ? 'task'
          : block.choreId
            ? 'chore'
            : block.routineId
              ? 'routine'
              : block.habitId
                ? 'habit'
                : 'block';
      const linkedTaskRefs = eventContext.linkedTaskRefs.filter(Boolean);
      const privateProps = buildPrivateProps({
        'bob-block-id': blockId,
        'bob-entity-type': entityType,
        'bob-persona': block.persona,
        'bob-theme': themeLabel,
        'bob-theme-id': block.theme_id,
        'bob-category': block.category,
        'bob-story-id': block.storyId,
        'bob-story-ref': eventContext.storyRef,
        'bob-story-title': eventContext.storyTitle,
        'bob-task-id': block.taskId,
        'bob-task-ref': eventContext.taskRef,
        'bob-task-title': eventContext.taskTitle,
        'bob-goal-id': eventContext.goalId,
        'bob-goal-ref': eventContext.goalRef,
        'bob-flexibility': block.flexibility,
        'bob-rationale': block.rationale || '',
        'bob-deeplink': eventDeepLink || '',
        'bob-ai-score': aiScoreVal ?? '',
        'bob-ai-reason': aiReasonVal || '',
        'bob-placement': block.placementReason || block.rationale || '',
        'bob-linked-task-refs': linkedTaskRefs.length ? linkedTaskRefs.slice(0, MAX_PRIVATE_TASK_REFS).join(',') : null,
        'bob-linked-task-count': linkedTaskRefs.length ? linkedTaskRefs.length : null,
      });
      const eventSource = isValidUrl(eventDeepLink) ? { title: 'BOB', url: eventDeepLink } : undefined;
      const fullEvent = {
        summary: summaryText,
        description: enrichedDesc || 'BOB calendar block',
        start: { dateTime: new Date(startMs).toISOString(), timeZone: 'UTC' },
        end: { dateTime: new Date(endMs).toISOString(), timeZone: 'UTC' },
        colorId: block.theme_id ? getGoogleColorForThemeId(block.theme_id, themes) : getColorForTheme(themeLabel),
        source: eventSource,
        extendedProperties: Object.keys(privateProps).length ? { private: privateProps } : undefined
      };
      try {
        const patchResponse = await calendar.events.patch({ calendarId: 'primary', eventId, resource: fullEvent });
        if (patchResponse?.data?.htmlLink) gcalHtmlLink = patchResponse.data.htmlLink;
        debugLogs.push({ step: 'patch_full_ok', eventId });
      } catch (patchErr) {
        const patchErrDetail = patchErr?.response?.data || patchErr?.errors || patchErr?.message || String(patchErr);
        debugLogs.push({ step: 'patch_full_error', eventId, patchErr: patchErrDetail });
        await logCalendarIntegration(uid, {
          action: 'push',
          direction: 'patch',
          status: 'error',
          blockId,
          blockTitle: block?.title || null,
          eventId,
          error: patchErrDetail,
          errorPayload: patchErr?.response?.data || null,
          errorContext,
        });
        console.warn('GCal patch failed after insert', patchErrDetail);
      }

      const updatePayload = {
        googleEventId: eventId,
        status: 'applied',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (gcalHtmlLink) updatePayload.externalLink = gcalHtmlLink;
      await admin.firestore().collection('calendar_blocks').doc(blockId).update(updatePayload);
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: action,
        status: 'success',
        blockId,
        blockTitle: block?.title || null,
        storyId: block.storyId || null,
        taskId: block.taskId || null,
        eventId,
      });
      return { success: true, eventId };
    }
    else if (action === 'update') {
      if (!block.googleEventId) throw new Error('Block not synced to Google');
      const themes = await loadThemesForUser(uid);
      const themeLabel = block.theme_id ? mapThemeIdToLabel(block.theme_id, themes) : (block.theme || 'General');
      const activityName = block.title || block.category || 'BOB Block';
      const refPart = block.storyRef || block.taskRef || '';
      const summaryParts = [];
      summaryParts.push(activityName);
      if (refPart) summaryParts.push(refPart);
      summaryParts.push(`[${themeLabel}]`);
      const summaryText = summaryParts.filter(Boolean).join(' - ');
      let enrichedDesc2 = block.rationale || '';
      let aiScoreVal2 = block.aiScore ?? block.aiCriticalityScore ?? null;
      let aiReasonVal2 = block.aiReason || block.aiCriticalityReason || block.dueDateReason || '';
      let eventDeepLink = resolveBlockDeepLink(block);
      const eventContext = {
        storyRef: block.storyRef || null,
        taskRef: block.taskRef || null,
        goalId: null,
        goalRef: null,
        storyTitle: null,
        taskTitle: null,
        linkedTaskRefs: [],
      };
      try {
        if (block.storyId) {
          const s = await admin.firestore().collection('stories').doc(String(block.storyId)).get();
          if (s.exists) {
            const sd = s.data() || {};
            const storyRef = sd.ref || s.id;
            const link = buildEntityUrl('story', s.id, storyRef);
            eventContext.storyRef = storyRef;
            eventContext.storyTitle = sd.title || null;
            eventDeepLink = link;
            if (sd.aiCriticalityScore != null) {
              aiScoreVal2 = aiScoreVal2 ?? sd.aiCriticalityScore;
            }
            if (!aiReasonVal2 && sd.aiCriticalityReason) {
              aiReasonVal2 = sd.aiCriticalityReason || '';
            }
            const acArr = Array.isArray(sd.acceptanceCriteria)
              ? sd.acceptanceCriteria.filter(Boolean).map((x) => String(x)).slice(0, 3)
              : (Array.isArray(sd.acceptance_criteria) ? sd.acceptance_criteria.filter(Boolean).map((x) => String(x)).slice(0, 3) : []);
            const lines = [];
            if (enrichedDesc2) lines.push(enrichedDesc2);
            lines.push(`Story: ${storyRef} – ${sd.title || 'Story'}`);

            // NEW: Mandatory Deep Links
            lines.push(`Story Link: ${link}`);
            if (sd.goalId) {
              let goalRef = sd.goalId;
              try {
                const g = await admin.firestore().collection('goals').doc(String(sd.goalId)).get();
                if (g.exists) {
                  const gd = g.data() || {};
                  goalRef = gd.ref || gd.reference || goalRef;
                }
              } catch { }
              eventContext.goalId = sd.goalId;
              eventContext.goalRef = goalRef;
              lines.push(`Goal Link: ${buildEntityUrl('goal', sd.goalId, goalRef)}`);
            }
            if (sd.sprintId) lines.push(`Sprint Link: ${buildAbsoluteUrl(`/sprints?sprintId=${sd.sprintId}`)}`);
            lines.push(`Planner: ${buildAbsoluteUrl('/calendar/planner')}`);

            const aiLineParts = [];
            if (aiScoreVal2 != null) aiLineParts.push(`AI score ${aiScoreVal2}/100`);
            if (aiReasonVal2) aiLineParts.push(aiReasonVal2);
            if (block.placementReason) aiLineParts.push(`Placement: ${block.placementReason}`);
            if (aiLineParts.length) lines.push('', aiLineParts.join(' – '));

            const linkedTasks = await fetchLinkedTasksForStory(uid, s.id);
            eventContext.linkedTaskRefs = linkedTasks.map(resolveTaskRef).filter(Boolean);
            const taskTable = buildLinkedTasksTable(linkedTasks);
            if (taskTable.length) {
              lines.push('', ...taskTable);
            }

            if (acArr.length) {
              lines.push('', 'Acceptance criteria:');
              for (const item of acArr) lines.push(`- ${item}`);
            }
            enrichedDesc2 = lines.join('\n');
          }
        } else if (block.taskId) {
          const t = await admin.firestore().collection('tasks').doc(String(block.taskId)).get();
          if (t.exists) {
            const td = t.data() || {};
            const taskRef = resolveTaskRef(td) || t.id;
            const taskLink = buildEntityUrl('task', t.id, taskRef);
            eventContext.taskRef = taskRef;
            eventContext.taskTitle = td.title || null;
            eventDeepLink = taskLink;
            if (td.aiCriticalityScore != null) {
              aiScoreVal2 = aiScoreVal2 ?? td.aiCriticalityScore;
            }
            if (!aiReasonVal2 && td.aiCriticalityReason) {
              aiReasonVal2 = td.aiCriticalityReason || '';
            }
            const lines = [];
            if (enrichedDesc2) lines.push(enrichedDesc2);
            lines.push(`Task: ${taskRef} – ${td.title || 'Task'}`);
            lines.push(`Task Link: ${taskLink}`);
            const storyId = td.storyId || (td.parentType === 'story' ? td.parentId : null);
            if (storyId) {
              try {
                const s = await admin.firestore().collection('stories').doc(String(storyId)).get();
                if (s.exists) {
                  const sd = s.data() || {};
                  const storyRef = sd.ref || s.id;
                  const storyLink = buildEntityUrl('story', s.id, storyRef);
                  eventContext.storyRef = storyRef;
                  eventContext.storyTitle = sd.title || null;
                  lines.push(`Story Link: ${storyLink}`);
                  if (sd.goalId) {
                    let goalRef = sd.goalId;
                    try {
                      const g = await admin.firestore().collection('goals').doc(String(sd.goalId)).get();
                      if (g.exists) {
                        const gd = g.data() || {};
                        goalRef = gd.ref || gd.reference || goalRef;
                      }
                    } catch { }
                    eventContext.goalId = sd.goalId;
                    eventContext.goalRef = goalRef;
                    lines.push(`Goal Link: ${buildEntityUrl('goal', sd.goalId, goalRef)}`);
                  }
                }
              } catch { }
            }
            if (td.goalId && !eventContext.goalId) {
              let goalRef = td.goalId;
              try {
                const g = await admin.firestore().collection('goals').doc(String(td.goalId)).get();
                if (g.exists) {
                  const gd = g.data() || {};
                  goalRef = gd.ref || gd.reference || goalRef;
                }
              } catch { }
              eventContext.goalId = td.goalId;
              eventContext.goalRef = goalRef;
              lines.push(`Goal Link: ${buildEntityUrl('goal', td.goalId, goalRef)}`);
            }
            if (td.sprintId) lines.push(`Sprint Link: ${buildAbsoluteUrl(`/sprints?sprintId=${td.sprintId}`)}`);
            lines.push(`Planner: ${buildAbsoluteUrl('/calendar/planner')}`);

            const aiLineParts = [];
            if (aiScoreVal2 != null) aiLineParts.push(`AI score ${aiScoreVal2}/100`);
            if (aiReasonVal2) aiLineParts.push(aiReasonVal2);
            if (aiLineParts.length) lines.push('', aiLineParts.join(' – '));
            if (block.placementReason) lines.push(`Placement: ${block.placementReason}`);

            enrichedDesc2 = lines.join('\n');
          }
        }
      } catch { }
      if (!block.storyId && !block.taskId) {
        if (eventDeepLink) {
          const linkLabel = block.taskId
            ? 'Task Link'
            : block.choreId
              ? 'Chore Link'
              : block.routineId
                ? 'Routine Link'
                : block.habitId
                  ? 'Habit Link'
                  : 'Link';
          const linkLine = `${linkLabel}: ${eventDeepLink}`;
          enrichedDesc2 = enrichedDesc2 ? `${enrichedDesc2}\n${linkLine}` : linkLine;
        }
        const aiLineParts = [];
        if (aiScoreVal2 != null) aiLineParts.push(`AI score ${aiScoreVal2}/100`);
        if (aiReasonVal2) aiLineParts.push(aiReasonVal2);
        if (block.placementReason) aiLineParts.push(`Placement: ${block.placementReason}`);
        if (aiLineParts.length) {
          const aiBlock = aiLineParts.join(' – ');
          enrichedDesc2 = enrichedDesc2 ? `${enrichedDesc2}\n\n${aiBlock}` : aiBlock;
        }
      }
      const startMs = toMillis(block.start);
      const endMs = toMillis(block.end);
      errorContext.startMs = startMs;
      errorContext.endMs = endMs;
      errorContext.themeLabel = themeLabel;
      errorContext.activityName = activityName;
      if (!startMs || !endMs || startMs >= endMs) {
        throw new Error('Invalid start/end on block');
      }
      const entityType = block.storyId
        ? 'story'
        : block.taskId
          ? 'task'
          : block.choreId
            ? 'chore'
            : block.routineId
              ? 'routine'
              : block.habitId
                ? 'habit'
                : 'block';
      const linkedTaskRefs = eventContext.linkedTaskRefs.filter(Boolean);
      const privateProps = buildPrivateProps({
        'bob-block-id': blockId,
        'bob-entity-type': entityType,
        'bob-persona': block.persona,
        'bob-theme': themeLabel,
        'bob-theme-id': block.theme_id,
        'bob-category': block.category,
        'bob-story-id': block.storyId,
        'bob-story-ref': eventContext.storyRef,
        'bob-story-title': eventContext.storyTitle,
        'bob-task-id': block.taskId,
        'bob-task-ref': eventContext.taskRef,
        'bob-task-title': eventContext.taskTitle,
        'bob-goal-id': eventContext.goalId,
        'bob-goal-ref': eventContext.goalRef,
        'bob-flexibility': block.flexibility,
        'bob-rationale': block.rationale || '',
        'bob-deeplink': eventDeepLink || '',
        'bob-ai-score': aiScoreVal2 ?? '',
        'bob-ai-reason': aiReasonVal2 || '',
        'bob-placement': block.placementReason || block.rationale || '',
        'bob-linked-task-refs': linkedTaskRefs.length ? linkedTaskRefs.slice(0, MAX_PRIVATE_TASK_REFS).join(',') : null,
        'bob-linked-task-count': linkedTaskRefs.length ? linkedTaskRefs.length : null,
      });
      const eventSource = isValidUrl(eventDeepLink) ? { title: 'BOB', url: eventDeepLink } : undefined;
      const updateEvent = {
        summary: summaryText,
        description: enrichedDesc2 || 'BOB calendar block',
        start: { dateTime: new Date(startMs).toISOString(), timeZone: 'UTC' },
        end: { dateTime: new Date(endMs).toISOString(), timeZone: 'UTC' },
        colorId: block.theme_id ? getGoogleColorForThemeId(block.theme_id, themes) : getColorForTheme(themeLabel),
        source: eventSource,
        extendedProperties: Object.keys(privateProps).length ? { private: privateProps } : undefined
      };
      const updateResponse = await calendar.events.update({ calendarId: 'primary', eventId: block.googleEventId, resource: updateEvent });
      const updatePayload = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (updateResponse?.data?.htmlLink) updatePayload.externalLink = updateResponse.data.htmlLink;
      await admin.firestore().collection('calendar_blocks').doc(blockId).update(updatePayload);
      eventId = block.googleEventId;
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: action,
        status: 'success',
        blockId,
        blockTitle: block?.title || null,
        storyId: block.storyId || null,
        taskId: block.taskId || null,
        eventId,
      });
      return { success: true, eventId };
    }
    else if (action === 'delete') {
      // For delete, blockData must be provided or we can't get googleEventId if doc is gone
      eventId = block?.googleEventId || null;
      if (eventId) {
        try {
          await calendar.events.delete({ calendarId: 'primary', eventId });
        } catch (e) {
          console.warn('GCal delete failed (might be already deleted)', e.message);
        }
      }
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: action,
        status: 'success',
        blockId,
        blockTitle: block?.title || null,
        storyId: block?.storyId || null,
        taskId: block?.taskId || null,
        eventId,
      });
      return { success: true };
    }
    return { success: false };
  } catch (err) {
    const errorPayload = err?.response?.data || err?.errors || null;
    const errorDetail = err?.errors?.[0]?.message
      || err?.response?.data?.error?.message
      || (typeof err?.response?.data === 'string' ? err.response.data : null)
      || err?.message
      || String(err);
    const rawBody = err?.response?.data || null;
    const rawStatus = err?.response?.status || null;
    let rawText = null;
    try {
      if (err?.response?.data) rawText = JSON.stringify(err.response.data);
      else if (typeof err?.response?.text === 'function') rawText = await err.response.text();
    } catch (_) { /* ignore */ }
    await logCalendarIntegration(uid, {
      action: 'push',
      direction: action,
      status: 'error',
      blockId,
      blockTitle: block?.title || null,
      storyId: block?.storyId || null,
      taskId: block?.taskId || null,
      eventId,
      error: errorDetail,
      errorPayload,
      errorContext,
      rawStatus,
      rawBody,
      rawText,
      debug: debugLogs,
    });
    throw err;
  }
}

exports._syncBlockToGoogle = syncBlockToGoogle;

exports.syncCalendarBlock = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  const { blockId, action } = data;
  const uid = context.auth.uid;
  try {
    // For delete via onCall, we fetch the block first to get googleEventId
    let blockData = null;
    if (action === 'delete') {
      const snap = await admin.firestore().collection('calendar_blocks').doc(blockId).get();
      if (snap.exists) blockData = snap.data();
    }
    const result = await syncBlockToGoogle(blockId, action, uid, blockData);

    // If delete action via onCall, we also update the block status in Firestore
    if (action === 'delete') {
      await admin.firestore().collection('calendar_blocks').doc(blockId).update({
        status: 'superseded',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    return result;
  } catch (error) {
    console.error('Error syncing calendar block:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed to sync calendar block');
  }
});

// Trigger to auto-sync changes to Google Calendar
exports.onCalendarBlockWrite = functions.firestore.document('calendar_blocks/{blockId}').onWrite(async (change, context) => {
  const blockId = context.params.blockId;
  const before = change.before.exists ? change.before.data() : null;
  const after = change.after.exists ? change.after.data() : null;

  if (!after) {
    // Delete
    if (before && before.googleEventId) {
      // Never delete Google events we didn't originate (imported busy blocks etc)
      const source = String(before.source || before.entry_method || '').toLowerCase();
      const isExternal = source === 'gcal' || source === 'google_calendar';
      if (isExternal) {
      await logCalendarIntegration(before.ownerUid, {
        action: 'push',
        direction: 'delete',
        status: 'skipped',
        blockId,
        blockTitle: before.title || null,
        eventId: before.googleEventId,
        reason: 'skip_delete_external_gcal_block',
      });
      return;
    }
      await syncBlockToGoogle(blockId, 'delete', before.ownerUid, before);
    }
    return;
  }

  const uid = after.ownerUid;
  if (!uid) return;

  // Create
  if (!before) {
    // If created with googleEventId, it's likely from syncFromGoogleCalendar, so skip
    if (after.googleEventId) return;
    await syncBlockToGoogle(blockId, 'create', uid, after);
    return;
  }

  // Update
  // Check if relevant fields changed
  const relevantFields = [
    'start',
    'end',
    'title',
    'category',
    'theme',
    'theme_id',
    'rationale',
    'storyId',
    'storyRef',
    'taskId',
    'taskRef',
    'deepLink',
    'aiScore',
    'aiCriticalityScore',
    'aiReason',
    'aiCriticalityReason',
    'placementReason',
  ];
  const hasChanges = relevantFields.some(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));

  // If googleEventId changed, it's a sync update, skip
  if (before.googleEventId !== after.googleEventId) return;

  if (hasChanges) {
    if (after.googleEventId) {
      await syncBlockToGoogle(blockId, 'update', uid, after);
    } else {
      // If it doesn't have googleEventId yet, treat as create
      await syncBlockToGoogle(blockId, 'create', uid, after);
    }
  }
});

async function pullGoogleEventsForUser(uid, { windowStart, windowEnd }) {
  const db = admin.firestore();
  const timeMin = windowStart.toISOString();
  const timeMax = windowEnd.toISOString();
  await logCalendarIntegration(uid, { action: 'pull', status: 'started', windowStart: timeMin, windowEnd: timeMax });

  try {
    const { calendar } = await getCalendarClientForUser(uid);
    const events = await listAllEvents(calendar, { timeMin, timeMax });
    const ownedByEventId = new Map();
    const windowStartMs = windowStart.getTime();
    const windowEndMs = windowEnd.getTime();
    const ownedSnap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', uid)
      .where('start', '>=', windowStartMs)
      .where('start', '<=', windowEndMs)
      .get()
      .catch(() => ({ docs: [] }));
    ownedSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const eventId = data.googleEventId;
      if (!eventId) return;
      const source = String(data.source || data.entry_method || '').toLowerCase();
      if (source === 'gcal' || source === 'google_calendar') return;
      ownedByEventId.set(eventId, { id: doc.id, data });
    });
    const syncResults = [];
    const counts = { processed: events.length, created: 0, updated: 0, deleted: 0, skipped: 0 };

    for (const event of events) {
      try {
        const priv = event.extendedProperties?.private || {};
        const bobBlockId = priv['bob-block-id'] || priv['bobBlockId'] || null;
        const startMs = parseEventTime(event.start);
        const endMs = parseEventTime(event.end);
        if (!startMs || !endMs) {
          counts.skipped += 1;
          continue;
        }
        const calendarId = event.organizer?.email || event.creator?.email || 'primary';
        const updatedMs = toMillis(event.updated || event.created || Date.now());

        if (bobBlockId) {
          const ref = db.collection('calendar_blocks').doc(bobBlockId);
          const snap = await ref.get();
          if (snap.exists) {
            const data = snap.data() || {};
            const blockUpdated = toMillis(data.updatedAt || data.serverUpdatedAt);
            const needsUpdate = updatedMs > blockUpdated + 500
              || data.start !== startMs
              || data.end !== endMs
              || data.googleEventId !== event.id
              || (!data.rationale && !!event.description);
            if (needsUpdate) {
              await ref.set({
                start: startMs,
                end: endMs,
                googleEventId: event.id,
                calendarId,
                rationale: event.description || data.rationale || '',
                status: data.status || 'synced',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
              counts.updated += 1;
              syncResults.push({ blockId: bobBlockId, action: 'updated_from_gcal' });
            } else {
              counts.skipped += 1;
            }
          } else {
            // Block deleted locally; do NOT delete user Google events. Record and skip.
            counts.skipped += 1;
            syncResults.push({ eventId: event.id, action: 'orphan_event_preserved' });
            await logCalendarIntegration(uid, {
              action: 'pull',
              status: 'skipped',
              eventId: event.id,
              blockId: bobBlockId,
              message: 'Orphaned Google event preserved (no matching block)',
            });
          }
          continue;
        }

        const owned = ownedByEventId.get(event.id);
        if (owned) {
          const ref = db.collection('calendar_blocks').doc(owned.id);
          const data = owned.data || {};
          const blockUpdated = toMillis(data.updatedAt || data.serverUpdatedAt);
          const needsUpdate = updatedMs > blockUpdated + 500
            || data.start !== startMs
            || data.end !== endMs
            || data.googleEventId !== event.id
            || (!data.rationale && !!event.description);
          if (needsUpdate) {
            await ref.set({
              start: startMs,
              end: endMs,
              googleEventId: event.id,
              calendarId,
              rationale: event.description || data.rationale || '',
              status: data.status || 'synced',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            counts.updated += 1;
            syncResults.push({ blockId: owned.id, action: 'linked_existing_block' });
          } else {
            counts.skipped += 1;
          }
          continue;
        }

        // External Google event -> mirror into calendar_blocks to support busy windows
        const blockId = `gcal_${uid}_${event.id}`;
        const ref = db.collection('calendar_blocks').doc(blockId);
        const snap = await ref.get();
        const payload = {
          ownerUid: uid,
          title: event.summary || 'Calendar event',
          start: startMs,
          end: endMs,
          googleEventId: event.id,
          calendarId,
          source: 'gcal',
          entry_method: 'google_calendar',
          status: 'imported',
          persona: priv['bob-persona'] || 'personal',
          theme: priv['bob-theme'] || null,
          theme_id: priv['bob-theme-id'] || null,
          storyId: priv['bob-story-id'] || null,
          taskId: priv['bob-task-id'] || null,
          rationale: event.description || null,
          location: event.location || null,
          allDay: !!event.start?.date,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (!snap.exists) {
          await ref.set({ ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          counts.created += 1;
        } else {
          const existing = snap.data() || {};
          const unchanged = existing.start === startMs
            && existing.end === endMs
            && existing.title === payload.title
            && existing.googleEventId === payload.googleEventId
            && (existing.rationale || null) === (payload.rationale || null);
          if (unchanged) {
            counts.skipped += 1;
          } else {
            await ref.set(payload, { merge: true });
            counts.updated += 1;
          }
        }
      } catch (err) {
        console.warn('[calendarSync] failed to process event', err?.message || err);
        counts.skipped += 1;
      }
    }

    if (syncResults.length > 0) {
      try {
        const { planSchedule } = require('./scheduler/engine');
        const today = new Date();
        const ws = new Date(today);
        const we = new Date(today);
        we.setDate(today.getDate() + 7);
        await planSchedule({
          db,
          userId: uid,
          windowStart: ws,
          windowEnd: we,
          busy: [],
        });
      } catch (err) {
        console.warn('[calendarSync] replan after pull failed', err?.message || err);
      }
    }

    await logCalendarIntegration(uid, { action: 'pull', status: 'success', windowStart: timeMin, windowEnd: timeMax, counts, syncResults });
    return { counts, syncResults };
  } catch (error) {
    await logCalendarIntegration(uid, { action: 'pull', status: 'error', windowStart: timeMin, windowEnd: timeMax, error: error?.message || String(error) });
    throw error;
  }
}

async function runLightCalendarReplan(uid, options = {}) {
  const days = Math.max(1, Math.min(Number(options.days || 7), 14));
  let replanFn = null;
  try {
    const orchestration = require('./nightlyOrchestration');
    replanFn = orchestration?._replanExistingBlocksForUser;
  } catch (err) {
    console.warn('[calendarSync] failed to load replan helper', err?.message || err);
    return null;
  }
  if (typeof replanFn !== 'function') return null;

  const db = admin.firestore();
  const profileSnap = await db.collection('profiles').doc(uid).get().catch(() => null);
  const profile = profileSnap && profileSnap.exists ? (profileSnap.data() || {}) : {};
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + days);
  windowEnd.setHours(23, 59, 59, 999);

  let themeAllocations = [];
  try {
    const allocDoc = await db.collection('theme_allocations').doc(uid).get();
    if (allocDoc.exists) themeAllocations = allocDoc.data()?.allocations || [];
  } catch { /* ignore */ }

  const blocksSnap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', windowStart.getTime())
    .where('start', '<=', windowEnd.getTime())
    .get()
    .catch(() => ({ docs: [] }));
  const existingBlocks = blocksSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  try {
    const result = await replanFn({
      db,
      userId: uid,
      profile,
      windowStart,
      windowEnd,
      themeAllocations,
      existingBlocks,
      reason: options.reason || `calendar_pull_${options.trigger || 'sync'}`,
      days,
    });
    await logCalendarIntegration(uid, {
      action: 'replan',
      status: 'success',
      trigger: options.trigger || 'sync',
      counts: {
        rescheduled: result?.rescheduled || 0,
        blocked: result?.blocked || 0,
        totalMovable: result?.totalMovable || 0,
      },
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });
    return result;
  } catch (err) {
    console.warn('[calendarSync] replan after pull failed', err?.message || err);
    await logCalendarIntegration(uid, {
      action: 'replan',
      status: 'error',
      trigger: options.trigger || 'sync',
      error: err?.message || String(err),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });
    return null;
  }
}

async function pushPendingBlocks(uid, limit = 30) {
  // Primary fetch: explicit null googleEventId
  const snap = await admin.firestore()
    .collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('googleEventId', '==', null)
    .limit(limit)
    .get();

  // Fallback: capture docs missing googleEventId (field not set) by filtering client-side
  let docs = [...snap.docs];
  if (docs.length < limit) {
    const fallback = await admin.firestore()
      .collection('calendar_blocks')
      .where('ownerUid', '==', uid)
      .where('aiGenerated', '==', true)
      .limit(limit)
      .get()
      .catch(() => ({ docs: [] }));
    const seen = new Set(docs.map((d) => d.id));
    fallback.docs.forEach((d) => {
      const data = d.data() || {};
      if (seen.has(d.id)) return;
      if (data.googleEventId) return;
      docs.push(d);
      seen.add(d.id);
    });
  }

  let pushed = 0;
  let errors = 0;
  let skipped = 0;
  const pushWindowStart = Date.now() - (GCAL_PAST_DAYS * MS_IN_DAY);
  const activeSprintId = await getActiveSprintId(uid);
  const candidates = docs.slice(0, limit);
  await logCalendarIntegration(uid, {
    action: 'push',
    direction: 'scan',
    status: 'started',
    counts: { primary: snap.size, fallback: docs.length, limit },
    sample: candidates.slice(0, 5).map((d) => {
      const data = d.data() || {};
      return { id: d.id, title: data.title || data.category || null, status: data.status || null };
    }),
  });
  if (candidates.length === 0) {
    await logCalendarIntegration(uid, {
      action: 'push',
      direction: 'scan',
      status: 'completed',
      counts: { totalPending: 0, pushed: 0, skipped: 0, errors: 0 },
    });
    return { pushed: 0, errors: 0, skipped: 0, totalPending: 0 };
  }

  for (const doc of candidates) {
    const data = doc.data() || {};
    if (data.source === 'gcal') continue;
    const start = toMillis(data.start);
    const end = toMillis(data.end);
    const invalidTime = !start || !end || start >= end;
    if (invalidTime) {
      skipped += 1;
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: 'skip',
        status: 'skipped',
        blockId: doc.id,
        blockTitle: data.title || null,
        reason: 'invalid_time_window',
        start,
        end,
      });
      continue;
    }
    const status = String(data.status || '').toLowerCase();
    const allowedStatuses = new Set(['planned', 'applied', 'confirmed', 'synced']);
    if (status && !allowedStatuses.has(status)) {
      skipped += 1;
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: 'skip',
        status: 'skipped',
        blockId: doc.id,
        blockTitle: data.title || null,
        reason: 'status_not_planned',
        statusValue: status,
      });
      continue;
    }
    const isRoutine = ALLOWED_ROUTINE_TYPES.has(String(data.entityType || '').toLowerCase());
    if (!isRoutine && data.sprintId && activeSprintId && data.sprintId !== activeSprintId) {
      skipped += 1;
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: 'skip',
        status: 'skipped',
        blockId: doc.id,
        blockTitle: data.title || null,
        reason: 'out_of_active_sprint',
        sprintId: data.sprintId,
        activeSprintId,
      });
      continue;
    }
    if (start < pushWindowStart) {
      skipped += 1;
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: 'skip',
        status: 'skipped',
        blockId: doc.id,
        blockTitle: data.title || null,
        reason: 'out_of_window',
        start,
        end,
      });
      continue;
    }
    try {
      await syncBlockToGoogle(doc.id, 'create', uid, data);
      pushed += 1;
    } catch (err) {
      errors += 1;
      console.warn('[calendarSync] pushPendingBlocks failed', err?.message || err);
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: 'create',
        status: 'error',
        blockId: doc.id,
        blockTitle: data.title || null,
        error: err?.message || String(err),
        errorPayload: err?.response?.data || err?.errors || null,
        rawStatus: err?.response?.status || null,
        rawBody: err?.response?.data || null,
        start: start,
        end: end,
        statusValue: status,
        persona: data.persona || null,
        theme: data.theme || data.theme_id || null,
      });
    }
  }
  await logCalendarIntegration(uid, {
    action: 'push',
    direction: 'scan',
    status: 'completed',
    counts: { totalPending: candidates.length, pushed, skipped, errors },
  });
  return { pushed, errors, skipped, totalPending: candidates.length };
}

async function syncUserCalendar(uid, options = {}) {
  const windowStart = options.windowStart || new Date(Date.now() - GCAL_PAST_DAYS * MS_IN_DAY);
  const windowEnd = options.windowEnd || new Date(Date.now() + GCAL_FUTURE_DAYS * MS_IN_DAY);
  const pull = await pullGoogleEventsForUser(uid, { windowStart, windowEnd });
  let push = { pushed: 0, errors: 0, totalPending: 0 };
  if (!options.skipPush) {
    push = await pushPendingBlocks(uid, options.pushLimit || 30);
    await logCalendarIntegration(uid, {
      action: 'push',
      status: 'completed',
      counts: push,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      source: options.trigger || 'sync',
    });
  }
  let replan = null;
  const shouldReplan = options.replanAlways || (pull?.syncResults?.length > 0);
  if (shouldReplan) {
    replan = await runLightCalendarReplan(uid, {
      trigger: options.trigger,
      reason: options.replanReason,
      days: options.replanDays || 7,
    });
  }
  return { pull, push, replan };
}

// Sync Google Calendar changes back to Firestore (pull-only)
exports.syncFromGoogleCalendar = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const uid = context.auth.uid;
  const windowStart = new Date(Date.now() - GCAL_PAST_DAYS * MS_IN_DAY);
  const windowEnd = new Date(Date.now() + GCAL_FUTURE_DAYS * MS_IN_DAY);

  try {
    const result = await pullGoogleEventsForUser(uid, { windowStart, windowEnd });
    return { success: true, ...result };
  } catch (error) {
    console.error('Error syncing from Google Calendar:', error);
    throw new functions.https.HttpsError('internal', 'Failed to sync from Google Calendar');
  }
});

// Manual "sync now" callable (push + pull)
exports.syncCalendarNow = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }
  const uid = context.auth.uid;
  const windowStart = new Date(Date.now() - GCAL_PAST_DAYS * MS_IN_DAY);
  const windowEnd = new Date(Date.now() + GCAL_FUTURE_DAYS * MS_IN_DAY);
  try {
    const result = await syncUserCalendar(uid, { windowStart, windowEnd, trigger: 'manual' });
    return { success: true, ...result };
  } catch (error) {
    console.error('Error in syncCalendarNow:', error);
    await logCalendarIntegration(uid, {
      action: 'sync_now',
      status: 'error',
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      error: error?.message || String(error),
    });
    throw new functions.https.HttpsError('internal', error.message || 'Failed to sync calendar');
  }
});

// Diagnostic: attempt a single minimal insert for a given blockId (for troubleshooting Google errors)
exports.syncCalendarTestInsert = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  const { blockId } = data;
  const uid = context.auth.uid;
  try {
    const { calendar } = await getCalendarClientForUser(uid);
    const snap = await admin.firestore().collection('calendar_blocks').doc(blockId).get();
    if (!snap.exists) throw new Error('Block not found');
    const block = snap.data();
    const startMs = toMillis(block.start);
    const endMs = toMillis(block.end);
    const minimalEvent = {
      summary: block.title || block.category || 'BOB Block',
      start: { dateTime: new Date(startMs).toISOString(), timeZone: 'UTC' },
      end: { dateTime: new Date(endMs).toISOString(), timeZone: 'UTC' },
    };
    let insertResponse = null;
    try {
      insertResponse = await calendar.events.insert({ calendarId: 'primary', resource: minimalEvent });
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: 'test_insert',
        status: 'success',
        blockId,
        blockTitle: block.title || null,
        eventId: insertResponse.data.id,
      });
      return { success: true, eventId: insertResponse.data.id };
    } catch (err) {
      const rawBody = err?.response?.data || null;
      const rawStatus = err?.response?.status || null;
      let rawText = null;
      try {
        if (err?.response?.data) rawText = JSON.stringify(err.response.data);
        else if (typeof err?.response?.text === 'function') rawText = await err.response.text();
      } catch (_) { /* ignore */ }
      await logCalendarIntegration(uid, {
        action: 'push',
        direction: 'test_insert',
        status: 'error',
        blockId,
        blockTitle: block.title || null,
        error: err?.message || String(err),
        errorPayload: err?.response?.data || err?.errors || null,
        rawStatus,
        rawBody,
        rawText,
      });
      throw new functions.https.HttpsError('internal', 'Test insert failed');
    }
  } catch (error) {
    console.error('syncCalendarTestInsert failed', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed');
  }
});

// Helper function to get Google Calendar color for themes
function getColorForTheme(theme) {
  const colorMap = {
    'Health': '11', // Green
    'Growth': '9',  // Blue
    'Wealth': '5',  // Yellow
    'Tribe': '3',   // Purple
    'Home': '6'     // Orange
  };
  return colorMap[theme] || '1'; // Default to blue
}

// Scheduled function to sync calendar blocks (runs every hour)
exports.scheduledCalendarSync = functions.pubsub.schedule('every 1 hours').onRun(async () => {
  console.log('Running scheduled calendar sync...');

  try {
    // Get all users who have Google Calendar connected
    const db = admin.firestore();
    const usersSnapshot = await db.collection('users')
      .where('googleCalendarTokens', '!=', null)
      .get();
    // Legacy tokens fallback
    const legacySnapshot = await db.collection('tokens')
      .where('googleCalendarTokens', '!=', null)
      .get()
      .catch(() => ({ docs: [] }));
    const legacyRefreshSnapshot = await db.collection('tokens')
      .where('refresh_token', '!=', null)
      .get()
      .catch(() => ({ docs: [] }));

    const uids = new Set();
    usersSnapshot.docs.forEach((doc) => uids.add(doc.id));
    legacySnapshot.docs.forEach((doc) => uids.add(doc.id));
    legacyRefreshSnapshot.docs.forEach((doc) => uids.add(doc.id));

    for (const uid of uids) {
      try {
        await syncUserCalendar(uid, { trigger: 'scheduled', replanAlways: true });
      } catch (err) {
        console.error(`[scheduledCalendarSync] failed for ${uid}`, err?.message || err);
        await logCalendarIntegration(uid, { action: 'scheduled_sync', status: 'error', error: err?.message || String(err) });
      }
    }

    console.log(`Completed scheduled sync for ${uids.size} users`);
  } catch (error) {
    console.error('Error in scheduled calendar sync:', error);
  }
});
