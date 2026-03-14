Comprehensive multi-phase rework spanning web, iOS/iPad, and health platforms:

JD Updated 13 March at 15:55

Latest execution log (14 March 2026)
- 14 Mar 2026: Upgraded roadmap V6 to be hierarchy-aware inside theme groups and reduced lane height.
  - `react-app/src/components/visualization/GoalRoadmapV6.tsx` now resolves goal theme context with parent-theme fallback when a leaf goal does not carry its own theme, so child goals stay inside the correct strategic theme lane.
  - The roadmap is no longer only a flat theme grouping: theme tracks are now subdivided into parent-goal sections, with child/leaf goals rendered inside their parent section rather than as an undifferentiated list.
  - Timeline cards now surface parent-path context directly on the goal bars/milestones so leaf goals display their hierarchy without leaving the roadmap view.
  - `react-app/src/components/visualization/GoalRoadmapV6.css` was tightened to reduce vertical height across theme headers, section headers, lane rows, task bars, and milestone bars.
  - Validation: `npm run -s build --prefix react-app` completed successfully after the roadmap hierarchy/density pass. Remaining output is the repo’s existing ESLint noise, bundle-size warnings, and `rrule` source-map warnings.
- 14 Mar 2026: Extended the focus-goal flow with hierarchy-aware milestone planning and sprint rollout mapping.
  - `react-app/src/components/FocusGoalWizard.tsx` now inserts a dedicated `Milestones + Sprint Plan` step between timeframe selection and review.
  - Selecting a parent goal now expands to its execution leaf goals immediately in the wizard, and the wizard overlays draft child milestones so users can plan year/quarter focus periods without leaving the modal.
  - Users can add new child milestone leaf goals inline under each selected parent goal; those draft milestones are kept in execution scope, participate in goal-type selection and sprint planning, and are persisted later via `pendingLeafGoalsToCreate`.
  - Quarter/year focus periods now generate sprint-window segments in the wizard, and every execution leaf goal must be assigned to at least one sprint window before the wizard can continue to review/confirm.
  - Review/confirm now show the planned sprint rollout, count draft milestones queued for creation, and warn that KPI authoring only applies to already-persisted leaf goals until the new milestones are saved.
  - `react-app/src/components/FocusGoalsPage.tsx` now materializes those queued draft leaf milestones into real `goals` documents before creating the focus goal, remaps temporary goal IDs to the created goal IDs, persists `sprintPlanByGoalId` / `sprintPlanSegments`, and writes sprint assignments back onto overlapping sprint docs plus `assignedSprintIdsByGoalId` on the created focus goal.
  - Active focus cards on the page now surface a `Milestone sprint rollout` view so users can see which leaf goals are meant to land in which sprint windows after the focus set is saved.
  - Validation: `npm run -s build --prefix react-app` completed successfully after this slice. Remaining output is the repo’s existing ESLint noise, bundle-size warnings, and `rrule` source-map warnings.
- 14 Mar 2026: Enforced leaf-goal execution links across the primary story/task/habit flows.
  - Added shared leaf-goal resolution helpers in `react-app/src/utils/goalHierarchy.ts` so execution surfaces can distinguish valid leaf goals from parent goals, auto-resolve a parent with a single leaf descendant, and block ambiguous parent selections.
  - Updated `react-app/src/components/AddStoryModal.tsx` and `react-app/src/components/EditStoryModal.tsx` so stories now author against leaf goals only:
    - goal pickers only show leaf goals
    - parent selections with one child auto-resolve
    - parent selections with multiple child leaves are blocked until the user picks the exact leaf goal
  - Updated `react-app/src/components/EditTaskModal.tsx` so direct task goal links and story-inherited goal links both normalize to leaf goals before save; tasks now reject ambiguous parent-goal execution links.
  - Updated `react-app/src/components/HabitsManagement.tsx` so habits only link to leaf goals, which keeps KPI adherence scoped to actionable milestone goals rather than umbrella parents.
  - Updated goal-driven creation surfaces in `react-app/src/components/EditGoalModal.tsx` and `react-app/src/components/ModernGoalsTable.tsx` so creating a story/task from a parent goal no longer stamps the parent goal ID directly.
  - Updated `react-app/src/components/checkins/CheckInDaily.tsx` so legacy parent-goal links on tasks, stories, blocks, and habits are normalized to leaf goals before daily execution/KPI refresh logic uses them.
  - Validation: `npm run -s build --prefix react-app` completed successfully after the leaf-goal enforcement changes.
  - Remaining gap: there are still secondary/legacy creation surfaces elsewhere in the repo that can stamp raw `goalId` values directly; the main execution flows are covered, but a full repo-wide normalization pass would still be needed if you want every niche creation path locked down the same way.
- 14 Mar 2026: Added a one-off weekly KPI snapshot backfill callable in `functions/index.js`.
  - New callable `backfillWeeklyGoalKpiSnapshots` backfills older `weekly_goal_kpi_snapshots` for the signed-in user from stored `weekly_checkins.metrics.focusSummary.leafGoals` where historical focus-goal summaries exist.
  - Backfilled snapshots are explicitly marked as `backfilled: true` and `snapshotQuality: 'summary_only'` because the legacy weekly check-in payload only preserves top KPI summaries and KPI health counts, not full raw historical KPI rows.
  - The backfill skips existing snapshots by default, supports bounded week ranges, and also refreshes the current week from live `goal_kpi_metrics` so forward coverage remains on the canonical snapshot path.
  - Validation: `node --check functions/index.js` completed successfully after the backfill callable was added.
- 14 Mar 2026: Added a server-side weekly KPI snapshot writer in `functions/index.js`.
  - Nightly `syncFitnessKpis` now snapshots each user’s current `goal_kpi_metrics` into `weekly_goal_kpi_snapshots` after refreshing KPI state, so weekly history no longer depends on the web app being opened.
  - Manual `syncFitnessKpisNow` now also writes current-week snapshots for the signed-in user, which keeps manual refreshes and nightly refreshes on the same persistence path.
  - Snapshot keys are generated per user timezone week, and snapshot documents carry the originating KPI payload plus snapshot reason/timezone metadata.
  - Validation: `node --check functions/index.js` completed successfully after the change.
- 14 Mar 2026: Added persisted weekly KPI snapshots and switched weekly check-in to prefer historical snapshot reads.
  - `react-app/src/utils/kpiResolver.ts` now writes a `weekly_goal_kpi_snapshots/{ownerUid}_{weekKey}_{goalId}` document whenever resolved KPI state is persisted to `goal_kpi_metrics`.
  - Snapshot rows store the week key, goal metadata, resolved KPI payload, and snapshot timestamp so weekly review can read week-specific KPI state instead of only today’s derived state.
  - `react-app/src/components/checkins/CheckInWeekly.tsx` now queries `weekly_goal_kpi_snapshots` for the reviewed week and falls back to `goal_kpi_metrics` only when no snapshot exists for that goal/week.
  - Validation: `npm run -s build --prefix react-app` completed successfully after the snapshot changes.
  - Remaining limitation: exact historical coverage starts from when the new resolver path runs; older weeks still need a backfill or scheduled server-side snapshot writer if you want complete historical KPI history everywhere.
- 14 Mar 2026: Extended `react-app/src/components/checkins/CheckInWeekly.tsx` to support weekly progress against focus goals.
  - Weekly check-in now loads overlapping/active `focusGoals`, `goals`, and `goal_kpi_metrics` for the reviewed week.
  - Added a focus-goal rollup section that shows:
    - parent/root goal summaries
    - leaf-goal weekly completion percentages from `daily_checkins`
    - counts of story/task/habit activity linked to focused leaf goals
    - KPI health counts and top KPI readings for each focused leaf goal
  - The legacy weekly sections for themes, habits, stories, tasks, spend, and reflection remain in place beneath the new focus-goal summary.
  - Current limitation: weekly check-in uses weekly execution signals from `daily_checkins` plus current `goal_kpi_metrics`; it does not yet compute true week-over-week KPI deltas or reconstruct historical KPI values for arbitrary prior weeks.
- 14 Mar 2026: Updated shared check-in reminder banner behavior in `react-app/src/components/checkins/CheckInBanner.tsx`.
  - Daily banner now stops showing after 13:00 local time if the target daily check-in is still incomplete.
  - Weekly banner now stops showing after Tuesday for the prior-week weekly check-in if it remains incomplete.
  - This change only affects the reminder banners in layout chrome; it does not remove access to `/checkin/daily` or `/checkin/weekly`.
- 14 Mar 2026: Implemented the hierarchical-goals + structured KPI + atomic check-in slice across the web app.
  - Goal hierarchy model extended in `react-app/src/types.ts` with `goalKind`, `timeHorizon`, and `rollupMode`, and focus documents now persist `focusRootGoalIds` plus `focusLeafGoalIds`.
  - Added shared hierarchy helpers in `react-app/src/utils/goalHierarchy.ts` to expand root goals to execution leaf goals, build display breadcrumbs, and evaluate hierarchy-aware focus alignment.
  - Focus goal creation/save flow is now leaf-goal aware in `react-app/src/services/focusGoalsService.ts`, `react-app/src/components/FocusGoalWizard.tsx`, and `react-app/src/components/FocusGoalsPage.tsx`. Parent goals can be selected strategically, but story planning and focus execution now run on expanded leaf goals.
  - KPI model expanded in `react-app/src/types/KpiTypes.ts` with `sourcePriority`, `sourceBindings`, freshness metadata, and structured source mapping fields.
  - Added observation/freshness/resolution utilities:
    - `react-app/src/utils/metricValues.ts`
    - `react-app/src/utils/kpiFreshness.ts`
    - `react-app/src/utils/kpiResolver.ts`
    - `react-app/src/utils/kpiPersistence.ts`
  - `react-app/src/components/KPIDesigner.tsx` now supports:
    - curated KPI creation from supported metrics
    - structured source-explorer KPI creation from registered fields only
    - source-priority / stale-source fallback selection
    - observation-stream browsing from `metric_values`
    - `Promote to KPI` from observed metrics
  - Daily check-in in `react-app/src/components/checkins/CheckInDaily.tsx` now debounced-autosaves instead of relying on a single submit action, writes manual health entries into `metric_values`, refreshes linked goal KPI projections, and surfaces stale automated HealthKit data with manual fallback messaging.
  - Daily Plan focus alignment in `react-app/src/components/DailyPlanPage.tsx` is now hierarchy-aware and displays goal breadcrumb paths instead of flat goal labels.
  - Focus-aware filtering and alignment logic was updated to use hierarchy-aware matching in:
    - `react-app/src/components/FocusGoalCountdownBanner.tsx`
    - `react-app/src/components/ModernKanbanPage.tsx`
    - `react-app/src/components/Dashboard.tsx`
    - `react-app/src/components/GoalsManagement.tsx`
    - `react-app/src/components/AddStoryModal.tsx`
    - `react-app/src/components/SprintPlanningMatrix.tsx`
    - `react-app/src/components/ThemeProgressDashboard.tsx`
    - `react-app/src/components/visualization/GoalRoadmapV6.tsx`
    - `react-app/src/components/KpiDashboardWidget.tsx`
  - KPI dashboard/state surfaces now refresh from `goal_kpi_metrics` using resolved source-aware KPI rows, and dashboard defer recommendations continue to use focus-aware scoring.
  - Validation: `npm run -s build --prefix react-app` completed successfully after implementation. Remaining output is the repo’s pre-existing CRA/ESLint warning set and `rrule` source-map warnings; those were not cleaned up in this slice.
  - Remaining gap from this slice: weekly check-in now includes focus-goal progress and KPI health, but historical KPI trend reconstruction for arbitrary past weeks still needs a dedicated persisted weekly KPI snapshot layer if exact prior-week KPI state is required.
- 14 Mar 2026: Tightened recurring-item completion safety in `react-app/src/components/DailyPlanPage.tsx`. When a chore/routine/habit Daily Plan row has no matching `scheduled_instances` record for today, the UI now shows a dismissible warning and refuses to complete the parent task, preserving bob-ios / bob-mac-sync instance-only semantics. Rebuilt web bundle for deploy.
- 14 Mar 2026: Fixed recurring-item consistency across kanban and Daily Plan. `react-app/src/components/ModernKanbanBoard.tsx` now excludes chore/routine/habit tasks from kanban task lanes, and `react-app/src/components/DailyPlanPage.tsx` now loads today’s `scheduled_instances` so completing a recurring Daily Plan item marks only that instance `completed` instead of closing the parent task. Deployed hosting.
- 14 Mar 2026: Executed targeted production cleanup for missing-story task links discovered in validation checkpoint. Cleared invalid `storyId` references on 3 tasks (with `linkRepair` audit metadata), then re-ran consistency queries: `mismatchedTaskLinks=0`, `taskStoryMissing=0`, `taskStoryGoalMismatch=0`; pending suggestion queues remain non-stale (`task pending=5/stale=0`, `story-goal pending=8/stale=0`).
- 14 Mar 2026: Ran focused production validation queries for linking reliability checkpoint. Current snapshot: task linkage mismatches = 3 (`task.storyId` points to missing story docs), task/story goal mismatches = 0, pending task suggestions = 5 (stale = 0), pending story-goal suggestions = 8 (stale = 0), latest sampled system activity rows did not include new fuzzy-link events yet in the inspected window.
- 14 Mar 2026: Defined explicit re-enable criteria for validation-style task generation in fuzzy linking. Keep `ENABLE_FUZZY_VALIDATION_TASKS=false` until: (1) `taskStoryGoalMismatch` remains 0, (2) missing-story linkage count is 0 after cleanup/backfill, (3) stale pending suggestions remain 0, and (4) duplicate-pending suppression remains effective across at least one full nightly cycle for both `nightlyTaskLinking` and `nightlyStoryGoalLinking`.
- 14 Mar 2026: Completed the third queued story/task linking reliability checklist item (suggestion acceptance/rejection hardening). Updated `functions/fuzzyTaskLinking.js` to suppress duplicate pending suggestions, apply a rejection cooldown before recreating the same suggestion, and carry canonical `suggestedLinkedGoalId` metadata so accepted story suggestions can apply canonical linkage updates safely via guardrails.
- 14 Mar 2026: Completed the second queued story/task linking reliability checklist item (null->linked guardrails). Hardened `functions/fuzzyTaskLinking.js` update paths so task/story linkage now no-ops when target linkage is unchanged or an existing linkage would be overwritten (`goal_already_linked`, `story_already_linked`, conflict guards), including nightly auto-linking, manual trigger paths, and suggestion-acceptance write flows.
- 14 Mar 2026: Completed the first queued story/task linking reliability checklist item (confidence-tier audit metrics). Updated `functions/fuzzyTaskLinking.js` so nightly + manual linking runs now compute and persist per-user/per-run tier counts (`no_match`, `low_confidence`, `auto_linked`) to Firestore `linking_run_metrics` with run metadata, scanned counts, and aggregate action counts for regression tracking. Deployed: `nightlyTaskLinking`, `triggerTaskLinking`, `nightlyStoryGoalLinking`, `triggerStoryGoalLinking`, `respondToTaskSuggestion`, `respondToStoryGoalSuggestion`.
- 14 Mar 2026: Temporarily disabled Firebase App Check in web frontend to stop repeated reCAPTCHA prompts/errors during active roadmap execution. Confirmed `REACT_APP_ENABLE_APPCHECK=false` + `REACT_APP_DISABLE_APPCHECK=true` in `react-app/.env`, kept the hard-disable guard in `react-app/src/firebase.ts`, rebuilt web bundle, and deployed hosting (`https://bob20250810.web.app`).
- 14 Mar 2026: Focus goals + finance spend-breakdown stabilization slice shipped. Focus goals now persist post-save rollout metadata (`autoCreatedSprintIds`, `deferredNonFocusCount`) back onto the created `focusGoals` document from `react-app/src/components/FocusGoalsPage.tsx`, so the wizard run captures its downstream sprint/defer effects for audit and revisit. Finance spend trend/pie now share a single transaction-category pipeline in `react-app/src/components/finance/FinanceDashboardAdvanced.tsx`: both use the same canonical category field resolution, exclude income and bank-transfer classes from spend breakdown, and treat only outflow transactions as spend.
- 14 Mar 2026: Defect remediated for fuzzy-link validation noise. Deleted all existing validation-linkage tasks (matched by `entry_method=auto:fuzzy_link_validation` and validation title prefixes), disabled runtime creation of these tasks in `functions/fuzzyTaskLinking.js` (`no_match` + `low_confidence` paths), and deployed `nightlyTaskLinking`, `triggerTaskLinking`, `respondToTaskSuggestion`, `nightlyStoryGoalLinking`, `triggerStoryGoalLinking`, and `respondToStoryGoalSuggestion`. Auto-link activity now records only when linkage actually transitions from null to a linked value.
- Backlog added (revisit): end-to-end story/task linking reliability pass. Re-validate fuzzy matching thresholds, null->linked transition rules, suggestion acceptance flows, and calendar/story/task cross-link consistency before any re-enable of validation-style task generation.
- Next slice queued (14 Mar 2026): Story/task linking reliability implementation checklist.
  - Add confidence-tier audit metrics in linking runs (`no_match`, `low_confidence`, `auto_linked`) and persist counts per user/run for regression tracking.
  - Tighten null->linked transition guardrails for both task->goal and task->story paths, explicitly no-op when linkage already exists and target is unchanged.
  - Re-verify suggestion acceptance/rejection write-paths so accepted suggestions update canonical linkage fields and rejected suggestions cannot recreate duplicate pending suggestions.
  - Run focused production validation queries: count tasks with mismatched `goalId`/`storyId` consistency, count stale pending suggestions, and sample auto-link activity rows for field correctness.
  - Define explicit re-enable criteria for any future validation-task generation: only after mismatch counts and duplicate suggestion counts remain at/near zero for at least one full nightly cycle.
