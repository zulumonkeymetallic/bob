/**
 * reCAPTCHA V2 Invisible Helper
 * Retrieves reCAPTCHA tokens for calling protected Cloud Functions
 */

declare global {
  interface Window {
    grecaptcha?: {
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
      ready: (callback: () => void) => void;
    };
  }
}

const RECAPTCHA_SITE_KEY = process.env.REACT_APP_RECAPTCHA_V2_SITE_KEY || '';
let recaptchaReady = false;

/**
 * Initialize reCAPTCHA script and prepare for token generation
 */
export function initializeRecaptcha(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (recaptchaReady && window.grecaptcha) {
      resolve();
      return;
    }

    if (!RECAPTCHA_SITE_KEY) {
      console.warn('[reCAPTCHA] Site key not configured, skipping initialization');
      resolve();
      return;
    }

    // Load reCAPTCHA script if not already loaded
    if (!document.querySelector('script[src*="recaptcha"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js';
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        console.error('[reCAPTCHA] Failed to load reCAPTCHA script');
        reject(new Error('Failed to load reCAPTCHA'));
      };
      document.head.appendChild(script);
    }

    // Wait for grecaptcha to be ready
    if (window.grecaptcha) {
      window.grecaptcha.ready(() => {
        recaptchaReady = true;
        resolve();
      });
    } else {
      // Fallback: poll for grecaptcha
      let attempts = 0;
      const checkInterval = setInterval(() => {
        attempts++;
        if (window.grecaptcha) {
          clearInterval(checkInterval);
          window.grecaptcha.ready(() => {
            recaptchaReady = true;
            resolve();
          });
        }
        if (attempts > 50) {
          clearInterval(checkInterval);
          reject(new Error('reCAPTCHA not available after timeout'));
        }
      }, 100);
    }
  });
}

/**
 * Get a reCAPTCHA token for a specific action
 * @param action - Action name (e.g., 'buildPlan', 'syncCalendar')
 * @returns Promise<string> - reCAPTCHA token
 */
export async function getRecaptchaToken(action: string): Promise<string> {
  if (!RECAPTCHA_SITE_KEY) {
    console.warn(`[reCAPTCHA] No site key configured, returning empty token for action: ${action}`);
    return '';
  }

  try {
    await initializeRecaptcha();

    if (!window.grecaptcha) {
      throw new Error('reCAPTCHA is not available');
    }

    const token = await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
    return token;
  } catch (error) {
    console.error(`[reCAPTCHA] Failed to get token for action "${action}":`, error);
    throw error;
  }
}

/**
 * Wrapper for calling protected Cloud Functions with reCAPTCHA token
 * @param callableFunction - Firebase httpsCallable function
 * @param data - Function payload
 * @param action - Action name for reCAPTCHA (defaults to function name)
 * @returns Promise - Function result
 */
export async function callWithRecaptcha(
  callableFunction: any,
  data: any = {},
  action: string = 'callFunction'
): Promise<any> {
  try {
    const recaptchaToken = await getRecaptchaToken(action);
    
    // Add token to the function call data
    const payload = {
      ...data,
      _recaptchaToken: recaptchaToken,
      _action: action,
    };

    return await callableFunction(payload);
  } catch (error) {
    console.error(`[reCAPTCHA] Function call failed for action "${action}":`, error);
    throw error;
  }
}

/**
 * Initialize reCAPTCHA on app startup
 * Call this once in your App component useEffect
 */
export async function setupRecaptchaOnStartup(): Promise<void> {
  if (!RECAPTCHA_SITE_KEY) {
    console.info('[reCAPTCHA] reCAPTCHA not configured (no REACT_APP_RECAPTCHA_V2_SITE_KEY)');
    return;
  }

  try {
    await initializeRecaptcha();
    console.info('[reCAPTCHA] reCAPTCHA initialized successfully');
  } catch (error) {
    console.error('[reCAPTCHA] Failed to initialize reCAPTCHA:', error);
    // Don't throw - allow app to continue even if reCAPTCHA fails
  }
}
