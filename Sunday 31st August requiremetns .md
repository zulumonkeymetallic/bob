Here’s a single, merged, handoff-ready file that combines your v3.0.2 Priority Requirements & Schema Deltas with the critical addenda (theme colour inheritance + corrected Sprint Planner layout). I’ve kept your original structure and language, and folded in the new requirements, schema deltas, acceptance criteria, tests, and migration notes.

—

📘 BOB – Consolidated Priority Requirements & Schema Deltas (v3.0.6 Handoff)

Owner: Jim Donnelly
Date: August 31, 2025
Audience: Development AI / Coding Team
Purpose: Merge v3.0.2 handoff with critical addenda to deliver an authoritative, implementation-ready specification for BOB’s near-term releases (v3.0.6 baseline), including system-wide theme colour inheritance and a corrected 2-D Sprint Planner (vertical swimlanes per sprint; horizontal by Theme→Goal→Subgoal).

⸻

1. Executive Context

The BOB platform is a personal productivity system built on Firebase Firestore, integrating goals, stories, tasks, sprints, and habits with AI-assisted scheduling and cross-device integrations.

The current schema (v3.0.1) is strong, but several priority gaps remain. These gaps prevent us from delivering the most critical functionality:
	1.	Sprint Planning & Maintenance (future sprint visualisation).
	2.	Current Sprint Kanban (execution focus).
	3.	Calendar Blocking & AI Scheduling.
	4.	Daily LLM Email Digest.
	5.	Health & Nutrition Integrations (Strava, Runna, MyFitnessPal).
	6.	iOS Reminders Two-Way Sync.
	7.	Mobile View (surface urgent tasks).
	8.	Test Automation with Side-Door Auth.
	9.	NEW (Critical): System-wide Theme Colour Inheritance from Theme Settings.
	10.	NEW (Critical): Sprint Planner must render vertical swimlanes per sprint and horizontal groupings by Theme→Goal→Subgoal with cell-level story ordering.

This document consolidates the requirements and schema deltas into a single, robust specification.

⸻

2. Priority Requirements

2.1 Sprint Planning & Maintenance (Future Planning) — Updated to 2-D Matrix

Goal: Provide a two-dimensional planner to manage backlog and assign stories into current and upcoming sprints.

Layout:
	•	Vertical (columns): One column per Sprint (active + N future), reorderable.
	•	Horizontal (rows): Grouped by Theme → Goal → Subgoal (expand/collapse rows).
	•	Cells: Each intersection holds Story cards belonging to that Goal/Subgoal in that Sprint.

