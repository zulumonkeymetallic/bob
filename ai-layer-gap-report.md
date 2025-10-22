AI Scheduling & Enrichment Layer — Discovery & Gap Report

Summary date: 2025-10-21

Scope: Map existing BOB repo capabilities to the Epic’s baseline requirements and traceability IDs. Identify gaps, risks, and immediate implementation items.

Repo context scanned
- Firebase Functions: functions/index.js (v2) + calendarSync.js
- React app: react-app/src (Goals, Stories, Tasks, Planner, Calendar Integration, Assistant Chat)
- Firestore rules/indexes: firestore.rules, firestore.indexes.json
- Tests/utilities: recurrence tests, Selenium/Playwright scaffolding, calendar integration test script

What exists vs missing (by ID)

- CAL-1 Calendar CRUD endpoints and UI
  • Exists: functions/index.js exports create/update/delete/list for Google events (createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, listUpcomingEvents). UI: CalendarIntegrationView.tsx (mocked data currently).
  • Gap: UI still uses mocked data; needs wiring to callable endpoints and auth handshake flow. 

- CAL-2 Event ↔ Goal/Story/Task linking
  • Exists: applyCalendarBlocks() writes calendar_blocks and scheduled_items linking to goalId/storyId/taskId with deep links. UI shows “Link to Goal” in CalendarIntegrationView.
  • Gap: Two-way linking from external calendar edits back to Firestore entities beyond block-level is partial; reconciliation exists for plan vs Google (reconcilePlanFromGoogleCalendar) but not for story/task linkage enrichment.

- CAL-3 Event deduplication and idempotency
  • Exists: applyCalendarBlocks uses deterministic attributes and updates; freeBusy is consulted in planner flows. Orphan handling in calendarSync.js (delete orphaned event).
  • Gap: Explicit dedupe keys across sources and conflict stamps are not consistently stored. Needs canonical dedupeKey per event and conflictVersion on calendar_blocks.

- CAL-4 Descriptions and extendedProperties enrichment
  • Exists: calendarSync.js sets extendedProperties.private fields; applyCalendarBlocks writes rationale/title/theme and deep links.
  • Gap: Description templates and safe redaction policy for audit logs not uniformly applied.

- CAL-5 Conflict detection/resolution
  • Exists: planCalendar validator + preview score; busy windows considered in planBlocksV2; dailyPlanningJob validates blocks.
  • Gap: Client-facing surfacing of conflicts with resolution actions (shift, shorten, move) not in CalendarIntegrationView.

- CAL-6 Two-way sync scheduler
  • Exists: reconcileAllCalendars (15m), syncGoogleCalendarsHourly (60m), scheduledCalendarSync (v1) in calendarSync.js.
  • Gap: A single “syncCalendarAndTasks” entry point (callable) to orchestrate both directions and write audit entries.

- CAL-7 OAuth linking and status surfaces
  • Exists: oauthStart/oauthCallback; calendarStatus callable; Settings/Diagnostics LLM test; UI toggles in CalendarIntegrationView.
  • Gap: CalendarIntegrationView needs wiring to status callable and OAuth start URLs.

- CAL-8 Audit logging for calendar operations
  • Exists: activity_stream used across scheduling, conversions, planner approvals.
  • Gap: Calendar CRUD and reconciliation paths should emit sanitized audit entries consistently.

- DUR-1 Threshold policies (min block, quiet hours)
  • Exists: planSchedule engine; policies referenced in planner flows.
  • Gap: UI/Settings to adjust thresholds and to display why items were unscheduled.

- DUR-2 Auto-rescheduling of missed items
  • Exists: nightlyTaskMaintenance adjusts priorities; planner unscheduled reasons captured.
  • Gap: Explicit “missed block” backfill to new slots for tasks/goals.

- DUR-3 Backfill and estimate derivation
  • Exists: LLM scoring/prioritization; task estimate fallbacks (S/M/L to minutes).
  • Gap: Batch LLM estimation flow to populate estimateMin for unestimated tasks and backfill into schedule.

- GOAL-1 Modal: story creation and linking
  • Exists: EditGoalModal/AddStoryModal, goal → story generation (generateStoriesFromResearch).
  • Gap: Inline story creation confirmation/feedback toast patterns.

- GOAL-2 Modal: routines integration
  • Exists: routines manager and scheduler support.
  • Gap: Quick-add routine from goal modal and display of routine schedule in activity panel.

- GOAL-3 Modal: activity stream embed
  • Exists: latest activity pulled in GoalsCardView; activity stream service.
  • Gap: Goal modal inline activity list with filter (notes/status/updates) and pagination.

- GOAL-4 Modal: toast and optimistic UX
  • Exists: Alerts in EditGoalModal; assorted toasts elsewhere.
  • Gap: Consistent toast for create/update/delete and scheduling actions in goal card/modal.

- CAP-1 Capacity strip view
  • Exists: SprintPlannerSimple (list/strip-like), SprintDashboard components.
  • Gap: Explicit “strip” lane capacity summary and over/under indicators.

- CAP-2 2-D matrix view
  • Exists: SprintPlannerMatrix with live Firestore data and row expansion.
  • Gap: DnD + rankByCell persistence and capacity totals per cell.

