# reCAPTCHA V2 & Rate Limiting Security Setup Guide

> Secure your BOB Cloud Functions against spam and abuse before going public 🔒

## Overview

This guide implements:
- ✅ **Frontend reCAPTCHA V2 (Invisible)** - Client-side token generation
- ✅ **Server-side Verification** - Validate tokens in Firebase Functions
- ✅ **Rate Limiting** - 30 calls/minute per user (configurable)
- ✅ **Security Middleware** - Easy integration with existing functions

**Your reCAPTCHA Keys:**
- **Site Key:** `6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED` (frontend)
- **Secret Key:** Store securely in Firebase CLI (backend)

---

## Step 1: Configure Environment Variables

### Frontend (React App)

Add to `.env` file in `react-app/`:
```bash
# reCAPTCHA V2 Configuration
REACT_APP_RECAPTCHA_V2_SITE_KEY=6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED
```

### Backend (Firebase Functions)

Set the secret key via Firebase CLI:
```bash
# First, get your secret key from Google reCAPTCHA console
# https://www.google.com/recaptcha/admin

# Deploy with secret (set only once)
firebase functions:config:set recaptcha.secret_key="YOUR_SECRET_KEY"
```

**Verify it was set:**
```bash
firebase functions:config:get
```

You should see:
```
recaptcha:
  secret_key: YOUR_SECRET_KEY
```

---

## Step 2: Update Frontend App Component

### Initialize reCAPTCHA on App Startup

In `react-app/src/App.tsx` or your main component:

```typescript
import { useEffect } from 'react';
import { setupRecaptchaOnStartup } from './utils/recaptchaHelper';

function App() {
  useEffect(() => {
    // Initialize reCAPTCHA on app load
    setupRecaptchaOnStartup();
  }, []);

  return (
    // Your app content
  );
}
```

---

## Step 3: Update Callable Functions

### Option A: Protect Existing Callable Functions

**Before:**
```javascript
exports.buildPlan = httpsV2.onCall(async (data, context) => {
  if (!context.auth) throw new Error('Unauthorized');
  // your logic
});
```

**After:**
```javascript
const { secureFunction } = require('./security/recaptchaSecurityHandler');

exports.buildPlan = httpsV2.onCall(
  secureFunction(async (data, context) => {
    // Your existing logic - now protected!
    // - reCAPTCHA verified
    // - Rate limit checked
    // - Auth still required
  })
);
```

### Option B: Custom Configuration

```javascript
exports.criticalFunction = httpsV2.onCall(
  secureFunction(
    async (data, context) => {
      // Your logic
    },
    {
      requireAuth: true,           // Require user login
      minRecaptchaScore: 0.7,     // Stricter score threshold
      skipRecaptcha: false,        // Always verify reCAPTCHA
      skipRateLimit: false,        // Always check rate limit
    }
  )
);
```

### Option C: Skip for Specific Functions

```javascript
// For public functions that don't need full protection
exports.publicFunction = httpsV2.onCall(
  secureFunction(
    async (data, context) => {
      // Your logic
    },
    {
      requireAuth: false,
      skipRecaptcha: false,
      skipRateLimit: true,  // Skip rate limit for public access
    }
  )
);
```

---

## Step 4: Update Frontend Function Calls

### Use `callWithRecaptcha` Helper

**Before:**
```typescript
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const buildPlan = httpsCallable(functions, 'buildPlan');

// Call function
const result = await buildPlan({ /* data */ });
```

**After:**
```typescript
import { httpsCallable } from 'firebase/functions';
import { callWithRecaptcha } from './utils/recaptchaHelper';
import { functions } from './firebase';

const buildPlan = httpsCallable(functions, 'buildPlan');

// Call with reCAPTCHA protection
const result = await callWithRecaptcha(
  buildPlan,
  { /* your data */ },
  'buildPlan' // action name
);
```

### Real World Example

```typescript
async function planMyDay() {
  try {
    const callableFunc = httpsCallable(functions, 'buildPlan');
    
    const result = await callWithRecaptcha(
      callableFunc,
      {
        startDate: '2025-03-09',
        userId: currentUser.uid,
      },
      'buildPlan'
    );

    console.log('Plan created:', result.data);
  } catch (error) {
    if (error.message.includes('Rate limit')) {
      // Show: "Too many requests. Please wait a moment."
      showErrorNotification('Too many requests. Please try again later.');
    } else if (error.message.includes('reCAPTCHA')) {
      // Show: "Verification failed. Please refresh and try again."
      showErrorNotification('Verification failed. Please refresh the page.');
    }
    console.error('Plan failed:', error);
  }
}
```

---

## Step 5: HTTP Endpoints (If Using Direct HTTP Calls)

### Secure HTTP Endpoints

```javascript
const { secureHttpFunction } = require('./security/recaptchaSecurityHandler');

// Before
exports.myHttpEndpoint = httpsV2.onRequest(async (req, res) => {
  // Your logic
});

// After
exports.myHttpEndpoint = httpsV2.onRequest(
  secureHttpFunction(async (req, res) => {
    // Your logic - now protected
  })
);
```

