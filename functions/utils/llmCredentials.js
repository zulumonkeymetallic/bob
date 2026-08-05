'use strict';

/**
 * llmCredentials.js — the single place that decides whose API key pays for a model call.
 *
 * BOB is bring-your-own-key. Before this module existed, a user with no key configured still
 * got working AI: `callLLMJson` fell through to `process.env.OPENROUTER_API_KEY`, `callGemini`
 * fell through to Vertex AI on project bob20250810, and callAnthropic/callOpenAI/callOpenRouter
 * each fell through to their own `process.env.*` key. Every one of those paths billed the
 * project owner for someone else's usage, which is the thing this module exists to stop.
 *
 * The rule: a call resolves to a key the *user* supplied, or it fails with a typed error.
 * The only exceptions are the UIDs in `BYOK_EXEMPT_UIDS` (see below) — the owner's own
 * automation and the demo accounts, which are deliberately on BOB's own infrastructure.
 *
 * Callers should let `LLMCredentialError` propagate rather than swallowing it: `recordLLMStatus`
 * turns it into something the user actually sees in the app, and a silent `{}` return teaches
 * them nothing about why AI stopped working.
 */

const admin = require('firebase-admin');

const SUPPORTED_PROVIDERS = ['gemini', 'openai', 'anthropic', 'openrouter'];

/** Where the per-user status doc lives. One doc per user; the web app subscribes to it. */
const STATUS_COLLECTION = 'ai_status';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Failure codes, in the order a user can act on them.
 *
 * `missing_key` is a configuration state rather than a fault — it is what every user hits on
 * day one, so it is worded as an instruction rather than an error everywhere it surfaces.
 */
const CODES = {
  MISSING_KEY:       'missing_key',
  INVALID_KEY:       'invalid_key',
  NO_CREDIT:         'no_credit',
  RATE_LIMITED:      'rate_limited',
  MODEL_UNAVAILABLE: 'model_unavailable',
  PROVIDER_ERROR:    'provider_error',
};

class LLMCredentialError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'LLMCredentialError';
    this.code = code;
    this.provider = meta.provider || null;
    this.model = meta.model || null;
    this.purpose = meta.purpose || null;
    /** True when the user can fix this themselves in Settings → AI. */
    this.userActionable = code !== CODES.PROVIDER_ERROR;
  }
}

/**
 * Maps a provider HTTP status onto a code.
 *
 * 402 is separated from 401/403 because "your key is wrong" and "your key is fine but you have
 * no credit left" need completely different instructions, and OpenRouter in particular returns
 * 402 routinely once a user's balance runs out.
 */
function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return CODES.INVALID_KEY;
  if (status === 402) return CODES.NO_CREDIT;
  if (status === 429) return CODES.RATE_LIMITED;
  if (status === 404) return CODES.MODEL_UNAVAILABLE;
  return CODES.PROVIDER_ERROR;
}

/**
 * Best-effort classification of an arbitrary thrown error.
 *
 * Provider SDKs do not share an error shape, and several report auth failures only in the
 * message text, so this reads a status code where one exists and falls back to matching the
 * message. Wrong guesses degrade to `provider_error`, which is the safe default: it tells the
 * user something broke without claiming their key is invalid when it is not.
 */
function classifyError(err) {
  if (err instanceof LLMCredentialError) return err.code;

  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (typeof status === 'number') return classifyHttpStatus(status);

  const text = String(err?.message || '').toLowerCase();
  const httpMatch = text.match(/http (\d{3})/);
  if (httpMatch) return classifyHttpStatus(Number(httpMatch[1]));

  if (text.includes('api key') || text.includes('unauthorized') || text.includes('invalid_api_key')) {
    return CODES.INVALID_KEY;
  }
  if (text.includes('quota') || text.includes('insufficient') || text.includes('credit')) {
    return CODES.NO_CREDIT;
  }
  if (text.includes('rate limit') || text.includes('too many requests')) return CODES.RATE_LIMITED;
  if (text.includes('not found') || text.includes('does not exist')) return CODES.MODEL_UNAVAILABLE;
  return CODES.PROVIDER_ERROR;
}

const PROVIDER_LABELS = {
  gemini:     'Google Gemini',
  openai:     'OpenAI',
  anthropic:  'Anthropic',
  openrouter: 'OpenRouter',
};

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || 'your AI provider';
}

