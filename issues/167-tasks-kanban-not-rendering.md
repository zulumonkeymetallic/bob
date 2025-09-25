# 167 – Tasks Kanban view does not render (blocking DnD testing)

- Type: bug
- Priority: P0 (critical)
- Areas: Tasks, Kanban, Drag-and-drop

## Problem
Selecting the Kanban/Board view under Tasks leaves the page in list mode. No columns render, so drag-and-drop can not be exercised.

## Steps to Reproduce
1. Sign in to the web app.
2. Navigate to `Tasks`.
3. Click `Task Board` or the `Switch to Kanban` control.

## Expected Behaviour
- The board view loads with standard columns (Backlog, Ready, Doing, Done).
- Tasks can be dragged between columns and the status change persists after refresh.
- Order changes within a column persist.

## Actual Behaviour
- The screen stays on the list layout; no board columns appear.
- Drag-and-drop cannot be exercised.

## Acceptance Criteria
- Rendering a Kanban board switches the layout to columnar view with task cards.
- Dragging between columns updates the underlying status and survives a reload.
- Reordering inside a column is saved and reflected after a refresh.

## Technical Notes
- Inspect the router/feature flag gating for `/tasks/board`.
- Ensure the Kanban component mounts and receives data; consider leveraging `@dnd-kit` for drag interactions and persisting updates via Firestore/API.
