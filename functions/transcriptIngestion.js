const httpsV2 = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { google } = require('googleapis');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const { sendEmail } = require('./lib/email');
const { buildEntityUrl } = require('./utils/urlHelpers');
const { ensureTaskPoints, clampTaskPoints } = require('./utils/taskPoints');

const GOOGLE_AI_STUDIO_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');
const BREVO_API_KEY = defineSecret('BREVO_API_KEY');
const GOOGLE_OAUTH_CLIENT_ID = defineSecret('GOOGLE_OAUTH_CLIENT_ID');
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
const IOS_SHORTCUT_WEBHOOK_SECRET = defineSecret('IOS_SHORTCUT_WEBHOOK_SECRET');
const REMINDERS_WEBHOOK_SECRET = defineSecret('REMINDERS_WEBHOOK_SECRET');

const DEFAULT_TIMEZONE = 'Europe/London';
const TRANSCRIPT_MODEL = process.env.TRANSCRIPT_INGESTION_MODEL || 'gemini-1.5-pro';
const GOOGLE_REGION = 'europe-west2';

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeTranscriptForFingerprint(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeTimestampOutput(value) {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizePriority(value, fallback = 2) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(4, Math.round(value)));
  }
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['critical', 'p0', 'p1', 'urgent', 'highest', '4'].includes(raw)) return 4;
  if (['high', 'important', 'p2', '3'].includes(raw)) return 3;
  if (['medium', 'normal', 'p3', '2'].includes(raw)) return 2;
  if (['low', 'later', 'p4', '1'].includes(raw)) return 1;
  return fallback;
}

function normalizeTaskKind(value, title = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'read' || raw === 'watch') return raw;
  const titleRaw = String(title || '').trim().toLowerCase();
  if (titleRaw.startsWith('read ')) return 'read';
  if (titleRaw.startsWith('watch ')) return 'watch';
  return 'task';
}

function effortFromMinutes(minutes) {
  const total = Number(minutes || 0);
  if (!Number.isFinite(total) || total <= 0) return 'S';
  if (total <= 60) return 'S';
  if (total <= 120) return 'M';
  if (total <= 240) return 'L';
  return 'XL';
}

function clampEstimateMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(15, Math.min(8 * 60, Math.round(numeric)));
}

function buildStableDocId(kind, uid, fingerprint, index = null) {
  const ownerKey = sha256(uid).slice(0, 10);
  const base = `${kind}_${ownerKey}_${fingerprint.slice(0, 24)}`;
  if (index == null) return base;
  return `${base}_${String(index).padStart(2, '0')}`;
}

function buildStableRef(kind, docId) {
  const short = String(docId || '').slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padStart(6, '0');
  if (kind === 'story') return `ST-${short}`;
  if (kind === 'task') return `TK-${short}`;
  return `JR-${short}`;
}

function extractUrls(text, explicitUrl = null) {
  const found = new Set();
  const push = (candidate) => {
    const value = String(candidate || '').trim();
    if (!value) return;
    found.add(value);
  };
  push(explicitUrl);
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')]+/gi) || [];
  matches.forEach(push);
  return Array.from(found).slice(0, 5);
}

function parseGoogleDocId(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const slashMatch = raw.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (slashMatch) return slashMatch[1];
  try {
    const parsed = new URL(raw);
    return parsed.searchParams.get('id');
  } catch {
    return null;
  }
}

async function fetchUrlPreview(url) {
  const preview = {
    url,
    title: null,
    description: null,
  };
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'user-agent': 'BOB Transcript Intake/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return preview;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return preview;
    const html = await response.text();
    const $ = cheerio.load(html);
    preview.title = $('title').first().text().trim().slice(0, 200) || null;
    preview.description = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    ).trim().slice(0, 400) || null;
    return preview;
  } catch {
    return preview;
  }
}

async function fetchUrlPreviews(urls) {
  if (!Array.isArray(urls) || !urls.length) return [];
  return Promise.all(urls.slice(0, 3).map((url) => fetchUrlPreview(url)));
}

function buildDocSections(analysis, originalTranscript, timezone) {
  const zone = timezone || DEFAULT_TIMEZONE;
  const dateHeading = DateTime.now().setZone(zone).setLocale('en-US').toLocaleString(DateTime.DATE_FULL);
  const oneLineSummary = String(analysis?.oneLineSummary || '').trim() || 'Transcript summary';
  const structuredEntry = String(analysis?.structuredEntry || '').trim() || String(originalTranscript || '').trim();
  const advice = String(analysis?.advice || '').trim() || 'No additional advice generated.';
  const fullTranscript = String(originalTranscript || '').trim();
  return {
    dateHeading,
    oneLineSummary,
    structuredEntry,
    advice,
    fullTranscript,
  };
}

function serializeSections(sections) {
  return {
    dateHeading: sections?.dateHeading || null,
    oneLineSummary: sections?.oneLineSummary || null,
    structuredEntry: sections?.structuredEntry || null,
    advice: sections?.advice || null,
    fullTranscript: sections?.fullTranscript || null,
  };
}