UI & Interactions:
	•	Drag & Drop:
	•	Vertical move: Changes stories.sprintId.
	•	Horizontal move: Changes stories.goalId and optionally stories.subGoalId.
	•	In-cell ordering: Maintain stable order per sprint via stories.orderIndexBySprint[sprintId].
	•	Reordering:
	•	Sprints: User can reorder sprint columns; persist to sprints.orderIndex.
	•	Stories within a cell: Update orderIndexBySprint[currentSprintId] immediately.
	•	Sprint Creation/Edit: Inline modal with ref (SPR-###), name, objective, status (planned|active|closed), notes, startDate, endDate.
	•	Row Controls: Expand/collapse Theme/Goal/Subgoal; persist per user in ui_state.plannerRowExpansion.
	•	Custom Lanes (Kanban labels): Users can rename column lanes for status views; persist in profiles.kanbanLaneLabels (used by 2.2).

Activity Logging:
	•	Write to activity_stream with activityType:
	•	sprint_changed (vertical move),
	•	backlog_retargeted (row move),
	•	reordered_in_cell (in-cell reorder).

Acceptance Criteria:
	•	Vertical columns are Sprints; rows are Theme → Goal → Subgoal.
	•	DnD updates persist with optimistic UI (<150–200ms).
	•	Sprint ref numbers auto-generate unique (SPR-###).
	•	Row expansion and visible sprint set are remembered per user.
	•	Rendering performance: 200 stories × 8 sprints maintains smooth drag/drop.

⸻

2.2 Current Sprint Kanban (Execution View)

Goal: Run the current sprint effectively.

UI & Interactions:
	•	Sprint Selector: Dropdown (defaults to current sprint).
	•	Columns: Kanban lanes from profiles.kanbanLaneLabels.
	•	Story Cards: Click expands an inline task subgrid (Excel-like) to quick-edit tasks (status, dueDate, priority).
	•	Drag & Drop: Move stories between columns (status transitions).

Acceptance Criteria:
	•	Sprint switch reloads < 500ms.
	•	Inline task edits persist instantly.
	•	Denormalised fields (taskCount, doneTaskCount) keep progress visible without expensive queries.

⸻

2.3 Calendar Blocking & AI Scheduling

Goal: Allow users to block time by theme/subtheme; AI dynamically fills remaining free space with tasks, stories, and habits.
Google Calendar: Bidirectional sync via googleEventId.

Data Model Changes (see §3):
	•	Extend calendar_blocks with storyId?, habitId?, subTheme?, googleEventId?, isAiGenerated?, conflictVersion?, supersededBy?.

Behaviour:
	1.	User defines recurring or static blocks (e.g., Thu 19:00–21:00 for Home/Chores).
	2.	AI fills unblocked time based on:
	•	Task importance (importanceScore),
	•	Due dates,
	•	Weekly theme targets (profiles.weeklyThemeTargets),
	•	Recovery constraints (profiles.maxHiSessionsPerWeek, minRecoveryGapHours),
	•	Theme colour resolution (see §2.9, §3.1).
	3.	Blocks sync with Google Calendar (googleEventId); event description includes deep links back to BOB entities (ref).

Acceptance Criteria:
	•	AI scheduling respects quiet hours/facility hours.
	•	Conflicts resolved with conflictVersion/supersededBy.
	•	Bidirectional sync: Manual edits in Google reflect back in BOB.

⸻

2.4 Daily LLM Email Digest

Goal: Deliver a daily 06:30 email summarising priorities.

Content:
	•	Tasks Due Today (Ref, Title, Goal, Due, Priority),
	•	Focus Stories (top N by points/priority),
	•	Today’s Calendar Blocks,
	•	Sprint Pulse (velocity snapshot),
	•	LLM narrative: “what first, risks.”

Data Model: New digests collection.

Acceptance Criteria:
	•	Mobile-friendly HTML; links to /story/STRY-### or /task/TASK-###.
	•	Data reflects live DB at generation time.

⸻

2.5 Health & Nutrition Integrations

Goal: Import metrics (Strava, Runna, MyFitnessPal) for smarter planning.

Data Model:
	•	Per-user integrations document (OAuth tokens/meta).
	•	New collections: metrics_hrv, metrics_workouts, metrics_nutrition.

Planning:
	•	Avoid HI sessions when HRV is low.
	•	Nutrition dashboards—adherence vs protein/calories.
	•	Runna workouts appear in Calendar as read-only events.

Acceptance Criteria:
	•	Tokens are server-side secure.
	•	Nightly ingestion.
	•	7/30-day dashboards.

⸻

2.6 iOS Reminders Two-Way Sync

Goal: Keep BOB tasks in sync with Apple Reminders.

Data Model: Add reminderId to tasks.

Behaviour:
	•	Create/update/complete in one system syncs to the other within 60s.
	•	Conflict: latest edit wins.
	•	Changes logged in activity_stream.
	•	Preserve TASK-### in Reminders title/notes.

Acceptance Criteria:
	•	Deletions handled gracefully.
	•	Round-trip integrity maintained.

⸻

2.7 Mobile View (Surface Important First)

Goal: Mobile home is hyper-focused.

Behaviour:
	•	“Important Now”: Overdue, Due today, High importanceScore, Current sprint tasks.
	•	Habits checklist strip (streak badge).
	•	One-tap complete/defer (+ Reminders sync if linked).

Data Model:
	•	Tasks gain importanceScore (0–100), isImportant.

Acceptance Criteria:
	•	Loads < 1s.
	•	One-tap actions persist.
	•	Syncs with Reminders when linked.

⸻

2.8 Test Automation (Selenium + Side-Door Auth)

Goal: Enable automated testing without OAuth friction.

Data Model:
	•	Non-prod test_login_tokens: { token, uid, expiresAt, scope }.

Behaviour:
	•	/test-login?token= maps token→uid (disabled in prod).

Acceptance Criteria:
	•	Selenium can run full CRUD, drag/drop, digest gen, calendar sync in CI.
	•	Full run < 10 minutes with artifacts.

⸻

2.9 NEW: Theme Colour Inheritance (System-wide)

Goal: All Goals, Stories, Tasks, Habits, Sprints, Calendar Blocks, and Widgets inherit the colour defined in Theme Settings. Visual identity is consistent across web/mobile, Kanban, tables, chips, calendar events, and progress bars.

Behaviour & UX:
	•	Single Source of Truth: User’s theme_settings define theme palette.
	•	Inheritance:
	•	If entity has themeId, use it.
	•	Else inherit from parent (Task → Story → Goal chain).
	•	Else fallback to theme_settings.defaultThemeId.
	•	No blanket hex persistence: Colours resolved at render.
	•	AA Contrast: Auto compute foreground text colour to meet WCAG AA in both light & dark modes.
	•	Optional non-destructive view overrides: high-contrast toggle does not persist to DB.

Acceptance Criteria:
	•	Changing a theme colour in Settings updates all views without data writes.
	•	AA contrast satisfied in CI checks.
	•	Calendar events render with resolved colour, and GCal sync reflects mapping.

⸻

3. Schema Deltas (v3.0.1 → v3.0.6)

3.1 New or Changed Fields
	•	All entities: ref: string (unique, prefixed).
	•	Stories:
	•	taskCount?: number, doneTaskCount?: number (denormalised),
	•	sprintId?: string,
	•	goalId: string,
	•	subGoalId?: string (new),
	•	orderIndexBySprint?: { [sprintId: string]: number } (new),
	•	themeId?: string (new, for explicit override).
	•	Sprints:
	•	ref, objective?, status: 'planned'|'active'|'closed', notes?, startDate, endDate,
	•	orderIndex: number (new),
	•	createdAt, updatedAt.
	•	CalendarBlock:
	•	storyId?, habitId?, subTheme?,
	•	googleEventId? (new),
	•	isAiGenerated?: boolean (new),
	•	conflictVersion?: number, supersededBy?: string,
	•	themeId?: string (new).
	•	Tasks:
	•	importanceScore?, isImportant?, reminderId?,
	•	(optional future) aiCalculatedImportance?, recurringPattern?.
	•	Profiles/Habits:
	•	Integration IDs (stravaAthleteId, runnaPlanId, mfpUserId),
	•	weeklyThemeTargets (map),
	•	Recovery constraints (maxHiSessionsPerWeek, minRecoveryGapHours),
	•	kanbanLaneLabels (string[]).
	•	Theme Settings (per user) – NEW:
	•	themes[]: { id, name, colorHex, colorToken?, isDefault? },
	•	defaultThemeId: string,
	•	highContrastMode: boolean.
	•	UI State (per user) – NEW:
	•	plannerRowExpansion: { [key: string]: boolean },
	•	plannerVisibleSprints: string[].
	•	Sub-Goals – NEW (collection or nested):
	•	{ id, goalId, title, description?, orderIndex }.

3.2 New Collections
	•	digests
	•	metrics_hrv, metrics_workouts, metrics_nutrition
	•	test_login_tokens
	•	sub_goals (if not nested under goals)
	•	theme_settings (per user)
	•	ui_state (per user)
	•	taxonomies (optional central theme/subtheme mapping)

3.3 Indexes
	•	Stories: (ownerUid, sprintId, status), (ownerUid, goalId, orderIndex), (ownerUid, goalId, subGoalId), (ownerUid, sprintId, updatedAt)
	•	Tasks: (ownerUid, parentId, status, dueDate), (ownerUid, isImportant, dueDate)
	•	Calendar Blocks: (ownerUid, start, end)
	•	Sprints: (ownerUid, status, startDate), (ownerUid, orderIndex)

3.4 Security Rules
	•	Owner-based rules for all new collections.
	•	Explicit deny for test_login_tokens in production.
	•	theme_settings, ui_state readable/writable by owner only.
	•	Calendar sync endpoints VERIFY ownership of googleEventId mapping.

⸻

4. Non-Functional Requirements
	•	Performance: DnD perceived <150ms via optimistic UI; matrix planner remains responsive under 200 stories × 8 sprints.
	•	Accessibility: Theme colour and foreground must meet WCAG AA; keyboard DnD supported; ARIA roles on matrix/kanban.
	•	Observability: Log digest generation times, calendar sync failures, integration webhook errors.
	•	Feature Flags: Incremental rollout for Sprint Planner 2-D, Calendar AI, Digest, Reminders sync, Theme inheritance.
	•	Resilience: Clear conflict handling for calendar (conflictVersion/supersededBy).

⸻

5. Testing & CI (Expanded)

Unit:
	•	useThemeColor resolution: explicit, inherited, default; AA contrast util.
	•	Story state transitions (sprint change, goal/subgoal change, in-cell re-order).

Integration:
	•	Calendar Block creation → GCal sync (round-trip googleEventId).
	•	Reminders sync (create/update/complete/delete, latest-wins).
	•	Digest generation pulls correct live data.

E2E (Selenium, side-door auth):
	•	Goal → Story → Task → Sprint workflow.
	•	2-D Planner DnD: vertical, horizontal, in-cell reorder; persistence of row expansion & visible sprints.
	•	Current Sprint Kanban task subgrid inline edits.
	•	Mobile “Important Now” (one-tap complete/defer; Reminders sync).

Performance:
	•	Page load < 3s; DnD < 500ms perceived; large dataset handling.

Accessibility:
	•	Keyboard-only DnD success; screen reader live announcements; colour contrast checks in CI.

⸻

6. Migration Notes
	1.	Themes:

	•	If goals.theme string exists, create theme_settings.themes[] palette and map to goals.themeId.
	•	Set theme_settings.defaultThemeId to user’s most common theme or “Home”.

	2.	Sprints:

	•	Backfill sprints.orderIndex sorted by (status desc, startDate asc).

	3.	Stories:

	•	Initialise orderIndexBySprint[sprintId] by creation time within that sprint.

	4.	Sub-Goals:

	•	If sub-goals are currently implicit, create sub_goals and link from stories as needed.

	5.	Indexes & Rules:

	•	Deploy new indexes before enabling features; update security rules atomically.

⸻

7. Developer Tasks (Backlog → v3.0.6)
	1.	Implement theme_settings + useThemeColor hook; replace ad-hoc colour usage in ModernGoalsTable, CurrentSprintKanban, SprintPlanner, Calendar, MobileView.
	2.	Refactor Sprint Planner to 2-D matrix (columns=Sprints; rows=Theme→Goal→Subgoal; cells=Stories).
	3.	Add sub_goals support and row hierarchy with persisted expansion state (ui_state).
	4.	Introduce stories.orderIndexBySprint and sprints.orderIndex.
	5.	Update calendar sync to honour theme colour mapping and round-trip googleEventId.
	6.	Expand Selenium suite to cover matrix DnD, colour inheritance, and mobile “Important Now”.

⸻

8. Handoff Checklist
	•	Schema v3.0.6 deltas implemented (incl. theme_settings, ui_state, sub_goals, orderIndexBySprint, googleEventId).
	•	Security rules updated (owner-only, deny test tokens in prod).
	•	Indexes created and verified.
	•	CI: headless Selenium with side-door auth; AA contrast checks.
	•	Daily digest scheduler running and templated.
	•	Google Calendar credentials configured; bidirectional sync verified.
	•	iOS Reminders sync operational.
	•	Mobile “Important Now” view live with one-tap actions.
	•	Theme colour inheritance verified across web/mobile & calendar.
	•	Sprint Planner 2-D matrix live with persisted states.

⸻

9. Conclusion

This consolidated handoff merges the original v3.0.2 requirements with the critical addenda. It delivers a precise, unambiguous spec for:
	•	Correct 2-D Sprint Planner (vertical sprints × horizontal Theme→Goal→Subgoal),
	•	System-wide theme colour inheritance driven by Theme Settings with AA compliance,
	•	Calendar AI and GCal bidirectional sync,
	•	Digest, integrations, Reminders sync, Mobile “Important Now”, and CI test automation.

It is ready to hand directly to a coding AI or development team. No external context is required.