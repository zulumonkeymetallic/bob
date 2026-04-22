# AI Scheduling & Enrichment Layer — Gap Report

Last updated: 2026-04-22

This file is no longer the best place to understand current tracking state.

Use:

- `docs/ai/work-tracking.md` for current GitHub-vs-Bob tracking policy and migrated Bob Improvement stories
- `docs/ai/firebase-functions.md` for current backend capability mapping
- `docs/ai/bob-frontend.md` for current frontend route and integration mapping

Current high-signal takeaway:

- Several AI scheduling issues that were open in GitHub in late 2025 now map to live code paths in `functions/index.js`.
- The biggest still-visible frontend gap is `react-app/src/components/calendar/CalendarIntegrationView.tsx`, which mixes real callable wiring with dummy seeded data.
- Planner/capacity surfaces exist in the React app, but E2E test coverage and production-hardening issues still appear open.
- Bob Improvement goal stories should now be migrated into GitHub and then closed in Bob.

If you need the current reconciliation snapshot, start with `docs/ai/work-tracking.md`.
