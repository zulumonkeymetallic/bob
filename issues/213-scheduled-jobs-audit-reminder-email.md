# 213 – Scheduled Jobs Audit & Reminder Email Reliability

## Summary
Audit all Cloud Function schedules, document runtimes, and address reliability gaps. Ensure reminder emails (daily summary, data quality, and any outstanding reminder digest) trigger consistently.

## Goals
- Inventory every scheduled job (frequency, timezone, expected duration) and document in repo.
- Add monitoring/logging for missed windows or quota errors (e.g., Firebase 429s).
- Verify reminder-related emails send within configured windows; implement retries/backoff if needed.
- Provide a dashboard or report summarising last-run status for automations.

## Non-Goals
- Rewriting existing automations beyond reliability/observability fixes.

## Tasks
- [ ] Generate schedule matrix (function name, cron, timezone, description) and publish in docs.
- [ ] Add structured logging/metrics for schedule start/end, errors, and skips.
- [ ] Review email dispatch pipelines; add retries/grace windows where missing.
- [ ] Surface automation status in admin UI or Firestore collection with timestamps.
- [ ] Write incident playbook for quota or auth failures.

## Acceptance Criteria
- [ ] Documentation lists every scheduled automation with timing details.
- [ ] Operators can view last success/error for each automation.
- [ ] Reminder emails land within their window for multiple consecutive days in test.
- [ ] Errors/quota issues raise actionable logs or alerts.
