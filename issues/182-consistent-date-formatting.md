# 182 – Adopt consistent date formatting across the app

- Type: enhancement
- Priority: P2 (minor)
- Areas: UI, Dates

## Problem
Dates render in varying formats (e.g., `21/09/2025`, `Sep 21 2025`) across list, cards, and roadmap views.

## Acceptance Criteria
- Decide on a single human-readable format (e.g., `7 Oct 2025`) and apply it globally.
- Ensure locale-sensitive formatting where appropriate.

## Technical Notes
- Create a shared date-formatting utility and update components to use it.
- Consider exposing user preferences in the future.
