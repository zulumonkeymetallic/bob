# 199 – Integration: Budget Feeds (Monzo/Bank) — Read‑Only MVP

## Summary
Ingest transactions and basic categories to support a budget widget and scheduling awareness.

## Acceptance Criteria
- Connect to at least one provider; import last 90 days; daily refresh.
- Show spend by category and upcoming bills; optional alerts in digest.

## Proposed Technical Approach
- Provider abstraction (`Plaid/Truelayer/Monzo API`). Store only minimal PII; tokenize where possible.
- Map to `finance/transactions` and `finance/categories`.

## Data Model / Schema
- `finance/transactions`, `finance/categories`, `users/{uid}/connections/bank`.

## Testing & QA
- Import idempotency; redaction tests for logs.

