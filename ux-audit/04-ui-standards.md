# BOB UX Audit — 04: Proposed UI Standards

**Audit date**: 2026-03-17
**Purpose**: Define the canonical interaction and visual patterns for goals, stories, and tasks across all view types. This document is the target state — it does not describe the current state.

---

## 1. Shared Data Object: The Work Item

Goals, stories, and tasks share a common interaction language. From a UX perspective they are all "work items" with:
- A reference ID
- A title
- A status
- A priority
- Optional AI score
- Optional manual priority rank (Top 3)
- Optional domain theme (for goals/stories)
- Optional due date
- Optional sprint association
- Optional goal link

The UI for a work item adapts to three density tiers — **Compact** (Kanban), **Standard** (Card), and **Dense** (Table) — and to two device contexts — **Desktop** and **Mobile**. The underlying data and action set are identical; only the presentation changes.

---

## 2. Status Pill Standard

**Component**: `StatusPill`
**File to create**: `src/components/shared/StatusPill.tsx`

### Visual Spec
```
┌─────────────────┐
│  In Progress    │   ← rounded pill, 4px border-radius
└─────────────────┘
```
- Font: 11px, font-weight 600, letter-spacing 0.3px
- Padding: 2px 8px
- Background: semantic colour variable per status (see table below)
- Border: none
- Cursor: `pointer` in interactive mode, `default` in readonly mode

### Status Colour Map
| Status | CSS Variable | Light Value | Dark Value |
|--------|-------------|-------------|------------|
| Backlog / Not Started | `--status-backlog-bg` | `rgba(108, 117, 125, 0.15)` | `rgba(160, 165, 177, 0.2)` |
| In Progress | `--status-inprogress-bg` | `rgba(13, 110, 253, 0.15)` | `rgba(100, 170, 255, 0.2)` |
| Review / In Review | `--status-review-bg` | `rgba(253, 126, 20, 0.15)` | `rgba(253, 180, 100, 0.2)` |
| Done / Complete | `--status-done-bg` | `rgba(25, 135, 84, 0.15)` | `rgba(100, 200, 140, 0.2)` |
| Blocked | `--status-blocked-bg` | `rgba(220, 53, 69, 0.15)` | `rgba(230, 100, 110, 0.2)` |

### Mode Variants
- **`mode="readonly"`**: Plain span with pill class. No click handler.
- **`mode="interactive"`**: Button element. Single click cycles to next status. Used in card views.
- **`mode="select"`**: Styled `<select>` element that visually matches the pill. Used in tables. On focus, expands to show all status options.

### Usage
```tsx
// Kanban (readonly)
<StatusPill status={item.status} mode="readonly" />

// Card view (interactive)
<StatusPill status={item.status} mode="interactive" onChange={handleStatusChange} />

// Table (select)
<StatusPill status={item.status} mode="select" onChange={handleStatusChange} />
```

---

## 3. Priority Pill Standard

**Component**: `PriorityPill`
**File to create**: `src/components/shared/PriorityPill.tsx`

Identical structure to `StatusPill`. Uses a different colour map.

### Priority Colour Map
| Priority | Label | CSS Variable | Accent Colour |
|----------|-------|-------------|---------------|
| Critical (P4) | Critical | `--priority-critical-bg` | Red family |
| High (P3) | High | `--priority-high-bg` | Orange family |
| Medium (P2) | Medium | `--priority-medium-bg` | Yellow family |
| Low (P1) | Low | `--priority-low-bg` | Grey family |
| None | — | Hidden | — |

Priority pills follow the same `mode` prop contract as StatusPill.

---

## 4. AI Score Badge Standard

**Component**: `AiScoreBadge`
**File to create**: `src/components/shared/AiScoreBadge.tsx`

### Visual Spec
```
┌──────┐
│ AI 87 │   ← compact, no "/100" suffix
└──────┘
```
- Style: same pill base class as StatusPill, but with `--status-inprogress-bg` as a baseline (blue-tinted)
- Font: 11px, font-weight 500
- Text: `AI {score}` where score is rounded to nearest integer
- Hidden when `score < 20` (configurable threshold)
- Tooltip (title): "AI Criticality Score: NN/100"

