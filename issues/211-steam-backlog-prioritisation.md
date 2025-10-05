# 211 – Steam Backlog Prioritisation Overhaul

## Summary
Rework the Steam backlog view so prioritisation defaults to purchase/library date rather than total hours played. Surface meaningful queue controls to help choose the next game.

## Goals
- Replace the current sort with a recency-driven backlog score (date added/purchased, optional manual priority).
- Display metadata (purchase date, last played, price) prominently.
- Allow users to override the queue via star/priority controls.
- Ensure backlog metrics feed into dashboard widgets and email summaries where relevant.

## Non-Goals
- Deep game recommendations or integrations beyond Steam imports.

## Tasks
- [ ] Extend Steam import to capture purchase/add-to-library timestamps.
- [ ] Update Firestore schema + ingestion to store new fields.
- [ ] Refresh `GamesBacklog` UI: new columns, sorting, manual priority control.
- [ ] Add filtering by platform/tag (reuse unified tagging if available).
- [ ] Update tests/fixtures and document scoring formula.

## Acceptance Criteria
- [ ] Default backlog order is newest purchase/library addition first (unless manually overridden).
- [ ] Manual priority overrides the automated score and persists.
- [ ] UI shows purchase/add dates and priority indicators.
- [ ] Dashboard/cards that consume backlog data reflect the new ordering.
