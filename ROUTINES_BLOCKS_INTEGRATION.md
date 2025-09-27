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

## Example Day Flow

1. Configure a weekly Habit (e.g., "Gym") with days Mon/Wed/Fri at 07:00 and link it to a Goal.
2. Create a Chore (e.g., "Take bins out") with `RRULE:FREQ=WEEKLY;BYDAY=TH;INTERVAL=1` and set `DTSTART` to last Thursday 19:00. The UI shows the computed Next Due.
3. In the morning, open the app; the plan build collects today’s Habits/Chores and Tasks due today.
4. If a Calendar Block exists around 07:00, the Gym habit is nested under that block; otherwise it creates a child event at 07:00.
5. Mark the Chore as Done in Chores → the app immediately advances `nextDueAt` to the next Thursday 19:00.
6. Run “Sync Plan to Google Calendar” (manual or scheduled) to push child events; any deletions are reconciled on the next reconciliation pass.

Notes
- Habits list shows weekday chips for weekly frequency and allows inline time and active toggle updates.
- Chores list supports a quick “Mark Done” to advance `nextDueAt`; RRULE builder inputs help with FREQ, INTERVAL, and BYDAY.

## AI Routine Planner (Calendar Blocks)

- Frontend (Chores page) includes an “AI Routine Planner” action that invokes a Cloud Function `planRoutines`.
- The function reads:
  - Today’s active Habits (daily or weekly where `daysOfWeek` includes today)
  - Today’s due Chores (RRULE-based `nextDueAt`)
  - Existing `calendar_blocks` for conflicts
- It proposes short “soft” blocks and, when applied, writes `calendar_blocks` with:
  - `createdBy: 'ai'`, `status: 'proposed'`, `habitId` (for habits), `category: 'Chores'` (for chores)
  - A succinct `rationale` and conflict-avoidance nudges in 15-minute steps
- Use this as a deterministic base; the broader `planCalendar` function continues to schedule tasks/goals via LLM with validation.
