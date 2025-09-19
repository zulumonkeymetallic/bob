# BOB v3.8.7 – Roadmap V3 Enhancements (Sticky Header, Zoom Presets, Theming)

Date: 2025-09-19

Summary
- Sticky, opaque date header (months/quarters/years) so cards never show through.
- Sticky left labels for “Goals & Themes” and each theme row title.
- Zoom preset controls: Week, Month, Quarter, 1y, 3y, 5y.
- Card text/icons now respect theme contrast (white text removed in light mode).
- Edge-based range extension for near-infinite horizontal scroll.

Key Changes
- EnhancedGanttChart.tsx
  - Opaque sticky header + axis band
  - Sticky left header cell
  - Preset buttons for Week / Month / Quarter / 1y / 3y / 5y
  - Pass theme textColor downstream
  - Edge-based domain extension
- VirtualThemeLane.tsx
  - Sticky goal labels (left)
  - Theme-driven textColor for card content
  - Transparent action icons that inherit text color

References
- Commits: ccc01a2, subsequent build+deploy
- Deployed: https://bob20250810.web.app

Validation
- Confirmed sticky header remains opaque while scrolling
- Verified presets update zoom/domain and card widths
- Verified card text visibility in light/dark themes

