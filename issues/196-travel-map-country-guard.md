# 196 – Travel map selection guardrails

- Type: bug
- Priority: P1
- Areas: Travel Map

## Scope
- Prevent runtime crashes when clicking countries that lack ISO-2 mappings (e.g. certain territories in the topojson feed).
- Ensure selection highlight and drill-down gracefully ignore unsupported geography entries.

## Acceptance Criteria
- Clicking any country on the travel map no longer throws `Cannot read properties of undefined (reading 'toUpperCase')`.
- Unsupported geographies render with a neutral style and cannot be selected.

## Notes
- Root cause: `numericToAlpha2` returns `undefined` for some features; guard before calling `.toUpperCase()`.
