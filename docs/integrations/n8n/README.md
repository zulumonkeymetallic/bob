# n8n Integrations for BOB

This folder documents how BOB uses n8n to orchestrate external integrations (Calendar, Reminders, Finance, Health) while keeping deterministic business logic and security-sensitive pieces in Firebase Functions.

Principles
- Keep scheduling/compute in Firebase Functions; do external API I/O in n8n.
- Use Firestore documents as the contract between Functions and n8n (intent → status → result).
- Enforce idempotency with composite keys (e.g., `storyId+start`) and `status` fields.
- Prefer n8n cron and webhook triggers; backstop with Cloud Scheduler where needed.

Workflows (stubs in `workflows/`)
- bob_daily_summary_v1 (Issue #218)
  - Trigger: Cron (default 07:00, configurable)
  - Inputs: Firestore query params (user, timeframe)
  - Outputs: Email via SendGrid/SMTP, Telegram message, Firestore `/summaries` log
- bob_calendar_sync_v1 (Issue #226)
  - Trigger: Firestore event doc or HTTP webhook from Functions
  - Inputs: `/calendar/events` doc with `{storyId, blockId, start, end, status}`
  - Outputs: Google Calendar create/update/delete; updates `gcalEventId`, `status`, `lastAttempt`
- bob_monzo_sync_v1 (Issue #220)
  - Trigger: Cron (15m) + webhook fallback
  - Inputs: Secured sync token from Functions; account IDs
  - Outputs: `/finance/accounts`, `/finance/pots`, `/finance/transactions`, `/logs/finance_sync`
- bob_reminders_bridge_v1 (Issue #215)
  - Trigger: iOS Shortcuts / Webhook
  - Inputs: task create/complete payload with `ref`
  - Outputs: Firestore task updates; reconciliation report
- bob_routines_calendar_v1 (Issue #227)
  - Trigger: New `/routine_instances` docs
  - Inputs: `{title, rrule/date, durationMin, pushToCalendar, pushToReminders}`
  - Outputs: Calendar/Reminders entries; instance status back to Firestore
- bob_mfp_ingest_v1 (Issue #228)
  - Trigger: Cron (daily) or file/email ingest
  - Inputs: Daily totals and meals
  - Outputs: `/health/mfpDaily/{yyyy-mm-dd}`, triggers adherence compute

Firestore Contracts (core)
- `/calendar/events/{id}`: `{storyId, blockId, start, end, status: 'pending'|'sent'|'error', gcalEventId?, source, lastAttempt?, error?}`
- `/summaries/{uid:date}`: `{uid, date, subject, html, telegramMessageId?, sentAt}`
- `/finance/*`: `accounts`, `pots`, `transactions` (normalized, owner-scoped)
- `/health/mfpDaily/{yyyy-mm-dd}` and `/health/insights/{yyyy-mm-dd}`
- `/routine_instances/{id}` with scheduling/completion state

Security
- OAuth/token handling and signature verification live in Firebase Functions.
- n8n calls a secured HTTPS Callable/HTTP endpoint exposed by Functions to write to Firestore.

Importing the stubs
- Use the JSON files in `workflows/` as starting points; update credentials and node params.

