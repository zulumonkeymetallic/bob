# reCAPTCHA Implementation Checklist

Track your progress securing BOB before launch. ✅

## Phase 1: Setup & Configuration

- [ ] **Get Secret Key from Google**
  - Go to: https://www.google.com/recaptcha/admin/sites
  - Select your BOB site
  - Copy the Secret Key

- [ ] **Set Firebase Secret**
  ```bash
  firebase functions:config:set recaptcha.secret_key="[YOUR_SECRET_KEY]"
  firebase functions:config:get  # Verify it's set
  ```

- [ ] **Update Frontend `.env`**
  - [ ] Add `REACT_APP_RECAPTCHA_V2_SITE_KEY=6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED` to `react-app/.env`
  - [ ] Verify the key is correct

- [ ] **Add reCAPTCHA Script to Frontend**
  - [ ] Edit `react-app/public/index.html`
  - [ ] Add before `</head>`:
    ```html
    <script src="https://www.google.com/recaptcha/api.js"></script>
    ```

---

## Phase 2: Backend Implementation

- [ ] **Copy Security Handler**
  - [ ] File exists at: `/functions/security/recaptchaSecurityHandler.js` ✅
  - [ ] File contains: `verifyRecaptchaToken`, `checkRateLimit`, `secureFunction`, `secureHttpFunction`

- [ ] **Update `functions/index.js`**
  - [ ] Add import at top:
    ```javascript
    const { secureFunction } = require('./security/recaptchaSecurityHandler');
    ```

- [ ] **Protect High-Priority Functions** (Start here)
  - [ ] `buildPlan` - Daily planning (HIGH PRIORITY)
  - [ ] `syncCalendarAndTasks` - Calendar sync (HIGH PRIORITY)
  - [ ] `enhanceNewTask` - LLM enhancement (HIGH PRIORITY)
  - [ ] `planBlocksV2` - Block planning (MEDIUM PRIORITY)
  - [ ] `sendAssistantMessage` - Chat (MEDIUM PRIORITY)

  **Template:**
  ```javascript
  const { secureFunction } = require('./security/recaptchaSecurityHandler');
  
  exports.functionName = httpsV2.onCall(
    secureFunction(async (data, context) => {
      // Your existing logic here
    }, {
      requireAuth: true,
      minRecaptchaScore: 0.5,
    })
  );
  ```

- [ ] **Protect Public Functions** (OAuth, webhooks)
  - [ ] Check which functions are truly public (no auth required)
  - [ ] For public: Use `skipRateLimit: true` if needed
  - [ ] Example:
    ```javascript
    exports.stravaOAuthCallback = httpsV2.onRequest(
      secureHttpFunction(async (req, res) => {
        // logic
      }, {
        requireRecaptcha: true,
        minRecaptchaScore: 0.3,
      })
    );
    ```

---

## Phase 3: Frontend Implementation

- [ ] **Copy reCAPTCHA Helper**
  - [ ] File exists at: `react-app/src/utils/recaptchaHelper.ts` ✅
  - [ ] Contains: `initializeRecaptcha`, `getRecaptchaToken`, `callWithRecaptcha`, `setupRecaptchaOnStartup`

- [ ] **Initialize in App Component**
  - [ ] Edit `react-app/src/App.tsx`
  - [ ] Add import:
    ```typescript
    import { setupRecaptchaOnStartup } from './utils/recaptchaHelper';
    ```
  - [ ] Add to `useEffect`:
    ```typescript
    useEffect(() => {
      setupRecaptchaOnStartup();
    }, []);
    ```

- [ ] **Update Function Calls** (Same components as backend protection)
  
  **For each protected function, find where it's called:**
  
  1. **buildPlan** (likely in `PlanningView`, `DailyPlanner`)
     - [ ] Find the component
     - [ ] Import: `import { callWithRecaptcha } from './utils/recaptchaHelper';`
     - [ ] Change from:
       ```typescript
       const result = await buildPlanFunc(data);
       ```
       To:
       ```typescript
       const result = await callWithRecaptcha(buildPlanFunc, data, 'buildPlan');
       ```
     - [ ] Add error handling for `Rate limit exceeded`

  2. **syncCalendarAndTasks** (likely in `CalendarView`, `Settings`)
     - [ ] Find the component
     - [ ] Update the function call
     - [ ] Test sync functionality

  3. **enhanceNewTask** (likely in `TaskCreate`, `TaskEdit`)
     - [ ] Find the component
     - [ ] Update the function call
     - [ ] Test task creation

  4. **Other high-priority functions**
     - [ ] Repeat for each

- [ ] **Add Error Handling**
  ```typescript
  try {
    const result = await callWithRecaptcha(func, data, 'action');
  } catch (error) {
    if (error.message.includes('Rate limit')) {
      showNotification('Too many requests. Please wait.');
    } else if (error.message.includes('reCAPTCHA')) {
      showNotification('Verification failed. Please refresh.');
    }
  }
  ```

---

## Phase 4: Testing

- [ ] **Verify Secret Key is Set**
  ```bash
  firebase functions:config:get
  # Should show: recaptcha: { secret_key: YOUR_KEY }
  ```

- [ ] **Test reCAPTCHA Script Loads**
  - [ ] Run dev server: `npm start` (in `react-app/`)
  - [ ] Open browser console
  - [ ] Should see: `[reCAPTCHA] reCAPTCHA initialized successfully`
  - [ ] No errors about missing site key

