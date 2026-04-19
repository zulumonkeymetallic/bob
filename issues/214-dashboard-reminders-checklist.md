# 214 – Dashboard Reminder & Checklist Widgets

## Summary
Enrich the main dashboard with actionable widgets: reminders due today plus routine/chore checklist snapshots. Each widget should link to the appropriate filtered view (Tasks/Planner) so users can act immediately.

## Goals
- Display reminders (tasks + iOS Reminders) due today on the dashboard.
- Highlight routines and chores due today, mirroring the checklist panel compactly.
- Provide quick actions (mark done, snooze) where feasible.
- Enable drill-through to the relevant filtered lists in Tasks or Unified Planner.

## Non-Goals
- Full checklist editor (existing panels remain).
- Habit analytics (future work).

## Tasks
- [ ] Query reminders/tasks/chores/routines due today for the signed-in persona.
- [ ] Render dashboard cards with counts and previews.
- [ ] Add CTA buttons to open the filtered view (Tasks page with due-today filter, planner checklist focus).
- [ ] Optional: add quick-complete toggle for reminders.
- [ ] Update tests/docs.

## Acceptance Criteria
- [ ] Dashboard shows the number of reminders and chore/routine items due today.
- [ ] Clicking a widget navigates to the filtered view reflecting the same data (Tasks list or planner checklist).
- [ ] Counts stay in sync with the checklist panel data.
