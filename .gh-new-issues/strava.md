**Description**
Connect Strava to import activities and summarize trends for planning.

**Acceptance Criteria**
- [ ] OAuth connect/disconnect; webhook verification.
- [ ] Import recent activities + incremental updates within minutes.
- [ ] Summaries (weekly totals, long runs) available to insights and scheduler.
- [ ] Privacy controls and token revocation.

**Proposed Technical Implementation**
- Functions: OAuth + webhook signature verification + secure upsert endpoints.
- n8n: Backfill + incremental fetch jobs → call Function to upsert docs.
- Collections: `/health/stravaActivities`, `/health/insights`.
