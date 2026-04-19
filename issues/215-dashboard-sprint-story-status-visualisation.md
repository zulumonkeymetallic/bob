# 215 – Dashboard Sprint Story Status Visualisation

## Summary
Add a dashboard widget that visualises the current sprint’s story status distribution (e.g., pie chart). Each segment should be clickable, revealing the stories/tasks in that status.

## Goals
- Pull stories assigned to the currently selected sprint (per SprintContext).
- Render a status distribution chart (pie/donut or stacked bar) on the dashboard.
- Support drill-through to filtered Stories/Tasks views for each status.
- Handle empty sprint gracefully.

## Non-Goals
- Historical trend charts (future work).
- Sprint velocity analytics.

## Tasks
- [ ] Fetch sprint stories with status counts in Dashboard data hook.
- [ ] Render chart component with accessible labels and segment click handlers.
- [ ] Wire segment clicks to open Stories page filtered by sprint + status, with secondary link for tasks in those stories.
- [ ] Update dashboard layout to accommodate the new widget.
- [ ] Document QA steps.

## Acceptance Criteria
- [ ] Dashboard surfaces a sprint story status chart when a sprint is selected.
- [ ] Clicking a status segment navigates to Stories Management filtered appropriately (and optionally tasks subset).
- [ ] Widget handles no stories / no sprint gracefully.
