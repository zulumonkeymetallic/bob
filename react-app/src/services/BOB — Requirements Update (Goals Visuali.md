BOB — Requirements Update (Goals Visualization DB wiring, Calendar AI plumbing, Sprint Mgmt integration, Kanban story → tasks)
Scope
This update extends the existing spec to:
Wire the Goal Visualization view directly to Firestore with full CRUD + real-time updates.
Stand up the Calendar Integration plumbing to support AI scheduling (read/write sync, advanced logging).
Integrate the new Sprint Management UI into the core data flows.
Make Kanban story click reveal an inline Modern Tasks table beneath it (full inline editing).
Target routes (current app):
Calendar integration: https://bob20250810.web.app/calendar/integration
Sprint management:   https://bob20250810.web.app/sprints/management

1) Goal Visualization — Database Wiring (v3.4)
Functional
Live data: Visualization subscribes to goals, stories, sprints with owner scoping and correct ordering.
Inline edits:
Drag goal bar on timeline updates goals.startDate/endDate.
Moving a goal that would change ≥3 stories’ plannedSprintId prompts a confirmation modal; on confirm, batch update affected stories (atomic).
Side panel:
Shows goal fields + Stories table (modern) + Tasks table (modern), both inline editable with Enter-to-save behavior.
Sharing/Print:
Read-only share link (tokenized) that renders the same data and respects filters.
Print stylesheet (A3 landscape) with theme colours and AA contrast.
Activity Stream
Log every field update and batch sprint reassignment:
goal_updated:{startDate,endDate}, story_planned_sprint_changed:{from,to}, batch_change_confirmed:{count}.
Include initiator (uid/email), entity refs, and previous/new values.
Advanced Logging (client DbLog)
For each user action:
listen_open (goals/stories/sprints), then listen_snapshot with resultCount.
write for goal date drag, update_many for story batch changes, followed by snapshot confirmation.
Acceptance Criteria
Dragging a goal updates bar position in <150ms (optimistic) and is reconciled by snapshot.
Batch confirmation appears if ≥3 stories are affected; cancel leaves data unchanged.
Side panel edits commit on Enter and reflect across visualization, tables, and planner within 500ms.
Indexes
Goals: (ownerUid, themeId, startDate) and (ownerUid, endDate).
Stories: (ownerUid, goalId, plannedSprintId), (ownerUid, sprintId, status).

2) Calendar Integration AI Plumbing (v3.4 → v3.5)
Functional
Integrations page (/calendar/integration) exposes:
Connect/disconnect Google Calendar (existing), plus status and last sync timestamps.
AI Scheduling toggle and constraints: quiet hours, facility hours, max HI sessions/week, min recovery gap.
Fitness calendars (Runna/Strava) preview overlay toggle (read-only at first).
Data flows:
Import: pull existing GCal events into calendar_blocks (mapped with googleEventId); import frequency configurable (manual + hourly).
Export: push BOB-generated blocks to GCal (create/update/delete) with conflictVersion/supersededBy.
AI fill: when enabled, generate candidate blocks (draft) respecting constraints and fitness overlays; user approves → commit.
Advanced Logging & Telemetry
For every sync:
sync_start, sync_fetch{count}, sync_push{created,updated,deleted}, sync_conflict{count}, sync_complete{durationMs}.
Error payload includes event ids, HTTP status, and retry strategy.
UI shows last 10 sync runs with status and a “view details” drawer (full JSON traces in staging).
Acceptance Criteria
Manual “Sync now” shows progress and end state; DbLog + UI history record the run.
Imported events appear on BOB calendar within 5s post-sync; edits pushed to GCal within 10s.
AI “draft blocks” never write to GCal until user approval; approval writes to DB and triggers export.
Schema (additions/confirmations)
calendar_blocks: googleEventId, isAiGenerated, status: 'draft'|'committed', source: 'bob'|'gcal'|'runna'|'strava'.
integration_status: per user { google:{connected, lastSyncAt}, runna:{connected,lastSyncAt}, strava:{connected,lastSyncAt} }.
sync_runs (staging/prod): { id, user, provider, startedAt, finishedAt, summary, errors[] }.