- [ ] **Test Single Protected Function**
  - [ ] Deploy functions: `firebase deploy --only functions`
  - [ ] Call one protected function from frontend
  - [ ] Check logs: `firebase functions:log`
  - [ ] Should see: `[reCAPTCHA] reCAPTCHA passed with score 0.XX`

- [ ] **Test Rate Limiting**
  - [ ] Call same function 30+ times rapidly
  - [ ] 31st call should return: `Rate limit exceeded...`
  - [ ] Check Firestore `system/rate_limits` collection
  - [ ] Should see user document with `calls` array

- [ ] **Test Error Handling**
  - [ ] Turn off internet → Token generation fails → Error shown
  - [ ] Invalid token → Verification fails → Error shown
  - [ ] Hit rate limit → Clear message displayed

- [ ] **Manual Smoke Test**
  - [ ] Create a daily plan → Works
  - [ ] Sync calendar → Works
  - [ ] Create/edit task → Works
  - [ ] All show no errors in console

---

## Phase 5: Deployment

- [ ] **Set Production Secret**
  ```bash
  firebase functions:config:set recaptcha.secret_key="[PROD_SECRET]"
  ```

- [ ] **Build Frontend**
  ```bash
  cd react-app
  npm run build
  # Check that no errors, build succeeds
  ```

- [ ] **Deploy Functions**
  ```bash
  firebase deploy --only functions
  # Watch logs for errors
  # Check: All functions deployed successfully
  ```

- [ ] **Deploy Hosting**
  ```bash
  firebase deploy --only hosting
  # Check: Hosting deployed successfully
  ```

- [ ] **Smoke Test in Production**
  - [ ] Go to your app URL
  - [ ] Sign in
  - [ ] Test key functions
  - [ ] Check no console errors
  - [ ] Verify reCAPTCHA tokens are being generated

---

## Phase 6: Monitoring & Adjustments

- [ ] **Set Up Basic Monitoring**
  - [ ] Firebase Console → Functions → Logs
  - [ ] Filter for `[reCAPTCHA]` and `[Security]`
  - [ ] Watch for errors over 24 hours

- [ ] **Adjust Thresholds if Needed**
  - [ ] If too many legitimate users blocked:
    - [ ] Lower `minRecaptchaScore` from 0.5 to 0.3
    - [ ] Redeploy functions
  - [ ] If too many spam attacks:
    - [ ] Increase `minRecaptchaScore` from 0.5 to 0.7
    - [ ] Reduce `RATE_LIMIT_MAX_CALLS` from 30 to 15
    - [ ] Redeploy functions

- [ ] **Set Up Analytics Query** (Optional)
  ```bash
  # Check rate limit hits over past hour
  firestore_collection='system/rate_limits'
  gcloud firestore query-stats $firestore_collection --json
  ```

---

## Phase 7: Documentation & Handoff

- [ ] **Document Your Configuration**
  - [ ] Site Key: `6LeiKIUsAAAAAE0S6kEhk0eDElIqHMuqLwGvJQED`
  - [ ] Secret Key: Stored securely (not in docs)
  - [ ] Min Score: 0.5 (or your chosen value)
  - [ ] Rate Limit: 30 calls/minute per user

- [ ] **Update Team Documentation**
  - [ ] Create team guide for adding protection to new functions
  - [ ] Document error codes and how to handle them
  - [ ] Add to onboarding checklist

- [ ] **Enable Monitoring Alerts** (Optional)
  - [ ] Set up Cloud Monitoring for spike in errors
  - [ ] Alert if verification failure rate > 5%
  - [ ] Alert if rate limit hits spike

---

## Quick Links

- 📖 **Full Setup Guide**: [docs/RECAPTCHA_SECURITY_SETUP.md](../RECAPTCHA_SECURITY_SETUP.md)
- ⚡ **Quick Start**: [docs/RECAPTCHA_QUICK_START.md](../RECAPTCHA_QUICK_START.md)
- 📝 **Example Code**: [functions/security/EXAMPLE_buildPlan_protected.js](../functions/security/EXAMPLE_buildPlan_protected.js)
- 🔧 **Security Handler**: [functions/security/recaptchaSecurityHandler.js](../functions/security/recaptchaSecurityHandler.js)
- 🎨 **Frontend Helper**: [react-app/src/utils/recaptchaHelper.ts](../react-app/src/utils/recaptchaHelper.ts)

---

## Estimated Timeline

| Phase | Effort | Time |
|-------|--------|------|
| Setup + Config | 15 min | ⏱️ 15 min |
| Backend (5 functions) | 30 min | ⏱️ 45 min |
| Frontend (5 calls) | 30 min | ⏱️ 1h 15m |
| Testing | 30 min | ⏱️ 1h 45m |
| Deployment | 15 min | ⏱️ 2h |
| **TOTAL** | **~2h** | |

---

## Status Tracker

```
✅ Configuration complete
⏳ Backend integration in progress
⏳ Frontend integration
⏳ Testing
⏳ Deployment
⏳ Monitoring

Current step: [Choose one]
Last updated: [Date]
Deployed to: [Staging/Production]
Issues: [Any blockers?]
```

---

Questions? Check the troubleshooting section in [RECAPTCHA_SECURITY_SETUP.md](../RECAPTCHA_SECURITY_SETUP.md#troubleshooting)
