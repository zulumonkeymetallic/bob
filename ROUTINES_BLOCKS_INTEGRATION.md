# Routines → Blocks Integration

This note summarizes how Habits and Chores flow into Today’s plan and Calendar Blocks.

- buildPlan (Cloud Function):
  - Source includes:
    - Tasks due today
    - Chores due today (RRULE/nextDueAt); when checked Done, nextDueAt advances
    - Habits: daily and weekly (weekly uses `daysOfWeek` 0–6; 0=Sun)
  - Each habit has `scheduleTime` (e.g., "07:00"). Planner prefers placing the assignment at that time. If there is a compatible block, it slots inside; if none, it still places at the preferred time.

- syncPlanToGoogleCalendar (Cloud Function):
  - Converts plan assignments into Calendar events, grouped under parent Block events when available.
  - Adds/patches child events and tracks `external.googleEventId` on assignments.

- reconcilePlanFromGoogleCalendar and reconcileAllCalendars:
  - Reconciliation marks assignments deferred if child events were deleted externally.
  - Runs every 15 minutes across users; also callable per user.

- Habits UI (frontend):
  - Frequency: daily or weekly
  - Weekly: choose `daysOfWeek` (checkboxes Mon–Sun), persisted on the Habit record.
  - Toggle Active; link to a Goal for context.

- Chores UI (frontend):
  - RRULE definition, `nextDueAt`, estimate, priority, theme, optional goal link.
  - When done today, chore advances `nextDueAt` to the next RRULE occurrence.

- Checklist (frontend):
  - First open per day builds Today’s plan.
  - Sources: plan assignments, Tasks due today, Chores due today, Habits scheduled for today.
  - Calls `syncPlanToGoogleCalendar` after build.

Tip: If you want a 06:00 auto build per user timezone, add a scheduled function keyed by user prefs (see Notes in deployment brief).

