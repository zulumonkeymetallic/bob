# 195 – Integration: Apple Reminders 2‑Way Sync (macOS/iOS)

## Summary
Provide reliable two‑way sync with Apple Reminders, mapping BOB tasks to Reminders with de‑duplication and completion semantics.

## Acceptance Criteria
- New/updated/deleted tasks sync both directions within 60s.
- De‑duplication via `bobId` in Reminders notes; completed in BOB ⇒ completed in Reminders (not deleted), and vice‑versa.
- Preserve metadata in task Notes (linked Story, Goal, Theme, sprint dates).

## Proposed Technical Approach
- macOS helper app using EventKit + background agent; or Shortcut‑based bridge with signed URLs.
- Use a local queue to handle offline mode; reconcile via vector clocks.
- Notes block contains metadata under a dotted rule for human readability + machine parsing.

## Data Model / Schema
- `tasks` fields: `reminders_id`, `bob_id`, `sync_state`, `completed_at`, `metadata_block` (string).

## APIs & Endpoints
- Local bridge endpoints: `POST /bridge/reminders/push`, `POST /bridge/reminders/pull`.
- Shortcut actions for fallback (import/export).

## Security & Permissions
- Local-only tokens; user‑approved access to Reminders; no remote storage of Apple IDs.

## Testing & QA
- Golden tests for note‑block parser; rapid toggle completion stress test.

