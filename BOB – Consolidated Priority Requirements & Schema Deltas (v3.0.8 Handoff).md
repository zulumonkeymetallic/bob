
📘 BOB – Consolidated Priority Requirements & Schema Deltas (v3.0.8 Handoff)

Owner: Jim Donnelly
Date: August 31, 2025
Audience: Development AI / Coding Team
Purpose: Authoritative, implementation-ready spec merging v3.0.2 with critical addenda (theme colour inheritance, corrected 2-D Sprint Planner) and the platform-wide Pragmatic Drag & Drop refactor for all tables and kanbans.

⸻

1. Executive Context

The BOB platform is a personal productivity system built on Firebase Firestore, integrating goals, stories, tasks, sprints, and habits with AI-assisted scheduling and cross-device integrations.

Priority gaps to close:
	1.	Sprint Planning & Maintenance (future sprint visualisation).
	2.	Current Sprint Kanban (execution focus).
	3.	Calendar Blocking & AI Scheduling (with Google Calendar bidirectional sync).
	4.	Daily LLM Email Digest.
	5.	Health & Nutrition Integrations (Strava, Runna, MyFitnessPal).
	6.	iOS Reminders Two-Way Sync.
	7.	Mobile View (surface urgent tasks).
	8.	Test Automation with Side-Door Auth.
	9.	System-wide Theme Colour Inheritance from Theme Settings.
	10.	Sprint Planner as a 2-D matrix: vertical swimlanes per sprint, horizontal by Theme→Goal→Subgoal.
	11.	Pragmatic Drag & Drop across all tables and kanbans (unified, accessible, virtualisation-friendly).

This document consolidates requirements + schema deltas into one robust specification.

⸻

2. Priority Requirements

2.1 Sprint Planning & Maintenance (Future Planning) — 2-D Matrix

Goal: Two-dimensional planner to manage backlog and assign stories into current and upcoming sprints.

Layout
	•	Vertical (columns): Sprints (active + N future), reorderable (sprints.orderIndex).
	•	Horizontal (rows): Theme → Goal → Subgoal (expand/collapse; persist in ui_state.plannerRowExpansion).
	•	Cells: Intersection holds Story cards for that sprint + (goal/subgoal).

Interactions
	•	Vertical move: updates stories.sprintId; log activity_stream.activityType='sprint_changed'.
	•	Horizontal move: updates stories.goalId/subGoalId; log activity_stream.activityType='backlog_retargeted'.
	•	In-cell reorder: stable, scope-specific order (see DnD refactor §2.10).

Acceptance
	•	Correct 2-D layout rendered; optimistic updates <150–200ms; user expansion state remembered; smooth performance at 200 stories × 8 sprints.

⸻

2.2 Current Sprint Kanban (Execution View)

Goal: Operate the current sprint efficiently.

Features
	•	Sprint selector (defaults to current).
	•	Lanes from profiles.kanbanLaneLabels.
	•	Story card → expandable task subgrid (inline, Excel-like).
	•	Drag/drop between lanes (status transitions) using unified DnD (§2.10).

Acceptance
	•	Sprint switch <500ms; inline task edits persist instantly; denormalised taskCount/doneTaskCount keep progress visible.

⸻

2.3 Calendar Blocking & AI Scheduling

Goal: Time-blocking by theme/subtheme; AI fills unblocked time with tasks/stories/habits.

Behaviour
	1.	User defines recurring/static blocks.
	2.	AI schedules from importanceScore, due dates, weekly theme targets, and recovery constraints.
	3.	Google Calendar bidirectional sync (googleEventId) with deep links to BOB entities.

Acceptance
	•	Respects quiet hours/facility hours; conflicts resolved via conflictVersion/supersededBy; external edits round-trip.

⸻

2.4 Daily LLM Email Digest

Daily at 06:30: Tasks Due Today; Focus Stories; Today’s Calendar Blocks; Sprint Pulse; LLM narrative.
New digests collection; mobile-friendly HTML; links to /story/STRY-###, /task/TASK-###.

⸻

2.5 Health & Nutrition Integrations

Per-user integrations (OAuth). New metric collections: metrics_hrv, metrics_workouts, metrics_nutrition.
Nightly ingestion; 7/30-day dashboards; planning avoids HI when HRV low; Runna workouts appear as read-only calendar entries.

⸻

2.6 iOS Reminders Two-Way Sync

tasks.reminderId; create/update/complete sync both ways within ~60s; latest edit wins; preserve TASK-### in title/notes; activity logged.

⸻

2.7 Mobile View (Important First)

Home shows “Important Now”: overdue, due today, high importanceScore, current sprint tasks; habits strip with streak; one-tap complete/defer (syncs to Reminders).

⸻

2.8 Test Automation (Selenium + Side-Door Auth)

Non-prod test_login_tokens with /test-login?token= endpoint; full CRUD + DnD + digest + calendar in CI; full run <10 min.

⸻

