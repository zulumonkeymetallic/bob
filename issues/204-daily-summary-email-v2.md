# 204 – Daily Summary Email v2

- Type: feature / productized automation
- Priority: P0
- Areas: Email, Scheduler, Tasks, Stories, Calendar, Health

## Problem
Current digest tickets only address a lightweight priority email and miss the comprehensive specification for the Daily Summary Email. We need a single source of truth that drives a 06:00 local-time send with fully structured tables, deep links, and blended data across Firebase, Reminders, calendar blocks, world summary, and fitness metrics.

## Requirements
1. **Delivery**
   - Trigger at 06:00 local time for each profile; support per-user timezone overrides.
   - Retry on failure with alerting into Ops channel / logging.
   - Allow manual re-run via callable (`sendDailySummaryNow`).
2. **Table 1 – Tasks Due Today**
   - Group hierarchy: Theme → Goal → Story → Task.
   - Fields: deep-link Reference ID (`/task/TASK-####`), Task Description, Due Date, Status, Latest Activity Comment, inherited Theme/Goal/Story context.
   - Data sources: Firebase task collection + global activity stream; Reminders sync for tasks originating in iOS.
   - Sorting: Theme, Goal, Story, Task Due Date (ascending).
3. **Table 2 – Stories to Start**
   - Group by Goal; sort by Sprint Due Date.
   - Fields: deep-link Reference ID (`/story/STRY-####`), Story Description, Acceptance Criteria (bullet list), Sprint Due Date, Status, Latest Comment.
   - Pull acceptance criteria and comments from story docs + activity stream.
4. **Priorities Section**
   - Top 3 actionable priorities (tasks or stories) based on importanceScore + upcoming deadlines.
   - Highlight schedule exposures or overdue work.
   - Include today’s calendar blocks (see §6) with Theme, linked stories/tasks, deep links, and allocated time in human-readable order.
5. **World Summary**
   - Curated news/weather snippet per user location (allow provider configuration).
6. **Fitness Section**
   - Last logged run/workout (Strava/Runna).
   - HR, VO₂ Max, HRV trendlines (Apple Health aggregation) with red flag indicators for fatigue/poor recovery.
   - Call out alerts when metrics fall below configured thresholds.
7. **Presentation**
   - Mobile-friendly HTML; tables responsive and scannable.
   - Localize date/time formatting to user preference.
   - Provide unsubscribe/notification controls.

## Acceptance Criteria
- [ ] Email sends daily at 06:00 local time and logs success/failures.
- [ ] Tasks table renders with correct hierarchy, deep links, latest comments, and ordered columns.
- [ ] Stories table renders grouped by Goal, sorted by sprint due date, with acceptance criteria bullets.
- [ ] Priorities section surfaces top 3 priorities and enumerates today’s calendar blocks with deep links.
- [ ] World summary and fitness sections populate with live data and flag anomalies.
- [ ] Manual re-send callable works and respects per-user tz.

## Dependencies
- Activity stream completeness (issue 169) for latest comment lookups.
- Calendar block engine review (issue 209) for block data consistency.
- Scheduler adjustments (issue 207) to feed change highlights.
- Health integrations (`BOB-005`) for metric ingestion.

## Notes
- Reuse Mailjet templates but extend components for hierarchical tables.
- Ensure data access respects per-entity ACLs before rendering email.
