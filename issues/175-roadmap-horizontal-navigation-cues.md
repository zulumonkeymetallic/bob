# 175 – Roadmap horizontal navigation lacks visible cues

- Type: UX
- Priority: P1 (major)
- Areas: Goals Roadmap, Scrolling

## Problem
In multi-year views the roadmap requires horizontal scrolling, but the scrollbar is hidden and there are no arrow controls or indicators that additional content exists.

## Acceptance Criteria
- Always display a visible horizontal scrollbar or provide dedicated left/right controls.
- Support click-and-drag panning (without needing Shift+scroll).
- Show the visible date range while panning (e.g., floating date indicator).

## Technical Notes
- Use `overflow-x: auto` with styled scrollbars.
- Add arrow buttons that scroll a fixed duration using `scrollBy`.
- Throttle scroll events and display a date indicator for context.
