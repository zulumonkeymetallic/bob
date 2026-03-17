# BOB UX Audit — 02: UI Consistency Matrix

**Audit date**: 2026-03-17
**Domains compared**: Goals, Stories, Tasks, Sprints, Finance, Calendar/Planner
**View types compared**: Modern Table, Card View, Kanban Card, Mobile Card, Planner Card

---

## Reading This Matrix

Each section below compares one UX dimension across all domains and view types. Cells marked **✓** indicate the expected pattern is present; **△** means partially present or inconsistent; **✗** means absent or divergent.

---

## Matrix 1: Layout Pattern

| Domain | Modern Table | Card View | Kanban | Mobile (MobileHome) | Planner |
|--------|-------------|-----------|--------|---------------------|---------|
| **Goals** | ModernGoalsTable — sortable rows, draggable, inline dropdowns | GoalsCardView — responsive CSS grid, border-left theme strip | KanbanBoardV2 — 3 cols (Backlog/In Progress/Done) | 5th tab in MobileHome | — |
| **Stories** | ModernStoriesTable — sortable rows, story points col, linked tasks panel | StoriesCardView — grid, same visual pattern as goals cards | SortableStoryCard inside KanbanBoardV2 | 3rd tab in MobileHome | PlannerWorkCard (UnifiedPlannerPage) |
| **Tasks** | ModernTaskTable — sortable rows, sprint detection, inline editing | TasksCardView — grid | TaskCard inside KanbanBoardV2 story groups | 2nd tab in MobileHome | PlannerWorkCard |
| **Sprints** | ModernSprintsTable | — | SprintManagementView > KanbanBoardV2 tab | Not in MobileHome | — |
| **Finance** | TransactionsList (Bootstrap table) | — | PotsBoard (Kanban) | Not accessible | — |
| **Calendar** | — | — | — | — | UnifiedPlannerPage (React Big Calendar), DailyPlanPage (timeline) |

**Observations**:
- Goals, stories, and tasks share the same three-layout model (table / card / kanban) but they were built independently without a shared spec.
- Sprint data only has table + kanban — no card view.
- Finance has no card view and no mobile surface.
- Calendar has no table or card view; it is planner-only.

---

## Matrix 2: Status Display

| Domain | Modern Table | Card View | Kanban | Mobile |
|--------|-------------|-----------|--------|--------|
| **Goals** | Select dropdown, no visual pill | Clickable Button badge using `statusPillClass()` | Text label in meta row via `storyStatusText()` | Text label |
| **Stories** | Select dropdown, no visual pill | Clickable Button badge | Text label in meta row | Compact badge |
| **Tasks** | Select dropdown (`taskStatusText()` label) | Clickable Button badge | Text label in meta row | Compact badge |
| **Sprints** | Status column as text | — | Status in sprint header | — |
| **Finance** | Status text column (cleared/pending/etc.) | — | — | — |

**Verdict**: Three incompatible renderings of the same data:
- Tables → form control (no visual language)
- Card views → clickable pill (interactive affordance)
- Kanban → read-only text (no interaction)

Status pills use CSS classes from `KanbanCards.css` (`.pill`, `.pill--danger`, `.pill--success`). Card views use inline `statusPillClass()` returning similar styles but applied to a `<Button>` element — same visual result, different DOM structure and interactivity.

---

## Matrix 3: Priority Display

| Domain | Modern Table | Card View | Kanban | Mobile |
|--------|-------------|-----------|--------|--------|
| **Goals** | Select dropdown | Clickable Button badge (`priorityPillClass()`) | Pill via `priorityPillClass()` | Not shown |
| **Stories** | Select dropdown | Clickable Button badge | Pill in meta row | Compact indicator |
| **Tasks** | Select dropdown (`priorityLabel()`) | Clickable Button badge | Pill in meta row | Compact indicator |
| **Sprints** | — | — | — | — |
| **Finance** | — | — | — | — |

**Verdict**: Tables lose all visual priority language. Kanban and card views share the same utility function (`priorityPillClass()`) producing consistent-looking pills, but card views add the clickable cycling interaction while Kanban does not.

