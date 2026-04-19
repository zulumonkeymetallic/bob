# 166 – Routines (Chores & Habits) UI improvements + Calendar Blocks link guide

- Type: enhancement/docs
- Priority: P2

## UI Improvements
- Habits
  - Show weekday chips on the list (Mon–Sun) when frequency=weekly
  - Inline toggle for Active/Inactive
  - Quick set scheduleTime with a time picker in row
- Chores
  - RRULE builder UI (weekday, monthly nth, interval)
  - Next due preview (computed), and “Mark Done” button to advance nextDueAt

## Docs
- Expand documentation with screenshots and examples of how Habits/Chores become plan assignments and calendar events (parent block + child events)
  - Current basis: ROUTINES_BLOCKS_INTEGRATION.md (present)

## Acceptance
- Weekly chips render; “Mark Done” advances nextDueAt to next RRULE occurrence
- Docs updated with step-by-step example of a day’s plan and resulting Google Calendar events

