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
const DEFAULT_CALENDAR_QUERY_COUNT = 4;
const DEFAULT_TOP_PRIORITY_COUNT = 3;
const DEFAULT_REPLAN_DAYS = 3;
const AGENT_INTENTS = [
  'process_text',
  'create_task',
  'create_journal',
  'create_story',
  'ingest_url',
  'query_calendar_next',
  'query_top_priorities',
  'run_replan',
  'unknown',
];
const AGENT_MODES = ['write', 'query', 'action', 'unknown'];
const ROUTER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', format: 'enum', enum: AGENT_INTENTS },
    mode: { type: 'string', format: 'enum', enum: AGENT_MODES },
    confidence: { type: 'number' },
    calendarQuery: {
      type: 'object',
      nullable: true,
      properties: {
        count: { type: 'integer' },
      },
      required: ['count'],
    },
    topPriorityQuery: {
      type: 'object',
      nullable: true,
      properties: {
        count: { type: 'integer' },
      },
      required: ['count'],
    },
    replan: {
      type: 'object',
      nullable: true,
      properties: {
        days: { type: 'integer' },
      },
      required: ['days'],
    },
  },
  required: ['intent', 'mode', 'confidence', 'calendarQuery', 'topPriorityQuery', 'replan'],
};
const TRANSCRIPT_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    entryType: { type: 'string', format: 'enum', enum: ['journal', 'task_list', 'url_only', 'mixed'] },
    shouldCreateJournal: { type: 'boolean' },
    oneLineSummary: { type: 'string' },
    structuredEntry: { type: 'string' },
    advice: { type: 'string' },
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'integer' },
          points: { type: 'integer' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          theme: { type: 'string' },
          url: { type: 'string', nullable: true },
        },
        required: ['title', 'description', 'priority', 'points', 'acceptanceCriteria', 'theme', 'url'],
      },
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'integer' },
          estimateMin: { type: 'integer' },
          points: { type: 'integer' },
          effort: { type: 'string', format: 'enum', enum: ['S', 'M', 'L', 'XL'] },
          kind: { type: 'string', format: 'enum', enum: ['task', 'read', 'watch'] },
          theme: { type: 'string' },
          storyTitle: { type: 'string', nullable: true },
          dueDateIso: { type: 'string', nullable: true },
          url: { type: 'string', nullable: true },
        },
        required: ['title', 'description', 'priority', 'estimateMin', 'points', 'effort', 'kind', 'theme', 'storyTitle', 'dueDateIso', 'url'],
      },
    },
  },
  required: ['entryType', 'shouldCreateJournal', 'oneLineSummary', 'structuredEntry', 'advice', 'stories', 'tasks'],
};

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

function stripJsonCodeFence(text) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return raw.replace(/^json\s*/i, '').trim();
}

function removeTrailingCommasJsonLike(text) {
  return String(text || '').replace(/,\s*([}\]])/g, '$1');
}

