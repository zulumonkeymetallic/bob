# UX Consistency Refactor — Implementation Plan
**Branch**: `feature/ux-consistency-refactor`
**Base commit**: `88a3a2b1` (chore: reconcile current web state and release backlog)
**Audit docs**: `ux-audit/` — read these before touching any file in this plan
**Audit date**: 2026-03-17

## Overview
This plan implements the prioritised findings from the UX consistency audit. The goal is one shared interaction language for goals, stories, and tasks across desktop table, card, and kanban views — plus correct dark mode behaviour and mobile gating for complex planning surfaces.

**Constraints**:
- No backend changes. No Firestore schema changes. No Cloud Function changes.
- Existing kanban cards (KanbanCardV2, SortableStoryCard) and card views (StoriesCardView, TasksCardView, GoalsCardView) are kept. They are the reference standard, not the thing being replaced.
- Changes flow *toward* kanban/card patterns, not away from them.
- Implementation is additive: extract shared sub-components, apply them, do not rewrite working surfaces.

## Commit Reconciliation (last reviewed 2026-03-20)
The following commits landed **after** the original audit (2026-03-17) and affect implementation scope. Auditing agents must verify these before re-implementing anything:

| Commit | Summary | Plan impact |
|--------|---------|-------------|
| `b9bc17a0` | feat: mobile UX consistency and shared filters | **Phase 9 utility done** (`manualPriority.ts`). MobileHome now consumes it. Desktop UI still required. |
| `b9bc17a0` | Same | **Phase 10 partially done** — `ChoreChecklistPage` has Move/Defer pattern. `plannerScheduling.ts` is the correct mutation. MobileHome chores tab still needs it. |
| `b9bc17a0` | Same | `DeferItemModal` updated — now accepts `focusContext` prop. Use updated signature. |
| `b9bc17a0` | Same | `MobileSharedFilters` (top3, chores, focusAligned) added to MobileHome — do not duplicate. |
| `b9bc17a0` | Same | `PlannerWorkCard.tsx` added (460 lines) — used in `WeeklyPlannerSurface` and `DailyPlanPage`. Not relevant to this refactor but do not conflict with it. |
| `d7ecf0c9` | feat: planner move/defer diagnostics | Backend only (Cloud Functions) — no frontend impact. |
| `9dcbeecd` | feat: prevent duplicate GCal sync | Backend only — no frontend impact. |

---

## Audit Reference
| Doc | Purpose |
|-----|---------|
| `ux-audit/01-surface-inventory.md` | Route map with mobile/desktop/legacy classification |
| `ux-audit/02-consistency-matrix.md` | What differs across goals/stories/tasks per view type |
| `ux-audit/03-recommendation-backlog.md` | 42 recommendations with severity/effort/template |
| `ux-audit/04-ui-standards.md` | Target component specs (StatusPill, PriorityPill, AiScoreBadge, etc.) |
| `ux-audit/05-responsive-policy.md` | Per-route mobile classification and implementation pattern |
| `ux-audit/06-theme-governance.md` | CSS token rules, violation catalogue, before/after sketches |

---

## Mobile Card Interaction Decisions
These override the generic mobile card spec in `ux-audit/04-ui-standards.md` Section 9.

### Tasks and Chores — Checkbox pattern
```
☐  Task title here                   [⏱ Defer]  [•••]
   TASK-042  •  Mar 20
   ↳ Sprint 14
```
- Checkbox on the far left. Tapping it marks the item done (sets status to done/complete). Checked state strikes through the title.
- **No status pill shown** — done/not-done is binary for tasks and chores.
- `⏱ Defer` button visible inline (labelled icon, min 44px tap target).
- `•••` overflow for: Schedule, Activity, Edit, Delete, Convert to Story.
- Applies to: `TasksCardView` mobile render, `MobileHome` tasks tab cards, `ChoresTasksPage` mobile cards.

### Stories and Goals — Status pill pattern
```
Story/goal title here          [High]  [⏱ Defer]  [•••]
STORY-042  •  In Progress  •  Mar 20
↳ Sprint 14
```
- **No checkbox** — status has multiple meaningful states (Backlog / In Progress / Review / Done).
- Tapping the status pill opens a compact status picker (not cycling — explicit choice on mobile).
- Priority chip visible (compact, right of title).
- `⏱ Defer` button visible inline.
- `•••` overflow for: Schedule, Activity, Edit, Delete.
- Applies to: `StoriesCardView` mobile render, `MobileHome` stories/goals tab cards.

### Chores specifically
Chores have a **Move** button (not Defer). Move applies a smart interval postpone with no modal:
- `intervalUnit === 'days'` → add 1 day to due date
- `intervalUnit === 'weeks'` → add 1 week to due date
- `intervalUnit === 'months'` → add `Math.ceil(intervalValue / 2)` months (e.g. 4-month interval → +2 months, 1-month → +1 month)

Move fires immediately on tap — no confirmation modal. Defer is also available in `•••` overflow for custom-date snoozing.

The existing `ChoreChecklistPage` checklist interaction is preserved — this applies to card-view renders of chores elsewhere (e.g. MobileHome chores tab).

### Pills vs Buttons — The Rule
- **Pills** = data state indicators (status, priority). Tap to change the data value.
- **Buttons** = actions (Defer, Move, Schedule, Edit, Delete). Tap to execute an operation.
- If a context already has a **dropdown** for a field (table view status/priority dropdowns), do **not** also show a pill for that field. The dropdown is the control.
- Defer is always a button. Move is always a button. Never render these as pills.

---

## Phase 0 — iPad 11" Analysis & Support
**Device target**: iPad Air / iPad Pro 11" — 820×1180px portrait, 1180×820px landscape
**Effort**: Analysis ~0.5 day, implementation ~1–2 days
**Why this matters**: iPad sits between the app's current breakpoints. Portrait (820px) gets a squeezed desktop layout. Landscape (1180px) gets full desktop but with touch-only interaction that assumes pointer events (drag-and-drop, hover-reveal actions, no touch targets).

### 0A. Viewport Behaviour Audit (Analysis — read existing code, no changes yet)

**Current breakpoints to verify in code**:
| File | Breakpoint logic | iPad portrait result |
|------|-----------------|---------------------|
| `SidebarLayout.tsx` | `window.innerWidth <= 768` → mobile | 820px = **desktop layout** (sidebar visible) |
| `deviceDetection.ts` | `width < 768px OR mobile UA` → isMobile | 820px = **not mobile** |
| CSS Bootstrap grid | `md` = 768px, `lg` = 992px | 820px = between md and lg |
| `KanbanBoardV2.tsx` | No breakpoint check | 820px = 3-column flex (likely cramped) |
| `UnifiedPlannerPage.tsx` | No breakpoint check | 820px = full drag-drop calendar |
| `ModernTaskTable.tsx` | No breakpoint check | 820px = full table (may overflow) |

**Safari on iPad specifics**:
- UA string contains "iPad" → `isTablet()` in deviceDetection.ts returns true, but `isMobile()` returns false
- Supports both touch events AND pointer events (when keyboard/pencil attached)
- Hover states: only triggered when keyboard/pencil attached; finger touch skips hover
- Drag-and-drop: broken with finger touch; works with Apple Pencil

**Key screens to audit at 820px portrait**:

| Screen | Expected issue at 820px |
|--------|------------------------|
| Sidebar + content | Sidebar (250px) + content (570px) — content is tight but workable |
| Kanban 3-column | Each column ~183px — card content will overflow or wrap badly |
| Sprint planning matrix | Dense grid — likely unusable at 820px |
| Finance dashboard charts | Side-by-side charts collapse awkwardly |
| Goal roadmap (Gantt) | Canvas-based — no touch scroll/zoom |
| Table views | Horizontal scroll needed — acceptable on iPad |
| Calendar (React Big Cal) | Week view at 820px — events very narrow |
| MobileHome | Currently excluded (820px > 768px mobile gate) — iPad users can't access mobile-first UI |

### 0B. Breakpoint Strategy for iPad

Add a **tablet breakpoint** at 1024px as a distinct tier:

| Name | Width | Layout |
|------|-------|--------|
| Mobile | < 768px | MobileHome, single-column, no sidebar |
| Tablet | 768–1024px | Collapsible sidebar, touch-safe cards, no drag-and-drop |
| Desktop | ≥ 1024px | Full desktop with sidebar, drag-and-drop, hover actions |

**Changes required in `deviceDetection.ts`**:
- Add `isTablet(): width >= 768 && width < 1024` (already partially there)
- Expose a `useIsTablet()` hook alongside `useIsMobile()`

**Changes required in `SidebarLayout.tsx`**:
- Currently collapses sidebar at ≤ 768px only
- Change to: sidebar collapsed (offcanvas) at < 1024px on touch devices (iPad portrait), visible at ≥ 1024px
- Detection: `(isTablet() && isTouchDevice()) || isMobile()`

### 0C. Per-Screen iPad Recommendations

| Screen | iPad portrait (820px) | iPad landscape (1180px) |
|--------|----------------------|------------------------|
| Dashboard | Simplify to 1-col card grid | Full desktop layout |
| Tasks/Stories/Goals table | Show card view (same as mobile rule) | Show table |
| Kanban board | 2-column (Backlog + In Progress), Done hidden behind tab | 3-column desktop layout |
| Sprint planning | Show `MobileUnsupportedScreen` (touch-incompatible) | Full desktop |
| Goal roadmap | Show `MobileUnsupportedScreen` | Full desktop |
| Calendar | Agenda view + FAB (same as mobile) | Full week view, no drag-drop |
| Finance dashboard | Summary cards (same as mobile) | Full dashboard |
| Settings | Full settings (tablet screen is large enough) | Full settings |
| MobileHome `/mobile` | Should be accessible — add iPad portrait to mobile redirect | Not needed in landscape |

### 0D. Touch-Safe Action Adjustments for Tablet

On tablet (touch device, not pointer device):
- All action buttons: minimum 44px tap target (same rule as mobile)
- Hover-reveal action buttons (if any exist in kanban/cards): always visible on touch devices (no `hover` state available with finger)
- Drag-and-drop in Kanban: **disabled** on touch devices — replace with status picker (same as mobile kanban stacked view in Phase 7)
- Drag-and-drop in tables: disabled on touch — reordering deferred to desktop

**Detection pattern**:
```typescript
const isTouchOnly = !window.matchMedia('(pointer: fine)').matches;
// pointer: fine = mouse/trackpad/pencil
// pointer: coarse = finger touch
// iPad with keyboard cover: pointer: fine (trackpad)
// iPad without keyboard: pointer: coarse
```
Use `pointer: coarse` media query in CSS and a `useTouchOnly()` hook in components to disable drag-and-drop and reveal action buttons permanently.

### 0E. Auditor Checklist for Phase 0

- [ ] `deviceDetection.ts` exposes `isTablet()` returning true for 768–1024px
- [ ] `useIsTablet()` hook exists alongside `useIsMobile()`
- [ ] `SidebarLayout.tsx` collapses to offcanvas on tablet + touch
- [ ] Task/story/goal tables auto-switch to card view at < 1024px on touch devices
- [ ] Kanban board shows 2-column layout (or stacked) on tablet touch
- [ ] Calendar shows agenda view on tablet touch
- [ ] All action buttons are 44px minimum on tablet (pointer: coarse)
- [ ] Drag-and-drop disabled when `pointer: coarse`
- [ ] `MobileUnsupportedScreen` gates applied at tablet width for sprint planning and goal roadmap
- [ ] iPad portrait (820px) does not route to `/mobile` but gets the tablet layout
- [ ] App renders without horizontal overflow at 820px portrait

---

## Phase 1 — CSS Foundation (no component changes yet)
**Audit refs**: REC-001, REC-002, REC-012, REC-020, REC-022, REC-035
**Effort**: ~1 day
**Must complete before Phase 2**

### 1A. Add semantic status/urgency tokens to index.css
**File**: `react-app/src/index.css`
Add under a `/* Semantic Status & Urgency Tokens */` comment block in both `:root` and `[data-theme="dark"]`:
```css
/* :root */
--color-urgency-critical: #dc3545;
--color-urgency-high: #fd7e14;
--color-urgency-medium: #e5a400;
--color-urgency-low: #6c757d;
--color-status-done: #198754;
--color-status-inprogress: #0d6efd;
--color-status-backlog: #6c757d;
--color-status-blocked: #dc3545;
--color-status-review: #fd7e14;
--color-gradient-accent-start: #fd7e14;
--color-gradient-accent-end: #b35c00;

/* [data-theme="dark"] */
--color-urgency-critical: #e87d87;
--color-urgency-high: #f4a45a;
--color-urgency-medium: #f0c040;
--color-urgency-low: #a0a5b1;
--color-status-done: #5dba85;
--color-status-inprogress: #6aa5ff;
--color-status-backlog: #a0a5b1;
--color-status-blocked: #e87d87;
--color-status-review: #f4a45a;
--color-gradient-accent-start: #c46a0a;
--color-gradient-accent-end: #8a4200;
```

### 1B. Add dark mode overrides to ThemeColors.css
**File**: `react-app/src/styles/ThemeColors.css`
For all 16 domain themes (health, growth, wealth, tribe, home, work, sidegig, sleep, random, chores, rest, travel, defect + any others present), add a `[data-theme="dark"]` block that:
- Increases `-lighter` opacity from ~0.1 to ~0.15
- Lightens `-primary` colour so it remains visible on `--card: #171a21`
See `ux-audit/06-theme-governance.md` Section 9 for the Health example pattern to follow.

### 1C. Fix FocusGoalCountdownBanner hard-coded urgency colours
**File**: `react-app/src/components/FocusGoalCountdownBanner.tsx`
Find `getUrgencyColor()` function. Replace all returned hex strings with CSS variable references:
- `'critical'` → `var(--color-urgency-critical)`
- `'high'` → `var(--color-urgency-high)`
- `'normal'` → `var(--color-urgency-low)` (use low/muted for normal)
- `'low'` → `var(--color-urgency-low)`
Also check for any `color:` or `background:` inline styles in this component using hex values and replace with the appropriate token.

### 1D. Fix Dashboard calendar hard-coded colours
**File**: `react-app/src/styles/Dashboard.css`
Find `.rbc-current-time-indicator` rule. Replace `background-color: #dc3545` with `background-color: var(--color-urgency-critical)`.
Find any gradient definitions with hard-coded hex values in dashboard banner cards. Replace with `var(--color-gradient-accent-start)` and `var(--color-gradient-accent-end)`.

### 1E. Fix KanbanCardV2 and SortableStoryCard hard-coded colours
**Files**: `react-app/src/components/KanbanCardV2.tsx`, `react-app/src/components/stories/SortableStoryCard.tsx`
- KanbanCardV2: Replace `rgba(59, 130, 246, ...)` on drag handle with `var(--brand)` at opacity via CSS
- KanbanCardV2: Replace `var(--bs-danger, #dc3545)` blocked border fallback with `var(--color-urgency-critical)`
- SortableStoryCard: Replace `rgba(220, 53, 69, 0.45)` on manual priority badge with `var(--color-urgency-critical)` at 20% opacity

