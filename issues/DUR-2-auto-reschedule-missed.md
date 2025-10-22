# [DUR-2] Auto-reschedule missed blocks

- Labels: epic:AI-scheduling, planner

Description
When planned blocks are missed, backfill to the next feasible slot within policy windows.

Acceptance Criteria
- Missed blocks detected by end time
- New blocks created or tasks re-queued with updated due

Dependencies
- scheduled_instances, planCalendar or planBlocksV2

Test Notes
- Simulate missed blocks; verify backfill placement.
