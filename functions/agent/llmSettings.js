'use strict';

/**
 * llmSettings.js
 *
 * Cloud Functions for user-managed LLM configuration.
 *
 * Exports:
 *   testLLMConnection    — onCall    — tests a provider + key + model combination
 *   getAIModels          — onCall    — returns live model list from provider API
 *                                      → Firestore registry cache
 *                                      → curated hardcoded fallback
 *   refreshModelRegistry — onSchedule — daily refresh of llm_model_registry/{provider}
 *                                       using any user's stored API key for that provider
 *
 * Data stored on profiles/{uid}:
 *   aiProvider              'gemini' | 'openai' | 'anthropic'
 *   aiModel                 e.g. 'gemini-2.5-flash', 'gpt-4o-mini', 'claude-3-5-haiku-20241022'
 *   aiApiKey                user-supplied API key (plaintext, same pattern as hardcoverToken)
 *   aiSystemPromptOverride  global addition to every system prompt
 *
 * Model registry (Firestore — server-only writes):
 *   llm_model_registry/{provider}
 *     models    []  — same shape as FALLBACK_MODELS entries
 *     updatedAt Timestamp
 *     source    'live'
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { defineSecret }       = require('firebase-functions/params');
const admin                  = require('firebase-admin');

// BOB's own Gemini key (available to the refresh function)
const GOOGLE_AI_STUDIO_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');

// Registry TTL: consider entries stale after 25 hours
const REGISTRY_TTL_MS = 25 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Curated fallback model lists — last-resort safety net; updated each deploy.
// These are only shown when both live fetch AND the Firestore registry fail.
// ---------------------------------------------------------------------------

const FALLBACK_MODELS = {
  gemini: [
    { id: 'gemini-2.5-pro',            name: 'Gemini 2.5 Pro',              contextWindow: 1000000, tier: 'premium',  description: 'Most capable Gemini model' },
    { id: 'gemini-2.5-flash',          name: 'Gemini 2.5 Flash',            contextWindow: 1000000, tier: 'standard', description: 'Fast and capable, best value' },
    { id: 'gemini-2.5-flash-lite',     name: 'Gemini 2.5 Flash Lite',       contextWindow: 1000000, tier: 'fast',     description: 'Fastest, lowest cost' },
    { id: 'gemini-2.0-flash',          name: 'Gemini 2.0 Flash',            contextWindow: 1000000, tier: 'standard', description: 'Previous gen flash' },
    { id: 'gemini-1.5-pro',            name: 'Gemini 1.5 Pro',              contextWindow: 2000000, tier: 'premium',  description: '2M token context window' },
    { id: 'gemini-1.5-flash',          name: 'Gemini 1.5 Flash',            contextWindow: 1000000, tier: 'fast',     description: 'Good for audio transcription' },
    { id: 'gemini-1.5-flash-8b',       name: 'Gemini 1.5 Flash 8B',         contextWindow: 1000000, tier: 'fast',     description: 'Smallest Gemini, cheapest' },
  ],
  openai: [
    { id: 'gpt-4.1',                   name: 'GPT-4.1',                     contextWindow: 1000000, tier: 'premium',  description: 'Latest GPT-4 class model' },
    { id: 'gpt-4.1-mini',              name: 'GPT-4.1 Mini',                contextWindow: 1000000, tier: 'standard', description: 'Fast and affordable' },
    { id: 'gpt-4.1-nano',              name: 'GPT-4.1 Nano',                contextWindow: 1000000, tier: 'fast',     description: 'Fastest, lowest cost' },
    { id: 'gpt-4o',                    name: 'GPT-4o',                      contextWindow: 128000,  tier: 'premium',  description: 'Multimodal GPT-4' },
    { id: 'gpt-4o-mini',               name: 'GPT-4o Mini',                 contextWindow: 128000,  tier: 'standard', description: 'Best value OpenAI model' },
    { id: 'o3',                        name: 'o3',                          contextWindow: 200000,  tier: 'premium',  description: 'Advanced reasoning' },
    { id: 'o4-mini',                   name: 'o4-mini',                     contextWindow: 200000,  tier: 'standard', description: 'Fast reasoning model' },
  ],
  anthropic: [
    { id: 'claude-opus-4-5',           name: 'Claude Opus 4.5',             contextWindow: 200000,  tier: 'premium',  description: 'Most capable Claude' },
    { id: 'claude-sonnet-4-5',         name: 'Claude Sonnet 4.5',           contextWindow: 200000,  tier: 'standard', description: 'Best balance of speed and quality' },
    { id: 'claude-haiku-3-5',          name: 'Claude Haiku 3.5',            contextWindow: 200000,  tier: 'fast',     description: 'Fastest Claude, best value' },
    { id: 'claude-opus-4',             name: 'Claude Opus 4',               contextWindow: 200000,  tier: 'premium',  description: 'Previous Opus' },
    { id: 'claude-sonnet-4',           name: 'Claude Sonnet 4',             contextWindow: 200000,  tier: 'standard', description: 'Previous Sonnet' },
  ],
};

// Simple test prompt used to validate an API key works
const TEST_PROMPT = 'Reply with exactly: "BOB connection verified." and nothing else.';

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

async function _readRegistry(provider) {
  try {
    const db = admin.firestore();
    const snap = await db.collection('llm_model_registry').doc(provider).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data.models || !data.updatedAt) return null;
    // Check freshness
    const age = Date.now() - data.updatedAt.toMillis();
    if (age > REGISTRY_TTL_MS) return null; // stale
    return data.models;
  } catch (e) {
    console.warn(`[llmSettings] Registry read failed for ${provider}:`, e?.message);
    return null;
  }
}

async function _writeRegistry(provider, models) {
  try {
    const db = admin.firestore();
    await db.collection('llm_model_registry').doc(provider).set({
      models,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'live',
    });
  } catch (e) {
    console.warn(`[llmSettings] Registry write failed for ${provider}:`, e?.message);
  }
}

// ---------------------------------------------------------------------------
// getAIModels — fetch live models from provider API, fallback chain:
//   1. Live API fetch (if user has key)
//   2. Firestore registry cache (refreshed daily / from any user's successful live fetch)
//   3. Hardcoded FALLBACK_MODELS
// ---------------------------------------------------------------------------

exports.getAIModels = onCall(
  { region: 'europe-west2', memory: '256MiB', timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { provider, apiKey } = request.data || {};
    if (!provider || !FALLBACK_MODELS[provider]) {
      throw new HttpsError('invalid-argument', `Unknown provider: ${provider}`);
    }

    // If the user has a key, try a live fetch first
    if (apiKey) {
      try {
        const liveModels = await _fetchLiveModels(provider, apiKey.trim());
        if (liveModels && liveModels.length > 0) {
          // Opportunistically update the shared registry (fire-and-forget)
          _writeRegistry(provider, liveModels).catch(() => {});
          return { ok: true, source: 'live', models: liveModels };
        }
      } catch (e) {
        console.warn(`[llmSettings] Live model fetch failed for ${provider}:`, e?.message);
      }
    }

    // No key or live fetch failed — check the Firestore registry
    const registryModels = await _readRegistry(provider);
    if (registryModels && registryModels.length > 0) {
      return { ok: true, source: 'registry', models: registryModels };
    }

    // Last resort: hardcoded curated list
    return { ok: true, source: 'fallback', models: FALLBACK_MODELS[provider] };
  },
);

// ---------------------------------------------------------------------------
// refreshModelRegistry — runs daily at 03:00 UTC
// Scans profiles for users with each provider's API key and uses the first
// valid key to refresh that provider's model list in Firestore.
// Gemini always refreshes using BOB's own key.
// ---------------------------------------------------------------------------

exports.refreshModelRegistry = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'UTC',
    region: 'europe-west2',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: [GOOGLE_AI_STUDIO_API_KEY],
  },
  async () => {
    const db = admin.firestore();
    console.log('[llmSettings] refreshModelRegistry started');

    // --- Gemini: always use BOB's own key ---
    try {
      const geminiKey = GOOGLE_AI_STUDIO_API_KEY.value();
      if (geminiKey) {
        const models = await _fetchLiveModels('gemini', geminiKey);
        if (models && models.length > 0) {
          await _writeRegistry('gemini', models);
          console.log(`[llmSettings] Registry updated: gemini (${models.length} models)`);
        }
      }
    } catch (e) {
      console.warn('[llmSettings] Gemini registry refresh failed:', e?.message);
    }

    // --- OpenAI + Anthropic: scan profiles for any user's key ---
    const providersToRefresh = ['openai', 'anthropic'];
    for (const provider of providersToRefresh) {
      try {
        // Find the first profile that has a key for this provider
        const profilesSnap = await db.collection('profiles')
          .where('aiProvider', '==', provider)
          .limit(5) // try up to 5 in case first key is expired/invalid
          .get();

        let refreshed = false;
        for (const doc of profilesSnap.docs) {
          const key = doc.data().aiApiKey;
          if (!key || key.length < 10) continue;
          try {
            const models = await _fetchLiveModels(provider, key.trim());
            if (models && models.length > 0) {
              await _writeRegistry(provider, models);
              console.log(`[llmSettings] Registry updated: ${provider} (${models.length} models)`);
              refreshed = true;
              break;
            }
          } catch (innerErr) {
            console.warn(`[llmSettings] Key for ${provider} from profile ${doc.id} failed:`, innerErr?.message);
          }
        }

        if (!refreshed) {
          console.log(`[llmSettings] No valid key found to refresh ${provider} registry — keeping existing cache`);
        }
      } catch (e) {
        console.warn(`[llmSettings] Registry refresh failed for ${provider}:`, e?.message);
      }
    }

    console.log('[llmSettings] refreshModelRegistry complete');
  },
);

// ---------------------------------------------------------------------------
// testLLMConnection — validate an API key + model with a real request
// ---------------------------------------------------------------------------

exports.testLLMConnection = onCall(
  { region: 'europe-west2', memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { provider, apiKey, model } = request.data || {};
    if (!provider) throw new HttpsError('invalid-argument', 'provider is required');
    if (!apiKey)   throw new HttpsError('invalid-argument', 'apiKey is required');
    if (!model)    throw new HttpsError('invalid-argument', 'model is required');

    if (!FALLBACK_MODELS[provider]) {
      throw new HttpsError('invalid-argument', `Unknown provider: ${provider}`);
    }

    const startMs = Date.now();
    try {
      let reply;
      if (provider === 'gemini')         reply = await _testGemini(apiKey.trim(), model);
      else if (provider === 'openai')    reply = await _testOpenAI(apiKey.trim(), model);
      else if (provider === 'anthropic') reply = await _testAnthropic(apiKey.trim(), model);
      else throw new Error(`Unsupported provider: ${provider}`);

      const latencyMs = Date.now() - startMs;
      return { ok: true, response: reply, latencyMs };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), latencyMs: Date.now() - startMs };
    }
  },
);

// ---------------------------------------------------------------------------
// Live model fetch helpers
// ---------------------------------------------------------------------------

async function _fetchLiveModels(provider, apiKey) {
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.models || [])
      .filter((m) => m.name && m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => {
        const id = m.name.replace('models/', '');
        return {
          id,
          name: m.displayName || id,
          contextWindow: m.inputTokenLimit || null,
          tier: _geminiTier(id),
          description: m.description || null,
        };
      })
      .sort((a, b) => _tierOrder(a.tier) - _tierOrder(b.tier));
  }

  if (provider === 'openai') {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const chatModels = (data.data || [])
      .filter((m) => /^(gpt-|o\d)/i.test(m.id) && !m.id.includes('instruct') && !m.id.includes('realtime') && !m.id.includes('audio'))
      .sort((a, b) => b.created - a.created)
      .slice(0, 25);
    return chatModels.map((m) => ({
      id: m.id,
      name: _openAIDisplayName(m.id),
      contextWindow: null,
      tier: _openAITier(m.id),
      description: null,
    }));
  }

  if (provider === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.data || []).map((m) => ({
      id: m.id,
      name: m.display_name || m.id,
      contextWindow: null,
      tier: _anthropicTier(m.id),
      description: null,
    }));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Test connection helpers
// ---------------------------------------------------------------------------

async function _testGemini(apiKey, model) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const mdl = genAI.getGenerativeModel({ model });
  const result = await mdl.generateContent(TEST_PROMPT);
  return result.response.text()?.trim();
}

async function _testOpenAI(apiKey, model) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      max_tokens: 50,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim();
}

async function _testAnthropic(apiKey, model) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{ role: 'user', content: TEST_PROMPT }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Anthropic HTTP ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data?.content?.[0]?.text?.trim();
}

// ---------------------------------------------------------------------------
// Tier / display name helpers
// ---------------------------------------------------------------------------

function _geminiTier(id) {
  if (id.includes('pro'))  return 'premium';
  if (id.includes('lite') || id.includes('8b')) return 'fast';
  return 'standard';
}

function _openAITier(id) {
  if (/^o\d/.test(id)) return 'reasoning';
  if (id.includes('mini') || id.includes('nano')) return 'fast';
  return 'premium';
}

function _anthropicTier(id) {
  if (id.includes('opus'))   return 'premium';
  if (id.includes('haiku'))  return 'fast';
  return 'standard';
}

function _tierOrder(tier) {
  return { premium: 0, reasoning: 0, standard: 1, fast: 2 }[tier] ?? 3;
}

function _openAIDisplayName(id) {
  return id
    .replace('gpt-', 'GPT-')
    .replace(/-(\d{4})$/, '') // strip date suffixes like -0125
    .replace(/-/g, ' ')
    .replace(/\b(\w)/g, (c) => c.toUpperCase());
}

module.exports = exports;
