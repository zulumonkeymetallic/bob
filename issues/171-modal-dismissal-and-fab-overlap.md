# 171 – Modals lack backdrop dismissal; FAB overlaps actionable controls

- Type: bug / UX
- Priority: P1 (major)
- Areas: Modal framework, Floating Action Button

## Problems
1. Create/Edit modals only close via the “X” button. Clicking outside or pressing Esc has no effect.
2. The floating action button (FAB) quick menu can overlap list/table action icons, leading to accidental clicks.

## Acceptance Criteria
- Modals close when the user clicks the backdrop or presses Escape, unless unsaved changes exist (prompt to confirm in that case).
- The FAB auto-repositions or hides if it would cover actionable UI elements.

## Technical Notes
- Ensure bootstrap/React-Bootstrap modals are configured with `backdrop` and `keyboard` dismissal.
- Add viewport collision detection for the FAB menu; reposition based on scroll/viewport or collapse automatically.