function extractBalancedJsonSnippet(text) {
  const raw = String(text || '');
  const start = raw.search(/[\[{]/);
  if (start < 0) return null;

  const opening = raw[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }
  return raw.slice(start).trim() || null;
}

function parseModelJson(text, label) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error(`${label} returned empty JSON`);

  const stripped = stripJsonCodeFence(raw);
  const extracted = extractBalancedJsonSnippet(stripped);
  const candidates = [
    raw,
    stripped,
    extracted,
    removeTrailingCommasJsonLike(raw),
    removeTrailingCommasJsonLike(stripped),
    extracted ? removeTrailingCommasJsonLike(extracted) : null,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${label} returned invalid JSON: ${lastError?.message || 'Unknown parse error'}`);
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

function normalizeUrlValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol || '')) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildUrlDisplayLabel(url) {
  const normalized = normalizeUrlValue(url);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}`.slice(0, 120);
  } catch {
    return normalized.slice(0, 120);
  }
}

function isLikelyVideoUrl(url) {
  const normalized = normalizeUrlValue(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    return [
      'youtube.com',
      'www.youtube.com',
      'youtu.be',
      'm.youtube.com',
      'vimeo.com',
      'www.vimeo.com',
      'player.vimeo.com',
      'netflix.com',
      'www.netflix.com',
      'bbc.co.uk',
      'www.bbc.co.uk',
      'bbc.com',
      'www.bbc.com',
      'twitch.tv',
      'www.twitch.tv',
      'player.twitch.tv',
      'loom.com',
      'www.loom.com',
      'dailymotion.com',
      'www.dailymotion.com',
    ].includes(host);
  } catch {
    return false;
  }
}

function cleanPreviewTitle(value, url = '') {
  let title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const normalizedUrl = normalizeUrlValue(url);
  const hostLabel = normalizedUrl ? buildUrlDisplayLabel(normalizedUrl).split('/')[0] : '';
  const removableSuffixes = [
    /\s*[-|–—]\s*YouTube$/i,
    /\s*[-|–—]\s*Vimeo$/i,
    /\s*[-|–—]\s*Netflix$/i,
    /\s*[-|–—]\s*Medium$/i,
    /\s*[-|–—]\s*Substack$/i,
    /\s*[-|–—]\s*BBC(?: News| iPlayer)?$/i,
    /\s*[-|–—]\s*TED$/i,
    /\s*[-|–—]\s*Wikipedia$/i,
  ];
  removableSuffixes.forEach((pattern) => {
    title = title.replace(pattern, '').trim();
  });
  if (hostLabel) {
    title = title
      .replace(new RegExp(`\\s*[-|–—]\\s*${escapeRegExp(hostLabel)}$`, 'i'), '')
      .trim();
  }
  return title.slice(0, 200) || null;
}

function deriveTitleFromUrl(url, fallbackKind = null) {
  const normalized = normalizeUrlValue(url);
  if (!normalized) return fallbackKind === 'watch' ? 'Watch item' : fallbackKind === 'read' ? 'Read item' : 'Linked item';
  try {
    const parsed = new URL(normalized);
    const lastSegment = parsed.pathname
      .split('/')
      .filter(Boolean)
      .pop();
    if (lastSegment) {
      const cleaned = decodeURIComponent(lastSegment)
        .replace(/[-_]+/g, ' ')
        .replace(/\.[a-z0-9]+$/i, '')
        .trim();
      if (cleaned) return cleaned.slice(0, 140);
    }
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return normalized.slice(0, 140);
  }
}

function buildConsumptionTitle(kind, previewTitle, url = '') {
  const cleanTitle = cleanPreviewTitle(previewTitle, url) || deriveTitleFromUrl(url, kind);
  if (kind === 'watch') return `Watch: ${cleanTitle}`.slice(0, 140);
  if (kind === 'read') return `Read: ${cleanTitle}`.slice(0, 140);
  return cleanTitle.slice(0, 140);
}

function isGenericConsumptionTitle(title, kind = null) {
  const normalized = normalizeTitle(title).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  const generic = new Set([
    'read',
    'read this',
    'read article',
    'read link',
    'read page',
    'article',
    'link',
    'resource',
    'watch',
    'watch this',
    'watch video',
    'watch clip',
    'watch episode',
    'video',
    'clip',
    'url',
    'open link',
    'check link',
    'review link',
  ]);
  if (generic.has(normalized)) return true;
  if (kind === 'watch' && /^watch( the)?$/.test(normalized)) return true;
  if (kind === 'read' && /^read( the)?$/.test(normalized)) return true;
  return normalized.split(' ').length <= 3 && ['read', 'watch', 'video', 'article', 'link', 'url'].some((token) => normalized.includes(token));
}

function isGenericDescription(value) {
  const normalized = normalizeTitle(value);
  if (!normalized) return true;
  return [
    'captured from transcript intake',
    'captured from transcript',
    'captured from process text',
    'link from transcript',
  ].includes(normalized);
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
    const value = normalizeUrlValue(candidate);
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
  const normalizedUrl = normalizeUrlValue(url) || String(url || '').trim();
  const preview = {
    url: normalizedUrl,
    title: null,
    description: null,
    siteName: null,
    textSnippet: null,
    kindHint: isLikelyVideoUrl(normalizedUrl) ? 'watch' : 'read',
  };
  try {
    const response = await fetch(normalizedUrl, {
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
    const rawTitle = (
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').first().text() ||
      $('h1').first().text() ||
      ''
    );
    const rawDescription = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('article p').first().text() ||
      $('main p').first().text() ||
      $('p').first().text() ||
      ''
    );
    const rawSiteName = (
      $('meta[property="og:site_name"]').attr('content') ||
      $('meta[name="application-name"]').attr('content') ||
      ''
    );
    const ogType = String($('meta[property="og:type"]').attr('content') || '').trim().toLowerCase();
    preview.title = cleanPreviewTitle(rawTitle, normalizedUrl);
    preview.description = (
      String(rawDescription || '')
    ).trim().slice(0, 400) || null;
    preview.siteName = cleanPreviewTitle(rawSiteName, normalizedUrl);
    preview.textSnippet = String(rawDescription || '').replace(/\s+/g, ' ').trim().slice(0, 240) || null;
    preview.kindHint = ogType.includes('video') || isLikelyVideoUrl(normalizedUrl) ? 'watch' : 'read';
    return preview;
  } catch {
    return preview;
  }
}

async function fetchUrlPreviews(urls) {
  if (!Array.isArray(urls) || !urls.length) return [];
  return Promise.all(urls.slice(0, 3).map((url) => fetchUrlPreview(url)));
}

function buildPreviewLookup(urlPreviews = [], sourceUrls = []) {
  const ordered = [];
  const map = new Map();
  [...sourceUrls, ...urlPreviews.map((preview) => preview?.url)].forEach((candidate) => {
    const normalized = normalizeUrlValue(candidate);
    if (!normalized || map.has(normalized)) return;
    const preview = urlPreviews.find((item) => normalizeUrlValue(item?.url) === normalized) || {
      url: normalized,
      title: null,
      description: null,
      siteName: null,
      textSnippet: null,
      kindHint: isLikelyVideoUrl(normalized) ? 'watch' : 'read',
    };
    map.set(normalized, preview);
    ordered.push(preview);
  });
  return { ordered, map };
}

function findPreviewForEntity(entity, previewLookup, consumedUrls = new Set(), allowImplicit = false) {
  const explicitUrl = normalizeUrlValue(entity?.url);
  if (explicitUrl && previewLookup.map.has(explicitUrl)) {
    return previewLookup.map.get(explicitUrl);
  }

  const normalizedTitleValue = normalizeTitle(entity?.title || '');
  if (normalizedTitleValue) {
    const byTitle = previewLookup.ordered.find((preview) => {
      const previewTitle = normalizeTitle(preview?.title || '');
      return previewTitle && (
        previewTitle.includes(normalizedTitleValue) ||
        normalizedTitleValue.includes(previewTitle)
      );
    });
    if (byTitle) return byTitle;
  }

  if (!allowImplicit) return null;

  return previewLookup.ordered.find((preview) => {
    const normalized = normalizeUrlValue(preview?.url);
    return normalized && !consumedUrls.has(normalized);
  }) || null;
}

function enrichEntityFromPreview(entity, preview, { defaultKind = null } = {}) {
  const normalizedUrl = normalizeUrlValue(entity?.url) || normalizeUrlValue(preview?.url);
  const previewTitle = cleanPreviewTitle(preview?.title, normalizedUrl) || deriveTitleFromUrl(normalizedUrl, defaultKind);
  const previewDescription = String(preview?.description || preview?.textSnippet || '').trim();
  const treatAsStory = !Object.prototype.hasOwnProperty.call(entity || {}, 'kind');
  const kind = normalizeTaskKind(entity?.kind || defaultKind, entity?.title || '');
  const existingTitle = String(entity?.title || '').trim();
  const next = {
    ...entity,
    url: normalizedUrl,
  };

  if (previewTitle) {
    const normalizedPreviewTitle = normalizeTitle(previewTitle);
    const normalizedEntityTitle = normalizeTitle(existingTitle);
    const needsPreviewName = (
      !existingTitle ||
      isGenericConsumptionTitle(existingTitle, kind) ||
      (kind !== 'task' && normalizedPreviewTitle && !normalizedEntityTitle.includes(normalizedPreviewTitle))
    );
    if (needsPreviewName) {
      next.title = treatAsStory
        ? previewTitle.slice(0, 140)
        : buildConsumptionTitle(kind === 'task' ? (preview?.kindHint || defaultKind || 'read') : kind, previewTitle, normalizedUrl);
    }
  }

  if ((!next.description || isGenericDescription(next.description)) && previewDescription) {
    next.description = previewDescription.slice(0, 400);
  }

  return next;
}

function enrichAnalysisWithUrlMetadata(analysis, sourceUrls = [], urlPreviews = []) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const previewLookup = buildPreviewLookup(urlPreviews, sourceUrls);
  if (!previewLookup.ordered.length) return analysis;

  const consumedUrls = new Set();
  const consume = (url) => {
    const normalized = normalizeUrlValue(url);
    if (normalized) consumedUrls.add(normalized);
    return normalized;
  };

  const tasks = (Array.isArray(analysis.tasks) ? analysis.tasks : []).map((task) => {
    const allowImplicit = task?.kind === 'read' || task?.kind === 'watch' || analysis.entryType === 'url_only';
    const preview = findPreviewForEntity(task, previewLookup, consumedUrls, allowImplicit);
    const enriched = preview ? enrichEntityFromPreview(task, preview, { defaultKind: preview.kindHint || task?.kind || 'read' }) : {
      ...task,
      url: normalizeUrlValue(task?.url),
    };
    consume(enriched?.url);
    return enriched;
  });

  const stories = (Array.isArray(analysis.stories) ? analysis.stories : []).map((story) => {
    const preview = findPreviewForEntity(story, previewLookup, consumedUrls, analysis.entryType === 'url_only');
    const enriched = preview ? enrichEntityFromPreview(story, preview, { defaultKind: preview.kindHint || 'read' }) : {
      ...story,
      url: normalizeUrlValue(story?.url),
    };
    consume(enriched?.url);
    return enriched;
  });

  return {
    ...analysis,
    tasks,
    stories,
  };
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

async function callAgentRouterModel({ transcript, persona, timezone, urlPreviews }) {
  const apiKey = String(process.env.GOOGLEAISTUDIOAPIKEY || '').trim();
  if (!apiKey) throw new Error('GOOGLEAISTUDIOAPIKEY not configured');

  const system = [
    'You are an intent router for a productivity assistant.',
    'Return STRICT JSON only with this shape:',
    '{',
    '  "intent": "process_text"|"create_task"|"create_journal"|"create_story"|"ingest_url"|"query_calendar_next"|"query_top_priorities"|"run_replan"|"unknown",',
    '  "mode": "write"|"query"|"action"|"unknown",',
    '  "confidence": number,',
    '  "calendarQuery": {',
    '    "count": number',
    '  }|null,',
    '  "topPriorityQuery": {',
    '    "count": number',
    '  }|null,',
    '  "replan": {',
    '    "days": number',
    '  }|null',
    '}',
    'Rules:',
    'Use mode="query" and intent="query_calendar_next" only when the user is explicitly asking what is next, upcoming, or on their calendar/schedule.',
    'Use mode="query" and intent="query_top_priorities" when the user is asking what to focus on, their top priorities, or what matters most today.',
    'Use mode="action" and intent="run_replan" when the user is explicitly asking you to replan, plan the day, plan the week, or reshuffle their schedule.',
    'For reflective narrative, journaling, planning, reminders, tasks, projects, and URLs to consume, use mode="write".',
    'Use intent="ingest_url" when the input is mostly one or more URLs.',
    'Use intent="create_journal" when it is primarily reflective narrative or a journal-style note.',
    'Use intent="create_task" when it is primarily a reminder, action, to-do, or short planning note.',
    'Use intent="create_story" when it describes a larger multi-step initiative or project.',
    'Use intent="process_text" when it should go through the general write-processing pipeline but does not cleanly fit the narrower labels above.',
    'If the request is ambiguous, prefer mode="write" and intent="process_text" rather than "unknown".',
    'Only return "unknown" when there is genuinely no actionable or queryable request.',
    'Set calendarQuery.count to a sensible value between 1 and 10. Default to 4 for "what is next on my calendar".',
    'Set topPriorityQuery.count to a sensible value between 1 and 5. Default to 3 for top priorities questions.',
    'Set replan.days between 1 and 14. Use 1 for day-level replans, 7 for week-level replans, and 3 if the request is vague.',
  ].join('\n');

  const user = [
    `Persona: ${persona || 'personal'}`,
    `Timezone: ${timezone || DEFAULT_TIMEZONE}`,
    urlPreviews?.length ? `Resolved URL previews:\n${JSON.stringify(urlPreviews, null, 2)}` : null,
    'Input text:',
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
      temperature: 0.1,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: ROUTER_RESPONSE_SCHEMA,
    },
  });

  const response = await model.generateContent(`${system}\n\n${user}`);
  const text = response?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty routing response');
  return parseModelJson(text, 'Gemini routing response');
}

