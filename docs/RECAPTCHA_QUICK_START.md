# reCAPTCHA Quick Start - 5 Minutes

Copy-paste examples for immediate implementation.

## 1️⃣ Environment Setup (1 minute)

### Get Your Secret Key
1. Go to: https://www.google.com/recaptcha/admin
2. Select your "BOB" site
3. Copy the **Secret Key**

### Set in Firebase

```bash
cd /Users/jim/GitHub/bob

# Set the secret (do this once)
firebase functions:config:set recaptcha.secret_key="[PASTE_YOUR_SECRET_KEY_HERE]"

# Verify it worked
firebase functions:config:get
```

### Update `.env`

In `react-app/.env`:
```
REACT_APP_RECAPTCHA_V2_SITE_KEY=6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED
```

---

## 2️⃣ Frontend Setup (2 minutes)

### Add reCAPTCHA Script to HTML

In `public/index.html`, before closing `</head>`:
```html
<script src="https://www.google.com/recaptcha/api.js"></script>
```

### Initialize in App

In `react-app/src/App.tsx`:
```typescript
import { useEffect } from 'react';
import { setupRecaptchaOnStartup } from './utils/recaptchaHelper';

// Inside your component
useEffect(() => {
  setupRecaptchaOnStartup();
}, []);
```

---

## 3️⃣ Protect a Function (2 minutes)

### Update Firebase Function

In `functions/index.js`:

```javascript
// Add import at top
const { secureFunction } = require('./security/recaptchaSecurityHandler');

// Wrap your function (example: buildPlan)
exports.buildPlan = httpsV2.onCall(
  secureFunction(async (data, context) => {
    // ✅ Now automatically protected:
    // - reCAPTCHA verified
    // - Rate limit checked  
    // - Auth required
    
    // Your existing code here
    const { startDate } = data;
    // ... build plan logic
    return { success: true };
  })
);
```

### Update Frontend Call

In your React component:

```typescript
import { httpsCallable } from 'firebase/functions';
import { callWithRecaptcha } from './utils/recaptchaHelper';
import { functions } from './firebase';

// In your handler function
async function handleBuildPlan() {
  try {
    const func = httpsCallable(functions, 'buildPlan');
    
    const result = await callWithRecaptcha(
      func,
      { startDate: '2025-03-09' },
      'buildPlan'
    );
    
    console.log('Success:', result.data);
  } catch (error) {
    console.error('Failed:', error.message);
  }
}
```

---

## 🚀 Deploy

```bash
# Deploy functions with secret
firebase deploy --only functions

# Deploy frontend
cd react-app && npm run build
firebase deploy --only hosting
```

---

## ✅ Test It

1. Go to your app
2. Open browser console
3. Trigger a protected function
4. You should see: `[reCAPTCHA] reCAPTCHA passed with score 0.85`
5. Try calling 30+ times in 1 minute → rate limit kicks in

---

## 📊 Monitor

### Check Firestore `system/rate_limits`
- Document ID = User ID
- Shows call count and timestamps

### View Logs
```bash
firebase functions:log
```

Filter for `[reCAPTCHA]` or `[Security]` to see verifications.

---

## 🔧 Common Adjustments

### Increase Rate Limit
Edit `functions/security/recaptchaSecurityHandler.js`:
```javascript
const RATE_LIMIT_MAX_CALLS = 60;  // Increase from 30
```

### Lower reCAPTCHA Threshold
```javascript
exports.myFunction = httpsV2.onCall(
  secureFunction(async (data, context) => {
    // logic
  }, {
    minRecaptchaScore: 0.3  // More lenient
  })
);
```

### Exclude Specific Functions
```javascript
// Don't check rate limit for this
exports.publicFunction = httpsV2.onCall(
  secureFunction(async (data, context) => {
    // logic
  }, {
    skipRateLimit: true
  })
);
```

---

## ❓ Errors & Fixes

| Error | Fix |
|-------|-----|
| `No site key configured` | Add `REACT_APP_RECAPTCHA_V2_SITE_KEY` to `.env` |
| `Secret key not configured` | Run `firebase functions:config:set recaptcha.secret_key="..."`  |
| `Rate limit exceeded` | User hit 30 calls/min - tell them to wait |
| `reCAPTCHA verification failed` | Token expired (> 2 min) - retry |
| `Unauthorized` | User not signed in - require login first |

---

## Next: Advanced

See [RECAPTCHA_SECURITY_SETUP.md](../RECAPTCHA_SECURITY_SETUP.md) for:
- Advanced configuration
- Custom error handling
- Monitoring & analytics
- Rate limit tuning
- HTTP endpoint protection
