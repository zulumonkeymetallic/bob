# 177 – Story → Goal linking typeahead unreliable

- Type: bug / UX
- Priority: P1 (major)
- Areas: Stories, Search

## Problem
The goal link field for stories does not provide reliable suggestions. Users must type the exact goal title to associate a story.

## Acceptance Criteria
- Typeahead shows fuzzy matches as the user types and supports keyboard/mouse selection.
- Selecting a suggestion correctly sets the story’s `goalId`.
- Results include goal metadata (theme, status) to aid disambiguation.

## Technical Notes
- Implement debounced search hitting an endpoint (`/goals?query=`) that returns partial matches.
- Consider using trigram/fuzzy matching in Firestore/Cloud Functions.
