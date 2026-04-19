# 162 – Theme Progress: use theme settings for label color

- Type: enhancement
- Priority: P2
- Affects: Dashboard → Theme Progress (ThemeBreakdown)
- Status: Fixed in repo (pending deploy)

## Summary
Theme labels in the Overview’s Theme Progress section were rendered with default text color. Update to reflect each theme’s configured color for clearer visual mapping.

## Implementation
- `react-app/src/components/ThemeBreakdown.tsx`:
  - Import `getThemeByName` and apply `theme.color` to the theme label text.

## Validation
- Labels now take on the configured theme color while keeping counts and progress bars readable.