/** User-facing copy. Written to be read in a banner, so each one ends with what to do next. */
function messageForCode(code, provider, model) {
  const name = providerLabel(provider);
  switch (code) {
    case CODES.MISSING_KEY:
      return `BOB needs your own ${name} API key before it can run AI features. Add one in Settings → AI.`;
    case CODES.INVALID_KEY:
      return `Your ${name} API key was rejected. Check it hasn't been revoked or regenerated, then re-enter it in Settings → AI.`;
    case CODES.NO_CREDIT:
      return `Your ${name} account has no credit left. Top it up, or switch to another provider in Settings → AI.`;
    case CODES.RATE_LIMITED:
      return `${name} is rate-limiting your key. This usually clears on its own; a slower model in Settings → AI will make it rarer.`;
    case CODES.MODEL_UNAVAILABLE:
      return `${name} doesn't recognise the model "${model || 'unknown'}". Pick a different one in Settings → AI.`;
    default:
      return `${name} returned an error. If it keeps happening, try another provider in Settings → AI.`;
  }
}

// ---------------------------------------------------------------------------
// Purpose → feature routing
// ---------------------------------------------------------------------------

/**
 * Maps a call's `purpose` onto one of the seven feature keys the AI settings page exposes,
 * so a user can route (say) task enrichment to a cheap model and the daily digest to a
 * premium one. Purposes not listed here fall back to the user's global provider/model.
 *
 * Lives here rather than in index.js because llmHelper needs the same mapping, and two copies
 * would drift the moment a purpose is added on one side only.
 */
const PURPOSE_TO_FEATURE = {
  // Telegram / agent
  agent_query:                    'telegram',
  agent_briefing:                 'digest',
  agent_propose_plan:             'telegram',
  agent_weekly_review:            'digest',

  // Journal / transcripts
  journalProcess:                 'journal',
  transcriptProcess:              'journal',
  journalEnrich:                  'journal',

  // Morning / weekly digest
  sendMorningBriefing:            'digest',
  sendWeeklyReview:               'digest',
  dailySummaryFocus:              'digest',
  dailyChecklistBriefing:         'digest',

  // Story & KPI generation
  storyTasks:                     'story',
  storyResearchDoc:               'story',
  deriveFromResearch:             'story',
  goalChat:                       'story',
  generateStoriesForGoal:         'story',
  generateStoryAcceptanceCriteria:'story',
  autoAcceptanceCriteria:         'story',
  chatSummary:                    'story',

  // Task enrichment & sizing
  taskEnrich:                     'taskEnrich',
  enhanceNewTask:                 'taskEnrich',
  enhanceTaskDescription:         'taskEnrich',
  taskSizing:                     'taskEnrich',
  storySizing:                    'taskEnrich',
  suggestTaskStoryConversions:    'taskEnrich',

  // Planning & prioritisation
  priority_now:                   'planning',
  replan_day:                     'planning',
  nightlyTaskPrioritization:      'planning',
  prioritizeBacklog:              'planning',
  planCalendar:                   'planning',
  calendarBlockSummary:           'planning',
  goalResearchPlan:               'planning',
  goalResearchDoc:                'planning',

  // Finance
  monzo_ai_category:              'finance',
  finance_commentary:             'finance',
};

function featureForPurpose(purpose) {
  return PURPOSE_TO_FEATURE[purpose] || null;
}

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

const OWNER_UID = '3L3nnXSuTPfr08c8DTXG5zYX37A2';
const DEMO_UID = 'demo-user-jc1-tech';
const AI_TEST_UID = 'ai-test-user-12345abcdef';

/**
 * UIDs still allowed to use BOB's own infrastructure keys.
 *
 * Deliberately narrow and deliberately not a feature flag: this is the list of people whose
 * usage the project owner has agreed to pay for, so it should be obvious in code review who is
 * on it. The demo account is on it on purpose — a prospect trying the demo cannot be asked for
 * an API key — which does mean demo traffic bills the owner. Keep an eye on it, or drop
 * `DEMO_UID` and let the demo show the empty state instead.
 *
 * `BYOK_EXEMPT_UIDS` (comma-separated) overrides the default entirely.
 */
function exemptUids() {
  const raw = String(process.env.BYOK_EXEMPT_UIDS || '').trim();
  if (raw) return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  return new Set([OWNER_UID, DEMO_UID, AI_TEST_UID]);
}

