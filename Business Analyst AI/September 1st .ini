BOB – t (v3.1.1 → v3.4)Scafoldring 
A) Core Platform (carry forward from earlier versions)

PLAT-01 Sprint Planner (2-D)
	•	Columns = Sprints; Rows = Theme → Goal → Subgoal.
	•	Cells contain Stories.
	•	Drag-and-drop supported vertically, horizontally, and within cells.

PLAT-02 Current Sprint Kanban
	•	Kanban lanes from profiles.kanbanLaneLabels.
	•	Story card expands to inline task subgrid for quick edit.

PLAT-03 Calendar Blocking & AI Scheduling
	•	Week/Day calendar grid (Google Calendar style).
	•	Bidirectional sync with Google Calendar.
	•	Block fields: storyId?, goalId?, habitId?, subTheme?, googleEventId?, themeId?, isAiGenerated?.

PLAT-04 Daily LLM Digest (06:30)
	•	Email with tasks due, focus stories, today’s calendar blocks, sprint velocity pulse, and narrative summary.

PLAT-05 Health & Nutrition Integrations
	•	Strava, Runna, MyFitnessPal.
	•	Nightly ingestion of metrics.
	•	Dashboards for HRV, workouts, nutrition adherence.

PLAT-06 iOS Reminders Two-Way Sync
	•	reminderId on tasks.
	•	Sync create/update/complete across systems.
	•	Preserve TASK-### identifiers.

PLAT-07 Mobile “Important Now” View
	•	Surfaces overdue, due today, high-importance, and current sprint tasks.
	•	Habits checklist strip with streak badge.

PLAT-08 Selenium CI + Side-door Auth
	•	test_login_tokens collection.
	•	/test-login?token= endpoint (non-prod only).
	•	Enables automated testing without OAuth.

PLAT-09 Theme Colour Inheritance
	•	All entities inherit their theme’s colour.
	•	Colours from theme_settings.
	•	Enforce AA contrast.

PLAT-10 Pragmatic Drag & Drop
	•	Fractional ranks.
	•	Keyboard + touch support.
	•	Undo toast.
	•	Safe for large datasets (virtualisation).

PLAT-11 Enhanced Logging & Telemetry
	•	?debug=db Dev Console Drawer.
	•	Structured logs for read/write/update/delete and listener events.
	•	Optional audit_logs collection in staging.

PLAT-12 Routines & Chores
	•	routines, routine_items, routine_logs.
	•	Supports recurrence.
	•	Streak tracking.
	•	Optional link to calendar blocks.

⸻

B) v3.4 Feature Requirements

FTR-01 CRUD Parity Across All Entities
	•	Full CRUD for Goals, Stories, Tasks, and Sprints in modern table views.
	•	Inline editing with Enter-to-save.
	•	Optimistic UI.
	•	Undo toast on update.

FTR-02 UI Mock Plan (Scaffold First)
	•	Global nav routes for:
	•	Goals (Table, Cards, Visualization)
	•	Stories (Table)
	•	Tasks (Table)
	•	Sprints (Kanban, Planner)
	•	Calendar (Week, Day)
	•	Routines
	•	Analytics (Activity Stream, Time Allocation)
	•	Settings (Theme, Integrations)
	•	Side-panels on all entities with tabs: Details, Activity, Comments.
	•	Build mocks with dummy data first; wire Firestore after approval.

FTR-03 Goal Visualization (Roadmap Timeline)
	•	Timeline grid with calendar dates + sprint markers.
	•	Goal bars (start → end), colour-coded by theme.
	•	Under each Goal: Stories table + Tasks table (both inline editable).
	•	Drag Goal to shift dates; cascade planned sprints for Stories.
	•	Confirmation modal if ≥3 Stories would change sprint.
	•	Side-panel shows Goal details, linked Stories, linked Tasks, Activity, and Comments.
	•	Printable (A3) and shareable (read-only link).
	•	Deep-linkable from nav.
	•	All changes logged in Activity Stream (canonical ref, no undefineds).

FTR-04 Goals Table – “Time Allocated This Week”
	•	New columns:
	•	Allocated (hrs) – total hours this week, with tooltip breakdown (direct/story-linked/habit-linked, subthemes).
	•	This Week % – percent of week/work hours allocated; progress bar + tooltip.
	•	Side-panel weekly breakdown calendar for selected Goal.
	•	Quick actions on blocks: reassign to Story, convert to Goal-level, edit subTheme, split.
	•	Filters: Theme, Subtheme, Allocated > X hours, “Show only Goals with time”.
	•	Performance: render ≤1.5s; updates ≤3s.

⸻

C) Activity Stream & Telemetry

