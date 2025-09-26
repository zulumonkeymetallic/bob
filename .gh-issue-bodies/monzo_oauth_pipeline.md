**Description**
Connect BOB to Monzo using OAuth, fetch Pots, Accounts, and Transactions, and normalise into Firestore for downstream budgeting.

**Acceptance Criteria**
- [ ] User can securely connect/disconnect Monzo via OAuth.
- [ ] Initial sync imports Accounts, Pots, and the last 12 months of Transactions.
- [ ] Incremental sync runs automatically and via a manual “Sync now” button.
- [ ] Webhooks (or polling fallback) capture new transactions within 5 minutes.
- [ ] Data model persisted to Firestore with referential integrity and timestamps.

**Proposed Technical Implementation**
- Monzo OAuth: Auth Code flow → Firebase Callable Function + HTTPS endpoint; store tokens in Firestore with encrypted refresh tokens.
- Endpoints: `/monzo/sync:init`, `/monzo/sync:incremental`, `/monzo/webhook`.
- Collections: `/finance/accounts`, `/finance/pots`, `/finance/transactions`.
- Use Cloud Scheduler to backstop sync every 15 mins; verify webhook signatures.
- Log all sync jobs in `/logs/finance_sync`.
