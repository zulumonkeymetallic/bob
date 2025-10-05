# 207 – AI scheduler due-date adjustments & dependency handling

- Type: automation / scheduler
- Priority: P0
- Areas: Scheduler, Tasks, Stories, Calendar, Reminders

## Problem
Existing scheduling tickets cover calendar blocking but ignore the daily 06:00 due-date recalibration, dependency handling, and iOS Reminders sync mandated by the requirements spec. We need deterministically scheduled adjustments with conflict resolution and change reporting.

## Requirements
1. **Execution Cadence**
   - Run scheduler daily at 06:00 (aligned with Daily Summary generation) after pulling calendar availability.
   - Allow manual trigger and backfill runs.
2. **Inputs**
   - Calendar availability (busy/fixed events) from Google Calendar + internal blocks.
   - Task/story priority signals (importanceScore, due dates, overdue status).
   - Dependency graph between stories/tasks.
   - Theme/goal targets for balanced distribution.
3. **Rules**
   - Reschedule lowest-priority items first when conflicts arise.
   - Never override externally fixed events or user-marked immovable deadlines.
   - Respect work-hour windows, quiet hours, and recovery buffers.
   - Propagate dependency changes (e.g., move predecessor earlier).
4. **Outputs**
   - Update Firebase records with new due dates / scheduled start-end times.
   - Sync updates into iOS Reminders immediately.
   - Emit change log for Daily Summary Email (issue 204) highlighting adjustments.
   - Write audit entry with reason codes (e.g., `conflict:meeting`, `overdue:auto-pull-forward`).
5. **Monitoring**
   - Capture metrics on number of items moved, conflicts resolved, items skipped.
   - Expose latest run status in admin panel.

## Acceptance Criteria
- [ ] Scheduler runs daily at 06:00 and processes all active tasks/stories.
- [ ] Conflicts are resolved without overwriting fixed events; violations trigger alerts.
- [ ] Due date changes sync to iOS Reminders within the same run.
- [ ] Change log feeds into Daily Summary Email with human-readable highlights.
- [ ] Dependency constraints are honored, with blockers surfaced when unsatisfied.

## Dependencies
- Calendar block review (issue 209) for accurate availability extraction.
- Reminders sync stability (`issues/163`, `BOB-007`).

## Notes
- Consider storing scheduler decisions for explainability in UI.
- Support dry-run mode for QA to validate adjustments before production rollout.
