# Work Tracking

Last updated: 2026-04-22

This document tells external agents where Bob work is tracked today and how to reconcile GitHub issues with Bob stories.

## Source Of Truth

Use this order when tracking implementation work:

1. GitHub issues
2. Source code
3. Bob stories only as intake or historical context

For the Bob improvement stream, GitHub is now the canonical tracker.

## Bob Improvement Goal

The Bob-side improvement goal currently lives in Firestore as:

- Goal title: `Enhance the Bob App for Personal Usage`
- Goal ref: `GR-47791`
- Goal document id: `C3QlXTgWNGQurpvas2tQ`

Rule for agents:

- If a new story is created under `GR-47791`, create or link a GitHub issue immediately.
- After migration, close the Bob story and record the GitHub issue number/URL on the story document.
- Do not continue parallel planning in Bob and GitHub for the same work item.

## Migration Snapshot

As of 2026-04-22, the two stories under `GR-47791` were migrated to GitHub and closed in Bob:

| Bob story | Bob title | GitHub issue | Bob status now |
| --- | --- | --- | --- |
| `ST-HA3Y72` | `Generate Substack: Bob + OpenClaw Integration` | `#507` | `4` (`done/closed for migration`) |
| `ST-WF8XFX` | `DevOps Pipeline & TestFlight Deployment` | `#508` | `4` (`done/closed for migration`) |

Both story documents now include:

- `githubIssueNumber`
- `githubIssueUrl`
- `trackingSystem = "github"`
- `migrationStatus = "migrated_to_github"`

## GitHub Backlog Snapshot

The GitHub backlog contains a mix of:

- real missing work
- work that is partially implemented
- work that appears implemented in code but never closed
- duplicate or superseded planning/admin issues

Do not assume an open issue means the feature is absent.

## Open Issues That Look Substantially Implemented In Code

These should be verified quickly in product/runtime behavior, then considered for closure if the behavior matches the issue:

- `#473` Full Two-Way Google Calendar Sync
  Evidence: `functions/index.js` exports `syncCalendarAndTasks`, `reconcilePlanFromGoogleCalendar`, `syncCalendarBlocksBidirectional`, and `syncPlanToGoogleCalendar`.
- `#472` AI Story Enrichment & Task Generation
  Evidence: `functions/index.js` exports `autoEnrichTasks`, `enhanceNewTask`, `taskStoryConversion`, `suggestTaskStoryConversions`, and `convertTasksToStories`.
- `#417` Two-way sync orchestrator callable
  Evidence: `functions/index.js` exports `syncCalendarAndTasks`.
- `#431` Auto-enrich tasks
  Evidence: `functions/index.js` exports `autoEnrichTasks`.
- `#432` Task→Story conversion orchestration
  Evidence: `functions/index.js` exports `taskStoryConversion`, `suggestTaskStoryConversions`, and `convertTasksToStories`.

## Open Issues That Still Have Clear Gaps

These are still visibly incomplete from the code inspection:

- `#412` Calendar CRUD endpoints and UI wiring
  Backend callables exist, but `react-app/src/components/calendar/CalendarIntegrationView.tsx` still boots with `loadDummyData()`.
- `#418` OAuth status and connect flow in UI
  Status/OAuth hooks exist, but the same calendar view still mixes real callables with dummy seeded entities/events.
- `#441` UI surfacing of audits
  Calendar audit entries are present, but the integration view is still a hybrid screen rather than a clean production-ready audit surface.
- `#430` Planner E2E smoke tests
  I found planner-related code and routes, but no focused Playwright/E2E coverage for the planner matrix or goal modal flows.
- `#445` PII redaction in audits
  A live `redact()` helper exists in `functions/index.js`, but redaction coverage still looks policy-driven and uneven rather than enforced end-to-end.

## Issues That Are Probably Partial Rather Than Missing

These have real code behind them, but the issue title still describes unfinished polish, UX completeness, or operational hardening:

- `#412` through `#419` calendar epic items
- `#420` through `#422` planner duration/quiet-hours items
- `#423` through `#429` goal modal and capacity planner items

Treat these as verification tasks, not blank-slate implementation asks.

## Code-Local TODO Anchor

One concrete code-local tracking anchor now exists:

- `react-app/src/components/calendar/CalendarIntegrationView.tsx`
  The file contains a GitHub-linked TODO pointing at the remaining live/dummy-data cleanup.

## Recommended Agent Workflow

When you receive a new Bob-improvement request:

1. Search GitHub issues first.
2. Check whether a Bob story under `GR-47791` already exists.
3. If the work exists only in Bob, create a GitHub issue and migrate the story.
4. If the work exists in both places, treat GitHub as canonical and close or annotate Bob accordingly.
5. Verify the code before closing old GitHub issues that may already be implemented.
