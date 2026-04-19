# 195 – Games backlog card polish

- Type: enhancement
- Priority: P2
- Areas: Backlog UI, Games, Story promotion

## Scope
- Align the games backlog cards with the goal/story visual language (comfortable spacing, larger silhouette, theme tint when linked to a story’s goal).
- Surface linked story metadata directly on the card (story reference, status pill) and expose a quick-open action alongside Convert.
- Add lifecycle affordances (e.g. Playing, Completed) so games can be bucketed beyond Backlog/Story Linked.

## Acceptance Criteria
- Cards inherit a theme accent when a linked story exists and display its reference.
- Layout uses the same typography scale and padding as goal cards.
- List + card views surface the new status values and retain ratings.

## Notes
- Relies on `steam` docs storing `lastConvertedStoryId`; may need to store the story reference/title for richer display.
