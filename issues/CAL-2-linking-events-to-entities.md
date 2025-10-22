# [CAL-2] Link events to Goal/Story/Task

- Labels: epic:AI-scheduling, calendar, firestore, ui

Description
Ensure two-way linking between calendar events/blocks and domain entities (goalId, storyId, taskId) with deep links and safe titles.

Acceptance Criteria
- applyCalendarBlocks stores link in scheduled_items and calendar_blocks
- Reconciliation preserves links and backfills missing links where possible
- UI displays linked goal/story/task chips

Dependencies
- applyCalendarBlocks, buildBlockPreviews, CalendarIntegrationView

Test Notes
- Link an event to a goal; verify deep link, preview, and block labels.
