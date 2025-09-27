# 202 – Integration: MyFitnessPal (Macros & Meals)

## Summary
Pull daily calories/macros and optionally push targets to support health dashboards and the daily digest.

## Acceptance Criteria
- Daily sync of calories, protein, carbs, fat; show goals vs actual.
- Optional barcode scans appear as meals (read‑only MVP).

## Proposed Technical Approach
- Use available MFP APIs/exports or intermediary connectors; store minimal nutrition data.

## Data Model / Schema
- `nutrition/daily` per date; `users/{uid}/connections/mfp`.

## Testing & QA
- Reconciliation tests for time‑zones; duplicate day merges.