- CAP-3 Capacity metrics & thresholds
  • Exists: points totals per sprint (simple); importance score pipeline.
  • Gap: Team/persona capacity display with warnings; target velocity banding.

- CAP-4 Planner-E2E smoke tests
  • Exists: Playwright config scaffold; selenium integration tests (calendar).
  • Gap: Minimal Playwright specs for Goal Modal and Planner Matrix.

- LLM-1 Auto-enrichment (estimates, tags, links)
  • Exists: prioritizeBacklog, storyTasks generation, deriveFromResearch; assistant chat actions.
  • Gap: Dedicated callable to enrich missing estimates and suggest links at scale.

- LLM-2 Task→Story conversions
  • Exists: suggestTaskStoryConversions, convertTasksToStories (callable).
  • Gap: Wrapper to orchestrate suggest+convert with audit and safe logging.

- LLM-3 Prioritisation pipeline
  • Exists: deterministic scoring + optional LLM; nightly maintenance updates importanceScore/isImportant.
  • Gap: UI exposure of “why” explanations and history of priority changes.

- LLM-4 AI usage logging
  • Exists: aiUsageLogger used in LLM helpers.
  • Gap: Standardised redaction policy note in docs; dashboard already exists.

- GIT-1 Repo sync (gap/epic/issues/PRs)
  • Exists: issues/ directory with epics, scripts; README project hygiene.
  • Gap: New Epic + requirement issues; PR scripts for branches.

- GIT-2 Gap report
  • Exists: None for this epic.
  • Gap: Produce ai-layer-gap-report.md (this file) and docs/ai-scheduling.md.

- GIT-3 Issues per requirement
  • Exists: N/A for this epic.
  • Gap: Create issues for CAL/DUR/GOAL/CAP/LLM/GIT/AUD/SEC IDs.

- GIT-4 PR linkage automation
  • Exists: None specific.
  • Gap: Script to open branches and PRs by REQ-ID with labels.

- GIT-5 Daily build log comment
  • Exists: None specific.
  • Gap: Script to post/update a daily comment on the Epic.

- AUD-1 Audit model coverage
  • Exists: activity_stream collection and many writes.
  • Gap: Calendar CRUD and LLM enrichment wrappers need consistent activity entries.

- AUD-2 UI surfacing of audits
  • Exists: GoalsCardView activity chips; StoriesCardView; Gantt.
  • Gap: Calendar-specific audit viewer and planner audit summaries.

- AUD-3 Summaries
  • Exists: Daily summaries via email + AI narrative.
  • Gap: Calendar changes summary (week-in-review) with counts per theme/goal.

- SEC-1 OAuth & scopes
  • Exists: GCal OAuth with secrets; rules enforce owner scoping.
  • Gap: CalendarIntegrationView wiring + status; docs for scopes and revoke UX.

- SEC-2 Secrets management
  • Exists: defineSecret usage for Gemini, OAuth, providers.
  • Gap: Docs reinforce “no secrets in logs”; tests avoid printing.

- SEC-3 PII redaction
  • Exists: Emerging practice; activity logging avoids payloads sometimes.
  • Gap: Standardised redaction helper and usage in new wrappers.

Risks & assumptions
- Risk: Double scheduling if new cron duplicates existing dailyPlanningJob. Mitigation: add wrapper that delegates to existing job or is disabled by flag.
- Risk: Calendar UI currently mocked; requires careful OAuth flow testing and Firestore security review.
- Assumption: Gemini is the only LLM provider; OpenAI is disabled per code comments.
- Assumption: Firestore indexes can be deployed from firestore.indexes.json if updated.

Proposed design adjustments
- Provide thin wrapper callables named per spec that delegate to existing robust implementations (to minimise churn and align traceability IDs):
  • syncCalendarAndTasks → reconcilePlanFromGoogleCalendar + syncPlanToGoogleCalendar + sanitized audit
  • autoEnrichTasks → scan tasks missing estimates; call Gemini for estimateMin/links; write updates and audit
  • taskStoryConversion → suggestTaskStoryConversions + convertTasksToStories orchestration, with audit
  • plannerLLM → on-demand delegate to planCalendar; cron maps to existing dailyPlanningJob
- Add standard redaction helper to strip emails, tokens, notes from audit payloads.
- Wire CalendarIntegrationView to callable endpoints and calendarStatus; add OAuth start button to functions oauthStart URL.
- Capacity metrics: compute totals per sprint (points/minutes) and render warnings in Matrix.

Immediate implementation checklist
- [x] Add wrapper Firebase Functions: syncCalendarAndTasks, autoEnrichTasks, taskStoryConversion, plannerLLM
- [x] Add docs/ai-scheduling.md with flows, safety, and endpoints
- [x] Draft issues per REQ-ID and Epic stub in issues/
- [ ] Wire CalendarIntegrationView to status + callables (follow-up)
- [ ] Add Playwright smoke tests for Goal Modal open/save and Planner Matrix render
- [ ] Add index suggestions in firestore.indexes.json (follow-up PR)

ETA bands (initial)
- Wrappers + docs: 0.5–1 day
- Calendar UI wiring + audit surfacing: 1–2 days
- Capacity warnings + E2E smoke: 1–1.5 days

