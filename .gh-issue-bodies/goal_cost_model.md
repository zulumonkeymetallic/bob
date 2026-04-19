**Description**
Add budgeting fields to Goals and Themes, then roll up estimated costs across Goals to Theme-level budgets.

**Acceptance Criteria**
- [ ] Each Goal has `estimated_cost`, `cost_type` (one_off|recurring), `recurrence` (monthly|annual), `target_year`, and optional `pot_id` mapping.
- [ ] Theme shows total of Goal estimates by year and overall.
- [ ] Validation warns when a Goal lacks cost metadata.
- [ ] Admin UI to edit cost fields in-place (inline table or modal).

**Proposed Technical Implementation**
- Schema: `/goals/{id}` add cost fields.
- Schema: `/themes/{id}` add rollups.
- Cloud Function `recalcThemeBudget` triggers on Goal writes.
- Unit tests for edge cases.