function buildDocAppendPlan(sections) {
  const dateHeading = `${sections.dateHeading}\n`;
  const summaryHeading = `${sections.oneLineSummary}\n`;
  const structuredBody = `${sections.structuredEntry}\n\n`;
  const adviceHeading = 'Advice\n';
  const adviceBody = `${sections.advice}\n\n`;
  const transcriptHeading = 'Full transcript\n';
  const transcriptBody = `${sections.fullTranscript}\n\n`;
  const text = [
    dateHeading,
    summaryHeading,
    structuredBody,
    adviceHeading,
    adviceBody,
    transcriptHeading,
    transcriptBody,
  ].join('');

  let cursor = 0;
  const dateRange = { start: cursor, end: cursor + dateHeading.length };
  cursor += dateHeading.length;
  const summaryRange = { start: cursor, end: cursor + summaryHeading.length };
  cursor += summaryHeading.length + structuredBody.length;
  const adviceRange = { start: cursor, end: cursor + adviceHeading.length };
  cursor += adviceHeading.length + adviceBody.length;
  const transcriptRange = { start: cursor, end: cursor + transcriptHeading.length };

  return {
    text,
    dateRange,
    summaryRange,
    adviceRange,
    transcriptRange,
  };
}

async function callTranscriptModel({ transcript, persona, timezone, urlPreviews }) {
  const apiKey = String(process.env.GOOGLEAISTUDIOAPIKEY || '').trim();
  if (!apiKey) throw new Error('GOOGLEAISTUDIOAPIKEY not configured');

  const system = [
    'You process voice-note transcripts for a productivity app.',
    'Return STRICT JSON only with this shape:',
    '{',
    '  "oneLineSummary": string,',
    '  "structuredEntry": string,',
    '  "advice": string,',
    '  "stories": [{',
    '    "title": string,',
    '    "description": string,',
    '    "priority": number,',
    '    "points": number,',
    '    "acceptanceCriteria": string[],',
    '    "theme": string',
    '  }],',
    '  "tasks": [{',
    '    "title": string,',
    '    "description": string,',
    '    "priority": number,',
    '    "estimateMin": number,',
    '    "points": number,',
    '    "effort": "S"|"M"|"L"|"XL",',
    '    "kind": "task"|"read"|"watch",',
    '    "theme": string,',
    '    "storyTitle": string|null',
    '  }]',
    '}',
    'Rules:',
    [
      'Keep structuredEntry 99% faithful to the transcript.',
      'Fix punctuation, capitalization, and obvious dictation errors only.',
    ].join(' '),
    'Do not invent facts, commitments, or emotions that are not present.',
    'The oneLineSummary must be a single line under 140 characters.',
    'Advice must be concise, practical, and grounded only in the provided content.',
    'Never put tasks inside the journal text just because you extracted them.',
    'Extract only clearly actionable stories/tasks.',
    [
      'If a piece of work is bigger than about four hours or clearly multi-step,',
      'prefer returning a story instead of a task.',
    ].join(' '),
    [
      'Use kind="read" for books/articles/papers/docs to consume.',
      'Use kind="watch" for videos/shows/movies to consume.',
    ].join(' '),
    'Use storyTitle on a task only when that task clearly belongs to one of the returned stories.',
  ].join('\n');

  const user = [
    `Persona: ${persona || 'personal'}`,
    `Timezone: ${timezone || DEFAULT_TIMEZONE}`,
    urlPreviews?.length ? `Resolved URL previews:\n${JSON.stringify(urlPreviews, null, 2)}` : null,
    'Transcript:',
    transcript,
  ].filter(Boolean).join('\n\n');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: TRANSCRIPT_MODEL,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  const response = await model.generateContent(`${system}\n\n${user}`);
  const text = response?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response');
  return JSON.parse(text);
}

