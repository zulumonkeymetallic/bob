# 185 – Prevent accidental multiple story generation from quick add

- Type: bug
- Priority: P2 (minor)
- Areas: Goals, Quick actions

## Problem
Clicking goal quick-add icons can generate multiple stories without confirmation, cluttering data with duplicates.

## Acceptance Criteria
- Require confirmation before generating multiple stories automatically.
- Disable or collapse the quick-add menu while editing/viewing goal details to avoid accidental activation.
- Provide feedback indicating the stories created.

## Technical Notes
- Add debounce/confirmation around quick-add triggers.
- Consider moving AI story generation behind a modal with count preview.
