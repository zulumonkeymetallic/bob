# 169 – Add shared validation and duplicate guards for goals, stories, tasks

- Type: enhancement
- Priority: P0 (critical for data integrity)
- Areas: Validation, Goals, Stories, Tasks, Backend

## Problem
- Creation flows allow empty titles, excessive lengths (256+ chars), and HTML characters without sanitisation.
- Duplicate names can be created repeatedly within the same project, leading to confusion.
- Server-side enforcement is missing, so invalid or duplicate payloads are accepted directly in Firestore.

## Acceptance Criteria
- Required fields (e.g., title) are enforced with minimum and maximum lengths (e.g., title ≤ 120 chars, description ≤ 2,000 chars).
- Validation errors surface inline on the client and block submission until resolved.
- Duplicate titles per owner/project are disallowed (case-insensitive) with a helpful error message.
- Server-side validation mirrors the client rules and returns structured error payloads.

## Technical Notes
- Introduce a shared schema (zod/yup) for the client and mirror it on the backend/cloud functions.
- Sanitise payloads to remove XSS/HTML injection.
- Add Firestore indexes or auxiliary documents to enforce uniqueness (e.g., store titles lowercased per owner) or move the creates into callable functions that perform uniqueness checks before writes.