### Usage
```tsx
<AiScoreBadge score={item.aiCriticalityScore} />
// Renders nothing if score < 20 or undefined
```

---

## 5. Manual Priority Badge Standard

**Component**: `ManualPriorityBadge`
**File to create**: `src/components/shared/ManualPriorityBadge.tsx`

### Visual Spec
```
┌────────┐
│ #1     │   ← compact, bold, accent red
└────────┘
```
- Style: pill with `var(--color-urgency-critical)` background at 20% opacity; text at 100% opacity
- Font: 11px, font-weight 700
- Text: `#{rank}` (e.g., `#1`, `#2`, `#3`)
- Hidden when `rank` is undefined or 0
- Tooltip: "Manual priority rank: #{rank}"

### Usage
```tsx
<ManualPriorityBadge rank={getManualPriorityRank(item)} />
```

---

## 6. Action Row Standard

### Desktop Action Row (Card View and Kanban)
Actions appear as icon buttons with `title` tooltip. Standard order (left to right):

| Position | Action | Icon | `title` Attribute |
|----------|--------|------|--------------------|
| 1 | Schedule | `CalendarClock` | "Schedule" |
| 2 | Activity | `Activity` | "Activity stream" |
| 3 | Edit | `Pencil` | "Edit" |
| 4 | Defer | `Clock3` | "Defer" |
| 5 | Convert to Story (tasks only) | `BookOpen` | "Convert to story" |
| 6 | Delete | `Trash2` | "Delete" |

**Button sizing**:
- Desktop (≥ 992px): 32px × 32px button with 14px icon. Visible on hover in kanban, always visible in card views.
- Tablet (768–992px): 36px × 36px with 16px icon.
- Mobile (< 768px): Collapsed to a single `...` overflow button (see Mobile Action Overflow below).

**Button visual**:
- Background: transparent at rest; `var(--notion-hover)` on hover
- No border
- Icon colour: `var(--muted)` at rest; `var(--text)` on hover

### Mobile Action Overflow
On viewports < 768px, all action buttons are replaced by a single `•••` button that opens a bottom-anchored dropdown menu:

```
┌──────────────────────────┐
│ Schedule                  │
│ Activity stream           │
│ Edit                      │
│ Defer                     │
│ Delete                    │
└──────────────────────────┘
```
Each row in the overflow menu is full-width with a 44px minimum tap target. Icons appear on the left.

---

## 7. Standard Work Item Card (Desktop)

**Density**: Standard (Card View)
**Applies to**: Goals, Stories, Tasks in card/grid view on desktop

```
┌─────────────────────────────────────────────────────────┐
│ GOAL-042  [CalendarClock] [Activity] [Pencil]            │
│                                                          │
│ Achieve first 10k race under 50 minutes                  │
│                                                          │
│ [In Progress] [High] [AI 72] [#2]                        │
│                                                          │
│ ─────────────────────────────────────────────────────── │
│ ↳ Theme: Health                 [Clock3 Defer] [Trash2]  │
│                                                          │
│ Last updated 2 days ago                                  │
└─────────────────────────────────────────────────────────┘
```

- Domain theme colour as left border (4px solid `var(--theme-X-primary)`)
- Ref ID in muted small text top-left
- Actions top-right, always visible
- Status + Priority + AI Score + Manual Priority on same badge row
- Theme label + secondary actions (Defer, Delete) on bottom bar
- Date footer: `Updated N days ago` or absolute date

---

## 8. Compact Work Item Card (Kanban)

**Density**: Compact (Kanban)
**Applies to**: Stories and Tasks inside KanbanBoardV2

```
┌─────────────────────────────────────────────────────────┐
│ ⠿ STORY-012                [Pencil] [Activity] [•••]    │
│                                                          │
│ Refactor authentication middleware                       │
│                                                          │
│ [In Progress] [High] [AI 72] [#2]        [◉ Goal Name]  │
└─────────────────────────────────────────────────────────┘
```

