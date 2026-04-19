const httpsV2 = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { google } = require('googleapis');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const { sendEmail } = require('./lib/email');
const { loadThemesForUser, mapThemeLabelToId } = require('./services/themeManager');
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
    aiSummaryBullets: {
      type: 'array',
      items: { type: 'string' },
    },
    structuredEntry: { type: 'string' },
    advice: { type: 'string' },
    mindsetAnalysis: {
      type: 'object',
      nullable: true,
      properties: {
        emotionalTone: { type: 'string' },
        cognitiveStyle: { type: 'string' },
        motivationsAndDrivers: { type: 'string' },
        psychologicalStrengths: { type: 'string' },
        potentialStressors: { type: 'string' },
      },
      required: [
        'emotionalTone',
        'cognitiveStyle',
        'motivationsAndDrivers',
        'psychologicalStrengths',
        'potentialStressors',
      ],
    },
    entryMetadata: {
      type: 'object',
      nullable: true,
      properties: {
        moodScore: { type: 'number' },
        stressLevel: { type: 'number' },
        energyLevel: { type: 'number' },
        primaryThemes: {
          type: 'array',
          items: { type: 'string' },
        },
        cognitiveState: { type: 'string' },
        sentiment: { type: 'string', format: 'enum', enum: ['negative', 'neutral', 'mixed', 'positive'] },
      },
      required: [
        'moodScore',
        'stressLevel',
        'energyLevel',
        'primaryThemes',
        'cognitiveState',
        'sentiment',
      ],
    },
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
  required: [
    'entryType',
    'shouldCreateJournal',
    'oneLineSummary',
    'aiSummaryBullets',
    'structuredEntry',
    'advice',
    'mindsetAnalysis',
    'entryMetadata',
    'stories',
    'tasks',
  ],
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

function escapeJsonStringValue(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function unescapeSingleQuotedJsonFragment(value) {
  return String(value || '')
    .replace(/\\'/g, '\'')
    .replace(/\\"/g, '"');
}

function repairJsonLikeSyntax(text) {
  let repaired = String(text || '');
  if (!repaired) return repaired;

  repaired = repaired
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  repaired = repaired.replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_, prefix, key) => (
    `${prefix}${escapeJsonStringValue(unescapeSingleQuotedJsonFragment(key))}:`
  ));
  repaired = repaired.replace(/([{,]\s*)[“”]([^“”\\]*(?:\\.[^“”\\]*)*)[“”]\s*:/g, (_, prefix, key) => (
    `${prefix}${escapeJsonStringValue(key)}:`
  ));
  repaired = repaired.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/g, '$1"$2":');

  repaired = repaired.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*[,}\]])/g, (_, value) => (
    `: ${escapeJsonStringValue(unescapeSingleQuotedJsonFragment(value))}`
  ));
  repaired = repaired.replace(/:\s*[“”]([^“”\\]*(?:\\.[^“”\\]*)*)[“”](?=\s*[,}\]])/g, (_, value) => (
    `: ${escapeJsonStringValue(value)}`
  ));

  return removeTrailingCommasJsonLike(repaired);
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
  const candidates = Array.from(new Set([
    raw,
    stripped,
    extracted,
    removeTrailingCommasJsonLike(raw),
    removeTrailingCommasJsonLike(stripped),
    extracted ? removeTrailingCommasJsonLike(extracted) : null,
    repairJsonLikeSyntax(raw),
    repairJsonLikeSyntax(stripped),
    extracted ? repairJsonLikeSyntax(extracted) : null,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())));

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

function sanitizeUserJournalPrompt(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 4000);
}

const JOURNAL_SENTIMENTS = ['negative', 'neutral', 'mixed', 'positive'];
const JOURNAL_MINDSET_FIELDS = [
  'emotionalTone',
  'cognitiveStyle',
  'motivationsAndDrivers',
  'psychologicalStrengths',
  'potentialStressors',
];

function clampNumber(value, min, max, fallback = null, decimals = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(max, Math.max(min, numeric));
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

function sanitizeAiSummaryBullets(items, maxItems = 8) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function normalizeJournalSentiment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return JOURNAL_SENTIMENTS.includes(normalized) ? normalized : 'mixed';
}

function normalizeMindsetAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = {};
  for (const field of JOURNAL_MINDSET_FIELDS) {
    result[field] = String(raw?.[field] || '').trim();
  }
  const hasContent = JOURNAL_MINDSET_FIELDS.some((field) => result[field]);
  return hasContent ? result : null;
}

function normalizeEntryMetadata(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const primaryThemes = Array.from(new Set(
    (Array.isArray(raw.primaryThemes) ? raw.primaryThemes : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )).slice(0, 5);

  const normalized = {
    moodScore: clampNumber(raw.moodScore, -5, 5, null, 1),
    stressLevel: clampNumber(raw.stressLevel, 0, 10, null, 1),
    energyLevel: clampNumber(raw.energyLevel, 0, 10, null, 1),
    primaryThemes,
    cognitiveState: String(raw.cognitiveState || '').trim() || null,
    sentiment: normalizeJournalSentiment(raw.sentiment),
  };

  const hasSignal = normalized.moodScore != null
    || normalized.stressLevel != null
    || normalized.energyLevel != null
    || normalized.primaryThemes.length > 0
    || normalized.cognitiveState
    || String(raw.sentiment || '').trim();
  return hasSignal ? normalized : null;
}

function mergeAiSummaryBullets(existingBullets, nextBullets) {
  return sanitizeAiSummaryBullets([...(Array.isArray(existingBullets) ? existingBullets : []), ...(Array.isArray(nextBullets) ? nextBullets : [])], 12);
}

function mergeMindsetAnalysis(existingAnalysis, nextAnalysis) {
  const existing = normalizeMindsetAnalysis(existingAnalysis);
  const next = normalizeMindsetAnalysis(nextAnalysis);
  if (!existing) return next;
  if (!next) return existing;
  const merged = {};
  for (const field of JOURNAL_MINDSET_FIELDS) {
    merged[field] = mergeDistinctText(existing[field], next[field]);
  }
  return merged;
}

function mergeEntryMetadata(existingMetadata, nextMetadata, previousEntryCount = 0) {
  const existing = normalizeEntryMetadata(existingMetadata);
  const next = normalizeEntryMetadata(nextMetadata);
  if (!existing) return next;
  if (!next) return existing;

  const weight = Math.max(1, Number(previousEntryCount || 0));
  const averageMetric = (existingValue, nextValue, min, max) => {
    if (existingValue == null && nextValue == null) return null;
    if (existingValue == null) return nextValue;
    if (nextValue == null) return existingValue;
    return clampNumber(((existingValue * weight) + nextValue) / (weight + 1), min, max, null, 1);
  };

  return {
    moodScore: averageMetric(existing.moodScore, next.moodScore, -5, 5),
    stressLevel: averageMetric(existing.stressLevel, next.stressLevel, 0, 10),
    energyLevel: averageMetric(existing.energyLevel, next.energyLevel, 0, 10),
    primaryThemes: Array.from(new Set([...(existing.primaryThemes || []), ...(next.primaryThemes || [])])).slice(0, 5),
    cognitiveState: next.cognitiveState || existing.cognitiveState || null,
    sentiment: next.sentiment || existing.sentiment || 'mixed',
  };
}

function createGeminiJsonModel(apiKey, { schema, maxOutputTokens, temperature, topP, topK }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ],
    generationConfig: {
      temperature,
      topP,
      topK,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });
}

async function generateGeminiJsonText(model, prompt, emptyMessage) {
  const response = await model.generateContent(prompt);
  const text = response?.response?.text?.();
  if (!text) throw new Error(emptyMessage);
  return text;
}

async function repairGeminiJsonResponse({
  apiKey,
  malformedText,
  parseError,
  schema,
  label,
  maxOutputTokens,
}) {
  const system = [
    'You repair malformed JSON generated by another model call.',
    'Return STRICT valid JSON only.',
    'Do not wrap the response in markdown.',
    'Do not add commentary.',
    'Preserve the original fields and values whenever possible.',
    'If a field is missing or malformed, supply the smallest safe value that matches the schema.',
  ].join('\n');
  const user = [
    `Label: ${label}`,
    `Parse error: ${parseError?.message || 'Unknown parse error'}`,
    'Malformed JSON:',
    malformedText,
  ].join('\n\n');

  const model = createGeminiJsonModel(apiKey, {
    schema,
    maxOutputTokens,
    temperature: 0,
    topP: 0.1,
    topK: 1,
  });
  const text = await generateGeminiJsonText(model, `${system}\n\n${user}`, `${label} repair returned empty JSON`);
  return parseModelJson(text, `${label} repair response`);
}

