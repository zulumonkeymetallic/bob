**Description**
Add a travel map feature that lets users colour in locations they’ve visited and automatically generate stories/tasks based on those inputs.

**Acceptance Criteria**
- [ ] Interactive world map component available in BOB dashboard.
- [ ] Clicking a country/region marks it as “visited.”
- [ ] Each visited location creates a story in BOB tagged to the "Travel" theme.
- [ ] Stories include location metadata (e.g., ISO country code).

**Proposed Technical Implementation**
- Use a React map library (e.g., `react-simple-maps` or Mapbox).
- Store visited locations in Firestore (`/travel/visitedLocations`).
- Create Firebase Functions to convert visited entries into stories.
- Link each story back to its travel entry for reporting.