function isExempt(userId) {
  return Boolean(userId) && exemptUids().has(userId);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Picks the provider, model and key for one call.
 *
 * `featureKey` comes from the caller's PURPOSE_TO_FEATURE lookup and lets a user route (say)
 * task enrichment to a cheap model while the daily digest uses a premium one.
 *
 * Note there is no cross-provider fallback: if the user selected Anthropic but only holds a
 * Gemini key, this throws rather than quietly running on Gemini. Silently switching provider
 * changes both the bill and the output quality without telling anyone.
 *
 * @returns {{provider: string, model: string|null, apiKey: string|null, exempt: boolean}}
 * @throws {LLMCredentialError} with code `missing_key` when the user holds no usable key.
 */
function resolveCredentials({ profile = {}, userId = null, featureKey = null, purpose = null, defaultProvider = 'gemini', defaultModel = null }) {
  let provider = String(profile.aiProvider || defaultProvider || 'gemini').toLowerCase();
  let model = profile.aiModel || defaultModel;

  const featureConfig = featureKey && profile.aiFeatureConfig?.[featureKey];
  if (featureConfig) {
    if (featureConfig.provider) provider = String(featureConfig.provider).toLowerCase();
    if (featureConfig.model) model = featureConfig.model;
  }

  if (!SUPPORTED_PROVIDERS.includes(provider)) provider = 'gemini';

  const perProviderKeys = profile.aiApiKeys || {};
  // The legacy single-key field predates per-provider keys and was only ever written for the
  // provider the user had selected at the time, so it is only safe to read when that provider
  // is still the one in play.
  const legacyKey = (!profile.aiApiKeys && profile.aiApiKey) ? profile.aiApiKey : null;
  const apiKey = String(perProviderKeys[provider] || legacyKey || '').trim() || null;

  if (apiKey) return { provider, model, apiKey, exempt: false };

  if (isExempt(userId)) {
    // Exempt accounts fall through to BOB's own infrastructure — the env keys and Vertex ADC.
    return { provider, model, apiKey: null, exempt: true };
  }

  throw new LLMCredentialError(
    CODES.MISSING_KEY,
    messageForCode(CODES.MISSING_KEY, provider, model),
    { provider, model, purpose },
  );
}

// ---------------------------------------------------------------------------
// Status reporting
// ---------------------------------------------------------------------------

/**
 * Records the outcome of a call so the web app can surface it.
 *
 * Success clears the doc rather than appending, because the banner's only job is to answer
 * "is AI working right now" — a history of transient 429s would keep a scary banner up long
 * after the problem passed. `failureCount` survives so a genuinely flapping key is still
 * visible as such.
 *
 * Never throws: a logging failure must not turn a working AI call into a failed one.
 */
async function recordLLMStatus(userId, { ok, provider = null, model = null, code = null, message = null, purpose = null }) {
  if (!userId) return;
  try {
    const db = admin.firestore();
    const ref = db.collection(STATUS_COLLECTION).doc(userId);

    if (ok) {
      const existing = await ref.get();
      if (!existing.exists || !existing.data()?.code) return; // nothing to clear
      await ref.set({
        ok: true,
        code: null,
        message: null,
        provider,
        model,
        purpose: null,
        failureCount: 0,
        clearedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    await ref.set({
      ok: false,
      code,
      message: message || messageForCode(code, provider, model),
      provider,
      model,
      purpose,
      userActionable: code !== CODES.PROVIDER_ERROR,
      failureCount: admin.firestore.FieldValue.increment(1),
      lastFailureAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ownerUid: userId,
    }, { merge: true });
  } catch (e) {
    console.warn('[llmCredentials] failed to record AI status', { userId, error: e?.message });
  }
}

/** Converts any thrown error into a classified LLMCredentialError and records it. */
async function reportFailure(userId, err, { provider = null, model = null, purpose = null } = {}) {
  const code = classifyError(err);
  const message = err instanceof LLMCredentialError
    ? err.message
    : messageForCode(code, provider, model);
  await recordLLMStatus(userId, { ok: false, provider, model, code, message, purpose });
  return { code, message };
}

module.exports = {
  CODES,
  STATUS_COLLECTION,
  SUPPORTED_PROVIDERS,
  PURPOSE_TO_FEATURE,
  featureForPurpose,
  LLMCredentialError,
  classifyError,
  classifyHttpStatus,
  messageForCode,
  providerLabel,
  resolveCredentials,
  recordLLMStatus,
  reportFailure,
  isExempt,
  exemptUids,
};
