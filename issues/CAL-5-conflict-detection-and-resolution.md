# [CAL-5] Conflict detection and resolution UX

- Labels: epic:AI-scheduling, calendar, ui

Description
Surface event/block conflicts in UI with options to shift/shorten/move and reflect choices back to Google.

Acceptance Criteria
- Conflicts highlighted with reason and suggested action
- Applying a resolution updates Google and Firestore block
- Activity entry created for resolution action

Dependencies
- planCalendar validator, CalendarIntegrationView

Test Notes
- Create overlapping events; resolve in UI; verify updates persisted.