function createIngestionLogger({ lockRef, uid, fingerprint, source, channel, authMode }) {
  const base = {
    uid,
    ownerUid: uid,
    fingerprint,
    source: source || 'transcript',
    channel: channel || 'unknown',
    authMode: authMode || 'unknown',
    lockId: lockRef.id,
    ingestionId: lockRef.id,
  };

  return {
    async event(stage, message, data = null, level = 'info', { raw = false } = {}) {
      const payload = {
        ...base,
        stage,
        level,
        message,
        data: raw ? data : summarizeForLog(data),
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

function timestampToMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  }
  if (typeof value?.seconds === 'number') {
    const nanos = typeof value?.nanoseconds === 'number' ? value.nanoseconds : 0;
    return (value.seconds * 1000) + Math.round(nanos / 1e6);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const ENTITY_MATCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'get', 'i', 'if', 'in', 'into', 'it',
  'its', 'me', 'my', 'of', 'on', 'or', 'our', 'out', 'set', 'start', 'the', 'then',
  'to', 'up', 'via', 'we', 'with', 'work',
]);

const ENTITY_MATCH_CANONICAL_TOKENS = new Map([
  ['cleanup', 'clean'],
  ['cleaning', 'clean'],
  ['cleaned', 'clean'],
  ['tidy', 'clean'],
  ['tidied', 'clean'],
  ['tidying', 'clean'],
  ['wash', 'clean'],
  ['washed', 'clean'],
  ['washing', 'clean'],
  ['emailing', 'email'],
  ['emailed', 'email'],
  ['mail', 'email'],
  ['mailed', 'email'],
  ['mailing', 'email'],
  ['message', 'email'],
  ['messaged', 'email'],
  ['messaging', 'email'],
  ['ping', 'email'],
  ['pinged', 'email'],
  ['pinging', 'email'],
  ['wrote', 'email'],
  ['write', 'email'],
  ['writing', 'email'],
  ['drop', 'email'],
  ['housework', 'house'],
  ['home', 'house'],
  ['flat', 'house'],
  ['vehicle', 'car'],
  ['motor', 'car'],
]);

function canonicalizeEntityMatchText(value) {
  return normalizeTitle(value)
    .replace(/\b(clean|tidy|wash)\s+up\b/g, '$1')
    .replace(/\bdrop\s+([a-z0-9]+)\s+an?\s+email\b/g, 'email $1')
    .replace(/\bsend\s+([a-z0-9]+)\s+an?\s+email\b/g, 'email $1')
    .trim();
}

function normalizeMatchToken(token) {
  const cleaned = String(token || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  if (!cleaned) return '';
  if (cleaned.endsWith('ies') && cleaned.length > 4) return `${cleaned.slice(0, -3)}y`;
  if (cleaned.endsWith('sses') && cleaned.length > 5) return cleaned.slice(0, -2);
  const singular = cleaned.endsWith('s') && !cleaned.endsWith('ss') && cleaned.length > 4
    ? cleaned.slice(0, -1)
    : cleaned;
  return ENTITY_MATCH_CANONICAL_TOKENS.get(singular) || singular;
}

function buildEntityMatchTokens(value) {
  return Array.from(new Set(
    canonicalizeEntityMatchText(value)
      .split(/[^a-z0-9]+/i)
      .map((token) => normalizeMatchToken(token))
      .filter((token) => token && token.length >= 3 && !ENTITY_MATCH_STOPWORDS.has(token))
  ));
}

function computeEntityTitleMatch(inputTitle, candidateTitle) {
  const inputNormalized = normalizeTitle(inputTitle);
  const candidateNormalized = normalizeTitle(candidateTitle);
  if (!inputNormalized || !candidateNormalized) {
    return { score: 0, sharedCount: 0, contains: false };
  }
  if (inputNormalized === candidateNormalized) {
    return { score: 1, sharedCount: Math.max(1, buildEntityMatchTokens(inputNormalized).length), contains: true };
  }

  const contains = inputNormalized.includes(candidateNormalized) || candidateNormalized.includes(inputNormalized);
  const inputTokens = buildEntityMatchTokens(inputNormalized);
  const candidateTokens = buildEntityMatchTokens(candidateNormalized);
  if (!inputTokens.length || !candidateTokens.length) {
    return { score: contains ? 0.7 : 0, sharedCount: 0, contains };
  }

  const candidateSet = new Set(candidateTokens);
  const sharedCount = inputTokens.filter((token) => candidateSet.has(token)).length;
  if (sharedCount < 2 && !contains) {
    return { score: 0, sharedCount, contains };
  }

  const coverage = sharedCount / Math.max(1, Math.min(inputTokens.length, candidateTokens.length));
  const unionSize = new Set([...inputTokens, ...candidateTokens]).size || 1;
  const jaccard = sharedCount / unionSize;
  let score = coverage * 0.72 + jaccard * 0.28;
  if (contains) score += 0.08;
  if (sharedCount >= 3) score += 0.05;
  if (sharedCount >= 2 && Math.min(inputTokens.length, candidateTokens.length) <= 3) score += 0.12;
  return {
    score: Math.min(1, score),
    sharedCount,
    contains,
  };
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

function isYouTubeUrl(url) {
  const normalized = normalizeUrlValue(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    return [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
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

function inferConsumptionSubtype(kind, { title = '', description = '', siteName = '', authorName = '', url = '' } = {}) {
  const haystack = `${title} ${description} ${siteName} ${authorName}`.toLowerCase();
  if (kind === 'watch') {
    if (
      isYouTubeUrl(url) && (
        /\b(music video|official video|official music video|lyric video|audio|remix|dj set|live set|mix|summer vibes|vevo)\b/.test(haystack) ||
        /\b(house|techno|trance|dance|afro house|playlist|album|song)\b/.test(haystack)
      )
    ) return 'music video';
    if (/\b(trailer|teaser)\b/.test(haystack)) return 'trailer';
    if (/\b(tutorial|how to|walkthrough|guide)\b/.test(haystack)) return 'tutorial';
    if (/\b(podcast|episode)\b/.test(haystack)) return 'podcast';
    if (/\b(interview)\b/.test(haystack)) return 'interview';
    if (/\b(documentary|docuseries)\b/.test(haystack)) return 'documentary';
    if (/\b(talk|lecture|keynote|presentation)\b/.test(haystack)) return 'talk';
    return 'video';
  }
  if (kind === 'read') {
    if (/\b(api|documentation|docs|reference|manual|guide)\b/.test(haystack)) return 'documentation';
    if (/\b(newsletter|substack)\b/.test(haystack)) return 'newsletter';
    if (/\b(paper|study|research|preprint|journal)\b/.test(haystack)) return 'paper';
    return 'article';
  }
  return null;
}

function buildMeaningfulConsumptionTitle(kind, previewTitle, url = '', options = {}) {
  const cleanTitle = cleanPreviewTitle(previewTitle, url) || deriveTitleFromUrl(url, kind);
  const subtype = inferConsumptionSubtype(kind, {
    title: cleanTitle,
    description: options.description || '',
    siteName: options.siteName || '',
    authorName: options.authorName || '',
    url,
  });

  if (kind === 'watch') {
    if (subtype === 'music video') return 'Watch music video';
    if (subtype === 'trailer') return 'Watch trailer';
    if (subtype === 'tutorial') return 'Watch tutorial';
    if (subtype === 'podcast') return 'Watch podcast episode';
    if (subtype === 'interview') return 'Watch interview';
    if (subtype === 'documentary') return 'Watch documentary';
    if (subtype === 'talk') return 'Watch talk';
    return `Watch: ${cleanTitle}`.slice(0, 140);
  }
  if (kind === 'read') {
    if (subtype === 'documentation') return `Read docs: ${cleanTitle}`.slice(0, 140);
    if (subtype === 'newsletter') return `Read newsletter: ${cleanTitle}`.slice(0, 140);
    if (subtype === 'paper') return `Read paper: ${cleanTitle}`.slice(0, 140);
    return `Read: ${cleanTitle}`.slice(0, 140);
  }
  return cleanTitle.slice(0, 140);
}

function buildMeaningfulConsumptionDescription(kind, previewTitle, url = '', options = {}) {
  const cleanTitle = cleanPreviewTitle(previewTitle, url) || deriveTitleFromUrl(url, kind);
  const description = String(options.description || '').replace(/\s+/g, ' ').trim();
  const siteName = cleanPreviewTitle(options.siteName || '', url) || '';
  const authorName = String(options.authorName || '').replace(/\s+/g, ' ').trim();
  const subtype = inferConsumptionSubtype(kind, {
    title: cleanTitle,
    description,
    siteName,
    authorName,
    url,
  });

  if (kind === 'watch') {
    const subject = subtype === 'music video' ? 'music video' : subtype || 'video';
    const siteLabel = siteName || (isYouTubeUrl(url) ? 'YouTube' : '');
    const sourcePart = siteLabel ? ` on ${siteLabel}` : '';
    const authorPart = authorName ? ` by ${authorName}` : '';
    return `Watch the ${subject} "${cleanTitle}"${authorPart}${sourcePart}.`.slice(0, 400);
  }
  if (kind === 'read') {
    const subject = subtype === 'documentation' ? 'documentation' : subtype || 'article';
    const siteLabel = siteName ? ` on ${siteName}` : '';
    const summary = description && normalizeTitle(description) !== normalizeTitle(cleanTitle)
      ? ` ${description}`.slice(0, 220)
      : '';
    return `Read the ${subject} "${cleanTitle}"${siteLabel}.${summary}`.trim().slice(0, 400);
  }
  return description || cleanTitle;
}

function inferUrlTheme(kind, url = '', options = {}) {
  const cleanTitle = cleanPreviewTitle(options.title || '', url) || '';
  const subtype = inferConsumptionSubtype(kind, {
    title: cleanTitle,
    description: options.description || '',
    siteName: options.siteName || '',
    authorName: options.authorName || '',
    url,
  });
  if (isYouTubeUrl(url)) return 'Hobbies & Interests';
  if (kind === 'watch' && subtype === 'music video') return 'Hobbies & Interests';
  return null;
}

function normalizeThemeForCatalog(rawTheme, userThemes = [], fallback = 'General') {
  const availableThemes = Array.isArray(userThemes) && userThemes.length ? userThemes : undefined;
  const desired = String(rawTheme || '').trim() || fallback;
  const themeId = mapThemeLabelToId(desired, availableThemes);
  const themeRecord = Array.isArray(availableThemes)
    ? availableThemes.find((theme) => String(theme?.id ?? '').trim() === String(themeId ?? '').trim())
    : null;
  const themeLabel = String(
    themeRecord?.label ||
    themeRecord?.name ||
    themeId ||
    fallback
  ).trim() || fallback;
  return {
    theme: themeLabel,
    themeId,
  };
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
    authorName: null,
    textSnippet: null,
    kindHint: isLikelyVideoUrl(normalizedUrl) ? 'watch' : 'read',
  };
  const applyYouTubeOEmbedFallback = async () => {
    if (!isYouTubeUrl(normalizedUrl)) return;
    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`;
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'user-agent': 'BOB Transcript Intake/1.0',
          accept: 'application/json',
        },
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      const title = cleanPreviewTitle(payload?.title, normalizedUrl);
      if (title) preview.title = title;
      preview.siteName = cleanPreviewTitle(payload?.provider_name, normalizedUrl) || preview.siteName || 'YouTube';
      preview.authorName = String(payload?.author_name || '').trim() || preview.authorName || null;
      if (!preview.description) {
        const author = String(payload?.author_name || '').trim();
        preview.description = author ? `YouTube video by ${author}.` : 'YouTube video.';
      }
      if (!preview.textSnippet) {
        preview.textSnippet = preview.description;
      }
      preview.kindHint = 'watch';
    } catch {
      // Ignore oEmbed fallback failures and keep the generic preview.
    }
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
    const rawAuthor = (
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      ''
    );
    const ogType = String($('meta[property="og:type"]').attr('content') || '').trim().toLowerCase();
    preview.title = cleanPreviewTitle(rawTitle, normalizedUrl);
    preview.description = (
      String(rawDescription || '')
    ).trim().slice(0, 400) || null;
    preview.siteName = cleanPreviewTitle(rawSiteName, normalizedUrl);
    preview.authorName = String(rawAuthor || '').trim() || null;
    preview.textSnippet = String(rawDescription || '').replace(/\s+/g, ' ').trim().slice(0, 240) || null;
    preview.kindHint = ogType.includes('video') || isLikelyVideoUrl(normalizedUrl) ? 'watch' : 'read';
    if (!preview.title || isGenericConsumptionTitle(preview.title, preview.kindHint)) {
      await applyYouTubeOEmbedFallback();
    }
    return preview;
  } catch {
    await applyYouTubeOEmbedFallback();
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
  const resolvedKind = !treatAsStory && kind === 'task' && preview?.kindHint && normalizedUrl
    ? preview.kindHint
    : kind;
  const existingTitle = String(entity?.title || '').trim();
  const next = {
    ...entity,
    url: normalizedUrl,
  };
  const shouldForcePreviewName = !treatAsStory && normalizedUrl && ['read', 'watch'].includes(resolvedKind);
  const shouldForcePreviewDescription = shouldForcePreviewName && Boolean(previewTitle || previewDescription);

  if (previewTitle) {
    const normalizedPreviewTitle = normalizeTitle(previewTitle);
    const normalizedEntityTitle = normalizeTitle(existingTitle);
    const needsPreviewName = (
      !existingTitle ||
      isGenericConsumptionTitle(existingTitle, resolvedKind) ||
      (resolvedKind !== 'task' && normalizedPreviewTitle && !normalizedEntityTitle.includes(normalizedPreviewTitle))
    );
    if (needsPreviewName || shouldForcePreviewName) {
      next.title = treatAsStory
        ? previewTitle.slice(0, 140)
        : buildMeaningfulConsumptionTitle(resolvedKind, previewTitle, normalizedUrl, {
          description: previewDescription,
          siteName: preview?.siteName || '',
          authorName: preview?.authorName || '',
        });
    }
  }

  if (previewDescription && (
    shouldForcePreviewDescription ||
    !next.description ||
    isGenericDescription(next.description)
  )) {
    next.description = buildMeaningfulConsumptionDescription(resolvedKind, previewTitle, normalizedUrl, {
      description: previewDescription,
      siteName: preview?.siteName || '',
      authorName: preview?.authorName || '',
    });
  }

  const inferredTheme = inferUrlTheme(resolvedKind, normalizedUrl, {
    title: previewTitle,
    description: previewDescription,
    siteName: preview?.siteName || '',
    authorName: preview?.authorName || '',
  });
  if (inferredTheme) {
    next.theme = inferredTheme;
  }

  if (!treatAsStory && resolvedKind !== kind) {
    next.kind = resolvedKind;
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
  const now = DateTime.now().setZone(zone);
  const dateHeading = now.setLocale('en-GB').toLocaleString(DateTime.DATE_FULL);
  const oneLineSummary = String(analysis?.oneLineSummary || '').trim() || 'Transcript summary';
  const aiSummaryBullets = sanitizeAiSummaryBullets(analysis?.aiSummaryBullets, 8);
  const structuredEntry = String(analysis?.structuredEntry || '').trim() || String(originalTranscript || '').trim();
  const advice = String(analysis?.advice || '').trim() || 'No additional advice generated.';
  const mindsetAnalysis = normalizeMindsetAnalysis(analysis?.mindsetAnalysis);
  const entryMetadata = normalizeEntryMetadata(analysis?.entryMetadata);
  const fullTranscript = String(originalTranscript || '').trim();
  return {
    journalDateKey: now.toISODate(),
    dateHeading,
    oneLineSummary,
    aiSummaryBullets,
    structuredEntry,
    advice,
    mindsetAnalysis,
    entryMetadata,
    fullTranscript,
  };
}

function serializeSections(sections) {
  return {
    journalDateKey: sections?.journalDateKey || null,
    dateHeading: sections?.dateHeading || null,
    oneLineSummary: sections?.oneLineSummary || null,
    aiSummaryBullets: Array.isArray(sections?.aiSummaryBullets) ? sections.aiSummaryBullets : [],
    structuredEntry: sections?.structuredEntry || null,
    advice: sections?.advice || null,
    mindsetAnalysis: normalizeMindsetAnalysis(sections?.mindsetAnalysis),
    entryMetadata: normalizeEntryMetadata(sections?.entryMetadata),
    fullTranscript: sections?.fullTranscript || null,
  };
}

function buildStableJournalDayId(uid, journalDateKey) {
  const compactDate = String(journalDateKey || '').replace(/[^0-9]/g, '');
  return `journal_${uid}_${compactDate || 'day'}`;
}

function mergeDistinctText(existingValue, nextValue) {
  const existing = String(existingValue || '').trim();
  const next = String(nextValue || '').trim();
  if (!existing) return next;
  if (!next) return existing;
  if (existing === next || existing.includes(next)) return existing;
  if (next.includes(existing)) return next;
  return `${existing}\n\n${next}`;
}

function mergeUniqueStrings(...groups) {
  return Array.from(new Set(groups.flatMap((group) => (
    Array.isArray(group) ? group.map((item) => String(item || '').trim()).filter(Boolean) : []
  ))));
}

function mergeJournalEntryType(existingType, nextType, storyRecords, taskRecords) {
  if (String(existingType || '').trim().toLowerCase() === 'mixed') return 'mixed';
  if (String(nextType || '').trim().toLowerCase() === 'mixed') return 'mixed';
  return (Array.isArray(storyRecords) && storyRecords.length) || (Array.isArray(taskRecords) && taskRecords.length)
    ? 'mixed'
    : 'journal';
}

async function findExistingJournalForDate({ db, uid, persona, sections }) {
  const journalDateKey = String(sections?.journalDateKey || '').trim();
  const dateHeading = String(sections?.dateHeading || '').trim();
  const dailyId = buildStableJournalDayId(uid, journalDateKey);
  const dailySnap = await db.collection('journals').doc(dailyId).get();
  if (dailySnap.exists) {
    return { id: dailySnap.id, data: dailySnap.data() || {}, existed: true, matchType: 'daily_id' };
  }

  const queries = [
    db.collection('journals')
      .where('ownerUid', '==', uid)
      .where('persona', '==', persona)
      .where('journalDateKey', '==', journalDateKey)
      .limit(1),
    db.collection('journals')
      .where('ownerUid', '==', uid)
      .where('persona', '==', persona)
      .where('dateHeading', '==', dateHeading)
      .limit(1),
  ];

  for (const candidateQuery of queries) {
    try {
      const snap = await candidateQuery.get();
      if (!snap.empty) {
        const match = snap.docs[0];
        return { id: match.id, data: match.data() || {}, existed: true, matchType: 'query_match' };
      }
    } catch (error) {
      console.warn('[transcriptIngestion] findExistingJournalForDate failed', error?.message || error);
    }
  }

  return { id: dailyId, data: null, existed: false, matchType: 'new_daily_id' };
}

function buildDocAppendPlan(sections, options = {}) {
  const includeDateHeading = options?.includeDateHeading !== false;
  const textParts = [];
  const headingRanges = [];
  const bulletRanges = [];
  let cursor = 0;

  const pushText = (value) => {
    const text = String(value || '');
    textParts.push(text);
    cursor += text.length;
  };

  const pushHeading = (value, namedStyleType) => {
    const text = `${String(value || '').trim()}\n`;
    const start = cursor;
    pushText(text);
    headingRanges.push({
      start,
      end: start + text.length,
      namedStyleType,
    });
  };

  if (includeDateHeading) {
    pushHeading(sections.dateHeading, 'HEADING_1');
  }
  pushText(`${sections.oneLineSummary}\n`);

  if (Array.isArray(sections.aiSummaryBullets) && sections.aiSummaryBullets.length) {
    pushHeading('AI Summary of the Entry', 'HEADING_2');
    const bulletStart = cursor;
    pushText(`${sections.aiSummaryBullets.join('\n')}\n\n`);
    bulletRanges.push({ start: bulletStart, end: cursor - 2 });
  }

  pushHeading('The Entry', 'HEADING_2');
  pushText(`${sections.structuredEntry}\n\n`);

  if (sections.mindsetAnalysis) {
    pushHeading('Analysis of the Author\'s Mindset', 'HEADING_2');
    if (sections.mindsetAnalysis.emotionalTone) {
      pushHeading('Emotional Tone', 'HEADING_3');
      pushText(`${sections.mindsetAnalysis.emotionalTone}\n\n`);
    }
    if (sections.mindsetAnalysis.cognitiveStyle) {
      pushHeading('Cognitive Style', 'HEADING_3');
      pushText(`${sections.mindsetAnalysis.cognitiveStyle}\n\n`);
    }
    if (sections.mindsetAnalysis.motivationsAndDrivers) {
      pushHeading('Motivations and Internal Drivers', 'HEADING_3');
      pushText(`${sections.mindsetAnalysis.motivationsAndDrivers}\n\n`);
    }
    if (sections.mindsetAnalysis.psychologicalStrengths) {
      pushHeading('Psychological Strengths Observed', 'HEADING_3');
      pushText(`${sections.mindsetAnalysis.psychologicalStrengths}\n\n`);
    }
    if (sections.mindsetAnalysis.potentialStressors) {
      pushHeading('Potential Stressors or Pressures', 'HEADING_3');
      pushText(`${sections.mindsetAnalysis.potentialStressors}\n\n`);
    }
  }

  pushHeading('Advice', 'HEADING_2');
  pushText(`${sections.advice}\n\n`);

  pushHeading('Full Transcript', 'HEADING_2');
  pushText(`${sections.fullTranscript}\n\n`);

  if (sections.entryMetadata) {
    pushHeading('Entry Metadata', 'HEADING_2');
    pushText(
      [
        `MoodScore: ${sections.entryMetadata.moodScore ?? '—'}`,
        `StressLevel: ${sections.entryMetadata.stressLevel ?? '—'}`,
        `EnergyLevel: ${sections.entryMetadata.energyLevel ?? '—'}`,
        `PrimaryThemes: ${Array.isArray(sections.entryMetadata.primaryThemes) && sections.entryMetadata.primaryThemes.length ? sections.entryMetadata.primaryThemes.join(', ') : '—'}`,
        `CognitiveState: ${sections.entryMetadata.cognitiveState || '—'}`,
        `Sentiment: ${sections.entryMetadata.sentiment || '—'}`,
      ].join('\n') + '\n\n'
    );
  }

  return {
    text: textParts.join(''),
    includeDateHeading,
    headingRanges,
    bulletRanges,
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

  const model = createGeminiJsonModel(apiKey, {
    schema: ROUTER_RESPONSE_SCHEMA,
    maxOutputTokens: 1024,
    temperature: 0.1,
    topP: 0.9,
    topK: 40,
  });
  const text = await generateGeminiJsonText(model, `${system}\n\n${user}`, 'Gemini returned an empty routing response');
  return parseModelJson(text, 'Gemini routing response');
}

async function callTranscriptModel({ transcript, persona, timezone, urlPreviews, logger = null, journalPromptOverride = '' }) {
  const apiKey = String(process.env.GOOGLEAISTUDIOAPIKEY || '').trim();
  if (!apiKey) throw new Error('GOOGLEAISTUDIOAPIKEY not configured');
  const currentDate = DateTime.now().setZone(timezone || DEFAULT_TIMEZONE);
  const customJournalPrompt = sanitizeUserJournalPrompt(journalPromptOverride);

  const systemParts = [
    'You process voice-note transcripts for a productivity app.',
    'Return STRICT JSON only with this shape:',
    '{',
    '  "entryType": "journal"|"task_list"|"url_only"|"mixed",',
    '  "shouldCreateJournal": boolean,',
    '  "oneLineSummary": string,',
    '  "aiSummaryBullets": string[],',
    '  "structuredEntry": string,',
    '  "advice": string,',
    '  "mindsetAnalysis": {',
    '    "emotionalTone": string,',
    '    "cognitiveStyle": string,',
    '    "motivationsAndDrivers": string,',
    '    "psychologicalStrengths": string,',
    '    "potentialStressors": string',
    '  }|null,',
    '  "entryMetadata": {',
    '    "moodScore": number,',
    '    "stressLevel": number,',
    '    "energyLevel": number,',
    '    "primaryThemes": string[],',
    '    "cognitiveState": string,',
    '    "sentiment": "negative"|"neutral"|"mixed"|"positive"',
    '  }|null,',
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
    'If the text is mainly a task brain dump, product requirement list, backlog grooming note, or feature request with action items, use entryType="task_list" even if it contains repetition or a little incidental personal narrative.',
    'If the input is mainly application logs, console output, stack traces, diagnostics, or error dumps, use entryType="task_list" and do NOT create a journal entry.',
    'For application logs, console output, stack traces, diagnostics, or error dumps, do not create tasks or stories unless the user explicitly asks you to investigate, debug, fix, or resolve something.',
    'Do not create a journal entry just because the speaker is thinking out loud while listing tasks.',
    'For entryType="journal" or entryType="mixed", act as a professional journal editor.',
    'Use UK English spelling and grammar for journal prose and analysis.',
    'Turn raw spoken thoughts into cohesive first-person journal prose while staying faithful to the speaker\'s meaning, chronology, and tone.',
    'Remove filler words, false starts, repeated dictation fragments, and obvious transcription artifacts such as "um", "uh", "#um", duplicated partial phrases, and speech-to-text glitches when they do not change meaning.',
    'Keep the journal entry emotionally honest and detailed, but make it readable and well-structured with clear paragraphs when the topic shifts.',
    [
      'Keep structuredEntry 99% faithful to the transcript.',
      'Fix punctuation, capitalization, and obvious dictation errors only.',
    ].join(' '),
    'Do not invent facts, commitments, or emotions that are not present.',
    'The oneLineSummary must be 2–3 sentences under 280 characters — a rich summary, not just a title.',
    'For journal or mixed entries, aiSummaryBullets must contain 4 to 8 concise bullets covering key events, emotional themes, context, and notable thinking patterns.',
    'For task_list or url_only entries, set aiSummaryBullets to an empty array, mindsetAnalysis to null, and entryMetadata to null.',
    'For journal or mixed entries, mindsetAnalysis must stay analytical and observational. Do not make medical diagnoses.',
    'Use mindsetAnalysis.emotionalTone to describe the dominant emotional tone in the language.',
    'Use mindsetAnalysis.cognitiveStyle to describe how the author processes experience, such as reflective, analytical, ruminative, rational, or problem-solving.',
    'Use mindsetAnalysis.motivationsAndDrivers to describe what appears to be motivating the author.',
    'Use mindsetAnalysis.psychologicalStrengths to identify strengths such as self-awareness, resilience, reflection, or emotional regulation.',
    'Use mindsetAnalysis.potentialStressors to identify pressures or challenges evident in the text.',
    'For journal or mixed entries, entryMetadata must be grounded only in the transcript and fit these ranges: moodScore -5 to 5, stressLevel 0 to 10, energyLevel 0 to 10.',
    'entryMetadata.primaryThemes must contain up to 5 short themes.',
    'entryMetadata.cognitiveState should be a short description like reflective, analytical, overwhelmed, problem-solving, grieving, calm, or frustrated.',
    'Do not put AI summary bullets, mindset analysis, or entry metadata inside structuredEntry.',
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
  ];
  if (customJournalPrompt) {
    systemParts.push(
      'Additional user journal editing instructions:',
      customJournalPrompt,
      'Apply the additional user journal editing instructions only when processing journal or mixed entries.',
      'Do not violate the JSON schema, do not invent facts, and remain faithful to the transcript.'
    );
  }
  const system = systemParts.join('\n');

  const user = [
    `Persona: ${persona || 'personal'}`,
    `Timezone: ${timezone || DEFAULT_TIMEZONE}`,
    `Current local date: ${currentDate.toISODate()} (${currentDate.toLocaleString(DateTime.DATE_FULL)})`,
    urlPreviews?.length ? `Resolved URL previews:\n${JSON.stringify(urlPreviews, null, 2)}` : null,
    'Transcript:',
    transcript,
  ].filter(Boolean).join('\n\n');

  if (logger) {
    await logger.event('llm_prompt_sent', 'Sending prompt to Gemini', {
      systemPrompt: system,
      userPrompt: user,
      promptCharCount: system.length + user.length,
    }, 'info', { raw: true });
  }

  const model = createGeminiJsonModel(apiKey, {
    schema: TRANSCRIPT_ANALYSIS_SCHEMA,
    maxOutputTokens: 8192,
    temperature: 0.2,
    topP: 0.95,
    topK: 40,
  });
  const text = await generateGeminiJsonText(model, `${system}\n\n${user}`, 'Gemini returned an empty response');

  if (logger) {
    await logger.event('llm_response_raw', 'Gemini response received', {
      rawResponse: text,
      responseCharCount: text?.length ?? 0,
    }, 'info', { raw: true });
  }
  try {
    return parseModelJson(text, 'Gemini transcript analysis response');
  } catch (parseError) {
    if (logger) {
      await logger.event('analysis_json_repair_start', 'Gemini transcript analysis returned malformed JSON; attempting repair', {
        error: parseError?.message || String(parseError),
        rawResponse: text,
      }, 'warn');
    }
    try {
      const repaired = await repairGeminiJsonResponse({
        apiKey,
        malformedText: text,
        parseError,
        schema: TRANSCRIPT_ANALYSIS_SCHEMA,
        label: 'Gemini transcript analysis response',
        maxOutputTokens: 8192,
      });
      if (logger) {
        await logger.event('analysis_json_repair_complete', 'Gemini transcript analysis JSON repair succeeded', {
          recovered: true,
        });
      }
      return repaired;
    } catch (repairError) {
      if (logger) {
        await logger.event('analysis_json_repair_failed', 'Gemini transcript analysis JSON repair failed', {
          parseError: parseError?.message || String(parseError),
          repairError: repairError?.message || String(repairError),
        }, 'error');
      }
      throw new Error(
        `Gemini transcript analysis response could not be repaired. Parse error: ${parseError?.message || 'Unknown parse error'}. Repair error: ${repairError?.message || 'Unknown repair error'}`
      );
    }
  }
}

function stripUrlsForHeuristics(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s<>"')]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeAgentQueryOrAction(text) {
  return (
    looksLikeCalendarQuery(text) ||
    looksLikeTopPriorityQuery(text) ||
    looksLikeReplanCommand(text)
  );
}

function looksLikeTaskBrainDump(text) {
  const lowered = stripUrlsForHeuristics(text).toLowerCase();
  if (!lowered) return false;

  let score = 0;
  if (/\b(task list|to do list|todo list|brain dump of tasks|brain dump|list of things to do)\b/.test(lowered)) score += 3;
  if (/\b(for today|today's tasks|my tasks for today|additional things for today)\b/.test(lowered)) score += 2;
  if (/\b(i want to|i need to|it would be good to|if i get time|also i'd like to)\b/.test(lowered)) score += 1;
  if ((lowered.match(/\bi want to\b/g) || []).length >= 3) score += 2;
  if ((lowered.match(/\bi need to\b/g) || []).length >= 2) score += 2;
  if ((lowered.match(/\balso\b/g) || []).length >= 3) score += 1;
  if (/\b(requirement|requirements|bulk paste tasks|extract all of the tasks)\b/.test(lowered)) score += 2;

  return score >= 4;
}

function looksLikeDiagnosticLogDump(text) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  const lowered = raw.toLowerCase();
  let score = 0;

  if (/\[(log|info|warn|warning|error|debug)\]/i.test(raw)) score += 2;
  if ((raw.match(/\[(log|info|warn|warning|error|debug)\]/ig) || []).length >= 4) score += 3;
  if (/firebaseerror|permission-denied|uncaught error in snapshot listener|stack trace|exception|traceback/i.test(raw)) score += 3;
  if (/@firebase\/firestore|firestore \(\d+\.\d+\.\d+\)|main\.[a-z0-9]+\.(js|css)/i.test(raw)) score += 2;
  if (/(^|\s)(at\s+[^\n]+:\d+:\d+|\w+\s+\(main\.[a-z0-9]+\.(js|css):\d+:\d+\))/im.test(raw)) score += 2;
  if (/\b(console|snapshot listener|permission|missing or insufficient permissions|route changed|location changed|rendering)\b/i.test(raw)) score += 2;
  if ((raw.match(/\b(line \d+|\d+:\d+)\b/g) || []).length >= 4) score += 1;
  if ((lowered.match(/\bobject\b/g) || []).length >= 4) score += 1;

  return score >= 5;
}

function looksLikeExplicitDiagnosticAction(text) {
  const lowered = String(text || '').toLowerCase();
  if (!lowered.trim()) return false;
  return /\b(fix|resolve|investigate|debug|look into|check|triage|diagnose|why is|why was|help me|can you|please|find out)\b/.test(lowered);
}

function countHeuristicWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function looksLikeCalendarQuery(text) {
  const lowered = stripUrlsForHeuristics(text).toLowerCase();
  if (!lowered || looksLikeTaskBrainDump(text)) return false;
  if (countHeuristicWords(lowered) > 40) return false;
  return /\b(what('| i)?s next on (my )?(calendar|schedule|agenda)|what is next on (my )?(calendar|schedule|agenda)|what do i have (next|today|tomorrow|this afternoon|this evening)|show (me )?(my )?(next|upcoming) (calendar )?(events|appointments)|next (3|4|five|5|few)? ?(events|appointments) on (my )?(calendar|schedule|agenda)|upcoming (calendar )?(events|appointments))\b/.test(lowered);
}

function looksLikeTopPriorityQuery(text) {
  const lowered = stripUrlsForHeuristics(text).toLowerCase();
  if (!lowered || looksLikeTaskBrainDump(text)) return false;
  if (countHeuristicWords(lowered) > 30) return false;
  return /\b(what are my top (3|three) priorities( today)?|top (3|three) priorities( today)?|what should i focus on( today)?|what should i do next|what matters most( today)?|focus today)\b/.test(lowered);
}

function looksLikeReplanCommand(text) {
  const lowered = stripUrlsForHeuristics(text).toLowerCase();
  if (!lowered) return false;
  const directCommand = /^(please\s+)?(replan my day|re-plan my day|plan my day|schedule my day|replan my week|re-plan my week|plan my week|schedule my week|rebuild my plan)\b/.test(lowered);
  if (directCommand) return true;
  if (looksLikeTaskBrainDump(text)) return false;
  if (countHeuristicWords(lowered) > 20) return false;
  return /\b(replan my day|re-plan my day|plan my day|plan today|plan my week|replan my week|schedule my day|schedule my week|rebuild my plan)\b/.test(lowered);
}

function normalizeAgentIntent(rawIntent, normalizedTranscript, sourceUrls = []) {
  const intent = String(rawIntent || '').trim().toLowerCase();
  if (AGENT_INTENTS.includes(intent)) {
    if (intent === 'query_calendar_next' && !looksLikeCalendarQuery(normalizedTranscript)) return 'process_text';
    if (intent === 'query_top_priorities' && !looksLikeTopPriorityQuery(normalizedTranscript)) return 'process_text';
    if (intent === 'run_replan' && !looksLikeReplanCommand(normalizedTranscript)) return 'process_text';
    return intent;
  }

  const lowered = String(normalizedTranscript || '').trim().toLowerCase();
  if (looksLikeCalendarQuery(lowered)) {
    return 'query_calendar_next';
  }
  if (looksLikeTopPriorityQuery(lowered)) {
    return 'query_top_priorities';
  }
  if (looksLikeReplanCommand(lowered)) {
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
  if (looksLikeDiagnosticLogDump(transcript)) {
    return 'task_list';
  }
  const type = String(rawType || '').trim().toLowerCase();
  if (type === 'journal' || type === 'task_list' || type === 'url_only' || type === 'mixed') {
    return type;
  }

  const stripped = stripUrlsForHeuristics(transcript);
  const wordCount = stripped ? stripped.split(/\s+/).length : 0;
  const likelyUrlOnly = Array.isArray(sourceUrls) && sourceUrls.length > 0 && wordCount <= 6;
  const likelyTaskList = looksLikeTaskBrainDump(transcript);
  if (likelyUrlOnly) return 'url_only';
  if (likelyTaskList && (tasks?.length || stories?.length)) return 'task_list';
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

function polishJournalNarrative(value) {
  return String(value || '')
    .replace(/\b#?(?:um+|uh+|erm+|mm+|hmm+)\b/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s\n])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeAnalysis(raw, transcript, sourceUrls = [], timezone = DEFAULT_TIMEZONE) {
  const analysis = raw && typeof raw === 'object' ? raw : {};
  const diagnosticLog = looksLikeDiagnosticLogDump(transcript);
  const explicitDiagnosticAction = looksLikeExplicitDiagnosticAction(transcript);
  const oneLineSummary = String(analysis.oneLineSummary || '').trim().replace(/\s+/g, ' ').slice(0, 280);
  const aiSummaryBulletsSource = sanitizeAiSummaryBullets(analysis.aiSummaryBullets, 8);
  const structuredEntrySource = String(analysis.structuredEntry || '').trim() || String(transcript || '').trim();
  const adviceSource = String(analysis.advice || '').trim() || 'No additional advice generated.';
  const mindsetAnalysisSource = normalizeMindsetAnalysis(analysis.mindsetAnalysis);
  const entryMetadataSource = normalizeEntryMetadata(analysis.entryMetadata);

  const seenStories = new Set();
  let stories = (Array.isArray(analysis.stories) ? analysis.stories : [])
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
  let tasks = (Array.isArray(analysis.tasks) ? analysis.tasks : [])
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

  if (diagnosticLog && !explicitDiagnosticAction) {
    stories = [];
    tasks = [];
  }

  const entryType = normalizeEntryType(analysis.entryType, transcript, sourceUrls, tasks, stories);
  const shouldCreateJournal = entryType === 'journal' || entryType === 'mixed';
  const structuredEntry = shouldCreateJournal ? polishJournalNarrative(structuredEntrySource) : structuredEntrySource;
  const advice = shouldCreateJournal ? polishJournalNarrative(adviceSource) : adviceSource;
  const aiSummaryBullets = shouldCreateJournal ? aiSummaryBulletsSource : [];
  const mindsetAnalysis = shouldCreateJournal ? mindsetAnalysisSource : null;
  const entryMetadata = shouldCreateJournal ? entryMetadataSource : null;

  return {
    entryType,
    shouldCreateJournal,
    oneLineSummary: oneLineSummary || 'Transcript summary',
    aiSummaryBullets,
    structuredEntry,
    advice,
    mindsetAnalysis,
    entryMetadata,
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
  const entityType = collectionName === 'stories' ? 'story' : 'task';
  return {
    id: doc.id,
    ref: String(data.ref || doc.id),
    title: String(data.title || ''),
    url: normalizeUrlValue(data.url),
    normalizedTitle: normalizeTitle(data.normalizedTitle || data.title || ''),
    collectionName,
    entityType,
    deepLink: String(data.deepLink || buildEntityUrl(entityType, doc.id, data.ref || doc.id)),
    payload: { id: doc.id, ...data },
    existing: true,
  };
}

function dedupeEntityRecords(records = []) {
  const ordered = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.id) continue;
    const entityType = String(record.entityType || (record.collectionName === 'stories' ? 'story' : 'task') || '').trim();
    const key = `${entityType}:${record.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(record);
  }
  return ordered;
}

async function loadExistingEntityCatalog(db, uid) {
  const [taskSnap, storySnap] = await Promise.all([
    db.collection('tasks').where('ownerUid', '==', uid).limit(800).get().catch(() => null),
    db.collection('stories').where('ownerUid', '==', uid).limit(800).get().catch(() => null),
  ]);

  const tasks = (taskSnap?.docs || [])
    .filter((doc) => doc.data()?.deleted !== true)
    .map((doc) => buildExistingEntityRecord('tasks', doc));
  const stories = (storySnap?.docs || [])
    .filter((doc) => doc.data()?.deleted !== true)
    .map((doc) => buildExistingEntityRecord('stories', doc));

  return {
    tasks,
    stories,
    all: [...tasks, ...stories],
  };
}

function findExistingEntityMatch(catalog, title, url = null, preferredEntityType = 'task') {
  const normalized = normalizeTitle(title);
  const normalizedUrl = normalizeUrlValue(url);
  const preferred = preferredEntityType === 'story' ? 'story' : 'task';
  const candidates = Array.isArray(catalog?.all) ? catalog.all : [];
  if (!normalized && !normalizedUrl) return null;

  const preferredCandidates = candidates.filter((candidate) => candidate?.entityType === preferred);
  const crossCandidates = candidates.filter((candidate) => candidate?.entityType !== preferred);

  const byUrl = [...preferredCandidates, ...crossCandidates].find((candidate) => normalizedUrl && candidate?.url === normalizedUrl) || null;
  if (byUrl) return byUrl;
  if (normalizedUrl) return null;

  const byExactPreferred = preferredCandidates.find((candidate) => candidate?.normalizedTitle === normalized) || null;
  if (byExactPreferred) return byExactPreferred;

  const byExactCross = crossCandidates.find((candidate) => candidate?.normalizedTitle === normalized) || null;
  if (byExactCross) return byExactCross;

  let best = null;
  let bestScore = 0;

  for (const candidate of [...preferredCandidates, ...crossCandidates]) {
    const { score, sharedCount, contains } = computeEntityTitleMatch(normalized, candidate?.normalizedTitle || candidate?.title || '');
    if (score < 0.68) continue;
    if (sharedCount < 2 && !contains) continue;
    const adjustedScore = score + (candidate?.entityType === preferred ? 0.03 : 0);
    if (!best || adjustedScore > bestScore) {
      best = candidate;
      bestScore = adjustedScore;
    }
  }

  return best || null;
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
    return null;
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

async function buildStoryRecords({ db, uid, persona, fingerprint, analysis, existingEntityCatalog, userThemes = [] }) {
  const createdAtOrder = Date.now();
  const records = [];
  const matchedTaskRecords = new Map();
  const existingStories = new Map();

  for (let index = 0; index < analysis.stories.length; index++) {
    const story = analysis.stories[index];
    const titleKey = normalizeTitle(story.title);
    const lookupKey = story.url ? `url:${story.url}` : titleKey;
    if (lookupKey && !existingStories.has(lookupKey)) {
      let existingMatch = existingEntityCatalog
        ? findExistingEntityMatch(existingEntityCatalog, story.title, story.url, 'story')
        : null;
      if (!existingMatch && story.url) {
        existingMatch = await findExistingEntityRecord(db, 'stories', uid, story.title, story.url);
      }
      if (!existingMatch && story.url) {
        existingMatch = await findExistingEntityRecord(db, 'tasks', uid, story.title, story.url);
      }
      if (!existingMatch && !existingEntityCatalog) {
        existingMatch = await findExistingEntityRecord(db, 'stories', uid, story.title, story.url);
      }
      existingStories.set(lookupKey, existingMatch);
    }
    const existing = lookupKey ? existingStories.get(lookupKey) : null;
    if (existing) {
      if (existing.entityType === 'story') {
        records.push(existing);
      } else {
        matchedTaskRecords.set(existing.id, existing);
      }
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
    const normalizedTheme = normalizeThemeForCatalog(
      prioritized.theme || story.theme || 'Growth',
      userThemes,
      'Growth'
    );
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
      theme: normalizedTheme.theme,
      theme_id: normalizedTheme.themeId,
      themeId: normalizedTheme.themeId,
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
      entityType: 'story',
      collectionName: 'stories',
      deepLink: payload.deepLink,
      existing: false,
      payload,
    });
  }

  return {
    storyRecords: dedupeEntityRecords(records),
    matchedTaskRecords: dedupeEntityRecords(Array.from(matchedTaskRecords.values())),
  };
}

async function buildTaskRecords({
  db,
  uid,
  persona,
  fingerprint,
  analysis,
  timezone,
  storyMap,
  existingEntityCatalog,
  userThemes = [],
}) {
  const saturdayDueMs = computeUpcomingSaturdayMs(timezone);
  const records = [];
  const matchedStoryRecords = new Map();
  const existingTasks = new Map();
  for (let index = 0; index < analysis.tasks.length; index++) {
    const task = analysis.tasks[index];
    const titleKey = normalizeTitle(task.title);
    const lookupKey = task.url ? `url:${task.url}` : titleKey;
    if (lookupKey && !existingTasks.has(lookupKey)) {
      let existingMatch = existingEntityCatalog
        ? findExistingEntityMatch(existingEntityCatalog, task.title, task.url, 'task')
        : null;
      if (!existingMatch && task.url) {
        existingMatch = await findExistingEntityRecord(db, 'tasks', uid, task.title, task.url);
      }
      if (!existingMatch && task.url) {
        existingMatch = await findExistingEntityRecord(db, 'stories', uid, task.title, task.url);
      }
      if (!existingMatch && !existingEntityCatalog) {
        existingMatch = await findExistingEntityRecord(db, 'tasks', uid, task.title, task.url);
      }
      existingTasks.set(lookupKey, existingMatch);
    }
    const existing = lookupKey ? existingTasks.get(lookupKey) : null;
    if (existing) {
      if (existing.entityType === 'story') {
        matchedStoryRecords.set(existing.id, existing);
        continue;
      }
      const existingType = String(existing?.payload?.type || '').trim().toLowerCase();
      const shouldEscalateExisting = !['read', 'watch'].includes(existingType || String(task?.kind || '').trim().toLowerCase());
      if (!shouldEscalateExisting) {
        const incomingType = String(task?.kind || existingType || '').trim().toLowerCase();
        const normalizedTheme = normalizeThemeForCatalog(
          task.theme || existing?.payload?.theme || 'Growth',
          userThemes,
          'Growth'
        );
        const currentTitle = String(existing?.payload?.title || '').trim();
        const currentDescription = String(existing?.payload?.description || '').trim();
        const currentTheme = String(existing?.payload?.theme ?? '').trim();
        const currentUrl = normalizeUrlValue(existing?.payload?.url);
        const desiredTitle = String(task?.title || '').trim();
        const desiredDescription = String(task?.description || '').trim();
        const shouldRefreshConsumptionMetadata = (
          existing?.payload?.entry_method === 'ai_transcript_ingestion' &&
          ['read', 'watch'].includes(incomingType) &&
          (
            !currentTitle ||
            !new RegExp(`^${incomingType}\\b`, 'i').test(currentTitle) ||
            !currentDescription ||
            currentTheme !== normalizedTheme.theme ||
            currentUrl !== normalizeUrlValue(task.url)
          )
        );
        if (shouldRefreshConsumptionMetadata) {
          const payload = ensureTaskPoints({
            ...(existing.payload || {}),
            title: desiredTitle || currentTitle || existing.payload?.title || '',
            normalizedTitle: normalizeTitle(desiredTitle || currentTitle || existing.payload?.title || ''),
            description: desiredDescription || currentDescription || existing.payload?.description || '',
            url: normalizeUrlValue(task.url) || currentUrl || null,
            type: incomingType || existingType || existing.payload?.type || 'task',
            theme: normalizedTheme.theme,
            theme_id: normalizedTheme.themeId,
            themeId: normalizedTheme.themeId,
            syncState: 'dirty',
            serverUpdatedAt: Date.now(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          records.push({
            ...existing,
            title: payload.title,
            url: payload.url,
            updated: true,
            payload,
          });
          continue;
        }
        records.push(existing);
        continue;
      }
      const today = DateTime.now().setZone(timezone || DEFAULT_TIMEZONE);
      const dueTodayMs = today.endOf('day').toMillis();
      const payload = ensureTaskPoints({
        ...(existing.payload || {}),
        priority: 4,
        dueDate: dueTodayMs,
        dueDateMs: dueTodayMs,
        dueDateIso: today.toISODate(),
        dueDateReason: 'duplicate_transcript_escalation',
        source: 'ai',
        sourceRef: fingerprint,
        syncState: 'dirty',
        serverUpdatedAt: Date.now(),
        aiPriorityBucket: 'TODAY',
        aiPriorityLabel: 'TODAY',
        aiIngestionFingerprint: fingerprint,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      records.push({
        ...existing,
        updated: true,
        payload,
      });
      continue;
    }

    const id = buildStableDocId('task', uid, fingerprint, index);
    const ref = buildStableRef('task', id);
    let linkedStory = task.storyTitle ? storyMap.get(normalizeTitle(task.storyTitle)) || null : null;
    if (!linkedStory && task.storyTitle && existingEntityCatalog) {
      const matchedStory = findExistingEntityMatch(existingEntityCatalog, task.storyTitle, null, 'story');
      if (matchedStory?.entityType === 'story') {
        linkedStory = matchedStory;
        matchedStoryRecords.set(matchedStory.id, matchedStory);
      }
    }
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
    const inheritedTheme = prioritized.theme || linkedStory?.payload?.theme || task.theme || 'Growth';
    const normalizedTheme = normalizeThemeForCatalog(inheritedTheme, userThemes, 'Growth');
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
      theme: normalizedTheme.theme,
      theme_id: normalizedTheme.themeId,
      themeId: normalizedTheme.themeId,
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
      entityType: 'task',
      collectionName: 'tasks',
      deepLink: payload.deepLink,
      existing: false,
      updated: false,
      payload,
    });
  }
  return {
    taskRecords: dedupeEntityRecords(records),
    matchedStoryRecords: dedupeEntityRecords(Array.from(matchedStoryRecords.values())),
  };
}

function buildJournalRecord({
  journalTarget,
  uid,
  persona,
  fingerprint,
  docUrl,
  googleDoc,
  entryType,
  originalTranscript,
  sections,
  storyRecords,
  taskRecords,
  source,
  sourceUrls,
}) {
  const existingJournal = journalTarget?.data || null;
  const journalDateKey = String(sections?.journalDateKey || existingJournal?.journalDateKey || '').trim() || null;
  const id = journalTarget?.id || buildStableJournalDayId(uid, journalDateKey);
  const previousEntryCount = Math.max(0, Number(existingJournal?.entryCount || 0));
  const mergedStoryIds = mergeUniqueStrings(existingJournal?.storyIds, storyRecords.map((story) => story.id));
  const mergedTaskIds = mergeUniqueStrings(existingJournal?.taskIds, taskRecords.map((task) => task.id));
  const mergedSourceUrls = mergeUniqueStrings(existingJournal?.sourceUrls, sourceUrls);
  const summaryHistory = mergeUniqueStrings(existingJournal?.summaryHistory, [sections.oneLineSummary]);
  const mergedSections = {
    journalDateKey,
    dateHeading: existingJournal?.dateHeading || sections.dateHeading,
    oneLineSummary: sections.oneLineSummary || existingJournal?.oneLineSummary || 'Transcript summary',
    aiSummaryBullets: mergeAiSummaryBullets(existingJournal?.aiSummaryBullets, sections.aiSummaryBullets),
    structuredEntry: mergeDistinctText(existingJournal?.structuredEntry, sections.structuredEntry),
    advice: mergeDistinctText(existingJournal?.advice, sections.advice),
    mindsetAnalysis: mergeMindsetAnalysis(existingJournal?.mindsetAnalysis, sections.mindsetAnalysis),
    entryMetadata: mergeEntryMetadata(existingJournal?.entryMetadata, sections.entryMetadata, previousEntryCount),
    fullTranscript: mergeDistinctText(existingJournal?.originalTranscript, originalTranscript),
  };
  const payload = {
    id,
    ownerUid: uid,
    persona,
    originalTranscript: mergedSections.fullTranscript,
    journalDateKey,
    dateHeading: mergedSections.dateHeading,
    structuredEntry: mergedSections.structuredEntry,
    oneLineSummary: mergedSections.oneLineSummary,
    aiSummaryBullets: mergedSections.aiSummaryBullets,
    advice: mergedSections.advice,
    mindsetAnalysis: mergedSections.mindsetAnalysis,
    entryMetadata: mergedSections.entryMetadata,
    docUrl: docUrl || existingJournal?.docUrl || null,
    entryType: mergeJournalEntryType(existingJournal?.entryType, entryType, storyRecords, taskRecords),
    transcriptFingerprint: fingerprint,
    transcriptFingerprints: mergeUniqueStrings(existingJournal?.transcriptFingerprints, [fingerprint]),
    source: source || 'transcript',
    sourceUrls: mergedSourceUrls,
    storyIds: mergedStoryIds,
    taskIds: mergedTaskIds,
    entryCount: Math.max(1, previousEntryCount + 1),
    summaryHistory,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!existingJournal) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }
  if (googleDoc) {
    payload.googleDoc = googleDoc;
    if (googleDoc.appended === true) {
      payload.googleDocAppendedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }
  payload.linkedStories = mergeLinkedEntitySummaries(
    existingJournal?.linkedStories,
    buildLinkedEntitySummaries(storyRecords, 'story'),
    'story'
  );
  payload.linkedTasks = mergeLinkedEntitySummaries(
    existingJournal?.linkedTasks,
    buildLinkedEntitySummaries(taskRecords, 'task'),
    'task'
  );
  return {
    id,
    payload,
    mergedSections,
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

async function appendJournalToGoogleDoc({ uid, docUrl, sections, includeDateHeading = true }) {
  const docId = parseGoogleDocId(docUrl);
  if (!docId) {
    throw new httpsV2.HttpsError('failed-precondition', 'The default journal Google Doc URL is invalid.');
  }
  const docs = await getGoogleDocsClient(uid);
  try {
    const document = await docs.documents.get({ documentId: docId });
    const bodyContent = document?.data?.body?.content || [];
    const plan = buildDocAppendPlan(sections, { includeDateHeading });

    // Helper: extract plain text from a body element
    const getElementText = (el) => {
      const elements = el?.paragraph?.elements || [];
      return elements.map((r) => String(r?.textRun?.content || '')).join('').replace(/\n$/, '').trim();
    };

    // A "date heading" is an H1 whose text looks like a journal date (contains a year
    // in the 2000s AND a month name).  "Rules for Life" and other static H1s won't match.
    const looksLikeDateHeading = (text) =>
      /\b20\d{2}\b/.test(text) &&
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text);

    const h1Elements = bodyContent.filter(
      (el) => el?.paragraph?.paragraphStyle?.namedStyleType === 'HEADING_1',
    );

    // Insert BEFORE the first date-style H1 (i.e., prepend to the journal section,
    // after any static H1 sections like "Rules for Life").
    // Fall back to end-of-document if no date H1 exists yet.
    const firstDateH1 = h1Elements.find((el) => looksLikeDateHeading(getElementText(el)));
    let insertAt;
    if (firstDateH1) {
      insertAt = Math.max(1, Number(firstDateH1.startIndex));
    } else {
      // No journal entries yet — insert at the end of the document body
      // (before the trailing sentinel newline that Google Docs always maintains).
      const lastBodyEl = bodyContent[bodyContent.length - 1];
      insertAt = Math.max(1, Number(lastBodyEl?.endIndex || 2) - 1);
    }

    // Build requests:
    //  1. Insert the text block.
    //  2. Reset the entire inserted range to NORMAL_TEXT so that no paragraph
    //     inherits the H1 style of the surrounding context (the "all text becomes
    //     header 1" bug).
    //  3. Re-apply proper heading styles (H1/H2/H3) to each heading sub-range.
    const requests = [
      { insertText: { location: { index: insertAt }, text: plan.text } },
      {
        updateParagraphStyle: {
          range: { startIndex: insertAt, endIndex: insertAt + plan.text.length },
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          fields: 'namedStyleType',
        },
      },
    ];
    for (const headingRange of Array.isArray(plan.headingRanges) ? plan.headingRanges : []) {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: insertAt + headingRange.start,
            endIndex: insertAt + headingRange.end,
          },
          paragraphStyle: { namedStyleType: headingRange.namedStyleType },
          fields: 'namedStyleType',
        },
      });
    }
    for (const bulletRange of Array.isArray(plan.bulletRanges) ? plan.bulletRanges : []) {
      requests.push({
        createParagraphBullets: {
          range: {
            startIndex: insertAt + bulletRange.start,
            endIndex: insertAt + bulletRange.end,
          },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
    }

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests,
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

function buildEmailHtml({ sections, taskRecords, storyRecords, docUrl, warnings = [], googleDoc = null }) {
  const aiSummaryRows = (Array.isArray(sections.aiSummaryBullets) ? sections.aiSummaryBullets : [])
    .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
    .join('');
  const mindset = normalizeMindsetAnalysis(sections.mindsetAnalysis);
  const metadata = normalizeEntryMetadata(sections.entryMetadata);
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
  const warningRows = (Array.isArray(warnings) ? warnings : [])
    .map((warning) => {
      const message = typeof warning === 'string'
        ? warning
        : String(warning?.message || warning?.error || '').trim();
      if (!message) return '';
      return `<li>${escapeHtml(message)}</li>`;
    })
    .filter(Boolean)
    .join('');

  return [
    [
      '<!DOCTYPE html><html><body style="font-family:-apple-system,',
      'BlinkMacSystemFont,Segoe UI,Arial,sans-serif;line-height:1.5;color:#111827;">',
    ].join(''),
    `<h1 style="font-size:24px;margin-bottom:8px;">${escapeHtml(sections.dateHeading)}</h1>`,
    `<div style="font-size:18px;font-weight:600;margin:0 0 16px;">${escapeHtml(sections.oneLineSummary)}</div>`,
    aiSummaryRows
      ? [
        '<h2 style="font-size:18px;margin:16px 0 8px;">AI Summary of the Entry</h2>',
        `<ul>${aiSummaryRows}</ul>`,
      ].join('')
      : '',
    '<h2 style="font-size:18px;margin:16px 0 8px;">The Entry</h2>',
    `<div style="white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(sections.structuredEntry)}</div>`,
    mindset
      ? [
        '<h2 style="font-size:18px;margin:16px 0 8px;">Analysis of the Author&apos;s Mindset</h2>',
        mindset.emotionalTone ? `<h3 style="font-size:15px;margin:12px 0 6px;">Emotional Tone</h3><div style="white-space:pre-wrap;">${escapeHtml(mindset.emotionalTone)}</div>` : '',
        mindset.cognitiveStyle ? `<h3 style="font-size:15px;margin:12px 0 6px;">Cognitive Style</h3><div style="white-space:pre-wrap;">${escapeHtml(mindset.cognitiveStyle)}</div>` : '',
        mindset.motivationsAndDrivers ? `<h3 style="font-size:15px;margin:12px 0 6px;">Motivations and Internal Drivers</h3><div style="white-space:pre-wrap;">${escapeHtml(mindset.motivationsAndDrivers)}</div>` : '',
        mindset.psychologicalStrengths ? `<h3 style="font-size:15px;margin:12px 0 6px;">Psychological Strengths Observed</h3><div style="white-space:pre-wrap;">${escapeHtml(mindset.psychologicalStrengths)}</div>` : '',
        mindset.potentialStressors ? `<h3 style="font-size:15px;margin:12px 0 6px;">Potential Stressors or Pressures</h3><div style="white-space:pre-wrap;">${escapeHtml(mindset.potentialStressors)}</div>` : '',
      ].join('')
      : '',
    '<h2 style="font-size:18px;margin:16px 0 8px;">Advice</h2>',
    `<div style="white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(sections.advice)}</div>`,
    '<h2 style="font-size:18px;margin:16px 0 8px;">Full Transcript</h2>',
    `<div style="white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(sections.fullTranscript)}</div>`,
    metadata
      ? [
        '<h2 style="font-size:18px;margin:16px 0 8px;">Entry Metadata</h2>',
        '<ul>',
        `<li>Mood score: ${escapeHtml(metadata.moodScore)}</li>`,
        `<li>Stress level: ${escapeHtml(metadata.stressLevel)}</li>`,
        `<li>Energy level: ${escapeHtml(metadata.energyLevel)}</li>`,
        `<li>Sentiment: ${escapeHtml(metadata.sentiment)}</li>`,
        `<li>Cognitive state: ${escapeHtml(metadata.cognitiveState || '—')}</li>`,
        `<li>Primary themes: ${escapeHtml((metadata.primaryThemes || []).join(', ') || '—')}</li>`,
        '</ul>',
      ].join('')
      : '',
    '<h2 style="font-size:18px;margin:16px 0 8px;">Actionable items</h2>',
    actionRows ? `<ul>${actionRows}</ul>` : '<p>No tasks or stories were created.</p>',
    warningRows
      ? [
        '<h2 style="font-size:18px;margin:16px 0 8px;">Warnings</h2>',
        `<ul>${warningRows}</ul>`,
      ].join('')
      : '',
    docUrl
      ? `<p style="margin-top:16px;">Google Doc${googleDoc?.appended === false ? ' (not updated)' : ''}: <a href="${escapeHtml(docUrl)}">${escapeHtml(docUrl)}</a></p>`
      : '',
    '</body></html>',
  ].join('');
}

const EMAIL_DISPATCH_LEASE_MS = 15 * 60 * 1000;
const INGESTION_PROCESSING_LEASE_MS = 20 * 60 * 1000;

async function claimTranscriptSummaryEmail(lockRef) {
  const db = admin.firestore();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.data() || {};
    if (data.emailSentAt) return false;

    const claimedAt = typeof data.emailDispatchClaimedAt?.toDate === 'function'
      ? data.emailDispatchClaimedAt.toDate()
      : (data.emailDispatchClaimedAt ? new Date(data.emailDispatchClaimedAt) : null);
    if (claimedAt instanceof Date && !Number.isNaN(claimedAt.getTime()) && (Date.now() - claimedAt.getTime()) < EMAIL_DISPATCH_LEASE_MS) {
      return false;
    }

    tx.set(lockRef, {
      emailDispatchClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function releaseTranscriptSummaryEmailClaim(lockRef) {
  await lockRef.set({
    emailDispatchClaimedAt: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function reserveTranscriptIngestion(db, uid, fingerprint, transcriptPreview) {
  const ref = db.collection('transcript_ingestions').doc(`${uid}_${fingerprint}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() || {};
      const status = String(data.status || '').toLowerCase();
      const lastTouchedMs =
        timestampToMillis(data.updatedAt) ||
        timestampToMillis(data.lastRequestedAt) ||
        timestampToMillis(data.createdAt);
      const isStaleProcessing = status === 'processing' &&
        typeof lastTouchedMs === 'number' &&
        (Date.now() - lastTouchedMs) >= INGESTION_PROCESSING_LEASE_MS;

      if ((status === 'processed') || (status === 'processing' && !isStaleProcessing)) {
        tx.set(ref, {
          duplicateCount: admin.firestore.FieldValue.increment(1),
          lastDuplicateAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { duplicate: true, data };
      }

      const resetPayload = {
        id: ref.id,
        ownerUid: uid,
        fingerprint,
        transcriptPreview,
        status: 'processing',
        lastRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorCode: admin.firestore.FieldValue.delete(),
        errorMessage: admin.firestore.FieldValue.delete(),
        failedAt: admin.firestore.FieldValue.delete(),
        emailDispatchClaimedAt: admin.firestore.FieldValue.delete(),
        diagnosticStage: isStaleProcessing ? 'stale_reclaimed' : 'retry_requested',
        diagnosticLevel: isStaleProcessing ? 'warn' : 'info',
        diagnosticMessage: isStaleProcessing ? 'Recovered stale transcript processing lock' : 'Retrying transcript ingestion',
      };
      if (isStaleProcessing) {
        resetPayload.staleRecoveryCount = admin.firestore.FieldValue.increment(1);
        resetPayload.lastStaleRecoveryAt = admin.firestore.FieldValue.serverTimestamp();
      }
      tx.set(ref, resetPayload, { merge: true });
      return { duplicate: false, data, reclaimed: isStaleProcessing };
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
    return { duplicate: false, data: snap.exists ? (snap.data() || {}) : null, reclaimed: false };
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
  warnings = [],
  googleDoc = null,
}) {
  const processedDocument = serializeSections(sections);
  const safeTasks = Array.isArray(createdTasks) ? createdTasks : [];
  const safeStories = Array.isArray(createdStories) ? createdStories : [];
  const safeWarnings = (Array.isArray(warnings) ? warnings : [])
    .map((warning) => {
      if (!warning) return null;
      if (typeof warning === 'string') {
        return {
          code: null,
          scope: null,
          message: warning,
        };
      }
      const normalizedMessage = String(warning.message || warning.error || '').trim();
      if (!normalizedMessage) return null;
      return {
        code: warning.code ? String(warning.code) : null,
        scope: warning.scope ? String(warning.scope) : null,
        message: normalizedMessage,
      };
    })
    .filter(Boolean);

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
    aiSummaryBullets: processedDocument.aiSummaryBullets,
    structuredEntry: processedDocument.structuredEntry,
    advice: processedDocument.advice,
    mindsetAnalysis: processedDocument.mindsetAnalysis,
    entryMetadata: processedDocument.entryMetadata,
    fullTranscript: processedDocument.fullTranscript,
    warnings: safeWarnings,
    googleDoc: googleDoc || null,
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
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
    googleDoc: data?.googleDoc || null,
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

function buildLinkedEntitySummaries(records, entityType) {
  return (Array.isArray(records) ? records : []).map((record) => ({
    id: record.id,
    ref: record.ref || record.id,
    title: record.title || (entityType === 'task' ? 'Task' : 'Story'),
    url: record.url || null,
    deepLink: record.deepLink || buildEntityUrl(entityType, record.id, record.ref || record.id),
    existing: record.existing === true,
    updated: record.updated === true,
  }));
}

function mergeLinkedEntitySummaries(existingRecords, nextRecords, entityType) {
  const merged = new Map();
  const allRecords = [
    ...(Array.isArray(existingRecords) ? existingRecords : []),
    ...(Array.isArray(nextRecords) ? nextRecords : []),
  ];
  allRecords.forEach((record) => {
    const id = String(record?.id || '').trim();
    if (!id) return;
    const prior = merged.get(id) || {};
    const ref = record?.ref || prior.ref || id;
    merged.set(id, {
      id,
      ref,
      title: record?.title || prior.title || (entityType === 'task' ? 'Task' : 'Story'),
      url: record?.url ?? prior.url ?? null,
      deepLink: record?.deepLink || prior.deepLink || buildEntityUrl(entityType, id, ref),
      existing: record?.existing === true || prior.existing === true,
      updated: record?.updated === true || prior.updated === true,
    });
  });
  return Array.from(merged.values());
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
      aiSummaryBullets: Array.isArray(journal.aiSummaryBullets) ? journal.aiSummaryBullets : [],
      structuredEntry: journal.structuredEntry || null,
      advice: journal.advice || null,
      mindsetAnalysis: normalizeMindsetAnalysis(journal.mindsetAnalysis),
      entryMetadata: normalizeEntryMetadata(journal.entryMetadata),
      fullTranscript: journal.originalTranscript || null,
    },
    warnings: Array.isArray(base.warnings) ? base.warnings : [],
    googleDoc: journal.googleDoc || base.googleDoc || null,
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
  if (status === 'processing') {
    const lastTouchedMs =
      timestampToMillis(data.updatedAt) ||
      timestampToMillis(data.lastRequestedAt) ||
      timestampToMillis(data.createdAt);
    const isStaleProcessing =
      typeof lastTouchedMs === 'number' &&
      (Date.now() - lastTouchedMs) >= INGESTION_PROCESSING_LEASE_MS;
    if (isStaleProcessing) return null;
  }
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
    .map((item) => {
      const ref = String(item?.ref || '').trim();
      const title = String(item?.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
      if (ref && title) return `${ref} (${title})`;
      return ref || title || null;
    })
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
  const updatedTasks = taskList.filter((task) => task?.existing === true && task?.updated === true);
  const existingTasks = taskList.filter((task) => task?.existing === true && task?.updated !== true);
  const newStories = storyList.filter((story) => story?.existing !== true);
  const existingStories = storyList.filter((story) => story?.existing === true);
  const tasks = taskList.length;
  const stories = storyList.length;
  const hasJournal = Boolean(response.hasJournal || response.journalId);
  const warnings = Array.isArray(response.warnings) ? response.warnings : [];
  const firstWarning = warnings.length
    ? String(warnings[0]?.message || warnings[0] || '').trim()
    : '';
  const parts = [];

  const journalSummary = String(response.oneLineSummary || '').trim();
  if (hasJournal && tasks === 0 && stories === 0) {
    const base = journalSummary ? `I created a journal entry. ${journalSummary}` : 'I created a journal entry.';
    return firstWarning ? `${base} ${firstWarning}` : base;
  }
  if (hasJournal) {
    parts.push(journalSummary ? `I created a journal entry. ${journalSummary}` : 'I created a journal entry.');
  }
  if (newTasks.length) {
    const taskRefs = summarizeEntityRefs(newTasks, 'task');
    parts.push(
      newTasks.length === 1
        ? `I created ${taskRefs}.`
        : `I created ${newTasks.length} tasks: ${taskRefs}.`
    );
  }
  if (updatedTasks.length) {
    const taskRefs = summarizeEntityRefs(updatedTasks, 'task');
    parts.push(
      updatedTasks.length === 1
        ? `I updated existing ${taskRefs}.`
        : `I updated ${updatedTasks.length} existing tasks: ${taskRefs}.`
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
  const base = parts.length ? parts.join(' ') : 'Text processed.';
  return firstWarning ? `${base} ${firstWarning}` : base;
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

  if (reservation.reclaimed) {
    await logger.event('stale_lock_reclaimed', 'Recovered stale transcript processing lock', {
      priorStatus: reservation.data?.status || null,
      priorStage: reservation.data?.diagnosticStage || null,
      priorUpdatedAt: normalizeTimestampOutput(reservation.data?.updatedAt || reservation.data?.lastRequestedAt || reservation.data?.createdAt),
    }, 'warn');
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
      logger,
      journalPromptOverride: profile?.journalEditorPrompt || profile?.journalPromptOverride || null,
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
    const sections = buildDocSections(analysis, transcript, timezone);
    const journalTarget = analysis.shouldCreateJournal
      ? await findExistingJournalForDate({
        db,
        uid,
        persona: persona || 'personal',
        sections,
      })
      : null;
    const warnings = [];
    let googleDoc = analysis.shouldCreateJournal
      ? {
        attempted: false,
        appended: false,
        status: docUrl ? 'pending' : 'not_configured',
        message: docUrl
          ? null
          : 'Set a default journal Google Doc URL in Settings before ingesting transcripts.',
        url: docUrl || null,
      }
      : null;
    if (analysis.shouldCreateJournal && !docUrl) {
      warnings.push({
        code: 'google_doc_missing',
        scope: 'google_docs',
        message: 'Set a default journal Google Doc URL in Settings before ingesting transcripts.',
      });
      await logger.event('google_docs_append_skipped', 'Google Docs append skipped because no default document URL is configured', {
        docUrl: null,
      }, 'warning');
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
      journalId: journalTarget?.id || null,
      warnings,
      googleDoc,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (analysis.shouldCreateJournal && existingLock.docAppendStatus === 'done') {
      googleDoc = {
        attempted: true,
        appended: true,
        status: 'done',
        message: null,
        url: docUrl || null,
      };
    }

    if (analysis.shouldCreateJournal && docUrl && existingLock.docAppendStatus !== 'done') {
      await logger.event('google_docs_append_start', 'Appending journal entry to Google Docs', {
        docUrl,
        journalId: journalTarget?.id || null,
        includeDateHeading: !journalTarget?.existed,
      });
      try {
        await appendJournalToGoogleDoc({
          uid,
          docUrl,
          sections,
          includeDateHeading: !journalTarget?.existed,
        });
        googleDoc = {
          attempted: true,
          appended: true,
          status: 'done',
          message: null,
          url: docUrl || null,
        };
        await lockRef.set({
          docAppendStatus: 'done',
          docAppendErrorMessage: admin.firestore.FieldValue.delete(),
          docAppendedAt: admin.firestore.FieldValue.serverTimestamp(),
          googleDoc,
          warnings,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await logger.event('google_docs_append_done', 'Google Docs append completed', {
          docUrl,
        });
      } catch (error) {
        const warningMessage = error?.message || 'Google Docs append failed.';
        const warning = {
          code: error?.code || 'google_docs_append_failed',
          scope: 'google_docs',
          message: warningMessage,
        };
        warnings.push(warning);
        googleDoc = {
          attempted: true,
          appended: false,
          status: 'failed',
          message: warningMessage,
          url: docUrl || null,
        };
        await lockRef.set({
          docAppendStatus: 'failed',
          docAppendErrorMessage: warningMessage,
          googleDoc,
          warnings,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await logger.event('google_docs_append_failed', 'Google Docs append failed but transcript processing will continue', {
          docUrl,
          code: error?.code || null,
          message: warningMessage,
        }, 'warning');
      }
    }

    const existingEntityCatalog = await loadExistingEntityCatalog(db, uid);
    const userThemes = await loadThemesForUser(uid);
    const {
      storyRecords: rawStoryRecords,
      matchedTaskRecords: crossMatchedTaskRecords,
    } = await buildStoryRecords({
      db,
      uid,
      persona: persona || 'personal',
      fingerprint,
      analysis,
      existingEntityCatalog,
      userThemes,
    });
    const storyMap = new Map(rawStoryRecords.map((story) => [normalizeTitle(story.title), story]));
    const {
      taskRecords: rawTaskRecords,
      matchedStoryRecords: crossMatchedStoryRecords,
    } = await buildTaskRecords({
      db,
      uid,
      persona: persona || 'personal',
      fingerprint,
      analysis,
      timezone,
      storyMap,
      existingEntityCatalog,
      userThemes,
    });
    const storyRecords = dedupeEntityRecords([...rawStoryRecords, ...crossMatchedStoryRecords]);
    const taskRecords = dedupeEntityRecords([...rawTaskRecords, ...crossMatchedTaskRecords]);
    await logger.event('entity_resolution', 'Built task and story records', {
      stories: storyRecords.map((story) => ({
        id: story.id,
        existing: Boolean(story.existing),
        entityType: story.entityType || 'story',
      })),
      tasks: taskRecords.map((task) => ({
        id: task.id,
        existing: Boolean(task.existing),
        entityType: task.entityType || 'task',
      })),
    });

    const journalRecord = analysis.shouldCreateJournal
      ? buildJournalRecord({
        journalTarget,
        uid,
        persona: persona || 'personal',
        fingerprint,
        docUrl,
        googleDoc,
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
      if (!task.existing || task.updated) {
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
    const updatedTaskIds = new Set(taskRecords.filter((task) => task?.updated === true).map((task) => String(task.id || '')));
    const existingStoryIds = new Set(storyRecords.filter((story) => story?.existing === true).map((story) => String(story.id || '')));
    const finalTaskIds = dedupeIds(taskRecords.map((task) => task.id).filter((id) => !convertedTaskIds.has(String(id))));
    const finalStoryIds = dedupeIds([
      ...storyRecords.map((story) => story.id),
      ...autoConversions.map((item) => item.storyId),
    ]);

    const mergedJournalTaskIds = journalRecord
      ? dedupeIds([...(Array.isArray(journalRecord.payload?.taskIds) ? journalRecord.payload.taskIds : []), ...finalTaskIds])
      : finalTaskIds;
    const mergedJournalStoryIds = journalRecord
      ? dedupeIds([...(Array.isArray(journalRecord.payload?.storyIds) ? journalRecord.payload.storyIds : []), ...finalStoryIds])
      : finalStoryIds;

    if (journalRecord && autoConversions.length) {
      await db.collection('journals').doc(journalRecord.id).set({
        taskIds: mergedJournalTaskIds,
        storyIds: mergedJournalStoryIds,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await logger.event('journal_links_updated', 'Journal links updated after task auto-conversion', {
        journalId: journalRecord.id,
        taskIds: mergedJournalTaskIds,
        storyIds: mergedJournalStoryIds,
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
      updated: updatedTaskIds.has(String(task.id || '')),
    }));

    if (journalRecord) {
      const journalPatch = {
        taskIds: mergedJournalTaskIds,
        storyIds: mergedJournalStoryIds,
        linkedTasks: mergeLinkedEntitySummaries(journalRecord.payload?.linkedTasks, buildLinkedEntitySummaries(createdTasks, 'task'), 'task'),
        linkedStories: mergeLinkedEntitySummaries(journalRecord.payload?.linkedStories, buildLinkedEntitySummaries(createdStories, 'story'), 'story'),
        googleDoc: googleDoc || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (googleDoc?.appended === true) {
        journalPatch.googleDocAppendedAt = admin.firestore.FieldValue.serverTimestamp();
      }
      await db.collection('journals').doc(journalRecord.id).set(journalPatch, { merge: true });
    }

    const responseSections = journalRecord?.mergedSections || sections;

    const emailHtml = buildEmailHtml({
      sections,
      taskRecords: createdTasks,
      storyRecords: createdStories,
      docUrl: docUrl || null,
      warnings,
      googleDoc,
    });

    const shouldSendEmail = await claimTranscriptSummaryEmail(lockRef);
    if (shouldSendEmail) {
      try {
        await sendEmail({
          to: email,
          subject: `BOB Transcript Summary · ${sections.oneLineSummary}`,
          html: emailHtml,
        });
        await lockRef.set({
          emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          emailDispatchClaimedAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await logger.event('email_sent', 'Summary email sent', {
          recipient: email,
        });
      } catch (error) {
        await releaseTranscriptSummaryEmailClaim(lockRef).catch(() => null);
        throw error;
      }
    } else {
      await logger.event('email_skipped', 'Summary email skipped because it was already dispatched for this transcript', {
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
      sections: responseSections,
      createdTasks,
      createdStories,
      warnings,
      googleDoc,
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
      warnings: response.warnings,
      googleDoc: response.googleDoc,
      createdTasks: response.createdTasks,
      createdStories: response.createdStories,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
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
      warningCount: Array.isArray(response.warnings) ? response.warnings.length : 0,
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

  // Parallelise profile read and URL preview fetch — both are independent I/O
  const sourceUrls = extractUrls(normalizedTranscript, sourceUrl);
  const [{ profile }, urlPreviews] = await Promise.all([
    resolveProfile(db, uid),
    fetchUrlPreviews(sourceUrls),
  ]);
  const timezone = String(
    profile?.timezone ||
    profile?.timeZone ||
    profile?.settings?.timezone ||
    DEFAULT_TIMEZONE
  ).trim() || DEFAULT_TIMEZONE;
  let effectiveRoute;
  if (!likelyQueryOrAction) {
    effectiveRoute = sanitizeAgentRoute({
      intent: normalizeAgentIntent(null, normalizedTranscript, sourceUrls),
      mode: 'write',
      confidence: 0.99,
    }, normalizedTranscript, sourceUrls);
    console.log('[transcriptIngestion] agent_route_skipped', JSON.stringify({
      uid,
      fingerprint,
      source: source || 'transcript',
      channel: channel || 'unknown',
      authMode: authMode || 'unknown',
      sourceProvidedId: sourceProvidedId || null,
      intent: effectiveRoute.intent,
      mode: effectiveRoute.mode,
      confidence: effectiveRoute.confidence,
    }));
  } else {
    try {
      const rawRoute = await callAgentRouterModel({
        transcript: normalizedTranscript,
        persona: persona || 'personal',
        timezone,
        urlPreviews,
      });
      const route = sanitizeAgentRoute(rawRoute, normalizedTranscript, sourceUrls);
      effectiveRoute = (
        (route.mode === 'query' && ['query_calendar_next', 'query_top_priorities'].includes(route.intent)) ||
        (route.mode === 'action' && route.intent === 'run_replan')
      )
        ? route
        : (route.intent === 'unknown' || route.mode === 'unknown'
          ? { ...route, intent: 'process_text', mode: 'write' }
          : route);
    } catch (error) {
      effectiveRoute = sanitizeAgentRoute({
        intent: normalizeAgentIntent(null, normalizedTranscript, sourceUrls),
        mode: 'unknown',
        confidence: 0,
      }, normalizedTranscript, sourceUrls);
      console.warn('[transcriptIngestion] agent_route_fallback', JSON.stringify({
        uid,
        fingerprint,
        source: source || 'transcript',
        channel: channel || 'unknown',
        authMode: authMode || 'unknown',
        sourceProvidedId: sourceProvidedId || null,
        message: error?.message || String(error),
        fallbackIntent: effectiveRoute.intent,
        fallbackMode: effectiveRoute.mode,
      }));
    }
  }

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
  memory: '512MiB',
  timeoutSeconds: 180,
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
  memory: '512MiB',
  timeoutSeconds: 180,
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

// ────────────────────────────────────────────────────────────────────
// Helper: remove a journal entry's appended content from a Google Doc
// Finds the HEADING_1 whose text matches dateHeading, deletes from that
// start index to the next HEADING_1 (or end of body).
// ────────────────────────────────────────────────────────────────────
async function removeJournalFromGoogleDoc({ uid, docUrl, dateHeading }) {
  const docId = parseGoogleDocId(docUrl);
  if (!docId) return { removed: false, reason: 'invalid_doc_url' };

  const docs = await getGoogleDocsClient(uid);
  const document = await docs.documents.get({ documentId: docId });
  const bodyContent = document?.data?.body?.content || [];

  let entryStartIndex = null;
  let entryEndIndex = null;
  const target = String(dateHeading || '').trim();

  for (let i = 0; i < bodyContent.length; i++) {
    const el = bodyContent[i];
    if (el?.paragraph?.paragraphStyle?.namedStyleType !== 'HEADING_1') continue;

    const paraText = (el.paragraph.elements || [])
      .map((e) => String(e?.textRun?.content || ''))
      .join('')
      .trim();

    if (paraText === target) {
      entryStartIndex = Number(el.startIndex);
      // Seek to the next HEADING_1 for the end boundary
      for (let j = i + 1; j < bodyContent.length; j++) {
        const next = bodyContent[j];
        if (next?.paragraph?.paragraphStyle?.namedStyleType === 'HEADING_1') {
          entryEndIndex = Number(next.startIndex);
          break;
        }
      }
      if (entryEndIndex === null) {
        // Last entry in doc — use end of body minus 1 (preserve trailing newline)
        const lastEl = bodyContent[bodyContent.length - 1];
        entryEndIndex = Math.max(
          entryStartIndex + 1,
          Number(lastEl?.endIndex || entryStartIndex + 1) - 1,
        );
      }
      break;
    }
  }

  if (entryStartIndex === null) {
    return { removed: false, reason: 'heading_not_found' };
  }

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          deleteContentRange: {
            range: { startIndex: entryStartIndex, endIndex: entryEndIndex },
          },
        },
      ],
    },
  });

  return { removed: true, startIndex: entryStartIndex, endIndex: entryEndIndex };
}

// ────────────────────────────────────────────────────────────────────
// Callable: deleteJournalEntry
// Deletes a journal entry from Firestore and removes it from its
// linked Google Doc (if previously appended).
// ────────────────────────────────────────────────────────────────────
exports.deleteJournalEntry = httpsV2.onCall({
  memory: '256MiB',
  timeoutSeconds: 60,
  secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET],
}, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const journalId = String(req?.data?.journalId || '').trim();
  if (!journalId) throw new httpsV2.HttpsError('invalid-argument', 'journalId is required');

  const docRef = admin.firestore().collection('journals').doc(journalId);
  const snap = await docRef.get();
  if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Journal entry not found');

  const data = snap.data();
  if (data.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Not authorized');

  let docResult = null;
  if (data.docUrl && data.googleDoc?.appended === true && data.dateHeading) {
    try {
      docResult = await removeJournalFromGoogleDoc({
        uid,
        docUrl: data.docUrl,
        dateHeading: data.dateHeading,
      });
    } catch (err) {
      console.warn('[deleteJournalEntry] Google Doc removal failed', err?.message);
      docResult = { removed: false, reason: err?.message };
    }
  }

  await docRef.delete();
  return { success: true, docResult };
});

// ────────────────────────────────────────────────────────────────────
// Callable: editJournalEntry
// Updates editable fields in Firestore and re-syncs to Google Doc
// (removes the old appended section then re-appends updated content).
// ────────────────────────────────────────────────────────────────────
exports.editJournalEntry = httpsV2.onCall({
  memory: '256MiB',
  timeoutSeconds: 60,
  secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET],
}, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const journalId = String(req?.data?.journalId || '').trim();
  if (!journalId) throw new httpsV2.HttpsError('invalid-argument', 'journalId is required');

  const docRef = admin.firestore().collection('journals').doc(journalId);
  const snap = await docRef.get();
  if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'Journal entry not found');

  const data = snap.data();
  if (data.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Not authorized');

  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  for (const field of ['structuredEntry', 'oneLineSummary', 'advice']) {
    if (req.data[field] !== undefined) {
      updates[field] = String(req.data[field] || '');
    }
  }
  await docRef.update(updates);

  let docResult = null;
  if (data.docUrl && data.googleDoc?.appended === true && data.dateHeading) {
    try {
      await removeJournalFromGoogleDoc({ uid, docUrl: data.docUrl, dateHeading: data.dateHeading });
      const updatedSnap = await docRef.get();
      const updated = updatedSnap.data();
      await appendJournalToGoogleDoc({
        uid,
        docUrl: data.docUrl,
        sections: {
          dateHeading: updated.dateHeading,
          oneLineSummary: updated.oneLineSummary,
          aiSummaryBullets: updated.aiSummaryBullets,
          structuredEntry: updated.structuredEntry,
          mindsetAnalysis: updated.mindsetAnalysis,
          advice: updated.advice,
          entryMetadata: updated.entryMetadata,
          originalTranscript: updated.originalTranscript,
        },
      });
      docResult = { synced: true };
    } catch (err) {
      console.warn('[editJournalEntry] Google Doc sync failed', err?.message);
      docResult = { synced: false, reason: err?.message };
    }
  }

  return { success: true, docResult };
});