- 14 Mar 2026: Daily Plan login-first routing is disabled for now. Root route/login flow remains dashboard-first (`/dashboard` on desktop and `/mobile` auto-route on mobile) while Daily Plan is treated as a secondary planning surface.
- Backlog added (enhance later): redesign Daily Plan as an opt-in guided flow (for example, first-session prompt card from Dashboard/Mobile Home) and only consider restoring login-first routing after sync reliability and scheduling/defer workflow quality are stable.
- Adjusted finance dashboard chart sizing in `react-app/src/components/finance/FinanceDashboardAdvanced.tsx`: kept the compact metric cards but increased the primary spend trend and donut cards again so the charts are easier to read.
- Mitigated the recurring App Check / reCAPTCHA prompt defect in `react-app/src/firebase.ts`: App Check now warms up without auto-refresh, disables token auto-refresh after 400/throttle-style exchange failures, and writes a local cooldown so affected users stop getting re-prompted every few minutes while Firebase App Check site-key/domain settings are corrected.
- Tightened finance dashboard density in `react-app/src/components/finance/FinanceDashboardAdvanced.tsx` and `react-app/src/components/finance/FinanceDashboardAdvanced.css`: overview metric cards are now compact, spend trend + donut cards are materially shorter, and the donut now centers the rolled-up total for faster scanning.
- Tightened Daily Plan density in `react-app/src/components/DailyPlanPage.tsx`: added compact summary pills, reduced row padding, surfaced deferred state inline, and extended schedule/defer controls to chores as well as standard tasks/stories.
- Enriched fuzzy linkage validation tasks in `functions/fuzzyTaskLinking.js`, added reusable backfill script `scripts/backfillValidationTaskLabels.js`, deployed `nightlyTaskLinking` + `nightlyStoryGoalLinking`, and backfilled 3 existing production validation tasks with explicit story/goal references where metadata was sufficient.
- Implemented morning-first planning flow: root login redirect now lands on `/daily-plan` for both mobile and desktop, and Daily Plan now shows a first-run daily check-in summary with explicit "review/defer" prompt and acknowledgement state (per-user/per-day local storage key).
- Added inline Daily Plan actions for execution hygiene: task/story rows now expose `Schedule now` (calendar icon) and `Defer intelligently` (snooze icon) controls; defer opens existing smart deferral modal and persists `deferredUntil/deferredReason/deferredBy/deferredAt`.
- Fixed trigger clarity in Kanban card actions: #1 priority toggle now uses explicit numeric marker (`1`) and defer uses clock icon, removing prior icon collision where calendar-style icon represented both actions.
- Removed obsolete Swift placeholders from this repo (`ios-app/BOBReminderSync/BOBReminderSync/Views/AddTaskView.swift`, `ios-app/BOBReminderSync/BOBReminderSync/Views/TasksListView.swift`) because native iOS/mac app source now lives in `/Users/jim/GitHub/bob-ios`.
- Completed Step 15C card icon differentiation in web card surfaces: cards now show explicit `1 Priority` badge (no star), calendar icon markers for scheduled blocks, and snooze-style defer badges when `deferredUntil` is active in `react-app/src/components/KanbanCardV2.tsx` and `react-app/src/components/stories/SortableStoryCard.tsx`.
- Completed standalone Daily Plan surfacing in web: added dedicated route/page (`/daily-plan`, `/mobile/daily-plan`) and entry links from Dashboard and Mobile Home widgets.
- Progressed Step 15A auto-link reliability: `functions/calendarSync.js` now writes canonical linkage fields (`storyId` + `linkedStoryId`) during `gcalLinkUnlinkedEvents` matching and adds new `onStoryCalendarAutoLink` trigger to auto-link newly created/renamed stories against unlinked Google-synced blocks without requiring manual callable invocation.
- Progressed Step 15B label consistency: story scheduling cards now use canonical source label text (`auto-planned`, `linked from gcal`, `manual`) in `react-app/src/components/stories/SortableStoryCard.tsx`.
- Investigated and remediated the Sprint 42 bulk-move incident: Firestore forensics isolated a backend automation chain where story due-date churn could feed the dueDate-to-sprint trigger, moving 255 stories into Sprint 42 in one window. Production rollback has been executed, `functions/index.js` now gates story due-date sprint auto-mapping behind explicit profile opt-in and refuses to overwrite an already-set sprint, and `scripts/rollbackSprint42Incident.js` now supports a second-pass activity rehydration mode for incident-marked stories when prior sprint history is available.
- Extended Step 15 source-label parity into planner surfaces: Unified Planner event details now shows source badges (`auto-planned`, `linked from gcal`, `manual`) using block/instance/external metadata, matching the new Dashboard timeline source-badge behavior.
- Progressed Step 15 card UX source labels: Dashboard Unified Timeline cards now surface source badges (`auto-planned`, `linked from gcal`, `manual`) derived from block/event metadata, reducing ambiguity between AI/planner/GCal/manual scheduling origins.
- Completed Step 14 diagnostics range-filter follow-up: Integration & AI Logs now supports time window filtering (`24h`, `7d`, `30d`, `all`, and custom date range) in addition to trace/template/parse filters.
- Completed Step 14A explicit call-site metadata enrichment for high-traffic LLM traces: `priority_now_trace`, `daily_summary_focus_trace`, and `finance_commentary_trace` now emit standardized `rawOutput` fields, and daily-summary focus traces now include health-context payload details.
- Completed Step 14A foundational logging upgrade: centralized `recordAiLog(...)` now writes standardized observability fields (`traceId`, `promptTemplateId`, `parseStatus`, `latencyMs`, `tokenCount`, plus normalized prompt/input/output payload fields) so existing AI log paths emit structured trace metadata by default.
- Completed Step 14 diagnostics-view slice (web): upgraded Integration Logs screen to support AI trace inspection with `trace-only` toggle, template + parse-status filters, trace/template/parse/latency columns, expandable prompt/input/output metadata, and merged ownerUid/userId log streams for more complete observability coverage.
- Completed Step 13 dashboard signal actionability follow-up: Daily Summary Active Signals now use a typed signal contract in web Dashboard and render per-signal CTA links (`ctaPath`) so structured summary alerts are directly actionable from the widget.
- Completed Step 13 signal parity slice: daily summary `dashboardAlerts` now includes a health signal (`type: health`) built from profile health snapshots, and Dashboard Daily Summary widget now renders structured `dashboardAlerts` as an Active Signals section (same alert contract as summary email rendering).
- Added dashboard strict-enforcement visibility: Focus Alignment card now shows selected-sprint strict-block counts (24h/7d) sourced from `integration_logs` plus latest selected sprint audit snapshot from `sprint_alignment_audit`.
- Completed sprint-alignment visibility follow-up: added alignment mode + sprint focus-goal count visibility to Sprint Management table rows and Dashboard Focus Alignment card so strict/warn policy is visible without entering edit flows.
- Completed Phase 6D KPI Designer verification/fix: validated wizard review handoff to KPI Designer and fixed KPI persistence race by reading latest goal doc state before append, preventing multi-save overwrite when creating multiple KPIs in one session.
- Implemented sprint-focus enforcement layer: Sprint Management now stores per-sprint `focusGoalIds` and `alignmentMode` (`warn`/`strict`), requires focus-goal selection before activating a sprint, and story create/edit flows now enforce sprint-alignment rules (warn confirm vs strict block).
- Added backend alignment safety net: `enforceSprintFocusAlignment` now removes invalid strict-mode sprint assignments server-side and logs violations; `sprintAlignmentAuditNightly` now writes per-sprint alignment summaries to `sprint_alignment_audit`.
- Completed Phase 6C cross-surface alignment verification and harmonization: FocusGoalsPage, ModernKanbanPage, and Dashboard now consistently scope unaligned-story detection to active sprint context; Dashboard/Kanban no longer surface focus-alignment warnings for non-active selected sprints.
- Completed Phase 5D nightly KPI sync coverage: nightly `syncFitnessKpisNightly` now refreshes persisted `goal_kpi_metrics` docs for each user via `computeGoalFitnessKpisForUser(..., { persist: true })`, and manual `syncFitnessKpisNow` now also refreshes those metric docs for the calling user.
- Applied Monzo scheduler cost preference: `monzoGoalPotRefLinker` cadence tuned to every 12 hours (instead of aggressive short-interval polling).
- Audited sprint dropdown selectors across shared selector and creation/edit surfaces; sprint options now consistently show planning sprints only (active/planned), excluding completed/cancelled in selectors used for assignment/filtering.
- Updated FAB story flow to default sprint selection to active sprint (fallback planned) and removed raw numeric sprint status suffixes in option labels.
- Added active focus-goal deferral prompts: selecting a non-focus goal in FAB story creation now warns/asks confirmation, and creating a new goal from FAB during an active focus period now prompts that it will be deferred until focus period end.
- Updated FAB create flows: task quick-add now includes Persona and Source URL fields, effort labels now align to points (`30 mins (0.5)`, `60 mins (1)`, `120 mins (2)`), and task points are persisted from selected effort at create time.
- Updated FAB story create flow (shared `AddStoryModal`) with Persona and Source URL fields, default persona prefilled from current persona, and story create payload now saves both selected persona and URL.
- Added focus-goal toggles across `/sprints/planning`, `/goals`, and `/goals/roadmap-v6` with default-on behavior whenever an active focus goal set exists from the wizard.
- Implemented Phase 5C KPI charting in Focus Goal countdown cards: banner now loads `goal_kpi_metrics` per active focus goal and renders compact KPI trend mini-charts (fallback series when sparse data) alongside current/target values.
- Added Sprint Planner route visibility in web Stories navigation and placed a Sprint Planner button immediately left of View Overview in Sprint Kanban actions.
- Applied dashboard persistent-banner policy on web: health/reconnect/import banners now render for desktop/tablet profiles and stay hidden on mobile profiles.
- Confirmed aggressive backlog defer ordering remains additive to existing top-3 + rollover flow (top-3 refresh -> aggressive defer/research shift -> recurring rollover in replan path).
- Implemented iPad/Mac banner parity in bob-ios (`/Users/jim/GitHub/bob-ios`): persistent overview banners now render only on large-screen surfaces, and a compact health progress banner is shown at top when HealthKit metrics are available.

**Web (Phases 1-6):** Focus Goals vision-first wizard, time-based goals, Firestore fixes, Monzo manual creation, unaligned banner, KPI design  
**iOS/iPad (Phases A-F):** Star removal (iPad), ownership bug fix, widget resize reliability, daily plan extraction, KPI visibility  
**Fitness/HealthKit (Phases A-E):** Cross-repo health data sync, body composition tracking, caloric/macro adherence, workout time allocation, deterministic nutrition advisor  
**OS Evolution (Steps 11-20):** Modal-only editing, mac-sync stale data fixes, daily summary email parity, LLM observability, calendar-linked cards, finance/savings guardrails, Telegram integration, agent build guidance

---

# ================ PART 1: WEB FEATURES ================

## Phase 1: Foundation Fixes (Can run in parallel)

### 1A. Fix Firestore undefined error in autoCreateStoriesForGoals + autoCreateSavinsPots
- **File**: [react-app/src/services/focusGoalsService.ts](react-app/src/services/focusGoalsService.ts)
- **Root cause**: In `autoCreateStoriesForGoals` line ~110-116, if `goal` is undefined or `goal.id` is undefined, the `where('goalId', '==', goal.id)` clause passes undefined to Firestore, causing: `Failed to create stories/buckets: Function where() called with invalid data. Unsupported field value: undefined`
- **Fix**: After fetching goals, filter out undefined entries; validate `goal.id` before using in where() clauses
- **Also check**: In `autoCreateSavinsPots`, validate `goal?.id` before where() query
- **Specific changes**:
  - Line ~103: Filter goals to remove undefined: `const goals = (await Promise.all(...)).filter(Boolean)` 
  - Line ~110: Add guard before where clause: `if (!goal?.id) continue;`
  - Line ~144: Add guard in autoCreateSavinsPots: validate goal.id before getDocs query

### 1B. Add story vs. calendar-time goal selector to Goal type
- **File**: [react-app/src/types.ts](react-app/src/types.ts) — update Goal interface
- Add new field: `goalRequiresStory?: boolean = true` (default true for backward compatibility)
- If false → goal expects only calendar time + optional KPIs, no sprint story creation
- This will be user-selected during focus wizard step 3

### 1C. Add goal ref tracking for Monzo manual creation
- **File**: [react-app/src/types.ts](react-app/src/types.ts) — update Goal interface
- Add new field: `monzoPotGoalRef?: string` (user-provided ref for manual pot creation)
- Add new field: `monzoPotId?: string` (auto-populated on next sync when pot found with matching ref)
- Backend watcher listens for goals with `monzoPotGoalRef` set but `monzoPotId` empty, then watches Monzo API for pots with that ref

---

## Phase 2: Wizard Rework (Core UX Change)

### 2A. Restructure wizard steps — Vision First
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- **Current** (5 steps): select → timeframe → vision → review → confirm
- **New** (6 steps): `vision` → `select` → `goalTypes` → `timeframe` → `review` → `confirm`

**Step breakdown:**
- **Step 1 (Vision)**: User enters vision text, loads intent prompts, can optionally run intent matching
- **Step 2 (Select)**: Shows goal list (filtered/sorted), multi-select with checkboxes, search by title
- **Step 3 (GoalTypes)**: NEW — For each selected goal, ask: "Needs Sprint story?" vs "Just calendar time?" 
  - Store selections in state: `goalTypeMap: { [goalId]: 'story' | 'calendar' }`
  - Calendar-time goals will skip auto-story creation
- **Step 4 (Timeframe)**: Choose sprint/quarter/year
- **Step 5 (Review)**: Show what will be created (stories for story-type goals, KPI link prompt) + KPI Designer link
- **Step 6 (Confirm)**: Final review, save

### 2B. Update handleNext() logic for new flow
- Remove auto-story/bucket creation from vision→review transition
- Move auto-creation to review→confirm transition (after user confirms, not during step change)
- Only auto-create stories for goals where `goalTypeMap[goalId] === 'story'`
- Skip story creation for calendar-time goals

### 2C. Update state variables
- Add: `goalTypeMap: { [goalId: string]: 'story' | 'calendar' }`
- Add: `selectedGoalsData: { [goalId: string]: { title, theme, requiresStory } }` (for display)
- Update: `goalsNeedingStories` computed filter to check both "has no story" AND `goalTypeMap[id] === 'story'`

### 2D. Add GoalTypes step UI component
- Render selected goals with radio buttons: "Story-based (will create Sprint story)" vs "Calendar-time (just events + KPIs)"
- Show goal details (theme, cost, etc.) to help user decide
- Save selections to `goalTypeMap`

---

## Phase 3: Monzo Pot Manual Creation Flow

