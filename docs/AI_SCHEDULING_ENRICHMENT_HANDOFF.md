AI Scheduling & Enrichment Layer — Handover

Date: 2025-10-22
Owner: AI Agent

Executive Summary
- Two‑way calendar sync, planner conflict resolution with actions, capacity UI, LLM task enrichment, explainability hints, and audit surfacing are implemented and deployed.
- Daily priorities email and weekly summaries are enabled (scheduled), with in‑app toggles and UI panels.
- Status normalization is delivered (UI + migration script) with canonical numeric values across Tasks and Stories.

Scope & Objectives
- Calendar: CRUD, linking, dedupe, extendedProperties, OAuth status, audit coverage, conflict resolution UX.
- Planner: quiet hours, auto‑reschedule missed, conflict panel actions, AI backfill after task enrichment, audit panel.
- Goals: modal toasts, activity list embed; next up — story quick‑add, routines link.
- Capacity: strip + matrix, inline edit, thresholds/warnings, totals.
- LLM: auto‑enrich tasks (estimates/links), conversions, explainability (“Next up” rationale + optional popup).
- Audit: activity model coverage, UI surfacing, weekly summaries.
- Security: OAuth disconnect UX, secrets management, PII redaction practice.

What’s Merged (PRs)
- #446 CAL‑6 Two‑way sync orchestrator
- #447 LLM‑1 Auto‑enrich tasks callable
- #448 CAL‑5, DUR‑1 Planner auto‑sync + Quiet Hours
- #449 DUR‑2, CAP‑1..3, GOAL‑3/4, CAL‑3 Reschedule + Capacity + Goal activity + Dedupe
- #450 CAP + LLM‑3 explainability inline capacity + “reasons”
- #451 Deep‑link fix for task modal + activity tab
- #452 GOAL‑4, CAL‑5, CAP‑4 Toasts, conflict highlight, e2e smoke

New Changes in This Batch
- Status normalization in UI (numeric options) and migration script:
  - scripts/migrate-status-normalization.js; docs/migrations/status-normalization.md
  - UI: EntityDetailModal, ModernTaskTable*, save numeric statuses
- Planner conflict “Choose Action” panel + Undo: UnifiedPlannerPage
- Planner audit tile (instances, unscheduled reasons)
- Calendar Integration: Recent activity panel + Disconnect button
- Settings: Backfill after enrichment toggle; manual “Send me a digest now”
- Daily priorities email (06:30) + weekly summaries job; Overview “Weekly Summary” card
- Mobile Priorities: “Why?” tooltip for rationale

Deployment
- Hosting deployed: https://bob20250810.web.app
- Functions deployed (region europe‑west2):
  - disconnectGoogle, autoEnrichTasks (with backfill trigger), plannerLLM, generateWeeklySummaries, sendDailyDigestNow
- Secrets required: GOOGLEAISTUDIOAPIKEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, BREVO_API_KEY

Acceptance Snapshot (by area)
- Calendar: OAuth connect/disconnect; CRUD OK; two‑way sync; events carry links; activity visible in panel.
- Planner: drag moves sync to Google; conflicts highlight + actions; quiet hours enforced; audit counts visible.
- Goals: modal toasts; activity list; deep‑link to Activity works.
- Kanban: Lanes Backlog/In Progress/Done only; blocked in‑lane flag retained.
- Capacity: strip + matrix with totals; inline edit persists (threshold badges pending finer per‑cell warnings).
- LLM: Auto‑enrichment callable working; conversions orchestrated; explainability hints on Dashboard/ Mobile.
- Audit: calendar/planner panels; weekly summaries persisted.
- Security: disconnect UX; secrets redaction helpers respected.

Open Items / Next Issues
- GOAL‑1: Goal modal — inline story quick‑add + toast + activity entry.
- GOAL‑2: Goal modal — routines link (preview schedule) and action.
- CAP‑3: Add per‑cell workload highlighting + warning badges in matrix.
- LLM‑3: Optional “Explain” button (call lightweight Gemini summary) on hover/click.
- CAL‑3: Ensure dedupeKey is consulted during reconciliation paths (server clean‑up). Add tests.
- E2E: Expand Playwright to cover conflict panel actions, sidebar collapse, daily digest toggle.
- Observability: add cost counters to aiUsageLogger dashboard card.

Validation & Smoke
- Calendar Integration: connect/sync/disconnect + recent activity list.
- Planner: conflict actions move/shorten/shift + Undo; linked Google event updates.
- Goals: schedule → toasts/audit + calendar events.
- Deep‑link modal: /task/TK‑XXXXXX?tab=activity opens Activity.
- Capacity edits: persist and reflected in headers/matrix.
- Daily “Send now”: Settings button calls sendDailyDigestNow.

Operations & Toggles
- Backfill after enrichment: Settings → System Preferences.
- Daily digest: enable via Settings (writes profiles.dailyDigestEnabled and users.emailDigest).
- Disconnect Google: Calendar Integration → Disconnect.

Key Touch Points
- Planner: react-app/src/components/planner/UnifiedPlannerPage.tsx
- Calendar: react-app/src/components/calendar/CalendarIntegrationView.tsx
- Status: react-app/src/components/EntityDetailModal.tsx, ModernTaskTable*.tsx
- Capacity: react-app/src/components/SprintPlannerMatrix.tsx, SprintPlannerSimple.tsx
- Settings: react-app/src/components/SettingsPageNew.tsx
- Backend: functions/index.js (callables + schedules)

Risks & Mitigations
- LLM costs: aiUsageLogger wrapping present; add weekly roll‑ups for visibility.
- Functions deletions: keep the codebase and deployed set aligned; re‑deploy if stale functions reappear.
- Data normalization: run migration in off‑peak; dry‑run first; back up with Firestore export.

