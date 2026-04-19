# 210 – Cross-Entity Tagging & Reminders Sync

## Summary
Introduce a unified tagging system across goals, stories, sprints, and tasks. Tags must round-trip through Firestore, the React web UI, and iOS Reminders so users can filter, search, and automate by tag. Existing records should gain tagged metadata without breaking older clients.

## Goals
- Extend the data model so all work items share a common `tags` schema with validation.
- Update create/edit flows on web to add/remove tags, including bulk editing support.
- Ensure scheduler, activity stream, and emails surface tags when available.
- Sync tags to iOS Reminders (notes/metadata) and back when updates arrive.
- Provide migrations/backfills and guardrails for missing or oversized tag sets.

## Non-Goals
- Advanced tag analytics or visualisations (future work).
- Cross-user/shared tagging permissions.

## Tasks
- [ ] Define Firestore schema & client typings for tag sets.
- [ ] Update goal/story/sprint/task forms and list cells to show editable tags.
- [ ] Persist tags through Cloud Functions (scheduler, conversions, reminders bridge).
- [ ] Round-trip tags via iOS Reminders sync (write + ingest during webhook processing).
- [ ] Add tag filtering controls to key views (Tasks, Stories, Unified Planner).
- [ ] backfill script for existing items lacking `tags` field.
- [ ] QA plan covering web + iOS sync + scheduler edge cases.

## Acceptance Criteria
- [ ] Users can add/remove tags on any goal/story/sprint/task in the web app.
- [ ] Newly synced iOS reminders carry the same tag metadata; edits on device re-sync to BOB.
- [ ] Scheduler emails and daily summary render tag chips when present.
- [ ] Tag filters appear in Tasks, Stories, and Planner pages.
- [ ] Migration report confirms legacy items got empty tag arrays without data loss.