---

## Matrix 4: AI Score Display

| Domain | Modern Table | Card View | Kanban | Mobile |
|--------|-------------|-----------|--------|--------|
| **Goals** | `aiCriticalityScore` column (numeric) | Bootstrap `Badge bg="secondary"` "AI NN/100" | **Not shown** | Not shown |
| **Stories** | `aiCriticalityScore` column | Bootstrap `Badge bg="secondary"` "AI NN/100" | **Not shown** | Not shown |
| **Tasks** | `aiCriticalityScore` column | Likely same Badge pattern | **Not shown** | Not shown |

**Verdict**: AI score is invisible in the most-used planning surface (Kanban). The badge format ("AI 85/100") is verbose and uses Bootstrap `Badge`, inconsistent with the pill CSS pattern used for status/priority.

---

## Matrix 5: Top 3 / Manual Priority Badge

| Domain | Modern Table | Card View | Kanban | Mobile |
|--------|-------------|-----------|--------|--------|
| **Goals** | Not shown | Bootstrap `Badge bg="danger"` "#N Priority" | **Not shown** | Not shown |
| **Stories** | Not shown | Bootstrap `Badge bg="danger"` "#N Priority" | CSS class badge in `SortableStoryCard` | Not shown |
| **Tasks** | Not shown | Likely same Badge | **Not shown** | Not shown |

**Verdict**: The Top 3 / manual priority badge is the most inconsistent piece of metadata in the product. It uses two different rendering mechanisms (Bootstrap Badge vs CSS class badge), is absent from Kanban for tasks and goals, and is absent from all table views.

---

## Matrix 6: Action Buttons

| Domain | Card View (desktop) | Kanban | Mobile | Table |
|--------|---------------------|--------|--------|-------|
| **Goals** | Top-right: Schedule (Calendar), Activity, Edit; Bottom: Defer, Delete | Action row in card header (small icon buttons) | Tap item → modal | Modal-based (assumed) |
| **Stories** | Same as goals | Same | Same | Same |
| **Tasks** | Same as goals | Same | Same | Same |

**Common actions across all**: Schedule, Activity, Edit, Defer, Delete

**Observed icon inconsistencies**:

| Action | Kanban | Card View | Table (where visible) |
|--------|--------|-----------|----------------------|
| Edit | `Edit3` | `Edit3` | `Pencil` (in some tables) |
| Schedule | `CalendarClock` or `CalendarPlus` | `Calendar` | `CalendarClock` |
| Defer | `Clock3` | `Clock3` | Absent |
| Activity | `Activity` | `Activity` | `Activity` |
| Delete | `Trash2` | `Trash2` | `Trash2` |
| AI/Magic | `Wand2` | `Wand2` | `Wand2` |

**Verdict**: Edit and Schedule icons are inconsistent. Defer is missing from table views. Button sizes differ significantly: 12-16px icon buttons in Kanban vs 24px icon buttons in card views. No tooltip labels in either context.

---

## Matrix 7: Filter Controls

| Domain | Table | Card View | Kanban | Mobile |
|--------|-------|-----------|--------|--------|
| **Goals** | Column visibility toggles, inline sort | Display toggles (show description, show activity) | Props-based: dueFilter, goalFilter, themeFilter, sortBy | Tab + filter dropdown in MobileHome |
| **Stories** | Column visibility, inline sort | Same display toggles | Same props | Same mobile filters |
| **Tasks** | Column visibility, inline sort | Same display toggles | Same props | top3 / due_today / overdue / all |
| **Sprints** | Sort controls | — | Sprint selector | — |
| **Finance** | Category/date filter | — | — | — |

**Verdict**: No surface uses a shared filter chip/button design. Filters are ad-hoc per-component, never unified. MobileHome has the most coherent filter UX (explicit filter pills at the top of each tab), but this pattern is not used on desktop.

---

## Matrix 8: Chip / Badge Design Language