ACT-01 Canonical Field Naming
	•	Use ref as canonical.
	•	Dual-write referenceNumber=ref during transition.

ACT-02 Activity Builder + Schema Validation
	•	Shared utility for building payloads.
	•	Enforce no undefined fields (zod or equivalent).

ACT-03 Event Coverage
	•	Must log:
	•	goal_viewed
	•	goal_dates_changed
	•	bulk_story_sprint_reassigned
	•	story_sprint_changed
	•	story_inline_edit_saved
	•	task_inline_edit_saved
	•	visualization_shared_link_created
	•	visualization_printed

ACT-04 Log Hygiene
	•	Debounce duplicate view writes.
	•	Throttle identical error logs within 5s.

⸻

D) Schema / Index / Rules

SCH-01 Stories
	•	Fields: ref, goalId, subGoalId?, sprintId?, plannedSprintId?, rank?, rankByLane?, rankByCell?, dragLockVersion?, themeId?, taskCount?, doneTaskCount?.

SCH-02 Tasks
	•	Fields: importanceScore?, isImportant?, reminderId?, rank?.

SCH-03 Sprints
	•	Fields: ref, objective?, status, notes?, startDate, endDate, orderIndex|rank.

SCH-04 Calendar Blocks
	•	Fields: storyId?, goalId? (new), habitId?, subTheme?, googleEventId?, isAiGenerated?, conflictVersion?, supersededBy?, themeId?, durationMinutes? (new).

SCH-05 Theme Settings / UI State
	•	theme_settings (themes, defaultThemeId, highContrastMode).
	•	ui_state (plannerRowExpansion, plannerVisibleSprints, vizZoomLevel, vizVisibleThemes[], vizCollapsedGoals[]).

SCH-06 Weekly Goal Rollups
	•	weekly_goal_time:
	•	{ ownerUid, weekStartISO, goalId, minutes, breakdown { themeId?, subTheme?, sources { direct, storyLinked, habitLinked } }, blockCount, updatedAt }.

SCH-07 Routines & Audit Logs
	•	routines, routine_items, routine_logs.
	•	audit_logs (staging only).

IDX-01 Indexes
	•	Goals: (ownerUid, themeId, startDate, endDate)
	•	Stories: (ownerUid, goalId, plannedSprintId)
	•	Calendar Blocks: (ownerUid, start, end), (ownerUid, goalId)
	•	Weekly Goal Time: (ownerUid, weekStartISO, goalId)
	•	Sprints: (ownerUid, status, startDate), (ownerUid, rank)

SEC-01 Security
	•	Owner-only access for new collections.
	•	Deny test_login_tokens in production.
	•	Validate ownership of googleEventId.
	•	Visualization share links are read-only with scoped filters.

⸻

E) Performance & Accessibility

PERF-01 Load ≤3s for 100+ Goals, 600+ Stories, 2k+ Tasks.
PERF-02 Drag-and-drop latency ≤200ms; write acknowledgement ≤250ms.
A11Y-01 Full keyboard DnD parity; ARIA roles/labels; WCAG AA colour contrast.

⸻

F) Testing & CI

TST-01 Unit
	•	Activity payload validation and fallback ref.
	•	Rank math.
	•	Date → sprint mapping.
	•	Enter-to-save.

TST-02 Integration
	•	CRUD emits activity events.
	•	Listeners log lifecycle events.
	•	Allocation rollups update Goals table.
	•	Visualization drag triggers confirmation modal and batch update.

TST-03 End-to-End
	•	CRUD across Table / Kanban / Planner.
	•	Inline edits save on Enter.
	•	Calendar block CRUD (direct + Story) with Google sync round-trip.
	•	Visualization drag + confirm.
	•	Share + print flows.

TST-04 Perf & A11y
	•	Performance budgets enforced.
	•	Keyboard flows tested in CI.

⸻

G) UI Mock Plan

UIM-01 Register routes/pages:
	•	Goals (Table, Cards, Visualization), Stories (Table), Tasks (Table), Sprints (Kanban, Planner), Calendar (Week/Day), Routines, Analytics (Activity, Time), Settings (Theme, Integrations).

UIM-02 Side-panels: Details, Activity, Comments tabs on all entities.

UIM-03 Modern tables: virtualized, inline editing, Enter-to-save stubs.

UIM-04 Boards/Planner: mock drag-and-drop with dummy data.

UIM-05 Calendar: mock Week/Day grid with block editor dialog.

UIM-06 Goal Visualization: mock timeline, goal bars, sprint markers, tables, confirmation modal, share/print actions.

UIM-07 Dev Console Drawer (?debug=db) for structured logs.