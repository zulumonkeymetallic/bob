# Roadmap Gaps Identified from Documentation

This note captures features referenced in documentation that do not currently have focused issues, or that need refreshed tracking.

Candidate New Issues
- Apple HealthKit Ingestion & Insights
  - Source: 📱 BOB iOS App – MVP Requirements.ini (HealthKit Integration), create_requirements_issues.sh
  - Scope: HRV, VO₂ Max, resting HR, steps; privacy controls; owner‑scoped collections.
  - Fit: Hybrid (iOS → Functions); optional n8n for nightly imports/exports.
- Strava Activity Sync
  - Source: DEPLOYMENT_SUCCESS_v3.0.8_UNIFIED_DND_20250831.md; create_requirements_issues.sh
  - Scope: OAuth, activity import, summaries to insights; optional calendar push.
- Runna Training Plan Import
  - Source: DEPLOYMENT_SUCCESS_v3.0.8_UNIFIED_DND_20250831.md
  - Scope: Pull plan, map to stories/tasks/blocks.
- CSV/Export Enhancements (Finance & Health)
  - Source: multiple docs call out CSV exports; extend #222/#223 to include export endpoints.

Already Tracked (for clarity)
- Monzo ingestion/budget engine/dashboards: #220, #221, #222, #223, #224, #225
- Reminders/Calendar Scheduler/Summary/Routines: #215, #226, #218, #227, #219
- Travel Map: #216
- Trakt/Goodreads/Steam: #106, #107, #108
- Traceability Graph: #49

Notes
- Consolidate any overlapping “daily digest/summary/telegram” docs under #218.
- Keep legacy “calendar child event maintenance” (#158) related to #226.

