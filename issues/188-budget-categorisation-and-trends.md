# 188 – Categorise Monzo spend and surface snowball budgeting insights

- Type: feature / analytics
- Priority: P1 (major)
- Areas: Budgeting, Analytics, UI

## Problem
Raw Monzo transactions lack the categorisation and trend analysis required for Bob's budgeting dashboard and snowball planning.

## Acceptance Criteria
- Allow users to label each transaction (mandatory, optional, savings transfer) with quick-edit shortcuts.
- Auto-suggest categories based on Monzo metadata and learned user preferences.
- Present trend charts (weekly/monthly) for spend totals per category and highlight variances against planned budgets.
- Generate a "snowball" view that sequences debt/goal contributions based on surplus funds and mandatory spend baselines.
- Expose APIs/UI endpoints that the dashboard can query for aggregated totals and deltas.

## Technical Notes
- Persist categorisation metadata alongside transaction docs (e.g., `category`, `subCategory`, `userLabel`, `isMandatory`).
- Build Cloud Function aggregations or Firestore aggregation documents to support dashboard queries without heavy client computation.
- Consider storing historical snapshots for trend lines; use BigQuery export if Firestore aggregation becomes limiting.
- Integrate with existing budgeting models to share definitions of mandatory vs optional spend.
