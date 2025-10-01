# 193 – Steam games backlog with story conversion

- Type: feature
- Priority: P1
- Areas: Integrations, Stories, Backlog

## Scope
- Provide a dedicated “Steam Games” backlog view that lists the synced Steam library for the signed-in user.
- Support both list and card views (reusing the modern stories styling) with cover art, play stats, and backlog status filters.
- Allow users to convert any game into a story by selecting goal, sprint, target/completion date, and a personal rating (star field).
- Surface the new backlog entry in the global navigation alongside existing personal backlog links.

## Acceptance Criteria
- Navigating to `/games-backlog` shows Steam games with list/grid toggle, including cover art pulled from the Steam CDN.
- “Convert to Story” opens a modal that captures goal, sprint, target date, and rating, then creates a story with appropriate metadata/tags.
- Converted games persist rating/completion metadata back to the Steam doc for later reporting.
- Sidebar navigation exposes a “Steam Games” backlog link visible to authenticated users.

## Technical Notes
- Subscribe to `steam` Firestore collection keyed by `ownerUid` for live updates.
- Cover art URL format: `https://steamcdn-a.akamaihd.net/steam/apps/{appid}/header.jpg`.
- Store local fields (`rating`, `lastConvertedStoryId`, `completedAt`) on the same Firestore doc when converting.
- Reuse existing conversion helpers (story creation) where possible.