- Drag handle (`GripVertical`) on far left
- Ref + type indicator top row
- Action buttons always visible (not hover-only) at top right; tertiary actions in `•••` overflow
- Status + Priority + AI Score + Manual Priority on same badge row as bottom meta
- Goal link (if present) as compact label on right of meta row
- No description shown by default (description in expanded state or via Activity)
- No footer dates (space too limited)

---

## 9. Mobile Work Item Card

**Density**: Mobile
**Applies to**: All work items rendered in MobileHome tabs or in mobile-responsive card views

```
┌─────────────────────────────────────────────────────────┐
│ Refactor authentication middleware         [High] [•••]  │
│ STORY-012  •  In Progress  •  Due Mar 20               │
│ ↳ Health goal                                           │
└─────────────────────────────────────────────────────────┘
```

- Full-width tap target (entire card, minimum 60px height)
- Title is the primary element — large, truncate to 2 lines
- Meta row: Ref ID • Status text • Due date (compact inline)
- Priority chip shown (compact, right-aligned in title row)
- Manual priority badge (`#N`) replaces priority chip if present (one or the other)
- AI Score: hidden
- Actions: `•••` button only (opens bottom sheet with full action list)
- Goal/theme link as small muted text on 3rd line if present
- No drag handle

### Tap Behaviours
| Tap target | Action |
|-----------|--------|
| Main card area | Open detail/edit modal |
| Priority chip | Quick cycle priority (if `interactive` mode) |
| `•••` button | Open overflow action bottom sheet |

---

## 10. Table Row Standard

**Density**: Dense (Table)
**Applies to**: ModernTaskTable, ModernStoriesTable, ModernGoalsTable on desktop

```
┌──┬──────────┬──────────────────────────────────┬──────────┬──────────┬──────────┬────────┬──────┐
│⠿ │ REF      │ Title                            │ Status ▼ │Priority ▼│ Due Date │ Sprint │ AI   │
├──┼──────────┼──────────────────────────────────┼──────────┼──────────┼──────────┼────────┼──────┤
│⠿ │ TASK-012 │ Refactor auth middleware         │[Sel pill]│[Sel pill]│ Mar 20   │ S-14   │ 72   │
└──┴──────────┴──────────────────────────────────┴──────────┴──────────┴──────────┴────────┴──────┘
```

- Drag handle column (GripVertical, 24px wide)
- Ref column (monospace, 80px wide, muted)
- Title column (flex 1, inline editable on click)
- Status column: `StatusPill mode="select"` — visually matches pill aesthetic
- Priority column: `PriorityPill mode="select"` — same
- Due Date column: date picker inline
- Sprint column: sprint selector dropdown
- AI Score column: numeric, sortable, right-aligned
- Actions: inline at end of row, visible on row hover (desktop); in `•••` button on mobile
- Manual priority rank: shown as `#N` compact indicator in the Ref column or as the first column (if sorting by manual priority)

---

## 11. Filter Bar Standard

**Component**: `FilterBar` + `FilterChip`
**Files to create**: `src/components/shared/FilterBar.tsx`, `src/components/shared/FilterChip.tsx`

### Filter Bar Layout
```
[Top 3] [Overdue] [Critical] [AI Critical] [+ Add Filter]
```

- Chips displayed as horizontal scrollable row (no wrapping on mobile, wrapping on desktop)
- Active chip: background `var(--brand)` at 15% opacity, border `var(--brand)`, text `var(--brand)`
- Inactive chip: background transparent, border `var(--line)`, text `var(--muted)`
- `+ Add Filter` opens a dropdown picker of available filters
- Applied filters are visually highlighted

### Standard Filter Set (Tasks, Stories, Goals)
| Filter ID | Label | Description |
|-----------|-------|-------------|
| `top3` | Top 3 | Items where `aiTop3ForDay == true` today |
| `overdue` | Overdue | Items with `dueDate` < today and not done |
| `critical` | Critical | Items with priority = Critical |
| `ai_critical` | AI Critical | Items with `aiCriticalityScore` ≥ 70 |
| `unlinked` | Unlinked | Items not linked to a goal/story |
| `sprint` | Current Sprint | Items in the current sprint |

