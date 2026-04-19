# 190 – Build unified financial dashboard integrating Monzo data with Bob goals

- Type: feature / UI
- Priority: P1 (major)
- Areas: Dashboard, Goals, Budgeting

## Problem
Bob lacks a single dashboard that merges Monzo spend, budgets, goal funding status, and savings forecasts, forcing users to juggle multiple views.

## Acceptance Criteria
- Create a central dashboard card layout showing: total spend vs budget, pot balances, goal funding progress, and savings runway.
- Include quick filters per theme/goal and highlight mandatory vs optional spend totals for the current cycle.
- Display trend charts (month-to-date, last 90 days) and snowball projections from issue #188.
- Provide actionable prompts (e.g., "transfer £X to Goal A pot to stay on track").
- Ensure responsive design for desktop and mobile, reusing existing Bob design tokens.

## Technical Notes
- Reuse data models created in issues #187-#189; avoid duplicating aggregation logic client-side.
- Implement new React components under `react-app/src/components/finance/` with shared hooks for fetching analytics.
- Leverage lazy loading or suspense to keep initial load performant; show skeleton states during data fetch.
- Coordinate with theming and accessibility guidelines (keyboard navigation, high contrast states).
