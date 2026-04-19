# 178 – Establish automated regression test suite

- Type: enhancement
- Priority: P0 (critical)
- Areas: Testing, CI

## Problem
There is no automated coverage for core flows (CRUD, Kanban, Roadmap interactions). Regressions go undetected.

## Acceptance Criteria
- Implement end-to-end tests covering: creating/editing goals/stories/tasks, duplicate prevention, drag-and-drop in Kanban and Roadmap, sprint date persistence.
- Integrate tests into CI with pass/fail outputs.

## Technical Notes
- Use Playwright or Cypress with seeded test data for deterministic runs.
- Provide helpers to authenticate test users and clean up after runs.
