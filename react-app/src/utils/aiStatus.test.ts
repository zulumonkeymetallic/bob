import {
  shouldShowAiStatus,
  describeAiStatus,
  RATE_LIMIT_NOISE_THRESHOLD,
  type AiStatus,
} from './aiStatus';

describe('shouldShowAiStatus', () => {
  it('stays quiet when AI is healthy', () => {
    expect(shouldShowAiStatus(null)).toBe(false);
    expect(shouldShowAiStatus(undefined)).toBe(false);
    expect(shouldShowAiStatus({ ok: true })).toBe(false);
    // Cleared status doc: ok with the code nulled out.
    expect(shouldShowAiStatus({ ok: true, code: null })).toBe(false);
  });

  it('stays quiet on a failure with no code, rather than showing an empty banner', () => {
    expect(shouldShowAiStatus({ ok: false })).toBe(false);
  });

  it('shows a missing key, which is the day-one state', () => {
    expect(shouldShowAiStatus({ ok: false, code: 'missing_key' })).toBe(true);
  });

  it('shows key and billing failures immediately', () => {
    expect(shouldShowAiStatus({ ok: false, code: 'invalid_key' })).toBe(true);
    expect(shouldShowAiStatus({ ok: false, code: 'no_credit' })).toBe(true);
    expect(shouldShowAiStatus({ ok: false, code: 'model_unavailable' })).toBe(true);
    expect(shouldShowAiStatus({ ok: false, code: 'provider_error' })).toBe(true);
  });

  it('suppresses a one-off rate limit but surfaces a persistent one', () => {
    // Providers 429 routinely under nightly batch load; a single one is not worth a banner.
    expect(shouldShowAiStatus({ ok: false, code: 'rate_limited', failureCount: 1 })).toBe(false);
    expect(shouldShowAiStatus({
      ok: false, code: 'rate_limited', failureCount: RATE_LIMIT_NOISE_THRESHOLD - 1,
    })).toBe(false);
    expect(shouldShowAiStatus({
      ok: false, code: 'rate_limited', failureCount: RATE_LIMIT_NOISE_THRESHOLD,
    })).toBe(true);
  });

  it('treats a rate limit with no count as a single occurrence', () => {
    expect(shouldShowAiStatus({ ok: false, code: 'rate_limited' })).toBe(false);
  });
});

describe('describeAiStatus', () => {
  it('frames a missing key as setup, not as a fault', () => {
    const out = describeAiStatus({ ok: false, code: 'missing_key', provider: 'openai' });
    expect(out.isSetup).toBe(true);
    expect(out.headline).toBe('AI is switched off');
    expect(out.ctaLabel).toBe('Add a key');
    // Naming a provider here would read as "AI is switched off — OpenAI", which is nonsense
    // when the point is that nothing is configured.
    expect(out.providerLabel).toBeNull();
  });

  it('names the provider on a genuine failure', () => {
    const out = describeAiStatus({ ok: false, code: 'no_credit', provider: 'openrouter' });
    expect(out.isSetup).toBe(false);
    expect(out.providerLabel).toBe('OpenRouter');
    expect(out.ctaLabel).toBe('Open AI settings');
  });

  it('passes through an unrecognised provider rather than dropping it', () => {
    const out = describeAiStatus({ ok: false, code: 'invalid_key', provider: 'mystery-llm' });
    expect(out.providerLabel).toBe('mystery-llm');
  });

  it('falls back to the generic headline for an unknown code', () => {
    const out = describeAiStatus({ ok: false, code: 'something-new' as any });
    expect(out.headline).toBe('Your AI provider returned an error');
  });

  it('defaults the failure count to one', () => {
    expect(describeAiStatus({ ok: false, code: 'invalid_key' }).failureCount).toBe(1);
    expect(describeAiStatus({ ok: false, code: 'invalid_key', failureCount: 7 }).failureCount).toBe(7);
  });
});

describe('status codes match the backend', () => {
  // Guards against the two lists drifting: these are the values
  // functions/utils/llmCredentials.js CODES can write.
  it('handles every code the backend emits', () => {
    const backendCodes = [
      'missing_key', 'invalid_key', 'no_credit',
      'rate_limited', 'model_unavailable', 'provider_error',
    ];
    for (const code of backendCodes) {
      const status = { ok: false, code, failureCount: 99 } as AiStatus;
      expect(shouldShowAiStatus(status)).toBe(true);
      expect(describeAiStatus(status).headline).not.toBe(undefined);
    }
  });
});
