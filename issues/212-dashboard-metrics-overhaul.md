# 212 – Unified Dashboard Metrics & Deep Links

## Summary
Revamp the main dashboard to surface key metrics across finance (Monzo), fitness, tasks/stories, and goal/sprint progress. Each metric card should link to a filtered drill-down view (Tasks list, Unified Planner, Checklist, etc.).

## Goals
- Display headline KPIs for Monzo budgets, fitness trends, open tasks, active stories, and goal/sprint progress.
- Integrate Checklist, Priority Items, and Unified Planner snapshots into the landing view.
- Enable click-through on any metric to open the relevant filtered list or planner state.
- Ensure data refresh aligns with scheduled jobs so numbers remain accurate.

## Non-Goals
- Redesign beyond the metric/interaction layer (overall layout can stay minimal).

## Tasks
- [ ] Define the KPI set and required Firestore queries/aggregations.
- [ ] Build dashboard cards with loading/error states and deep-link routing.
- [ ] Wire checklist/priority/planner modules so they respect dashboard filters when opened from KPIs.
- [ ] Update Daily Summary email (if needed) to match new KPIs.
- [ ] Add automated tests for metric calculations and navigation behaviour.

## Acceptance Criteria
- [ ] Dashboard shows real-time counts/percentages for finance, fitness, tasks, stories, goals/sprints.
- [ ] Clicking a metric routes to the corresponding filtered view (e.g., overdue tasks, sprint backlog).
- [ ] Checklist, Priority Items, and Unified Planner widgets remain visible and reactive.
- [ ] KPI data matches nightly/scheduled job outputs within acceptable lag.
