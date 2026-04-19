# [CAP-4] Planner E2E smoke tests

- Labels: epic:AI-scheduling, capacity-planner, ui

Description
Add minimal Playwright tests to render Planner Matrix and verify key elements.

Acceptance Criteria
- Spec opens /sprints/planner and finds headers/cells
- Runs in CI without external secrets

Dependencies
- Playwright config

Test Notes
- Headless run verifying presence of matrix headers and at least one cell.
