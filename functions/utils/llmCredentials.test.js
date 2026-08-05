'use strict';

const {
  CODES,
  LLMCredentialError,
  classifyError,
  classifyHttpStatus,
  resolveCredentials,
  isExempt,
} = require('./llmCredentials');

const OWNER_UID = '3L3nnXSuTPfr08c8DTXG5zYX37A2';
const STRANGER = 'some-other-user-uid';

describe('resolveCredentials — bring-your-own-key', () => {
  afterEach(() => {
    delete process.env.BYOK_EXEMPT_UIDS;
  });

  it('throws missing_key when a user has no key at all', () => {
    expect(() => resolveCredentials({ profile: {}, userId: STRANGER }))
      .toThrow(LLMCredentialError);

    try {
      resolveCredentials({ profile: {}, userId: STRANGER });
    } catch (e) {
      expect(e.code).toBe(CODES.MISSING_KEY);
      expect(e.userActionable).toBe(true);
    }
  });

  it('returns the user key for their selected provider', () => {
    const out = resolveCredentials({
      profile: { aiProvider: 'anthropic', aiApiKeys: { anthropic: 'sk-ant-123' } },
      userId: STRANGER,
    });
    expect(out).toEqual({ provider: 'anthropic', model: null, apiKey: 'sk-ant-123', exempt: false });
  });

  it('supports openrouter as a first-class provider', () => {
    const out = resolveCredentials({
      profile: { aiProvider: 'openrouter', aiApiKeys: { openrouter: 'sk-or-123' } },
      userId: STRANGER,
    });
    expect(out.provider).toBe('openrouter');
    expect(out.apiKey).toBe('sk-or-123');
  });

  it('does NOT silently fall back to a key for a different provider', () => {
    // User picked Anthropic but only holds a Gemini key. Running on Gemini anyway would change
    // both the bill and the output quality without telling them.
    expect(() => resolveCredentials({
      profile: { aiProvider: 'anthropic', aiApiKeys: { gemini: 'gem-123' } },
      userId: STRANGER,
    })).toThrow(/Anthropic API key/);
  });

  it('lets a per-feature provider override the global one, and demands that key', () => {
    const profile = {
      aiProvider: 'gemini',
      aiApiKeys: { gemini: 'gem-123', openai: 'sk-oa-123' },
      aiFeatureConfig: { digest: { provider: 'openai', model: 'gpt-4o' } },
    };
    const out = resolveCredentials({ profile, userId: STRANGER, featureKey: 'digest' });
    expect(out).toMatchObject({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-oa-123' });

    // Same profile, a feature routed to a provider they have no key for.
    const noKey = { ...profile, aiFeatureConfig: { digest: { provider: 'anthropic' } } };
    expect(() => resolveCredentials({ profile: noKey, userId: STRANGER, featureKey: 'digest' }))
      .toThrow(LLMCredentialError);
  });

  it('only reads the legacy single key when per-provider keys were never written', () => {
    const legacyOnly = resolveCredentials({
      profile: { aiProvider: 'gemini', aiApiKey: 'legacy-123' },
      userId: STRANGER,
    });
    expect(legacyOnly.apiKey).toBe('legacy-123');

    // Once aiApiKeys exists it is authoritative: a stale legacy key must not resurrect access
    // to a provider the user has since cleared.
    expect(() => resolveCredentials({
      profile: { aiProvider: 'gemini', aiApiKey: 'legacy-123', aiApiKeys: { gemini: null } },
      userId: STRANGER,
    })).toThrow(LLMCredentialError);
  });

  it('lets exempt accounts through with no key, and marks them exempt', () => {
    const out = resolveCredentials({ profile: {}, userId: OWNER_UID });
    expect(out.exempt).toBe(true);
    expect(out.apiKey).toBeNull();
  });

  it('honours a BYOK_EXEMPT_UIDS override, including revoking the owner', () => {
    process.env.BYOK_EXEMPT_UIDS = 'only-this-uid';
    expect(isExempt('only-this-uid')).toBe(true);
    expect(isExempt(OWNER_UID)).toBe(false);
    expect(() => resolveCredentials({ profile: {}, userId: OWNER_UID })).toThrow(LLMCredentialError);
  });

  it('treats an unknown provider as gemini rather than trusting it', () => {
    const out = resolveCredentials({
      profile: { aiProvider: 'definitely-not-real', aiApiKeys: { gemini: 'gem-123' } },
      userId: STRANGER,
    });
    expect(out.provider).toBe('gemini');
  });
});

describe('error classification', () => {
  it('separates a bad key from an empty balance', () => {
    expect(classifyHttpStatus(401)).toBe(CODES.INVALID_KEY);
    expect(classifyHttpStatus(403)).toBe(CODES.INVALID_KEY);
    expect(classifyHttpStatus(402)).toBe(CODES.NO_CREDIT);
    expect(classifyHttpStatus(429)).toBe(CODES.RATE_LIMITED);
    expect(classifyHttpStatus(404)).toBe(CODES.MODEL_UNAVAILABLE);
    expect(classifyHttpStatus(500)).toBe(CODES.PROVIDER_ERROR);
  });

  it('reads the status out of the message format the provider callers throw', () => {
    // e.g. `throw new Error(\`Anthropic HTTP 401: ...\`)`
    expect(classifyError(new Error('Anthropic HTTP 401: invalid x-api-key'))).toBe(CODES.INVALID_KEY);
    expect(classifyError(new Error('OpenRouter HTTP 402: insufficient credits'))).toBe(CODES.NO_CREDIT);
  });

  it('falls back to message matching when there is no status', () => {
    expect(classifyError(new Error('API key not valid. Please pass a valid API key.'))).toBe(CODES.INVALID_KEY);
    expect(classifyError(new Error('You exceeded your current quota'))).toBe(CODES.NO_CREDIT);
    expect(classifyError(new Error('rate limit reached'))).toBe(CODES.RATE_LIMITED);
  });

  it('degrades to provider_error rather than blaming the user key', () => {
    expect(classifyError(new Error('socket hang up'))).toBe(CODES.PROVIDER_ERROR);
  });

  it('preserves an already-classified error', () => {
    const err = new LLMCredentialError(CODES.MISSING_KEY, 'nope', { provider: 'openai' });
    expect(classifyError(err)).toBe(CODES.MISSING_KEY);
  });
});