### Sort Options (Dropdown or Column Header)
| Sort ID | Label |
|---------|-------|
| `manual` | Manual Priority |
| `ai` | AI Score |
| `due` | Due Date |
| `priority` | Priority |
| `updated` | Last Updated |
| `created` | Created |
| `default` | Default |

---

## 12. Empty State Standard

**Component**: `EmptyState`
**File to create**: `src/components/shared/EmptyState.tsx`

### Props
```tsx
interface EmptyStateProps {
  icon: LucideIcon;          // e.g. Target, CheckSquare, Flag
  title: string;             // e.g. "No tasks yet"
  message: string;           // e.g. "Create your first task to start tracking work"
  action?: {
    label: string;           // e.g. "Create task"
    onClick: () => void;
  };
  filterActive?: boolean;    // If true, shows "clear filters" variant
  onClearFilters?: () => void;
}
```

### Two Variants

**No-data variant**:
```
           🏁
    No tasks yet
    Create your first task to start tracking work.
              [+ Create task]
```

**Filter-active variant**:
```
           🔍
    Nothing matches your filters
    Try clearing your filters or adjusting the search.
              [Clear filters]
```

- Icon: 48px, `var(--muted)` colour, 50% opacity
- Title: 18px, `var(--text)`, font-weight 600
- Message: 14px, `var(--muted)`
- CTA button: outlined style, `var(--brand)` border and text
- Padding: 60px top/bottom, centred

---

## 13. Loading State Standard

**Components**: `SkeletonCard`, `SkeletonRow`
**Files to create**: `src/components/shared/SkeletonCard.tsx`, `src/components/shared/SkeletonRow.tsx`

### SkeletonCard (for card grid views)
Mimics the card dimensions (min-height 180px). Uses a pulsing grey block for each content area:
```
┌─────────────────────────────────────────────────────────┐
│ ████  ██████████████████████████████████████████████   │
│                                                          │
│ ████████████████████████████████████                   │
│                                                          │
│ [████████] [██████] [████]                              │
└─────────────────────────────────────────────────────────┘
```
CSS pulse animation using `@keyframes` with `var(--line)` → `var(--panel)` gradient.

### SkeletonRow (for tables)
Mimics table row height (40px). One block per column:
```
│ ⠿  │ ██████ │ ████████████████████████ │ ████████ │ ████ │ ████ │
```

---

## 14. Mobile Unsupported Screen Standard

**Component**: `MobileUnsupportedScreen`
**File to create**: `src/components/shared/MobileUnsupportedScreen.tsx`

```
        [Monitor icon, 64px]

    This feature works best on desktop

    Sprint planning is a complex planning tool
    designed for desktop use. Open the link on
    your laptop or desktop to access it.

    [📋 Copy link to clipboard]
```

- Background: `var(--panel)`
- Text: `var(--text)` for title, `var(--muted)` for message
- Icon: `Monitor` from Lucide, `var(--muted)` colour
- Copy link button: outlined, `var(--brand)`
- Full viewport height centred vertically

---

## 15. Modal Standard

**Component**: `ModalLayout`
**File to create**: `src/components/shared/ModalLayout.tsx`

### Structure
```
┌─────────────────────────────────────────────────┐
│ Modal Title                               [✕]   │ ← Header (56px)
├─────────────────────────────────────────────────┤
│                                                  │
│  [Body content — specific to each modal]         │
│                                                  │
├─────────────────────────────────────────────────┤
│ [Cancel]                          [Save / Action]│ ← Footer (56px)
└─────────────────────────────────────────────────┘
```

- Header: `var(--panel)` background, title `var(--text)` 16px 600, close button top-right
- Body: `var(--bg)` background, standard padding 20px
- Footer: `var(--panel)` background, Cancel button (secondary) left, Confirm button (primary) right
- Confirm button label: specific action word ("Save", "Create", "Defer", "Update") — never "OK" or "Confirm"
- On mobile: full-screen bottom sheet, slides up from bottom

