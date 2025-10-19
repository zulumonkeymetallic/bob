Title: Planner · Pending Approvals Badge + Approvals Center

Description
- Surface pending daily plan proposals prominently with a badge in the header and a dedicated Approvals Center.
- One-click open the latest proposal; show list history with status and links to /planning/approval.

Acceptance Criteria
- [ ] Header shows a badge with pending count when user has proposed planning jobs (`planning_jobs.status == 'proposed'`).
- [ ] Approvals Center page lists proposals with score, block count, and deep links to approve.
- [ ] Polling or listener updates badge in real time; dismisses when approved/applied.

Technical Plan
- Client: add Approvals badge component (subscribe to `planning_jobs` by ownerUid where status='proposed').
- Route: `/planning/approvals` summary table with deep-link to approval page.
- Index: composite on `planning_jobs.userId + status + completedAt` for ordering.

