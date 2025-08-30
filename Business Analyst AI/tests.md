
# tests.md — End-to-End Catalogue

**Date:** 30 Aug 2025  

## Auth
- TST-0001: Login (desktop)
- TST-0002: Logout (mobile)
- TST-0003: Session expiry returns to login
**History:** Ensures AI/humans don’t get stuck in loops.

## Kanban (Pragmatic DnD)
- TST-0100: Drag within column reorders
- TST-0101: Drag across updates status
- TST-0102: Keyboard/touch drag
**History:** Needed to validate REQ-0001.

## Tasks Grid
- TST-0200: Inline edit persists
- TST-0201: Column chooser persists
- TST-0202: Filters and grouping
**History:** Driven by Excel-like editing requirements.

## Notes & Context
- TST-0300: Click row opens RCP with meta
- TST-0301: Add note updates instantly
**History:** Mirrors ServiceNow workspace behaviour Jim wanted.

## Daily Dashboard
- TST-0500: Today/Overdue/Upcoming render correctly
- TST-0501: Mobile quick actions work
**History:** Validates Daily Priority view.

## Sprint Filter
- TST-0900: Dropdown filters instantly
- TST-0901: Last sprint persists per user
**History:** From sprint dropdown enhancement.

## Sprint Gantt
- TST-0950: Zoom levels
- TST-0951: Drag reschedule persists
- TST-0952: Inline date edits
**History:** To test Gantt functionality.

## Canvas
- TST-0960: Drag node reposition
- TST-0961: Colour by theme toggle
**History:** To validate visual canvas.

## Map
- TST-0970: Countries coloured visited/planned
- TST-0971: Click unvisited opens Create Story
**History:** Supports travel goals.

## Media
- TST-0980: Import items visible
- TST-0981: Dedupe works
**History:** To validate external media import.
