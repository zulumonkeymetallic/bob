# 205 – Data Quality Email automation

- Type: feature / monitoring
- Priority: P0
- Areas: Email, Data Integrity, AI Automation

## Problem
There is no dedicated reporting channel for automation hygiene. The spec requires a 19:00 daily Data Quality Email summarizing AI conversions, dedupes, missing metadata, and goal linkage gaps so the user can intervene quickly.

## Requirements
1. **Delivery**
   - Schedule send at 19:00 local time (configurable per environment/user).
   - Provide manual trigger callable and rerun instructions for support.
2. **Content Sections**
   - Task→Story conversions (count, list with source/destination IDs, acceptance criteria status).
   - Duplicates detected & resolved (show original vs retained references, merge notes).
   - Stories/tasks missing acceptance criteria, with indicator if AI auto-filled vs still outstanding.
   - Stories lacking goal linkage (highlight blocking items and quick-fix deep links).
   - Summary stats (totals per section, previous day comparison).
3. **Data Sources**
   - Firebase activity stream entries tagged `AI_Agent` / `Conversion`, dedupe logs, validation failures.
   - Reminder/Calendar notes for tracing source system updates.
4. **Alerting**
   - Flag items requiring manual action (e.g., link missing goal) in a dedicated call-to-action banner.
   - Record delivery outcome in monitoring dashboard.
5. **Configuration**
   - Support per-profile opt-in/out, timezone, and target email.
   - Expose last-run status in admin UI/logs.

## Acceptance Criteria
- [ ] Email sends at 19:00 daily with configurable timezone overrides.
- [ ] Each section lists deep-link references with the specified metadata.
- [ ] Outstanding goal linkage gaps are clearly highlighted with actionable links.
- [ ] Delivery and generation errors are logged with rerun guidance.
- [ ] Callable/manual trigger produces identical output.

## Dependencies
- Conversion automation telemetry (issue 206) for reliable source data.
- Duplicate validation improvements (`issues/169`, `181`).

## Notes
- Template must stay lightweight; consider text + simple tables rather than heavy HTML if volume grows.
- Ensure PII compliance when sharing dedupe details (no raw tokens or secrets).