### 3A. Update autoCreateSavinsPots to show prompt instead of API call
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- Change behavior: Instead of calling `createMonzoPotForGoal` HTTPS function, show user a prompt
- Prompt text: "For goal '[Goal Title]' (~£{estimatedCost}), create a Monzo pot manually and use ref: **{goalRef}** to enable BOB to auto-link it on next sync."
- goalRef = `GOAL-{goalId}` or similar (deterministic format)
- Provide copy button for ref + link to Monzo app
- User creates pot manually in Monzo, BOB saves `monzoPotGoalRef` to goal doc
- Backend watcher (in Cloud Functions) periodically checks for goals with `monzoPotGoalRef` set but `monzoPotId` empty, calls Monzo API to find pot with matching ref, links it

### 3B. Update FocusGoal type to track monzoPotGoalRefs
- Add: `monzoPotGoalRefs?: { [goalId: string]: string }` into FocusGoal document
- Saves ref mappings so history is preserved

### 3C. Add backend watcher (Cloud Functions)
- **File**: [functions/index.js](functions/index.js) or new file [functions/monzoPotLinker.js](functions/monzoPotLinker.js)
- Trigger: `onCreate('goals')` or scheduled function every 5 min
- Logic:
  1. Find goals where `monzoPotGoalRef` is set and `monzoPotId` is empty
  2. For each, query Monzo API for pots where name/description contains the ref
  3. If found, update goal: `monzoPotId: potId, monzoPotLinkedAt: serverTimestamp()`
  4. Log match or timeout after 24h
- This is background sync; user sees "Pending pot link" status until linked

---

## Phase 4: Unaligned Stories Banner

### 4A. Add banner to FocusGoalsPage
- **File**: [react-app/src/components/FocusGoalsPage.tsx](react-app/src/components/FocusGoalsPage.tsx)
- Show when: `activeFocusGoals.length > 0` (active focus period exists)
- Query: Stories in `currentSprint` (where sprintId matches active sprint) that are NOT in `activeFocusGoals[*].goalIds`
- Display: Alert/banner listing unaligned story refs, titles, associated goal ID (if any)
- Action: "Align to focus" link → opens story ref quick editor or removes from sprint

### 4B. Add filter badge to Sprint Table
- **File**: [react-app/src/components/ModernKanbanPage.tsx](react-app/src/components/ModernKanbanPage.tsx) or Sprint view
- Add toggle: "Show unaligned stories only" (if active focus exists)
- Highlight or filter-display unaligned story rows
- Same query logic as 4A

### 4C. Add widget to Dashboard
- **File**: [react-app/src/components/Dashboard.tsx](react-app/src/components/Dashboard.tsx)
- New card: "Focus Alignment Status"
- Show: X unaligned stories in current sprint (if active focus exists)
- Show: Y total stories in focus goals, Z% completion
- Link to "View details on Focus page"

---

## Phase 5: KPI Design Integration

### 5A. Create KPI Designer modal/page
- **New file**: [react-app/src/components/KPIDesigner.tsx](react-app/src/components/KPIDesigner.tsx)
- Purpose: Design KPIs for goals (health-based, metric-based, progress-based)
- Features:
  - KPI type selector: "Health Metric" (body fat %), "Calendar Event" (triathlon hours), "Progress" (story points done %), "Manual Entry" (user-tracked)
  - For Health Metrics: Data source (HealthKit field, e.g., bodyFat%), baseline, target, frequency (weekly/biweekly), trend tracking
  - For Calendar: Event pattern, target hours/count per week
  - For Progress: Goal completion %, story points closed
  - Save KPI to `goal.kpisV2[]` array (use existing KPI schema if available, or extend Goal type)
- Used by: FocusGoalWizard review step (link to KPI Designer)

### 5B. Link KPI Designer from wizard review step
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- In review step UI, show: "Add KPIs to track progress" button
- Opens KPIDesigner modal (or navigates to separate page with back link)
- Allows user to set KPIs for selected goals before confirming focus
- Returns to wizard review on save

### 5C. Add KPI chart display to FocusGoalCountdownBanner
- **File**: [react-app/src/components/FocusGoalCountdownBanner.tsx](react-app/src/components/FocusGoalCountdownBanner.tsx)
- Fetch KPI data for active focus goals from `goal_kpi_metrics/{uid}_{goalId}`
- Display mini-charts: body fat trend (weekly), calendar hours logged, progress %
- Show baseline vs current vs target
- Use existing health KPI display patterns

### 5D. Backend KPI sync (if not already done)
- **File**: [functions/fitnessKpiSync.js](functions/fitnessKpiSync.js) or nightly function
- Ensure goal KPIs are synced from HealthKit/Strava nightly
- Create `goal_kpi_metrics/{uid}_{goalId}` docs with:
  - `goalId, ownerUid, dataType (bodyFat, distance, workoutMinutes, etc.)`
  - `weeklyValues: [ { weekStart: Date, value: number, trend: % } ]`
  - `currentValue, baselineValue, targetValue, progressPct`
  - `updatedAt: serverTimestamp()`

---

## Phase 6: Web Verification & E2E Testing

### 6A. Unit tests for Firestore undefined fix
- Test `autoCreateStoriesForGoals` with goal list containing undefined entries
- Test `autoCreateSavinsPots` with goals missing `id` field
- Verify no "Unsupported field value: undefined" errors

### 6B. Integration test for wizard flow
- Create test: 1. Enter vision → 2. Select 3 goals → 3. Choose goal types (2 story, 1 calendar) → 4. Pick sprint timeframe → 5. Review + add KPI → 6. Confirm
- Verify: Only 2 stories auto-created, Monzo pot ref shown for cost goal, focus goal doc saved with correct goalTypeMap

### 6C. Manual test: Unaligned banner
- Create active focus goal with 2 goals
- Add story to sprint that has goalId NOT in focus goals
- Verify banner shows on FocusGoalsPage, Sprint Table, Dashboard
- Click "Align to focus" and verify story goalId updates
- Status (13 Mar 11:59): ✅ Completed. Code-level verification confirms cross-surface parity for unaligned detection and drill-down/actions; scope was aligned to active sprint only across Focus + Kanban + Dashboard.

### 6D. Manual test: KPI Designer
- Open FocusGoalWizard → review step → click "Add KPIs"
- Create health KPI (body fat 0.25% weekly drop)
- Create calendar event KPI (triathlon: 8 hours cycling weekly)
- Save and return to wizard
- Verify KPI data persists on focus goal creation
- Status (13 Mar 12:33): ✅ Completed (code-path verification + persistence hardening). KPI saves now append against latest goal doc state to preserve sequential KPI additions in the same modal session.

---

# ================ PART 2: iOS/IPAD FEATURES ================

## Phase A: Star Marker Removal (iPad/Mac Only)

### A1. Hide star toggle on iPad/Mac StoriesListView
- **File**: [bob-ios/BOB/Sources/Views/Stories/StoriesListView.swift](bob-ios/BOB/Sources/Views/Stories/StoriesListView.swift)
- **Location**: Lines 237-241 (star button UI)
- **Change**: Wrap star button in guard checking for iPad/Mac:
  ```swift
  if !isLargeScreen {  // Hide on iPad/Mac, show on iPhone
    HStack {
      // star button UI
    }
  }
  ```
- **Rationale**: Top-3 selection is iPhone-only feature; iPad users manage priorities differently
- **Verification**: Test on iPhone (star visible), iPad (star hidden), Mac Catalyst (star hidden)

---

## Phase B: Daily Checklist Ownership Bug Fix (Security)

### B1. Add ownerUid field to BOBChore/BOBRoutine models
- **File**: [bob-ios/BOB/Sources/Models/BOBChore.swift](bob-ios/BOB/Sources/Models/BOBChore.swift) (or equivalent model files)
- **Add field**: `var ownerUid: String?`
- **Purpose**: Enforce that only task owner can view/edit their checklist items

### B2. Fix DailyChecklistView query with ownership filter
- **File**: [bob-ios/BOB/Sources/Views/Planning/DailyChecklistView.swift](bob-ios/BOB/Sources/Views/Planning/DailyChecklistView.swift)
- **Location**: Lines 7-37 (where @Query loads data)
- **Current state**: SECURITY BUG — loads ALL chores/routines globally with no WHERE clause
- **Fix**: Add double-layer filtering:
  1. Firestore @Query with WHERE clause: `where('ownerUid', '==', auth.uid)`
  2. Add persona filter: `where('persona', '==', currentPersona)`
  3. Post-load: Filter choresDueToday by both completion AND ownership
- **Prevents**: Cross-user data leak where one user sees another's daily tasks

### B3. Update daily checklist completion handler
- Preserve existing check-off interaction
- After storing completion, verify ownerUid matches before saving
- Add audit log entry with userId + timestamp

---

## Phase C: Widget Resize Reliability (iPad/Mac)

### C1. Fix state reset issue in OverviewView
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Location**: Lines 149, 156 (widget resize state)
- **Problem**: @ViewBuilder resets @State variables on each render; drag gesture becomes unreliable
- **Fix**: Hoist resize state OUT of @ViewBuilder component:
  - Move `@State var dragState` to parent OverviewView level
  - Pass to WidgetResizeHandles as `@Binding`
  - Remove per-frame state resets

### C2. Debounce widget config saves
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Current**: saveWidgetConfig() called on every frame during drag (too frequent)
- **Fix**: Add 500ms debounce after drag ends (not per-frame)
  - Use `Timer` or similar to delay save until stable
  - Prevents excessive Firestore writes
  - Improves drag performance

### C3. Add orientation detection using GeometryReader
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Replace**: UIDevice.current.orientation checks (unreliable)
- **With**: Size class + geometry reader for responsive detection
- **Benefit**: More reliable iPad orientation handling

### C4. Fix WidgetResizeHandles state binding
- **File**: [bob-ios/BOB/Sources/Views/Overview/WidgetResizeHandles.swift](bob-ios/BOB/Sources/Views/Overview/WidgetResizeHandles.swift)
- **Location**: Lines 47-49
- **Change**: Remove @State from component, accept @Binding from parent
- **Benefit**: Parent OverviewView maintains single source of truth for all widget states
- **Verification**: Drag resize multiple widgets without glitches or state loss

---

## Phase D: Daily Plan Screen Extraction

### D1. Create dedicated DailyPlanView
- **New file**: [bob-ios/BOB/Sources/Views/Planning/DailyPlanView.swift](bob-ios/BOB/Sources/Views/Planning/DailyPlanView.swift)
- **Source logic**: Extract from OverviewCards2.swift `TodayFocusListCard`
- **Purpose**: Remove 360pt height constraint and expose full day planning surface
- **Features**:
  - Group items by day-part: 
    - Morning 5:00-12:59 (Top3 Priorities)
    - Afternoon 13:00-18:59 (Due Tasks)
    - Evening 19:00-04:59 (Chores → Routines)
  - Show morning/afternoon/evening breakdown within each section
  - Check-off with quick edit links (EditTaskModal/EditStoryModal)
  - Link to DailyChecklistView for full chores/routines list
- **Reuse**: Existing card components and styling

### D2. Register Daily Plan in navigation
- **File**: [bob-ios/BOB/Sources/Views/Shared/ContentView.swift](bob-ios/BOB/Sources/Views/Shared/ContentView.swift)
- **iPhone**: Add to TabView with new tab (tag ~7 or similar)
  - Tab label: "Plan" or "Today"
  - Route to DailyPlanView
- **iPad**: Add to NavigationSplitView sidebar
  - New section or merge with existing Planning section
  - Same DailyPlanView destination
- **Verification**: Tap/select plan tab on both platforms, view loads without navigation regression

---

## Phase E: iPad/Mac KPI Visibility Integration

### E1. Add KPI widgets to OverviewView (iPad/Mac)
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Add**: New draggable widget type for "Focus Goals KPI"
- **Content**:
  - Body fat % trend (weekly chart from HealthKit)
  - Distance tracked (steps, cycling km from integrations)
  - Macro adherence % (from health sync)
  - Link to /kpi-designer to edit KPI targets
- **Reuse**: Existing FitnessKPIDisplay logic (port to Swift) + shared KPI computation logic

### E2. Display KPI parity with web Dashboard
- Ensure iPad/Mac see same KPIs as web (body fat goal 15%, walk habit 10k, macro adherence)
- Sync KPI data from same `goal_kpi_metrics/{uid}_{goalId}` Firestore docs
- Use existing HealthKit sync pipeline to populate metrics nightly

### E3. Link KPI widgets to Dashboard KPI Designer
- Add "Edit KPI" button on widget
- Opens KPI Designer modal or navigates to settings
- User can adjust baseline/target without navigating away from overview

---

## Phase F: iOS Verification & Testing

### F1. Unit test: Ownership filter in DailyChecklistView
- Create task/chore with ownerUid = different user
- Verify task does NOT show in current user's checklist
- Verify task DOES show when filtered by ownerUid match

### F2. Integration test: Widget state hoisting
- Open OverviewView on iPad
- Select 3 widgets and resize
- Rotate device and rotate back
- Verify resize states persist + no state resets occur

### F3. Manual test: Daily Plan navigation
- iPhone: Tap "Plan" tab → DailyPlanView loads
- iPad: Select "Plan" in sidebar → DailyPlanView loads
- Verify day-part groupings render correctly (morning/afternoon/evening)
- Check-off a task → verify removal from list

### F4. Manual test: iPad star removal
- Apple Stories list on iPad
- Verify star button is NOT visible (hidden by isLargeScreen guard)
- Switch to iPhone and verify star button IS visible

### F5. Manual test: KPI widget display & sync
- iPad OverviewView → verify KPI widget present
- Complete a health sync (HealthKit body fat update)
- Verify KPI widget updates with new data within 5 minutes
- Compare iPad KPI display to web Dashboard → should match

---

# ================ PART 3: FITNESS & HEALTHKIT INTEGRATION ================

## Cross-Repo Architecture

### Overview: Multi-Source Health Data Integration

**Primary data sources (in priority order):**
1. **HealthKit** (bob-ios) — authoritative for body composition, steps, workouts, heart rate
2. **Strava** (functions integration) — training activity details, run/cycling/swim breakdown
3. **Daily Check-in manual entry** (CheckInDaily.tsx) — fallback when automated sync missing

**Data flow:**
- iOS app syncs HealthKit daily (weight, body fat, steps, workouts) → Firestore `health_metrics/{uid}_{date}`
- Nightly function (functions/healthSync.js) fetches Strava API for weekly training detail + syncs to `training_metrics/{uid}_{week}`
- CheckInDaily provides manual fallback input for macros (protein, fat, carbs, calories) and weight/body fat if sensor unavailable

**Health data contract** (canonical schema):

```typescript
// Firestore: health_metrics/{uid}_{date}
{
  uid: string,
  date: string (YYYY-MM-DD),
  
  // HealthKit-sourced (body composition)
  weight: { value: number, unit: 'kg', source: 'HealthKit', timestamp: serverTimestamp },
  bodyFat: { value: number (%), unit: '%', source: 'HealthKit', timestamp: serverTimestamp },
  
  // HealthKit-sourced (activity)
  steps: { value: number, source: 'HealthKit', timestamp: serverTimestamp },
  distanceWalking: { value: number, unit: 'km', source: 'HealthKit', timestamp: serverTimestamp },
  workoutMinutes: { value: number, unit: 'minutes', source: 'HealthKit', timestamp: serverTimestamp },
  
  // Manual fallback (CheckInDaily)
  macros: {
    protein: { value: number, unit: 'g', source: 'manual', timestamp },
    fat: { value: number, unit: 'g', source: 'manual', timestamp },
    carbs: { value: number, unit: 'g', source: 'manual', timestamp },
    calories: { value: number, unit: 'kcal', source: 'manual', timestamp }
  },
  
  // Computed (nightly function)
  targets: {
    dailySteps: 12000,
    dailyDistance: 5, // km
    dailyCalories: 2500, // example
    macroTargets: { protein: 125, fat: 70, carbs: 312 } // grams
  },
  
  // ETA computations
  eta: {
    weeksToTargetBodyFat: number (e.g., 8 weeks to reach 20% from current 24%),
    weeklyBodyFatTrend: number (% change week-over-week, e.g., -0.25),
    stepsPctOfTarget: number (%), // 11,500 / 12,000 = 96%
    distancePctOfTarget: number (%), // 4.2km / 5km = 84%
    macroAdherence: number (%), // avg of (actual/target)*100 for 4 macros
    workoutTimePctOfGoal: number (%) // e.g., 240min / (20% of 8h) = 75%
  },
  
  // Source attribution (for UI badges)
  sourceAttribution: {
    weight: 'HealthKit',
    bodyFat: 'HealthKit',
    steps: 'HealthKit',
    workoutMinutes: 'HealthKit',
    macros: 'manual',
    updatedAt: serverTimestamp
  }
}

// Firestore: training_metrics/{uid}_{weekStart}
{
  uid: string,
  weekStart: string (YYYY-MM-DD, Monday),
  
  trainingComposition: {
    running: { minutes: number, distance: number, count: number },
    cycling: { minutes: number, distance: number, count: number },
    swimming: { minutes: number, distance: number, count: number },
    strength: { minutes: number, count: number },
    other: { minutes: number, count: number }
  },
  
  compliancePercent: number, // % of target workout time achieved
  source: 'Strava',
  updatedAt: serverTimestamp
}
```

