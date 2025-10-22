# [DUR-3] Backfill estimates and rescheduling

- Labels: epic:AI-scheduling, planner, LLM

Description
Populate missing task estimates via Gemini and re-plan to fill capacity windows.

Acceptance Criteria
- autoEnrichTasks adds estimateMin for tasks without estimation
- Planner incorporates new estimates into next run

Dependencies
- autoEnrichTasks, planCalendar

Test Notes
- Run autoEnrichTasks then planner; verify blocks reflect new estimates.
