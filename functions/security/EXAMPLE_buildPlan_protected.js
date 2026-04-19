/**
 * EXAMPLE: Protected buildPlan Function
 * 
 * This is a complete example showing how to integrate reCAPTCHA security
 * into an existing Cloud Function. Use this as a template for other functions.
 * 
 * Copy this pattern to protect other functions in your app.
 */

// ============================================================================
// BEFORE: Original function (vulnerable to spam)
// ============================================================================

/*
exports.buildPlan = httpsV2.onCall(async (data, context) => {
  if (!context.auth) {
    throw new Error('Unauthorized');
  }

  const { startDate, userId } = data;
  
  // ... build plan logic without spam protection
  return { success: true, plan: {} };
});
*/

// ============================================================================
// AFTER: Protected function with reCAPTCHA + Rate Limiting
// ============================================================================

const { secureFunction } = require('./security/recaptchaSecurityHandler');

/**
 * Build a daily/weekly plan for a user
 * 
 * Protected with:
 * - ✅ reCAPTCHA V2 verification (prevents automated attacks)
 * - ✅ Rate limiting (30 calls/minute per user)
 * - ✅ Authentication requirement
 * 
 * Called from frontend via: callWithRecaptcha(buildPlanFunc, data, 'buildPlan')
 */
exports.buildPlan = httpsV2.onCall(
  secureFunction(
    async (data, context) => {
      // At this point, function is guaranteed:
      // 1. User is authenticated (context.auth exists)
      // 2. reCAPTCHA token was verified (score >= 0.5)
      // 3. User hasn't exceeded 30 calls/minute
      
      const { startDate, userId, options = {} } = data;
      
      // ✅ Safe to proceed with your logic
      console.log(`[buildPlan] Building plan for user: ${userId}`);
      
      // Your existing plan building logic here
      try {
        // Example: load user data, build schedule, etc.
        const userRef = admin.firestore().collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
          throw new Error('User not found');
        }

        // Build plan... (your existing implementation)
        const plan = {
          id: `plan-${Date.now()}`,
          userId,
          date: startDate,
          blocks: [],
          created: new Date(),
        };

        // Save to Firestore
        await userRef.collection('plans').add(plan);

        return {
          success: true,
          plan,
          message: 'Plan created successfully',
        };
      } catch (error) {
        console.error('[buildPlan] Error building plan:', error);
        throw new Error(`Failed to build plan: ${error.message}`);
      }
    },
    {
      // Security configuration for this function
      requireAuth: true,                // Require user login
      minRecaptchaScore: 0.5,          // Accept scores >= 0.5
      skipRecaptcha: false,             // Always verify reCAPTCHA
      skipRateLimit: false,             // Always check rate limit
    }
  )
);

// ============================================================================
// FRONTEND INTEGRATION EXAMPLE
// ============================================================================

/*
// In your React component (e.g., PlanningView.tsx)

import { httpsCallable } from 'firebase/functions';
import { callWithRecaptcha } from './utils/recaptchaHelper';
import { functions, auth } from './firebase';

async function handleBuildPlan(startDate) {
  try {
    // Get the callable function
    const buildPlanFunc = httpsCallable(functions, 'buildPlan');

    // Call with reCAPTCHA protection (automatically adds token)
    const result = await callWithRecaptcha(
      buildPlanFunc,
      {
        startDate,
        userId: auth.currentUser?.uid,
        options: {
          // any other options for your function
        },
      },
      'buildPlan'  // Action name (used in reCAPTCHA scoring)
    );

    console.log('Plan created:', result.data);
    showSuccessNotification('Plan created successfully!');
    setPlan(result.data.plan);

  } catch (error) {
    console.error('Failed to build plan:', error);
    
    // Handle different error types
    if (error.message.includes('Rate limit')) {
      showErrorNotification(
        'Too many requests. Please wait a moment and try again.'
      );
    } else if (error.message.includes('reCAPTCHA')) {
      showErrorNotification(
        'Verification failed. Please refresh the page and try again.'
      );
    } else if (error.message.includes('Unauthorized')) {
      showErrorNotification('Please sign in to continue.');
      redirectToLogin();
    } else {
      showErrorNotification('Failed to create plan. Please try again.');
    }
  }
}
*/

// ============================================================================
// MONITORING & DEBUGGING
// ============================================================================

/**
 * Check function logs:
 * 
 * $ firebase functions:log
 * 
 * Look for entries like:
 * [reCAPTCHA] reCAPTCHA passed with score 0.85 for action "buildPlan"
 * [Security] Rate limit check passed (25 calls remaining)
 * [buildPlan] Building plan for user: abc123
 */

/**
 * Check rate limit data:
 * 
 * Firestore → Collections → system/rate_limits
 * 
 * Each user document shows:
 * {
 *   calls: [1709900123456, 1709900124000, ...],  // Array of timestamps
 *   lastUpdated: Timestamp,
 *   totalCalls: 42
 * }
 */

// ============================================================================
// VARIATIONS: Different Security Levels
// ============================================================================

// Example 1: STRICT - High-value operations
/*
exports.deleteAllPlans = httpsV2.onCall(
  secureFunction(
    async (data, context) => {
      // Delete all plans logic
    },
    {
      requireAuth: true,
      minRecaptchaScore: 0.8,      // Very strict score
      skipRecaptcha: false,
      skipRateLimit: false,
    }
  )
);
*/

// Example 2: MODERATE - Regular operations
/*
exports.buildPlan = httpsV2.onCall(
  secureFunction(
    async (data, context) => {
      // Build plan logic
    },
    {
      requireAuth: true,
      minRecaptchaScore: 0.5,      // Standard score
      skipRecaptcha: false,
      skipRateLimit: false,
    }
  )
);
*/

// Example 3: LENIENT - Read-only operations
/*
exports.viewPlans = httpsV2.onCall(
  secureFunction(
    async (data, context) => {
      // List plans logic
    },
    {
      requireAuth: false,          // No login required
      minRecaptchaScore: 0.3,      // Lenient score
      skipRecaptcha: false,
      skipRateLimit: true,         // No rate limit
    }
  )
);
*/

// ============================================================================
// ERROR HANDLING
// ============================================================================

/*
// Common errors thrown by secureFunction:

1. "Unauthorized: No authentication provided"
   → User not logged in
   → Require login before calling

2. "reCAPTCHA verification failed"
   → Token is invalid or expired (> 2 minutes)
   → Retry the function call
   → User might be a bot (low score)

3. "Rate limit exceeded. Please try again later."
   → User exceeded 30 calls/minute
   → Show message: "Please wait a moment"
   → Implement exponential backoff retry

4. Custom function errors (from your logic)
   → "User not found"
   → "Already have a plan for this date"
   → Handle as normal errors
*/

// ============================================================================
// TESTING LOCALLY
// ============================================================================

/*
// Test reCAPTCHA locally with debug token:

// 1. Set debug token environment variable
export REACT_APP_APPCHECK_DEBUG_TOKEN=true

// 2. Start dev server
npm start

// 3. Check browser console for reCAPTCHA debug token
"App Check token: [token]..."

// 4. Run test against local functions emulator
firebase emulators:start

// 5. Monitor logs
firebase functions:log --only buildPlan
*/

module.exports = {
  // Export only for testing/documentation
};
