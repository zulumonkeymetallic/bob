**Description**
Compute if current saving/spend trajectory meets Goals by year; calculate gaps and savings recommendations per Theme and overall.

**Acceptance Criteria**
- [ ] Show required vs. available budget per Theme/year.
- [ ] “On Track / At Risk / Off Track” status shown per Theme and overall.
- [ ] Recommendations include monthly save targets per Pot.
- [ ] Export CSV of year-on-year plan.

**Proposed Technical Implementation**
- Cloud Function `budgetPlanCompute` processes Monzo + Goal rollups.
- Inputs: pot balances, average inflows/outflows, goal estimates.
- Outputs: `/finance/plan/{year}` with status + recommendations.
- Optionally add LLM narrative summaries.
