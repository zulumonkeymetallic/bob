# 203 – Travel destinations list/card view

- Type: enhancement
- Priority: P1
- Areas: Travel Map

## Scope
- Add dedicated list and card views for travel destinations (countries + cities) derived from the map selections.
- Reuse the comfortable card style (similar to goals/stories) showing planned visit date, linked story, and visit status.
- Support grouping/toggling between countries and cities, using polygon highlights as entry points.

## Acceptance Criteria
- Sidebar/panel presents destinations in both table and card layouts.
- Cards inherit travel theme accents, show planned visit info, and expose quick actions (convert to story, mark visited).
- City and country entries sync with the Firestore `travel` collection and map interactions.
