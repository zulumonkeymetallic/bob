/**
 * Firebase App Check verifier for onRequest (HTTP) functions.
 *
 * For onCall functions, use `enforceAppCheck: true` in the function options
 * instead of calling this helper manually — the Firebase SDK handles it.
 *
 * For onRequest functions (priorityNow, replanDay, etc.) you must verify
 * the X-Firebase-AppCheck header manually using this utility.
 *
 * Enforcement is controlled by the ENFORCE_APP_CHECK environment variable:
 *   - 'true'  → reject requests without a valid App Check token
 *   - 'log'   → log a warning but allow the request (soft enforcement)
 *   - anything else (default) → skip check entirely (dev/local mode)
 *
 * To enable enforcement in production:
 *   firebase functions:config:set app.enforce_check=true
 *   Or set ENFORCE_APP_CHECK=true in .env / Cloud Run env
 *
 * Firebase Console setup required:
 *   1. Enable App Check in the Firebase Console for project bob20250810
 *   2. Register reCAPTCHA v3 as a provider for the web app
 *   3. Set REACT_APP_ENABLE_APPCHECK=true and REACT_APP_RECAPTCHA_V3_KEY in the React env
 */

const admin = require('firebase-admin');

const ENFORCE_MODE = (process.env.ENFORCE_APP_CHECK || '').toLowerCase().trim();
// 'true'  → hard block
// 'log'   → soft log
// ''      → skip

/**
 * Verifies the Firebase App Check token from the request headers.
 * Call this at the start of onRequest function bodies, after CORS pre-flight.
 *
 * @param {Object} req - Express-style request object
 * @param {string} [functionName=''] - Name of the calling function for logging
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function verifyAppCheckToken(req, functionName = '') {
  if (!ENFORCE_MODE || ENFORCE_MODE === 'false') {
    return { valid: true }; // App Check not enforced in this environment
  }

  const token = req.header('X-Firebase-AppCheck');

  if (!token) {
    const reason = 'Missing X-Firebase-AppCheck header';
    if (ENFORCE_MODE === 'log') {
      console.warn(`[appCheck][${functionName}] ${reason} — allowed (soft enforcement)`);
      return { valid: true }; // soft — still allow
    }
    return { valid: false, reason };
  }

  try {
    await admin.appCheck().verifyToken(token);
    return { valid: true };
  } catch (err) {
    const reason = `Invalid App Check token: ${err?.message || err}`;
    if (ENFORCE_MODE === 'log') {
      console.warn(`[appCheck][${functionName}] ${reason} — allowed (soft enforcement)`);
      return { valid: true }; // soft — still allow
    }
    return { valid: false, reason };
  }
}

/**
 * For onCall functions: checks whether App Check was verified by the SDK.
 * Works only when the function is NOT using enforceAppCheck: true (which
 * blocks before reaching the handler).
 *
 * @param {Object} req         - onCall request object
 * @param {string} [functionName='']
 * @returns {{ valid: boolean, reason?: string }}
 */
function checkOnCallAppCheck(req, functionName = '') {
  if (!ENFORCE_MODE || ENFORCE_MODE === 'false') {
    return { valid: true };
  }

  const verified = req?.app?.verified === true;

  if (!verified) {
    const reason = 'App Check token not verified';
    if (ENFORCE_MODE === 'log') {
      console.warn(`[appCheck][${functionName}] ${reason} — allowed (soft enforcement)`);
      return { valid: true };
    }
    return { valid: false, reason };
  }

  return { valid: true };
}

module.exports = { verifyAppCheckToken, checkOnCallAppCheck, ENFORCE_MODE };
