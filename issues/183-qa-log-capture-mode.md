# 183 – Provide in-app QA log capture mode

- Type: enhancement
- Priority: P2 (minor)
- Areas: Observability, QA tooling

## Problem
Browser devtools are blocked, preventing QA from exporting console logs or network traces.

## Acceptance Criteria
- Introduce a QA mode that captures recent console errors and the last ~50 API calls.
- Provide a UI affordance to download/export the log bundle as JSON.

## Technical Notes
- Wrap `fetch`/API clients with a logging interceptor and store entries in a ring buffer.
- Add a hidden/role-gated button in QA mode to export logs.
