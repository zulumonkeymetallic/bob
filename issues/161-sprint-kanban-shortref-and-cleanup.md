# 161 – Sprint Kanban: replace raw sprintId with short reference; remove stray text

- Type: bugfix / UX polish
- Priority: P1
- Affects: Sprint Kanban header display
- Status: Fixed in repo (pending deploy)

## Summary
The Sprint Kanban header showed verbose text including the raw `sprintId` (e.g., “Showing stories with sprintId \"4FZFL542hZsV42fDhPDR\"”) and, in some cases, stray react-aria identifiers appeared.

## Fix
- Replace raw `sprintId` with a short, human-friendly reference code (e.g., `SP-YY7AID`).
- Remove the parenthetical block that exposed the raw ID.

## Implementation
- `react-app/src/components/SprintKanbanPage.tsx`:
  - Import `displayRefForEntity` and render a badge with `SP-XXXXXX` based on the sprint id.
  - Remove the raw `sprintId` parenthetical text.

## Notes
- Could not reproduce the exact `#react-aria…` text on the current Kanban route (`/sprints/kanban`). The legacy `KanbanPage` is not in use; if this resurfaces, capture a screenshot/DOM for a targeted fix.

