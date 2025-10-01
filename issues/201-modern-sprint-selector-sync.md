# 201 – Modern tables respect global sprint selector

- Type: bug
- Priority: P1
- Areas: Sprints UI, ModernTaskTable, ModernSprintTable

## Scope
- Ensure sprint-aware views (Modern Sprint Table, Modern Task Table, current sprint panel) react to changes from the global `useSprint()` selector.
- Update Firestore listeners so switching the sprint filters the data instead of requiring a reload.

## Acceptance Criteria
- Changing the sprint selector updates both tables immediately (tasks + stories tied to that sprint only).
- No stale data remains when toggling between sprints or selecting “All”.
- Works in SprintManagementViewNew, ModernKanbanPage, and any wrappers using ModernTaskTable.

## Notes
- Currently tables use internal state and do not subscribe to `selectedSprintId`.
- Likely requires passing the context value downstream and refreshing queries.
