# 180 – Improve toast/error feedback consistency

- Type: UX
- Priority: P2 (minor)
- Areas: Notifications, Error handling

## Problem
Success messages use green toasts but error states are inconsistent or silent. Users lack guidance when an action fails.

## Acceptance Criteria
- All success and error outcomes surface consistent toast notifications with relevant copy.
- Field-level errors (e.g., duplicate title) highlight the field with inline help text.
- Errors include retry guidance or next steps.

## Technical Notes
- Centralise toast handling (e.g., React context) with standard variants.
- Ensure API failures propagate meaningful messages that the UI can display.
