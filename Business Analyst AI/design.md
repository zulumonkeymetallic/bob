
# design.md — Design System & Components

**Date:** 30 Aug 2025

## Tech Stack
- React
- Tailwind CSS (utility styling)
- Radix UI + shadcn/ui (accessible components)
- TanStack Table v8 or AG Grid (Excel-like grids)
- Pragmatic DnD (drag & drop)
- Lucide icons
- React Hook Form + Zod (forms/validation)
**History:** Stack agreed after exploring alternatives; chosen for modern DX, accessibility, and alignment with Jim’s request for “modern design framework.”

## Principles
- Touch-friendly (tablet)
- Inline editing everywhere
- RCP shows non-editable history/meta
- Consistency across list views
- Accessibility (WCAG-AA)
- Motion-like UI polish

## Components
- Editable Grid: columns chooser, inline edit, filters
- Kanban Board: Pragmatic DnD, inline edits
- Context Panel: audit/history, add note
- Modals: story/task/goal detail with tabs
- Dashboard: daily priorities, sprint summary
**History:** Components mapped directly from chat requirements and Jim’s emphasis on Excel-like usability.
