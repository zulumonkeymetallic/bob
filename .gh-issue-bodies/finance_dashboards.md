**Description**
Interactive dashboards to visualise current spend vs. budget, pot allocations, and goal readiness.

**Acceptance Criteria**
- [ ] Current spend card (MTD + rolling averages).
- [ ] Goals funding view (% funded).
- [ ] YoY plan chart with gaps highlighted.
- [ ] Links to underlying transactions/goals.
- [ ] Dashboard under Finance menu.

**Proposed Technical Implementation**
- React `FinanceDashboard` with Recharts.
- Firestore composite indexes + scheduled aggregates.
- Deep links to `/finance/transactions` and `/goals/{id}`.
- Feature flag `features.finance=true`.
