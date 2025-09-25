# 168 – Goal detail edits revert after refresh

- Type: bug
- Priority: P0 (critical)
- Areas: Goals, Persistence

## Problem
Editing a goal’s title or description via the detail panel appears to succeed, but reloading the page restores the previous values.

## Steps to Reproduce
1. Open `Goals → List` and select any goal.
2. Update the title and/or description in the side panel and close it.
3. Refresh the page.

## Expected Behaviour
- The updated title/description are saved server-side and remain after reload.
- A success indicator confirms the update.

## Actual Behaviour
- After refresh the original values reappear, implying the write was not persisted.

## Acceptance Criteria
- Save operations trigger a write (PATCH/Firestore update) and surface success/failure feedback.
- Edited fields retain their new values after reload and across sessions.
- Errors are surfaced if the update fails.

## Technical Notes
- Ensure the edit form is controlled and calls the update endpoint with the correct fields.
- Consider adding an explicit `Save` action or reliable auto-save.
- Verify Firestore rules/paths permit updates on title/description.
