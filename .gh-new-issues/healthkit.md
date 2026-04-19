**Description**
Ingest Apple HealthKit metrics and surface insights/nudges in BOB with privacy controls.

**Acceptance Criteria**
- [ ] User can enable/disable HealthKit metrics (HRV, VO₂ Max, resting HR, steps).
- [ ] Data ingested daily + on-demand; owner-scoped Firestore collections.
- [ ] Insights computed (trends, thresholds) with optional nudges to Priorities.
- [ ] Privacy: clear data export/delete; consent logged.

**Proposed Technical Implementation**
- iOS app or Shortcuts-based ingestion → HTTPS Callable in Firebase Functions.
- Collections: `/health/hkDaily/{date}`, `/health/insights/{date}`.
- Optional n8n nightly job to reconcile and backfill.
