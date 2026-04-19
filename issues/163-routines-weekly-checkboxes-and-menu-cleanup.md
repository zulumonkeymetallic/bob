# 163 – Routines + Menu cleanup

- Type: enhancement/cleanup
- Priority: P1
- Status: Fixed in repo (pending deploy)

## Changes
- Habits: added weekly days-of-week checkboxes (Mon–Sun) writing `daysOfWeek` (0=Sun..6=Sat). CSV fallback retained.
  - react-app/src/components/HabitsManagement.tsx
- Sidebar: removed Data Management group; removed Test Suite and Changelog from System; removed duplicate Health group.
  - react-app/src/components/SidebarLayout.tsx
- Dashboard metrics: pass-through sprint selection (respects “All Sprints”).
  - react-app/src/components/Dashboard.tsx
- Reminders Shortcuts: added .md setup files and cURL scripts.
  - shortcuts/*
- Docs: routines integration with Blocks; notes logging guidance in Reminders docs.
  - ROUTINES_BLOCKS_INTEGRATION.md
  - REMINDERS_SHORTCUTS.md

## Validation
- Weekly habit with Mon/Wed selected appears on those days in Today’s plan; scheduleTime honored.
- Sidebar shows Routines group (Habits, Chores, Mobile Checklist); removed requested items.
- Dashboard metrics reflect All Sprints when selected.