async function callTranscriptModel({ transcript, persona, timezone, urlPreviews }) {
  const apiKey = String(process.env.GOOGLEAISTUDIOAPIKEY || '').trim();
  if (!apiKey) throw new Error('GOOGLEAISTUDIOAPIKEY not configured');
  const currentDate = DateTime.now().setZone(timezone || DEFAULT_TIMEZONE);

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
    '    "theme": string,',
    '    "url": string|null',
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
    '    "storyTitle": string|null,',
    '    "dueDateIso": "YYYY-MM-DD"|null,',
    '    "url": string|null',
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
    'Set dueDateIso only when the transcript clearly implies a due date such as today, tomorrow, tonight, a weekday, next week, or an explicit date.',
    'Resolve dueDateIso to a local calendar date in YYYY-MM-DD using the provided timezone and current local date.',
    'If no clear due date is requested, set dueDateIso to null.',
    'When URL previews are provided, use the preview title and page text to name read/watch items clearly.',
    'Avoid generic titles like "Read article" or "Watch video" when a concrete page or video title is available.',
    'Set url to the exact matching source URL for any task or story that came from a URL.',
    'For URL-only inputs, every returned task or story must carry its matching url.',
  ].join('\n');

  const user = [
    `Persona: ${persona || 'personal'}`,
    `Timezone: ${timezone || DEFAULT_TIMEZONE}`,
    `Current local date: ${currentDate.toISODate()} (${currentDate.toLocaleString(DateTime.DATE_FULL)})`,
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
      responseSchema: TRANSCRIPT_ANALYSIS_SCHEMA,
    },
  });

  const response = await model.generateContent(`${system}\n\n${user}`);
  const text = response?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response');
  return parseModelJson(text, 'Gemini transcript analysis response');
}

