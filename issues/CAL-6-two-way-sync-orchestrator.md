# [CAL-6] Two-way sync orchestrator callable

- Labels: epic:AI-scheduling, calendar, firestore

Description
Expose a single callable (syncCalendarAndTasks) that runs GCal→Firestore reconciliation and Firestore→GCal push with summarized results and audit.

Acceptance Criteria
- Callable exists and delegates to existing functions
- Returns reconciled/pushed counts
- Writes sanitized activity_stream entry

Dependencies
- functions/index.js new wrapper

Test Notes
- Call syncCalendarAndTasks; verify result counters and activity entry.
