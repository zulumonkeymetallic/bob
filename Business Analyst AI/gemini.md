
# gemini.md — Requirements (Living Spec)

**Date:** 30 Aug 2025  

## Requirements

### REQ-0001 — Replace react-beautiful-dnd with Pragmatic DnD
- **Description:** Pragmatic DnD provides modern drag-and-drop with better performance and accessibility.
- **Acceptance:** All Kanban/task boards use Pragmatic DnD.
- **History & Context:** Jim raised issues with deprecated r-b-dnd and requested Pragmatic DnD for longevity and better mobile support.

### REQ-0002 — Excel-like Grids with Column Chooser
- **Description:** All list views behave like editable spreadsheets.
- **Acceptance:** Inline editing, reorder, filters; user can add/remove columns.
- **History & Context:** Requested to mimic “Excel-like editing” to allow fast task editing. This arose from frustration with static lists.

### REQ-0003 — Right-hand Context Panel (RCP)
- **Description:** Shows non-editable meta + history/notes when clicking a record.
- **Acceptance:** Clicking a row shows context on right; editable fields remain inline.
- **History & Context:** Based on ServiceNow Workspace pattern Jim is used to; helps separate read-only audit fields from editable ones.

### REQ-0004 — Inline Editing Everywhere
- **Description:** All editable fields should be inline, including due dates, statuses.
- **Acceptance:** No modal required for basic edits.
- **History & Context:** Jim stressed inline editing should be consistent — “edit must be possible on all list views.”

### REQ-0005 — Sprint Priority Reordering
- **Description:** Allow drag reordering tasks within a sprint to change priority.
- **Acceptance:** Order saved deterministically.
- **History & Context:** Inspired by agile backlog grooming; must reflect in daily dashboard.

### REQ-0006 — Notes/Comments with History
- **Description:** Each record supports threaded notes with history log.
- **Acceptance:** Notes appear in context panel and modals; full history shown.
- **History & Context:** Added after discussion on needing “history of updates and comments visible in context window.”

### REQ-0007 — Mobile Minimal App
- **Description:** Capture tasks quickly, view daily priority, sign out option.
- **Acceptance:** iOS/Android app syncs with backend and Google Calendar.
- **History & Context:** Requested because mobile is “capture-first” vs desktop planning.

### REQ-0008 — Tablet Touch-friendly
- **Description:** Minimum 44px targets, edge scrolling on drag.
- **History & Context:** Jim specifically said “ensure all components are touch friendly for tablet.”

### REQ-0009 — Modern Design System
- **Description:** Use Tailwind, Radix UI, shadcn/ui, TanStack Table, Pragmatic DnD.
- **History & Context:** After debates, these were chosen for flexibility and accessibility.

### REQ-0010 — Tests mapped to Requirements
- **Description:** All REQ must have test coverage in `tests.md`.
- **History & Context:** Needed for AI-driven regression gating.

### REQ-0011..0018 — Extended Features
- Sprint filter dropdown, Sprint Gantt, Visual Canvas, Map View, Media Lists, Dev Dashboard, CI/CD test gates.
- **History & Context:** Added after Jim requested global sprint management, map of travels, visual planning canvas, and dev dashboard integration.
