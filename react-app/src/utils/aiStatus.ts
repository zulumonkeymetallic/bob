/**
 * Pure display logic for the AI status banner.
 *
 * Kept out of the component so the decisions that matter — when to stay quiet, what to call
 * each failure — are testable without mocking Firestore, auth and the router.
 *
 * The source of truth is `ai_status/{uid}`, written by functions/utils/llmCredentials.js.
 */

/** Mirrors llmCredentials.CODES. */
export type AiStatusCode =
  | 'missing_key'
  | 'invalid_key'
  | 'no_credit'
  | 'rate_limited'
  | 'model_unavailable'
  | 'provider_error';

export interface AiStatus {
  ok?: boolean;
  code?: AiStatusCode | null;
  message?: string | null;
  provider?: string | null;
  model?: string | null;
  failureCount?: number;
}

export const AI_PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  vertex: 'Vertex AI',
};

/**
 * Headline per failure kind. `missing_key` is deliberately phrased as setup rather than an
 * error — it is what every new user sees on day one, and calling it a failure is both wrong
 * and off-putting.
 */
export const AI_STATUS_HEADLINES: Record<AiStatusCode, string> = {
  missing_key:       'AI is switched off',
  invalid_key:       'Your API key was rejected',
  no_credit:         'Your AI provider is out of credit',
  rate_limited:      'Your AI provider is rate-limiting you',
  model_unavailable: 'That model no longer exists',
  provider_error:    'Your AI provider returned an error',
};

/**
 * A 429 that cleared on the next call is noise — providers rate-limit routinely under nightly
 * batch load and it fixes itself. One that keeps recurring is a real problem the user should
 * see, so the banner waits for a run of them.
 */
export const RATE_LIMIT_NOISE_THRESHOLD = 3;

/** Whether there is anything worth showing the user. */
export function shouldShowAiStatus(status: AiStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.ok !== false) return false;
  if (!status.code) return false;
  if (status.code === 'rate_limited' && (status.failureCount ?? 1) < RATE_LIMIT_NOISE_THRESHOLD) {
    return false;
  }
  return true;
}

export interface AiStatusPresentation {
  headline: string;
  providerLabel: string | null;
  /** Setup states get a calmer treatment than genuine faults. */
  isSetup: boolean;
  failureCount: number;
  ctaLabel: string;
}

export function describeAiStatus(status: AiStatus): AiStatusPresentation {
  const code = (status.code || 'provider_error') as AiStatusCode;
  const isSetup = code === 'missing_key';
  return {
    headline: AI_STATUS_HEADLINES[code] ?? AI_STATUS_HEADLINES.provider_error,
    // Naming the provider on a setup state reads oddly ("AI is switched off — OpenAI") when
    // the point is that nothing is configured yet.
    providerLabel: !isSetup && status.provider
      ? (AI_PROVIDER_LABELS[status.provider] || status.provider)
      : null,
    isSetup,
    failureCount: status.failureCount ?? 1,
    ctaLabel: isSetup ? 'Add a key' : 'Open AI settings',
  };
}
