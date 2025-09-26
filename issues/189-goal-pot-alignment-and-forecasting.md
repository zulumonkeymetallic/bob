# 189 – Align Monzo pots with Bob goals and forecast savings timelines

- Type: feature / planning
- Priority: P1 (major)
- Areas: Goals, Themes, Financial Planning

## Problem
Goals and themes in Bob are not connected to Monzo pots, so users cannot see real-time funding progress or estimated completion dates.

## Acceptance Criteria
- Map Monzo pots to Bob goals automatically based on naming conventions or explicit user linking.
- Roll up goal "estimated cost" totals per theme and compare with available pot balances.
- Calculate projected time-to-fund using recent contribution velocity and budget surplus estimates.
- Surface warnings when goals lack an aligned pot or when funding pace falls behind targets.
- Provide an API/selector for users to override or confirm pot-goal mappings.

## Technical Notes
- Store pot-to-goal relationships in Firestore (e.g., `goalFunding.potId`, `allocationRules`).
- Use transaction categorisation from issue #188 to identify contributions vs spend for velocity calculations.
- Derive theme-level summaries via aggregation: total goal cost, funded amount, deficit, projected completion date.
- Update dashboard widgets to ingest the aggregated data once available.
