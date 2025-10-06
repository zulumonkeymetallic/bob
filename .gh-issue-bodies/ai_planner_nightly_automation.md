## 🚨 Critical Defect: AI planner auto-plan / 24h rebalance failing

**Priority:** Critical  
**Component:** Unified Planner (React) + Cloud Function `planBlocksV2` & scheduler jobs  
**Version:** v3.9.1  
**Environment:** Production

### Summary
User-triggered "Auto-plan with AI" and "Rebalance next 24h" actions error with: `Could not trigger the 24h rebalance. Try again shortly.` The nightly automation that should run at 02:00 to prepare the day’s schedule is not producing blocks, leaving the daily email without prioritized content.

### Observed Errors
- Frontend feedback toast displays failure.  
- Diagnostics log captures `permission-denied` from Firestore query on `scheduled_instances` (missing composite index) and generic exception fallback.  
- No scheduler jobs writing to `planning_jobs` or `scheduled_instances`.

### Business Impact
- Daily plan is never generated automatically.  
- Chores/routines/tasks remain unscheduled, undermining entire morning workflow.  
- Daily summary email lacks prioritized assignments.

### Root-Cause Hypotheses
1. Firestore index missing for `scheduled_instances` query (`ownerUid`, `occurrenceDate`).  
2. Planner job should read from `calendar_blocks` only, but solver expects `blocks` collection (legacy deterministic engine).  
3. Cron-based automation not implemented or misconfigured (no 02:00 run to pre-plan day).

### Required Fixes
1. **Firestore**: add composite index `scheduled_instances(ownerUid asc, occurrenceDate asc)` and deploy.  
2. **Backend**: ensure `planBlocksV2` and nightly job create deterministic planning window:
   - Query both `blocks` and new focus-block definitions.  
   - Handle missing planner blocks gracefully (log actionable warning).  
3. **Job Orchestration**: implement scheduled function `nightlyPlannerRollup` @ 02:00 local:  
   - Run AI planner for next day (tasks, chores, routines).  
   - Persist results to `scheduled_instances`.  
   - Trigger Google Calendar sync + reminder generation pipeline.  
   - Update `automation_runs` with success/error.
4. **Frontend**: surface clearer error when auto-plan fails and prompt user to check Diagnostics tab.

### Acceptance Criteria
- [ ] `gh` auto-plan succeeds manually from Unified Planner.  
- [ ] Scheduled 02:00 job populates next day’s plan for test user.  
- [ ] Daily summary at 06:00 reflects planned assignments.  
- [ ] Diagnostics log shows success entries (and detailed failure if any regression).  
- [ ] Documentation updated for operations playbook.

### Attachments
- Console error screenshot (2025-10-05T14:15:39Z).  
- Diagnostics log export (see Settings → Diagnostics).
