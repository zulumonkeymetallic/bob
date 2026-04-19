# 187 – Ingest Monzo transactions into Bob budgeting datastore

- Type: feature / data pipeline
- Priority: P0 (critical)
- Areas: Integrations, Firestore, Cloud Functions

## Problem
After authentication, Bob still lacks Monzo transaction data, preventing budgeting, pot allocation, and spend analytics.

## Acceptance Criteria
- Retrieve Monzo accounts and linked pots for the authenticated user and persist account metadata in Firestore.
- Sync transaction history (including merchant data, categories, notes, counterparty) into a dedicated collection with paging support.
- Support incremental sync using `since` cursors and webhooks or scheduled refreshes.
- Handle Monzo `pot` transfers so that pot balances are available for budgeting alignment.
- Provide basic reconciliation to avoid duplicate transactions on repeated syncs.

## Technical Notes
- Use the `/accounts`, `/pots`, `/transactions` endpoints with per-user access tokens.
- Store sync checkpoints per account (`last_transaction_id` or ISO timestamp).
- Implement a Firebase scheduled function (Cron) to refresh transactions nightly and a callable function to trigger manual refresh.
- Normalize amounts to minor units (pennies) and capture currency; include references to Monzo IDs for dedupe.
- Consider Monzo webhook registration for real-time updates after initial MVP.