2.9 Theme Colour Inheritance (System-wide)

Single source: per-user theme_settings.
Resolution: entity.themeId → parent chain (Task→Story→Goal) → defaultThemeId.
No blanket hex persistence; compute at render via useThemeColor(entity).
WCAG AA foreground auto-selection; optional non-destructive high-contrast override.
Calendar events use resolved colour; Google Calendar reflects mapping.

Acceptance
	•	Changing theme colour updates all views (web/mobile/calendar) without DB writes; AA checks pass.

⸻

2.10 Pragmatic Drag & Drop Refactor (Tables & Kanbans)

Goal: Unify drag-and-drop across tables, kanbans, and planner with accessible, virtualisation-friendly, testable behaviour.

Scope
	•	Applies to Goals, Sub-Goals, Stories, Tasks, Habits, Sprints (columns), Calendar blocks (UI lists), Current Sprint Kanban, 2-D Planner matrix cells, sortable table views.

UX
	•	Optimistic UI: ≤150ms.
	•	Granular scopes: in-list reorder; cross-list moves; matrix cell reorder.
	•	Affordances: insertion indicators; edge auto-scroll.
	•	Input parity: mouse, touch (long-press), keyboard (space pick/drop, arrows to move).
	•	Virtualisation-safe: works with windowed lists.
	•	Undo: toast (10s) for quick revert where feasible.

Event Model (front-end)

type DnDEvent = {
  entityType: 'goal'|'subGoal'|'story'|'task'|'habit'|'sprint'|'calendarBlock';
  entityId: string;
  from: { scope: string; parentIds?: Record<string,string>; index?: number };
  to:   { scope: string; parentIds?: Record<string,string>; index?: number };
  meta?: { source: 'mouse'|'touch'|'keyboard'; reason?: 'reorder'|'move' };
};

scope examples: kanban:currentSprint:<sprintId>:<lane>, planner:<sprintId>:<goalId>:<subGoalId>, table:stories:<goalId>.

Persistence Strategy
	•	Fractional ranking to avoid cascading rewrites:
	•	Global/table order: rank (number).
	•	Kanban lanes: stories.rankByLane[laneId].
	•	Planner cells: stories.rankByCell["<sprintId>/<goalId>/<subGoalId>"].
	•	(Backward compatible with orderIndexBySprint.)
	•	Cross-container moves update parent keys and new rank in target scope.
	•	Conflict guard: dragLockVersion on writes; reject stale updates; UI retries once with fresh data.

Schema Deltas (DnD additions)
	•	stories:
	•	rank?: number
	•	rankByLane?: Record<string, number>
	•	rankByCell?: Record<string, number> // key ${sprintId}/${goalId}/${subGoalId}
	•	dragLockVersion?: number
	•	tasks / goals / sub_goals / habits:
	•	rank?: number
	•	sprints:
	•	Prefer rank for column ordering (migrate from orderIndex).
	•	activity_stream:
	•	payload.dnd = { from, to, oldRank, newRank, scope }

API / Functions
	•	applyDnDMutation(event: DnDEvent):
	1.	Validate ownership/scope/refs
	2.	Update parent keys (e.g., sprintId, goalId, subGoalId, lane)
	3.	Compute new fractional rank
	4.	Bump dragLockVersion
	5.	Append activity_stream entry (sprint_changed, backlog_retargeted, reordered_in_cell)

Accessibility
	•	ARIA roles; live announcements:
	•	“Moved Story STRY-123 to Sprint Alpha → Goal ‘Kitchen’ → Subgoal ‘Floor’, position 3.”
	•	Focus retention; visible focus ring; keyboard parity.

Performance Targets
	•	≤2 document writes per move (entity + activity).
	•	≥55 FPS under 300+ items (virtualised).
	•	Median round-trip ack ≤250ms.

Acceptance
	•	All sortable views support mouse/touch/keyboard DnD.
	•	Fractional ranking keeps lists stable after many moves.
	•	Cross-container moves reflect in all views within 500ms.
	•	Undo restores prior rank and parents.
	•	Works with real-time concurrent edits.

Testing (CI)
	•	Unit: rank insertion at edges/middle; float precision.
	•	Integration: table reorder; lane move; matrix vertical/horizontal/cell reorder; stale dragLockVersion case.
	•	E2E: keyboard DnD everywhere; mobile long-press; virtualised list drag.
	•	Perf: synthetic 1k items; write amplification check.

Migration Plan
	1.	Add rank fields (nullable); backfill with spaced values (100, 200, 300…).
	2.	Migrate orderIndex → rank on first reorder; queries order by rank with legacy fallback.
	3.	Introduce rankByCell on first planner interaction; keep orderIndexBySprint readable until cut-over.
	4.	Remove legacy orderIndex once ≥95% active entities have ranks.

⸻

3. Schema Deltas (v3.0.1 → v3.0.7)