### 1F. Update KanbanCards.css pill colours to use tokens
**File**: `react-app/src/styles/KanbanCards.css`
Find the `.pill--danger`, `.pill--warning`, `.pill--success`, `.pill--orange` variant rules. Replace their hard-coded RGBA values with the corresponding `var(--color-urgency-*)` and `var(--color-status-*)` tokens defined in 1A.

### 1G. Remove MaterialDesign.css
**Files**: `react-app/src/styles/MaterialDesign.css` + its import location
Find where MaterialDesign.css is imported (likely `index.css` or `App.tsx`). Remove the import. Delete the file. Verify no component references `--md-*` variables (none found in audit).

### 1H. Add theme precedence comment block to index.css
**File**: `react-app/src/index.css`
Add a comment block at the top explaining the CSS load order and which system is active (see `ux-audit/06-theme-governance.md` Section 6).

---

## Phase 2 — Shared Component Library
**Audit refs**: REC-008, REC-009, REC-010, REC-013, REC-014, REC-016, REC-033
**Effort**: ~3 days
**Depends on Phase 1**
**Create directory**: `react-app/src/components/shared/`

### 2A. StatusPill component
**File**: `react-app/src/components/shared/StatusPill.tsx`
Props: `status: string`, `mode: 'readonly' | 'interactive' | 'select'`, `onChange?: (newStatus) => void`
- `readonly`: `<span>` with `.pill` CSS class + status-specific class
- `interactive`: `<button>` that cycles status on click, same visual
- `select`: `<select>` styled to look like the pill (using the same CSS class, custom select styling)
Colour mapping uses `var(--color-status-*)` tokens from Phase 1A.
See `ux-audit/04-ui-standards.md` Section 2 for full spec.

### 2B. PriorityPill component
**File**: `react-app/src/components/shared/PriorityPill.tsx`
Same structure as StatusPill. Props: `priority: string`, `mode`, `onChange?`
Colour mapping uses `var(--color-urgency-*)` tokens.
See `ux-audit/04-ui-standards.md` Section 3.

### 2C. AiScoreBadge component
**File**: `react-app/src/components/shared/AiScoreBadge.tsx`
Props: `score?: number`, `threshold?: number` (default 20)
Renders `AI {score}` as compact pill. Hidden when score < threshold or undefined.
Replaces Bootstrap `<Badge bg="secondary">AI NN/100</Badge>` in card views.
See `ux-audit/04-ui-standards.md` Section 4.

### 2D. ManualPriorityBadge component
**File**: `react-app/src/components/shared/ManualPriorityBadge.tsx`
Props: `rank?: number`
Renders `#{rank}` as compact bold pill using `var(--color-urgency-critical)` at 20% opacity.
Hidden when rank is undefined or 0.
Replaces Bootstrap `<Badge bg="danger">#N Priority</Badge>` in card views and `.kanban-card__meta-badge` with inline red in SortableStoryCard.
See `ux-audit/04-ui-standards.md` Section 5.

### 2E. EmptyState component
**File**: `react-app/src/components/shared/EmptyState.tsx`
Props: `icon: LucideIcon`, `title: string`, `message: string`, `action?: {label, onClick}`, `filterActive?: boolean`, `onClearFilters?: () => void`
Two variants: no-data (with create CTA) and filter-active (with clear-filters CTA).
Extracts the existing pattern from StoriesCardView/TasksCardView.
See `ux-audit/04-ui-standards.md` Section 12.

### 2F. MobileUnsupportedScreen component
**File**: `react-app/src/components/shared/MobileUnsupportedScreen.tsx`
Props: `title: string`, `description: string`
Renders centred card with Monitor icon, title, message, and "Copy link to clipboard" button.
Used as a gate for desktop-only surfaces.
See `ux-audit/04-ui-standards.md` Section 14.

### 2G. useIsMobile hook
**File**: `react-app/src/hooks/useIsMobile.ts`
Wraps existing `deviceDetection.ts` utility in a React hook with window resize listener.
Returns `boolean`. Used by all mobile-gating logic in Phase 3+.
Do not duplicate the detection logic — call through to the existing utility.

---

## Phase 3 — Apply Shared Components to Kanban + Card Views
**Audit refs**: REC-008, REC-009, REC-010, REC-011, REC-013, REC-014, REC-021
**Effort**: ~3 days
**Depends on Phase 2**
**Important**: Card structure is preserved. Only internals change.

### 3A. Update KanbanCardV2
**File**: `react-app/src/components/KanbanCardV2.tsx`
- Import and use `AiScoreBadge` — add to the meta row after priority pill
- Import and use `ManualPriorityBadge` — add to meta row before priority pill
- Change `Edit3` import to `Pencil`
- Change `CalendarPlus` / `Calendar` (whichever is present) to `CalendarClock`
- Add `title` attributes to all icon buttons (e.g., `title="Edit"`, `title="Schedule"`)
- Status and priority pills: can keep existing `.pill` CSS approach (it is already the reference standard) — no mandatory refactor to StatusPill component, but may use it

### 3B. Update SortableStoryCard
**File**: `react-app/src/components/stories/SortableStoryCard.tsx`
- Replace `.kanban-card__meta-badge` + inline red for manual priority with `ManualPriorityBadge`
- Add `AiScoreBadge` to meta row if not already present
- Add `title` attributes to all icon buttons
- Standardise edit icon to `Pencil`

### 3C. Update StoriesCardView
**File**: `react-app/src/components/StoriesCardView.tsx`
- Replace `<Badge bg="secondary">AI NN/100</Badge>` with `<AiScoreBadge score={...} />`
- Replace `<Badge bg="danger">#N Priority</Badge>` with `<ManualPriorityBadge rank={...} />`
- Remove `Badge` import from react-bootstrap if no longer used
- Change schedule icon to `CalendarClock` if it isn't already
- Add `title` attributes to all icon buttons
- Replace existing EmptyState JSX (icon + title + message) with `<EmptyState ... />`

### 3D. Update TasksCardView
**File**: `react-app/src/components/TasksCardView.tsx`
Same changes as 3C applied to the tasks equivalent.

### 3E. Update GoalsCardView
**File**: `react-app/src/components/GoalsCardView.tsx`

**Design intent confirmed**: Goals card is intentionally different from stories/tasks — it is an information/strategy card, not an execution card. The following elements are **by design and must not be changed to match stories/tasks**:
- **Top 6px theme bar** (not a left-border strip) — appropriate for a strategic object
- **No Defer button** — goals are not deferred
- **No manual priority** — `{/* Priority removed */}` comments in code reflect a product decision; do not re-add
- **No AI score** — goals do not have `aiCriticalityScore`
- **No status cycling** — goal status is not interactively cycled on the card

**Changes required in GoalsCardView**:

1. **Edit icon**: Change `Edit3` import to `Pencil` (line ~4 and ~875) — standardise across all cards.

2. **Status badge in footer** (lines ~1140–1148): Replace Bootstrap `Badge` with `StatusPill` in `mode="readonly"`:
   ```tsx
   // Before
   <Badge style={{ backgroundColor: statusColors[getStatusName(goal.status)] ... }}>
     {getStatusName(goal.status)}
   </Badge>
   // After
   <StatusPill status={goal.status} mode="readonly" size="sm" />
   ```
   This makes status visually consistent with the pill language used on story/task cards.

3. **KPI badge** (lines ~1149–1158): Keep as-is — this is goal-specific metadata with no equivalent on stories/tasks. Ensure `kpiStatusColor` resolves to a CSS variable, not a hard-coded hex. Audit the `kpiStatusColor` computation and replace any hex values with `var(--color-status-*)` tokens.

4. **Pot badge** (lines ~1163–1166): Change `bg="light" text="dark"` to use CSS variables:
   ```tsx
   // Before
   <Badge bg="light" text="dark" className="border">
   // After
   <Badge style={{ backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>
   ```
   The `bg="light"` pattern is a dark mode failure — it produces a white badge on a dark background.

5. **No structural changes** — keep the card's overall layout, the theme bar, progress section, stats, habits metrics, and footer as-is.

**Auditor note for 3E**: Do not add StatusPill in interactive mode to goals. Do not add Defer, manual priority, or AI score. The goal card is intentionally more analytical than the story/task card.

---

## Phase 4 — Mobile Gating
**Audit refs**: REC-003, REC-004, REC-005, REC-006, REC-007, REC-017, REC-018, REC-031
**Effort**: ~2 days
**Depends on Phase 2 (MobileUnsupportedScreen + useIsMobile)**

### 4A. Auto-switch tables to card view on mobile
**Files**:
- `react-app/src/components/TaskListView.tsx` (wraps ModernTaskTable + TasksCardView)
- `react-app/src/components/StoriesManagement.tsx` (or whichever wraps story views)
- `react-app/src/components/GoalsManagement.tsx` (wraps goal views)

In each wrapper, import `useIsMobile`. If `isMobile`, force `viewMode = 'card'` and hide the table/card toggle button. The card views already exist and are the mobile render target.

### 4B. Gate roadmap and year planner surfaces
**Files**:
- `react-app/src/components/visualization/GoalRoadmapV6.tsx`
- `react-app/src/components/GoalsYearPlanner.tsx`
- `react-app/src/components/visualization/EnhancedGanttChart.tsx` (if routable)

At top of render, add: `const isMobile = useIsMobile(); if (isMobile) return <MobileUnsupportedScreen title="Goal Roadmap" description="The roadmap is a Gantt chart designed for desktop use." />;`

### 4C. Gate sprint planning matrix
**File**: `react-app/src/components/SprintPlanningMatrix.tsx`
Same gate pattern as 4B.

### 4D. Calendar agenda-only on mobile
**File**: `react-app/src/components/planner/UnifiedPlannerPage.tsx`
On mobile: set `defaultView="agenda"`, remove `DragDropCalendar` wrapper (use plain `Calendar`), show a FAB for adding items instead of click-to-create.
This is the most complex gate in Phase 4 — the DragDropCalendar wrapper must be conditionally omitted.

### 4E. Finance dashboard mobile summary
**File**: `react-app/src/components/FinanceDashboardAdvanced.tsx` (or equivalent active file)
On mobile: render a `FinanceMobileSummary` section showing 3 key metrics (month spend, budget remaining, recent transactions). Hide chart tabs and transaction table. Add "Full dashboard available on desktop" link.

### 4F. FocusGoalsPage mobile simplification
**File**: `react-app/src/components/FocusGoalsPage.tsx`
On mobile: render countdown banner + simplified goal list only. Hide `FocusGoalWizard` and `GoalKpiStudioPanel`. Add `MobileUnsupportedScreen` message for those sections.

### 4G. Settings page mobile simplification
**File**: `react-app/src/components/SettingsPage.tsx`
On mobile: show only profile and notification tabs. Hide AI, finance, developer, privacy, integrations tabs. Add "More settings available on desktop" at bottom.
For `/settings/integrations/*` routes: add `MobileUnsupportedScreen` gate at route level or in SidebarLayout.

### 4H. Hide desktop-only nav items on mobile
**File**: `react-app/src/components/SidebarLayout.tsx`
Add a `desktopOnly: true` flag to nav item definitions for: roadmap routes, year planner, sprint planning, finance deep pages, analytics, logs, canvas.
In the nav render loop, skip items with `desktopOnly: true` when `isMobile`.

---

## Phase 5 — MobileHome THEME_COLORS and Capacity Banner
**Audit refs**: REC-015, REC-039
**Effort**: ~0.5 day
**Depends on Phase 1B (ThemeColors.css dark overrides)**

### 5A. Replace hard-coded THEME_COLORS map in MobileHome
**File**: `react-app/src/components/MobileHome.tsx`
Find the `THEME_COLORS` object mapping category names to hex values. Replace with a `THEME_CSS_VARS` map pointing to CSS variable names (e.g., `'health': '--theme-health-primary'`). Apply using `style={{ color: 'var(--theme-health-primary)' }}`.

### 5B. Compact capacity indicator for MobileHome
**File**: `react-app/src/components/MobileHome.tsx` (overview tab)
Extract capacity state from `PlannerCapacityBanner`. In MobileHome overview, render a compact capacity badge when over-capacity. Use `var(--color-urgency-high)` for the warning colour.

---

## Phase 6 — Icon and Label Standardisation
**Audit refs**: REC-013, REC-014, REC-032
**Effort**: ~0.5 day
**Can run in parallel with Phase 5**

### 6A. Global icon audit pass
Search for all `Edit3` imports → replace with `Pencil`.
Search for `CalendarPlus` or standalone `Calendar` used as a schedule action icon → replace with `CalendarClock`.
Files expected to be affected: KanbanCardV2 (done in 3A), ModernTaskTable, ModernStoriesTable, ModernGoalsTable, any other card or table component.

### 6B. Terminology copy pass
Search for "top3", "Top3", "AI Critical" in JSX string content and filter button labels.
Standardise to: "Top 3" (user-facing label), "AI Critical" (filter name), "#N Priority" (rank badge).
Files: KanbanBoardV2 filter labels, MobileHome filter labels, any filter bar components.

---

## Phase 7 — Kanban Mobile Stacked View
**Audit refs**: REC-003
**Effort**: ~2 days
**Depends on Phase 2 (useIsMobile), Phase 3 (shared badges)**

### 7A. Mobile stack mode in KanbanBoardV2
**File**: `react-app/src/components/KanbanBoardV2.tsx`
On mobile: instead of 3-column flex layout, render a single-column list grouped by status (Backlog / In Progress / Done as collapsible sections). Drag-and-drop is removed. Each card gets a status picker (tap opens a small status selector using StatusPill mode="interactive"). Action buttons follow the mobile overflow pattern (44px `...` button).
This is the largest change in Phase 7. It requires a conditional render path inside KanbanBoardV2 — do not create a separate component.

---

## Phase 9 — Manual Priority 3-State Cycle (Desktop)
**Audit refs**: existing feature extension
**Effort**: ~0.5 day (was 1 day — utility pre-built, see below)
**Files**: `react-app/src/components/KanbanCardV2.tsx`, `react-app/src/components/stories/SortableStoryCard.tsx`, `react-app/src/components/StoriesCardView.tsx`, `react-app/src/components/TasksCardView.tsx`, `react-app/src/components/ModernStoriesTable.tsx`, `react-app/src/components/ModernTaskTable.tsx`

### ⚠️ Pre-built — do NOT recreate
**`react-app/src/utils/manualPriority.ts`** was added in commit `b9bc17a0` (2026-03-17).
It exports: `getManualPriorityRank`, `getManualPriorityLabel`, `getNextManualPriorityRank`, `findItemWithManualPriorityRank`.
**Import from this file directly.** Do not inline the logic or create a duplicate utility.

`MobileHome.tsx` already consumes this utility and has a working `applyPriorityFlag` handler (lines 706–748) that performs the 3-state cycle (clear existing rank, assign next rank, bump conflicting item, fire `deltaPriorityRescore`).
**Use this handler as the reference implementation.** Desktop components should replicate the same Firestore write pattern and callable invocation.

### 9A. Change KanbanCardV2 priority button from toggle to 3-state cycle
**File**: `react-app/src/components/KanbanCardV2.tsx`

