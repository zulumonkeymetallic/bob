# 200 – Story cards align with goal cards

- Type: enhancement
- Priority: P1
- Areas: Stories UI, Games backlog

## Scope
- Update story cards across the app (stories list, games backlog conversions, etc.) to match the comfortable layout used by goal cards.
- Inherit the linked goal theme color for card accents/backgrounds.
- Ensure spacing, typography, and hover actions mirror the goal card experience.

## Acceptance Criteria
- Story cards display the goal theme accent (border or background) when linked.
- Card layout uses the same padding and icon placement as goal cards.
- No regressions in story actions (edit, delete, convert, activity) across list and card views.

## Notes
- Affects components such as `StoryCard`, `StoryTasksPanel`, games backlog story references, and any story previews shown in dashboards.
