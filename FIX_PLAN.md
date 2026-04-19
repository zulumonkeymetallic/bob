# BOB AI Planner & Sync Remediation Plan

## Current Gaps (as observed)
- Google Calendar sync not happening: target user doc lacks `googleCalendarTokens`; integration UI may show “connected” incorrectly. No `googleEventId` on blocks.
- Only 1 story block in next 7 days; many routine/habit blocks consume window, few high-score stories qualify, and planner only avoids `calendar_blocks`, not live Google busy time. No task blocks for long tasks.
- Theme windows ignore user theme blocks (`/calendar/planner`). Wealth/Growth previously inside work hours; hobby block showed “General” due to numeric theme ids.
- Activity evidence missing: no recent `auto_point`, `task_to_story_conversion`, or LLM pointing entries surfaced.
- Chores/routines/habits: not visible on UI for user; no nightly insertion into tasks/blocks; no gamification metrics; not excluded from top-3 task cap.
- Capacity: scheduled hours from `calendar_blocks` not rolled into capacity view; dashboard doesn’t show capacity metrics or finance/wealth spend visuals.
- Planner conflict handling: doesn’t pull Google busy events; doesn’t reschedule against new GCal events; daily cap counts include non-story routine blocks.

## Objectives
1) Reliable bi-directional GCal sync with deep links, full-event paging, and rich integration logs + “Sync now” control.
2) Nightly rebaseline for 7 days: AI schedules eligible stories and long tasks across the full 7-day window (subject to caps/availability), avoiding sleep/work and GCal busy; per-day caps ignore routine/chores.
3) Themes honored: use story/goal theme labels; use user-defined theme blocks as preferred windows.
4) Conversions & pointing proven: nightly LLM pointing (missing points), task↔story conversions by points, with activity logs.
5) Chores/routines/habits: Phase 2. Temporarily disable their scheduling (and exclude their blocks) to get clean story/task scheduling; later re-enable with nightly insertion and gamification metrics.
6) Capacity: include scheduled hours from calendar blocks (by goal/theme) in capacity API and surface on overview dashboard with finance/wealth spend visuals.
7) E2E validation: run the nightly chain once with tokens connected; verify blocks synced to Google; verify exactly 3 tasks promoted to today (high/“!!”); capture evidence.

## Work Plan
### A) Google Calendar Sync & Logging
- Implement `integration_logs` for push/pull (onCalendarBlockWrite, scheduledCalendarSync, syncFromGoogleCalendar): log blockId, storyId/taskId, eventId, action, status, error, counts, time window.
- Add callable `syncCalendarNow` and expose “Sync now” button on `/calendar/integration`.
- Remove page-size cap; page through all GCal events; widen window so all events appear in `calendar_blocks`.
- UI: reflect true connection (check `googleCalendarTokens` on user doc). If missing, prompt reconnect.
- Ensure event description enrichment remains (story/goal/sprint deep links).

### B) Planner Enhancements (stories + long tasks)
- Intake user theme blocks (`/calendar/planner`) as preferred windows before default slots.
- Time windows:
  - Growth: weekday 07–0Buy the materials for terrariums and get one created9, 17–19.
  - Wealth/Finance: weekday 18–21; weekend 09–12 and 13–17.
  - Hobbies: evenings; Gaming/TV: Fri/Sat evenings.
- Create blocks for tasks with points>4 or est>4h, using same placement logic as stories; include ref in title, deep link, rationale.
- Conflict handling: use `calendar_blocks` + synced GCal busy to avoid overlaps; if conflict, move to next slot within 7d; cap 3 story/task blocks per day (do not count routine/chores).
- Theme labels: map numeric to readable; inherit from story/goal.
- Full 7-day fill: ensure the planner attempts to place eligible story/long-task blocks across the 7-day window each night (subject to caps/availability).
- Phase 1 excludes routine/chores blocks from caps and placement to keep the window clear for stories/long tasks.

### C) Prioritization & Conversions
- Task theme inheritance: task → linked story theme → story’s goal theme.
- Score bonuses: tasks linked to stories in active sprint; old unlinked tasks (>90d) get bonus and forced due-today unless locked.
- Conversions: nightly task→story when points>4; story→task when points<4; log `task_to_story_conversion`.
- Pointing: nightly auto-point for missing points (tasks/stories); log `auto_point`.
- Activity proof: ensure `activity_stream` entries for `auto_point`, `task_to_story_conversion`, `ai_priority_score`, `ai_due_date_adjustment`, `calendar_insertion`.

### D) Chores/Routines/Habits
- Phase 2: After clean story/task scheduling:
  - Nightly job: generate tasks/blocks from chores/routines; exclude from top-3 task cap and from story/task per-day caps.
  - Surface chores/routines/habits in UI lists; fix fetch/seed if empty.
  - Completion metrics: log completions (reminders/Kanban/mobile) for gamification.

### E) Capacity & Dashboards
- Backend: redeploy `calculateSprintCapacity` with scheduled-hours rollup from `calendar_blocks` (by goal/theme).
- Frontend: 
  - `/sprints/capacity`: show scheduled hours per sprint/goal/theme.
  - `/overview/advanced`: replace “command centre” with capacity cards and finance/wealth pie (spend by bucket), plus key metrics (utilization, scheduled hours, top themes).

### F) Verification Pass (after implementation)
- Connect Google tokens for target user; run nightly chain once (auto-point → conversions → priority → planner).
- Collect evidence:
  - `activity_stream` entries for pointing, conversions, scoring, due-date moves, calendar insertions.
  - `calendar_blocks` showing new blocks (stories + long tasks) with readable themes, refs in titles, rationales, and `googleEventId` set.
  - Integration logs showing push/pull successes; Google Calendar events present with deep links.
  - Capacity API returns scheduled hours; dashboard shows new cards/pie.
- Validate “3 tasks due today”: confirm exactly 3 promoted tasks (high/“!!”) for the day after scoring.
- Confirm 7-day fill: planner placed eligible blocks across the window, adjusting for GCal busy/conflicts.
