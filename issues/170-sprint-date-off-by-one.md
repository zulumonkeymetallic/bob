# 170 – Sprint dates shift by a day after save (timezone bug)

- Type: bug
- Priority: P1 (major)
- Areas: Sprints, Date handling

## Problem
Sprint start/end dates occasionally slide by one day after saving. Choosing an end date of 2025-10-20 may display as 2025-10-21 when revisiting the sprint list.

## Steps to Reproduce
1. Create or edit a sprint.
2. Set explicit start/end dates (e.g., 2025-10-10 to 2025-10-20).
3. Save and reopen the sprint.

## Expected Behaviour
- Dates persist exactly as entered across all views and modals.

## Actual Behaviour
- Dates shift forward by one day in certain views.

## Acceptance Criteria
- Sprint start/end values remain unchanged after save and reload.
- Date pickers reopen with the saved value instead of defaulting to today.

## Technical Notes
- Store sprint dates in UTC (midnight) and convert to the user’s timezone for display.
- Audit date serialisation when sending to Firestore (avoid implicit local offsets).
- Use `date-fns-tz` or similar to normalise conversions.
