# 202 – Show linked story reference on games backlog

- Type: bug
- Priority: P1
- Areas: Games backlog, Story conversion

## Scope
- When a game is converted to a story, surface the story reference/short ID in both list and card views.
- Ensure the reference persists even after refresh by storing it alongside `lastConvertedStoryId`.

## Acceptance Criteria
- Newly converted games display the story ref immediately.
- Refreshing the page still shows the ref (data saved to Firestore).
- Provide quick navigation to the story (e.g., link or button).

## Notes
- Conversion callable currently stores only the story doc ID; need to fetch and persist the story ref.
