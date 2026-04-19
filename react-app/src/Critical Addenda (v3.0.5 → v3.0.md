Critical Addenda (v3.0.5 → v3.0.6)

A. Theme Colour Inheritance (System-wide)

Product Requirement

All Goals, Stories, Tasks, Habits, Sprints, Calendar Blocks, and Widgets must inherit and render the colour defined in Theme Settings. The visual identity must remain consistent across web and mobile, including Kanban cards, table badges, chips, calendar events, and progress bars.

UX/Behaviour
	•	Single Source of Truth:
	•	Theme colour is defined in theme_settings (per user).
	•	Entities do not persist raw hex by default—colour is resolved at render via the entity’s theme/themeId.
	•	Fallbacks: If an entity is missing theme:
	•	Resolve from its parent (Story → Goal.theme; Task → Story.theme → Goal.theme).
	•	If no parent, default to user’s defaultTheme (in theme_settings).
	•	Overrides (optional): Allow a non-destructive view override (e.g., accessibility high-contrast mode) via a transient UI toggle; do not persist override to the database.
	•	AA Contrast Compliance: Automatically choose a text foreground token that meets WCAG AA against the computed background colour (light/dark modes).

Data Model (Schema Deltas)
	•	theme_settings (per user; new or extend):
	•	themes[]: { id, name, colorHex, colorToken?, isDefault? }
	•	defaultThemeId: string
	•	highContrastMode: boolean
	•	goals:
	•	themeId: string (required; existing theme string can be migrated)
	•	stories, tasks, habits, calendar_blocks, sprints:
	•	themeId?: string (optional; inherits if absent)
	•	computedThemeColor (virtual/derived, not stored; used in UI render)
	•	Indexes: None required for colour resolution (computed at read).

Rendering Contract (Front-end)
	•	Expose a useThemeColor(entity) hook:
	•	Resolution order: entity.themeId → parent chain → theme_settings.defaultThemeId.
	•	Returns { bg, fg, token } with AA-safe foreground.
	•	Calendar events use bg for event fill, fg for text, and a 1px darker border for visibility in both light & dark.

Acceptance Criteria
	•	Changing a theme colour in Theme Settings updates colours across all views without data writes.
	•	AA contrast is satisfied in light and dark modes (automated check on build).
	•	Colour persists across drag-drop, pagination, and optimistic updates.
	•	Mobile “Important Now” honours the resolved colour for chips and badges.

Tests (Add to CI)
	•	Unit: useThemeColor resolution (direct, inherited, default).
	•	Visual Regression: Snapshot cards in light/dark with AA check (threshold ≥ 4.5:1).
	•	E2E: Change theme colour → verify Kanban, Tables, Calendar, Mobile home all update without reload.

Migration Notes
	•	If goals.theme exists as a string enum, create themes[] with known palette and set goals.themeId accordingly.
	•	Set theme_settings.defaultThemeId to user’s most common theme or “Home”.

⸻

B. Sprint Planning Layout Correction (2-D Matrix Planner)

Fix the current Sprint Planning to vertical swimlanes per Sprint and horizontal groupings by Theme → Goal → Subgoal. Stories appear in the intersection cells and can be re-ordered within a cell or moved across sprints (vertical) and across theme/goal groupings (horizontal).

Product Requirement

Provide a two-dimensional planner:
	•	Vertical: One column per Sprint (Active + N future).
	•	Horizontal: Rows grouped by Theme → Goal → Subgoal (expand/collapse).
	•	Cells: Contain Story cards; each card shows ref, title, points, taskCount/doneTaskCount, status, and coloured left border (theme).

Interactions
	•	Drag & Drop:
	•	Vertical move (to another Sprint): sets stories.sprintId.
	•	Horizontal move (to another Goal/Subgoal): sets stories.goalId and stories.subGoalId?.
	•	In-cell ordering: updates stories.orderIndexBySprint[sprintId] (see Schema).
	•	Row Controls: Expand/collapse Theme, reveal Goals and Subgoals. Persist expand state in ui_state per user.
	•	Sprint Controls: Add/Edit Sprint inline; reorder sprint columns (affects sprints.orderIndex).
	•	Filters: Quick filters (My Stories, Status, Priority, Theme); respect without breaking row/column structure.
	•	Virtualisation: Only render visible rows/columns and ~2 viewport buffers; maintain keyboard focus and ARIA roles.

Data Model (Schema Deltas)
	•	stories:
	•	goalId: string (existing)
	•	subGoalId?: string (new; references goals/{id}/subgoals/{id} or sub_goals if top-level collection)
	•	sprintId?: string
	•	orderIndexBySprint?: { [sprintId: string]: number } (new) – stable in-column ordering per sprint
	•	goals:
	•	hasSubGoals?: boolean
	•	sub_goals (new, if not nested):
	•	{ id, goalId, title, description?, orderIndex }
	•	sprints:
	•	orderIndex: number (column order)
	•	ui_state (per user; new):
	•	plannerRowExpansion: { [themeId]: boolean, [goalId]: boolean, [subGoalId]: boolean }
	•	plannerVisibleSprints: string[]

Indexes
	•	stories: (ownerUid, sprintId, goalId), (ownerUid, goalId, subGoalId), (ownerUid, sprintId, status).
	•	sprints: (ownerUid, status, startDate), (ownerUid, orderIndex).

Acceptance Criteria
	•	Vertical swimlanes render one per Sprint; horizontal groups show Theme → Goal → Subgoal with collapse states.
	•	Dragging a Story:
	•	Across columns sets sprintId and writes activity_stream.activityType='sprint_changed'.
	•	Across rows updates goalId/subGoalId and writes activity_stream.activityType='backlog_retargeted'.
	•	In-cell re-order updates orderIndexBySprint[currentSprintId].
	•	Optimistic UI within 150ms; server confirmation reconciles without jitter.
	•	Persistence: Row expansion and visible sprints remembered per user.

Accessibility
	•	Kanban matrix adheres to ARIA patterns:
	•	Columns: role="list", Rows: labelled regions, Cards: role="listitem".
	•	Keyboard DnD: Arrow keys + space to pick/place; visible focus ring and live region announcements.

Tests (Add to CI)
	•	E2E Matrix DnD:
	1.	Move Story across sprints; 2) Move Story to different Goal/Subgoal; 3) Re-order in cell; 4) Undo via command pallette or undo button (if implemented).
	•	State Persistence: Refresh keeps expanded rows and visible sprint set.
	•	Performance: 200 Stories × 8 Sprints renders < 60ms idle frame after initial load (virtualised).
	•	A11y: Keyboard-only DnD succeeds; screen reader announces moves.

