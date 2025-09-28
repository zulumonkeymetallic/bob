# 201 – Integration: Travel (Trips & Itineraries)

## Summary
Track upcoming trips, flights, and check‑lists; block travel time in schedule.

## Acceptance Criteria
- User can add/import trips; time‑blocked travel appears in calendar; checklists generated per trip.

## Proposed Technical Approach
- Parse calendar invites and emails (optional later); manual entry MVP.
- Compute timezone offsets into scheduler.

## Data Model / Schema
- `travel/trips` with segments; `checklists` templates.

## Testing & QA
- Time‑zone boundary tests; daylight‑saving transitions.