Current behaviour: click sets priority (assigns next available rank), click again removes it.
Required behaviour: cycle through ranks 1 → 2 → 3 → off → 1.

Reference the `applyPriorityFlag` handler in `MobileHome.tsx:706` for the write pattern.

Colour coding:
- Rank 1: `var(--color-urgency-critical)` (red)
- Rank 2: `var(--color-urgency-high)` (amber)
- Rank 3: `var(--muted)` (grey)
- Unranked: muted outline

After each change: show replan prompt (already implemented — keep existing behaviour).

### 9B. Add interactive priority button to SortableStoryCard
**File**: `react-app/src/components/stories/SortableStoryCard.tsx`

Currently shows a read-only badge. Replace the badge with the same interactive button as 9A.
The button goes in the card action row (same position as KanbanCardV2).

### 9C. Add priority button to StoriesCardView and TasksCardView
**Files**: `react-app/src/components/StoriesCardView.tsx`, `react-app/src/components/TasksCardView.tsx`

Add the priority cycle button to each card, in the badge row (after status and priority pills).
Same 3-state cycle and colour logic as 9A.

### 9D. Add manual priority column to ModernStoriesTable and ModernTaskTable
**Files**: `react-app/src/components/ModernStoriesTable.tsx`, `react-app/src/components/ModernTaskTable.tsx`

Add a `#` column showing the rank badge (read-only display). The badge is clickable and uses the same cycle logic. Place as the first sortable column after the drag handle.

---

## Phase 10 — Chore Move/Defer Consistency (Desktop)
**Effort**: ~0.5 day
**Status update from commit `b9bc17a0` (2026-03-17)**: Significant pre-existing work discovered.

### ⚠️ Pre-built — what already exists

**`ChoreChecklistPage.tsx`** already has a working Move/Defer button:
- Uses `DeferItemModal` (the existing modal, not a custom chore one)
- Calls `schedulePlannerItemMutation` from `plannerScheduling.ts` with `intent: 'defer'`
- Button labelled "Move/Defer" (line 302) with `title="Move/defer chore"`
- This is the **reference implementation** — replicate this pattern on desktop

**`plannerScheduling.ts`** (added in `b9bc17a0`) — `schedulePlannerItemMutation` is the correct mutation to use. Do not call Firestore directly for scheduling.

**`DeferItemModal.tsx`** (updated in `b9bc17a0`) — now accepts a `focusContext` prop and passes it to `suggestDeferralOptions`. Use this updated signature when opening the modal from desktop chore views.

**`MobileHome.tsx`** — the chores tab does NOT yet have a Move/Defer button for individual chores. The existing defer flow is wired to tasks/stories only. This needs to be added (see 10C below).

### 10A. Verify calculateChoreMoveDueDate utility
**File**: `react-app/src/utils/recurringTaskDue.ts`

Check whether this function already exists (it may have been added). If not, add it using the field names from actual chore data (check `ChoreChecklistPage.tsx` for field references — `intervalUnit`, `intervalValue`):

```typescript
export function calculateChoreMoveDueDate(chore: Task): Date {
  const base = chore.dueDate ? new Date(chore.dueDate) : new Date();
  const unit = (chore as any).intervalUnit;
  const value = Number((chore as any).intervalValue || 1);
  switch (unit) {
    case 'days':   return addDays(base, 1);
    case 'weeks':  return addWeeks(base, 1);
    case 'months': return addMonths(base, Math.ceil(value / 2));
    default:       return addDays(base, 1);
  }
}
```

### 10B. Add Move/Defer button to desktop chore views
**Target files**: whichever desktop component renders the chore list (check `/chores` route in `App.tsx`).

Copy the pattern from `ChoreChecklistPage.tsx:187–221` (the `handleApplyDefer` handler) and `ChoreChecklistPage.tsx:301–311` (the button rendering).

The desktop chore view should have a Move/Defer button per chore row that:
- Opens `DeferItemModal` with `itemType="task"`, `itemId`, `itemTitle`, and `focusContext`
- On apply, calls `schedulePlannerItemMutation` with `intent: 'defer'`
- Shows a brief success message

### 10C. Add Move/Defer to MobileHome chores tab
**File**: `react-app/src/components/MobileHome.tsx`

The chores tab renders individual chore tasks but currently has no Move/Defer action per chore. Add:
- **Move/Defer** button per chore card (same 44px minimum tap target, labelled)
- Sets `deferTarget` state with `type: 'task'` — the existing `DeferItemModal` + `applyDefer` handler already handles tasks
- This re-uses the existing defer machinery already in `MobileHome.tsx` (lines 676–704)

---

## Phase 8 — Roadmap Version Cleanup
**Audit refs**: REC-029, REC-034
**Effort**: ~0.5 day

### 8A. Point /goals/roadmap default to V6
**File**: `react-app/src/App.tsx`
Change the `/goals/roadmap` route to render `GoalRoadmapV6` instead of `GoalRoadmapV5`.

### 8B. Remove V5 and legacy roadmap from sidebar navigation
**File**: `react-app/src/components/SidebarLayout.tsx`
Remove nav links for `/goals/roadmap-v5`, `/goals/roadmap-legacy`, `/goals/timeline` (or mark visually as legacy). Keep the routes in App.tsx alive for backwards compat.

---

## Auditor Checklist (for agent reviewing this work)

An auditor agent reviewing completed PRs should verify:

**Phase 1 (CSS)**
- [ ] `index.css` contains `--color-urgency-*` and `--color-status-*` tokens in both `:root` and `[data-theme="dark"]`
- [ ] `ThemeColors.css` has `[data-theme="dark"]` blocks for all domain themes
- [ ] `FocusGoalCountdownBanner.tsx` contains no hex colour values — only CSS var references
- [ ] `Dashboard.css` contains no hex values on `.rbc-current-time-indicator`
- [ ] `MaterialDesign.css` is deleted
- [ ] `KanbanCards.css` pill colour rules reference CSS variables, not RGBA literals

**Phase 2 (Shared components)**
- [ ] `src/components/shared/StatusPill.tsx` exists, exports `StatusPill`, accepts `mode` prop
- [ ] `src/components/shared/PriorityPill.tsx` exists, exports `PriorityPill`
- [ ] `src/components/shared/AiScoreBadge.tsx` exists, hides when score < threshold
- [ ] `src/components/shared/ManualPriorityBadge.tsx` exists, hides when rank undefined
- [ ] `src/components/shared/EmptyState.tsx` exists, has both no-data and filter-active variants
- [ ] `src/components/shared/MobileUnsupportedScreen.tsx` exists, renders with CSS variable colours
- [ ] `src/hooks/useIsMobile.ts` exists, calls through to `deviceDetection.ts`

**Phase 3 (Kanban + card views)**
- [ ] `KanbanCardV2.tsx` renders `AiScoreBadge` and `ManualPriorityBadge` in the meta row
- [ ] `SortableStoryCard.tsx` uses `ManualPriorityBadge`, no inline red RGBA
- [ ] `StoriesCardView.tsx` and `TasksCardView.tsx` use `AiScoreBadge` and `ManualPriorityBadge` — no Bootstrap `Badge` for these
- [ ] All icon buttons in kanban/card views have `title` attributes
- [ ] Edit icon is `Pencil` not `Edit3` in all modified files
- [ ] Schedule icon is `CalendarClock` in all modified files

**Phase 4 (Mobile gating)**
- [ ] `TaskListView`, story wrapper, and `GoalsManagement` force card view when `useIsMobile()` is true
- [ ] `GoalRoadmapV6`, `GoalsYearPlanner` render `MobileUnsupportedScreen` on mobile
- [ ] `SprintPlanningMatrix` renders `MobileUnsupportedScreen` on mobile
- [ ] `UnifiedPlannerPage` renders agenda-only (no drag-drop) on mobile
- [ ] `SidebarLayout` hides desktop-only nav items on mobile

**Phase 5 (MobileHome)**
- [ ] `MobileHome.tsx` has no hex colour values in the THEME_COLORS / category map

**Phase 9 (Manual priority cycle)**
- [ ] KanbanCardV2 priority button cycles 1 → 2 → 3 → off (not toggle)
- [ ] Rank 1 = red, Rank 2 = amber, Rank 3 = grey
- [ ] SortableStoryCard has interactive priority button (not read-only badge)
- [ ] StoriesCardView and TasksCardView have priority cycle button
- [ ] ModernStoriesTable and ModernTaskTable have `#` column with cycle button
- [ ] Replan prompt fires after each rank change

**Phase 10 (Chore Move)**
- [ ] `calculateChoreMoveDueDate()` exists in `recurringTaskDue.ts`
- [ ] Move fires immediately with no modal
- [ ] Daily → +1 day, Weekly → +1 week, Monthly(N) → +ceil(N/2) months
- [ ] Move button present on desktop chores UI
- [ ] Move button present on MobileHome chores tab
- [ ] Defer is still available in `•••` overflow on mobile chores

**Phase 6 (Icons/copy)**
- [ ] No `Edit3` import remaining in any component (except if genuinely different semantic use)
- [ ] No `CalendarPlus` used as the schedule action icon
- [ ] Filter labels use "Top 3" (with space) not "top3" or "Top3"

**Cross-cutting**
- [ ] No new hex colour values introduced in any `.tsx` file
- [ ] No new Bootstrap `Badge` usages for status, priority, AI score, or manual priority
- [ ] The app builds without TypeScript errors (`npm run build` in `react-app/`)
- [ ] The app renders correctly in both light and dark mode (manual visual check)
- [ ] MobileHome `/mobile` route still functions as before

---

## What Is NOT in Scope for This Refactor
- FilterBar / FilterChip shared component (REC-019) — valuable but medium effort; separate PR
- SkeletonCard / SkeletonRow loading states (REC-026) — separate PR
- ModalLayout standardisation (REC-037) — separate PR
- DailyPlanPage standalone route (REC-030) — separate PR
- Sprint management tab style unification (REC-028) — separate PR
- Checkins linked from MobileHome (REC-038) — separate PR
- Public share page mobile optimisation (REC-040) — separate PR

---

Comprehensive multi-phase rework spanning web, iOS/iPad, and health platforms:

JD Updated 12tyh March at 21:38

**Web (Phases 1-6):** Focus Goals vision-first wizard, time-based goals, Firestore fixes, Monzo manual creation, unaligned banner, KPI design  
**iOS/iPad (Phases A-F):** Star removal (iPad), ownership bug fix, widget resize reliability, daily plan extraction, KPI visibility  
**Fitness/HealthKit (Phases A-E):** Cross-repo health data sync, body composition tracking, caloric/macro adherence, workout time allocation, deterministic nutrition advisor  
**OS Evolution (Steps 11-20):** Modal-only editing, mac-sync stale data fixes, daily summary email parity, LLM observability, calendar-linked cards, finance/savings guardrails, Telegram integration, agent build guidance

---

## 17 Mar 2026 Reconciliation Note

This section is now the authoritative backlog summary for the current web workspace state. Older roadmap sections and execution logs below remain for audit history, but where they conflict with this section, this reconciliation note wins.

### Implemented And Now Canonical In Code
- Focus sets are editable and deletable from `FocusGoalsPage`, with wizard prefill for edits and safe delete of the focus-set record only.
- Focus hierarchy is now expressed as parent/program goals and execution leaf goals, and active focus surfaces render those concepts explicitly.
- Goal planning now includes a shared workspace modal that keeps goal context while switching between roadmap, year planner, and sprint matrix.
- Moving a goal in roadmap/planner now previews story sprint impacts and can remap linked stories to the closest sprint window through the sprint-change confirmation flow.
- Mobile work surfaces now include shared `Top 3`, `Chores`, and `Focus aligned` filters plus explicit copy that Top 3 is AI-ranked by default and manual `#1/#2/#3` overrides AI ordering.
- Manual priority is now a ranked override model (`#1`, `#2`, `#3`) across mobile, kanban, and list/card surfaces instead of a single star-style priority marker.
- Move/defer flows now carry planner debug request IDs, client/server logging, and normalized scheduling errors instead of surfacing raw `internal` failures.
- Calendar duplication prevention now exists at the sync layer and includes authenticated repair via `repairDuplicateCalendarEvents(...)`; UI dedupe is only a defensive read-layer.
- UX consistency audit deliverables now exist under `ux-audit/` and should be treated as active design input for follow-on implementation.

### Superseded Or Historical-Only Backlog Items
- Older Step 15 references to `KanbanCard.tsx` are superseded by the current `KanbanCardV2`, `SortableStoryCard`, planner-card, and mobile-card implementations.
- The kanban calendar-composer defect is considered satisfied by the shared `NewCalendarEventModal` path; do not re-open that item unless a regression is observed in current code.
- The broad Daily Plan DPO plan is partially historical now: focus-goal integration, calendar-linked time promotion, modal editing, and filter chips are already present. Only the remaining bulk-review / triage completion work should stay open.
- Older backlog language that assumes only a single manual top-priority marker is obsolete. The accepted product model is ranked manual priority with AI filling unassigned Top 3 slots.
- Any older roadmap item that conflicts with the current focus-goal hierarchy model, planner diagnostics, or duplicate-calendar repair flow should be treated as superseded unless explicitly reopened.

### Current Open Web Backlog
1. Daily Plan bulk review table and remaining triage workflow completion.
2. Manual cross-surface verification for focus alignment, planner move/defer flows, and current mobile priority behavior.
3. KPI countdown / chart refinement after real-data visual QA.
4. Firebase App Check console-side verification for `bob.jc1.tech`; the web cooldown logic is mitigation only.
5. Remaining health / fitness roadmap work, including broader health data foundation and follow-on advisor/dashboard surfaces.
6. Execute the `ux-audit/` recommendation backlog in prioritized slices, starting with theme contrast failures, responsive gating, and shared chip/badge consistency.

### Working Rules For This File
- Treat the codebase as the source of truth when it conflicts with older roadmap text.
- Add newly accepted enhancements to this reconciliation summary as they land, then optionally append deeper detail in the historical sections below.
- Do not use the older Phase / Step text below as the sole implementation backlog without checking whether the behavior already exists in code.

---

# ================ PART 1: WEB FEATURES ================

## Phase 1: Foundation Fixes (Can run in parallel)

### 1A. Fix Firestore undefined error in autoCreateStoriesForGoals + autoCreateSavinsPots
- **File**: [react-app/src/services/focusGoalsService.ts](react-app/src/services/focusGoalsService.ts)
- **Root cause**: In `autoCreateStoriesForGoals` line ~110-116, if `goal` is undefined or `goal.id` is undefined, the `where('goalId', '==', goal.id)` clause passes undefined to Firestore, causing: `Failed to create stories/buckets: Function where() called with invalid data. Unsupported field value: undefined`
- **Fix**: After fetching goals, filter out undefined entries; validate `goal.id` before using in where() clauses
- **Also check**: In `autoCreateSavinsPots`, validate `goal?.id` before where() query
- **Specific changes**:
  - Line ~103: Filter goals to remove undefined: `const goals = (await Promise.all(...)).filter(Boolean)` 
  - Line ~110: Add guard before where clause: `if (!goal?.id) continue;`
  - Line ~144: Add guard in autoCreateSavinsPots: validate goal.id before getDocs query

