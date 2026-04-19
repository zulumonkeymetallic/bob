# [CAP-2] Planner Matrix DnD + persistence

- Labels: epic:AI-scheduling, capacity-planner, ui

Description
Enable drag & drop of stories across cells with rankByCell persistence and keyboard accessibility.

Acceptance Criteria
- DnD works across sprints and goals
- rankByCell maintained; ARIA patterns respected

Dependencies
- SprintPlannerMatrix, Firestore write model

Test Notes
- Drag story across cells; verify persisted order.
