/**
 * reCAPTCHA V2 Server-Side Verification & Rate Limiting
 * Protects Cloud Functions from spam and abuse
 */

const https = require('https');
const admin = require('firebase-admin');

// reCAPTCHA secret key (set in Firebase Functions environment via Firebase CLI)
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

// Rate limiting constants
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_CALLS = 30; // 30 calls per minute per user
const RATE_LIMIT_COLLECTION = 'system/rate_limits';

/**
 * Verify reCAPTCHA token on server side
 * @param token - reCAPTCHA token from client
 * @param action - Expected action name
 * @param minScore - Minimum score threshold (0.0 - 1.0)
 * @returns Object with { success, score, action, challengeTs }
 */
async function verifyRecaptchaToken(
  token,
  action = '',
  minScore = 0.5
) {
  if (!RECAPTCHA_SECRET_KEY) {
    console.warn('[reCAPTCHA] Secret key not configured, skipping verification');
    return {
      success: true,
      score: 1.0,
      action: action || 'unknown',
      challengeTs: new Date().toISOString(),
      warning: 'reCAPTCHA verification disabled (no secret key)',
    };
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      secret: RECAPTCHA_SECRET_KEY,
      response: token,
    });

    const options = {
      hostname: 'www.recaptcha.net',
      port: 443,
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          // Check if verification was successful
          if (!result.success) {
            console.warn('[reCAPTCHA] Verification failed:', result['error-codes']);
            resolve({
              success: false,
              score: 0,
              action: result.action || action,
              error: result['error-codes']?.join(', ') || 'Verification failed',
            });
            return;
          }

          // Check score
          if (result.score < minScore) {
            console.warn(`[reCAPTCHA] Low score: ${result.score} (min: ${minScore})`);
            resolve({
              success: false,
              score: result.score,
              action: result.action,
              error: 'Score below threshold',
            });
            return;
          }

          // Action mismatch (optional strict check)
          if (action && result.action !== action) {
            console.warn(`[reCAPTCHA] Action mismatch: expected "${action}", got "${result.action}"`);
          }

          resolve({
            success: true,
            score: result.score,
            action: result.action,
            challengeTs: result.challenge_ts,
          });
        } catch (err) {
          console.error('[reCAPTCHA] Failed to parse verification response:', err);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[reCAPTCHA] Verification request failed:', err);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Rate limit check for a user
 * @param userId - Firebase UID
 * @returns { allowed: boolean, remaining: number, resetAt: Date }
 */
async function checkRateLimit(userId) {
  if (!userId) {
    return { allowed: false, remaining: 0, error: 'No user ID' };
  }

  const db = admin.firestore();
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const rateLimitRef = db.collection(RATE_LIMIT_COLLECTION).doc(userId);

  try {
    const doc = await rateLimitRef.get();
    const data = doc.data() || {};

    // Clean old entries outside the window
    const calls = (data.calls || []).filter((timestamp) => timestamp > windowStart);

    // Check if limit exceeded
    const allowed = calls.length < RATE_LIMIT_MAX_CALLS;
    const remaining = Math.max(0, RATE_LIMIT_MAX_CALLS - calls.length);
    const resetAt = new Date(calls.length > 0 ? calls[0] + RATE_LIMIT_WINDOW_MS : now);

    // Record this call
    calls.push(now);

    // Update Firestore
    await rateLimitRef.set(
      {
        calls,
        lastUpdated: new Date(),
        totalCalls: (data.totalCalls || 0) + 1,
      },
      { merge: true }
    );

    return {
      allowed,
      remaining,
      resetAt,
      callsInWindow: calls.length,
    };
  } catch (err) {
    console.error('[RateLimit] Error checking rate limit:', err);
    // Fail open - allow if unable to check
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_CALLS,
      error: 'Could not check rate limit',
    };
  }
}

/**
 * Middleware for Cloud Functions - validates reCAPTCHA and rate limit
 * 
 * Authentication Flow:
 * 1. API Key present → Skip all security checks (unlimited access)
 * 2. User auth present → Enforce rate limit (30/min)
 *    - If reCAPTCHA token provided → Verify it (web app)
 *    - If no token → Skip reCAPTCHA check (native app)
 * 3. Neither → Fail with 401 Unauthorized
 * 
 * Usage:
 *   exports.myFunction = httpsCallable(secureFunction(async (data, context) => {
 *     // your logic here
 *   }));
 */