### 1B. Add story vs. calendar-time goal selector to Goal type
- **File**: [react-app/src/types.ts](react-app/src/types.ts) — update Goal interface
- Add new field: `goalRequiresStory?: boolean = true` (default true for backward compatibility)
- If false → goal expects only calendar time + optional KPIs, no sprint story creation
- This will be user-selected during focus wizard step 3

### 1C. Add goal ref tracking for Monzo manual creation
- **File**: [react-app/src/types.ts](react-app/src/types.ts) — update Goal interface
- Add new field: `monzoPotGoalRef?: string` (user-provided ref for manual pot creation)
- Add new field: `monzoPotId?: string` (auto-populated on next sync when pot found with matching ref)
- Backend watcher listens for goals with `monzoPotGoalRef` set but `monzoPotId` empty, then watches Monzo API for pots with that ref

---

## Phase 2: Wizard Rework (Core UX Change)

### 2A. Restructure wizard steps — Vision First
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- **Current** (5 steps): select → timeframe → vision → review → confirm
- **New** (6 steps): `vision` → `select` → `goalTypes` → `timeframe` → `review` → `confirm`

**Step breakdown:**
- **Step 1 (Vision)**: User enters vision text, loads intent prompts, can optionally run intent matching
- **Step 2 (Select)**: Shows goal list (filtered/sorted), multi-select with checkboxes, search by title
- **Step 3 (GoalTypes)**: NEW — For each selected goal, ask: "Needs Sprint story?" vs "Just calendar time?" 
  - Store selections in state: `goalTypeMap: { [goalId]: 'story' | 'calendar' }`
  - Calendar-time goals will skip auto-story creation
- **Step 4 (Timeframe)**: Choose sprint/quarter/year
- **Step 5 (Review)**: Show what will be created (stories for story-type goals, KPI link prompt) + KPI Designer link
- **Step 6 (Confirm)**: Final review, save

### 2B. Update handleNext() logic for new flow
- Remove auto-story/bucket creation from vision→review transition
- Move auto-creation to review→confirm transition (after user confirms, not during step change)
- Only auto-create stories for goals where `goalTypeMap[goalId] === 'story'`
- Skip story creation for calendar-time goals

### 2C. Update state variables
- Add: `goalTypeMap: { [goalId: string]: 'story' | 'calendar' }`
- Add: `selectedGoalsData: { [goalId: string]: { title, theme, requiresStory } }` (for display)
- Update: `goalsNeedingStories` computed filter to check both "has no story" AND `goalTypeMap[id] === 'story'`

### 2D. Add GoalTypes step UI component
- Render selected goals with radio buttons: "Story-based (will create Sprint story)" vs "Calendar-time (just events + KPIs)"
- Show goal details (theme, cost, etc.) to help user decide
- Save selections to `goalTypeMap`

---

## Phase 3: Monzo Pot Manual Creation Flow

### 3A. Update autoCreateSavinsPots to show prompt instead of API call
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- Change behavior: Instead of calling `createMonzoPotForGoal` HTTPS function, show user a prompt
- Prompt text: "For goal '[Goal Title]' (~£{estimatedCost}), create a Monzo pot manually and use ref: **{goalRef}** to enable BOB to auto-link it on next sync."
- goalRef = `GOAL-{goalId}` or similar (deterministic format)
- Provide copy button for ref + link to Monzo app
- User creates pot manually in Monzo, BOB saves `monzoPotGoalRef` to goal doc
- Backend watcher (in Cloud Functions) periodically checks for goals with `monzoPotGoalRef` set but `monzoPotId` empty, calls Monzo API to find pot with matching ref, links it

### 3B. Update FocusGoal type to track monzoPotGoalRefs
- Add: `monzoPotGoalRefs?: { [goalId: string]: string }` into FocusGoal document
- Saves ref mappings so history is preserved

### 3C. Add backend watcher (Cloud Functions)
- **File**: [functions/index.js](functions/index.js) or new file [functions/monzoPotLinker.js](functions/monzoPotLinker.js)
- Trigger: `onCreate('goals')` or scheduled function every 5 min
- Logic:
  1. Find goals where `monzoPotGoalRef` is set and `monzoPotId` is empty
  2. For each, query Monzo API for pots where name/description contains the ref
  3. If found, update goal: `monzoPotId: potId, monzoPotLinkedAt: serverTimestamp()`
  4. Log match or timeout after 24h
- This is background sync; user sees "Pending pot link" status until linked

---

## Phase 4: Unaligned Stories Banner

### 4A. Add banner to FocusGoalsPage
- **File**: [react-app/src/components/FocusGoalsPage.tsx](react-app/src/components/FocusGoalsPage.tsx)
- Show when: `activeFocusGoals.length > 0` (active focus period exists)
- Query: Stories in `currentSprint` (where sprintId matches active sprint) that are NOT in `activeFocusGoals[*].goalIds`
- Display: Alert/banner listing unaligned story refs, titles, associated goal ID (if any)
- Action: "Align to focus" link → opens story ref quick editor or removes from sprint

### 4B. Add filter badge to Sprint Table
- **File**: [react-app/src/components/ModernKanbanPage.tsx](react-app/src/components/ModernKanbanPage.tsx) or Sprint view
- Add toggle: "Show unaligned stories only" (if active focus exists)
- Highlight or filter-display unaligned story rows
- Same query logic as 4A

### 4C. Add widget to Dashboard
- **File**: [react-app/src/components/Dashboard.tsx](react-app/src/components/Dashboard.tsx)
- New card: "Focus Alignment Status"
- Show: X unaligned stories in current sprint (if active focus exists)
- Show: Y total stories in focus goals, Z% completion
- Link to "View details on Focus page"

---

## Phase 5: KPI Design Integration

### 5A. Create KPI Designer modal/page
- **New file**: [react-app/src/components/KPIDesigner.tsx](react-app/src/components/KPIDesigner.tsx)
- Purpose: Design KPIs for goals (health-based, metric-based, progress-based)
- Features:
  - KPI type selector: "Health Metric" (body fat %), "Calendar Event" (triathlon hours), "Progress" (story points done %), "Manual Entry" (user-tracked)
  - For Health Metrics: Data source (HealthKit field, e.g., bodyFat%), baseline, target, frequency (weekly/biweekly), trend tracking
  - For Calendar: Event pattern, target hours/count per week
  - For Progress: Goal completion %, story points closed
  - Save KPI to `goal.kpisV2[]` array (use existing KPI schema if available, or extend Goal type)
- Used by: FocusGoalWizard review step (link to KPI Designer)

### 5B. Link KPI Designer from wizard review step
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- In review step UI, show: "Add KPIs to track progress" button
- Opens KPIDesigner modal (or navigates to separate page with back link)
- Allows user to set KPIs for selected goals before confirming focus
- Returns to wizard review on save

### 5C. Add KPI chart display to FocusGoalCountdownBanner
- **File**: [react-app/src/components/FocusGoalCountdownBanner.tsx](react-app/src/components/FocusGoalCountdownBanner.tsx)
- Fetch KPI data for active focus goals from `goal_kpi_metrics/{uid}_{goalId}`
- Display mini-charts: body fat trend (weekly), calendar hours logged, progress %
- Show baseline vs current vs target
- Use existing health KPI display patterns

### 5D. Backend KPI sync (if not already done)
- **File**: [functions/fitnessKpiSync.js](functions/fitnessKpiSync.js) or nightly function
- Ensure goal KPIs are synced from HealthKit/Strava nightly
- Create `goal_kpi_metrics/{uid}_{goalId}` docs with:
  - `goalId, ownerUid, dataType (bodyFat, distance, workoutMinutes, etc.)`
  - `weeklyValues: [ { weekStart: Date, value: number, trend: % } ]`
  - `currentValue, baselineValue, targetValue, progressPct`
  - `updatedAt: serverTimestamp()`

---

## Phase 6: Web Verification & E2E Testing

### 6A. Unit tests for Firestore undefined fix
- Test `autoCreateStoriesForGoals` with goal list containing undefined entries
- Test `autoCreateSavinsPots` with goals missing `id` field
- Verify no "Unsupported field value: undefined" errors

### 6B. Integration test for wizard flow
- Create test: 1. Enter vision → 2. Select 3 goals → 3. Choose goal types (2 story, 1 calendar) → 4. Pick sprint timeframe → 5. Review + add KPI → 6. Confirm
- Verify: Only 2 stories auto-created, Monzo pot ref shown for cost goal, focus goal doc saved with correct goalTypeMap

### 6C. Manual test: Unaligned banner
- Create active focus goal with 2 goals
- Add story to sprint that has goalId NOT in focus goals
- Verify banner shows on FocusGoalsPage, Sprint Table, Dashboard
- Click "Align to focus" and verify story goalId updates

### 6D. Manual test: KPI Designer
- Open FocusGoalWizard → review step → click "Add KPIs"
- Create health KPI (body fat 0.25% weekly drop)
- Create calendar event KPI (triathlon: 8 hours cycling weekly)
- Save and return to wizard
- Verify KPI data persists on focus goal creation

---

# ================ PART 2: iOS/IPAD FEATURES ================

## Phase A: Star Marker Removal (iPad/Mac Only)

### A1. Hide star toggle on iPad/Mac StoriesListView
- **File**: [bob-ios/BOB/Sources/Views/Stories/StoriesListView.swift](bob-ios/BOB/Sources/Views/Stories/StoriesListView.swift)
- **Location**: Lines 237-241 (star button UI)
- **Change**: Wrap star button in guard checking for iPad/Mac:
  ```swift
  if !isLargeScreen {  // Hide on iPad/Mac, show on iPhone
    HStack {
      // star button UI
    }
  }
  ```
- **Rationale**: Top-3 selection is iPhone-only feature; iPad users manage priorities differently
- **Verification**: Test on iPhone (star visible), iPad (star hidden), Mac Catalyst (star hidden)

---

## Phase B: Daily Checklist Ownership Bug Fix (Security)

### B1. Add ownerUid field to BOBChore/BOBRoutine models
- **File**: [bob-ios/BOB/Sources/Models/BOBChore.swift](bob-ios/BOB/Sources/Models/BOBChore.swift) (or equivalent model files)
- **Add field**: `var ownerUid: String?`
- **Purpose**: Enforce that only task owner can view/edit their checklist items

### B2. Fix DailyChecklistView query with ownership filter
- **File**: [bob-ios/BOB/Sources/Views/Planning/DailyChecklistView.swift](bob-ios/BOB/Sources/Views/Planning/DailyChecklistView.swift)
- **Location**: Lines 7-37 (where @Query loads data)
- **Current state**: SECURITY BUG — loads ALL chores/routines globally with no WHERE clause
- **Fix**: Add double-layer filtering:
  1. Firestore @Query with WHERE clause: `where('ownerUid', '==', auth.uid)`
  2. Add persona filter: `where('persona', '==', currentPersona)`
  3. Post-load: Filter choresDueToday by both completion AND ownership
- **Prevents**: Cross-user data leak where one user sees another's daily tasks

### B3. Update daily checklist completion handler
- Preserve existing check-off interaction
- After storing completion, verify ownerUid matches before saving
- Add audit log entry with userId + timestamp

---

## Phase C: Widget Resize Reliability (iPad/Mac)

### C1. Fix state reset issue in OverviewView
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Location**: Lines 149, 156 (widget resize state)
- **Problem**: @ViewBuilder resets @State variables on each render; drag gesture becomes unreliable
- **Fix**: Hoist resize state OUT of @ViewBuilder component:
  - Move `@State var dragState` to parent OverviewView level
  - Pass to WidgetResizeHandles as `@Binding`
  - Remove per-frame state resets

### C2. Debounce widget config saves
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Current**: saveWidgetConfig() called on every frame during drag (too frequent)
- **Fix**: Add 500ms debounce after drag ends (not per-frame)
  - Use `Timer` or similar to delay save until stable
  - Prevents excessive Firestore writes
  - Improves drag performance

### C3. Add orientation detection using GeometryReader
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Replace**: UIDevice.current.orientation checks (unreliable)
- **With**: Size class + geometry reader for responsive detection
- **Benefit**: More reliable iPad orientation handling

### C4. Fix WidgetResizeHandles state binding
- **File**: [bob-ios/BOB/Sources/Views/Overview/WidgetResizeHandles.swift](bob-ios/BOB/Sources/Views/Overview/WidgetResizeHandles.swift)
- **Location**: Lines 47-49
- **Change**: Remove @State from component, accept @Binding from parent
- **Benefit**: Parent OverviewView maintains single source of truth for all widget states
- **Verification**: Drag resize multiple widgets without glitches or state loss

---

## Phase D: Daily Plan Screen Extraction

### D1. Create dedicated DailyPlanView
- **New file**: [bob-ios/BOB/Sources/Views/Planning/DailyPlanView.swift](bob-ios/BOB/Sources/Views/Planning/DailyPlanView.swift)
- **Source logic**: Extract from OverviewCards2.swift `TodayFocusListCard`
- **Purpose**: Remove 360pt height constraint and expose full day planning surface
- **Features**:
  - Group items by day-part: 
    - Morning 5:00-12:59 (Top3 Priorities)
    - Afternoon 13:00-18:59 (Due Tasks)
    - Evening 19:00-04:59 (Chores → Routines)
  - Show morning/afternoon/evening breakdown within each section
  - Check-off with quick edit links (EditTaskModal/EditStoryModal)
  - Link to DailyChecklistView for full chores/routines list
- **Reuse**: Existing card components and styling

### D2. Register Daily Plan in navigation
- **File**: [bob-ios/BOB/Sources/Views/Shared/ContentView.swift](bob-ios/BOB/Sources/Views/Shared/ContentView.swift)
- **iPhone**: Add to TabView with new tab (tag ~7 or similar)
  - Tab label: "Plan" or "Today"
  - Route to DailyPlanView
- **iPad**: Add to NavigationSplitView sidebar
  - New section or merge with existing Planning section
  - Same DailyPlanView destination
- **Verification**: Tap/select plan tab on both platforms, view loads without navigation regression

---

## Phase E: iPad/Mac KPI Visibility Integration

### E1. Add KPI widgets to OverviewView (iPad/Mac)
- **File**: [bob-ios/BOB/Sources/Views/Overview/OverviewView.swift](bob-ios/BOB/Sources/Views/Overview/OverviewView.swift)
- **Add**: New draggable widget type for "Focus Goals KPI"
- **Content**:
  - Body fat % trend (weekly chart from HealthKit)
  - Distance tracked (steps, cycling km from integrations)
  - Macro adherence % (from health sync)
  - Link to /kpi-designer to edit KPI targets
- **Reuse**: Existing FitnessKPIDisplay logic (port to Swift) + shared KPI computation logic

### E2. Display KPI parity with web Dashboard
- Ensure iPad/Mac see same KPIs as web (body fat goal 15%, walk habit 10k, macro adherence)
- Sync KPI data from same `goal_kpi_metrics/{uid}_{goalId}` Firestore docs
- Use existing HealthKit sync pipeline to populate metrics nightly

