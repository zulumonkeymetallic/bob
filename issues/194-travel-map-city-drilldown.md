# 194 – Travel map city drill-down & story integration

- Type: feature
- Priority: P2
- Areas: Travel, Stories, Visualization

## Scope
- Enhance the travel map to drill down from country to individual city entries, showing all saved locations per country.
- Allow adding new cities directly from the drill-down panel and linking them to travel goals/stories.
- Provide a richer convert-to-story flow for cities (select travel goal/sprint, optional target date) and persist the linkage.
- Improve map interaction so clicking a country focuses the drill-down panel instead of auto-toggling visited state.

## Acceptance Criteria
- Selecting a country highlights it and displays a list of associated cities/places with quick actions (visit toggle, geocode, convert to story, unlink).
- Users can add new city entries inside the drill-down panel without retyping country code.
- Converting a city to a story records the linkage and auto-populates travel metadata (country, city, location name) on the story.
- Map interaction (click vs. toggle) behaves predictably: clicking highlights details; separate button handles visited state changes.

## Technical Notes
- Refactor travel map state to separate `selectedCountry` from visited toggles; maintain backwards compatibility with existing Firestore schema (`travel` collection).
- Extend story creation helper to accept city-level metadata and update `travel` doc with `linked_story_id` and `updatedAt`.
- Consider memoized selectors for country → entries to avoid recomputation on every render.
