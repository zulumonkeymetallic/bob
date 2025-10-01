# 192 – Task sprint alignment & due date validation

- Type: feature
- Priority: P1
- Areas: Tasks, Sprints, Validation

## Scope
- Expose sprint membership directly on all task list/table views, keeping the sprint column in sync with linked stories.
- When a task is linked to a story, inherit the story’s sprint automatically and block/notify when a task due date falls outside that sprint window.
- For standalone tasks (no story link), auto-assign sprint based on due date falling inside an active sprint window.
- Ensure Kanban/modern tables show the derived sprint data consistently across personal/work personas.

## Acceptance Criteria
- Task list(s) display sprint names for every task; sprint column reflects derived sprint without requiring manual entry.
- Editing a task that belongs to a story prevents saving a due date that lies outside the story sprint; a user-friendly toast/alert is shown.
- Standalone tasks pick up a sprint automatically when their due date lies inside a sprint window and drop the sprint when the date falls outside all windows.
- Kanban board continues to surface tasks based on sprint membership after the inheritance logic applies.

## Technical Notes
- Update React task management components (`TasksList`, enhanced variants, sidebar editor) to run sprint inheritance/validation before calling `updateDoc`.
- Add helper(s) for sprint lookup & Ranger comparisons (inclusive of sprint start/end timestamps).
- Prefer reusing existing alert/logging utilities for feedback until a toast system ships.
