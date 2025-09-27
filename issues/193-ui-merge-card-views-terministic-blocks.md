# 193 – UI: Merge Card-Based Views & Preserve Terministic Calendar Blocks

## Summary
Consolidate the two existing card UIs into a single, consistent implementation that preserves the "Terministic Calendar Blocks" concept. Unify styling, sizing, zoom behaviour, drag/resize, and context menus; remove duplicate components and dead code.

## Acceptance Criteria
- A single Card component library is used across Roadmap and Kanban.
- Zooming keeps card text readable and card sizing consistent at multiple scales.
- Dragging and resizing works smoothly; cards never disappear behind date bars; sticky headers remain visible.
- Context menus and keyboard shortcuts behave consistently.
- No duplicate view logic; one source of truth.

## Proposed Technical Approach
- Create a `ui/cards` package with primitives (Card, CardGrid, CardBlock, CardMenu).
- Extract shared drag/resize hooks; standardise z-index/stacking.
- Implement a zoom manager with breakpoints and clamped font scaling.
- Refactor date bar to `position: sticky` with intersection observers to avoid overlap.
- Remove deprecated components; add storybook docs.

## Scope and Related Issues
- Supersedes/aggregates roadmap card UX items:
  - 172 – Roadmap card layout and text scaling
  - 173 – Roadmap drag-and-drop duplication
  - 174 – Action icons too small; misclicks
  - 175 – Horizontal navigation cues
  - 176 – Header sticky + layering
  - 179 – Drag/create performance
  - 180 – Toast and error feedback consistency
- Keep specific bugs (above) open for targeted fixes; close/merge into this epic when resolved.
