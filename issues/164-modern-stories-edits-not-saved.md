# 164 – Modern Stories table: edits not saved, ActivityStream undefined oldValue

- Type: bug
- Priority: P0
- Affects: ModernStoriesTable inline edits (sprintId change), Activity Stream logging

## Symptoms
- Editing story fields (e.g., setting `sprintId`) appears to apply but activity logging fails with Firestore error and the UI does not reflect changes reliably.
- Console excerpt from preview:
  - `Story update: "<storyId>" { sprintId: "<sprintId>" }`
  - `Error adding activity: FirebaseError: ... Unsupported field value: undefined (found in field oldValue ...)`
  - `❌ Failed to track field change ... oldValue: undefined`

## Root Cause
- `ActivityStreamService.addActivity` forwarded `undefined` values (e.g., `oldValue`) into Firestore, which rejects `undefined`.

## Fix
- Sanitize payload in `addActivity` to omit all `undefined` fields before `addDoc`.
  - File: `react-app/src/services/ActivityStreamService.ts`

## Validation
- After fix, editing story sprint in Modern Stories no longer throws; activity entries are written.
- Check Firestore `activity_stream` for `updated` entries with `fieldName: "sprintId"`.

## Follow-up
- Ensure ModernStoriesTable UI confirms persistence (optimistic update + snapshot).
- Add minimal tests or manual check-list for story inline edits.

