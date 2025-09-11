BOB – Strava Integration (OAuth + Sync + Webhooks)

This app integrates with Strava via Firebase Cloud Functions. It supports OAuth connection, manual/daily sync of activities into Firestore, and webhook processing for near‑real‑time updates.

Secrets to set (Firebase Functions):
- STRAVA_CLIENT_ID: Your Strava app client ID
- STRAVA_CLIENT_SECRET: Your Strava app client secret
- STRAVA_WEBHOOK_VERIFY_TOKEN: A random string used for Strava webhook verification

Configure secrets:

  firebase functions:secrets:set STRAVA_CLIENT_ID
  firebase functions:secrets:set STRAVA_CLIENT_SECRET
  firebase functions:secrets:set STRAVA_WEBHOOK_VERIFY_TOKEN

Security:
- Never commit secrets (.env, .secrets.env) to the repo. They should be ignored and stored only in Firebase Functions Secrets or your CI vault.
- If a secret was exposed, rotate it in the Strava developer portal (client secret) and replace STRAVA_WEBHOOK_VERIFY_TOKEN with a new random value. Then update Firebase with the new values using the commands above or `./scripts/set-secrets.sh`.
- Frontend code must not receive client secrets; OAuth exchanges run only in Cloud Functions.

Callback URLs (add to your Strava app settings):
- OAuth Redirect URI: https://europe-west2-<PROJECT_ID>.cloudfunctions.net/stravaOAuthCallback
- Webhook Callback URL: https://europe-west2-<PROJECT_ID>.cloudfunctions.net/stravaWebhook

Scopes:
- Minimum: read, activity:read (use activity:read_all if you require full/private history)

User Flow:
1) Connect: From Admin page, click “Connect Strava” which opens:
   https://europe-west2-<PROJECT_ID>.cloudfunctions.net/stravaOAuthStart?uid=<UID>&nonce=<RANDOM>
   The callback stores tokens at tokens/{uid}_strava and marks profiles/{uid}.stravaConnected = true.

2) Sync: Click “Sync Strava” to invoke functions.httpsCallable('syncStrava'), which imports activities to Firestore collection metrics_workouts.

2b) Enrich HR Zones (optional): Click “Enrich HR Zones” to invoke functions.httpsCallable('enrichStravaHR'), which fetches HR streams for recent activities (if permitted) and computes time-in-zone (Z1–Z5) using your profile maxHR (or fallback 220-age / 190).

3) Webhooks (optional, recommended): Create a subscription in Strava developer portal pointing to /stravaWebhook and using STRAVA_WEBHOOK_VERIFY_TOKEN. The function verifies hub.challenge and upserts activity changes.

Data Storage:
- metrics_workouts/{uid}_{activityId}
  Fields include:
  - ownerUid, provider='strava', stravaActivityId
  - name, type, startDate (ms), utcStartDate (ISO)
  - distance_m, movingTime_s, elapsedTime_s, elevationGain_m
  - averageSpeed_mps, maxSpeed_mps
  - avgHeartrate, maxHeartrate, hasHeartrate, calories
  - hrZones: { z1Time_s, z2Time_s, z3Time_s, z4Time_s, z5Time_s }
  - isTrainer, isCommute, isManual, visibility, gearId

Indexes:
- A composite index on tokens (provider, athleteId) is included in firestore.indexes.json to map webhook events to users.

Scheduling:
- The existing dailySync function now attempts a Strava sync for users with profiles/{uid}.stravaConnected = true.
- If you want HR zone enrichment to run nightly, create a scheduler to call the callable on a subset (e.g., last 7–30 days).

Notes:
- If you switch to activity:read_all, re‑authorize users to refresh granted scopes.
- If Firestore prompts for an index on webhook queries, run: firebase deploy --only firestore:indexes