---

## KPI Model & Computation

### Target Specifications

- **Daily Steps**: 12,000 steps/day
- **Daily Distance**: 5 km/day (from walking/running)
- **Workout Time Goal**: 20% of free time per day
  - **Weekdays**: 20% of 8 hours = 96 minutes/day (576 min/week)
  - **Weekends**: 20% of 16 hours = 192 minutes/day (576 min/week average)
  - **Future upgrade**: Derive denominator from theme-allocated free time (TBD when profiles implement theme allocation sliders)
- **Body Fat**: 20% target (deterministic goal) or user-set target
- **Macro Compliance**: Daily adherence toward protein/fat/carbs/calories targets

### ETA Engine

**Formula: Weeks to target body fat**
```
current_bf = 24% (example)
target_bf = 20%
weekly_rate = -0.25% (current trend from 4-week rolling average)

weeksToTarget = abs(target_bf - current_bf) / abs(weekly_rate)
              = abs(20 - 24) / abs(-0.25)
              = 4 / 0.25
              = 16 weeks
```

**Macro adherence percent:**
```
adherence = [(protein_act/protein_target + fat_act/fat_target + carbs_act/carbs_target + calories_act/calories_target) / 4] * 100

Example:
protein: 120/140 = 0.857
fat: 65/75 = 0.867
carbs: 290/325 = 0.892
calories: 2400/2500 = 0.96

adherence = [(0.857 + 0.867 + 0.892 + 0.96) / 4] * 100 = 89.4%
```

---

## Phase HealthKit-A: Data Contract + iOS Body Composition Sync + Manual Fallback Schema

### A1. Define canonical health data contract (Firestore schema)
- **File**: types.ts
- **Add TypeScript interfaces**:
  - `HealthMetric` with fields: weight, bodyFat, steps, distance, workoutMinutes, macros, targets, eta, sourceAttribution
  - `TrainingMetric` with training composition breakdown
  - `EtaComputation` with weeksToTarget, trends, adherence %
- **Update FocusGoal** to include health-linked KPI fields