---

## 16. Tab Bar Standard

**Applies to**: SettingsPage, SprintManagementView, AdvancedOverview, any multi-tab page

```
[Overview]  [Board]  [Table]  [Burndown]  [History]
     ─────
(active underline: 2px solid var(--brand))
```

- Horizontal row of text tabs
- No border/box around tab bar itself — underline only
- Active tab: `var(--brand)` 2px underline, `var(--text)` colour, font-weight 600
- Inactive tab: no underline, `var(--muted)` colour, font-weight 400
- Hover: `var(--text)` colour, no underline
- On mobile: horizontal scroll row (scroll-snap), all tabs remain available

---

## 17. Icon Standard

All icons are from **Lucide React** (the existing library). No other icon library should be introduced.

### Locked Icon Assignments
| Action/Concept | Icon | Notes |
|----------------|------|-------|
| Edit / Edit item | `Pencil` | Replace all `Edit3` usages |
| Schedule / Add to calendar | `CalendarClock` | Replace `Calendar` and `CalendarPlus` usages |
| Defer / Snooze | `Clock3` | Already consistent |
| Delete / Remove | `Trash2` | Already consistent |
| Activity / History stream | `Activity` | Already consistent |
| AI / Magic / Generate | `Wand2` | Already consistent |
| Convert to Story | `BookOpen` | Already consistent |
| Drag handle | `GripVertical` | Already consistent |
| Manual priority | `Star` | New; for indicating Top 3 status |
| Desktop required | `Monitor` | For MobileUnsupportedScreen |
| Empty state: tasks | `CheckSquare` | — |
| Empty state: stories | `BookOpen` | — |
| Empty state: goals | `Target` | Already used |
| Empty state: sprints | `Layers` | — |
| Empty state: finance | `DollarSign` | — |
| Filters | `SlidersHorizontal` | For filter bar toggle |
| Sort | `ArrowUpDown` | For sort control |
| Overflow menu | `MoreHorizontal` | For `•••` buttons |

### Icon Sizing
| Context | Size |
|---------|------|
| Action buttons (desktop) | 14px |
| Action buttons (tablet) | 16px |
| Inline meta icons | 12px |
| Empty state illustration | 48px |
| Mobile unsupported screen | 64px |
| Navigation sidebar items | 18px |

---

## 18. Chip/Badge Colour Semantics

All badges and chips in the product share one colour-meaning vocabulary:

| Colour Family | Semantic meaning | CSS Variable | Do Not Use For |
|---------------|-----------------|-------------|----------------|
| Red / Danger | Critical priority, blocking, error, over-due | `--color-urgency-critical` | Informational content |
| Orange | High priority, warning, approaching deadline | `--color-urgency-high` | Neutral status |
| Yellow | Medium priority, caution | `--color-urgency-medium` | Success states |
| Green | Done, success, on track | `--color-status-done` | Priority levels |
| Blue | In Progress, informational, AI score | `--color-status-inprogress` | Completion states |
| Grey | Neutral, low priority, muted, backlog | `--color-status-backlog` | Active states |

Domain theme colours (Health, Wealth, etc.) are used exclusively for aesthetic theming of goal/story cards. They do not carry semantic meaning and must not be used for status or priority signals.

---

## 19. Density Guide: When to Use Each View

| Context | Recommended View | Rationale |
|---------|-----------------|-----------|
| Planning (desktop, sprint review) | **Table** | Highest data density; sort and compare many items |
| Triage (desktop, quick decisions) | **Card** | Visual scanning; status/priority badges visible |
| Execution (desktop, active sprint) | **Kanban** | Workflow progression; drag to change status |
| Mobile overview | **Mobile Card** | Touch-optimised; top priority items only |
| Mobile triage | **Mobile Card** with filters | Filter chip UX; compact cards |
| Mobile execution | **Mobile Card** with status picker | Tap to mark done |
| Analytics (desktop) | **Table** with sort + AI col | Data analysis; compare scores |
