# 204 – Platform: Integration Feature Flags & Health Dashboard

## Summary
Centralise feature flags and integration status; surface failures and retry counts.

## Acceptance Criteria
- Admin panel shows auth status, last sync, error counts.
- Users can enable/disable modules individually.

## Proposed Technical Approach
- `feature_flags` per user; health widget with circuit breakers and backoff.

## Testing & QA
- Chaos testing by forcing provider failures.

