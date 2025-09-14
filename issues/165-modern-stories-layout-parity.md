# 165 – Modern Stories page: layout parity with Goals + inline Tasks

- Type: enhancement
- Priority: P1

## Requirements
- Stories page adopts the Goals Management layout pattern:
  - Top filters row (search, status, priority, sprint, goal link)
  - Virtualized stories table (order, ref, title, description, goal, status, priority, effort, sprint, actions)
  - Green expand caret per row opens inline Modern Tasks table for the story
  - Inline “+ Add New Story” row at bottom (same UX as in Goals’ embedded stories grid)

## Acceptance
- Expand caret shows embedded ModernTaskTable for that story; tasks editable inline
- Add Story row creates and focuses the new story; activity stream logs creation
- Filter bar persists selections in localStorage and supports “Clear Filters”

## Notes
- Reuse components from Goals Management where possible to avoid duplication
- Keep sprint selector semantics aligned with global selector (All Sprints passthrough)