function stripUrlsForHeuristics(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s<>"')]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeAgentQueryOrAction(text) {
  const lowered = stripUrlsForHeuristics(text).toLowerCase();
  if (!lowered) return false;
  if (/\b(calendar|schedule|agenda)\b/.test(lowered) && /\b(next|upcoming|what('| i)?s next|what is next)\b/.test(lowered)) {
    return true;
  }
  if (/\b(top\s*(3|three)|top priorities|priorities today|what should i focus on|what matters most|focus today)\b/.test(lowered)) {
    return true;
  }
  if (/\b(replan|re-plan|plan my day|plan today|plan my week|replan my day|replan my week|schedule my day|schedule my week|rebuild my plan)\b/.test(lowered)) {
    return true;
  }
  return false;
}

function normalizeAgentIntent(rawIntent, normalizedTranscript, sourceUrls = []) {
  const intent = String(rawIntent || '').trim().toLowerCase();
  if (AGENT_INTENTS.includes(intent)) {
    return intent;
  }

  const lowered = String(normalizedTranscript || '').trim().toLowerCase();
  if (/\b(calendar|schedule|agenda)\b/.test(lowered) && /\b(next|upcoming|what('| i)?s next|what is next)\b/.test(lowered)) {
    return 'query_calendar_next';
  }
  if (
    /\b(top\s*(3|three)|top priorities|priorities today|what should i focus on|what should i do next|what matters most|focus today)\b/.test(lowered)
  ) {
    return 'query_top_priorities';
  }
  if (
    /\b(replan|re-plan|plan my day|plan today|plan my week|replan my day|replan my week|schedule my day|schedule my week|rebuild my plan)\b/.test(lowered)
  ) {
    return 'run_replan';
  }
  if (Array.isArray(sourceUrls) && sourceUrls.length > 0 && stripUrlsForHeuristics(normalizedTranscript).split(/\s+/).filter(Boolean).length <= 6) {
    return 'ingest_url';
  }
  return 'process_text';
}

function normalizeAgentMode(rawMode, intent) {
  const mode = String(rawMode || '').trim().toLowerCase();
  if (mode === 'write' || mode === 'query' || mode === 'action' || mode === 'unknown') return mode;
  if (intent === 'query_calendar_next') return 'query';
  if (intent === 'query_top_priorities') return 'query';
  if (intent === 'run_replan') return 'action';
  if (intent === 'unknown') return 'unknown';
  return 'write';
}

function normalizeCalendarQuery(rawQuery) {
  const count = Math.max(
    1,
    Math.min(
      10,
      Math.round(Number(rawQuery?.count || DEFAULT_CALENDAR_QUERY_COUNT)) || DEFAULT_CALENDAR_QUERY_COUNT
    )
  );
  return { count };
}

function normalizeTopPriorityQuery(rawQuery) {
  const count = Math.max(
    1,
    Math.min(
      5,
      Math.round(Number(rawQuery?.count || DEFAULT_TOP_PRIORITY_COUNT)) || DEFAULT_TOP_PRIORITY_COUNT
    )
  );
  return { count };
}

function normalizeReplanRequest(rawRequest, normalizedTranscript) {
  const lowered = String(normalizedTranscript || '').toLowerCase();
  let fallbackDays = DEFAULT_REPLAN_DAYS;
  if (/\b(today|this afternoon|this evening|plan my day|replan my day)\b/.test(lowered)) {
    fallbackDays = 1;
  } else if (/\b(week|this week|next week|plan my week|replan my week)\b/.test(lowered)) {
    fallbackDays = 7;
  }
  const days = Math.max(
    1,
    Math.min(14, Math.round(Number(rawRequest?.days || fallbackDays)) || fallbackDays)
  );
  return { days };
}

function sanitizeAgentRoute(raw, normalizedTranscript, sourceUrls = []) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const intent = normalizeAgentIntent(payload.intent, normalizedTranscript, sourceUrls);
  let mode = normalizeAgentMode(payload.mode, intent);
  if (intent === 'query_calendar_next') mode = 'query';
  if (intent === 'query_top_priorities') mode = 'query';
  if (intent === 'run_replan') mode = 'action';
  if (!['unknown', 'query_calendar_next', 'query_top_priorities', 'run_replan'].includes(intent) && mode !== 'write') {
    mode = 'write';
  }

  const confidenceNumber = Number(payload.confidence);
  const confidence = Number.isFinite(confidenceNumber)
    ? Math.max(0, Math.min(1, confidenceNumber))
    : 0.5;

  return {
    intent,
    mode,
    confidence,
    calendarQuery: normalizeCalendarQuery(payload.calendarQuery),
    topPriorityQuery: normalizeTopPriorityQuery(payload.topPriorityQuery),
    replan: normalizeReplanRequest(payload.replan, normalizedTranscript),
  };
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

function normalizeDueDateIso(value, timezone = DEFAULT_TIMEZONE) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = DateTime.fromISO(raw, { zone: timezone || DEFAULT_TIMEZONE });
  if (!parsed.isValid) return null;
  return parsed.startOf('day').toISODate();
}

function sanitizeAnalysis(raw, transcript, sourceUrls = [], timezone = DEFAULT_TIMEZONE) {
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
      url: normalizeUrlValue(story?.url),
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
        dueDateIso: normalizeDueDateIso(task?.dueDateIso, timezone),
        url: normalizeUrlValue(task?.url),
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

function dueDateMsFromIsoDate(dateIso, timezone = DEFAULT_TIMEZONE) {
  const normalized = normalizeDueDateIso(dateIso, timezone);
  if (!normalized) return null;
  const parsed = DateTime.fromISO(normalized, { zone: timezone || DEFAULT_TIMEZONE }).endOf('day');
  return parsed.isValid ? parsed.toMillis() : null;
}

function buildExistingEntityRecord(collectionName, doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ref: String(data.ref || doc.id),
    title: String(data.title || ''),
    url: normalizeUrlValue(data.url),
    deepLink: String(data.deepLink || buildEntityUrl(collectionName === 'stories' ? 'story' : 'task', doc.id, data.ref || doc.id)),
    payload: { id: doc.id, ...data },
    existing: true,
  };
}

async function findExistingEntityRecord(db, collectionName, uid, title, url = null) {
  const normalized = normalizeTitle(title);
  const normalizedUrl = normalizeUrlValue(url);
  if (!normalized && !normalizedUrl) return null;

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

  if (normalizedUrl) {
    const byUrl = await runQuery('url', normalizedUrl);
    if (byUrl) return byUrl;
  }

  if (normalized) {
    const byNormalized = await runQuery('normalizedTitle', normalized);
    if (byNormalized) return byNormalized;

    const byTitle = await runQuery('title', title);
    if (byTitle) return byTitle;
  }

  const fallback = await db.collection(collectionName).where('ownerUid', '==', uid).limit(400).get().catch(() => null);
  const doc = fallback?.docs?.find((candidate) => {
    const data = candidate.data() || {};
    if (data.deleted === true) return false;
    if (normalizedUrl && normalizeUrlValue(data.url) === normalizedUrl) return true;
    return normalized ? normalizeTitle(data.normalizedTitle || data.title || '') === normalized : false;
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
    const lookupKey = story.url ? `url:${story.url}` : titleKey;
    if (lookupKey && !existingStories.has(lookupKey)) {
      existingStories.set(lookupKey, await findExistingEntityRecord(db, 'stories', uid, story.title, story.url));
    }
    const existing = lookupKey ? existingStories.get(lookupKey) : null;
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
      url: story.url || null,
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
      url: payload.url,
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
    const lookupKey = task.url ? `url:${task.url}` : titleKey;
    if (lookupKey && !existingTasks.has(lookupKey)) {
      existingTasks.set(lookupKey, await findExistingEntityRecord(db, 'tasks', uid, task.title, task.url));
    }
    const existing = lookupKey ? existingTasks.get(lookupKey) : null;
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
    const llmDueDate = dueDateMsFromIsoDate(task.dueDateIso, timezone);
    const dueDate = llmDueDate || (prioritized.kind === 'read' || prioritized.kind === 'watch' ? saturdayDueMs : null);
    const dueDateReason = llmDueDate
      ? 'llm_due_date'
      : dueDate
        ? 'upcoming_saturday_read_watch'
        : null;
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
      dueDateIso: task.dueDateIso || null,
      dueDateReason,
      labels: [],
      blockedBy: [],
      dependsOn: [],
      checklist: [],
      attachments: [],
      url: task.url || null,
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
      url: payload.url,
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

async function getGoogleOAuth2Client(uid) {
  const db = admin.firestore();
  const [tokenSnap, userSnap] = await Promise.all([
    db.collection('tokens').doc(uid).get().catch(() => null),
    db.collection('users').doc(uid).get().catch(() => null),
  ]);

  const tokenData = tokenSnap?.exists ? (tokenSnap.data() || {}) : {};
  const userData = userSnap?.exists ? (userSnap.data() || {}) : {};
  const refreshToken = String(
    tokenData.refresh_token ||
    tokenData.googleCalendarTokens?.refresh_token ||
    userData.googleCalendarTokens?.refresh_token ||
    ''
  ).trim();

  if (!refreshToken) {
    throw new httpsV2.HttpsError(
      'failed-precondition',
      'Google is not connected. Reconnect Google Calendar to grant Google access.'
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
  return auth;
}

async function getGoogleDocsClient(uid) {
  const auth = await getGoogleOAuth2Client(uid);
  return google.docs({ version: 'v1', auth });
}

async function getGoogleCalendarClient(uid) {
  const auth = await getGoogleOAuth2Client(uid);
  return google.calendar({ version: 'v3', auth });
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

function formatCalendarEventResponse(event, timezone) {
  const zone = timezone || DEFAULT_TIMEZONE;
  const startDateTime = String(event?.start?.dateTime || '').trim();
  const endDateTime = String(event?.end?.dateTime || '').trim();
  const startDate = String(event?.start?.date || '').trim();
  const endDate = String(event?.end?.date || '').trim();
  const isAllDay = Boolean(!startDateTime && startDate);
  const startValue = startDateTime || startDate || null;
  const endValue = endDateTime || endDate || null;

  let when = 'Time unavailable';
  if (startDateTime) {
    when = DateTime.fromISO(startDateTime).setZone(zone).toLocaleString(DateTime.DATETIME_MED);
  } else if (startDate) {
    when = DateTime.fromISO(startDate).setZone(zone).toLocaleString(DateTime.DATE_FULL);
  }

  return {
    id: String(event?.id || ''),
    title: String(event?.summary || 'Untitled event'),
    start: startValue,
    end: endValue,
    when,
    isAllDay,
    location: String(event?.location || '').trim() || null,
    htmlLink: String(event?.htmlLink || '').trim() || null,
    status: String(event?.status || '').trim() || null,
  };
}

function buildCalendarSpokenResponse(events, limit = null) {
  if (!Array.isArray(events) || !events.length) {
    return 'You have no upcoming events on your calendar.';
  }
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || events.length));
  const listed = events.slice(0, safeLimit).map((event) => `${event.title} at ${event.when}`);
  if (listed.length === 1) {
    return `Your next event is ${listed[0]}.`;
  }
  if (listed.length === 2) {
    return `Your next events are ${listed[0]} and ${listed[1]}.`;
  }
  return `Your next events are ${listed.slice(0, -1).join(', ')}, and ${listed[listed.length - 1]}.`;
}

function buildCalendarQueryResponse({ intent, confidence, events, processedAt, count }) {
  return {
    ok: true,
    mode: 'query',
    intent,
    confidence,
    spokenResponse: buildCalendarSpokenResponse(events, count),
    actionsExecuted: ['query_calendar_next'],
    resultType: 'calendar',
    processedAt: normalizeTimestampOutput(processedAt || new Date()),
    calendarEvents: events,
    createdTasks: [],
    createdStories: [],
    hasJournal: false,
    journalId: null,
    docUrl: null,
  };
}

function resolvePersona(value) {
  return String(value || 'personal').trim().toLowerCase() === 'work' ? 'work' : 'personal';
}

function isTaskDoneStatus(status) {
  if (status == null) return false;
  if (typeof status === 'number') return status >= 2;
  const normalized = String(status).trim().toLowerCase();
  return ['done', 'completed', 'complete', 'cancelled', 'canceled'].includes(normalized);
}

function isStoryDoneStatus(status) {
  if (status == null) return false;
  if (typeof status === 'number') return status >= 2;
  const normalized = String(status).trim().toLowerCase();
  return ['done', 'completed', 'complete', 'archived', 'cancelled', 'canceled'].includes(normalized);
}

function isRoutineLikeTask(task) {
  const type = String(task?.type || task?.taskType || task?.entityType || '').trim().toLowerCase();
  return ['routine', 'habit', 'chore'].includes(type);
}

function normalizeRank(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 99;
}

function normalizeDueDateMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function buildTopPriorityItem(entityType, id, data) {
  const ref = String(data?.ref || id);
  const priorityRank = entityType === 'task'
    ? normalizeRank(data?.aiPriorityRank)
    : normalizeRank(data?.aiFocusStoryRank);
  return {
    entityType,
    id,
    ref,
    title: String(data?.title || '').trim() || ref,
    deepLink: String(
      data?.deepLink ||
      buildEntityUrl(entityType === 'story' ? 'story' : 'task', id, ref)
    ),
    reason: String(data?.aiTop3Reason || data?.aiPriorityReason || '').trim() || null,
    priorityRank,
    priority: normalizePriority(data?.priority, 2),
    userPriorityFlag: data?.userPriorityFlag === true,
    dueDateMs: normalizeDueDateMs(data?.dueDate),
  };
}

function priorityItemSort(a, b) {
  if (Boolean(b?.userPriorityFlag) !== Boolean(a?.userPriorityFlag)) {
    return b?.userPriorityFlag ? 1 : -1;
  }
  if ((a?.priorityRank || 99) !== (b?.priorityRank || 99)) {
    return (a?.priorityRank || 99) - (b?.priorityRank || 99);
  }
  if ((b?.priority || 0) !== (a?.priority || 0)) {
    return (b?.priority || 0) - (a?.priority || 0);
  }
  const aDue = a?.dueDateMs || Number.MAX_SAFE_INTEGER;
  const bDue = b?.dueDateMs || Number.MAX_SAFE_INTEGER;
  if (aDue !== bDue) return aDue - bDue;
  if (a?.entityType !== b?.entityType) return a?.entityType === 'task' ? -1 : 1;
  return String(a?.title || '').localeCompare(String(b?.title || ''));
}

async function fetchPriorityCandidateDocs(db, collectionName, uid) {
  try {
    const prioritized = await db.collection(collectionName)
      .where('ownerUid', '==', uid)
      .where('aiTop3ForDay', '==', true)
      .limit(25)
      .get();
    if (prioritized?.docs?.length) return prioritized.docs;
  } catch (error) {
    console.warn('[transcriptIngestion] top priority query failed', collectionName, error?.message || error);
  }

  const fallback = await db.collection(collectionName)
    .where('ownerUid', '==', uid)
    .limit(500)
    .get()
    .catch(() => ({ docs: [] }));
  return Array.isArray(fallback?.docs) ? fallback.docs : [];
}

async function listTopPriorityItems({ db, uid, persona, timezone, count = DEFAULT_TOP_PRIORITY_COUNT, refresh = true }) {
  const safePersona = resolvePersona(persona);
  const safeCount = Math.max(1, Math.min(5, Number(count) || DEFAULT_TOP_PRIORITY_COUNT));
  const todayIso = DateTime.now().setZone(timezone || DEFAULT_TIMEZONE).toISODate();

  if (refresh) {
    try {
      const nightlyOrchestration = require('./nightlyOrchestration');
      if (nightlyOrchestration?._deltaTop3ForPersona) {
        await nightlyOrchestration._deltaTop3ForPersona(db, uid, safePersona);
      }
    } catch (error) {
      console.warn('[transcriptIngestion] top priority refresh failed', uid, safePersona, error?.message || error);
    }
  }

  const [taskDocs, storyDocs] = await Promise.all([
    fetchPriorityCandidateDocs(db, 'tasks', uid),
    fetchPriorityCandidateDocs(db, 'stories', uid),
  ]);

  const tasks = taskDocs
    .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
    .filter(({ data }) => resolvePersona(data.persona) === safePersona)
    .filter(({ data }) => !isTaskDoneStatus(data.status) && data.deleted !== true)
    .filter(({ data }) => !isRoutineLikeTask(data))
    .filter(({ data }) => {
      if (data.aiTop3ForDay !== true) return false;
      if (data.aiTop3Date && String(data.aiTop3Date).slice(0, 10) !== todayIso) return false;
      return true;
    })
    .map(({ id, data }) => buildTopPriorityItem('task', id, data));

  const stories = storyDocs
    .map((doc) => ({ id: doc.id, data: doc.data() || {} }))
    .filter(({ data }) => resolvePersona(data.persona) === safePersona)
    .filter(({ data }) => !isStoryDoneStatus(data.status) && data.deleted !== true)
    .filter(({ data }) => {
      if (data.aiTop3ForDay !== true) return false;
      if (data.aiTop3Date && String(data.aiTop3Date).slice(0, 10) !== todayIso) return false;
      return true;
    })
    .map(({ id, data }) => buildTopPriorityItem('story', id, data));

  return [...tasks, ...stories].sort(priorityItemSort).slice(0, safeCount);
}

function buildTopPrioritiesSpokenResponse(items) {
  if (!Array.isArray(items) || !items.length) {
    return 'You do not have any active top priorities right now.';
  }
  const listed = items.slice(0, 5).map((item, index) => `${index + 1}, ${item.title}`);
  if (listed.length === 1) {
    return `Your top priority is ${listed[0]}.`;
  }
  if (listed.length === 2) {
    return `Your top priorities are ${listed[0]} and ${listed[1]}.`;
  }
  return `Your top priorities are ${listed.slice(0, -1).join(', ')}, and ${listed[listed.length - 1]}.`;
}

function buildTopPrioritiesResponse({ intent, confidence, items, processedAt }) {
  return {
    ok: true,
    mode: 'query',
    intent,
    confidence,
    spokenResponse: buildTopPrioritiesSpokenResponse(items),
    actionsExecuted: ['query_top_priorities'],
    resultType: 'priorities',
    processedAt: normalizeTimestampOutput(processedAt || new Date()),
    topPriorities: Array.isArray(items) ? items : [],
    calendarEvents: [],
    createdTasks: [],
    createdStories: [],
    hasJournal: false,
    journalId: null,
    docUrl: null,
  };
}

function normalizePushSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const created = Number(raw.createdCount || raw.created || 0);
  const updated = Number(raw.updatedCount || raw.updated || 0);
  const deleted = Number(raw.deletedCount || raw.deleted || 0);
  if (!created && !updated && !deleted) return null;
  return { created, updated, deleted };
}

async function runPlannerFromAgent({ uid, persona, timezone, days }) {
  const indexModule = require('./index');
  if (!indexModule?.runPlanner?.run) {
    throw new httpsV2.HttpsError('failed-precondition', 'Planner is not available.');
  }

  const safeDays = Math.max(1, Math.min(14, Number(days) || DEFAULT_REPLAN_DAYS));
  const startDate = DateTime.now().setZone(timezone || DEFAULT_TIMEZONE).toISODate();
  const raw = await indexModule.runPlanner.run({
    auth: { uid },
    data: {
      persona: resolvePersona(persona),
      timezone: timezone || DEFAULT_TIMEZONE,
      startDate,
      days: safeDays,
      pushToGoogle: true,
    },
  });
  const payload = raw?.data || raw || {};
  const llm = payload?.llm || null;
  const schedule = payload?.schedule || null;
  const pushed = payload?.pushed || null;

  return {
    startDate,
    days: safeDays,
    llmBlocksCreated: Number(llm?.blocksCreated || 0),
    llmApplied: llm?.applied === true,
    plannedCount: Array.isArray(schedule?.planned) ? schedule.planned.length : Number(schedule?.plannedCount || 0),
    unscheduledCount: Array.isArray(schedule?.unscheduled) ? schedule.unscheduled.length : Number(schedule?.unscheduledCount || 0),
    pushSummary: normalizePushSummary(pushed),
    raw: summarizeForLog(payload),
  };
}

function buildReplanSpokenResponse(summary, topPriorities) {
  if (!summary) {
    return 'I could not complete the replan.';
  }
  const parts = [
    `I replanned the next ${summary.days} day${summary.days === 1 ? '' : 's'}.`,
    summary.llmBlocksCreated
      ? `The planner created ${summary.llmBlocksCreated} AI block${summary.llmBlocksCreated === 1 ? '' : 's'}.`
      : null,
    summary.plannedCount
      ? `There are ${summary.plannedCount} scheduled item${summary.plannedCount === 1 ? '' : 's'} in the current window.`
      : null,
    Array.isArray(topPriorities) && topPriorities.length
      ? `Current top priorities: ${topPriorities.map((item) => item.title).join(', ')}.`
      : null,
  ].filter(Boolean);
  return parts.join(' ');
}

function buildReplanResponse({ intent, confidence, summary, topPriorities, processedAt }) {
  return {
    ok: true,
    mode: 'action',
    intent,
    confidence,
    spokenResponse: buildReplanSpokenResponse(summary, topPriorities),
    actionsExecuted: ['run_replan', 'query_top_priorities'],
    resultType: 'replan',
    processedAt: normalizeTimestampOutput(processedAt || new Date()),
    topPriorities: Array.isArray(topPriorities) ? topPriorities : [],
    replan: summary,
    calendarEvents: [],
    createdTasks: [],
    createdStories: [],
    hasJournal: false,
    journalId: null,
    docUrl: null,
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
  const dueDateIso = normalizeDueDateIso(payload.dueDateIso || null);
  return {
    id,
    ref,
    title: task?.title || payload.title || '',
    description: payload.description || '',
    url: normalizeUrlValue(payload.url),
    priority: payload.priority ?? null,
    estimateMin: payload.estimateMin ?? null,
    points: payload.points ?? null,
    effort: payload.effort || null,
    type: payload.type || null,
    dueDateMs: payload.dueDateMs ?? payload.dueDate ?? null,
    dueDateIso,
    dueDateReason: payload.dueDateReason || null,
    storyId: payload.storyId || null,
    entryMethod: payload.entry_method || null,
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
    url: normalizeUrlValue(payload.url),
    priority: payload.priority ?? null,
    points: payload.points ?? null,
    acceptanceCriteria: Array.isArray(payload.acceptanceCriteria) ? payload.acceptanceCriteria : [],
    theme: payload.theme || null,
    entryMethod: payload.entry_method || null,
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

function dedupeIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
}

async function autoConvertOversizedTaskRecords({ db, profile, fingerprint, taskRecords, logger }) {
  const candidates = (Array.isArray(taskRecords) ? taskRecords : []).filter((task) => task && task.existing !== true);
  if (!candidates.length) return [];

  const indexModule = require('./index');
  if (
    typeof indexModule?.shouldAutoConvertTaskInternal !== 'function' ||
    typeof indexModule?.runTaskAutoConvertInternal !== 'function'
  ) {
    return [];
  }

  const conversions = [];
  for (const task of candidates) {
    try {
      const taskSnap = await db.collection('tasks').doc(String(task.id)).get().catch(() => null);
      if (!taskSnap?.exists) continue;
      const taskData = taskSnap.data() || {};
      if (!indexModule.shouldAutoConvertTaskInternal(taskData, profile || {})) continue;
      const conversion = await indexModule.runTaskAutoConvertInternal({
        db,
        taskDoc: taskSnap,
        profile: profile || {},
        runId: `transcript_${fingerprint}`,
      });
      if (conversion) conversions.push(conversion);
    } catch (error) {
      console.warn('[transcriptIngestion] task auto-convert failed', task?.id, error?.message || error);
      if (logger) {
        await logger.event('task_auto_convert_failed', 'Transcript task auto-convert failed', {
          taskId: task?.id || null,
          message: error?.message || String(error),
        }, 'warning');
      }
    }
  }
  return conversions;
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

async function findExistingProcessedIngestion(db, uid, fingerprint) {
  const id = `${uid}_${fingerprint}`;
  const snap = await db.collection('transcript_ingestions').doc(id).get().catch(() => null);
  if (!snap?.exists) return null;
  const data = snap.data() || {};
  const status = String(data.status || '').toLowerCase();
  if (status !== 'processed' && status !== 'processing') return null;
  return hydrateDuplicateState(db, uid, fingerprint, { id, ...data });
}

function describeGeneratedEntity(entity, entityType, journalId = null) {
  const url = normalizeUrlValue(entity?.url);
  const base = entityType === 'story'
    ? `Created story ${entity?.ref || entity?.id || ''} via Process Text`
    : `Created task ${entity?.ref || entity?.id || ''} via Process Text`;
  const journalSuffix = journalId ? ` while processing journal ${journalId}` : '';
  const urlSuffix = url
    ? ` from ${cleanPreviewTitle(entity?.title, url) || buildUrlDisplayLabel(url)}`
    : '';
  return `${base}${journalSuffix}${urlSuffix}`.trim();
}

async function logIngestionActivity({ uid, fingerprint, journalId, storyRecords, taskRecords, entryType }) {
  try {
    const db = admin.firestore();
    const batch = db.batch();
    const aggregateRef = db.collection('activity_stream').doc();
    batch.set(aggregateRef, {
      id: aggregateRef.id,
      entityId: journalId || fingerprint,
      entityType: journalId ? 'journal' : 'transcript_ingestion',
      activityType: 'transcript_ingestion',
      userId: uid,
      ownerUid: uid,
      source: 'ai',
      sourceDetails: 'process_text',
      description: `Processed ${entryType || 'transcript'} into ${storyRecords.length} stories and ${taskRecords.length} tasks`,
      metadata: {
        fingerprint,
        entryType: entryType || null,
        journalId: journalId || null,
        stories: storyRecords.map((story) => ({ id: story.id, ref: story.ref, url: story.url || null })),
        tasks: taskRecords.map((task) => ({ id: task.id, ref: task.ref, url: task.url || null })),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    storyRecords
      .filter((story) => story?.existing !== true)
      .forEach((story) => {
        const ref = db.collection('activity_stream').doc();
        batch.set(ref, {
          id: ref.id,
          entityId: story.id,
          entityType: 'story',
          activityType: 'created',
          userId: uid,
          ownerUid: uid,
          source: 'ai',
          sourceDetails: 'process_text',
          referenceNumber: story.ref || story.id,
          description: describeGeneratedEntity(story, 'story', journalId),
          metadata: {
            fingerprint,
            entryType: entryType || null,
            journalId: journalId || null,
            url: story.url || null,
            deepLink: story.deepLink || null,
            title: story.title || null,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

    taskRecords
      .filter((task) => task?.existing !== true)
      .forEach((task) => {
        const ref = db.collection('activity_stream').doc();
        batch.set(ref, {
          id: ref.id,
          entityId: task.id,
          entityType: 'task',
          activityType: 'created',
          userId: uid,
          ownerUid: uid,
          source: 'ai',
          sourceDetails: 'process_text',
          referenceNumber: task.ref || task.id,
          description: describeGeneratedEntity(task, 'task', journalId),
          metadata: {
            fingerprint,
            entryType: entryType || null,
            journalId: journalId || null,
            url: task.url || null,
            deepLink: task.deepLink || null,
            title: task.title || null,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

    await batch.commit();
  } catch (error) {
    console.warn('[transcriptIngestion] activity log failed', error?.message || error);
  }
}

function summarizeEntityRefs(items, label, limit = 3) {
  const refs = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.ref || '').trim())
    .filter(Boolean);
  if (!refs.length) return null;
  const visible = refs.slice(0, limit);
  const prefix = visible.join(', ');
  if (refs.length === 1) return `${label} ${prefix}`;
  return refs.length > limit ? `${prefix} and ${refs.length - limit} more` : prefix;
}

function buildWriteSpokenResponse(response) {
  if (!response || typeof response !== 'object') return 'Text processed.';
  if (response.duplicate) {
    return String(response.message || 'This text was already processed.');
  }

  const taskList = Array.isArray(response.createdTasks) ? response.createdTasks : [];
  const storyList = Array.isArray(response.createdStories) ? response.createdStories : [];
  const newTasks = taskList.filter((task) => task?.existing !== true);
  const existingTasks = taskList.filter((task) => task?.existing === true);
  const newStories = storyList.filter((story) => story?.existing !== true);
  const existingStories = storyList.filter((story) => story?.existing === true);
  const tasks = taskList.length;
  const stories = storyList.length;
  const hasJournal = Boolean(response.hasJournal || response.journalId);
  const parts = [];

  if (hasJournal && tasks === 0 && stories === 0) {
    return 'I created a journal entry.';
  }
  if (hasJournal) {
    parts.push('I created a journal entry.');
  }
  if (newTasks.length) {
    const taskRefs = summarizeEntityRefs(newTasks, 'task');
    parts.push(
      newTasks.length === 1
        ? `I created ${taskRefs}.`
        : `I created ${newTasks.length} tasks: ${taskRefs}.`
    );
  }
  if (newStories.length) {
    const storyRefs = summarizeEntityRefs(newStories, 'story');
    parts.push(
      newStories.length === 1
        ? `I created ${storyRefs}.`
        : `I created ${newStories.length} stories: ${storyRefs}.`
    );
  }
  if (!newTasks.length && existingTasks.length) {
    const taskRefs = summarizeEntityRefs(existingTasks, 'task');
    parts.push(
      existingTasks.length === 1
        ? `I found existing ${taskRefs}.`
        : `I found ${existingTasks.length} existing tasks: ${taskRefs}.`
    );
  }
  if (!newStories.length && existingStories.length) {
    const storyRefs = summarizeEntityRefs(existingStories, 'story');
    parts.push(
      existingStories.length === 1
        ? `I found existing ${storyRefs}.`
        : `I found ${existingStories.length} existing stories: ${storyRefs}.`
    );
  }
  return parts.length ? parts.join(' ') : 'Text processed.';
}

function annotateAgentWriteResponse(response, route) {
  return {
    ...response,
    mode: 'write',
    intent: route?.intent || 'process_text',
    confidence: route?.confidence ?? null,
    spokenResponse: buildWriteSpokenResponse(response),
    actionsExecuted: ['process_text'],
    calendarEvents: [],
  };
}

async function listNextCalendarEvents({ uid, count, timezone }) {
  const calendar = await getGoogleCalendarClient(uid);
  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false,
      maxResults: Math.max(1, Math.min(10, Number(count) || DEFAULT_CALENDAR_QUERY_COUNT)),
    });
    const items = Array.isArray(response?.data?.items) ? response.data.items : [];
    return items.map((event) => formatCalendarEventResponse(event, timezone));
  } catch (error) {
    const status = Number(error?.code || error?.status || error?.response?.status || 0);
    if (status === 401 || status === 403) {
      throw new httpsV2.HttpsError(
        'failed-precondition',
        'Google Calendar access is missing or missing the Calendar scope. Reconnect Google Calendar in Settings.'
      );
    }
    throw error;
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
    const analysis = enrichAnalysisWithUrlMetadata(
      sanitizeAnalysis(rawAnalysis, normalizedTranscript, sourceUrls, timezone),
      sourceUrls,
      urlPreviews
    );
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

    const autoConversions = await autoConvertOversizedTaskRecords({
      db,
      profile,
      fingerprint,
      taskRecords,
      logger,
    });
    if (autoConversions.length) {
      await logger.event('task_auto_convert_complete', 'Transcript oversized tasks auto-converted', {
        count: autoConversions.length,
        conversions: autoConversions,
      });
    }

    const convertedTaskIds = new Set(autoConversions.map((item) => String(item.taskId || '').trim()).filter(Boolean));
    const existingTaskIds = new Set(taskRecords.filter((task) => task?.existing === true).map((task) => String(task.id || '')));
    const existingStoryIds = new Set(storyRecords.filter((story) => story?.existing === true).map((story) => String(story.id || '')));
    const finalTaskIds = dedupeIds(taskRecords.map((task) => task.id).filter((id) => !convertedTaskIds.has(String(id))));
    const finalStoryIds = dedupeIds([
      ...storyRecords.map((story) => story.id),
      ...autoConversions.map((item) => item.storyId),
    ]);

    if (journalRecord && autoConversions.length) {
      await db.collection('journals').doc(journalRecord.id).set({
        taskIds: finalTaskIds,
        storyIds: finalStoryIds,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await logger.event('journal_links_updated', 'Journal links updated after task auto-conversion', {
        journalId: journalRecord.id,
        taskIds: finalTaskIds,
        storyIds: finalStoryIds,
      });
    }

    const [loadedStories, loadedTasks] = await Promise.all([
      loadEntitySummaries(db, 'stories', finalStoryIds, 'story'),
      loadEntitySummaries(db, 'tasks', finalTaskIds, 'task'),
    ]);
    const createdStories = loadedStories.map((story) => ({
      ...story,
      existing: existingStoryIds.has(String(story.id || '')),
    }));
    const createdTasks = loadedTasks.map((task) => ({
      ...task,
      existing: existingTaskIds.has(String(task.id || '')),
    }));

    const emailHtml = buildEmailHtml({
      sections,
      taskRecords: createdTasks,
      storyRecords: createdStories,
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
      storyRecords: createdStories,
      taskRecords: createdTasks,
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

async function processAgentRequest({
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
  const likelyQueryOrAction = looksLikeAgentQueryOrAction(normalizedTranscript);
  let duplicateChecked = false;
  if (!likelyQueryOrAction) {
    duplicateChecked = true;
    const duplicateState = await findExistingProcessedIngestion(db, uid, fingerprint);
    if (duplicateState) {
      console.log('[transcriptIngestion] agent_duplicate_short_circuit', JSON.stringify({
        uid,
        fingerprint,
        source: source || 'transcript',
        channel: channel || 'unknown',
        authMode: authMode || 'unknown',
        sourceProvidedId: sourceProvidedId || null,
        priorStatus: duplicateState.status || null,
      }));
      return annotateAgentWriteResponse(buildDuplicateResponse(duplicateState), {
        intent: 'process_text',
        confidence: 1,
      });
    }
  }

  const { profile } = await resolveProfile(db, uid);
  const timezone = String(
    profile?.timezone ||
    profile?.timeZone ||
    profile?.settings?.timezone ||
    DEFAULT_TIMEZONE
  ).trim() || DEFAULT_TIMEZONE;
  const sourceUrls = extractUrls(normalizedTranscript, sourceUrl);
  const urlPreviews = await fetchUrlPreviews(sourceUrls);
  const rawRoute = await callAgentRouterModel({
    transcript: normalizedTranscript,
    persona: persona || 'personal',
    timezone,
    urlPreviews,
  });
  const route = sanitizeAgentRoute(rawRoute, normalizedTranscript, sourceUrls);
  const effectiveRoute = (
    (route.mode === 'query' && ['query_calendar_next', 'query_top_priorities'].includes(route.intent)) ||
    (route.mode === 'action' && route.intent === 'run_replan')
  )
    ? route
    : (route.intent === 'unknown' || route.mode === 'unknown'
      ? { ...route, intent: 'process_text', mode: 'write' }
      : route);

  console.log('[transcriptIngestion] agent_route', JSON.stringify({
    uid,
    fingerprint,
    source: source || 'transcript',
    channel: channel || 'unknown',
    authMode: authMode || 'unknown',
    sourceProvidedId: sourceProvidedId || null,
    intent: effectiveRoute.intent,
    mode: effectiveRoute.mode,
    confidence: effectiveRoute.confidence,
    calendarQuery: effectiveRoute.calendarQuery,
    topPriorityQuery: effectiveRoute.topPriorityQuery,
    replan: effectiveRoute.replan,
  }));

  if (effectiveRoute.mode === 'write' && !duplicateChecked) {
    const duplicateState = await findExistingProcessedIngestion(db, uid, fingerprint);
    if (duplicateState) {
      console.log('[transcriptIngestion] agent_duplicate_short_circuit', JSON.stringify({
        uid,
        fingerprint,
        source: source || 'transcript',
        channel: channel || 'unknown',
        authMode: authMode || 'unknown',
        sourceProvidedId: sourceProvidedId || null,
        priorStatus: duplicateState.status || null,
        routeIntent: effectiveRoute.intent,
      }));
      return annotateAgentWriteResponse(buildDuplicateResponse(duplicateState), effectiveRoute);
    }
  }

  if (effectiveRoute.mode === 'query' && effectiveRoute.intent === 'query_calendar_next') {
    console.log('[transcriptIngestion] calendar_query_start', JSON.stringify({
      uid,
      fingerprint,
      count: effectiveRoute.calendarQuery.count,
      timezone,
    }));
    const events = await listNextCalendarEvents({
      uid,
      count: effectiveRoute.calendarQuery.count,
      timezone,
    });
    console.log('[transcriptIngestion] calendar_query_complete', JSON.stringify({
      uid,
      fingerprint,
      eventCount: events.length,
    }));
    return buildCalendarQueryResponse({
      intent: effectiveRoute.intent,
      confidence: effectiveRoute.confidence,
      events,
      processedAt: new Date(),
      count: effectiveRoute.calendarQuery.count,
    });
  }

  if (effectiveRoute.mode === 'query' && effectiveRoute.intent === 'query_top_priorities') {
    console.log('[transcriptIngestion] top_priorities_start', JSON.stringify({
      uid,
      fingerprint,
      persona: persona || 'personal',
      count: effectiveRoute.topPriorityQuery.count,
    }));
    const topPriorities = await listTopPriorityItems({
      db,
      uid,
      persona: persona || 'personal',
      timezone,
      count: effectiveRoute.topPriorityQuery.count,
      refresh: true,
    });
    console.log('[transcriptIngestion] top_priorities_complete', JSON.stringify({
      uid,
      fingerprint,
      count: topPriorities.length,
    }));
    return buildTopPrioritiesResponse({
      intent: effectiveRoute.intent,
      confidence: effectiveRoute.confidence,
      items: topPriorities,
      processedAt: new Date(),
    });
  }

  if (effectiveRoute.mode === 'action' && effectiveRoute.intent === 'run_replan') {
    console.log('[transcriptIngestion] replan_start', JSON.stringify({
      uid,
      fingerprint,
      persona: persona || 'personal',
      days: effectiveRoute.replan.days,
    }));
    const summary = await runPlannerFromAgent({
      uid,
      persona: persona || 'personal',
      timezone,
      days: effectiveRoute.replan.days,
    });
    const topPriorities = await listTopPriorityItems({
      db,
      uid,
      persona: persona || 'personal',
      timezone,
      count: DEFAULT_TOP_PRIORITY_COUNT,
      refresh: true,
    });
    console.log('[transcriptIngestion] replan_complete', JSON.stringify({
      uid,
      fingerprint,
      summary,
      topPriorityCount: topPriorities.length,
    }));
    return buildReplanResponse({
      intent: effectiveRoute.intent,
      confidence: effectiveRoute.confidence,
      summary,
      topPriorities,
      processedAt: new Date(),
    });
  }

  console.log('[transcriptIngestion] agent_write_handoff', JSON.stringify({
    uid,
    fingerprint,
    intent: effectiveRoute.intent,
    confidence: effectiveRoute.confidence,
  }));
  const response = await processTranscriptIngestion({
    uid,
    transcript: normalizedTranscript,
    persona,
    source,
    sourceUrl,
    sourceProvidedId,
    channel,
    authMode,
  });
  return annotateAgentWriteResponse(response, effectiveRoute);
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
    transcriptLength: String(req?.data?.transcript || req?.data?.text || '').trim().length,
  }));
  return processAgentRequest({
    uid,
    transcript: String(req?.data?.transcript || req?.data?.text || ''),
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
      transcriptLength: String(req.body?.transcript || req.body?.text || '').trim().length,
    }));
    const result = await processAgentRequest({
      uid: caller.uid,
      transcript: String(req.body?.transcript || req.body?.text || ''),
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

exports.processAgentRequestInternal = processAgentRequest;
