**Description**
Standardize CSV/Export endpoints for Finance (plan, transactions) and Health (nutrition, activities), with scheduled exports.

**Acceptance Criteria**
- [ ] CSV export for Budget Plan per year (#222) and transactions (#220).
- [ ] CSV export for MFP daily totals (#228) and Strava activities.
- [ ] n8n scheduled export jobs to file/email with owner scoping.

**Proposed Technical Implementation**
- n8n-centric: scheduled jobs generate CSVs → email or storage.
- Functions: provide signed export endpoints for on-demand CSV generation.