function sanitizeAcceptanceCriteria(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeAnalysis(raw, transcript) {
  const analysis = raw && typeof raw === 'object' ? raw : {};
  const oneLineSummary = String(analysis.oneLineSummary || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  const structuredEntry = String(analysis.structuredEntry || '').trim() || String(transcript || '').trim();
  const advice = String(analysis.advice || '').trim() || 'No additional advice generated.';

  const seenStories = new Set();
  const stories = (Array.isArray(analysis.stories) ? analysis.stories : [])
    .map((story) => ({
      title: String(story?.title || '').trim().slice(0, 140),
      description: String(story?.description || '').trim().slice(0, 2000),
      priority: normalizePriority(story?.priority, 2),
      points: clampTaskPoints(story?.points) ?? 2,
      acceptanceCriteria: sanitizeAcceptanceCriteria(story?.acceptanceCriteria),
      theme: String(story?.theme || '').trim() || 'Growth',
    }))
    .filter((story) => {
      const key = normalizeTitle(story.title);
      if (!key || seenStories.has(key)) return false;
      seenStories.add(key);
      return true;
    })
    .slice(0, 8);

  const seenTasks = new Set();
  const tasks = (Array.isArray(analysis.tasks) ? analysis.tasks : [])
    .map((task) => {
      const title = String(task?.title || '').trim().slice(0, 140);
      const storyTitle = task?.storyTitle == null ? null : String(task.storyTitle || '').trim().slice(0, 140);
      const estimateMin = clampEstimateMinutes(task?.estimateMin);
      const points = clampTaskPoints(task?.points);
      return {
        title,
        description: String(task?.description || '').trim().slice(0, 2000),
        priority: normalizePriority(task?.priority, 2),
        estimateMin: estimateMin || (points ? Math.round(points * 60) : 60),
        points,
        effort: String(task?.effort || '').trim().toUpperCase() || null,
        kind: normalizeTaskKind(task?.kind, title),
        theme: String(task?.theme || '').trim() || 'Growth',
        storyTitle: storyTitle || null,
      };
    })
    .filter((task) => {
      const key = `${normalizeTitle(task.title)}::${normalizeTitle(task.storyTitle || '')}`;
      if (!normalizeTitle(task.title) || seenTasks.has(key)) return false;
      seenTasks.add(key);
      return true;
    })
    .slice(0, 16);

  return {
    oneLineSummary: oneLineSummary || 'Transcript summary',
    structuredEntry,
    advice,
    stories,
    tasks,
  };
}

function estimateSize(entry) {
  if (entry?.entityType === 'story') {
    const points = clampTaskPoints(entry.points) ?? 2;
    return { ...entry, points };
  }
  const estimateMin = clampEstimateMinutes(entry?.estimateMin) || 60;
  const withPoints = ensureTaskPoints({
    ...entry,
    estimateMin,
    estimated_duration: estimateMin,
    effort: entry?.effort || effortFromMinutes(estimateMin),
  });
  return {
    ...withPoints,
    estimateMin,
    effort: withPoints.effort || effortFromMinutes(estimateMin),
    estimatedHours: Number((estimateMin / 60).toFixed(2)),
  };
}

function prioritizeTask(entry) {
  const priority = normalizePriority(entry?.priority, 2);
  const aiPriorityBucket = priority >= 4 ? 'TODAY' : priority >= 3 ? 'NEXT' : 'LATER';
  return {
    ...entry,
    priority,
    aiPriorityBucket,
    aiPriorityLabel: aiPriorityBucket,
  };
}

function computeUpcomingSaturdayMs(timezone) {
  const now = DateTime.now().setZone(timezone || DEFAULT_TIMEZONE).startOf('day');
  let daysUntil = (6 - now.weekday + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  return now.plus({ days: daysUntil }).endOf('day').toMillis();
}

function buildStoryRecords({ uid, persona, fingerprint, analysis }) {
  const createdAtOrder = Date.now();
  return analysis.stories.map((story, index) => {
    const id = buildStableDocId('story', uid, fingerprint, index);
    const ref = buildStableRef('story', id);
    const sized = estimateSize({
      ...(analysis.stories[index] || {}),
      ...(story || {}),
      entityType: 'story',
      points: clampTaskPoints(story.points) ?? 2,
    });
    const prioritized = prioritizeTask(sized);
    const payload = {
      id,
      ref,
      ownerUid: uid,
      persona,
      goalId: '',
      title: story.title,
      description: story.description || 'Captured from transcript intake',
      status: 0,
      priority: prioritized.priority,
      points: clampTaskPoints(prioritized.points) ?? 2,
      wipLimit: 10,
      tags: [],
      sprintId: null,
      orderIndex: createdAtOrder + index,
      acceptanceCriteria: story.acceptanceCriteria,
      theme: story.theme || 'Growth',
      entry_method: 'ai_transcript_ingestion',
      aiIngestionFingerprint: fingerprint,
      aiPriorityBucket: prioritized.aiPriorityBucket,
      aiPriorityLabel: prioritized.aiPriorityLabel,
      deepLink: buildEntityUrl('story', id, ref),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    return {
      id,
      ref,
      title: story.title,
      deepLink: payload.deepLink,
      payload,
    };
  });
}

async function buildTaskRecords({
  uid,
  persona,
  fingerprint,
  analysis,
  timezone,
  storyMap,
}) {
  const saturdayDueMs = computeUpcomingSaturdayMs(timezone);
  const records = [];
  for (let index = 0; index < analysis.tasks.length; index++) {
    const task = analysis.tasks[index];
    const id = buildStableDocId('task', uid, fingerprint, index);
    const ref = buildStableRef('task', id);
    const linkedStory = task.storyTitle ? storyMap.get(normalizeTitle(task.storyTitle)) || null : null;
    const sized = estimateSize({
      entityType: 'task',
      title: task.title,
      description: task.description,
      priority: task.priority,
      estimateMin: task.estimateMin,
      points: task.points,
      effort: task.effort || effortFromMinutes(task.estimateMin),
      theme: task.theme,
      kind: task.kind,
    });
    const prioritized = prioritizeTask(sized);
    const dueDate = prioritized.kind === 'read' || prioritized.kind === 'watch' ? saturdayDueMs : null;
    const payload = ensureTaskPoints({
      id,
      ref,
      ownerUid: uid,
      persona,
      parentType: 'story',
      parentId: linkedStory?.id || '',
      title: task.title,
      description: task.description || 'Captured from transcript intake',
      status: 0,
      priority: prioritized.priority,
      effort: prioritized.effort || effortFromMinutes(prioritized.estimateMin),
      estimateMin: prioritized.estimateMin,
      estimatedHours: prioritized.estimatedHours,
      dueDate,
      dueDateMs: dueDate,
      dueDateReason: dueDate ? 'upcoming_saturday_read_watch' : null,
      labels: [],
      blockedBy: [],
      dependsOn: [],
      checklist: [],
      attachments: [],
      alignedToGoal: false,
      theme: prioritized.theme || linkedStory?.payload?.theme || 'Growth',
      source: 'ai',
      sourceRef: fingerprint,
      aiLinkConfidence: 0,
      hasGoal: false,
      syncState: 'dirty',
      serverUpdatedAt: Date.now(),
      createdBy: uid,
      storyId: linkedStory?.id || null,
      goalId: null,
      deleted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      tags: [],
      aiPriorityBucket: prioritized.aiPriorityBucket,
      aiPriorityLabel: prioritized.aiPriorityLabel,
      entry_method: 'ai_transcript_ingestion',
      type: prioritized.kind === 'task' ? 'task' : prioritized.kind,
      aiIngestionFingerprint: fingerprint,
      deepLink: buildEntityUrl('task', id, ref),
    });
    records.push({
      id,
      ref,
      title: task.title,
      deepLink: payload.deepLink,
      payload,
    });
  }
  return records;
}

function buildJournalRecord({
  uid,
  persona,
  fingerprint,
  docUrl,
  originalTranscript,
  sections,
  storyRecords,
  taskRecords,
  source,
  sourceUrls,
}) {
  const id = buildStableDocId('journal', uid, fingerprint);
  return {
    id,
    payload: {
      id,
      ownerUid: uid,
      persona,
      originalTranscript,
      dateHeading: sections.dateHeading,
      structuredEntry: sections.structuredEntry,
      oneLineSummary: sections.oneLineSummary,
      advice: sections.advice,
      docUrl,
      transcriptFingerprint: fingerprint,
      source: source || 'transcript',
      sourceUrls,
      storyIds: storyRecords.map((story) => story.id),
      taskIds: taskRecords.map((task) => task.id),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

async function resolveProfile(db, uid) {
  const [profileSnap, userSnap] = await Promise.all([
    db.collection('profiles').doc(uid).get().catch(() => null),
    db.collection('users').doc(uid).get().catch(() => null),
  ]);
  const profile = profileSnap?.exists ? (profileSnap.data() || {}) : {};
  const userData = userSnap?.exists ? (userSnap.data() || {}) : {};
  return { profile, userData };
}

async function resolveUserEmail(uid, profile, userData) {
  const candidates = [
    profile?.email,
    userData?.email,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  if (candidates.length) return candidates[0];
  try {
    const authUser = await admin.auth().getUser(uid);
    const email = String(authUser?.email || '').trim();
    return email || null;
  } catch {
    return null;
  }
}

function buildGoogleRedirectUri() {
  const projectId = process.env.GCLOUD_PROJECT;
  const explicit = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  if (!projectId) return null;
  return `https://${GOOGLE_REGION}-${projectId}.cloudfunctions.net/oauthCallback`;
}

async function getGoogleDocsClient(uid) {
  const db = admin.firestore();
  const tokenSnap = await db.collection('tokens').doc(uid).get();
  if (!tokenSnap.exists) {
    throw new httpsV2.HttpsError(
      'failed-precondition',
      'Google is not connected. Reconnect Google Calendar to grant Google Docs access.'
    );
  }
  const tokenData = tokenSnap.data() || {};
  const refreshToken = String(tokenData.refresh_token || '').trim();
  if (!refreshToken) {
    throw new httpsV2.HttpsError(
      'failed-precondition',
      'Google refresh token missing. Reconnect Google Calendar to grant Google Docs access.'
    );
  }

  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = buildGoogleRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth client configuration is incomplete');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.docs({ version: 'v1', auth });
}

async function appendJournalToGoogleDoc({ uid, docUrl, sections }) {
  const docId = parseGoogleDocId(docUrl);
  if (!docId) {
    throw new httpsV2.HttpsError('failed-precondition', 'The default journal Google Doc URL is invalid.');
  }
  const docs = await getGoogleDocsClient(uid);
  const document = await docs.documents.get({ documentId: docId });
  const bodyContent = document?.data?.body?.content || [];
  const insertAt = Math.max(1, Number(bodyContent[bodyContent.length - 1]?.endIndex || 1) - 1);
  const plan = buildDocAppendPlan(sections);

  try {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          { insertText: { location: { index: insertAt }, text: plan.text } },
          {
            updateParagraphStyle: {
              range: { startIndex: insertAt + plan.dateRange.start, endIndex: insertAt + plan.dateRange.end },
              paragraphStyle: { namedStyleType: 'HEADING_1' },
              fields: 'namedStyleType',
            },
          },
          {
            updateParagraphStyle: {
              range: { startIndex: insertAt + plan.summaryRange.start, endIndex: insertAt + plan.summaryRange.end },
              paragraphStyle: { namedStyleType: 'HEADING_2' },
              fields: 'namedStyleType',
            },
          },
          {
            updateParagraphStyle: {
              range: { startIndex: insertAt + plan.adviceRange.start, endIndex: insertAt + plan.adviceRange.end },
              paragraphStyle: { namedStyleType: 'HEADING_2' },
              fields: 'namedStyleType',
            },
          },
          {
            updateParagraphStyle: {
              range: {
                startIndex: insertAt + plan.transcriptRange.start,
                endIndex: insertAt + plan.transcriptRange.end,
              },
              paragraphStyle: { namedStyleType: 'HEADING_2' },
              fields: 'namedStyleType',
            },
          },
        ],
      },
    });
  } catch (error) {
    const status = Number(error?.code || error?.status || 0);
    if (status === 401 || status === 403) {
      throw new httpsV2.HttpsError(
        'failed-precondition',
        'Google Docs access is missing. Reconnect Google Calendar to grant Google Docs permissions.'
      );
    }
    throw error;
  }

  return {
    docId,
    docUrl,
  };
}

function buildEmailHtml({ sections, taskRecords, storyRecords, docUrl }) {
  const actionRows = [
    ...storyRecords.map(
      (story) => (
        `<li>Story: <a href="${escapeHtml(story.deepLink)}">${escapeHtml(story.ref)}</a>` +
        ` - ${escapeHtml(story.title)}</li>`
      )
    ),
    ...taskRecords.map(
      (task) => (
        `<li>Task: <a href="${escapeHtml(task.deepLink)}">${escapeHtml(task.ref)}</a>` +
        ` - ${escapeHtml(task.title)}</li>`
      )
    ),
  ].join('');

  return [
    [
      '<!DOCTYPE html><html><body style="font-family:-apple-system,',
      'BlinkMacSystemFont,Segoe UI,Arial,sans-serif;line-height:1.5;color:#111827;">',
    ].join(''),
    `<h1 style="font-size:24px;margin-bottom:8px;">${escapeHtml(sections.dateHeading)}</h1>`,
    `<h2 style="font-size:18px;margin:16px 0 8px;">${escapeHtml(sections.oneLineSummary)}</h2>`,
    `<div style="white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(sections.structuredEntry)}</div>`,
    '<h2 style="font-size:18px;margin:16px 0 8px;">Advice</h2>',
    `<div style="white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(sections.advice)}</div>`,
    '<h2 style="font-size:18px;margin:16px 0 8px;">Full transcript</h2>',
    `<div style="white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(sections.fullTranscript)}</div>`,
    '<h2 style="font-size:18px;margin:16px 0 8px;">Actionable items</h2>',
    actionRows ? `<ul>${actionRows}</ul>` : '<p>No tasks or stories were created.</p>',
    `<p style="margin-top:16px;">Google Doc: <a href="${escapeHtml(docUrl)}">${escapeHtml(docUrl)}</a></p>`,
    '</body></html>',
  ].join('');
}

async function reserveTranscriptIngestion(db, uid, fingerprint, transcriptPreview) {
  const ref = db.collection('transcript_ingestions').doc(`${uid}_${fingerprint}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() || {};
      const status = String(data.status || '').toLowerCase();
      if (status === 'processed' || status === 'processing') {
        tx.set(ref, {
          duplicateCount: admin.firestore.FieldValue.increment(1),
          lastDuplicateAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { duplicate: true, data };
      }
    }
    tx.set(ref, {
      id: ref.id,
      ownerUid: uid,
      fingerprint,
      transcriptPreview,
      status: 'processing',
      duplicateCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { duplicate: false, data: snap.exists ? (snap.data() || {}) : null };
  });
  return { ref, ...result };
}

function inferResultType(createdTasks, createdStories) {
  if (createdTasks.length && createdStories.length) return 'mixed';
  if (createdTasks.length) return 'tasks';
  if (createdStories.length) return 'stories';
  return 'journal';
}

function serializeTaskRecord(task) {
  const payload = task?.payload || {};
  const id = task?.id || payload.id || null;
  const ref = task?.ref || payload.ref || id || null;
  return {
    id,
    ref,
    title: task?.title || payload.title || '',
    description: payload.description || '',
    priority: payload.priority ?? null,
    estimateMin: payload.estimateMin ?? null,
    points: payload.points ?? null,
    effort: payload.effort || null,
    type: payload.type || null,
    dueDateMs: payload.dueDateMs ?? payload.dueDate ?? null,
    storyId: payload.storyId || null,
    deepLink: task?.deepLink || payload.deepLink || buildEntityUrl('task', id, ref),
  };
}

function serializeStoryRecord(story) {
  const payload = story?.payload || {};
  const id = story?.id || payload.id || null;
  const ref = story?.ref || payload.ref || id || null;
  return {
    id,
    ref,
    title: story?.title || payload.title || '',
    description: payload.description || '',
    priority: payload.priority ?? null,
    points: payload.points ?? null,
    acceptanceCriteria: Array.isArray(payload.acceptanceCriteria) ? payload.acceptanceCriteria : [],
    theme: payload.theme || null,
    deepLink: story?.deepLink || payload.deepLink || buildEntityUrl('story', id, ref),
  };
}

function buildTranscriptResponse({
  duplicate = false,
  message = null,
  fingerprint = null,
  journalId = null,
  docUrl = null,
  processedAt = null,
  sections = null,
  createdTasks = [],
  createdStories = [],
}) {
  const processedDocument = serializeSections(sections);
  const safeTasks = Array.isArray(createdTasks) ? createdTasks : [];
  const safeStories = Array.isArray(createdStories) ? createdStories : [];

  return {
    ok: true,
    duplicate,
    message,
    fingerprint,
    resultType: inferResultType(safeTasks, safeStories),
    journalId,
    docUrl,
    processedAt: normalizeTimestampOutput(processedAt),
    processedDocument,
    dateHeading: processedDocument.dateHeading,
    oneLineSummary: processedDocument.oneLineSummary,
    structuredEntry: processedDocument.structuredEntry,
    advice: processedDocument.advice,
    fullTranscript: processedDocument.fullTranscript,
    createdTasks: safeTasks,
    createdStories: safeStories,
  };
}

function buildDuplicateResponse(data) {
  const message = data?.status === 'processing'
    ? 'This transcript is already being processed.'
    : 'This transcript has already been processed.';

  return buildTranscriptResponse({
    duplicate: true,
    message,
    fingerprint: data?.fingerprint || null,
    journalId: data?.journalId || null,
    docUrl: data?.docUrl || null,
    processedAt: data?.processedAt || null,
    sections: data?.processedDocument || null,
    createdTasks: Array.isArray(data?.createdTasks) ? data.createdTasks : [],
    createdStories: Array.isArray(data?.createdStories) ? data.createdStories : [],
  });
}

async function loadEntitySummaries(db, collectionName, ids, type) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const snapshots = await Promise.all(
    ids.map((id) => db.collection(collectionName).doc(String(id)).get().catch(() => null))
  );
  return snapshots
    .filter((snap) => snap?.exists)
    .map((snap) => {
      const data = snap.data() || {};
      const id = snap.id;
      const ref = String(data.ref || id);
      const record = {
        id,
        ref,
        title: String(data.title || type),
        payload: {
          ...data,
          id,
          ref,
          deepLink: data.deepLink || buildEntityUrl(type, id, ref),
        },
      };
      return type === 'task' ? serializeTaskRecord(record) : serializeStoryRecord(record);
    });
}

async function hydrateDuplicateState(db, uid, fingerprint, data) {
  const base = data && typeof data === 'object' ? { ...data } : {};
  if (
    base.processedDocument &&
    Array.isArray(base.createdTasks) &&
    Array.isArray(base.createdStories)
  ) {
    return base;
  }

  const journalId = base.journalId || buildStableDocId('journal', uid, fingerprint);
  const snap = await db.collection('journals').doc(journalId).get().catch(() => null);
  if (!snap?.exists) {
    return {
      ...base,
      fingerprint,
      journalId: base.journalId || null,
      docUrl: base.docUrl || null,
      createdTasks: Array.isArray(base.createdTasks) ? base.createdTasks : [],
      createdStories: Array.isArray(base.createdStories) ? base.createdStories : [],
    };
  }

  const journal = snap.data() || {};
  const [createdStories, createdTasks] = await Promise.all([
    loadEntitySummaries(db, 'stories', journal.storyIds, 'story'),
    loadEntitySummaries(db, 'tasks', journal.taskIds, 'task'),
  ]);

  return {
    ...base,
    status: base.status || 'processed',
    fingerprint,
    journalId,
    docUrl: journal.docUrl || base.docUrl || null,
    processedAt: base.processedAt || journal.updatedAt || journal.createdAt || null,
    processedDocument: {
      dateHeading: journal.dateHeading || null,
      oneLineSummary: journal.oneLineSummary || null,
      structuredEntry: journal.structuredEntry || null,
      advice: journal.advice || null,
      fullTranscript: journal.originalTranscript || null,
    },
    createdTasks,
    createdStories,
  };
}

async function findExistingJournalDuplicate(db, uid, fingerprint) {
  const journalId = buildStableDocId('journal', uid, fingerprint);
  const snap = await db.collection('journals').doc(journalId).get();
  if (!snap.exists) return null;

  return hydrateDuplicateState(db, uid, fingerprint, {
    status: 'processed',
    journalId,
  });
}

async function logIngestionActivity({ uid, fingerprint, journalId, storyRecords, taskRecords }) {
  try {
    const ref = admin.firestore().collection('activity_stream').doc();
    await ref.set({
      id: ref.id,
      entityId: journalId,
      entityType: 'journal',
      activityType: 'transcript_ingestion',
      userId: uid,
      ownerUid: uid,
      description: `Processed transcript into ${storyRecords.length} stories and ${taskRecords.length} tasks`,
      metadata: {
        fingerprint,
        stories: storyRecords.map((story) => ({ id: story.id, ref: story.ref })),
        tasks: taskRecords.map((task) => ({ id: task.id, ref: task.ref })),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn('[transcriptIngestion] activity log failed', error?.message || error);
  }
}

async function processTranscriptIngestion({
  uid,
  transcript,
  persona,
  source,
  sourceUrl,
  sourceProvidedId,
}) {
  const db = admin.firestore();
  const normalizedTranscript = normalizeTranscriptForFingerprint(transcript);
  if (!normalizedTranscript) {
    throw new httpsV2.HttpsError('invalid-argument', 'Transcript text is required.');
  }

  const fingerprint = sha256(normalizedTranscript);
  const reservation = await reserveTranscriptIngestion(db, uid, fingerprint, normalizedTranscript.slice(0, 500));
  if (reservation.duplicate) {
    const duplicateState = await hydrateDuplicateState(db, uid, fingerprint, reservation.data);
    return buildDuplicateResponse(duplicateState);
  }

  const lockRef = reservation.ref;
  try {
    const existingJournal = await findExistingJournalDuplicate(db, uid, fingerprint);
    if (existingJournal) {
      await lockRef.set({
        status: 'processed',
        fingerprint,
        journalId: existingJournal.journalId,
        docUrl: existingJournal.docUrl,
        processedDocument: existingJournal.processedDocument || null,
        resultType: existingJournal.resultType || null,
        createdTasks: existingJournal.createdTasks,
        createdStories: existingJournal.createdStories,
        processedAt: existingJournal.processedAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return buildDuplicateResponse(existingJournal);
    }

    const { profile, userData } = await resolveProfile(db, uid);
    const email = await resolveUserEmail(uid, profile, userData);
    if (!email) {
      throw new httpsV2.HttpsError('failed-precondition', 'No email address is available for this user.');
    }

    const timezone = String(
      profile?.timezone ||
      profile?.timeZone ||
      profile?.settings?.timezone ||
      DEFAULT_TIMEZONE
    ).trim() || DEFAULT_TIMEZONE;
    const docUrl = String(profile?.defaultJournalDocUrl || '').trim();
    if (!docUrl) {
      throw new httpsV2.HttpsError(
        'failed-precondition',
        'Set a default journal Google Doc URL in Settings before ingesting transcripts.'
      );
    }

    // Fail fast if Google is not configured before any LLM or write work happens.
    await getGoogleDocsClient(uid);

    const sourceUrls = extractUrls(normalizedTranscript, sourceUrl);
    const existingLock = reservation.data || {};
    const urlPreviews = Array.isArray(existingLock.urlPreviews)
      ? existingLock.urlPreviews
      : await fetchUrlPreviews(sourceUrls);
    const rawAnalysis = existingLock.analysis || await callTranscriptModel({
      transcript: normalizedTranscript,
      persona: persona || 'personal',
      timezone,
      urlPreviews,
    });
    const analysis = sanitizeAnalysis(rawAnalysis, normalizedTranscript);

    await lockRef.set({
      status: 'processing',
      source: source || 'transcript',
      sourceProvidedId: sourceProvidedId || null,
      sourceUrls,
      urlPreviews,
      analysis,
      docUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const sections = buildDocSections(analysis, transcript, timezone);

    if (existingLock.docAppendStatus !== 'done') {
      await appendJournalToGoogleDoc({
        uid,
        docUrl,
        sections,
      });
      await lockRef.set({
        docAppendStatus: 'done',
        docAppendedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const storyRecords = buildStoryRecords({
      uid,
      persona: persona || 'personal',
      fingerprint,
      analysis,
    });
    const storyMap = new Map(storyRecords.map((story) => [normalizeTitle(story.title), story]));
    const taskRecords = await buildTaskRecords({
      uid,
      persona: persona || 'personal',
      fingerprint,
      analysis,
      timezone,
      storyMap,
    });
    const journalRecord = buildJournalRecord({
      uid,
      persona: persona || 'personal',
      fingerprint,
      docUrl,
      originalTranscript: transcript,
      sections,
      storyRecords,
      taskRecords,
      source,
      sourceUrls,
    });

    const batch = db.batch();
    batch.set(db.collection('journals').doc(journalRecord.id), journalRecord.payload, { merge: true });
    storyRecords.forEach((story) => {
      batch.set(db.collection('stories').doc(story.id), story.payload, { merge: true });
    });
    taskRecords.forEach((task) => {
      batch.set(db.collection('tasks').doc(task.id), task.payload, { merge: true });
    });
    await batch.commit();

    const emailHtml = buildEmailHtml({
      sections,
      taskRecords,
      storyRecords,
      docUrl,
    });

    if (!existingLock.emailSentAt) {
      await sendEmail({
        to: email,
        subject: `BOB Transcript Summary · ${sections.oneLineSummary}`,
        html: emailHtml,
      });
    }

    const createdTasks = taskRecords.map((task) => serializeTaskRecord(task));
    const createdStories = storyRecords.map((story) => serializeStoryRecord(story));
    const response = buildTranscriptResponse({
      duplicate: false,
      fingerprint,
      journalId: journalRecord.id,
      docUrl,
      processedAt: new Date(),
      sections,
      createdTasks,
      createdStories,
    });

    await lockRef.set({
      status: 'processed',
      fingerprint,
      journalId: journalRecord.id,
      docUrl,
      processedDocument: response.processedDocument,
      resultType: response.resultType,
      createdTasks: response.createdTasks,
      createdStories: response.createdStories,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await logIngestionActivity({
      uid,
      fingerprint,
      journalId: journalRecord.id,
      storyRecords,
      taskRecords,
    });

    return response;
  } catch (error) {
    await lockRef.set({
      status: 'failed',
      errorMessage: error?.message || String(error),
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => null);
    throw error;
  }
}

function mapHttpError(error, res) {
  const code = error?.code;
  if (code === 'unauthenticated') return res.status(401).json({ error: error.message });
  if (code === 'permission-denied') return res.status(403).json({ error: error.message });
  if (code === 'invalid-argument') return res.status(400).json({ error: error.message });
  if (code === 'failed-precondition') return res.status(412).json({ error: error.message });
  return res.status(500).json({ error: error?.message || 'Internal error' });
}

function resolveShortcutSecret() {
  return String(
    process.env.IOS_SHORTCUT_WEBHOOK_SECRET ||
    process.env.REMINDERS_WEBHOOK_SECRET ||
    ''
  ).trim();
}

async function resolveHttpCaller(req) {
  const authHeader = String(req.get('authorization') || req.get('Authorization') || '');
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) throw new httpsV2.HttpsError('unauthenticated', 'Missing bearer token.');
    const decoded = await admin.auth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      authMode: 'firebase',
    };
  }

  const configuredSecret = resolveShortcutSecret();
  const providedSecret = String(
    req.get('x-shortcut-secret') ||
    req.get('x-reminders-secret') ||
    req.body?.secret ||
    req.query?.secret ||
    ''
  ).trim();
  if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
    throw new httpsV2.HttpsError('unauthenticated', 'Missing or invalid shortcut secret.');
  }

  const uid = String(req.body?.uid || req.query?.uid || '').trim();
  if (!uid) throw new httpsV2.HttpsError('invalid-argument', 'uid is required when using the shortcut secret.');
  return {
    uid,
    authMode: 'shortcut_secret',
  };
}

exports.ingestTranscript = httpsV2.onCall({
  secrets: [
    GOOGLE_AI_STUDIO_API_KEY,
    BREVO_API_KEY,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
  ],
}, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  return processTranscriptIngestion({
    uid,
    transcript: String(req?.data?.transcript || ''),
    persona: String(req?.data?.persona || 'personal'),
    source: String(req?.data?.source || 'web_fab'),
    sourceUrl: String(req?.data?.sourceUrl || ''),
    sourceProvidedId: String(req?.data?.sourceProvidedId || ''),
  });
});

exports.ingestTranscriptHttp = httpsV2.onRequest({
  invoker: 'public',
  secrets: [
    GOOGLE_AI_STUDIO_API_KEY,
    BREVO_API_KEY,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    IOS_SHORTCUT_WEBHOOK_SECRET,
    REMINDERS_WEBHOOK_SECRET,
  ],
}, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-shortcut-secret, x-reminders-secret');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const caller = await resolveHttpCaller(req);
    const result = await processTranscriptIngestion({
      uid: caller.uid,
      transcript: String(req.body?.transcript || ''),
      persona: String(req.body?.persona || 'personal'),
      source: String(req.body?.source || 'ios_shortcut'),
      sourceUrl: String(req.body?.sourceUrl || ''),
      sourceProvidedId: String(req.body?.sourceProvidedId || ''),
    });
    res.status(200).json(result);
  } catch (error) {
    mapHttpError(error, res);
  }
});
