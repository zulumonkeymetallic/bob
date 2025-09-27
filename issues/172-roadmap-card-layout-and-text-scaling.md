# 172 – Roadmap cards need responsive sizing and text handling

Note: Related epic – see 193 (UI: Merge Card-Based Views & Preserve Terministic Calendar Blocks).

- Type: UX
- Priority: P1 (major)
- Areas: Goals Roadmap

## Problem
Roadmap goal bars use a fixed height regardless of zoom. In Week view they are oversized with tiny text, while in Month/Quarter views the width shrinks and titles are truncated without tooltips.

## Acceptance Criteria
- Card height and font scale with the current zoom level (e.g., taller in Week, compact in Year/5 Year).
- Titles wrap gracefully (two to three lines) and show a tooltip with the full text on hover/focus.
- Multi-month/year bars repeat or centre their label so it remains visible across the entire duration.

## Technical Notes
- Define CSS variables for card dimensions keyed off the zoom mode.
- Apply `line-clamp` with ellipsis and add a tooltip component.
- Ensure responsive typography so text remains legible.
