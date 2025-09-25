# 181 – Strengthen task validation and story linkage

- Type: enhancement
- Priority: P2 (minor)
- Areas: Tasks

## Problem
Tasks can be created without a title, description, or linked story, resulting in orphaned records.

## Acceptance Criteria
- Require a task title and either a description or explicit “Unassigned” toggle.
- Provide clear UI to link a task to a story (typeahead with validation).
- Block submission until validation passes; surface errors inline.

## Technical Notes
- Reuse the shared validation schema (see Issue 169) for tasks.
- Add UI affordances for “Unassigned task” with explicit acknowledgement.
