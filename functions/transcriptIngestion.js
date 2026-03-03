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
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
const GOOGLE_REGION = 'europe-west2';
const MAX_DIAGNOSTIC_TEXT = 500;

function summarizeForLog(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarizeForLog(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return value.length > MAX_DIAGNOSTIC_TEXT
      ? `${value.slice(0, MAX_DIAGNOSTIC_TEXT)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, entryValue]) => [key, summarizeForLog(entryValue, depth + 1)])
    );
  }
  return String(value);
}

function createIngestionLogger({ lockRef, uid, fingerprint, source, channel, authMode }) {
  const base = {
    uid,
    fingerprint,
    source: source || 'transcript',
    channel: channel || 'unknown',
    authMode: authMode || 'unknown',
    lockId: lockRef.id,
  };

  return {
    async event(stage, message, data = null, level = 'info') {
      const payload = {
        ...base,
        stage,
        level,
        message,
        data: summarizeForLog(data),
      };
      const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      printer('[transcriptIngestion]', JSON.stringify(payload));

      try {
        await Promise.all([
          lockRef.collection('events').doc().set({
            ...payload,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
          lockRef.set({
            diagnosticStage: stage,
            diagnosticLevel: level,
            diagnosticMessage: message,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true }),
        ]);
      } catch (error) {
        console.warn('[transcriptIngestion] diagnostic write failed', error?.message || error);
      }
    },
  };
}

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
    '  "entryType": "journal"|"task_list"|"url_only"|"mixed",',
    '  "shouldCreateJournal": boolean,',
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
    'Use entryType="journal" when this is primarily reflective narrative or a journal-style log with little or no actionable extraction.',
    'Use entryType="task_list" when this is primarily a to-do list or planning list and should NOT create a journal entry.',
    'Use entryType="url_only" when the input is just one or more URLs with little surrounding text and should NOT create a journal entry.',
    'Use entryType="mixed" when it is clearly a journal/reflection that also contains actionable tasks or stories.',
    'Set shouldCreateJournal=true only for entryType="journal" or entryType="mixed".',
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
    model: GEMINI_MODEL,
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

function stripUrlsForHeuristics(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s<>"')]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEntryType(rawType, transcript, sourceUrls, tasks, stories) {
  const type = String(rawType || '').trim().toLowerCase();
  if (type === 'journal' || type === 'task_list' || type === 'url_only' || type === 'mixed') {
    return type;
  }

  const stripped = stripUrlsForHeuristics(transcript);
  const wordCount = stripped ? stripped.split(/\s+/).length : 0;
  const likelyUrlOnly = Array.isArray(sourceUrls) && sourceUrls.length > 0 && wordCount <= 6;
  if (likelyUrlOnly) return 'url_only';
  if ((tasks?.length || stories?.length) && wordCount <= 50) return 'task_list';
  if ((tasks?.length || stories?.length) && wordCount > 50) return 'mixed';
  return 'journal';
}

function sanitizeAcceptanceCriteria(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeAnalysis(raw, transcript, sourceUrls = []) {
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

  const entryType = normalizeEntryType(analysis.entryType, transcript, sourceUrls, tasks, stories);
  const shouldCreateJournal = entryType === 'journal' || entryType === 'mixed';

  return {
    entryType,
    shouldCreateJournal,
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

function buildExistingEntityRecord(collectionName, doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ref: String(data.ref || doc.id),
    title: String(data.title || ''),
    deepLink: String(data.deepLink || buildEntityUrl(collectionName === 'stories' ? 'story' : 'task', doc.id, data.ref || doc.id)),
    payload: { id: doc.id, ...data },
    existing: true,
  };
}

async function findExistingEntityRecord(db, collectionName, uid, title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  const runQuery = async (field, value) => {
    try {
      const snapshot = await db.collection(collectionName)
        .where('ownerUid', '==', uid)
        .where(field, '==', value)
        .limit(10)
        .get();
      const doc = snapshot.docs.find((candidate) => candidate.data()?.deleted !== true) || null;
      return doc ? buildExistingEntityRecord(collectionName, doc) : null;
    } catch (error) {
      console.warn('[transcriptIngestion] existing entity lookup failed', collectionName, field, error?.message || error);
      return null;
    }
  };

  const byNormalized = await runQuery('normalizedTitle', normalized);
  if (byNormalized) return byNormalized;

  const byTitle = await runQuery('title', title);
  if (byTitle) return byTitle;

  const fallback = await db.collection(collectionName).where('ownerUid', '==', uid).limit(400).get().catch(() => null);
  const doc = fallback?.docs?.find((candidate) => {
    const data = candidate.data() || {};
    if (data.deleted === true) return false;
    return normalizeTitle(data.normalizedTitle || data.title || '') === normalized;
  }) || null;
  return doc ? buildExistingEntityRecord(collectionName, doc) : null;
}

async function buildStoryRecords({ db, uid, persona, fingerprint, analysis }) {
  const createdAtOrder = Date.now();
  const records = [];
  const existingStories = new Map();

  for (let index = 0; index < analysis.stories.length; index++) {
    const story = analysis.stories[index];
    const titleKey = normalizeTitle(story.title);
    if (titleKey && !existingStories.has(titleKey)) {
      existingStories.set(titleKey, await findExistingEntityRecord(db, 'stories', uid, story.title));
    }
    const existing = titleKey ? existingStories.get(titleKey) : null;
    if (existing) {
      records.push(existing);
      continue;
    }

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
      normalizedTitle: normalizeTitle(story.title),
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
    records.push({
      id,
      ref,
      title: story.title,
      deepLink: payload.deepLink,
      existing: false,
      payload,
    });
  }

  return records;
}

async function buildTaskRecords({
  db,
  uid,
  persona,
  fingerprint,
  analysis,
  timezone,
  storyMap,
}) {
  const saturdayDueMs = computeUpcomingSaturdayMs(timezone);
  const records = [];
  const existingTasks = new Map();
  for (let index = 0; index < analysis.tasks.length; index++) {
    const task = analysis.tasks[index];
    const titleKey = normalizeTitle(task.title);
    if (titleKey && !existingTasks.has(titleKey)) {
      existingTasks.set(titleKey, await findExistingEntityRecord(db, 'tasks', uid, task.title));
    }
    const existing = titleKey ? existingTasks.get(titleKey) : null;
    if (existing) {
      records.push(existing);
      continue;
    }

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
      normalizedTitle: normalizeTitle(task.title),
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
      existing: false,
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
  entryType,
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
      entryType: entryType || 'journal',
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
  try {
    const document = await docs.documents.get({ documentId: docId });
    const bodyContent = document?.data?.body?.content || [];
    const insertAt = Math.max(1, Number(bodyContent[bodyContent.length - 1]?.endIndex || 1) - 1);
    const plan = buildDocAppendPlan(sections);

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
        'Google Docs access is missing or missing the Docs scope. Reconnect Google Calendar to grant Google Docs permissions.'
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
    docUrl
      ? `<p style="margin-top:16px;">Google Doc: <a href="${escapeHtml(docUrl)}">${escapeHtml(docUrl)}</a></p>`
      : '',
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

function inferResultType(hasJournal, createdTasks, createdStories, entryType = null) {
  if (hasJournal && !createdTasks.length && !createdStories.length) return 'journal';
  if (hasJournal && (createdTasks.length || createdStories.length)) return 'mixed';
  if (createdTasks.length && createdStories.length) return 'mixed';
  if (createdTasks.length) return 'tasks';
  if (createdStories.length) return 'stories';
  if (entryType === 'journal') return 'journal';
  if (entryType === 'task_list' || entryType === 'url_only') return 'tasks';
  return hasJournal ? 'journal' : 'tasks';
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
    existing: Boolean(task?.existing),
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
    existing: Boolean(story?.existing),
  };
}

function buildTranscriptResponse({
  duplicate = false,
  message = null,
  fingerprint = null,
  ingestionId = null,
  hasJournal = false,
  entryType = null,
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
    ingestionId,
    fingerprint,
    entryType,
    hasJournal,
    resultType: inferResultType(hasJournal, safeTasks, safeStories, entryType),
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
    ingestionId: data?.id || null,
    fingerprint: data?.fingerprint || null,
    entryType: data?.entryType || null,
    hasJournal: Boolean(data?.journalId),
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
    entryType: base.entryType || ((createdTasks.length || createdStories.length) ? 'mixed' : 'journal'),
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

async function logIngestionActivity({ uid, fingerprint, journalId, storyRecords, taskRecords, entryType }) {
  try {
    const ref = admin.firestore().collection('activity_stream').doc();
    await ref.set({
      id: ref.id,
      entityId: journalId || fingerprint,
      entityType: journalId ? 'journal' : 'transcript_ingestion',
      activityType: 'transcript_ingestion',
      userId: uid,
      ownerUid: uid,
      description: `Processed ${entryType || 'transcript'} into ${storyRecords.length} stories and ${taskRecords.length} tasks`,
      metadata: {
        fingerprint,
        entryType: entryType || null,
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
  channel,
  authMode,
}) {
  const db = admin.firestore();
  const normalizedTranscript = normalizeTranscriptForFingerprint(transcript);
  if (!normalizedTranscript) {
    throw new httpsV2.HttpsError('invalid-argument', 'Transcript text is required.');
  }

  const fingerprint = sha256(normalizedTranscript);
  const reservation = await reserveTranscriptIngestion(db, uid, fingerprint, normalizedTranscript.slice(0, 500));
  const lockRef = reservation.ref;
  const logger = createIngestionLogger({
    lockRef,
    uid,
    fingerprint,
    source,
    channel,
    authMode,
  });

  if (reservation.duplicate) {
    await logger.event('duplicate_lock', 'Transcript already processing or processed', {
      priorStatus: reservation.data?.status || null,
    }, 'warn');
    const duplicateState = await hydrateDuplicateState(db, uid, fingerprint, reservation.data);
    return buildDuplicateResponse(duplicateState);
  }

  try {
    await logger.event('ingestion_start', 'Transcript ingestion started', {
      sourceProvidedId: sourceProvidedId || null,
      transcriptPreview: normalizedTranscript.slice(0, 280),
    });

    const existingJournal = await findExistingJournalDuplicate(db, uid, fingerprint);
    if (existingJournal) {
      await logger.event('duplicate_journal', 'Matched previously ingested journal duplicate', {
        journalId: existingJournal.journalId || null,
      });
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

    const sourceUrls = extractUrls(normalizedTranscript, sourceUrl);
    const existingLock = reservation.data || {};
    const urlPreviews = Array.isArray(existingLock.urlPreviews)
      ? existingLock.urlPreviews
      : await fetchUrlPreviews(sourceUrls);
    await logger.event('analysis_prepare', 'Prepared transcript analysis context', {
      urlCount: sourceUrls.length,
      previewCount: urlPreviews.length,
      timezone,
    });

    const rawAnalysis = existingLock.analysis || await callTranscriptModel({
      transcript: normalizedTranscript,
      persona: persona || 'personal',
      timezone,
      urlPreviews,
    });
    const analysis = sanitizeAnalysis(rawAnalysis, normalizedTranscript, sourceUrls);
    await logger.event('analysis_complete', 'Transcript classified and structured', {
      entryType: analysis.entryType,
      shouldCreateJournal: analysis.shouldCreateJournal,
      taskCount: analysis.tasks.length,
      storyCount: analysis.stories.length,
    });

    const docUrl = analysis.shouldCreateJournal
      ? String(profile?.defaultJournalDocUrl || '').trim()
      : null;
    if (analysis.shouldCreateJournal && !docUrl) {
      throw new httpsV2.HttpsError(
        'failed-precondition',
        'Set a default journal Google Doc URL in Settings before ingesting transcripts.'
      );
    }

    await lockRef.set({
      status: 'processing',
      source: source || 'transcript',
      sourceProvidedId: sourceProvidedId || null,
      sourceUrls,
      urlPreviews,
      analysis,
      entryType: analysis.entryType,
      shouldCreateJournal: analysis.shouldCreateJournal,
      docUrl: docUrl || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const sections = buildDocSections(analysis, transcript, timezone);

    if (analysis.shouldCreateJournal && existingLock.docAppendStatus !== 'done') {
      await logger.event('google_docs_append_start', 'Appending journal entry to Google Docs', {
        docUrl,
      });
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
      await logger.event('google_docs_append_done', 'Google Docs append completed', {
        docUrl,
      });
    }

    const storyRecords = await buildStoryRecords({
      db,
      uid,
      persona: persona || 'personal',
      fingerprint,
      analysis,
    });
    const storyMap = new Map(storyRecords.map((story) => [normalizeTitle(story.title), story]));
    const taskRecords = await buildTaskRecords({
      db,
      uid,
      persona: persona || 'personal',
      fingerprint,
      analysis,
      timezone,
      storyMap,
    });
    await logger.event('entity_resolution', 'Built task and story records', {
      stories: storyRecords.map((story) => ({ id: story.id, existing: Boolean(story.existing) })),
      tasks: taskRecords.map((task) => ({ id: task.id, existing: Boolean(task.existing) })),
    });

    const journalRecord = analysis.shouldCreateJournal
      ? buildJournalRecord({
        uid,
        persona: persona || 'personal',
        fingerprint,
        docUrl,
        entryType: analysis.entryType,
        originalTranscript: transcript,
        sections,
        storyRecords,
        taskRecords,
        source,
        sourceUrls,
      })
      : null;

    const batch = db.batch();
    if (journalRecord) {
      batch.set(db.collection('journals').doc(journalRecord.id), journalRecord.payload, { merge: true });
    }
    storyRecords.forEach((story) => {
      if (!story.existing) {
        batch.set(db.collection('stories').doc(story.id), story.payload, { merge: true });
      }
    });
    taskRecords.forEach((task) => {
      if (!task.existing) {
        batch.set(db.collection('tasks').doc(task.id), task.payload, { merge: true });
      }
    });
    await batch.commit();
    await logger.event('firestore_commit_done', 'Firestore entities committed', {
      journalId: journalRecord?.id || null,
      newStories: storyRecords.filter((story) => !story.existing).length,
      newTasks: taskRecords.filter((task) => !task.existing).length,
    });

    const emailHtml = buildEmailHtml({
      sections,
      taskRecords,
      storyRecords,
      docUrl: docUrl || null,
    });

    if (!existingLock.emailSentAt) {
      await sendEmail({
        to: email,
        subject: `BOB Transcript Summary · ${sections.oneLineSummary}`,
        html: emailHtml,
      });
      await logger.event('email_sent', 'Summary email sent', {
        recipient: email,
      });
    }

    const createdTasks = taskRecords.map((task) => serializeTaskRecord(task));
    const createdStories = storyRecords.map((story) => serializeStoryRecord(story));
    const response = buildTranscriptResponse({
      duplicate: false,
      ingestionId: lockRef.id,
      fingerprint,
      entryType: analysis.entryType,
      hasJournal: Boolean(journalRecord),
      journalId: journalRecord?.id || null,
      docUrl: docUrl || null,
      processedAt: new Date(),
      sections,
      createdTasks,
      createdStories,
    });

    await lockRef.set({
      status: 'processed',
      fingerprint,
      journalId: journalRecord?.id || null,
      docUrl: docUrl || null,
      entryType: analysis.entryType,
      hasJournal: Boolean(journalRecord),
      shouldCreateJournal: analysis.shouldCreateJournal,
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
      journalId: journalRecord?.id || null,
      storyRecords,
      taskRecords,
      entryType: analysis.entryType,
    });
    await logger.event('ingestion_complete', 'Transcript ingestion completed', {
      resultType: response.resultType,
      journalId: journalRecord?.id || null,
      taskCount: createdTasks.length,
      storyCount: createdStories.length,
    });

    return response;
  } catch (error) {
    await logger.event('ingestion_failed', 'Transcript ingestion failed', {
      code: error?.code || null,
      message: error?.message || String(error),
      stack: error?.stack || null,
    }, 'error');
    await lockRef.set({
      status: 'failed',
      errorCode: error?.code || 'internal',
      errorMessage: error?.message || String(error),
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => null);
    if (error instanceof httpsV2.HttpsError) {
      throw new httpsV2.HttpsError(
        error.code,
        error.message,
        {
          ...(error.details || {}),
          ingestionId: lockRef.id,
          fingerprint,
        }
      );
    }
    throw new httpsV2.HttpsError(
      'internal',
      `Transcript ingestion failed at ${lockRef.id}: ${error?.message || 'Unknown error'}`,
      {
        ingestionId: lockRef.id,
        fingerprint,
      }
    );
  }
}

function mapHttpError(error, res) {
  const code = error?.code;
  const payload = {
    error: error?.message || 'Internal error',
    details: error?.details || null,
  };
  if (code === 'unauthenticated') return res.status(401).json(payload);
  if (code === 'permission-denied') return res.status(403).json(payload);
  if (code === 'invalid-argument') return res.status(400).json(payload);
  if (code === 'failed-precondition') return res.status(412).json(payload);
  return res.status(500).json(payload);
}

function resolveShortcutSecret() {
  return String(
    process.env.IOS_SHORTCUT_WEBHOOK_SECRET ||
    process.env.REMINDERS_WEBHOOK_SECRET ||
    ''
  ).trim();
}

function readHeaderValue(req, name) {
  const direct = req?.headers?.[name];
  if (Array.isArray(direct)) return String(direct[0] || '').trim();
  if (typeof direct === 'string') return direct.trim();

  const lower = req?.headers?.[name.toLowerCase()];
  if (Array.isArray(lower)) return String(lower[0] || '').trim();
  if (typeof lower === 'string') return lower.trim();

  const getterValue = req?.get?.(name);
  if (typeof getterValue === 'string') return getterValue.trim();
  return '';
}

function isHeaderSafeAscii(value) {
  return /^[\x20-\x7E]+$/.test(String(value || ''));
}

async function resolveHttpCaller(req) {
  const authHeader = readHeaderValue(req, 'authorization');
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) throw new httpsV2.HttpsError('unauthenticated', 'Missing bearer token.');
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (error) {
      console.warn('[transcriptIngestion] http_auth_failed', JSON.stringify({
        authMode: 'firebase',
        reason: 'invalid_bearer_token',
        message: error?.message || String(error),
      }));
      throw new httpsV2.HttpsError('unauthenticated', 'Invalid bearer token.');
    }
    return {
      uid: decoded.uid,
      authMode: 'firebase',
    };
  }

  const configuredSecret = resolveShortcutSecret();
  const headerSecret = String(
    readHeaderValue(req, 'x-bob-shortcut-key') ||
    readHeaderValue(req, 'x-api-key') ||
    readHeaderValue(req, 'x-shortcut-secret') ||
    readHeaderValue(req, 'x-reminders-secret') ||
    ''
  ).trim();
  const providedSecret = String(
    headerSecret ||
    req.body?.secret ||
    req.query?.secret ||
    ''
  ).trim();
  const providedViaHeader = Boolean(headerSecret);
  const configuredSecretHeaderSafe = isHeaderSafeAscii(configuredSecret);
  if (providedViaHeader && configuredSecret && !configuredSecretHeaderSafe) {
    console.warn('[transcriptIngestion] http_auth_failed', JSON.stringify({
      authMode: 'shortcut_secret',
      reason: 'configured_secret_not_header_safe',
      hasUid: Boolean(String(req.body?.uid || req.query?.uid || '').trim()),
      source: String(req.body?.source || req.query?.source || '').trim() || null,
    }));
    throw new httpsV2.HttpsError(
      'failed-precondition',
      'The configured shortcut secret contains non-ASCII characters and cannot be used in an HTTP header. Reset it to a plain ASCII string or send it in the JSON body as `secret`.'
    );
  }
  if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
    console.warn('[transcriptIngestion] http_auth_failed', JSON.stringify({
      authMode: 'shortcut_secret',
      reason: !configuredSecret ? 'secret_not_configured' : !providedSecret ? 'secret_not_provided' : 'secret_mismatch',
      hasUid: Boolean(String(req.body?.uid || req.query?.uid || '').trim()),
      providedViaHeader,
      providedViaBody: Boolean(req.body?.secret),
      configuredSecretHeaderSafe,
      source: String(req.body?.source || req.query?.source || '').trim() || null,
    }));
    throw new httpsV2.HttpsError('unauthenticated', 'Missing or invalid shortcut secret.');
  }

  const uid = String(req.body?.uid || req.query?.uid || '').trim();
  if (!uid) {
    console.warn('[transcriptIngestion] http_auth_failed', JSON.stringify({
      authMode: 'shortcut_secret',
      reason: 'uid_missing',
      source: String(req.body?.source || req.query?.source || '').trim() || null,
    }));
    throw new httpsV2.HttpsError('invalid-argument', 'uid is required when using the shortcut secret.');
  }
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
  console.log('[transcriptIngestion] callable_request', JSON.stringify({
    uid,
    source: String(req?.data?.source || 'web_fab'),
    sourceProvidedId: String(req?.data?.sourceProvidedId || ''),
    transcriptLength: String(req?.data?.transcript || '').trim().length,
  }));
  return processTranscriptIngestion({
    uid,
    transcript: String(req?.data?.transcript || ''),
    persona: String(req?.data?.persona || 'personal'),
    source: String(req?.data?.source || 'web_fab'),
    sourceUrl: String(req?.data?.sourceUrl || ''),
    sourceProvidedId: String(req?.data?.sourceProvidedId || ''),
    channel: 'callable',
    authMode: 'firebase',
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
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bob-shortcut-key, x-api-key, x-shortcut-secret, x-reminders-secret');
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
    console.log('[transcriptIngestion] http_request', JSON.stringify({
      uid: caller.uid,
      authMode: caller.authMode,
      source: String(req.body?.source || 'ios_shortcut'),
      sourceProvidedId: String(req.body?.sourceProvidedId || ''),
      transcriptLength: String(req.body?.transcript || '').trim().length,
    }));
    const result = await processTranscriptIngestion({
      uid: caller.uid,
      transcript: String(req.body?.transcript || ''),
      persona: String(req.body?.persona || 'personal'),
      source: String(req.body?.source || 'ios_shortcut'),
      sourceUrl: String(req.body?.sourceUrl || ''),
      sourceProvidedId: String(req.body?.sourceProvidedId || ''),
      channel: 'http',
      authMode: caller.authMode,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('[transcriptIngestion] http_request_failed', JSON.stringify({
      code: error?.code || 'internal',
      message: error?.message || String(error),
      details: summarizeForLog(error?.details || null),
      source: String(req.body?.source || ''),
      sourceProvidedId: String(req.body?.sourceProvidedId || ''),
    }));
    mapHttpError(error, res);
  }
});
