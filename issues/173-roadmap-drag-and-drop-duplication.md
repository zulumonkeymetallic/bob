# 173 – Goals Roadmap drag-and-drop duplicates items and triggers unrelated actions

- Type: bug
- Priority: P1 (major)
- Areas: Goals Roadmap, Drag-and-drop

## Problem
Dragging goal bars horizontally or vertically is unreliable: bars duplicate, jump themes, or trigger unrelated actions (e.g., Add Note modal) mid-drag.

## Steps to Reproduce
1. Open the Goals Roadmap.
2. Hover a goal bar to show action icons.
3. Drag the bar horizontally to reschedule, or vertically to another theme.

## Expected Behaviour
- Dedicated drag handles allow adjusting start/end dates or moving the bar without triggering note/edit buttons.
- Vertical moves prompt for confirmation before reassigning the goal’s theme.

## Actual Behaviour
- Duplicate bars appear or the item teleports; the Add Note modal can open during the drag.

## Acceptance Criteria
- Provide clear drag handles (edges for resizing, central grip for move).
- Disable other action buttons while dragging.
- Prompt before committing theme changes and ensure only one instance of the bar exists after drop.

## Technical Notes
- Use `@dnd-kit` multi-handle support or similar to separate resize vs. move interactions.
- Suppress click handlers while drag state is active.