| Context | Pattern | CSS Mechanism | Interactive? | Dark Mode Safe? |
|---------|---------|---------------|-------------|-----------------|
| Status pills (card views) | Rounded button with background color | `statusPillClass()` returning class string + inline styles from `KanbanCards.css` | Yes (cycle on click) | Partial — hardcoded RGBA values |
| Priority pills (card views) | Same as status | `priorityPillClass()` | Yes (cycle on click) | Partial |
| Status labels (Kanban) | Inline text with pill class | `.kanban-card__pill` CSS class | No | Partial |
| AI score (card views) | Bootstrap `Badge bg="secondary"` | Bootstrap utility | No | No — Bootstrap badge does not adapt to custom dark theme |
| Top 3 (card views) | Bootstrap `Badge bg="danger"` | Bootstrap utility | No | No |
| Top 3 (Kanban) | `.kanban-card__meta-badge` + inline red style | CSS class + inline | No | No — hardcoded `rgba(220, 53, 69, 0.45)` |
| Manual priority (card views) | Bootstrap `Badge bg="danger"` | Bootstrap utility | No | No |
| Theme badges | Custom CSS with `--theme-X-primary` | Domain theme CSS vars | No | **No** — ThemeColors.css has no dark overrides |

**Verdict**: Badges and chips use 4+ different rendering mechanisms across the product. Bootstrap badges are not adapted for the custom dark theme. The pill CSS classes (KanbanCards.css) are the most consistent mechanism but are not universally applied.

---

## Matrix 9: Card Structure Comparison (Goals / Stories / Tasks)

### Kanban Card (KanbanCardV2 / SortableStoryCard)
```
[GripVertical] [Ref ID]                        [Actions: icons at 12-16px]
[Title — bold, full width]
[Description — optional, muted text]
[Tags — optional chips]
[Meta row: status pill | priority pill | points | Top3 badge (stories only)]
[Goal link — if story/task linked to goal]
```
- Compact density
- No dates shown
- No AI score shown
- Actions always visible (not hover-revealed)

### Card View (StoriesCardView / TasksCardView)
```
[Ref ID — muted]                               [Schedule] [Activity] [Edit]
[Title — bold, full width]
[Status button] [Priority button] [AI score badge] [Manual priority badge]
[Description box — if toggled on]
[Latest activity — if toggled on]
[Goal link box — stories only]
[Theme badge]                                  [Defer button] [Delete button]
[Scheduled block info — if present]
[Footer: Created / Updated dates]
```
- Spacious density (min-height 220px)
- Dates visible
- AI score and manual priority visible
- Actions split between top-right and bottom bar

### Mobile Card (MobileHome)
```
[Title]                             [Priority indicator] [Due date]
[Status compact label]
[Goal / sprint link]
```
- Minimal density
- Touch-safe tap area (entire card)
- No action buttons visible inline

### Table Row (ModernTaskTable / ModernStoriesTable / ModernGoalsTable)
```
[Grip] [Ref] [Title (inline edit)] [Status dropdown] [Priority dropdown] [Sprint] [Due] [AI col] [...]
```
- Dense, data-grid style
- Status and priority are form controls, not visual badges
- Actions in row or in overflow (not fully audited)

**Verdict**: Four completely different structural approaches for the same data type. No shared component or CSS base. A new engineer looking at any one of these would not recognise it as the same domain object rendered differently.

---

## Matrix 10: Empty / Loading / Error States

| Context | Loading State | Empty State | Error State |
|---------|---------------|-------------|-------------|
| Kanban (KanbanBoardV2) | `<div>Loading board...</div>` — plain text | Not visible in source | Not visible in source |
| Card views (StoriesCardView, TasksCardView) | Not visible (assumes data from parent) | ✓ Proper: icon (Target/48px) + headline + sub-text | Not visible |
| Mobile (MobileHome) | Not visible | Brief text per section | Not visible |
| Tables | Not visible in audit | Not visible in audit | Not visible in audit |

**Verdict**: Only card views implement a proper empty state. Kanban uses a minimal text placeholder. Tables and mobile states are unknown. No component appears to implement a structured error state (network failure, permission error, etc.).

---

## Matrix 11: Theme Treatment

