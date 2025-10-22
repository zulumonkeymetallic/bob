# [CAL-3] Event deduplication and idempotency

- Labels: epic:AI-scheduling, calendar, firestore

Description
Introduce canonical dedupe keys across providers and idempotent writes to prevent duplicates when syncing both ways.

Acceptance Criteria
- calendar_blocks stores dedupeKey and conflictVersion
- Reconciliation deletes or merges orphaned/duplicate events
- Idempotent insert/update verified by repeat sync runs

Dependencies
- reconcilePlanFromGoogleCalendar, scheduledCalendarSync

Test Notes
- Trigger sync twice; ensure no duplicate blocks/events.
