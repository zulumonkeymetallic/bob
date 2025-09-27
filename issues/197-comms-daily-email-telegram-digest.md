# 197 – Comms: Daily Email & Telegram Digest

## Summary
Generate and send a morning digest summarising today’s priorities, events, overdue items, habit targets, and macros.

## Acceptance Criteria
- Email + Telegram arrive by configurable time (e.g., 07:00 local).
- Includes today’s blocks, top 5 tasks, overdue list, macros from MyFitnessPal, and recovery tips.
- Links jump to relevant BOB views.

## Proposed Technical Approach
- Cloud Scheduler triggers Cloud Function; render MJML/HTML for email and Markdown for Telegram.
- Telegram via Bot API; email via SendGrid/SES.
- Respect time‑zones; daylight‑saving safe.

## Data Model / Schema
- `user_prefs.digest_time`, `last_sent_at`, `delivery_status`.

## Testing & QA
- Snapshot tests for templates; integration tests for Telegram and email APIs.