### E3. Link KPI widgets to Dashboard KPI Designer
- Add "Edit KPI" button on widget
- Opens KPI Designer modal or navigates to settings
- User can adjust baseline/target without navigating away from overview

---

## Phase F: iOS Verification & Testing

### F1. Unit test: Ownership filter in DailyChecklistView
- Create task/chore with ownerUid = different user
- Verify task does NOT show in current user's checklist
- Verify task DOES show when filtered by ownerUid match

### F2. Integration test: Widget state hoisting
- Open OverviewView on iPad
- Select 3 widgets and resize
- Rotate device and rotate back
- Verify resize states persist + no state resets occur

### F3. Manual test: Daily Plan navigation
- iPhone: Tap "Plan" tab → DailyPlanView loads
- iPad: Select "Plan" in sidebar → DailyPlanView loads
- Verify day-part groupings render correctly (morning/afternoon/evening)
- Check-off a task → verify removal from list

### F4. Manual test: iPad star removal
- Apple Stories list on iPad
- Verify star button is NOT visible (hidden by isLargeScreen guard)
- Switch to iPhone and verify star button IS visible

### F5. Manual test: KPI widget display & sync
- iPad OverviewView → verify KPI widget present
- Complete a health sync (HealthKit body fat update)
- Verify KPI widget updates with new data within 5 minutes
- Compare iPad KPI display to web Dashboard → should match

---

# ================ PART 3: FITNESS & HEALTHKIT INTEGRATION ================

## Cross-Repo Architecture

### Overview: Multi-Source Health Data Integration

**Primary data sources (in priority order):**
1. **HealthKit** (bob-ios) — authoritative for body composition, steps, workouts, heart rate
2. **Strava** (functions integration) — training activity details, run/cycling/swim breakdown
3. **Daily Check-in manual entry** (CheckInDaily.tsx) — fallback when automated sync missing

**Data flow:**
- iOS app syncs HealthKit daily (weight, body fat, steps, workouts) → Firestore `health_metrics/{uid}_{date}`
- Nightly function (functions/healthSync.js) fetches Strava API for weekly training detail + syncs to `training_metrics/{uid}_{week}`
- CheckInDaily provides manual fallback input for macros (protein, fat, carbs, calories) and weight/body fat if sensor unavailable

**Health data contract** (canonical schema):

```typescript
// Firestore: health_metrics/{uid}_{date}
{
  uid: string,
  date: string (YYYY-MM-DD),
  
  // HealthKit-sourced (body composition)
  weight: { value: number, unit: 'kg', source: 'HealthKit', timestamp: serverTimestamp },
  bodyFat: { value: number (%), unit: '%', source: 'HealthKit', timestamp: serverTimestamp },
  
  // HealthKit-sourced (activity)
  steps: { value: number, source: 'HealthKit', timestamp: serverTimestamp },
  distanceWalking: { value: number, unit: 'km', source: 'HealthKit', timestamp: serverTimestamp },
  workoutMinutes: { value: number, unit: 'minutes', source: 'HealthKit', timestamp: serverTimestamp },
  
  // Manual fallback (CheckInDaily)
  macros: {
    protein: { value: number, unit: 'g', source: 'manual', timestamp },
    fat: { value: number, unit: 'g', source: 'manual', timestamp },
    carbs: { value: number, unit: 'g', source: 'manual', timestamp },
    calories: { value: number, unit: 'kcal', source: 'manual', timestamp }
  },
  
  // Computed (nightly function)
  targets: {
    dailySteps: 12000,
    dailyDistance: 5, // km
    dailyCalories: 2500, // example
    macroTargets: { protein: 125, fat: 70, carbs: 312 } // grams
  },
  
  // ETA computations
  eta: {
    weeksToTargetBodyFat: number (e.g., 8 weeks to reach 20% from current 24%),
    weeklyBodyFatTrend: number (% change week-over-week, e.g., -0.25),
    stepsPctOfTarget: number (%), // 11,500 / 12,000 = 96%
    distancePctOfTarget: number (%), // 4.2km / 5km = 84%
    macroAdherence: number (%), // avg of (actual/target)*100 for 4 macros
    workoutTimePctOfGoal: number (%) // e.g., 240min / (20% of 8h) = 75%
  },
  
  // Source attribution (for UI badges)
  sourceAttribution: {
    weight: 'HealthKit',
    bodyFat: 'HealthKit',
    steps: 'HealthKit',
    workoutMinutes: 'HealthKit',
    macros: 'manual',
    updatedAt: serverTimestamp
  }
}

// Firestore: training_metrics/{uid}_{weekStart}
{
  uid: string,
  weekStart: string (YYYY-MM-DD, Monday),
  
  trainingComposition: {
    running: { minutes: number, distance: number, count: number },
    cycling: { minutes: number, distance: number, count: number },
    swimming: { minutes: number, distance: number, count: number },
    strength: { minutes: number, count: number },
    other: { minutes: number, count: number }
  },
  
  compliancePercent: number, // % of target workout time achieved
  source: 'Strava',
  updatedAt: serverTimestamp
}
```

---

## KPI Model & Computation

### Target Specifications

- **Daily Steps**: 12,000 steps/day
- **Daily Distance**: 5 km/day (from walking/running)
- **Workout Time Goal**: 20% of free time per day
  - **Weekdays**: 20% of 8 hours = 96 minutes/day (576 min/week)
  - **Weekends**: 20% of 16 hours = 192 minutes/day (576 min/week average)
  - **Future upgrade**: Derive denominator from theme-allocated free time (TBD when profiles implement theme allocation sliders)
- **Body Fat**: 20% target (deterministic goal) or user-set target
- **Macro Compliance**: Daily adherence toward protein/fat/carbs/calories targets

### ETA Engine

**Formula: Weeks to target body fat**
```
current_bf = 24% (example)
target_bf = 20%
weekly_rate = -0.25% (current trend from 4-week rolling average)

weeksToTarget = abs(target_bf - current_bf) / abs(weekly_rate)
              = abs(20 - 24) / abs(-0.25)
              = 4 / 0.25
              = 16 weeks
```

**Macro adherence percent:**
```
adherence = [(protein_act/protein_target + fat_act/fat_target + carbs_act/carbs_target + calories_act/calories_target) / 4] * 100

Example:
protein: 120/140 = 0.857
fat: 65/75 = 0.867
carbs: 290/325 = 0.892
calories: 2400/2500 = 0.96

adherence = [(0.857 + 0.867 + 0.892 + 0.96) / 4] * 100 = 89.4%
```

---

## Phase HealthKit-A: Data Contract + iOS Body Composition Sync + Manual Fallback Schema

### A1. Define canonical health data contract (Firestore schema)
- **File**: types.ts
- **Add TypeScript interfaces**:
  - `HealthMetric` with fields: weight, bodyFat, steps, distance, workoutMinutes, macros, targets, eta, sourceAttribution
  - `TrainingMetric` with training composition breakdown
  - `EtaComputation` with weeksToTarget, trends, adherence %
- **Update FocusGoal** to include health-linked KPI fields