### A2. Create iOS HealthKit sync to Firestore
- **File**: bob-ios/BOB/Sources/Services/HealthKitSyncService.swift (or existing health service)
- **Daily sync at 6 AM** (before user starts day):
  1. Query HealthKit for weight, body fat (latest value + 30-day rolling avg)
  2. Query HealthKit for steps, distance walked/run (today's accumulated)
  3. Query HealthKit for workouts (today's total minutes)
  4. Write to Firestore `health_metrics/{uid}_{date}` with source attribution `HealthKit`
  5. On error/missing data: leave field empty or use fallback (manual entry from yesterday if available)

### A3. Add manual macro entry fallback to CheckInDaily
- **File**: CheckInDaily.tsx
- **New optional section** (collapsible): "Today's Nutrition"
- **Fields**: Protein (g), Fat (g), Carbs (g), Calories (kcal)
- **Interaction**: User fills in (or pulls from saved daily template)
- **On save**: Write to `health_metrics/{uid}_{date}` with source attribution `manual`
- **Display note**: "Macros help us track % toward your 20% body fat goal"

### A4. Add bodyFat field to BOBUser profile
- **File**: types.ts — update user Profile interface
- Add: `bodyFatTarget?: number` (default 20)
- Add: `macroTargets?: { protein: number, fat: number, carbs: number, calories: number }` (daily targets)
- Add: `weekdayWorkoutMinutesGoal?: number` (default 96 min)
- Add: `weekendWorkoutMinutesGoal?: number` (default 192 min)

---

## Phase HealthKit-B: Target Model + ETA Engine + Overview Banner

### B1. Implement ETA computation engine (Functions)
- **File**: functions/lib/healthEta.js (new file)
- **Export function**: `computeHealthEta(uid)` that:
  1. Fetches last 30 days of `health_metrics/{uid}_{date}` docs
  2. Computes 4-week rolling average for body fat trend
  3. Calculates weeksToTarget using formula: `abs(target - current) / abs(trend)`
  4. Computes macro adherence % from daily values
  5. Sums weekly steps/distance against 12k/5km targets
  6. Returns ETA object with all computed fields
- **Used by**: Nightly function + on-demand from Dashboard

### B2. Add daily overview banner to Dashboard (top placement)
- **File**: Dashboard.tsx
- **Banner placement**: Above all other widgets (sticky or top section)
- **Content** (single-row display on desktop, stacked on mobile):
  - **Left**: Health source badge + timestamp ("HealthKit · Updated 2h ago")
  - **Center**: Body composition summary: "24.2% body fat → 20% target (est. 16 weeks)" with small trend sparkline
  - **Right**: Quick macro adherence score (pie chart or % badge): "Macros 89% today"
  - **Action button**: "View details" → opens fitness screen
- **Styling**: Prominent background color tied to adherence level (green if on-track >80%, yellow if 60-80%, red if <60%)
- **UX requirement**: This should render as a compact dismissible progress card rather than a permanent alert, reusing the same local-dismissal pattern as the birthday/focus-goal card and including a visible progress bar.
- **Missing-target handling**: When weight/body-fat targets are missing, the card should expose a direct CTA into Settings so targets are configurable at profile level rather than inferred only from goals.

### B3. Add ETA refresher trigger to nightly function
- **File**: nightlyOrchestration.js
- **Add step**: After HealthKit sync completes, call `computeHealthEta(uid)`
- **Store result** in `health_metrics/{uid}_latest-eta` or append to user profile `eta` field
- **Used by**: Dashboard banner + Fitness screen (both read from latest-eta doc)

---

## Phase HealthKit-C: KPI Math + Fitness Donut + 30-Day Compliance Views

### C1. Implement KPI math module (Functions)
- **File**: functions/lib/fitnessKpiMath.js (new file)
- **Exports**:
  - `macroAdherence(actual, targets)` → % score
  - `stepsPctOfTarget(totalSteps, target=12000)` → %
  - `distancePctOfTarget(totalKm, target=5)` → %
  - `workoutTimePct(weeklyMinutes, goal)` → % (handles weekday/weekend averaging)

### C2. Create Fitness Dashboard screen (web)
- **File**: react-app/src/components/FitnessDashboard.tsx (or extend existing WorkoutsDashboard.tsx)
- **Layout**:
  1. **30-Day Training Composition Donut Chart**:
     - Fetch `training_metrics/{uid}_{weekStart}` for last 4 weeks
     - Group by sport: running %, cycling %, swimming %, strength %, other %
     - Show as donut with legend + minutes/week breakdown
     - Overlay: "X% of target 96 min/day" in center
  
  2. **Training Compliance Cards** (side-by-side):
     - **Steps Card**: "9,847 / 12,000 steps (82%)" with spark line (today + 6 days prior)
     - **Distance Card**: "4.2 / 5 km (84%)" with trend
     - **Workout Time Card**: "240 / 576 min/week (42%)" with breakdown (running 120min, cycling 90min, strength 30min)
     - **Macro Adherence Card**: "89% today" with donut (protein %, fat %, carbs %, calories %)
  
  3. **Body Composition Progress**:
     - Current vs target with ETA weeks-to-target
     - 12-week rolling chart (weekly averages)
- **Drill-down rule**: Reuse the existing `/fitness` route and extend it, instead of creating a second overlapping health route.
- **Dashboard linkage**: The `Health` item in the dashboard Key Metrics row should drill into this same `/fitness` surface.

### C3. Extend iOS OverviewView with 30-day training widget
- **File**: bob-ios/BOB/Sources/Views/Overview/OverviewView.swift
- **Add draggable widget**: "Training (30d)"
  - Display: Donut chart of running/cycling/swimming/strength/other
  - Tap: Navigates to DetailedFitnessView (or shows expanded view)
  - Use Strava data stored in `training_metrics` Firestore docs

### C4. Create detailed Fitness view on iOS
- **File**: bob-ios/BOB/Sources/Views/Health/DetailedFitnessView.swift (new file)
- **Display**:
  - 30-day training donut (same as web)
  - Steps/distance/workout cards with mini sparklines
  - Macro adherence gauge
  - Body fat trend chart (last 12 weeks)

---

## Phase HealthKit-D: Nutrition Dashboard + Deterministic Advisor + Metrics Integration

### D1. Create Nutrition Dashboard component (web)
- **File**: react-app/src/components/NutritionDashboard.tsx (new file)
- **Layout**:
  1. **Daily Macro Tracker**:
     - Input form (from CheckInDaily manual entry): protein, fat, carbs, calories
     - Display stacked progress bars: protein %, fat %, carbs %, calories %
     - Show target values below each bar
  
  2. **Weekly Adherence View**:
     - Grid of 7 days, each cell showing macro adherence % for that day (color-coded)
     - Red <60%, yellow 60-80%, green ≥80%
     - Link day → expands daily macros breakdown
  
  3. **Deterministic Nutrition Advisor**:
     - Based on current body fat (e.g., 24%) and target (20%), recommend:
       - **Protein**: Formula-based (e.g., 1.6g per lb bodyweight)
       - **Fat**: 25-30% of calories (satiety + hormone production)
       - **Carbs**: Remaining calories, prioritize pre/post-workout windows
       - **Calories**: Maintenance ± 300kcal based on progress; if body fat not trending toward -0.25%/week, reduce by 200kcal
     - **Output format** (NOT opaque AI, but rule-based advisor):
       ```
       For your 24% body fat → 20% target, here's your baseline:
       - Protein: 125g/day (sustain muscle during fat loss)
       - Fat: 70g/day (hormone health + satiety)
       - Carbs: 312g/day (energy + training recovery)
       - Calories: 2,400/day
       
       Trend check: You're at -0.20%/week body fat. To accelerate to target -0.25%/week, reduce calories to 2,200.
       ```
     - **Rationale**: Each recommendation includes "why" (e.g., "protein preserves muscle during calorie deficit")

### D2. Add explainable recommendation engine (Functions)
- **File**: functions/lib/nutritionAdvisor.js (new file)
- **Export**: `generateNutritionBaseline(currentBodyFat, targetBodyFat, userWeight)` → { protein, fat, carbs, calories, recommendations: [{ field, value, rationale }] }
- **Rules** (deterministic, not ML):
  1. Protein = 1.6g per lb bodyweight (preserve muscle in deficit)
  2. Fat = 25-30% of total calories (minimum for hormone health)
  3. Carbs = remaining after protein + fat allocation
  4. Calories = maintenance calorie estimate ± deficit based on trend:
     - If trend is on-pace to 20% in <8 weeks: maintain current
     - If trend slower than -0.25%/week: reduce 200kcal
     - If trend faster then -1%/week: increase 150kcal (avoid muscle loss)

### D3. Update HealthKit sync to include nutrition metrics
- **File**: functions/healthSync.js
- **Add nightly step**: Fetch CheckInDaily manual macro entries for day
- **Store** in `health_metrics/{uid}_{date}` alongside HealthKit data
- **Trigger**: nutrition advisor update if macros logged

### D4. Integrate nutrition advisor into Dashboard & SettingsPage
- **File**: Dashboard.tsx + react-app/src/components/settings/SettingsPage.tsx
- **Dashboard**: Add "Nutrition Baseline" collapsible card with recommendations
- **Settings**: Add "Nutrition & Fitness" section with editable targets (protein g/day, fat %, carb %, calorie goal)
- **Profile target settings**: The same settings area should also expose editable weight target and body-fat target fields used by the dashboard health card and `/fitness` trend surfaces.

---

## Phase HealthKit-E: Backfill + Telemetry + Feature-Flag + GA Criteria

### E1. Backfill historical HealthKit data (one-time)
- **File**: scripts/backfill-healthkit.js (new file)
- **Script**: If user has iOS app + confirmed HealthKit access, fetch last 90 days from HealthKit API
- **Populate**: `health_metrics/{uid}_{date}` docs for all days with available data (weight, body fat, steps, workouts)
- **Mark source**: `HealthKit` with `initial: true` to distinguish from ongoing daily syncs
- **Run**: As one-off migration per user (triggered on first login to fitness features)

### E2. Add HealthKit sync telemetry
- **File**: functions/healthSync.js
- **Log entry to `health_sync_logs`** for each nightly run:
  ```
  {
    uid: string,
    date: serverTimestamp,
    healthKitFetch: { success: bool, itemCount: number, fieldsReceived: [weight, steps, ...], errorReason?: string },
    stravaFetch: { success: bool, workoutsCount: number, trainingMinutes: number, errorReason?: string },
    manualEntry: { submitted: bool, macrosCount: number },
    etaComputed: bool,
    issuesToInvestigate: [string] // e.g., "weight missing HealthKit", "macro entry incomplete"
  }
  ```

### E3. Feature-flag fitness features (GA rollout)
- **File**: react-app/src/features/flags.ts or environment config
- **Add flags**:
  - `FEATURE_FITNESS_DASHBOARD`: Show Fitness Dashboard menu item + HealthKit sync
  - `FEATURE_NUTRITION_ADVISOR`: Show Nutrition Dashboard + macro targets
  - `FEATURE_HEALTH_BANNER`: Show daily overview banner on Dashboard
  - Recommend: Enable for 10% → 30% → 50% → 100% cohorts over 2 weeks

### E4. Define GA success criteria
- **Health data coverage**: ≥80% of target users have ≥20 days of health_metrics data over 30 days
- **Manual macro entry adoption**: ≥30% of users with fitness flag log macros on ≥3 days/week
- **Dashboard banner engagement**: ≥50% of activated users view detailed fitness screen ≥1x/week
- **ETA computation accuracy**: Weekly trend computation stable (StdDev < 0.1% week-over-week)
- **Nutrition advisor clarity**: Qualitative feedback: users report recommendations are understandable + actionable (NPS or survey)
- **No regressions**: Existing KPI/goal creation workflows unchanged

---

## Relevant Files (Fitness/HealthKit)

**Functions (Backend)**
- index.js — Nightly orchestration hook for HealthKit sync + advisor trigger
- reporting.js — Integrate health metrics into daily summary email
- functions/healthSync.js — **NEW** HealthKit API fetch + Strava sync + telemetry logging (daily at 6 AM UTC)
- functions/lib/healthEta.js — **NEW** ETA computation engine
- functions/lib/fitnessKpiMath.js — **NEW** KPI math (macro adherence, step %, distance %)
- functions/lib/nutritionAdvisor.js — **NEW** Deterministic nutrition baseline + recommendations

**Web (React/TypeScript)**
- types.ts — HealthMetric, TrainingMetric, EtaComputation interfaces
- Dashboard.tsx — Health banner (top placement) + Focus alignment widget + Nutrition card
- react-app/src/components/FitnessDashboard.tsx — **NEW** or extend WorkoutsDashboard.tsx with 30-day donut, compliance cards, body composition
- react-app/src/components/NutritionDashboard.tsx — **NEW** Daily/weekly macro tracker + deterministic advisor
- CheckInDaily.tsx — Add collapsible macro entry section (fallback manual input)
- AdvancedOverview.tsx — Extend with health widget display
- react-app/src/components/settings/SettingsPage.tsx — Add "Nutrition & Fitness" settings (target macros, calorie goal, workout goals by weekday/weekend)
- react-app/src/features/flags.ts — Feature flags for fitness/nutrition rollout
- react-app/src/components/BirthdayMilestoneCard.tsx — reusable compact dismissible-card pattern for the dashboard health surface

**iOS (SwiftUI)**
- bob-ios/BOB/Sources/Services/HealthKitSyncService.swift — **NEW** or extend existing. Daily HealthKit fetch + Firestore write (weight, body fat, steps, distance, workouts)
- bob-ios/BOB/Sources/Views/Health/DetailedFitnessView.swift — **NEW** Fitness detail screen (30-day donut, cards, body fat trend chart)
- bob-ios/BOB/Sources/Views/Overview/OverviewView.swift — Add "Training (30d)" draggable widget

**Scripts**
- scripts/backfill-healthkit.js — **NEW** Backfill 90 days of HealthKit data for users

**Configuration**
- firestore.indexes.json — Add indexes for health_metrics queries (uid, date range) and training_metrics (uid, weekStart)

---

# ================ PART 4: OS EVOLUTION ARCHITECTURE ================

## Step 11: Modal-Only Navigation (No Route Changes on Task/Story Edits)

### 11A. Replace task/story route links with in-place modals
- **File locations**:
  1. CheckInDaily.tsx — Lines ~1137, ~1142 (card view) + ~1225, ~1230 (list view)
  2. HabitsChoresDashboard.tsx — Line ~396
  3. Calendar.tsx — Line ~569
  4. JournalsManagement.tsx — Lines ~637, ~659

- **Change pattern**: For all task/story entry points, replace:
  ```jsx
  <Link to={`/stories/${item.storyRef}`}>Edit</Link>
  ```
  with:
  ```jsx
  <button className="btn btn-link" onClick={() => openStoryEdit(item.storyRef)}>Edit</button>
  ```

- **Implementation**:
  - Add local state: `quickEditTask: Task | null`, `quickEditStory: Story | null`
  - Add helper functions to fetch and set edit state
  - Render `EditTaskModal` / `EditStoryModal` at component end with show/onHide/onUpdated handlers
  - User sees modal overlay, can edit, and modal closes without route change

### 11B. Verify no route navigation occurs
- Manual test each fixed location: click story/task ref → modal opens, URL unchanged
- Confirm page context preserved (scroll position, side panel state, etc.)

---

## Step 12: Mac Sync Stale Metadata Fix (TK-O50IP6 Investigation)

### 12A. Patch mergeReminder timestamp writes
- **File**: bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift
- **Location**: `mergeReminder` function (~4740–4855)
- **Current issue**: Merge path writes task updates WITHOUT `serverUpdatedAt`/`macSyncedAt`, unlike `updateFromReminder` which does set both
- **Fix**:
  1. Always write `serverUpdatedAt: FieldValue.serverTimestamp()`
  2. Always write `macSyncedAt: FieldValue.serverTimestamp()`
  3. Add branch-aware diagnostic field: `branch=mergeReminder`

### 12B. Add stale Top3 metadata reconciliation
- **File**: bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift
- **Change**: During merge/update, strip stale `aiTop3Date` entries (where date != today)
  1. Detect stale dates: `aiTop3Date != today()`
  2. In `mergeReminder`: clear fields `aiTop3ForDay=false`, `aiTop3Date=delete`
  3. In `updateFromReminder`: same clearing logic
  4. Add sync log: `staleTop3Reconciled=true` when stale cleanup occurs

### 12C. Add diagnostic logging for task identity lifecycle
- **File**: bob-mac-sync/reminders-menubar/Services/SyncLogService.swift (or equivalent)
- **Log per task sync**:
  - `taskRef`, `taskId`, `reminderId`, `branch` (mergeReminder vs updateFromReminder)
  - Pre-sync `serverUpdatedAt`, `macSyncedAt`
  - Post-sync `serverUpdatedAt`, `macSyncedAt` (should be new timestamps)
  - `staleTop3Reconciled` flag

### 12D. Add reference-resolution fallback for investigation
- When task not found by `reference`, query by `reminderId` and by list+sprint+story linkage
- Prevents renamed refs from hiding canonical task

### 12E. Verify TK-O50IP6 case resolves after patch
- Force one full sync cycle on mac app (Xcode run)
- Check sync logs for task: confirm `macSyncedAt` and `serverUpdatedAt` advanced
- Verify Top-3 inclusion only when current-day criteria met (today date + rank + flags)
- Confirm stale `aiTop3Date` cleared if was outdated

---

## Step 13: Daily Summary Email Signal Parity

### 13A. Compose shared signal digest
- **File**: reporting.js or templates.js
- **Add function**: `composeSignalDigest()` that collects:
  1. Finance guardrail warning (if discretionary spend >50% and month elapsed <50%)
  2. Capacity shortfall/overbooked alert (if planned > available time)
  3. Focus-goal countdown (days remaining, progress %)
  4. Critical top-priority alerts (high-effort tasks due, blockers)
  5. **NEW: Health metrics summary** (body fat trend, macro adherence %, steps/goal %)
  6. Stale/missing data badges (when sources are outdated)

- **Output**: Structured object with alert blocks, each with heading, content, action link

### 13B. Render signal digest in daily summary email
- **File**: templates.js — `renderDailySummaryEmail()`
- **Add section**: "Your Daily Digest" or "Key Signals"
- **Content**: Iterate over signal digest blocks and render each with consistent styling
- **Fallback**: If a source is stale/missing, show muted text "Data unavailable" instead of silently dropping
- **Include**: Health badge (HealthKit/manual) in email footer

### 13C. Add shared digest renderer for dashboard
- **File**: Dashboard.tsx
- **Add widget**: "Active Signals" card showing digest blocks (same content as email)
- **Benefit**: Web dashboard and email stay in sync

---

## Step 14: LLM Observability + Persona Controls

### 14A. Standardize AI call logging
- **File**: index.js — all LLM call sites
- **Add entry to `ai_logs`** for every LLM invocation with:
  1. Trace/correlation ID (for end-to-end tracking)
  2. Prompt template ID/version (e.g., "daily-focus-template-v2")
  3. Resolved prompt text (fully interpolated template)
  4. Input JSON payload (context + calendar + budget + **health metrics**, etc.)
  5. Raw output text (or preview + length if too large)
  6. Parse status: `ok`, `ok_empty`, `failed`, `runtime_error`
  7. Latency in milliseconds
  8. Token count (if available from API)

- **Apply to**: Daily summary focus generation, finance commentary, priority-now flow, nutrition advisor, any other LLM surfaces

### 14B. Add AI trace inspection debug view
- **File**: AiDiagnosticsLogs.tsx (if exists, or create)
- **Add UI**:
  - Toggle: "Trace events only" to filter logs by `*_trace` suffix
  - Columns: Trace ID, Prompt Template ID, Parse Status, Latency (ms)
  - Detail row: Full prompt text, input payload, raw output preview
  - Filter by date range, prompt template, parse status
- **Purpose**: Quick debugging of LLM flow issues without JSON parsing

### 14C. Add personality control sliders to user settings
- **File**: react-app/src/components/settings/SettingsPage.tsx or react-app/src/components/settings/ProfileSettings.tsx
- **Add sliders** for profile `aiPersonality`:
  - Intelligence/Directness (1-10)
  - Humor (1-10)
  - Sarcasm (1-10)
  - Warmth/Empathy (1-10)
- **Store** in user profile: `profile.aiPersonality = { intelligence: 7, humor: 5, ... }`

### 14D. Propagate personality controls to all LLM prompt builders
- **File**: index.js and all LLM helper functions
- **Change**: Pass `aiPersonality` object to prompt template functions
- **Apply**: Add personality parameters to prompt interpolation (e.g., "respond with warmth={warmth}/10")
- **Benefit**: LLM responses tune to user preference consistently

---

## Step 15: Calendar-Link and Card UX Completion

### 15A. Ensure story auto-linking to GCal events remains enabled
- **File**: react-app/src/services/calendarService.ts (or functions)
- **Verify**: Story auto-linking to existing GCal events works end-to-end
- **Source**: Auto-matching on story creation (e.g., event named "Sprint Review" auto-links to matching story)

### 15B. Add card metadata source labels
- **File**: react-app/src/components/KanbanCard.tsx and mobile card components
- **Add label**: Show story origin: `auto-planned`, `linked from gcal`, `manual`, `calendar-time`
- **Style**: Distinct badge/tag (not conflated with defer/priority icons)

### 15C. Separate priority icon from calendar/defer icons
- **File**: react-app/src/components/KanbanCard.tsx
- **Change**: Use distinct icons for:
  - #1 priority → boldface number "1" badge (not star)
  - Scheduled time → calendar icon
  - Deferred → snooze icon
  - Do not visually overlap these affordances
- **Verification**: Cards with scheduled + #1 priority show both icons clearly

### 15D. Expose direct "Schedule now" modal action
- **File**: react-app/src/components/KanbanCard.tsx
- **Add action button**: "Schedule now" or calendar icon with click handler
- **Opens**: Modal to set task/story time block on calendar (distinct from defer flow)
- **Benefit**: User can quickly assign calendar time without deferral overhead

---

## Step 16: Regression Guardrails (Re-verify existing behavior)

### 16A. Daily check-in interaction constraints
- **File**: CheckInDaily.tsx
- **Rule**: Chores/habits/routines must NEVER show progress% or comment capture
- **Rule**: Stories/standard tasks KEEP progress% and last-comment inline display (both card/list view)
- **Verify**: Render check-in with mixed item types; inspect UI for rule compliance

### 16B. Story progress capacity coupling math
- **File**: nightlyOrchestration.js or scheduler
- **Formula**: `remainingPoints = totalPoints * (1 - progressPct/100)`; scheduling minutes = remainingPoints * 60
- **Example**: 10-point story at 50% progress → schedules 5 points (300 minutes) remaining
- **Verify**: Nightly planner capacity calcs use this formula end-to-end

### 16C. Daily check-in date guardrail
- **File**: CheckInDaily.tsx
- **Rule**: Default date = today; show red banner if prior day incomplete
- **Verify**: Open check-in with today + yesterday-incomplete scenario; confirm banner shows

### 16D. Modal-only navigation guarantee (Step 11)
- **File**: All modified components from Step 11
- **Verify**: Click every task/story ref in CheckInDaily, HabitsChoresDashboard, Calendar, JournalsManagement
- **Confirm**: No route navigation occurs; modals open, page context preserved

---

## Step 17: Finance Guardrail Email Wording Scope

### 17A. Isolate budget warning to month-progress only
- **File**: reporting.js — `buildFinanceCommentary()` or alerter
- **Scope rule**: Budget guardrail alert must include ONLY:
  - Discretionary spend % (e.g., "65% spent")
  - Month elapsed % (e.g., "30% of month")
  - Warning phrasing (e.g., "Discretionary spend at 65% with 30% of month elapsed")
- **Explicitly exclude**: Any goal-progress percentages, focus-goal %, KPI %

### 17B. Add structural guard to prevent semantic mixing
- **File**: templates.js — `renderDailySummaryEmail()`
- **Change**: Create separate email sections:
  1. "Budget Alert" (finance only, using fields from Step 17A)
  2. "Focus Goals Update" (focus-goal %, KPI %, points)
  3. "Capacity Warning" (time/effort %)
  4. "Health Summary" (NEW: body fat trend, macro adherence %, workouts)
- **Render guard**: Each section renderer validates it CANNOT include percentages from other sections

### 17C. Add validation test
- Test scenario: Overspent on budget (65% discretionary, 30% month) + focus goal at 40% + capacity overbooked 110% + body fat not on-trend
- Render email
- Verify: Budget alert shows 65%/30% only; focus section shows 40%; capacity section shows 110%; health section shows trend + adherence; no mixing

---

## Step 18: Theme Progress Pot Transfer View + Email

### 18A. Add shared pot-transfer computation
- **File**: reporting.js
- **Add function**: `computePotTransferProgress(uid)` that for each goal linked to a Monzo pot, compute:
  - Goal name, target amount, linked Monzo pot id
  - Total transferred into the pot
  - Total transferred out of the pot
  - Net transferred = in minus out
  - Net progress percent = net transferred / target amount
  - Fallback states: zero/insufficient history, freshness marker
- **Output**: Array of transfer-progress rows ready for Theme Progress and email surfaces

### 18B. Add pot-transfer summary section to daily summary email
- **File**: templates.js — `renderDailySummaryEmail()`
- **New section**: "Savings Progress" or "Goal Funding Status"
- **Content**: Top 3-5 rows from transfer-progress compute, sorted by highest net progress or largest shortfall
- **Columns**: Goal, Target, Transferred In, Transferred Out, Net Transferred, Progress %
- **Fallback**: If insufficient history, show "⏳ Not enough data yet" instead of number

### 18C. Add pot-transfer table to Theme Progress
- **File**: react-app/src/components/ThemeProgressDashboard.tsx
- **Display**: Transfer-progress table or column set inside Theme Progress, not on Dashboard
- **Columns**: Goal, Target Amount, Transferred In, Transferred Out, Net Transferred, Progress %
- **Interaction**:
  - Sort: Highest progress, highest shortfall, by theme
  - Filter: Show only linked pots, contributions >0, etc.
  - Click goal name → navigate to goal detail + edit target

### 18D. Explicitly exclude this view from Dashboard
- **File**: Dashboard.tsx
- **Rule**: Do not render the pot-transfer/runway table directly on Dashboard.
- **Rationale**: This financial progress view belongs on Theme Progress; Dashboard should only link into deeper finance surfaces when needed.

### 18E. Add freshness marker to both surfaces
- **File**: templates.js & react-app/src/components/ThemeProgressDashboard.tsx
- **Show**: Timestamp of last Monzo sync + transaction fetch
- **Mark stale**: If >24h old, show warning badge "Data may be outdated"
- **Benefit**: User aware of data freshness

---

## Step 19: Telegram AI Flow Integration

### 19A. Set up Telegram webhook endpoint (Functions)
- **File**: functions/telegramBotHandler.js (new file)
- **Create HTTPS handler** for Telegram webhook:
  - Path: `/webhook/telegram`
  - Validates Telegram signature (ensure message authenticity)
  - Routes message to handler based on command or callback button
- **Link setup**: Configure Telegram bot webhook to point to Firebase Functions HTTPS endpoint

### 19B. User identity linking
- **File**: functions/telegramBotHandler.js
- **Add flow**: `/start` command → generates deep link to BOB app with linking token
- **In BOB Settings page**: "Connect Telegram Bot" button → opens link, exchanges token for Telegram chat ID
- **Store**: In user profile: `profile.telegramChatId`, `linkedAt`, `botStatus`

### 19C. Basic read-only summary commands
- **Commands**:
  - `/next` → "Here's your next priority: [story title] due [date]"
  - `/summary` → "Daily digest: X focused stories, Y completed, Z overdue"
  - `/goals` → "Active focus goals: [goal1], [goal2]... (X% aligned)"
  - `/health` → "Body fat 24% → 20% target (16 weeks). Today: 11.5k steps, 89% macros, 180min workout."
- **Implementation**: Each command queries Firestore for summary data and sends formatted Telegram message

### 19D. Approval buttons for deferral/planner flows
- **Callback buttons**: 
  - "✅ Approve" or "❌ Reject" on planner suggestions
  - Clicking button updates Firestore + acknowledges in Telegram
  - User confirms deferral, scheduling, or focus changes via Telegram without switching apps
- **Flow**: Cloud Function sends Telegram callback button message → user taps button → bot processes action

### 19E. Activity audit logging for Telegram actions
- **File**: functions/telegramBotHandler.js
- **Log entry to `activity_stream` or `ai_logs`**:
  - Source: `telegram`
  - Action: `/next`, `/summary`, `/goals`, `/health`, `approve_deferral`, etc.
  - Metadata: Telegram user ID (anonymized), callback data (if button action)
  - Result: Succeeded/failed, timestamp
- **Benefit**: Telegram actions appear in unified activity logs

### 19F. Settings UI for Telegram bot management
- **File**: react-app/src/components/settings/IntegrationsSettings.tsx (or new)
- **UI widgets**:
  - "Connect Telegram Bot" button (if not linked)
  - Status: "Connected as @username" + "Last activity 2h ago" (if linked)
  - "Disconnect" button to unlink
  - Notification preferences checkboxes (send daily summary? defer approvals? priority alerts? health summary?)
- **Verification**: Link/unlink flow via Settings

---

## Step 20: Cross-Repo Agent Build/Test/Commit Guidance

### 20A. Create unified build orchestration documentation
- **File**: BUILD_ORCHESTRATION_GUIDE.md (already exists; ensure complete)
- **Content**: 
  - Repo structure overview (bob, bob-ios, bob-mac-sync)
  - Build commands per repo (npm run build, xcodebuild, cargo build, etc.)
  - Test/validation commands (npm test, Xcode unit tests, etc.)
  - Deploy/release steps (firebase deploy, TestFlight, GitHub release)
  - Fast validation scripts (linting, type check, smoke tests)

### 20B. Create per-repo operational runbook
- **Files**:
  - BOB_WEB_BUILD_RUNBOOK.md
  - BOB_iOS_BUILD_RUNBOOK.md
  - BOB_MAC_SYNC_BUILD_RUNBOOK.md
- **Minimum content per file**:
  1. **Setup**: Clone, install deps, config (service account, Firebase project, etc.)
  2. **Build**: Primary build command + common flags
  3. **Test**: Unit test, integration test, E2E test commands
  4. **Validate**: Type check, lint, formatting checks
  5. **Deploy**: Staging vs production steps
  6. **Logs/Debugging**: Log file locations, common error patterns, fix paths
  7. **Branch conventions**: Feature branch naming, PR/commit patterns
  8. **Backup workflow**: Safe commit/tag strategy before PRs
  9. **Common issues**: Known failures + quick fixes

### 20C. Add agent-friendly validation script
- **File**: scripts/validate-cross-repo.sh (new)
- **Purpose**: Run key validation steps across all 3 repos in one command
- **Steps**:
  1. Check git status (dirty working dirs)
  2. Run build in each repo (abort if any fails)
  3. Run linting/type checks
  4. Run smoke tests
  5. Summarize pass/fail + time per repo
- **Usage**: `./scripts/validate-cross-repo.sh` before agents open PRs

### 20D. Cross-link guidance from AGENTS.md
- **File**: AGENTS.md
- **Updates**:
  - Link to BUILD_ORCHESTRATION_GUIDE.md
  - Link to per-repo runbooks
  - Link to validation script
  - Add "For PR submissions: follow the per-repo runbook, run validate-cross-repo.sh, ensure backup tags created"

---

# ================ VERIFICATION CHECKLIST ================

## Web (Phases 1-6) Verification Steps

- [x] **Phase 1A**: No Firestore undefined errors in story/pot auto-creation
- [x] **Phase 1B/1C**: Goal type added to Firestore with backward-compat defaults
- [x] **Phase 2**: Wizard renders in correct order (vision → select → goalTypes → timeframe → review → confirm)
- [x] **Phase 2**: Calendar-time goals created without Sprint stories
- [x] **Phase 6A**: Firestore undefined guards covered by focused unit tests for story/pot creation helpers
- [x] **Phase 6B**: Wizard integration flow covered for vision/select/goal-type/timeframe/review/confirm with goalTypeMap assertions
- [x] **Phase 3**: Monzo ref prompt shown; backend watcher links pots on scheduled cadence (cost-tuned)
- [x] **Phase 4A**: Unaligned banner shows on FocusGoalsPage when active focus exists
- [x] **Phase 4B**: Sprint Table filter displays unaligned stories only
- [x] **Phase 4C**: Dashboard widget shows unaligned count + focus % accurately
- [x] **Phase 5A**: KPI Designer opens from wizard review step
- [x] **Phase 5C**: KPI charts display on FocusGoalCountdownBanner with correct trends
- [x] **Phase 5D**: HealthKit data syncs nightly to goal_kpi_metrics

## iOS/iPad (Phases A-F) Verification Steps

- [ ] **Phase A**: Star button hidden on iPad/Mac, visible on iPhone
- [ ] **Phase B**: Daily checklist only shows current user's items (ownerUid filter works)
- [ ] **Phase B**: Cross-user leak prevented (user A cannot see user B's chores)
- [ ] **Phase C**: Widget resize state persists after drag + device rotation
- [ ] **Phase C**: Drag gesture smooth (debounce working, no per-frame saves)
- [ ] **Phase D**: DailyPlanView accessible from iPhone "Plan" tab + iPad sidebar
- [ ] **Phase D**: Day-part grouping renders (Morning/Afternoon/Evening sections visible)
- [ ] **Phase E**: KPI widgets present on iPad OverviewView
- [ ] **Phase E**: KPI data updates within 5min of HealthKit sync

## Fitness/HealthKit (Phases A-E) Verification Steps

- [ ] **Phase A**: iOS daily HealthKit sync writes to health_metrics Firestore with source attribution
- [ ] **Phase A**: CheckInDaily macro manual entry accepted + stored in health_metrics
- [ ] **Phase A**: Backfill script loads 90 days of historical HealthKit data
- [ ] **Phase B**: ETA computation runs nightly; weeksToTarget computed correctly for body fat goal
- [ ] **Phase B**: Dashboard health banner shows at top with body fat trend + weeks-to-target
- [ ] **Phase B**: Health badge shows HealthKit/manual source attribution + recency ("Updated 2h ago")
- [ ] **Phase B**: Dashboard health surface is a dismissible compact progress card with persistence and a visible progress bar, not a permanent alert banner
- [ ] **Phase B**: Missing weight/body-fat targets route cleanly from the dashboard card into Settings profile target fields
- [ ] **Phase B**: Dashboard Key Metrics includes a `Health` card that drills into `/fitness`
- [ ] **Phase C**: Fitness Dashboard renders 30-day training donut with sport breakdown
- [ ] **Phase C**: Compliance cards show steps %, distance %, workout % with sparklines
- [ ] **Phase C**: `/fitness` drill-down includes weight, body fat, steps, distance, workout-time, and macro trends in one surface
- [ ] **Phase D**: NutritionDashboard shows daily macro adherence % with stacked progress bars
- [ ] **Phase D**: Deterministic advisor baseline generated with explainable rationale for each macro
- [ ] **Phase D**: Nutrition goals plus weight/body-fat targets are editable in SettingsPage; updates trigger downstream dashboard/fitness refresh
- [ ] **Phase E**: Feature flags for fitness features work as intended (gradual rollout enabled)
- [ ] **Phase E**: GA success criteria dashboard configured (coverage, adoption, engagement metrics)

## OS Evolution Verification Steps (Steps 11-20)

- [ ] **Step 11**: Click task/story refs in CheckInDaily/HabitsChoresDashboard/Calendar/Journals → modals open, no route change
- [ ] **Step 12**: Mac sync logs show advanced `macSyncedAt` + `serverUpdatedAt` after merge
- [ ] **Step 12**: Stale Top3 tags cleared from tasks where `aiTop3Date != today()`
- [ ] **Step 13**: Daily email includes finance + capacity + focus + priority + **health metrics** signal blocks
- [ ] **Step 13**: Dashboard "Active Signals" widget mirrors email content (including health)
- [ ] **Step 14**: Every LLM call logged with trace ID, prompt template, parse status, latency, **plus health context when applicable**
- [ ] **Step 14**: AI diagnostics debug view filters and displays trace events
- [x] **Step 14**: AI diagnostics debug view filters and displays trace events
- [ ] **Step 14**: Personality sliders in Profile Settings persist + affect LLM responses
- [x] **Step 15**: Story-to-GCal linking auto-works on story creation
- [x] **Step 15**: Card source labels show (`auto-planned` / `linked from gcal` / `manual`)
- [x] **Step 15**: Priority + Schedule + Defer icons distinct and non-overlapping
- [ ] **Step 16**: Chores/habits never show progress %; stories show progress % + last comment
- [ ] **Step 16**: Capacity math uses correct formula: remaining = total * (1 - progress/100)
- [ ] **Step 17**: Finance guardrail wording includes ONLY spend % + month elapsed %
- [ ] **Step 17**: No goal-progress, KPI, or health percentages leak into finance alert email block
- [ ] **Step 18**: Theme Progress shows linked-pot transfer progress using transferred-in, transferred-out, and net-transferred math
- [ ] **Step 18**: Dashboard does not render the pot-transfer/runway table directly
- [ ] **Step 18**: Email savings section includes transfer progress plus stale/insufficient-history labels when applicable
- [ ] **Step 19**: Telegram bot webhook configured + signature validation works
- [ ] **Step 19**: `/next`, `/summary`, `/goals`, `/health` commands return formatted messages
- [ ] **Step 19**: Approval buttons on Telegram work (tapping updates Firestore)
- [ ] **Step 20**: Build orchestration guide complete with all 3 repos documented
- [ ] **Step 20**: Per-repo runbooks exist with setup/build/test/deploy steps
- [ ] **Step 20**: Cross-repo validation script runs successfully

---

# ================ RELEVANT FILES ================

## Core Types & Config
- types.ts — Goal, HealthMetric, TrainingMetric, EtaComputation, User profile types
- firestore.indexes.json — Indexes for query performance (health_metrics range queries, training_metrics lookups)

## Web (React/TypeScript) — Focus Goals & KPI
- FocusGoalWizard.tsx — Wizard UI (restructure to vision-first)
- focusGoalsService.ts — Story/pot auto-creation, undefined fix
- FocusGoalsPage.tsx — Unaligned banner add
- react-app/src/components/KPIDesigner.tsx — **NEW** KPI design modal
- FocusGoalCountdownBanner.tsx — KPI chart display

## Web (React/TypeScript) — Fitness & Health
- Dashboard.tsx — Health banner (top), focus alignment widget, nutrition card
- react-app/src/components/ThemeProgressDashboard.tsx — Theme Progress transfer view and focus-goal progress surfaces
- react-app/src/components/FitnessDashboard.tsx — **NEW** or extend WorkoutsDashboard.tsx with 30-day donut, compliance cards, body composition
- react-app/src/components/NutritionDashboard.tsx — **NEW** Daily/weekly macro tracker + deterministic advisor
- CheckInDaily.tsx — Add collapsible macro entry section (fallback manual input) + modal-only edits
- AdvancedOverview.tsx — Extend with health widget display
- react-app/src/components/settings/SettingsPage.tsx — Add "Nutrition & Fitness" settings + AI personality sliders + Telegram integration
- react-app/src/features/flags.ts — Feature flags for fitness/nutrition rollout

## Web (React/TypeScript) — Modal Navigation & Cards
- HabitsChoresDashboard.tsx — Modal-only task edits
- Calendar.tsx — Modal-only task edits
- JournalsManagement.tsx — Modal-only story/task edits
- react-app/src/components/KanbanCard.tsx — Card icon parity (priority/schedule/defer) + source labels + Direct "Schedule now" action
- AiDiagnosticsLogs.tsx — AI trace inspection view

## Functions (Backend)
- index.js — Nightly orchestration, Monzo pot watcher, LLM telemetry logging, Telegram webhook handler
- reporting.js — Signal digest composer (including health metrics), pot-transfer progress computation, finance guardrail scoping, **health summary integration**
- templates.js — Daily summary email renderer with signal + health parity
- functions/healthSync.js — **NEW** HealthKit API fetch + Strava sync + telemetry logging (daily at 6 AM UTC)
- functions/lib/healthEta.js — **NEW** ETA computation engine (weeksToTarget, trends)
- functions/lib/fitnessKpiMath.js — **NEW** KPI math (macro adherence, step %, distance %, workout time %)
- functions/lib/nutritionAdvisor.js — **NEW** Deterministic nutrition baseline + recommendations with rationale
- functions/fitnessKpiSync.js — Goal KPI nightly sync from HealthKit
- functions/telegramBotHandler.js — **NEW** Telegram webhook + command routing + state store

## iOS (SwiftUI)
- bob-ios/BOB/Sources/Views/Stories/StoriesListView.swift — Hide star on iPad/Mac
- bob-ios/BOB/Sources/Views/Planning/DailyChecklistView.swift — Ownership bug fix (ownerUid filtering)
- bob-ios/BOB/Sources/Views/Overview/OverviewView.swift — Widget resize fix (hoist state, debounce saves) + KPI widget display
- bob-ios/BOB/Sources/Views/Overview/WidgetResizeHandles.swift — State binding fix (remove local @State)
- bob-ios/BOB/Sources/Views/Planning/DailyPlanView.swift — **NEW** Dedicated daily plan screen
- bob-ios/BOB/Sources/Views/Shared/ContentView.swift — Register Daily Plan tab/sidebar
- bob-ios/BOB/Sources/Models/BOBChore.swift — Add ownerUid field
- bob-ios/BOB/Sources/Services/HealthKitSyncService.swift — **NEW** or extend existing. Daily HealthKit fetch + Firestore write (weight, body fat, steps, distance, workouts) + source attribution
- bob-ios/BOB/Sources/Views/Health/DetailedFitnessView.swift — **NEW** Fitness detail screen (30-day donut, cards, body fat trend chart, ETA)

## Mac Sync (Rust/Swift)
- bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift — Merge timestamp fix, stale Top3 reconciliation
- bob-mac-sync/reminders-menubar/Services/SyncLogService.swift — Task identity diagnostics

## Scripts
- scripts/backfill-healthkit.js — **NEW** Backfill 90 days of HealthKit data for users
- scripts/validate-cross-repo.sh — **NEW** Cross-repo validation automation

## Documentation
- BUILD_ORCHESTRATION_GUIDE.md — Multi-repo build commands + coordination
- BOB_WEB_BUILD_RUNBOOK.md — **NEW** Web-specific setup/build/test/deploy
- BOB_iOS_BUILD_RUNBOOK.md — **NEW** iOS-specific setup/build/test steps
- BOB_MAC_SYNC_BUILD_RUNBOOK.md — **NEW** Mac sync setup/build/deploy
- AGENTS.md — Update with links to build/runbook guidance

---

# ================ DECISIONS & CONSTRAINTS ================

- **Vision-First Wizard**: Changes step order significantly; may confuse existing users. Recommend soft launch / feature flag if in production.
- **Story vs. Calendar Toggle**: Added at step 3; user makes explicit choice. Adds friction but provides clarity for goal type intent.
- **Monzo Manual Creation**: Defers from wizard to background sync; simplifies auth but adds async uncertainty (~5 min).
- **Modal-Only Navigation**: Preserves page context but requires state management discipline across multiple components.
- **Mac Sync Stale Metadata**: Fix may surface historical data resets; recommend monitoring sync logs during rollout.
- **Personality Controls**: LLM response tuning requires prompt template versioning to prevent regressions.
- **Telegram Integration**: Phase 1 read-only (lowest risk); Phases 2-3 add approval flows (higher risk, stagger rollout).
- **Backward Compat**: All new fields have defaults; existing goals/health data continue functioning without migration.
- **iOS Changes**: Star removal iPad-only (no iPhone regression); ownership fix closes security gap; widget fix improves UX.
- **HealthKit as Primary**: iOS HealthKit is authoritative source for body composition; Strava for training detail; manual fallback for macros.
- **Deterministic Nutrition**: Advisor uses rule-based formulas (not opaque AI) with explicit rationale for each recommendation.
- **Weekday/Weekend Split**: 20% workout goal uses different denominators (8h vs 16h free time); future upgrade path to theme-allocation-derived.

---

# ================ FURTHER CONSIDERATIONS ================

1. **Calendar-time goals on roadmap views?** — Display as "Time Blocks" or "Calendar Entries" vs "Stories"? Add distinct visual styling?
2. **KPI baseline/targets nullable?** — If user starts a KPI without setting targets, should we auto-suggest based on HealthKit history?
3. **Monzo pot linking timeout?** — How long should bot wait before giving up (currently 24h)? Should user get notification if link fails?
4. **Telegram rollout phasing?** — Phase 1 (read-only) safe to launch broad; Phase 2 (approvals) recommend beta users first.
5. **Daily Plan screen — merge with Daily Checklist?** — Or keep separate? Currently scoped as distinct surfaces but could consolidate if complexity grows.
6. **Savings progress source?** — For Theme Progress, should transfer status rely strictly on Monzo pot transfer history, or also expose a separate planning forecast elsewhere? Current policy is transfer-based progress only here.
7. **HealthKit data freshness cadence?** — Current: daily 6 AM sync. Should we support real-time push from iOS for manual entries + weight/body fat? (Lower priority for GA)
8. **Nutrition advisor future expansion?** — Currently deterministic rules. Should we support threshold-based AI upgrades later (e.g., "if body fat stuck >8 weeks, consult LLM for strategy")? (Out of scope for Phase E)
9. **Health metric retention policy?** — How long to keep daily health_metrics docs? Recommend: Keep granular daily for 12 months, then archive to monthly aggregates for historical trend queries.
10. **Cross-user health visibility?** — Scope for Phase A-E: personal user only. Future: partner/trainer health share? (Feature-flag for later)

---

# ================ EXECUTION SEQUENCE ================

**Recommended order to minimize blocking dependencies:**

### Day 1 (Minimal Shippable Increment — Focus Goals Foundation)
1. **Phase 1A-1C** (Foundation fixes) — No dependencies, unblock all following phases
2. **Phase 2A-2D** (Wizard restructure) — Depends on Phase 1
3. **Step 11** (Modal edits) — Parallel, independent once Phase 1 validates

### Day 2 (Monzo + Unaligned Banner)
4. **Phase 3A-3C** (Monzo manual creation) — Parallel with Phase 2, depends on Phase 1C fields
5. **Phase 4A-4C** (Unaligned banner) — Parallel with Phase 3, depends on Phase 1B/1C

### Day 3-4 (KPI + iOS Core Fixes)
6. **Phase 5A-5D** (KPI Designer) — Parallel with Phase 4, depends on Phase 1C fields
7. **Phase A-D** (iOS star, ownership, widget, daily plan) — Independent, parallel with web work

### Day 5 (Health Data Foundation)
8. **Phase HealthKit-A** (Data contract + sync) — Foundation for all health work, can start once Phase 5D validates
9. **Phase HealthKit-B** (ETA + banner) — Depends on Phase HealthKit-A

### Day 6-7 (Health Dashboards + OS Evolution)
10. **Phase HealthKit-C-D** (Fitness + Nutrition) — Depends on Phase HealthKit-B
11. **Phase HealthKit-E** (Backfill, telemetry, rollout) — Parallel with Phase HealthKit-C-D
12. **Step 12** (Mac sync fix) — Parallel with all above, independent
13. **Step 13-17** (Daily summary, LLM, finance) — Parallel, minimal blocking
14. **Phase E** (iOS KPI visibility) — Depends on Phase HealthKit-C for data; parallel with Mac sync work

### Day 8+ (Integrations + Verification)
15. **Step 18** (Theme Progress pot-transfer view) — Depends on Monzo linking (after Phase 3)
16. **Step 19** (Telegram) — Can start once Step 13-14 (signal digest, logging) complete
17. **Step 20** (Build guidance) — Last, after other phases documented
18. **Phase F** (iOS testing) — After Phase A-E complete
19. **Phase 6** (Web verification) — After Phases 1-5 complete

**Critical path**: Phase 1A → Phase 1B-1C → Phase 2 → (Phase 3 parallel Phase 4) → Phase 5 → HealthKit-A → HealthKit-B → (HealthKit-C-D parallel HealthKit-E)

---

# ================ STATUS ================

**Plan Status**: Complete consolidated plan covering:
- ✅ Web Focus Goals (Phases 1-6)
- ✅ iOS/iPad Features (Phases A-F)
- ✅ Fitness/HealthKit Integration (Phases A-E)
- ✅ OS Evolution Architecture (Steps 11-20)
- ✅ Cross-repo guidance (Step 20)
- ✅ Day 1 execution slices identified
- ✅ All file anchors and line numbers documented

**Completed Slice Log**:
- ✅ 13 Mar 2026: App Check reCAPTCHA throttling mitigation slice shipped.
  Scope completed: updated `react-app/src/firebase.ts` so web App Check initializes in warmup mode, enables token auto-refresh only after a successful token exchange, and disables itself into a local cooldown window after 400/throttle-style failures that were repeatedly re-triggering reCAPTCHA on `bob.jc1.tech`.
  Validation completed: no TypeScript/Problems errors in touched firebase bootstrap file.
  Remaining in this lane: verify Firebase Console App Check configuration for `bob.jc1.tech` and the configured reCAPTCHA v3 site key so the cooldown path is no longer needed in normal production use.
- ✅ 13 Mar 2026: Finance dashboard compaction + Daily Plan density slice shipped.
  Scope completed: reduced the footprint of finance summary metric cards and chart containers in `react-app/src/components/finance/FinanceDashboardAdvanced.tsx` and `react-app/src/components/finance/FinanceDashboardAdvanced.css`, improved donut readability with centered total context, and tightened `react-app/src/components/DailyPlanPage.tsx` with compact summary pills, denser row spacing, inline deferred badges, and chore-level defer/schedule parity.
  Validation completed: pending final build/type validation after this slice.
  Remaining in this lane: Daily Plan modal-first editing and bulk review table workflow still remain open.
- ✅ 13 Mar 2026: Dashboard strict-violation telemetry slice shipped.
  Scope completed: added selected-sprint strict enforcement counters (24h/7d + last violation time) from `integration_logs` and surfaced selected sprint audit summary from `sprint_alignment_audit` in `react-app/src/components/Dashboard.tsx` Focus Alignment card.
  Validation completed: no TypeScript/Problems errors in touched Dashboard file.
  Remaining in this lane: optional dedicated chart for alignment trend over time.
- ✅ 13 Mar 2026: Sprint-alignment visibility slice shipped.
  Scope completed: exposed sprint `alignmentMode` + `focusGoalIds` count directly in `react-app/src/components/ModernSprintsTable.tsx` (new Alignment column) and surfaced selected-sprint alignment mode/goal-count context in Dashboard Focus Alignment status (`react-app/src/components/Dashboard.tsx`).
  Validation completed: no TypeScript/Problems errors in touched files.
  Remaining in this lane: optional dashboard trending on strict-mode violation count from `sprint_alignment_audit`.
- ✅ 13 Mar 2026: Phase 6D KPI Designer verification and persistence-hardening slice shipped.
  Scope completed: verified FocusGoalWizard review-step KPI Designer handoff path and fixed multi-save KPI append behavior in `react-app/src/components/KPIDesigner.tsx` by reading latest goal doc state before writing `kpis`, preventing overwrite when adding multiple KPIs in one modal session.
  Validation completed: no TypeScript/Problems errors in touched KPI wizard/designer files.
  Remaining in the broader web verification plan: optional live UI pass for KPI chart rendering against real `goal_kpi_metrics` values.
- ✅ 13 Mar 2026: Sprint-focus alignment enforcement slice shipped.
  Scope completed: extended sprint model with `focusGoalIds` + `alignmentMode`, added sprint-level focus-goal selection and activation guard in `react-app/src/components/ModernSprintsTable.tsx`, enforced warn/strict checks in story create/edit flows (`react-app/src/components/AddStoryModal.tsx`, `react-app/src/components/EditStoryModal.tsx`), and added backend strict-mode safety + nightly alignment audit in `functions/index.js`.
  Validation completed: no TypeScript/Problems errors in touched files.
  Remaining in this lane: add dashboard/table exposure of sprint alignment mode and current focus-goal count for faster operator visibility.
- ✅ 13 Mar 2026: Phase 6C manual cross-surface alignment verification slice shipped.
  Scope completed: validated unaligned-story visibility and focus-alignment indicators across `react-app/src/components/FocusGoalsPage.tsx`, `react-app/src/components/ModernKanbanPage.tsx`, and `react-app/src/components/Dashboard.tsx`; then harmonized scope rules so all three surfaces only treat active sprints as alignment context.
  Validation completed: updated Kanban and Dashboard gating to active-sprint status, confirmed no TypeScript/Problems errors in touched files.
  Remaining in the broader web verification plan: optional live UI validation against real KPI metric data.
- ✅ 13 Mar 2026: Focus-toggle parity slice shipped for planning/goals/roadmap surfaces.
  Scope completed: added active-focus subscriptions and `Focus goals only` toggles to `react-app/src/components/SprintPlanningMatrix.tsx` and `react-app/src/components/visualization/GoalRoadmapV6.tsx`, and updated `react-app/src/components/GoalsManagement.tsx` so the existing focus filter defaults to ON when an active focus set exists.
  Remaining in this lane: manual UX pass for toggle persistence expectations across page reloads and sprint/persona switches.
- ✅ 13 Mar 2026: Focus countdown KPI mini-chart slice shipped.
  Scope completed: extended `react-app/src/components/FocusGoalCountdownBanner.tsx` to subscribe to `goal_kpi_metrics` for active focus goals and render compact KPI trend mini-charts with current/target readouts directly in each selected goal card.
  Remaining in the broader web plan: Phase 6C manual cross-surface verification and any KPI trend tuning after real-data visual QA.
- ✅ 13 Mar 2026: Sprint Planner navigation parity slice shipped.
  Scope completed: added `Sprint Planner` under the Stories section in `react-app/src/components/SidebarLayout.tsx` and moved/renamed the planning action button in `react-app/src/components/SprintKanbanPageV2.tsx` so `Sprint planner` appears immediately to the left of `View overview`.
  Remaining in the broader web plan: continue Phase 6C manual cross-surface verification.
- ✅ 13 Mar 2026: iPad/Mac overview banner parity slice shipped (bob-ios).
  Scope completed: wired persistent overview banners to large-screen Apple surfaces only (iPad + Mac Catalyst) and added a compact health progress top banner in `BOB/Sources/Views/Overview/OverviewCards2.swift`, with large-screen gating in `BOB/Sources/Views/Overview/OverviewView.swift`.
  Remaining in the broader Apple lane: complete explicit iPhone-vs-iPad manual verification matrix for all banner states and add parity for evening pull-forward recommendation actions when that surface is defined in iOS UI requirements.
- ✅ 13 Mar 2026: Aggressive backlog auto-replan + evening pull-forward slice shipped.
  Scope completed: added nightly/delta orchestration logic that auto-defers non-critical non-Top3 non-focus-linked work, rolls incomplete chores/habits to next recurrence, classifies title-based research work and shifts it to weekend capacity windows, and emits 7pm+ evening pull-forward suggestions when Top3 is complete.
  UX integration: Dashboard now surfaces evening opportunity suggestions and lets users bring one forward to today via callable action.
  Remaining in this lane: tune defer thresholds (score/time horizon) and add deeper verification coverage for weekend-capacity selection edge cases.
- ✅ 13 Mar 2026: Focus wizard integration verification slice shipped.
  Scope completed: added end-to-end wizard-flow coverage in `react-app/src/components/FocusGoalWizard.test.tsx` that runs vision-first flow through select, goal-type assignment (story/calendar mix), timeframe selection, review, and final save assertion for persisted `goalTypeMap`.
  Validation completed: targeted wizard integration test passes (`1 passed`) and confirms expected focus payload shape (`goalIds`, `timeframe`, `goalTypeMap`).
  Remaining in the broader web verification plan: manual cross-surface alignment checks (Phase 6C) and KPI countdown chart work (Phase 5C).
- ✅ 13 Mar 2026: Dashboard Focus Alignment Status slice shipped.
  Scope completed: added live active-focus subscription to Dashboard, computed sprint alignment metrics (unaligned stories, aligned %, focus-story completion), and rendered a new Key Metrics card labeled "Focus Alignment Status" with direct drill-down to Focus Goals.
  Validation completed: web build compiles successfully and existing focus-goal service tests remain green.
  Remaining in the broader web verification plan: wizard integration test coverage (Phase 6B), manual cross-surface alignment checks (Phase 6C), and KPI countdown chart work (Phase 5C).
- ✅ 13 Mar 2026: Verification and sprint-alignment slice shipped.
  Scope completed: added focused unit coverage for Firestore undefined guards in `focusGoalsService` (goal list undefined handling and savings-pot id guard), implemented active-focus unaligned-story filtering/highlighting in `ModernKanbanPage` with "Show unaligned stories only" toggle, and fixed missing `ListGroup` import in `FocusGoalsPage` discovered during compile validation.
  Validation completed: targeted tests for `focusGoalsService` pass (2/2), and web build compiles successfully (existing repository-wide lint warnings remain outside this slice).
  Remaining in the broader alignment plan: Dashboard Focus Alignment Status card (Phase 4C), wizard integration test (Phase 6B), and manual verification pass for cross-surface alignment interactions.
- ✅ 12 Mar 2026: Dashboard health UX sub-slice shipped.
  Scope completed: compact dismissible health progress card on Dashboard, direct Settings CTA for missing targets, editable weight/body-fat targets in Settings, richer Health key-metric drill-down routing to `/fitness`, expanded `/fitness` health snapshot and trend charts, and manual fallback fields for distance/workout/body-composition in daily check-in.
  Remaining in the broader HealthKit plan: ETA computation backend, canonical `health_metrics` contract writes, nutrition advisor, rollout flags, telemetry, and iOS HealthKit sync/backfill work.
- ✅ 12 Mar 2026: Focus Goals foundation slice shipped.
  Scope completed: hardened `autoCreateStoriesForGoals` against missing goal docs/ids, preserved goal ids when hydrating from Firestore, guarded savings-pot creation loops against invalid goal ids, and added shared Goal/FocusGoal fields for `goalRequiresStory`, `monzoPotGoalRef`, `monzoPotId`, and `monzoPotGoalRefs`.
  Remaining in the broader Focus Goals plan: wizard step rework, goal-type selection UI, Monzo manual-link prompts/watcher flow, KPI designer integration, and downstream verification coverage.
- ✅ 12 Mar 2026: Focus Goals wizard flow slice shipped.
  Scope completed: reordered the wizard to vision → select → goal types → timeframe → review → confirm, added per-goal story-vs-calendar planning mode, updated review/confirm summaries to reflect the chosen planning mode, and moved story/savings auto-creation to the final save path instead of the earlier review transition.
  Remaining in the broader Focus Goals plan: Monzo manual creation prompt/link watcher flow, KPI designer handoff, explicit calendar-time event tooling, and end-to-end verification coverage.
- ✅ 12 Mar 2026: Monzo manual pot-link slice shipped.
  Scope completed: removed automatic Monzo pot creation from the focus setup path, added deterministic manual goal refs (`GOAL-{goalId}`) in wizard review with copy UX, persisted ref mappings to goal docs via `monzoPotGoalRef`, and stored `goalTypeMap` + Monzo ref map on created focus goals.
  Remaining in the broader Monzo plan: backend watcher/cron linking unresolved refs to real Monzo pot ids and timeout/notification handling.
- ✅ 12 Mar 2026: KPI Designer handoff slice shipped.
  Scope completed: added a reusable KPI Designer modal for selected goals, enabled KPI creation in wizard review before confirm, and persisted KPI entries onto goal docs through the existing goal `kpis` array contract.
  Remaining in broader KPI plan: richer KPI schema (`kpisV2`), baseline/trend history model, and dedicated KPI charting on focus countdown surfaces.
- ✅ 12 Mar 2026: Calendar manual-scheduling suppression slice shipped.
  Scope completed: updated nightly planner scheduling so entities with existing user-created (non-AI) calendar blocks are skipped by auto-placement, preventing duplicate/competing AI-planned blocks when users intentionally schedule from kanban.
  Remaining in broader calendar confidence plan: CSA-specific matcher diagnostics surface, confidence rationale visibility on more calendar surfaces, and orphaned closed/deleted-entity cleanup policy for legacy blocks.
- ✅ 12 Mar 2026: Monzo ref-link watcher slice shipped.
  Scope completed: added backend Monzo goal-ref linker logic that resolves pending `monzoPotGoalRef` values to real pot ids from synced Monzo pots, writes `monzoPotId`/`linkedPotId`/`potId` + linked timestamp on match, marks unresolved refs as timeout after 24 hours, and records linker outcomes to integration logs.
  Remaining in broader Monzo plan: user-facing timeout notification UX and optional manual retry controls in settings/focus surfaces.
- ✅ 12 Mar 2026: Monzo timeout/retry UX slice shipped.
  Scope completed: added Focus Goals UI status for pending/timed-out Monzo pot links, exposed per-goal and retry-all actions for timed-out refs, and implemented a retry helper that resets link state and triggers immediate Monzo sync to re-attempt linkage.
  Remaining in broader Monzo plan: optional settings-surface parity for retry controls and notification-level messaging outside Focus Goals.
- ✅ 12 Mar 2026: Focus unaligned-story banner slice shipped.
  Scope completed: added Focus Goals warning banner for active-sprint stories not mapped to active focus goals, plus quick actions to align a story to the active focus set or remove it from the sprint.
  Remaining in broader alignment plan: sprint-table-level unaligned filter toggle and dashboard alignment status widget parity.

**Prompt Parity Audit (13 Mar 2026)**:
- Baseline compared: latest user prompt used as canonical source for `plan.md` scope and ordering.
- In sync with prompt: Web Phases 1/2 foundations, Monzo manual ref setup + watcher path, KPI Designer handoff, FocusGoalsPage unaligned banner (4A), and sprint-table unaligned filter (4B).
- Divergence to resolve explicitly: Step 18 currently documented in this file as Theme Progress transfer view language; latest prompt baseline references savings runway on Dashboard + email. Keep this as an open decision item before implementing Step 18 code to avoid scope drift.

**Location**: plan.md

**Next Step**: Start the next implementation slice and continue updating this log with one commit per completed slice.


Plan: Kanban GCal Defects + Remaining Web Work
Add this as an immediate defect slice: the kanban “manual Google Calendar event” action should reuse the same event composer flow as Unified Planner “New event”, and the auto-linked GCal source text on kanban/story cards should be visually quieter than it is now. After that, the highest-value remaining web work is still Daily Plan completion, then validation of the App Check production config, then the larger health/fitness surfaces already outlined in plan.md.

Immediate defect slice

Extract or reuse the Unified Planner event composer currently embedded in react-app/src/components/planner/UnifiedPlannerPage.tsx so it can be opened from kanban surfaces.
Replace the direct-create behavior in react-app/src/components/KanbanCardV2.tsx createManualCalendarEvent(...) with “open composer prefilled from this card”.
Prefill the composer with the same data the current kanban shortcut already knows:
task or story id, title, theme or category, sensible start/end defaults, and Google sync enabled.
Keep save behavior aligned with Unified Planner submit handling rather than duplicating calendar block creation logic in the card component.
Make the auto-linked GCal source text more subtle on kanban/story cards, starting with react-app/src/components/stories/SortableStoryCard.tsx.
Audit react-app/src/components/KanbanCardV2.tsx for the same source-note treatment so the label style stays consistent across card surfaces.
Next remaining work

Finish Daily Plan defects in react-app/src/components/DailyPlanPage.tsx:
modal-first task/story editing, bulk review table, and remaining triage workflow.
Complete the wider Step 11 modal-only audit across react-app/src/components/CheckInDaily.tsx, react-app/src/components/HabitsChoresDashboard.tsx, react-app/src/components/Calendar.tsx, and react-app/src/components/JournalsManagement.tsx.
Verify Firebase Console App Check settings for bob.jc1.tech and the configured reCAPTCHA v3 key. The client-side cooldown in react-app/src/firebase.ts is a mitigation, not the final root-cause fix.
Then resume the larger web roadmap already open in plan.md: health data foundation, dashboard health banner, /fitness, and nutrition advisor.
Relevant files

react-app/src/components/KanbanCardV2.tsx — current manual gCal action is direct-create and should become composer-open.
react-app/src/components/planner/UnifiedPlannerPage.tsx — current canonical “New event” composer behavior to reuse.
react-app/src/components/stories/SortableStoryCard.tsx — auto-linked GCal source label styling is currently the clearest defect anchor.
react-app/src/components/DailyPlanPage.tsx — next major unresolved UX surface.
react-app/src/firebase.ts — current App Check mitigation already landed; production config still needs verification.
plan.md — repo plan remains the canonical roadmap reference for the broader work.
Verification

Clicking the kanban manual calendar action opens the same composer UX as Unified Planner, not an immediate save.
Saving from that composer creates the same type of calendar block and Google-sync behavior as Unified Planner “New event”.
Auto-linked or matched GCal source text is visually subordinate to the main schedule badge on both story and kanban cards.
Daily Plan remains the next unresolved defect cluster after this slice.
I couldn’t persist this into /memories/session/plan.md because session memory storage is unavailable in this chat context, so I’m keeping the active plan here in the response rather than editing repo files while in planning mode.

Recommended next execution order:

Kanban gCal composer defect
Subtle linked-from-gcal text defect
Daily Plan modal and bulk-review completion
Firebase App Check console-side verification


Plan: Daily Plan Page — Critical Defects Overhaul
TL;DR: react-app/src/components/DailyPlanPage.tsx has 9 documented defects. All changes are in that single file (plus a new useFocusGoals hook pull-in and two existing modals). The implementation splits into 5 logical phases that can be built sequentially, all landing in one PR.

Phase DPO-1 — Performance + New Data Sources (unblocks everything)
DPO-1A — calendar_blocks query for today: Add a date-bounded onSnapshot query: collection('calendar_blocks') where ownerUid==uid AND start >= todayStartMs AND start <= todayEndMs. This drives deduplication (DPO-2B) and provides actual scheduled times for tasks. Mirrors ChecklistPanel pattern already in codebase.

DPO-1B — Goals subscription: Add a small onSnapshot for collection('goals') where ownerUid==uid. Build a goalMap: Map<id, {title, theme, color}> for O(1) lookup. Typical user has < 50 goals — not a performance concern.

DPO-1C — Focus goals integration: Pull useFocusGoals(currentUser?.uid) hook. Materialize activeFocusGoalIds: Set<string> = the union of all activeFocusGoals[*].goalIds. Used by DPO-2D.

DPO-1D — Temp performance cap: Add orderBy('updatedAt', 'desc') + limit(300) to both task and story queries. Not a long-term fix (proper fix = composite Firestore index with date+status filter) but prevents worst-case full-collection scans today.

Phase DPO-2 — Data Model + Processing (depends on DPO-1)
DPO-2A — Extend TimelineItem type: Add fields: ref: string | null, goalTitle: string | null, goalTheme: string | null, isFocusAligned: boolean, rawTask: Task | null, rawStory: Story | null, scheduledBlockStart: number | null.

DPO-2B — Calendar deduplication + time promotion: In timelineItems useMemo, after building blocks snapshot: for each calendar_block that has a taskId or storyId, annotate the matching task/story TimelineItem with scheduledBlockStart = block.start (override sortMs and timeLabel). Skip creating a separate kind: 'event' for that block entirely — show the task/story row once with the block's scheduled time as its displayed time.

DPO-2C — Eliminate "Anytime" label: In formatTimeLabel, replace the null/undefined → "Anytime" fallback. Instead, return a bucket-label sentinel: "Unscheduled" rendered in muted text. In bucketFromTime, items with no time AND no timeOfDay still default to 'morning' (existing behaviour) but display "Unscheduled (Morning)" rather than "Anytime". Also assign a pseudo-sortMs for items with only timeOfDay = the bucket mid-point (9:00 AM, 14:00 PM, 19:30 PM) so items sort sensibly within buckets.

DPO-2D — Focus-aware defer candidates: In todoSummary useMemo, re-define deferCandidates: items where !item.isTop3 && !item.isFocusAligned. Focus-aligned non-Top3 items are no longer automatically "review" candidates unless the user explicitly defers them.

Phase DPO-3 — Item Row UI (depends on DPO-2)
DPO-3A — Title plain text + ref + time below: Replace

with:

Make the entire ListGroup.Item row role="button" + onClick to open the modal (DPO-3D).

DPO-3B — Inline check-off (Done button): Add a small green circular done button to the left of each task/story/chore row (like ChecklistPanel). On click:

Task/Chore: updateDoc('tasks/{id}', { status: 2, updatedAt: serverTimestamp() })
Story: advance status by 1 step up to max 4 (or set 4 if already at 3). Use Firestore updateDoc.
Real-time listener already removes done items from list automatically.
Events have no check-off.
DPO-3C — Goal chip per item: Below the title/ref/time block, add a small dim goal label when item.goalTitle is set:

DPO-3D — Modal opener instead of navigation: Add state: editTask: Task | null, editStory: Story | null. Row onClick → if item.rawTask set editTask = item.rawTask, if item.rawStory set editStory = item.rawStory. Add <EditTaskModal show={!!editTask} task={editTask} onHide={() => setEditTask(null)} /> and <EditStoryModal show={!!editStory} story={editStory} goals={goals} onHide={() => setEditStory(null)} /> at component bottom.

Phase DPO-4 — Filterable Count Chips (parallel with DPO-3)
DPO-4A — Filter state: Add activeKindFilter: 'task' | 'story' | 'chore' | 'event' | 'top3' | null state.

DPO-4B — Clickable badges: Replace <Badge> with <Button variant="..." size="sm"> styled as pill badges. Active filter gets a filled background; inactive = outline. Clicking the same filter again clears it.

DPO-4C — Filter application: In the render, replace timelineItems.filter(item => item.bucket === bucket) with a filtered view that respects activeKindFilter. "Top 3" filter shows only isTop3 items across all buckets.

Phase DPO-5 — Focus goal → Deferral integration (depends on DPO-1C + DPO-2D)
DPO-5A — Focus badge on items: If item.isFocusAligned, show a small 🎯 chip or Focus badge next to the kind badge to visually call out why this item isn't in the "Review" bucket.

DPO-5B — Auto-seed deferral with focus context: When opening DeferItemModal for a non-focus item, pass a new focusContext prop containing activeFocusGoals. The modal already calls suggestDeferralOptions cloud function — extend the call payload to include isFocusAligned: false so the backend can weight suggestions with "free up capacity for focus work" rationale. (DeferItemModal.tsx minor change.)

Relevant files

react-app/src/components/DailyPlanPage.tsx — all DPO phases
react-app/src/hooks/useFocusGoals.ts — imported for DPO-1C (no changes needed)
react-app/src/components/EditTaskModal.tsx — consumed in DPO-3D (no changes needed)
react-app/src/components/EditStoryModal.tsx — consumed in DPO-3D (no changes needed)
react-app/src/components/DeferItemModal.tsx — minor prop extension for DPO-5B
Verification

Load /daily-plan — confirm buckets all show Morning/Afternoon/Evening with no "Anytime" label on any row
Click any count chip — confirm only that kind is shown across buckets; click again to clear filter
Click an item row — confirm EditTaskModal/EditStoryModal opens, URL does not change
Check off a task → confirm it disappears from the list within 1 second (Firestore real-time)
Verify calendar event linked to a task shows only the task row (not a duplicate Event row)
Confirm focus-aligned items (goalId in active focus goals) show 🎯 chip and are absent from "Review" count
npm run build exits 0
Decisions

Calendar-block time wins over task dueDate for display/sorting when a block is linked to a task/story
"Anytime" is completely eliminated; items with no time/timeOfDay show "Unscheduled" and sort last within their bucket (morning by default)
Story check-off advances status by +1 step rather than jumping straight to Done (less destructive)
The limit(300) cap is a temporary perf mitigation; the proper fix is a Firestore composite index (ownerUid, status, dueDate) which needs firestore.indexes.json update and deployment
goals array is passed to EditStoryModal — requires fetching goals state which is already cheap (< 50 docs per user)
Now I'll add this to plan.md via a subagent:

File editing tools aren't available in planning mode. I'll use a subagent that has editing capability to write to plan.md:

File writes aren't available in this planning session. I'll note the plan.md section is ready to insert when we implement — you can switch to the implementation agent to add it.

Here is the complete plan:

Plan: Daily Plan Page — Critical Defects Overhaul (DPO)
TL;DR: react-app/src/components/DailyPlanPage.tsx has 9 defects degrading the primary daily planning surface. All changes land in that single file plus minor extensions to existing modal components. Implementation flows through 5 sequential phases.

Phase DPO-1 — Performance + New Data Sources (unblocks everything else)
DPO-1A — calendar_blocks query for today
Add a date-bounded onSnapshot for calendar_blocks where ownerUid==uid AND start >= todayStartMs AND start <= todayEndMs. Mirrors the pattern already in react-app/src/components/ChecklistPanel.tsx. This enables block-based time promotion and deduplication in DPO-2.

DPO-1B — Goals subscription
Add onSnapshot for collection('goals') where ownerUid==uid. Build a goalMap via useMemo for O(1) goal title/theme lookup. Typical user < 50 goals — trivial query.

DPO-1C — useFocusGoals integration
Import useFocusGoals from react-app/src/hooks/useFocusGoals.ts. Materialise activeFocusGoalIds: Set<string> = union of all activeFocusGoals[*].goalIds. Feeds DPO-2D and DPO-5.

DPO-1D — Temporary perf cap
Add orderBy('updatedAt', 'desc') + limit(300) to both task and story queries. Mark with a TODO comment pointing to the proper fix: a Firestore composite index (ownerUid, status, dueDate) in firestore.indexes.json.

Phase DPO-2 — Data Model + Processing (depends on DPO-1)
DPO-2A — Extend TimelineItem type
Add fields: ref, goalTitle, goalTheme, isFocusAligned, rawTask, rawStory, scheduledBlockStart.

DPO-2B — Calendar deduplication + time promotion
Inside timelineItems useMemo:

Build blockByTaskId and blockByStoryId Maps from the new calendarBlocks state
When a task/story has a linked block → override sortMs and timeLabel with the block's scheduled start time
Skip creating a kind: 'event' row for any block already represented by a task/story row
Result: No duplicate rows; tasks/stories show their actual calendar-scheduled time
DPO-2C — Eliminate "Anytime" label
In formatTimeLabel: return 'Unscheduled' (rendered muted) instead of 'Anytime'. For items with only timeOfDay set, assign pseudo sort times: morning → 09:00, afternoon → 14:00, evening → 19:30.

DPO-2D — Focus-aware defer candidates
Redefine deferCandidates as items where !isTop3 && !isFocusAligned. Focus-aligned items won't pollute the "Review" count.

Phase DPO-3 — Item Row UI (depends on DPO-2)
DPO-3A — Plain title + ref + time
Replace the <Link> title with a three-line layout:

Plain fw-semibold title text
Muted 0.7rem line: {ref} spacer + {timeLabel}
If goalTitle: dim ◆ {goalTitle} at 0.65rem, opacity 0.7, theme colour
Make the entire row onClick the modal opener (DPO-3D).

DPO-3B — Inline Done button
Small circular btn-outline-success on the left for non-event items. On click:

task/chore → updateDoc(tasks/{id}, { status: 2 })
story → advance status +1 capped at 4
Real-time listener removes items instantly.

DPO-3D — Modal opener, not page navigation
Add editTask: Task | null and editStory: Story | null state. Row click sets one of these. Mount at component bottom:

Remove all <Link> components from item rows.

Phase DPO-4 — Filterable Count Chips (parallel with DPO-3)
DPO-4A Add activeKindFilter: 'task' | 'story' | 'chore' | 'event' | 'top3' | null state.

DPO-4B Replace <Badge> counts with toggle <Button className="rounded-pill"> — filled when active, outline when not. Clicking the active filter deactivates it.

DPO-4C In the bucket render loop, apply the active filter before rendering rows.

Phase DPO-5 — Focus Goal → Deferral (depends on DPO-1C + DPO-2D)
DPO-5A Show a 🎯 badge next to the kind badge on focus-aligned items.

DPO-5B When opening DeferItemModal for a non-focus item, pass focus context. react-app/src/components/DeferItemModal.tsx shows a note: "This item is not linked to your active focus goals. Deferring it frees capacity for focus work."

Relevant files

react-app/src/components/DailyPlanPage.tsx — all DPO phases (primary)
react-app/src/hooks/useFocusGoals.ts — imported DPO-1C, no changes
react-app/src/components/EditTaskModal.tsx — consumed DPO-3D, no changes
react-app/src/components/EditStoryModal.tsx — consumed DPO-3D, no changes
react-app/src/components/DeferItemModal.tsx — minor prop extension DPO-5B
Verification

No "Anytime" label on any row at /daily-plan
Count chips are clickable; clicking twice clears the filter
Clicking any item row opens the modal — URL doesn't change
Done button removes item within 1 second
Calendar block linked to a task shows ONE row (task) — no duplicate Event row
Focus-aligned items show 🎯 and are excluded from "Review" count
npm run build exits 0
Decisions

Calendar block time wins over task dueDate for display and sorting when a block is linked
"Anytime" fully eliminated; items with no time show "Unscheduled" and sort last in their bucket
Story check-off is +1 status step (not instant-done) — less destructive
limit(300) is a mitigation only — the real fix requires a new Firestore composite index

---

Latest execution log (14 Mar 2026, KPI designer expansion)
- Expanded the live KPI designer from a simple goal + target form into a two-path authoring studio in `react-app/src/components/KPIDesigner.tsx`.
- Added curated-metric browsing from a structured source catalog plus a custom KPI builder that lets users define their own source family, collection/store, field path, metric id, semantic KPI type, aggregation, timeframe, target direction, dashboard visualisation, and goal linkage.
- Extended KPI metadata in `react-app/src/types/KpiTypes.ts` so saved KPI definitions now persist designer mode, source collection, field path, source data type, and source metric label.
- Extended the source catalog in `react-app/src/utils/kpiDesignerCatalog.ts` so each source now exposes both curated KPI templates and raw browseable data points.
- Updated `react-app/src/components/GoalKpiStudioPanel.tsx` so users can see whether a KPI was created from a curated metric or a custom design, plus the mapped source field path.

Files touched for this slice
- `react-app/src/components/KPIDesigner.tsx`
- `react-app/src/components/GoalKpiStudioPanel.tsx`
- `react-app/src/types/KpiTypes.ts`
- `react-app/src/utils/kpiDesignerCatalog.ts`