3) Sprint Management Integration (v3.4)
Functional
Sprint management page (/sprints/management) binds to the same sprint store used by Planner/Kanban:
Create/edit/close sprints; reorder columns (sprints.rank).
Real-time effect on Planner and Current Sprint Kanban (no separate caches).
Bulk operations:
Assign selected stories to a sprint; reorder within sprint via Pragmatic DnD (fractional ranks).
Cross-view consistency:
Any change here reflects in Visualization (planned sprint) and vice-versa.
Logging & Activity
sprint_created, sprint_updated, sprint_closed, stories_bulk_assigned_to_sprint{count} with initiator + before/after.
Acceptance Criteria
Reordering sprints updates Planner/Kanban columns in the same session.
Bulk assignment round-trips in ≤500ms and is visible in Visualization markers.

4) Kanban Story → Inline Modern Tasks Table (v3.4)
Functional
Clicking a Story card in Kanban expands an inline region directly beneath the card that contains a full Modern Tasks table:
Columns: ref, title, status, due, priority, assignee (optional), importanceScore.
Inline edit everywhere; Enter commits (global rule).
Quick add (“+ task”) at the top; delete inline.
Virtualized rendering so expanded rows don’t tank performance.
Acceptance Criteria
Expansion/collapse persists during navigation in the session.
Task edits reflect in the Story’s subgrid in Current Sprint view and in the dedicated Tasks page within 500ms.
DbLog shows write + snapshot for every Enter commit.
Schema / Indexes
No new schema; ensure Tasks queries support (ownerUid, storyId, rank|dueDate).

5) Advanced Logging — Sync, Creation, Mutation (reinforced)
Global
?debug=db enables:
Client DbLog stream (read/write/update/delete/listen_open/listen_snapshot/listen_error).
On-screen “DB Activity” panel with filter by entity and action.
Persist a summarized audit_logs record for high-value events in staging/prod:
goal_move_timeline, stories_bulk_replanned, calendar_sync_run, sprint_bulk_assign, kanban_task_inline_edit.
Console hygiene
Every page mount logs a single listen_open per collection/scope; detect duplicate listeners and warn listener_duplicate_detected with component name.
Acceptance Criteria
For each UI flow called out above, the DbLog shows a write followed by at least one corresponding snapshot; missing snapshot within 3s → visible warning toast and entry in DbLog.

6) Testing & CI — New/Updated Cases
Unit
Goal bar drag → date math and affected-stories calculation.
Story planned sprint assignment; fractional rank insert.
Enter-to-save handlers (Goals/Stories/Tasks) return commit promises.
Integration
Visualization drag causing ≥3 story sprint changes triggers confirmation; cancel vs confirm paths.
Calendar “Sync now” end-to-end: import, export, conflict resolution; AI draft approval path.
Sprint management bulk assign shows across Planner/Kanban/Visualization.
E2E
From Visualization, drag a goal; confirm modal; approve; verify Planner and Story tables reflect new sprints and Activity Stream logs batch event.
From Kanban, expand Story → edit Tasks; Enter saves; DbLog + Activity Stream reflect changes.
Calendar integration: connect, import, commit AI draft block, and verify GCal event appears (staging creds).
Perf
Visualization: 100+ goals, smooth scroll/drag; ≤200ms perceived DnD.
Kanban expanded rows: ≤60ms idle after expansion.

7) Developer Tasks (incremental)
Visualization
Wire subscriptions; implement goal drag + batch story replanning + confirmation.
Side panel: plug modern tables for Stories/Tasks with shared inline editor.
Print/Share link mode.
Calendar
Integration page: connect flows, last sync UI, AI draft toggle.
Sync engine scaffolding: import/export, conflictVersion handling, sync_runs logging.
Draft → commit pipeline and DbLog surfacing.
Sprints
Ensure single source of truth store; add bulk assign and rank updates; cross-view consistency.
Kanban
Inline Modern Tasks table on story expand; virtualization, Enter-to-save.
Logging
Listener duplicate detection; audit_logs for high-value events.

8) Master Handoff Reference Updates
Section “New Requirements for v3.4”: add a pointer to goals_visualization.md for module-level detail (already produced).
Section “Calendar Blocking & AI Scheduling”: extend with integration plumbing spec above and link to /calendar/integration.
Section “Sprint Planning & Maintenance”: reference /sprints/management as the management UI that must share the same store/state.
Section “Current Sprint Kanban”: add requirement “Clicking a Story expands inline Modern Tasks table.”


