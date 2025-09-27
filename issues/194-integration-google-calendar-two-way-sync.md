# 194 – Integration: Google Calendar 2‑Way Sync (Read/Write)

## Summary
Implement robust two‑way sync between BOB and Google Calendar for events created from Stories/Tasks and Daily Chores.

## Acceptance Criteria
- Events created/updated in BOB appear in Google within 60s; updates from Google reflect back within 60s.
- De‑duplication via `extendedProperties.private.bobId`.
- Support recurring events, time‑zones, all‑day events.
- Conflict resolution: last‑write‑wins with audit trail.

## Proposed Technical Approach
- Use Google Calendar API via a Cloud Function with service account + user OAuth (offline). Store tokens securely.
- Maintain `sync_state` with `etag`, `syncToken`, and `bobId` mapping.
- Webhooks (push notifications) for incremental updates.
- Batch operations, exponential backoff, and retry queues.
- Feature flag by user.

## Data Model / Schema
- `events` collection: fields `source`, `google_event_id`, `bob_id`, `etag`, `sync_token`, `last_synced_at`, `recurrence`, `time_zone`, `extended_properties`.
- `users/{uid}/connections/google`: OAuth tokens, scopes, status.

## APIs & Endpoints
- Cloud Functions: `POST /integrations/google/auth`, `POST /integrations/google/webhook`, `POST /integrations/google/sync`.
- Internal: `syncEvents(userId, since)`; `upsertGoogleEvent(evt)`; `applyGoogleDelta(delta)`.

## Security & Permissions
- Store tokens in Firestore with field‑level encryption / KMS; restrict access via rules.
- Least‑privilege scopes (`calendar.events`, `calendar.readonly` for dry‑run).

## Testing & QA
- Simulate clock‑skews and recurrence edits; fuzz tests on overlapping updates; property‑based tests for idempotency.
- Record/replay fixtures for Google responses.

## Dependencies
- Daily Chores scheduler; Auto Scheduling engine.

