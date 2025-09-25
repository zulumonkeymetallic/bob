# 176 – Roadmap date header not sticky; cards slip behind grid

- Type: bug / UX
- Priority: P1 (major)
- Areas: Goals Roadmap, Scrolling

## Problem
When the roadmap has many rows, vertical scrolling causes the date header to disappear. Goal bars can render beneath the header/grid lines when scrolling.

## Acceptance Criteria
- The timeline header stays visible (`position: sticky`) while scrolling vertically.
- Goal bars never render beneath the header or grid (correct z-index stacking).

## Technical Notes
- Separate header/body containers and apply `position: sticky; top: 0; z-index` greater than cards.
- Ensure card layers have a higher z-index than grid lines but below the sticky header.