### Call from Frontend

```typescript
async function callHttpEndpoint() {
  const token = await getRecaptchaToken('myAction');

  const response = await fetch(
    'https://your-region-bob20250810.cloudfunctions.net/myHttpEndpoint',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-reCAPTCHA-Token': token,
      },
      body: JSON.stringify({
        _action: 'myAction',
        // ... your data
      }),
    }
  );

  return response.json();
}
```

---

## Step 6: Deploy

### Deploy Frontend
```bash
cd react-app
npm run build
firebase deploy --only hosting
```

### Deploy Functions
```bash
# Ensure secret is set
firebase functions:config:set recaptcha.secret_key="YOUR_SECRET_KEY"

# Deploy
firebase deploy --only functions
```

---

## Monitoring & Debugging

### Check Rate Limit Status

View rate limit data in Firestore:
- Collection: `system/rate_limits`
- Each document is a user ID
- Fields: `calls` (timestamps), `totalCalls`, `lastUpdated`

### View reCAPTCHA Logs

In Firebase Console → Functions → Logs:
```
[reCAPTCHA] Verification failed: [error-codes]
[reCAPTCHA] Low score: 0.3 (min: 0.5)
[Security] reCAPTCHA passed with score 0.85
[Security] Rate limit check passed (25 calls remaining)
```

### Test in Development

```bash
# Allow reCAPTCHA to work locally (optional debug mode)
export REACT_APP_RECAPTCHA_V2_SITE_KEY=6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED

# Start dev server
cd react-app
npm start
```

---

## Configuration Reference

### Rate Limiting

Edit `functions/security/recaptchaSecurityHandler.js`:
```javascript
const RATE_LIMIT_WINDOW_MS = 60 * 1000;     // 1 minute window
const RATE_LIMIT_MAX_CALLS = 30;             // 30 calls per window
```

### Score Thresholds

| Score | Risk Level | Action |
|-------|-----------|--------|
| 0.9-1.0 | Very Low | Allow immediately |
| 0.7-0.9 | Low | Allow with monitoring |
| 0.5-0.7 | Medium | Require user auth |
| 0.0-0.5 | High | Block/Challenge |

---

## Example: Full Integration with `buildPlan` Function

**functions/index.js:**
```javascript
const { secureFunction } = require('./security/recaptchaSecurityHandler');

exports.buildPlan = httpsV2.onCall(
  secureFunction(async (data, context) => {
    const { startDate, userId } = data;
    
    if (!context.auth) {
      throw new Error('Unauthorized');
    }

    // Your existing buildPlan logic
    console.log('Building plan for:', userId);
    
    // Create plan...
    return {
      success: true,
      plan: { /* ... */ }
    };
  }, {
    requireAuth: true,
    minRecaptchaScore: 0.6,
  })
);
```

**React Component:**
```typescript
async function handleBuildPlan() {
  try {
    const buildPlanFunc = httpsCallable(functions, 'buildPlan');
    
    const result = await callWithRecaptcha(
      buildPlanFunc,
      {
        startDate: formatDate(new Date()),
        userId: currentUser.uid,
      },
      'buildPlan'
    );

    toast.success('Plan created successfully!');
    setPlan(result.data.plan);
  } catch (error) {
    if (error.message.includes('Rate limit')) {
      toast.error('Too many requests. Please wait before trying again.');
    } else {
      toast.error('Failed to create plan.');
    }
  }
}
```

---

## Security Best Practices

✅ **DO:**
- Use reCAPTCHA for all public-facing functions
- Always verify tokens server-side (never trust client)
- Implement rate limiting on high-impact operations
- Log suspicious activity
- Monitor score distribution

❌ **DON'T:**
- Expose secret key in frontend code
- Skip server-side verification
- Store reCAPTCHA tokens (they expire after 2 minutes)
- Rely solely on client-side validation
- Ignore rate limit errors

---

## Troubleshooting

### "reCAPTCHA script not loading"
- Check site key is correct
- Ensure HTTPS in production
- Check browser console for CSP errors

### "reCAPTCHA verification failed"
- Verify secret key is set: `firebase functions:config:get`
- Check error codes in logs
- Ensure token isn't expired (> 2 min)

### "Rate limit exceeded"
- Rate limit is 30 calls/minute per user
- Check `system/rate_limits` collection in Firestore
- Clear manually if needed

### "Unauthorized: No authentication provided"
- Ensure user is signed in
- Check Firebase rules

---

## Next Steps

1. ✅ Set environment variables (Step 1)
2. ✅ Update App component (Step 2)
3. ✅ Secure critical functions first (Step 3)
4. ✅ Update frontend calls (Step 4)
5. ✅ Deploy and test (Step 6)
6. ✅ Monitor and adjust thresholds

Happy securing! 🚀
