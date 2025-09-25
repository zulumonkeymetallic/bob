# 174 – Goal card action icons too small; easy to misclick destructive actions

- Type: UX
- Priority: P1 (major)
- Areas: Goals Roadmap

## Problem
Note/edit/duplicate/delete icons on goal cards are tightly clustered and small. Users unintentionally hit the trash icon, deleting items without confirmation.

## Acceptance Criteria
- Increase icon size and spacing to meet accessibility touch targets.
- Move destructive actions behind a confirmation dialog or nested menu.
- Provide tooltips/aria-labels and an undo toast on delete.

## Technical Notes
- Consider a context menu triggered by a kebab icon with grouped actions.
- Add an undo action in a toast and ensure delete flows require explicit confirmation.