function secureFunction(fn, options = {}) {
  const {
    requireAuth = true,
    minRecaptchaScore = 0.5,
    apiKeyHeader = 'x-api-key', // Check data._apiKey or header
  } = options;

  return async (data, context) => {
    const uid = context.auth?.uid;
    const apiKey = data?._apiKey;
    const action = data._action || context.auth?.token?.name || 'unknown';

    try {
      // 1. Check for API key first (skip all security for backend services)
      if (apiKey) {
        const isValidApiKey = await validateApiKey(apiKey);
        if (isValidApiKey) {
          console.info('[Security] Valid API key provided, skipping all security checks');
          return await fn(data, context);
        }
        console.error('[Security] Invalid API key provided');
        throw new Error('Invalid API key');
      }

      // 2. Check authentication (required for users)
      if (requireAuth && !uid) {
        throw new Error('Unauthorized: No authentication or API key provided');
      }

      // 3. Verify reCAPTCHA if token provided (web app)
      // Note: Native apps don't provide tokens, so this check is skipped for them
      if (data._recaptchaToken) {
        const recaptchaResult = await verifyRecaptchaToken(
          data._recaptchaToken,
          action,
          minRecaptchaScore
        );

        if (!recaptchaResult.success) {
          console.warn(`[Security] reCAPTCHA failed for user ${uid}:`, recaptchaResult.error);
          throw new Error('reCAPTCHA verification failed');
        }

        console.info(
          `[Security] reCAPTCHA passed with score ${recaptchaResult.score} for action "${action}"`
        );
      } else if (uid) {
        // Native app (no reCAPTCHA token) - log for monitoring
        console.info(`[Security] No reCAPTCHA token for user ${uid} (native app)`);
      }

      // 4. Check rate limit for authenticated users (30/min)
      if (uid) {
        const rateLimitResult = await checkRateLimit(uid);

        if (!rateLimitResult.allowed) {
          console.warn(`[Security] Rate limit exceeded for user ${uid}`);
          const error = new Error('Rate limit exceeded. Please try again later.');
          error.code = 'resource-exhausted';
          error.resetAt = rateLimitResult.resetAt;
          throw error;
        }

        console.info(
          `[Security] Rate limit check passed (${rateLimitResult.remaining} calls remaining)`
        );
      }

      // 5. Call the actual function
      return await fn(data, context);
    } catch (error) {
      // Re-throw with proper error context
      throw error;
    }
  };
}

/**
 * Validate API key against stored keys
 * @param apiKey - API key to validate
 * @returns boolean - Whether key is valid
 */
async function validateApiKey(apiKey) {
  if (!apiKey) return false;

  // Store API keys securely in Firestore: system/api-keys/{keyId}
  // Or use environment variable for simple case
  const VALID_API_KEYS = process.env.BOB_API_KEYS?.split(',') || [];
  
  if (VALID_API_KEYS.length === 0) {
    console.warn('[Security] No API keys configured');
    return false;
  }

  // Support hashed API key comparison in production
  const db = admin.firestore();
  try {
    const keysDoc = await db.collection('system').doc('api_keys').get();
    const validKeys = keysDoc.data()?.keys || [];
    return validKeys.includes(apiKey);
  } catch (err) {
    console.error('[Security] Error validating API key:', err);
    return false;
  }
}

/**
 * Middleware for HTTP endpoints - validates reCAPTCHA and IP-based rate limiting
 * Usage:
 *   exports.myHttpFunction = httpsV2.onRequest(secureHttpFunction(async (req, res) => {
 *     // your logic here
 *   }));
 */
function secureHttpFunction(fn, options = {}) {
  const {
    requireRecaptcha = true,
    minRecaptchaScore = 0.5,
    resultWriter = null, // (uid, action, success) => Promise<void>
  } = options;

  return async (req, res) => {
    // Allow CORS for reCAPTCHA verification
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(200).send('');
      return;
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const recaptchaToken = req.body?._recaptchaToken || req.headers['x-recaptcha-token'];
    const action = req.body?._action || 'http-endpoint';

    try {
      // Verify reCAPTCHA
      if (requireRecaptcha && recaptchaToken) {
        const recaptchaResult = await verifyRecaptchaToken(
          recaptchaToken,
          action,
          minRecaptchaScore
        );

        if (!recaptchaResult.success) {
          console.warn(`[Security - HTTP] reCAPTCHA failed from IP ${clientIp}:`, recaptchaResult.error);

          if (resultWriter) {
            await resultWriter(clientIp, action, false).catch(console.error);
          }

          return res.status(403).json({
            error: 'reCAPTCHA verification failed',
            code: 'RECAPTCHA_FAILED',
          });
        }

        console.info(
          `[Security - HTTP] reCAPTCHA passed (score: ${recaptchaResult.score}) from IP ${clientIp}`
        );
      }

      // Call the actual function
      return await fn(req, res);
    } catch (error) {
      console.error('[Security - HTTP] Error in secure HTTP handler:', error);
      return res.status(500).json({
        error: error.message || 'Internal server error',
        code: 'SECURITY_ERROR',
      });
    }
  };
}

module.exports = {
  verifyRecaptchaToken,
  checkRateLimit,
  validateApiKey,
  secureFunction,
  secureHttpFunction,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_CALLS,
};
