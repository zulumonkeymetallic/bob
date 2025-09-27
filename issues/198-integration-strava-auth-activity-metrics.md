# 198 – Integration: Strava (Auth + Activity Import + Metrics)

## Summary
Connect to Strava to pull recent activities, VO₂ max proxies, and training load, feeding the scheduler and dashboards.

## Acceptance Criteria
- OAuth works; imports last 90 days; nightly backfill.
- New activities appear within 5 minutes; duplicates avoided via `external_id`.
- Expose metrics to scheduling constraints.

## Proposed Technical Approach
- Use Strava API with webhook subscriptions; store `athlete_id`, `refresh_token`.
- Map activities to `workouts` collection; compute rolling metrics (CTL/ATL-like).

## Data Model / Schema
- `workouts` collection; `users/{uid}/connections/strava` tokens.

## Testing & QA
- Webhook replay tests; unit tests for activity mappers.