### A2. Create iOS HealthKit sync to Firestore
- **File**: bob-ios/BOB/Sources/Services/HealthKitSyncService.swift (or existing health service)
- **Daily sync at 6 AM** (before user starts day):
  1. Query HealthKit for weight, body fat (latest value + 30-day rolling avg)
  2. Query HealthKit for steps, distance walked/run (today's accumulated)
  3. Query HealthKit for workouts (today's total minutes)
  4. Write to Firestore `health_metrics/{uid}_{date}` with source attribution `HealthKit`
  5. On error/missing data: leave field empty or use fallback (manual entry from yesterday if available)

### A3. Add manual macro entry fallback to CheckInDaily
- **File**: CheckInDaily.tsx
- **New optional section** (collapsible): "Today's Nutrition"
- **Fields**: Protein (g), Fat (g), Carbs (g), Calories (kcal)
- **Interaction**: User fills in (or pulls from saved daily template)
- **On save**: Write to `health_metrics/{uid}_{date}` with source attribution `manual`
- **Display note**: "Macros help us track % toward your 20% body fat goal"

### A4. Add bodyFat field to BOBUser profile
- **File**: types.ts — update user Profile interface
- Add: `bodyFatTarget?: number` (default 20)
- Add: `macroTargets?: { protein: number, fat: number, carbs: number, calories: number }` (daily targets)
- Add: `weekdayWorkoutMinutesGoal?: number` (default 96 min)
- Add: `weekendWorkoutMinutesGoal?: number` (default 192 min)

---

## Phase HealthKit-B: Target Model + ETA Engine + Overview Banner

### B1. Implement ETA computation engine (Functions)
- **File**: functions/lib/healthEta.js (new file)
- **Export function**: `computeHealthEta(uid)` that:
  1. Fetches last 30 days of `health_metrics/{uid}_{date}` docs
  2. Computes 4-week rolling average for body fat trend
  3. Calculates weeksToTarget using formula: `abs(target - current) / abs(trend)`
  4. Computes macro adherence % from daily values
  5. Sums weekly steps/distance against 12k/5km targets
  6. Returns ETA object with all computed fields
- **Used by**: Nightly function + on-demand from Dashboard

### B2. Add daily overview banner to Dashboard (top placement)
- **File**: Dashboard.tsx
- **Banner placement**: Above all other widgets (sticky or top section)
- **Content** (single-row display on desktop, stacked on mobile):
  - **Left**: Health source badge + timestamp ("HealthKit · Updated 2h ago")
  - **Center**: Body composition summary: "24.2% body fat → 20% target (est. 16 weeks)" with small trend sparkline
  - **Right**: Quick macro adherence score (pie chart or % badge): "Macros 89% today"
  - **Action button**: "View details" → opens fitness screen
- **Styling**: Prominent background color tied to adherence level (green if on-track >80%, yellow if 60-80%, red if <60%)
- **UX requirement**: This should render as a compact dismissible progress card rather than a permanent alert, reusing the same local-dismissal pattern as the birthday/focus-goal card and including a visible progress bar.
- **Missing-target handling**: When weight/body-fat targets are missing, the card should expose a direct CTA into Settings so targets are configurable at profile level rather than inferred only from goals.

### B3. Add ETA refresher trigger to nightly function
- **File**: nightlyOrchestration.js
- **Add step**: After HealthKit sync completes, call `computeHealthEta(uid)`
- **Store result** in `health_metrics/{uid}_latest-eta` or append to user profile `eta` field
- **Used by**: Dashboard banner + Fitness screen (both read from latest-eta doc)

---

## Phase HealthKit-C: KPI Math + Fitness Donut + 30-Day Compliance Views

### C1. Implement KPI math module (Functions)
- **File**: functions/lib/fitnessKpiMath.js (new file)
- **Exports**:
  - `macroAdherence(actual, targets)` → % score
  - `stepsPctOfTarget(totalSteps, target=12000)` → %
  - `distancePctOfTarget(totalKm, target=5)` → %
  - `workoutTimePct(weeklyMinutes, goal)` → % (handles weekday/weekend averaging)

### C2. Create Fitness Dashboard screen (web)
- **File**: react-app/src/components/FitnessDashboard.tsx (or extend existing WorkoutsDashboard.tsx)
- **Layout**:
  1. **30-Day Training Composition Donut Chart**:
     - Fetch `training_metrics/{uid}_{weekStart}` for last 4 weeks
     - Group by sport: running %, cycling %, swimming %, strength %, other %
     - Show as donut with legend + minutes/week breakdown
     - Overlay: "X% of target 96 min/day" in center
  
  2. **Training Compliance Cards** (side-by-side):
     - **Steps Card**: "9,847 / 12,000 steps (82%)" with spark line (today + 6 days prior)
     - **Distance Card**: "4.2 / 5 km (84%)" with trend
     - **Workout Time Card**: "240 / 576 min/week (42%)" with breakdown (running 120min, cycling 90min, strength 30min)
     - **Macro Adherence Card**: "89% today" with donut (protein %, fat %, carbs %, calories %)
  
  3. **Body Composition Progress**:
     - Current vs target with ETA weeks-to-target
     - 12-week rolling chart (weekly averages)
- **Drill-down rule**: Reuse the existing `/fitness` route and extend it, instead of creating a second overlapping health route.
- **Dashboard linkage**: The `Health` item in the dashboard Key Metrics row should drill into this same `/fitness` surface.

### C3. Extend iOS OverviewView with 30-day training widget
- **File**: bob-ios/BOB/Sources/Views/Overview/OverviewView.swift
- **Add draggable widget**: "Training (30d)"
  - Display: Donut chart of running/cycling/swimming/strength/other
  - Tap: Navigates to DetailedFitnessView (or shows expanded view)
  - Use Strava data stored in `training_metrics` Firestore docs

### C4. Create detailed Fitness view on iOS
- **File**: bob-ios/BOB/Sources/Views/Health/DetailedFitnessView.swift (new file)
- **Display**:
  - 30-day training donut (same as web)
  - Steps/distance/workout cards with mini sparklines
  - Macro adherence gauge
  - Body fat trend chart (last 12 weeks)

---

## Phase HealthKit-D: Nutrition Dashboard + Deterministic Advisor + Metrics Integration

### D1. Create Nutrition Dashboard component (web)
- **File**: react-app/src/components/NutritionDashboard.tsx (new file)
- **Layout**:
  1. **Daily Macro Tracker**:
     - Input form (from CheckInDaily manual entry): protein, fat, carbs, calories
     - Display stacked progress bars: protein %, fat %, carbs %, calories %
     - Show target values below each bar
  
  2. **Weekly Adherence View**:
     - Grid of 7 days, each cell showing macro adherence % for that day (color-coded)
     - Red <60%, yellow 60-80%, green ≥80%
     - Link day → expands daily macros breakdown
  
  3. **Deterministic Nutrition Advisor**:
     - Based on current body fat (e.g., 24%) and target (20%), recommend:
       - **Protein**: Formula-based (e.g., 1.6g per lb bodyweight)
       - **Fat**: 25-30% of calories (satiety + hormone production)
       - **Carbs**: Remaining calories, prioritize pre/post-workout windows
       - **Calories**: Maintenance ± 300kcal based on progress; if body fat not trending toward -0.25%/week, reduce by 200kcal
     - **Output format** (NOT opaque AI, but rule-based advisor):
       ```
       For your 24% body fat → 20% target, here's your baseline:
       - Protein: 125g/day (sustain muscle during fat loss)
       - Fat: 70g/day (hormone health + satiety)
       - Carbs: 312g/day (energy + training recovery)
       - Calories: 2,400/day
       
       Trend check: You're at -0.20%/week body fat. To accelerate to target -0.25%/week, reduce calories to 2,200.
       ```
     - **Rationale**: Each recommendation includes "why" (e.g., "protein preserves muscle during calorie deficit")

### D2. Add explainable recommendation engine (Functions)
- **File**: functions/lib/nutritionAdvisor.js (new file)
- **Export**: `generateNutritionBaseline(currentBodyFat, targetBodyFat, userWeight)` → { protein, fat, carbs, calories, recommendations: [{ field, value, rationale }] }
- **Rules** (deterministic, not ML):
  1. Protein = 1.6g per lb bodyweight (preserve muscle in deficit)
  2. Fat = 25-30% of total calories (minimum for hormone health)
  3. Carbs = remaining after protein + fat allocation
  4. Calories = maintenance calorie estimate ± deficit based on trend:
     - If trend is on-pace to 20% in <8 weeks: maintain current
     - If trend slower than -0.25%/week: reduce 200kcal
     - If trend faster then -1%/week: increase 150kcal (avoid muscle loss)

### D3. Update HealthKit sync to include nutrition metrics
- **File**: functions/healthSync.js
- **Add nightly step**: Fetch CheckInDaily manual macro entries for day
- **Store** in `health_metrics/{uid}_{date}` alongside HealthKit data
- **Trigger**: nutrition advisor update if macros logged

### D4. Integrate nutrition advisor into Dashboard & SettingsPage
- **File**: Dashboard.tsx + react-app/src/components/settings/SettingsPage.tsx
- **Dashboard**: Add "Nutrition Baseline" collapsible card with recommendations
- **Settings**: Add "Nutrition & Fitness" section with editable targets (protein g/day, fat %, carb %, calorie goal)
- **Profile target settings**: The same settings area should also expose editable weight target and body-fat target fields used by the dashboard health card and `/fitness` trend surfaces.

---

## Phase HealthKit-E: Backfill + Telemetry + Feature-Flag + GA Criteria

### E1. Backfill historical HealthKit data (one-time)
- **File**: scripts/backfill-healthkit.js (new file)
- **Script**: If user has iOS app + confirmed HealthKit access, fetch last 90 days from HealthKit API
- **Populate**: `health_metrics/{uid}_{date}` docs for all days with available data (weight, body fat, steps, workouts)
- **Mark source**: `HealthKit` with `initial: true` to distinguish from ongoing daily syncs
- **Run**: As one-off migration per user (triggered on first login to fitness features)

### E2. Add HealthKit sync telemetry
- **File**: functions/healthSync.js
- **Log entry to `health_sync_logs`** for each nightly run:
  ```
  {
    uid: string,
    date: serverTimestamp,
    healthKitFetch: { success: bool, itemCount: number, fieldsReceived: [weight, steps, ...], errorReason?: string },
    stravaFetch: { success: bool, workoutsCount: number, trainingMinutes: number, errorReason?: string },
    manualEntry: { submitted: bool, macrosCount: number },
    etaComputed: bool,
    issuesToInvestigate: [string] // e.g., "weight missing HealthKit", "macro entry incomplete"
  }
  ```

### E3. Feature-flag fitness features (GA rollout)
- **File**: react-app/src/features/flags.ts or environment config
- **Add flags**:
  - `FEATURE_FITNESS_DASHBOARD`: Show Fitness Dashboard menu item + HealthKit sync
  - `FEATURE_NUTRITION_ADVISOR`: Show Nutrition Dashboard + macro targets
  - `FEATURE_HEALTH_BANNER`: Show daily overview banner on Dashboard
  - Recommend: Enable for 10% → 30% → 50% → 100% cohorts over 2 weeks

### E4. Define GA success criteria
- **Health data coverage**: ≥80% of target users have ≥20 days of health_metrics data over 30 days
- **Manual macro entry adoption**: ≥30% of users with fitness flag log macros on ≥3 days/week
- **Dashboard banner engagement**: ≥50% of activated users view detailed fitness screen ≥1x/week
- **ETA computation accuracy**: Weekly trend computation stable (StdDev < 0.1% week-over-week)
- **Nutrition advisor clarity**: Qualitative feedback: users report recommendations are understandable + actionable (NPS or survey)
- **No regressions**: Existing KPI/goal creation workflows unchanged

---

## Relevant Files (Fitness/HealthKit)

**Functions (Backend)**
- index.js — Nightly orchestration hook for HealthKit sync + advisor trigger
- reporting.js — Integrate health metrics into daily summary email
- functions/healthSync.js — **NEW** HealthKit API fetch + Strava sync + telemetry logging (daily at 6 AM UTC)
- functions/lib/healthEta.js — **NEW** ETA computation engine
- functions/lib/fitnessKpiMath.js — **NEW** KPI math (macro adherence, step %, distance %)
- functions/lib/nutritionAdvisor.js — **NEW** Deterministic nutrition baseline + recommendations

**Web (React/TypeScript)**
- types.ts — HealthMetric, TrainingMetric, EtaComputation interfaces
- Dashboard.tsx — Health banner (top placement) + Focus alignment widget + Nutrition card
- react-app/src/components/FitnessDashboard.tsx — **NEW** or extend WorkoutsDashboard.tsx with 30-day donut, compliance cards, body composition
- react-app/src/components/NutritionDashboard.tsx — **NEW** Daily/weekly macro tracker + deterministic advisor
- CheckInDaily.tsx — Add collapsible macro entry section (fallback manual input)
- AdvancedOverview.tsx — Extend with health widget display
- react-app/src/components/settings/SettingsPage.tsx — Add "Nutrition & Fitness" settings (target macros, calorie goal, workout goals by weekday/weekend)
- react-app/src/features/flags.ts — Feature flags for fitness/nutrition rollout
- react-app/src/components/BirthdayMilestoneCard.tsx — reusable compact dismissible-card pattern for the dashboard health surface

**iOS (SwiftUI)**
- bob-ios/BOB/Sources/Services/HealthKitSyncService.swift — **NEW** or extend existing. Daily HealthKit fetch + Firestore write (weight, body fat, steps, distance, workouts)
- bob-ios/BOB/Sources/Views/Health/DetailedFitnessView.swift — **NEW** Fitness detail screen (30-day donut, cards, body fat trend chart)
- bob-ios/BOB/Sources/Views/Overview/OverviewView.swift — Add "Training (30d)" draggable widget

**Scripts**
- scripts/backfill-healthkit.js — **NEW** Backfill 90 days of HealthKit data for users

**Configuration**
- firestore.indexes.json — Add indexes for health_metrics queries (uid, date range) and training_metrics (uid, weekStart)

---

# ================ PART 4: OS EVOLUTION ARCHITECTURE ================

## Step 11: Modal-Only Navigation (No Route Changes on Task/Story Edits)

### 11A. Replace task/story route links with in-place modals
- **File locations**:
  1. CheckInDaily.tsx — Lines ~1137, ~1142 (card view) + ~1225, ~1230 (list view)
  2. HabitsChoresDashboard.tsx — Line ~396
  3. Calendar.tsx — Line ~569
  4. JournalsManagement.tsx — Lines ~637, ~659

- **Change pattern**: For all task/story entry points, replace:
  ```jsx
  <Link to={`/stories/${item.storyRef}`}>Edit</Link>
  ```
  with:
  ```jsx
  <button className="btn btn-link" onClick={() => openStoryEdit(item.storyRef)}>Edit</button>
  ```

- **Implementation**:
  - Add local state: `quickEditTask: Task | null`, `quickEditStory: Story | null`
  - Add helper functions to fetch and set edit state
  - Render `EditTaskModal` / `EditStoryModal` at component end with show/onHide/onUpdated handlers
  - User sees modal overlay, can edit, and modal closes without route change

### 11B. Verify no route navigation occurs
- Manual test each fixed location: click story/task ref → modal opens, URL unchanged
- Confirm page context preserved (scroll position, side panel state, etc.)

---

## Step 12: Mac Sync Stale Metadata Fix (TK-O50IP6 Investigation)

### 12A. Patch mergeReminder timestamp writes
- **File**: bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift
- **Location**: `mergeReminder` function (~4740–4855)
- **Current issue**: Merge path writes task updates WITHOUT `serverUpdatedAt`/`macSyncedAt`, unlike `updateFromReminder` which does set both
- **Fix**:
  1. Always write `serverUpdatedAt: FieldValue.serverTimestamp()`
  2. Always write `macSyncedAt: FieldValue.serverTimestamp()`
  3. Add branch-aware diagnostic field: `branch=mergeReminder`

### 12B. Add stale Top3 metadata reconciliation
- **File**: bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift
- **Change**: During merge/update, strip stale `aiTop3Date` entries (where date != today)
  1. Detect stale dates: `aiTop3Date != today()`
  2. In `mergeReminder`: clear fields `aiTop3ForDay=false`, `aiTop3Date=delete`
  3. In `updateFromReminder`: same clearing logic
  4. Add sync log: `staleTop3Reconciled=true` when stale cleanup occurs

### 12C. Add diagnostic logging for task identity lifecycle
- **File**: bob-mac-sync/reminders-menubar/Services/SyncLogService.swift (or equivalent)
- **Log per task sync**:
  - `taskRef`, `taskId`, `reminderId`, `branch` (mergeReminder vs updateFromReminder)
  - Pre-sync `serverUpdatedAt`, `macSyncedAt`
  - Post-sync `serverUpdatedAt`, `macSyncedAt` (should be new timestamps)
  - `staleTop3Reconciled` flag

### 12D. Add reference-resolution fallback for investigation
- When task not found by `reference`, query by `reminderId` and by list+sprint+story linkage
- Prevents renamed refs from hiding canonical task

### 12E. Verify TK-O50IP6 case resolves after patch
- Force one full sync cycle on mac app (Xcode run)
- Check sync logs for task: confirm `macSyncedAt` and `serverUpdatedAt` advanced
- Verify Top-3 inclusion only when current-day criteria met (today date + rank + flags)
- Confirm stale `aiTop3Date` cleared if was outdated

---

## Step 13: Daily Summary Email Signal Parity

### 13A. Compose shared signal digest
- **File**: reporting.js or templates.js
- **Add function**: `composeSignalDigest()` that collects:
  1. Finance guardrail warning (if discretionary spend >50% and month elapsed <50%)
  2. Capacity shortfall/overbooked alert (if planned > available time)
  3. Focus-goal countdown (days remaining, progress %)
  4. Critical top-priority alerts (high-effort tasks due, blockers)
  5. **NEW: Health metrics summary** (body fat trend, macro adherence %, steps/goal %)
  6. Stale/missing data badges (when sources are outdated)

- **Output**: Structured object with alert blocks, each with heading, content, action link

### 13B. Render signal digest in daily summary email
- **File**: templates.js — `renderDailySummaryEmail()`
- **Add section**: "Your Daily Digest" or "Key Signals"
- **Content**: Iterate over signal digest blocks and render each with consistent styling
- **Fallback**: If a source is stale/missing, show muted text "Data unavailable" instead of silently dropping
- **Include**: Health badge (HealthKit/manual) in email footer

### 13C. Add shared digest renderer for dashboard
- **File**: Dashboard.tsx
- **Add widget**: "Active Signals" card showing digest blocks (same content as email)
- **Benefit**: Web dashboard and email stay in sync

---

## Step 14: LLM Observability + Persona Controls

### 14A. Standardize AI call logging
- **File**: index.js — all LLM call sites
- **Add entry to `ai_logs`** for every LLM invocation with:
  1. Trace/correlation ID (for end-to-end tracking)
  2. Prompt template ID/version (e.g., "daily-focus-template-v2")
  3. Resolved prompt text (fully interpolated template)
  4. Input JSON payload (context + calendar + budget + **health metrics**, etc.)
  5. Raw output text (or preview + length if too large)
  6. Parse status: `ok`, `ok_empty`, `failed`, `runtime_error`
  7. Latency in milliseconds
  8. Token count (if available from API)

- **Apply to**: Daily summary focus generation, finance commentary, priority-now flow, nutrition advisor, any other LLM surfaces

### 14B. Add AI trace inspection debug view
- **File**: AiDiagnosticsLogs.tsx (if exists, or create)
- **Add UI**:
  - Toggle: "Trace events only" to filter logs by `*_trace` suffix
  - Columns: Trace ID, Prompt Template ID, Parse Status, Latency (ms)
  - Detail row: Full prompt text, input payload, raw output preview
  - Filter by date range, prompt template, parse status
- **Purpose**: Quick debugging of LLM flow issues without JSON parsing

### 14C. Add personality control sliders to user settings
- **File**: react-app/src/components/settings/SettingsPage.tsx or react-app/src/components/settings/ProfileSettings.tsx
- **Add sliders** for profile `aiPersonality`:
  - Intelligence/Directness (1-10)
  - Humor (1-10)
  - Sarcasm (1-10)
  - Warmth/Empathy (1-10)
- **Store** in user profile: `profile.aiPersonality = { intelligence: 7, humor: 5, ... }`

### 14D. Propagate personality controls to all LLM prompt builders
- **File**: index.js and all LLM helper functions
- **Change**: Pass `aiPersonality` object to prompt template functions
- **Apply**: Add personality parameters to prompt interpolation (e.g., "respond with warmth={warmth}/10")
- **Benefit**: LLM responses tune to user preference consistently

---

## Step 15: Calendar-Link and Card UX Completion

### 15A. Ensure story auto-linking to GCal events remains enabled
- **File**: react-app/src/services/calendarService.ts (or functions)
- **Verify**: Story auto-linking to existing GCal events works end-to-end
- **Source**: Auto-matching on story creation (e.g., event named "Sprint Review" auto-links to matching story)

### 15B. Add card metadata source labels
- **File**: react-app/src/components/KanbanCard.tsx and mobile card components
- **Add label**: Show story origin: `auto-planned`, `linked from gcal`, `manual`, `calendar-time`
- **Style**: Distinct badge/tag (not conflated with defer/priority icons)

### 15C. Separate priority icon from calendar/defer icons
- **File**: react-app/src/components/KanbanCard.tsx
- **Change**: Use distinct icons for:
  - #1 priority → boldface number "1" badge (not star)
  - Scheduled time → calendar icon
  - Deferred → snooze icon
  - Do not visually overlap these affordances
- **Verification**: Cards with scheduled + #1 priority show both icons clearly

### 15D. Expose direct "Schedule now" modal action
- **File**: react-app/src/components/KanbanCard.tsx
- **Add action button**: "Schedule now" or calendar icon with click handler
- **Opens**: Modal to set task/story time block on calendar (distinct from defer flow)
- **Benefit**: User can quickly assign calendar time without deferral overhead

---

## Step 16: Regression Guardrails (Re-verify existing behavior)

### 16A. Daily check-in interaction constraints
- **File**: CheckInDaily.tsx
- **Rule**: Chores/habits/routines must NEVER show progress% or comment capture
- **Rule**: Stories/standard tasks KEEP progress% and last-comment inline display (both card/list view)
- **Verify**: Render check-in with mixed item types; inspect UI for rule compliance

### 16B. Story progress capacity coupling math
- **File**: nightlyOrchestration.js or scheduler
- **Formula**: `remainingPoints = totalPoints * (1 - progressPct/100)`; scheduling minutes = remainingPoints * 60
- **Example**: 10-point story at 50% progress → schedules 5 points (300 minutes) remaining
- **Verify**: Nightly planner capacity calcs use this formula end-to-end

### 16C. Daily check-in date guardrail
- **File**: CheckInDaily.tsx
- **Rule**: Default date = today; show red banner if prior day incomplete
- **Verify**: Open check-in with today + yesterday-incomplete scenario; confirm banner shows

### 16D. Modal-only navigation guarantee (Step 11)
- **File**: All modified components from Step 11
- **Verify**: Click every task/story ref in CheckInDaily, HabitsChoresDashboard, Calendar, JournalsManagement
- **Confirm**: No route navigation occurs; modals open, page context preserved

---

## Step 17: Finance Guardrail Email Wording Scope

### 17A. Isolate budget warning to month-progress only
- **File**: reporting.js — `buildFinanceCommentary()` or alerter
- **Scope rule**: Budget guardrail alert must include ONLY:
  - Discretionary spend % (e.g., "65% spent")
  - Month elapsed % (e.g., "30% of month")
  - Warning phrasing (e.g., "Discretionary spend at 65% with 30% of month elapsed")
- **Explicitly exclude**: Any goal-progress percentages, focus-goal %, KPI %

### 17B. Add structural guard to prevent semantic mixing
- **File**: templates.js — `renderDailySummaryEmail()`
- **Change**: Create separate email sections:
  1. "Budget Alert" (finance only, using fields from Step 17A)
  2. "Focus Goals Update" (focus-goal %, KPI %, points)
  3. "Capacity Warning" (time/effort %)
  4. "Health Summary" (NEW: body fat trend, macro adherence %, workouts)
- **Render guard**: Each section renderer validates it CANNOT include percentages from other sections

### 17C. Add validation test
- Test scenario: Overspent on budget (65% discretionary, 30% month) + focus goal at 40% + capacity overbooked 110% + body fat not on-trend
- Render email
- Verify: Budget alert shows 65%/30% only; focus section shows 40%; capacity section shows 110%; health section shows trend + adherence; no mixing

---

## Step 18: Theme Progress Pot Transfer View + Email

### 18A. Add shared pot-transfer computation
- **File**: reporting.js
- **Add function**: `computePotTransferProgress(uid)` that for each goal linked to a Monzo pot, compute:
  - Goal name, target amount, linked Monzo pot id
  - Total transferred into the pot
  - Total transferred out of the pot
  - Net transferred = in minus out
  - Net progress percent = net transferred / target amount
  - Fallback states: zero/insufficient history, freshness marker
- **Output**: Array of transfer-progress rows ready for Theme Progress and email surfaces

### 18B. Add pot-transfer summary section to daily summary email
- **File**: templates.js — `renderDailySummaryEmail()`
- **New section**: "Savings Progress" or "Goal Funding Status"
- **Content**: Top 3-5 rows from transfer-progress compute, sorted by highest net progress or largest shortfall
- **Columns**: Goal, Target, Transferred In, Transferred Out, Net Transferred, Progress %
- **Fallback**: If insufficient history, show "⏳ Not enough data yet" instead of number

### 18C. Add pot-transfer table to Theme Progress
- **File**: react-app/src/components/ThemeProgressDashboard.tsx
- **Display**: Transfer-progress table or column set inside Theme Progress, not on Dashboard
- **Columns**: Goal, Target Amount, Transferred In, Transferred Out, Net Transferred, Progress %
- **Interaction**:
  - Sort: Highest progress, highest shortfall, by theme
  - Filter: Show only linked pots, contributions >0, etc.
  - Click goal name → navigate to goal detail + edit target

### 18D. Explicitly exclude this view from Dashboard
- **File**: Dashboard.tsx
- **Rule**: Do not render the pot-transfer/runway table directly on Dashboard.
- **Rationale**: This financial progress view belongs on Theme Progress; Dashboard should only link into deeper finance surfaces when needed.

### 18E. Add freshness marker to both surfaces
- **File**: templates.js & react-app/src/components/ThemeProgressDashboard.tsx
- **Show**: Timestamp of last Monzo sync + transaction fetch
- **Mark stale**: If >24h old, show warning badge "Data may be outdated"
- **Benefit**: User aware of data freshness

---

## Step 19: Telegram AI Flow Integration

### 19A. Set up Telegram webhook endpoint (Functions)
- **File**: functions/telegramBotHandler.js (new file)
- **Create HTTPS handler** for Telegram webhook:
  - Path: `/webhook/telegram`
  - Validates Telegram signature (ensure message authenticity)
  - Routes message to handler based on command or callback button
- **Link setup**: Configure Telegram bot webhook to point to Firebase Functions HTTPS endpoint

### 19B. User identity linking
- **File**: functions/telegramBotHandler.js
- **Add flow**: `/start` command → generates deep link to BOB app with linking token
- **In BOB Settings page**: "Connect Telegram Bot" button → opens link, exchanges token for Telegram chat ID
- **Store**: In user profile: `profile.telegramChatId`, `linkedAt`, `botStatus`

### 19C. Basic read-only summary commands
- **Commands**:
  - `/next` → "Here's your next priority: [story title] due [date]"
  - `/summary` → "Daily digest: X focused stories, Y completed, Z overdue"
  - `/goals` → "Active focus goals: [goal1], [goal2]... (X% aligned)"
  - `/health` → "Body fat 24% → 20% target (16 weeks). Today: 11.5k steps, 89% macros, 180min workout."
- **Implementation**: Each command queries Firestore for summary data and sends formatted Telegram message

### 19D. Approval buttons for deferral/planner flows
- **Callback buttons**: 
  - "✅ Approve" or "❌ Reject" on planner suggestions
  - Clicking button updates Firestore + acknowledges in Telegram
  - User confirms deferral, scheduling, or focus changes via Telegram without switching apps
- **Flow**: Cloud Function sends Telegram callback button message → user taps button → bot processes action

### 19E. Activity audit logging for Telegram actions
- **File**: functions/telegramBotHandler.js
- **Log entry to `activity_stream` or `ai_logs`**:
  - Source: `telegram`
  - Action: `/next`, `/summary`, `/goals`, `/health`, `approve_deferral`, etc.
  - Metadata: Telegram user ID (anonymized), callback data (if button action)
  - Result: Succeeded/failed, timestamp
- **Benefit**: Telegram actions appear in unified activity logs

### 19F. Settings UI for Telegram bot management
- **File**: react-app/src/components/settings/IntegrationsSettings.tsx (or new)
- **UI widgets**:
  - "Connect Telegram Bot" button (if not linked)
  - Status: "Connected as @username" + "Last activity 2h ago" (if linked)
  - "Disconnect" button to unlink
  - Notification preferences checkboxes (send daily summary? defer approvals? priority alerts? health summary?)
- **Verification**: Link/unlink flow via Settings

---

## Step 20: Cross-Repo Agent Build/Test/Commit Guidance

### 20A. Create unified build orchestration documentation
- **File**: BUILD_ORCHESTRATION_GUIDE.md (already exists; ensure complete)
- **Content**: 
  - Repo structure overview (bob, bob-ios, bob-mac-sync)
  - Build commands per repo (npm run build, xcodebuild, cargo build, etc.)
  - Test/validation commands (npm test, Xcode unit tests, etc.)
  - Deploy/release steps (firebase deploy, TestFlight, GitHub release)
  - Fast validation scripts (linting, type check, smoke tests)

### 20B. Create per-repo operational runbook
- **Files**:
  - BOB_WEB_BUILD_RUNBOOK.md
  - BOB_iOS_BUILD_RUNBOOK.md
  - BOB_MAC_SYNC_BUILD_RUNBOOK.md
- **Minimum content per file**:
  1. **Setup**: Clone, install deps, config (service account, Firebase project, etc.)
  2. **Build**: Primary build command + common flags
  3. **Test**: Unit test, integration test, E2E test commands
  4. **Validate**: Type check, lint, formatting checks
  5. **Deploy**: Staging vs production steps
  6. **Logs/Debugging**: Log file locations, common error patterns, fix paths
  7. **Branch conventions**: Feature branch naming, PR/commit patterns
  8. **Backup workflow**: Safe commit/tag strategy before PRs
  9. **Common issues**: Known failures + quick fixes

### 20C. Add agent-friendly validation script
- **File**: scripts/validate-cross-repo.sh (new)
- **Purpose**: Run key validation steps across all 3 repos in one command
- **Steps**:
  1. Check git status (dirty working dirs)
  2. Run build in each repo (abort if any fails)
  3. Run linting/type checks
  4. Run smoke tests
  5. Summarize pass/fail + time per repo
- **Usage**: `./scripts/validate-cross-repo.sh` before agents open PRs

### 20D. Cross-link guidance from AGENTS.md
- **File**: AGENTS.md
- **Updates**:
  - Link to BUILD_ORCHESTRATION_GUIDE.md
  - Link to per-repo runbooks
  - Link to validation script
  - Add "For PR submissions: follow the per-repo runbook, run validate-cross-repo.sh, ensure backup tags created"

---

# ================ VERIFICATION CHECKLIST ================

## Web (Phases 1-6) Verification Steps

- [ ] **Phase 1A**: No Firestore undefined errors in story/pot auto-creation
- [ ] **Phase 1B/1C**: Goal type added to Firestore with backward-compat defaults
- [ ] **Phase 2**: Wizard renders in correct order (vision → select → goalTypes → timeframe → review → confirm)
- [ ] **Phase 2**: Calendar-time goals created without Sprint stories
- [ ] **Phase 3**: Monzo ref prompt shown; backend watcher finds and links pots >5min
- [ ] **Phase 4A**: Unaligned banner shows on FocusGoalsPage when active focus exists
- [ ] **Phase 4B**: Sprint Table filter displays unaligned stories only
- [ ] **Phase 4C**: Dashboard widget shows unaligned count + focus % accurately
- [ ] **Phase 5A**: KPI Designer opens from wizard review step
- [ ] **Phase 5C**: KPI charts display on FocusGoalCountdownBanner with correct trends
- [ ] **Phase 5D**: HealthKit data syncs nightly to goal_kpi_metrics

## iOS/iPad (Phases A-F) Verification Steps

- [ ] **Phase A**: Star button hidden on iPad/Mac, visible on iPhone
- [ ] **Phase B**: Daily checklist only shows current user's items (ownerUid filter works)
- [ ] **Phase B**: Cross-user leak prevented (user A cannot see user B's chores)
- [ ] **Phase C**: Widget resize state persists after drag + device rotation
- [ ] **Phase C**: Drag gesture smooth (debounce working, no per-frame saves)
- [ ] **Phase D**: DailyPlanView accessible from iPhone "Plan" tab + iPad sidebar
- [ ] **Phase D**: Day-part grouping renders (Morning/Afternoon/Evening sections visible)
- [ ] **Phase E**: KPI widgets present on iPad OverviewView
- [ ] **Phase E**: KPI data updates within 5min of HealthKit sync

## Fitness/HealthKit (Phases A-E) Verification Steps

- [ ] **Phase A**: iOS daily HealthKit sync writes to health_metrics Firestore with source attribution
- [ ] **Phase A**: CheckInDaily macro manual entry accepted + stored in health_metrics
- [ ] **Phase A**: Backfill script loads 90 days of historical HealthKit data
- [ ] **Phase B**: ETA computation runs nightly; weeksToTarget computed correctly for body fat goal
- [ ] **Phase B**: Dashboard health banner shows at top with body fat trend + weeks-to-target
- [ ] **Phase B**: Health badge shows HealthKit/manual source attribution + recency ("Updated 2h ago")
- [ ] **Phase B**: Dashboard health surface is a dismissible compact progress card with persistence and a visible progress bar, not a permanent alert banner
- [ ] **Phase B**: Missing weight/body-fat targets route cleanly from the dashboard card into Settings profile target fields
- [ ] **Phase B**: Dashboard Key Metrics includes a `Health` card that drills into `/fitness`
- [ ] **Phase C**: Fitness Dashboard renders 30-day training donut with sport breakdown
- [ ] **Phase C**: Compliance cards show steps %, distance %, workout % with sparklines
- [ ] **Phase C**: `/fitness` drill-down includes weight, body fat, steps, distance, workout-time, and macro trends in one surface
- [ ] **Phase D**: NutritionDashboard shows daily macro adherence % with stacked progress bars
- [ ] **Phase D**: Deterministic advisor baseline generated with explainable rationale for each macro
- [ ] **Phase D**: Nutrition goals plus weight/body-fat targets are editable in SettingsPage; updates trigger downstream dashboard/fitness refresh
- [ ] **Phase E**: Feature flags for fitness features work as intended (gradual rollout enabled)
- [ ] **Phase E**: GA success criteria dashboard configured (coverage, adoption, engagement metrics)

## OS Evolution Verification Steps (Steps 11-20)

- [ ] **Step 11**: Click task/story refs in CheckInDaily/HabitsChoresDashboard/Calendar/Journals → modals open, no route change
- [ ] **Step 12**: Mac sync logs show advanced `macSyncedAt` + `serverUpdatedAt` after merge
- [ ] **Step 12**: Stale Top3 tags cleared from tasks where `aiTop3Date != today()`
- [ ] **Step 13**: Daily email includes finance + capacity + focus + priority + **health metrics** signal blocks
- [ ] **Step 13**: Dashboard "Active Signals" widget mirrors email content (including health)
- [ ] **Step 14**: Every LLM call logged with trace ID, prompt template, parse status, latency, **plus health context when applicable**
- [ ] **Step 14**: AI diagnostics debug view filters and displays trace events
- [ ] **Step 14**: Personality sliders in Profile Settings persist + affect LLM responses
- [ ] **Step 15**: Story-to-GCal linking auto-works on story creation
- [ ] **Step 15**: Card source labels show (`auto-planned` / `linked from gcal` / `manual`)
- [ ] **Step 15**: Priority + Schedule + Defer icons distinct and non-overlapping
- [ ] **Step 16**: Chores/habits never show progress %; stories show progress % + last comment
- [ ] **Step 16**: Capacity math uses correct formula: remaining = total * (1 - progress/100)
- [ ] **Step 17**: Finance guardrail wording includes ONLY spend % + month elapsed %
- [ ] **Step 17**: No goal-progress, KPI, or health percentages leak into finance alert email block
- [ ] **Step 18**: Theme Progress shows linked-pot transfer progress using transferred-in, transferred-out, and net-transferred math
- [ ] **Step 18**: Dashboard does not render the pot-transfer/runway table directly
- [ ] **Step 18**: Email savings section includes transfer progress plus stale/insufficient-history labels when applicable
- [ ] **Step 19**: Telegram bot webhook configured + signature validation works
- [ ] **Step 19**: `/next`, `/summary`, `/goals`, `/health` commands return formatted messages
- [ ] **Step 19**: Approval buttons on Telegram work (tapping updates Firestore)
- [ ] **Step 20**: Build orchestration guide complete with all 3 repos documented
- [ ] **Step 20**: Per-repo runbooks exist with setup/build/test/deploy steps
- [ ] **Step 20**: Cross-repo validation script runs successfully

---

# ================ RELEVANT FILES ================

## Core Types & Config
- types.ts — Goal, HealthMetric, TrainingMetric, EtaComputation, User profile types
- firestore.indexes.json — Indexes for query performance (health_metrics range queries, training_metrics lookups)

## Web (React/TypeScript) — Focus Goals & KPI
- FocusGoalWizard.tsx — Wizard UI (restructure to vision-first)
- focusGoalsService.ts — Story/pot auto-creation, undefined fix
- FocusGoalsPage.tsx — Unaligned banner add
- react-app/src/components/KPIDesigner.tsx — **NEW** KPI design modal
- FocusGoalCountdownBanner.tsx — KPI chart display

## Web (React/TypeScript) — Fitness & Health
- Dashboard.tsx — Health banner (top), focus alignment widget, nutrition card
- react-app/src/components/ThemeProgressDashboard.tsx — Theme Progress transfer view and focus-goal progress surfaces
- react-app/src/components/FitnessDashboard.tsx — **NEW** or extend WorkoutsDashboard.tsx with 30-day donut, compliance cards, body composition
- react-app/src/components/NutritionDashboard.tsx — **NEW** Daily/weekly macro tracker + deterministic advisor
- CheckInDaily.tsx — Add collapsible macro entry section (fallback manual input) + modal-only edits
- AdvancedOverview.tsx — Extend with health widget display
- react-app/src/components/settings/SettingsPage.tsx — Add "Nutrition & Fitness" settings + AI personality sliders + Telegram integration
- react-app/src/features/flags.ts — Feature flags for fitness/nutrition rollout

## Web (React/TypeScript) — Modal Navigation & Cards
- HabitsChoresDashboard.tsx — Modal-only task edits
- Calendar.tsx — Modal-only task edits
- JournalsManagement.tsx — Modal-only story/task edits
- react-app/src/components/KanbanCard.tsx — Card icon parity (priority/schedule/defer) + source labels + Direct "Schedule now" action
- AiDiagnosticsLogs.tsx — AI trace inspection view

## Functions (Backend)
- index.js — Nightly orchestration, Monzo pot watcher, LLM telemetry logging, Telegram webhook handler
- reporting.js — Signal digest composer (including health metrics), pot-transfer progress computation, finance guardrail scoping, **health summary integration**
- templates.js — Daily summary email renderer with signal + health parity
- functions/healthSync.js — **NEW** HealthKit API fetch + Strava sync + telemetry logging (daily at 6 AM UTC)
- functions/lib/healthEta.js — **NEW** ETA computation engine (weeksToTarget, trends)
- functions/lib/fitnessKpiMath.js — **NEW** KPI math (macro adherence, step %, distance %, workout time %)
- functions/lib/nutritionAdvisor.js — **NEW** Deterministic nutrition baseline + recommendations with rationale
- functions/fitnessKpiSync.js — Goal KPI nightly sync from HealthKit
- functions/telegramBotHandler.js — **NEW** Telegram webhook + command routing + state store

## iOS (SwiftUI)
- bob-ios/BOB/Sources/Views/Stories/StoriesListView.swift — Hide star on iPad/Mac
- bob-ios/BOB/Sources/Views/Planning/DailyChecklistView.swift — Ownership bug fix (ownerUid filtering)
- bob-ios/BOB/Sources/Views/Overview/OverviewView.swift — Widget resize fix (hoist state, debounce saves) + KPI widget display
- bob-ios/BOB/Sources/Views/Overview/WidgetResizeHandles.swift — State binding fix (remove local @State)
- bob-ios/BOB/Sources/Views/Planning/DailyPlanView.swift — **NEW** Dedicated daily plan screen
- bob-ios/BOB/Sources/Views/Shared/ContentView.swift — Register Daily Plan tab/sidebar
- bob-ios/BOB/Sources/Models/BOBChore.swift — Add ownerUid field
- bob-ios/BOB/Sources/Services/HealthKitSyncService.swift — **NEW** or extend existing. Daily HealthKit fetch + Firestore write (weight, body fat, steps, distance, workouts) + source attribution
- bob-ios/BOB/Sources/Views/Health/DetailedFitnessView.swift — **NEW** Fitness detail screen (30-day donut, cards, body fat trend chart, ETA)

## Mac Sync (Rust/Swift)
- bob-mac-sync/reminders-menubar/Services/FirebaseSyncService.swift — Merge timestamp fix, stale Top3 reconciliation
- bob-mac-sync/reminders-menubar/Services/SyncLogService.swift — Task identity diagnostics

## Scripts
- scripts/backfill-healthkit.js — **NEW** Backfill 90 days of HealthKit data for users
- scripts/validate-cross-repo.sh — **NEW** Cross-repo validation automation

## Documentation
- BUILD_ORCHESTRATION_GUIDE.md — Multi-repo build commands + coordination
- BOB_WEB_BUILD_RUNBOOK.md — **NEW** Web-specific setup/build/test/deploy
- BOB_iOS_BUILD_RUNBOOK.md — **NEW** iOS-specific setup/build/test steps
- BOB_MAC_SYNC_BUILD_RUNBOOK.md — **NEW** Mac sync setup/build/deploy
- AGENTS.md — Update with links to build/runbook guidance

---

# ================ DECISIONS & CONSTRAINTS ================

- **Vision-First Wizard**: Changes step order significantly; may confuse existing users. Recommend soft launch / feature flag if in production.
- **Story vs. Calendar Toggle**: Added at step 3; user makes explicit choice. Adds friction but provides clarity for goal type intent.
- **Monzo Manual Creation**: Defers from wizard to background sync; simplifies auth but adds async uncertainty (~5 min).
- **Modal-Only Navigation**: Preserves page context but requires state management discipline across multiple components.
- **Mac Sync Stale Metadata**: Fix may surface historical data resets; recommend monitoring sync logs during rollout.
- **Personality Controls**: LLM response tuning requires prompt template versioning to prevent regressions.
- **Telegram Integration**: Phase 1 read-only (lowest risk); Phases 2-3 add approval flows (higher risk, stagger rollout).
- **Backward Compat**: All new fields have defaults; existing goals/health data continue functioning without migration.
- **iOS Changes**: Star removal iPad-only (no iPhone regression); ownership fix closes security gap; widget fix improves UX.
- **HealthKit as Primary**: iOS HealthKit is authoritative source for body composition; Strava for training detail; manual fallback for macros.
- **Deterministic Nutrition**: Advisor uses rule-based formulas (not opaque AI) with explicit rationale for each recommendation.
- **Weekday/Weekend Split**: 20% workout goal uses different denominators (8h vs 16h free time); future upgrade path to theme-allocation-derived.

---

# ================ FURTHER CONSIDERATIONS ================

1. **Calendar-time goals on roadmap views?** — Display as "Time Blocks" or "Calendar Entries" vs "Stories"? Add distinct visual styling?
2. **KPI baseline/targets nullable?** — If user starts a KPI without setting targets, should we auto-suggest based on HealthKit history?
3. **Monzo pot linking timeout?** — How long should bot wait before giving up (currently 24h)? Should user get notification if link fails?
4. **Telegram rollout phasing?** — Phase 1 (read-only) safe to launch broad; Phase 2 (approvals) recommend beta users first.
5. **Daily Plan screen — merge with Daily Checklist?** — Or keep separate? Currently scoped as distinct surfaces but could consolidate if complexity grows.
6. **Savings progress source?** — For Theme Progress, should transfer status rely strictly on Monzo pot transfer history, or also expose a separate planning forecast elsewhere? Current policy is transfer-based progress only here.
7. **HealthKit data freshness cadence?** — Current: daily 6 AM sync. Should we support real-time push from iOS for manual entries + weight/body fat? (Lower priority for GA)
8. **Nutrition advisor future expansion?** — Currently deterministic rules. Should we support threshold-based AI upgrades later (e.g., "if body fat stuck >8 weeks, consult LLM for strategy")? (Out of scope for Phase E)
9. **Health metric retention policy?** — How long to keep daily health_metrics docs? Recommend: Keep granular daily for 12 months, then archive to monthly aggregates for historical trend queries.
10. **Cross-user health visibility?** — Scope for Phase A-E: personal user only. Future: partner/trainer health share? (Feature-flag for later)

---

# ================ EXECUTION SEQUENCE ================

**Recommended order to minimize blocking dependencies:**

### Day 1 (Minimal Shippable Increment — Focus Goals Foundation)
1. **Phase 1A-1C** (Foundation fixes) — No dependencies, unblock all following phases
2. **Phase 2A-2D** (Wizard restructure) — Depends on Phase 1
3. **Step 11** (Modal edits) — Parallel, independent once Phase 1 validates

### Day 2 (Monzo + Unaligned Banner)
4. **Phase 3A-3C** (Monzo manual creation) — Parallel with Phase 2, depends on Phase 1C fields
5. **Phase 4A-4C** (Unaligned banner) — Parallel with Phase 3, depends on Phase 1B/1C

### Day 3-4 (KPI + iOS Core Fixes)
6. **Phase 5A-5D** (KPI Designer) — Parallel with Phase 4, depends on Phase 1C fields
7. **Phase A-D** (iOS star, ownership, widget, daily plan) — Independent, parallel with web work

### Day 5 (Health Data Foundation)
8. **Phase HealthKit-A** (Data contract + sync) — Foundation for all health work, can start once Phase 5D validates
9. **Phase HealthKit-B** (ETA + banner) — Depends on Phase HealthKit-A

### Day 6-7 (Health Dashboards + OS Evolution)
10. **Phase HealthKit-C-D** (Fitness + Nutrition) — Depends on Phase HealthKit-B
11. **Phase HealthKit-E** (Backfill, telemetry, rollout) — Parallel with Phase HealthKit-C-D
12. **Step 12** (Mac sync fix) — Parallel with all above, independent
13. **Step 13-17** (Daily summary, LLM, finance) — Parallel, minimal blocking
14. **Phase E** (iOS KPI visibility) — Depends on Phase HealthKit-C for data; parallel with Mac sync work

### Day 8+ (Integrations + Verification)
15. **Step 18** (Theme Progress pot-transfer view) — Depends on Monzo linking (after Phase 3)
16. **Step 19** (Telegram) — Can start once Step 13-14 (signal digest, logging) complete
17. **Step 20** (Build guidance) — Last, after other phases documented
18. **Phase F** (iOS testing) — After Phase A-E complete
19. **Phase 6** (Web verification) — After Phases 1-5 complete

**Critical path**: Phase 1A → Phase 1B-1C → Phase 2 → (Phase 3 parallel Phase 4) → Phase 5 → HealthKit-A → HealthKit-B → (HealthKit-C-D parallel HealthKit-E)

---

# ================ STATUS ================

**Plan Status**: Complete consolidated plan covering:
- ✅ Web Focus Goals (Phases 1-6)
- ✅ iOS/iPad Features (Phases A-F)
- ✅ Fitness/HealthKit Integration (Phases A-E)
- ✅ OS Evolution Architecture (Steps 11-20)
- ✅ Cross-repo guidance (Step 20)
- ✅ Day 1 execution slices identified
- ✅ All file anchors and line numbers documented

**Completed Slice Log**:
- ✅ 12 Mar 2026: Dashboard health UX sub-slice shipped.
  Scope completed: compact dismissible health progress card on Dashboard, direct Settings CTA for missing targets, editable weight/body-fat targets in Settings, richer Health key-metric drill-down routing to `/fitness`, expanded `/fitness` health snapshot and trend charts, and manual fallback fields for distance/workout/body-composition in daily check-in.
  Remaining in the broader HealthKit plan: ETA computation backend, canonical `health_metrics` contract writes, nutrition advisor, rollout flags, telemetry, and iOS HealthKit sync/backfill work.
- ✅ 12 Mar 2026: Focus Goals foundation slice shipped.
  Scope completed: hardened `autoCreateStoriesForGoals` against missing goal docs/ids, preserved goal ids when hydrating from Firestore, guarded savings-pot creation loops against invalid goal ids, and added shared Goal/FocusGoal fields for `goalRequiresStory`, `monzoPotGoalRef`, `monzoPotId`, and `monzoPotGoalRefs`.
  Remaining in the broader Focus Goals plan: wizard step rework, goal-type selection UI, Monzo manual-link prompts/watcher flow, KPI designer integration, and downstream verification coverage.
- ✅ 12 Mar 2026: Focus Goals wizard flow slice shipped.
  Scope completed: reordered the wizard to vision → select → goal types → timeframe → review → confirm, added per-goal story-vs-calendar planning mode, updated review/confirm summaries to reflect the chosen planning mode, and moved story/savings auto-creation to the final save path instead of the earlier review transition.
  Remaining in the broader Focus Goals plan: Monzo manual creation prompt/link watcher flow, KPI designer handoff, explicit calendar-time event tooling, and end-to-end verification coverage.
- ✅ 12 Mar 2026: Monzo manual pot-link slice shipped.
  Scope completed: removed automatic Monzo pot creation from the focus setup path, added deterministic manual goal refs (`GOAL-{goalId}`) in wizard review with copy UX, persisted ref mappings to goal docs via `monzoPotGoalRef`, and stored `goalTypeMap` + Monzo ref map on created focus goals.
  Remaining in the broader Monzo plan: backend watcher/cron linking unresolved refs to real Monzo pot ids and timeout/notification handling.
- ✅ 12 Mar 2026: KPI Designer handoff slice shipped.
  Scope completed: added a reusable KPI Designer modal for selected goals, enabled KPI creation in wizard review before confirm, and persisted KPI entries onto goal docs through the existing goal `kpis` array contract.
  Remaining in broader KPI plan: richer KPI schema (`kpisV2`), baseline/trend history model, and dedicated KPI charting on focus countdown surfaces.
- ✅ 12 Mar 2026: Calendar manual-scheduling suppression slice shipped.
  Scope completed: updated nightly planner scheduling so entities with existing user-created (non-AI) calendar blocks are skipped by auto-placement, preventing duplicate/competing AI-planned blocks when users intentionally schedule from kanban.
  Remaining in broader calendar confidence plan: CSA-specific matcher diagnostics surface, confidence rationale visibility on more calendar surfaces, and orphaned closed/deleted-entity cleanup policy for legacy blocks.
- ✅ 12 Mar 2026: Monzo ref-link watcher slice shipped.
  Scope completed: added backend Monzo goal-ref linker logic that resolves pending `monzoPotGoalRef` values to real pot ids from synced Monzo pots, writes `monzoPotId`/`linkedPotId`/`potId` + linked timestamp on match, marks unresolved refs as timeout after 24 hours, and records linker outcomes to integration logs.
  Remaining in broader Monzo plan: user-facing timeout notification UX and optional manual retry controls in settings/focus surfaces.
- ✅ 12 Mar 2026: Monzo timeout/retry UX slice shipped.
  Scope completed: added Focus Goals UI status for pending/timed-out Monzo pot links, exposed per-goal and retry-all actions for timed-out refs, and implemented a retry helper that resets link state and triggers immediate Monzo sync to re-attempt linkage.
  Remaining in broader Monzo plan: optional settings-surface parity for retry controls and notification-level messaging outside Focus Goals.
- ✅ 12 Mar 2026: Focus unaligned-story banner slice shipped.
  Scope completed: added Focus Goals warning banner for active-sprint stories not mapped to active focus goals, plus quick actions to align a story to the active focus set or remove it from the sprint.
  Remaining in broader alignment plan: sprint-table-level unaligned filter toggle and dashboard alignment status widget parity.

**Location**: plan.md

**Next Step**: Start the next implementation slice and continue updating this log with one commit per completed slice.