Migration Notes
	•	Backfill sprints.orderIndex by sorting (status desc, startDate asc).
	•	Initialise stories.orderIndexBySprint[sprintId] by current creation time ordering within that sprint.

⸻

C. Calendar & Colour Cohesion (Cross-cutting)
	•	Calendar event colour must resolve via useThemeColor(calendarBlock|story|task).
	•	If calendar_block.storyId exists, derive colour from the Story → Goal chain; otherwise use calendar_block.themeId or defaultTheme.
	•	Google Calendar sync writes event.colorId or inline colour (depending on API capability); round-trip retains mapping via googleEventId.
	•	Acceptance: Editing theme colour updates event appearance on next sync without data migration.

⸻

D. Developer Tasks (Backlog → v3.0.6)
	1.	Implement theme_settings + useThemeColor hook and replace ad-hoc colour usage in:
	•	ModernGoalsTable, CurrentSprintKanban, SprintPlanner, Calendar, MobileView.
	2.	Refactor Sprint Planner to 2-D matrix:
	•	Columns = Sprints; Rows = Theme → Goal → Subgoal; Cells = Stories.
	•	Introduce stories.orderIndexBySprint.
	3.	Add sub_goals support and UI row hierarchy.
	4.	Persist ui_state.plannerRowExpansion and plannerVisibleSprints.
	5.	Add AA contrast util and unit tests.
	6.	Update Selenium flows to cover matrix DnD & colour inheritance.

⸻
