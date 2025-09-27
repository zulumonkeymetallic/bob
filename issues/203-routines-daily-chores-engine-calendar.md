# 203 – Routines: Daily Chores Engine with Calendar Integration

## Summary
Model recurring chores as first‑class tasks with priorities, durations, and theme mapping; auto‑slot them into daily blocks.

## Acceptance Criteria
- Chores appear in calendar and digest; skipping/deferring respects capacity rules.
- Completion updates streak counters and reschedules as needed.

## Proposed Technical Approach
- `chores` collection with RRULEs (iCal), duration, theme; scheduler integrates chores first, then tasks.
- UI to mark complete/skip; streak and habit widgets.

## Data Model / Schema
- `chores` (name, rrule, duration, theme, priority, streaks).

## Testing & QA
- RRULE parsing tests; edge cases for holidays and travel days.