3.1 Fields (new/changed)
	•	All entities: ref: string (unique, prefixed).
	•	Stories: taskCount?, doneTaskCount?, sprintId?, goalId, subGoalId?, orderIndexBySprint? (legacy), rank?, rankByLane?, rankByCell?, dragLockVersion?, themeId?.
	•	Sprints: ref, objective?, status, notes?, startDate, endDate, orderIndex or preferred rank, createdAt, updatedAt.
	•	CalendarBlock: storyId?, habitId?, subTheme?, googleEventId?, isAiGenerated?, conflictVersion?, supersededBy?, themeId?.
	•	Tasks: importanceScore?, isImportant?, reminderId?, (optional) aiCalculatedImportance?, recurringPattern?, rank?.
	•	Profiles/Habits: Integration IDs; weeklyThemeTargets; recovery constraints; kanbanLaneLabels.
	•	Theme Settings (per user): themes[], defaultThemeId, highContrastMode.
	•	UI State (per user): plannerRowExpansion, plannerVisibleSprints.
	•	Sub-Goals: { id, goalId, title, description?, orderIndex|rank }.

3.2 Collections

digests, metrics_hrv, metrics_workouts, metrics_nutrition, test_login_tokens, sub_goals (if top-level), theme_settings, ui_state, taxonomies (optional).

3.3 Indexes
	•	Stories: (ownerUid, sprintId, status), (ownerUid, goalId, orderIndex|rank), (ownerUid, goalId, subGoalId), (ownerUid, sprintId, updatedAt).
	•	Tasks: (ownerUid, parentId, status, dueDate), (ownerUid, isImportant, dueDate), (ownerUid, rank).
	•	Calendar Blocks: (ownerUid, start, end).
	•	Sprints: (ownerUid, status, startDate), (ownerUid, orderIndex|rank).

3.4 Security Rules

Owner-based rules for all new collections; explicit deny for test_login_tokens in prod; calendar endpoints verify ownership of googleEventId.

⸻

4. Non-Functional Requirements
	•	Performance: DnD perceived <150ms (optimistic UI); planner smooth at 200×8 scale.
	•	Accessibility: AA contrast; keyboard DnD + ARIA patterns; screen reader announcements.
	•	Observability: Digest timing, calendar sync errors, integration webhooks.
	•	Feature Flags: Rollout: Planner 2-D, Calendar AI, Digest, Reminders sync, Theme inheritance, DnD refactor.
	•	Resilience: Clear conflict/version semantics for calendar and DnD.

⸻

5. Testing & CI

Unit: theme resolution + AA; rank calculations; state transitions.
Integration: calendar round-trip; reminders sync; digest generation.
E2E: Goal→Story→Task→Sprint flow; Planner DnD; Kanban task subgrid inline edits; Mobile “Important Now”.
Perf: load & interaction budgets met.
A11y: keyboard-only flows pass; contrast checks in CI.

⸻

6. Migration Notes
	•	Themes: map any legacy goals.theme to theme_settings.themes[]; set defaultThemeId.
	•	Sprints: backfill orderIndex (or adopt rank) via (status desc, startDate asc).
	•	Stories: init orderIndexBySprint where absent; introduce rankByCell on interaction.
	•	DnD: add rank fields; progressive migration; switch queries to order by rank with fallback; remove legacy once ≥95% coverage.
	•	Indexes & Rules: deploy before enabling features.

⸻

7. Developer Tasks (Backlog → v3.0.7)
	1.	Implement theme_settings + useThemeColor; replace ad-hoc colours in Goals table, Current Sprint Kanban, Planner, Calendar, Mobile.
	2.	Refactor Planner to 2-D matrix; add sub_goals hierarchy and persisted expansion.
	3.	Implement Pragmatic DnD across all sortable views; add rank/rankByCell/rankByLane; wire applyDnDMutation.
	4.	Calendar sync: honour theme mapping; round-trip googleEventId; conflict handling.
	5.	Expand Selenium: matrix DnD, colour inheritance, mobile Important Now, calendar/Reminders round-trip.
	6.	CI: AA contrast checks; perf budgets; headless runs with side-door auth.

⸻

8. Handoff Checklist
	•	✅ Schema v3.0.7 deltas deployed (incl. theme, UI state, sub-goals, ranks, calendar IDs).
	•	✅ Rules and indexes live.
	•	✅ Unified DnD implemented and tested across tables/kanbans/planner.
	•	✅ Daily digest scheduler active.
	•	✅ Google Calendar creds + bidirectional sync verified.
	•	✅ iOS Reminders sync live.
	•	✅ Mobile “Important Now” operational.
	•	✅ AA contrast and a11y checks green in CI.

⸻

9. Conclusion

This v3.0.7 handoff merges all prior requirements with two critical UX pillars—theme colour inheritance and the 2-D sprint planner—and standardises interaction with a pragmatic, accessible Drag & Drop across the entire app. It is designed for immediate implementation by a coding AI or development team with no external context required.