📘 BOB – Priority Requirements & Schema Deltas (v3.0.2 Handoff)

Owner: Jim Donnelly
Date: August 31, 2025
Audience: Development AI / Coding Team
Purpose: Define the priority features and the corresponding schema updates required to move BOB from v3.0.1 → v3.0.2. This document is authoritative and implementation-ready.

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

This file consolidates the requirements and the schema deltas into a single, robust specification.

⸻

2. Priority Requirements

2.1 Sprint Planning & Maintenance (Future Planning)

Goal: Provide a visual planner to manage backlog and assign stories into current and upcoming sprints.

UI & Interactions:
	•	Sprint Maintenance Page divided into:
	•	Left pane (Backlog Board): Horizontal swimlanes grouped by Theme → Goal. Each card represents a Story.
	•	Right pane (Sprint Columns): Vertical swimlanes, one per Sprint (active + future).
	•	Drag & Drop:
	•	Dropping a story onto a sprint sets stories.sprintId = <SPR>.
	•	An entry is written to activity_stream with activityType='sprint_changed'.
	•	Reordering:
	•	Stories inside a sprint can be reordered by stories.orderIndex. Persist order immediately.
	•	Sprint Creation/Edit:
	•	Inline modal with fields: ref (SPR-###), name, objective, status (planned|active|closed), notes, startDate, endDate, timestamps.
	•	Custom Lanes:
	•	Users can rename Kanban lanes. Persist in profiles.kanbanLaneLabels.

Acceptance Criteria:
	•	Story drag/drop persists within 200ms (optimistic UI).
	•	Sprint ref numbers auto-generate unique (SPR-###).
	•	User lane labels persist across sessions.

⸻

2.2 Current Sprint Kanban (Execution View)

Goal: Give users a Kanban board to run the current sprint effectively.

UI & Interactions:
	•	Sprint Selector: Dropdown at top-right (defaults to current sprint).
	•	Columns: Kanban lanes with names pulled from profiles.kanbanLaneLabels.
	•	Story Cards: Clicking a story expands an inline task subgrid, Excel-like, to quick-edit tasks (status, dueDate, priority).
	•	Drag & Drop: Stories can move between columns.

Acceptance Criteria:
	•	Sprint switch reloads < 500ms.
	•	Inline edits of tasks persist instantly.
	•	Denormalised fields (taskCount, doneTaskCount) keep story progress visible without expensive queries.

⸻

2.3 Calendar Blocking & AI Scheduling

Goal: Allow users to block time by theme/subtheme, and let AI dynamically fill remaining free space with tasks, stories, and habits.

Data Model Changes:
	•	Extend calendar_blocks with:
	•	storyId?
	•	habitId?
	•	subTheme? (e.g., Health/Fitness, Growth/Reading).

Behaviour:
	1.	User defines recurring or static blocks (e.g., Thu 19:00–21:00 for Home/Chores).
	2.	AI fills unblocked time based on:
	•	Task importance (new importanceScore).
	•	Due dates.
	•	Weekly theme targets (profiles.weeklyThemeTargets).
	•	Recovery constraints (profiles.maxHiSessionsPerWeek, minRecoveryGapHours).
	3.	Blocks sync with Google Calendar using googleEventId. Each event description includes deep links back to BOB entities (story/task ref).

Acceptance Criteria:
	•	AI scheduling respects quiet hours and facility hours.
	•	Conflicts resolved with version/supersededBy.
	•	Events are bidirectionally synced; manual changes in Google are reflected back.

⸻

2.4 Daily LLM Email Digest

Goal: Deliver a daily email at 06:30 with a smart summary of the day’s priorities.

Content:
	•	Tasks Due Today (table with Ref, Title, Goal, Due, Priority).
	•	Focus Stories (top N by points/priority).
	•	Today’s Calendar Blocks.
	•	Sprint Pulse (velocity snapshot).
	•	LLM Summary (narrative: what to tackle first, risks to note).

Data Model:
	•	New digests collection (ephemeral). Fields: date, tasksDue[], storiesFocus[], calendarBlocks[], velocitySnapshot, html.

Acceptance Criteria:
	•	Email renders as mobile-friendly HTML.
	•	Links click through to /story/STRY-### or /task/TASK-###.
	•	Data reflects live DB state at generation time.

⸻

2.5 Health & Nutrition Integrations

Goal: Import metrics from Strava, Runna, MyFitnessPal for smarter planning.

Data Model:
	•	New per-user integrations document (OAuth tokens/metadata).
	•	New collections:
	•	metrics_hrv: { date, value, source }
	•	metrics_workouts: { date, type, distance, duration, hr_avg, source, stravaActivityId }
	•	metrics_nutrition: { date, calories, protein_g, carbs_g, fats_g, source, mfpEntryId }

Use in Planning:
	•	AI avoids scheduling high-intensity if HRV is low.
	•	Nutrition dashboards show adherence vs protein/calorie targets.
	•	Runna workouts appear in calendar blocks as read-only events.

Acceptance Criteria:
	•	Tokens stored securely server-side.
	•	Metrics ingested nightly.
	•	Dashboard shows 7/30-day views.

⸻

2.6 iOS Reminders Two-Way Sync

Goal: Ensure tasks stay in sync between BOB and Apple Reminders.

Data Model:
	•	Add reminderId to tasks.

Behaviour:
	•	Create/update/complete in one system syncs within 60s to the other.
	•	Conflict resolution: latest edit wins.
	•	Changes logged in activity_stream.

Acceptance Criteria:
	•	Deleted items handled gracefully.
	•	Reminders keep reference numbers (TASK-###) in title or notes.

⸻

2.7 Mobile View (Surface Important First)

Goal: Make the mobile home screen hyper-focused.

Behaviour:
	•	Show “Important Now”:
	•	Overdue tasks.
	•	Due today.
	•	High importanceScore.
	•	Current sprint tasks.
	•	Habits checklist strip at top, with streak badge.

Data Model:
	•	Tasks gain:
	•	importanceScore (0–100)
	•	isImportant

Acceptance Criteria:
	•	Loads under 1s.
	•	One-tap complete/defer.
	•	Syncs with iOS Reminders if linked.

⸻

2.8 Test Automation (Selenium + Side-Door Auth)

Goal: Allow automated AI testing without OAuth friction.

Data Model:
	•	New test_login_tokens collection (non-prod only):
	•	{ token, uid, expiresAt, scope }

Behaviour:
	•	/test-login?token= endpoint maps token to uid.
	•	Disabled in production.

Acceptance Criteria:
	•	Selenium suite can run full CRUD, drag-drop, digest gen, and calendar sync in CI.
	•	Test run < 10 minutes with artifacts.

⸻

3. Schema Deltas (v3.0.1 → v3.0.2)

3.1 New or Changed Fields
	•	All entities: ref: string (unique, prefixed).
	•	Stories: taskCount?: number, doneTaskCount?: number.
	•	Sprints: ref, objective?, status: 'planned'|'active'|'closed', notes?, createdAt, updatedAt.
	•	CalendarBlock: storyId?, habitId?, subTheme?.
	•	Tasks: importanceScore?, isImportant?, reminderId?.
	•	Profiles/Habits: add integration IDs (stravaAthleteId, runnaPlanId, mfpUserId).

3.2 New Collections
	•	digests
	•	metrics_hrv, metrics_workouts, metrics_nutrition
	•	test_login_tokens
	•	taxonomies (optional central theme/subtheme mapping)

3.3 Indexes
	•	Stories: (ownerUid, sprintId, status), (ownerUid, goalId, orderIndex).
	•	Tasks: (ownerUid, parentId, status, dueDate), (ownerUid, isImportant, dueDate).
	•	Calendar_blocks: (ownerUid, start, end).

3.4 Security Rules
	•	Add owner-based rules for all missing collections.
	•	Explicit deny for test_login_tokens in production.

⸻

4. Non-Functional Requirements
	•	Performance: Drag-drop perceived <150ms (optimistic UI).
	•	Accessibility: Theme colour must meet AA contrast.
	•	Observability: Log digest gen times, calendar sync failures.
	•	Feature Flags: Roll out Sprint Planner, Calendar AI, Digest, Reminders sync incrementally.

⸻

5. Handoff Checklist
	•	Schema v3.0.2 deltas implemented.
	•	Security rules updated.
	•	Indexes created.
	•	CI with headless Selenium.
	•	Daily digest scheduler running.
	•	Calendar integration keys configured.
	•	Mobile “Important Now” view live.

⸻

6. Conclusion

This document combines requirements + schema changes in one place. It covers all priority areas and defines the exact deltas needed to move from schema v3.0.1 to v3.0.2.

It is ready to be handed directly to a coding AI or development team. No external context is required.