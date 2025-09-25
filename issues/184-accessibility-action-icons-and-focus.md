# 184 – Improve accessibility for action icons and focus states

- Type: enhancement
- Priority: P2 (minor)
- Areas: Accessibility, UI controls

## Problem
Many action icons lack `aria-label`s, tooltips, and focus outlines. Keyboard navigation is difficult and focus order is unclear.

## Acceptance Criteria
- All icon buttons provide descriptive `aria-label`s and visible tooltips.
- Keyboard users can tab through controls with visible focus indicators.
- Ensure tab order follows logical reading order.

## Technical Notes
- Audit icon buttons across Goals, Stories, Tasks, Roadmap.
- Apply consistent focus styles (e.g., outline using theme color).
