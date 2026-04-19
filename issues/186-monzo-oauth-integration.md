# 186 – Enable Monzo OAuth authentication for Bob users

- Type: feature / integration
- Priority: P0 (critical)
- Areas: Auth, Integrations, Firebase Functions

## Problem
Users cannot currently connect their Monzo accounts to Bob, blocking automated budgeting and transaction analysis.

## Acceptance Criteria
- Provide a "Connect Monzo" entry point that kicks off Monzo's OAuth2 flow.
- Handle the OAuth callback in a secure backend endpoint that exchanges the auth code for access/refresh tokens.
- Store client credentials (client_id, client_secret) in Firebase config/Secret Manager; nothing is committed to the repo.
- Persist per-user Monzo tokens securely, scoped so only privileged cloud functions can read them.
- Refresh access tokens automatically before expiry using the stored refresh token.

## Technical Notes
- Register Bob as a confidential client in the Monzo developer portal; add Firebase Hosting/callable Function redirect URIs.
- Implement the callback in a new Cloud Function (Node 20 runtime) using HTTPS trigger; wrap with CSRF/state checks.
- Use Firestore or Secret Manager to store tokens encrypted-at-rest; associate with the Bob user UID and the Monzo `user_id`.
- Add configuration scaffolding (`MONZO_CLIENT_ID`, `MONZO_CLIENT_SECRET`, `MONZO_REDIRECT_URI`) with environment-specific guidance.
- Enqueue a Firestore job/doc to trigger downstream data sync after successful auth.
