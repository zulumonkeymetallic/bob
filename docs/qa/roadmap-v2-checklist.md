# Roadmap V2 Manual QA Checklist

1. **Initial load & auto-scroll** – Load the Enhanced Gantt view with goals. Confirm the timeline auto-fits and scrolls to "Today" once, then stops auto-centering after interacting (pan, zoom, or using filters).
2. **Zoom presets** – Cycle through Weeks, Months, Quarters, Years and ensure card detail density updates (Weeks show note snippet, Years hide subtitles/meta).
3. **Drag & drop** – Drag, move, and resize goals across themes; verify virtualization does not block dropping on off-screen lanes after scrolling.
4. **Filters** – Toggle "Has stories", "In selected sprint", and "Overlaps sprint" filters; ensure cards and counts update without leaving "Loading sprints".
5. **Fullscreen** – Enter/exit fullscreen; confirm theme-aware styling and controls remain accessible.
6. **Activity snippet** – At Week zoom, confirm each goal shows the most recent activity note (or omits when unavailable) and opens full Activity modal.
7. **Performance sanity** – Scroll through >50 goals to confirm smooth lane virtualization (no blank rows or flicker) and "Fit" button recalculates bounds.
8. **Regression** – Verify Fit, Today, auto-fit on load, sprint shading layers, and filters behave as in previous release.

