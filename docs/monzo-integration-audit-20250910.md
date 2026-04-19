# Monzo Integration Audit – 2025-09-10

## Scope & Approach
- Reviewed server functions that drive Monzo OAuth, token storage, sync, analytics, and categorisation (`functions/index.js`).
- Toured client experiences in the finance dashboard and settings surfaces (`react-app/src/components/FinanceDashboard.tsx`, `react-app/src/components/IntegrationSettings.tsx`, `react-app/src/components/SettingsPage-New.tsx`).
- Cross-checked Firestore rules for data access (`firestore.rules`).
- Compared behaviour against the comprehensive requirements specification sections 2–5.

## Key Findings

### 1. Security & Data Handling
- Refresh and access tokens are persisted in Firestore `tokens` documents with plain `refresh_token` / `access_token` fields (`functions/index.js:751`, `functions/index.js:1017`). Rules implicitly deny client access, but there is no encryption at rest or use of Secret Manager. If Firestore is compromised, tokens are exposed.
- The OAuth `state` includes a nonce but the callback never validates or persists it; `stateDecode` simply returns `{ uid }` and ignores nonce replay protection (`functions/index.js:724`). This weakens CSRF/forgery guarantees.
- Duplicated OAuth handlers exist (legacy + hosting-aware versions at `functions/index.js:721` and `functions/index.js:979`). The older pair does not request scopes beyond `authorization_code` and lacks webhook job creation. Having both routes accessible risks inconsistent behaviour and diverging bug fixes.
- Transaction sync stores the full `raw` payload for accounts, pots, and transactions (`functions/index.js:1406`, `functions/index.js:1331`). While useful for debugging, this carries merchant metadata and descriptions; consider redacting or encrypting PII.
- No automated token revocation on `revokeMonzoAccess`; tokens are deleted locally but not invalidated upstream (`functions/index.js:1167`).

### 2. Data Ingestion & Enrichment
- Accounts and pots are captured with key metadata and timestamps (`functions/index.js:1405`). Pot balances are preserved in minor units, enabling precise goal comparisons.
- Transactions expand merchants and normalise metadata keys (brackets/dots replaced) before storage (`functions/index.js:1312`).
- There is no ingestion of Monzo "pot transactions"—savings transfers into pots appear only as standard transactions, so pot balance deltas rely entirely on `/pots` snapshots.

### 3. Goal & Theme Alignment
- Alignment currently matches pots to goals via explicit `goal.potId` or loose name matching (`functions/index.js:1533`). There is no transaction-level linkage to goals/themes; spend/income remains aggregate.
- The alignment doc tracks funded percentages and shortfalls per goal (`functions/index.js:1556`) and aggregates totals per theme, but does not incorporate budget classifications (mandatory vs optional) or highlight misaligned spend vs target budgets.
- No surface closes the loop between a transaction and downstream goal impact. Finance dashboards list goal shortfalls but cannot trace which transactions should be reclassified or linked to accelerate specific goals (`react-app/src/components/FinanceDashboard.tsx:630`).

### 4. Categorisation Rules
- Default category mapping is a static dictionary + amount sign check (`functions/index.js:1226`).
- User overrides are stored per transaction (`functions/index.js:1701`) and editable via the dashboard (`react-app/src/components/FinanceDashboard.tsx:313`). There is no persistent rule engine (e.g., by merchant, MCC, keyword) so users must repeat overrides for each similar transaction.
- Conflict precedence is not defined; last write wins on a transaction document. No audit/log of who changed classification.

### 5. Dashboards & Reporting
- Finance dashboard surfaces core totals, trend deltas, budget vs actual, goal alignment, and manual queue (`react-app/src/components/FinanceDashboard.tsx:269`). Graphing is limited to textual cards and progress bars—there are no charts for spend by theme or monthly variance.
- There is no alerting or email summarising Monzo health; insights remain in-app.
- Integration settings expose sync status and webhook registration but do not show last sync summary or errors (`react-app/src/components/IntegrationSettings.tsx:234`).

## Recommendations & Follow-up

