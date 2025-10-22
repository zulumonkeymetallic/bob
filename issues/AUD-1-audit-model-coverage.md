# [AUD-1] Audit model coverage for calendar & enrichment

- Labels: epic:AI-scheduling, audit

Description
Ensure all calendar CRUD, sync, LLM enrichment, and conversions write sanitized activity_stream records.

Acceptance Criteria
- Consistent fields: entityType, activityType, description, metadata (sanitized)

Dependencies
- New callable wrappers

Test Notes
- Exercise flows and inspect activity_stream documents.