| Domain / Component | Uses CSS Variables | Hard-Coded Colors | Bootstrap Utilities | Dark Mode Risk |
|--------------------|--------------------|--------------------|---------------------|----------------|
| KanbanBoardV2 / KanbanCardV2 | Partial | `rgba(59,130,246,…)` drag handle; `#dc3545` blocked border | Minimal | Medium |
| StoriesCardView / TasksCardView | Partial | `withAlpha(themeColor, 0.25)` for border | Badge components | Medium |
| SortableStoryCard | Partial | `rgba(220, 53, 69, 0.45)` manual priority badge | — | Medium |
| ModernGoalsTable / TaskTable / StoriesTable | Unknown | Likely inline styles for status | Bootstrap table classes | Unknown |
| MobileHome | No — uses hard-coded `THEME_COLORS` map | Category colour map | Some | High |
| FocusGoalCountdownBanner | No | `#dc3545`, `#fd7e14`, `#0066cc` | — | **Critical** |
| Dashboard | Partial | `#3b82f6`, `#fd7e14` gradient | Bootstrap | High |
| FinanceDashboardAdvanced | Unknown | Likely — finance dashboards rarely adapt | Extensive Bootstrap | High |

---

## Matrix 12: Mobile Support Level (Summary)

| Surface | Rating | Reason |
|---------|--------|--------|
| MobileHome (/mobile) | ✓ Full | Built for mobile — tabs, compact cards, touch filters |
| CheckInDaily/Weekly | ✓ Full | Form-based, mobile-appropriate |
| ChoreChecklistPage | ✓ Full | List-based, mobile-appropriate |
| ApprovalsCenter | △ Partial | Readable but not optimised for touch |
| TasksCardView | △ Partial | CSS Grid is responsive but action buttons are too small for touch |
| StoriesCardView | △ Partial | Same as TasksCardView |
| ModernTaskTable | ✗ Inaccessible | Dense table — columns overflow, dropdowns are small, drag-drop unusable on touch |
| ModernGoalsTable | ✗ Inaccessible | Same as ModernTaskTable |
| KanbanBoardV2 | ✗ Inaccessible | Horizontal 3-column flex, no mobile stack, drag-drop requires pointer |
| UnifiedPlannerPage | ✗ Inaccessible | React Big Calendar drag-and-drop — not touch-safe |
| GoalRoadmapV6 | ✗ Inaccessible | Canvas-based Gantt — no touch interaction, no zoom |
| GoalsYearPlanner | ✗ Inaccessible | Complex planning grid, no mobile adaptation |
| FinanceDashboardAdvanced | ✗ Inaccessible | Charts + dense tables — no mobile layout |
| SprintPlanningMatrix | ✗ Inaccessible | Dense matrix — desktop-only interaction |
| Settings pages | ✗ Desktop-only | Configuration surfaces — inappropriate on mobile |

---

## Cross-Cutting Findings

### Finding A: Three Parallel Component Families, No Shared Base
Goals, stories, and tasks each have table + card + kanban representations. None of these share a base component, CSS module, or state management pattern. Changes to any shared concern (e.g. priority pill design) must be made in 9+ places.

### Finding B: Bootstrap Badges Are Inconsistent with Pill CSS
Card views render AI score and manual priority as Bootstrap `Badge` components. Status and priority use custom CSS class pills from KanbanCards.css. These are visually different and neither adapts correctly to the dark theme.

### Finding C: Drag-and-Drop Is Pervasive and Mobile-Hostile
Drag handles and sortable rows appear in tables, card views, and kanban. None of these contexts have a mobile-safe alternative interaction. On touch devices, items cannot be reordered.

### Finding D: Action Rows Have No Discoverable Labelling
Every action button across all view types is icon-only (no label, no tooltip in most cases). For the Schedule, Defer, and Convert-to-Story actions, there is genuine ambiguity about what the icon means. This is an accessibility concern even on desktop.

### Finding E: The MobileHome Tab Structure Duplicates Desktop Domains but with Different UX Rules
MobileHome independently reimplements task, story, goal, and chore lists with its own data fetching, filter logic, and card design. This creates two diverging implementations of the same domain logic: one optimised for desktop, one for mobile, with no shared components.