| Area | Recommendation | Severity | Notes |
| --- | --- | --- | --- |
| OAuth security | Collapse duplicate Monzo OAuth handlers into one path, persist nonce per request, and verify on callback before issuing tokens. | High | `functions/index.js:949` vs `functions/index.js:721`.
| Token storage | Move refresh tokens to Secret Manager or encrypt before writing to Firestore; ensure `revokeMonzoAccess` revokes upstream tokens. | High | `functions/index.js:1017`, `functions/index.js:1167`.
| Data minimisation | Remove or anonymise `raw` payloads once required fields are extracted to reduce PII surface. | Medium | `functions/index.js:1331`.
| Rule engine | Introduce user-defined classification rules (by merchant, amount ranges, description regex) with precedence ordering and audit history. | Medium | `functions/index.js:1701`, `react-app/src/components/FinanceDashboard.tsx:313`.
| Goal linkage | Extend analytics to attribute transactions to goals/themes (e.g., via rules, pot mapping, or explicit links) and surface misalignment alerts. | Medium | `functions/index.js:1485`, `functions/index.js:1556`.
| Dashboards | Add spend-by-theme visualisations and monthly variance charts; expose alerting (email/push) when budgets exceeded or goals underfunded. | Medium | `react-app/src/components/FinanceDashboard.tsx:402`.
| Monitoring | Provide sync status (last run, last error) in Integration Settings and log webhook failures with actionable detail. | Low | `react-app/src/components/IntegrationSettings.tsx:234`, `functions/index.js:1145`.

## Proposed Next Steps
1. Create engineering tickets for OAuth consolidation/encryption, rule engine, and dashboard upgrades (tagged with priority matching table above).
2. Draft a runbook covering manual token revocation, incident response, and data subject deletion for Monzo datasets.
3. Assemble a masked dataset (sandbox) to regression-test upcoming changes and measure analytics accuracy before deploy.
4. After remediation, schedule a follow-up audit to confirm compliance and close gaps.

---

## 2025-11-18 Remediation Summary

The Monzo integration has been hardened end-to-end:

- **Single OAuth surface + nonce persistence.** Clients now call `createMonzoOAuthSession` which writes `monzo_oauth_sessions/{sessionId}` with a nonce/TTL. `/api/monzo/start` and `/api/monzo/callback` validate the session before exchanging tokens, so replayed or spoofed callbacks are rejected.
- **Refresh tokens encrypted with Cloud KMS.** `MONZO_KMS_KEY` must be set to the full key resource (e.g., `projects/bob20250810/locations/europe-west2/keyRings/app-default/cryptoKeys/monzoTokens`). Fields are stored as `encryptedRefreshToken` and legacy plaintext values are migrated on read.
- **Secure revocation + logging.** `revokeMonzoAccess` now revokes upstream, deletes KMS-wrapped secrets, clears integration status, and records automation/webhook logs so disconnects are auditable.
- **Webhook + job queue.** `/api/monzo/webhook` validates the `X-Monzo-Signature` HMAC and drops a `monzo_sync_jobs` document. A Firestore trigger processes jobs (webhook, OAuth bootstrap, or manual) and writes telemetry to `integration_status/monzo_{uid}` + `automation_status/monzo_sync_{uid}`.
- **Monitoring & UX.** Integration Settings subscribes to `integration_status` to show last sync time, source, analytics refresh, webhook heartbeat, and recent errors. A scheduled `monzoIntegrationMonitor` raises activity/email alerts if analytics are stale for >24h.
- **Emulator guardrail.** `scripts/test-monzo-analytics.js` seeds fake transactions against the Firestore emulator and ensures `computeMonzoAnalytics` populates `budgetProgress` and theme alignment before deploying daily summary changes.

### Key Rotation & Token Hygiene

1. **Create a new KMS key version** (`gcloud kms keys versions create --location=europe-west2 --keyring=app-default --key=monzoTokens`).
2. **Update the runtime variable** `MONZO_KMS_KEY` to point to the new version and redeploy functions (`firebase deploy --only functions:monzo*`).
3. **Force token re-encryption** by calling `syncMonzo` for each active user (backstop will migrate automatically, but `scripts/test-monzo-analytics.js` doubles as a quick verification harness).
4. **Rotate Monzo client secrets** via `firebase functions:secrets:set MONZO_CLIENT_SECRET` followed by a redeploy. Users can reconnect through the new OAuth flow; revoking access now propagates upstream immediately.

Keep `scripts/test-monzo-analytics.js` as part of the release checklist: it validates analytics invariants inside the emulator before `firebase deploy --only functions:monzo*`.
