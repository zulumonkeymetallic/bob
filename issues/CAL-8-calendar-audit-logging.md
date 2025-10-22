# [CAL-8] Calendar audit logging coverage

- Labels: epic:AI-scheduling, calendar, audit

Description
Emit activity_stream entries for calendar CRUD, sync, and conflict resolution with sanitized metadata.

Acceptance Criteria
- Each operation logs activityType with entityType 'calendar' and no PII
- Logs include counts and references (not raw payloads)

Dependencies
- audit helper and wrapper functions

Test Notes
- Trigger create/update/delete/sync; verify visible audit entries.
