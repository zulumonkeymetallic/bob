# BOB UX Audit — 03: Recommendation Backlog

**Audit date**: 2026-03-17
**Total recommendations**: 42
**Implementation note**: All recommendations are design/UX changes only. No backend, Firestore schema, or Cloud Function changes are implied or required.

---

## Severity Legend

| Severity | Definition |
|----------|------------|
| **Critical** | Misleading, broken, inaccessible, or unsupported on mobile. Causes user failure or significant confusion. |
| **High** | Inconsistent interaction model or major theme/readability issue. Creates meaningful friction or unreliability. |
| **Medium** | Visual inconsistency, density problem, weak affordance, icon mismatch. Reduces trust and polish. |
| **Low** | Polish, terminology, or cleanup. Low user impact but worth addressing for coherence. |

## Effort Legend

| Effort | Definition |
|--------|------------|
| **S** | ≤ 1 day: CSS variable change, icon swap, copy update |
| **M** | 2–5 days: New shared component, single-component refactor |
| **L** | 1–2 weeks: Refactor of a view family (e.g., all tables), responsive breakpoint logic |
| **XL** | > 2 weeks: Cross-cutting change affecting 3+ domains, new design system primitive |

---

## Critical Severity

---

### REC-001: FocusGoalCountdownBanner dark mode contrast failure

**Severity**: Critical
**Effort**: S
**User impact**: Orange urgency text (`#fd7e14`) on the dark theme background (`#0b0d11`) fails WCAG AA contrast (ratio ~2.8:1 vs required 4.5:1). Users in dark mode cannot reliably read urgency indicators in the focus goals countdown.
**Affected surfaces**: `/focus-goals` — FocusGoalCountdownBanner.tsx
**Observed issue**: `getUrgencyColor()` returns hard-coded hex values (`#dc3545`, `#fd7e14`, `#0066cc`, `#6c757d`) used as inline text/icon colours. These are never overridden for dark theme.
**Recommended standard**: Replace all hard-coded urgency colours with semantic CSS variables defined in `:root` and `[data-theme="dark"]`. Define `--color-urgency-critical`, `--color-urgency-high`, `--color-urgency-normal`, `--color-urgency-low` with WCAG-safe values for both modes.
**Specific UI change**: In FocusGoalCountdownBanner.tsx, replace the `getUrgencyColor()` switch statement with CSS variable lookups. In index.css, define the four urgency colour tokens with dark mode overrides that shift to lighter, higher-contrast values.
**Responsive rule**: Show full feature — the banner itself is appropriate for mobile if made responsive.
**Theme/a11y implications**: Both themes affected. Resolves WCAG AA violation. Ensures colour-meaning consistency with priority chips (which use similar colour semantics).
**Dependencies**: REC-020 (centralise colour tokens), REC-022 (theme governance)

---

### REC-002: Dashboard calendar hard-coded current-time indicator

**Severity**: Critical
**Effort**: S
**User impact**: The red current-time line in the calendar view disappears or looks broken in dark mode because `#dc3545` on a dark calendar surface is nearly invisible.
**Affected surfaces**: `/dashboard` — Dashboard.css lines 413-420, Dashboard.tsx
**Observed issue**: `.rbc-current-time-indicator { background-color: #dc3545; }` is hard-coded. Dark mode provides no override.
**Recommended standard**: Move to `var(--color-urgency-critical)` (defined in REC-001) so it inherits the dark-safe red.
**Specific UI change**: In Dashboard.css, replace `#dc3545` with `var(--color-urgency-critical)`.
**Responsive rule**: Desktop-only (calendar is desktop-only per responsive policy).
**Theme/a11y implications**: Resolves dark mode invisibility. Single-line CSS change.
**Dependencies**: REC-001

---

### REC-003: Kanban board is inaccessible on touch devices

**Severity**: Critical
**Effort**: L
**User impact**: Mobile users who navigate to `/sprints/kanban` encounter a three-column horizontal-scroll layout with pointer-dependent drag-and-drop. Items cannot be moved, the layout overflows the viewport, and touch targets are too small (12-16px icon buttons).
**Affected surfaces**: `/sprints/kanban` — KanbanBoardV2.tsx, SprintKanbanPageV2.tsx
**Observed issue**: Layout is `display: flex; gap: 16px` (horizontal, no wrap). Drag-and-drop library requires pointer events. No mobile fallback.
**Recommended standard**: Below 768px, switch to a single-column stacked list view. Drag-and-drop is replaced by a status picker (swipe left/right or a tap action). See REC-004 for the shared status interaction pattern.
**Specific UI change**: Add a `useIsMobile()` breakpoint check in SprintKanbanPageV2. On mobile, render a stacked flat list of cards grouped by status, with a status dropdown/picker on each card instead of drag-to-column. Action buttons increase to 44px minimum tap targets.
**Responsive rule**: Show simplified card version — vertical stack replacing horizontal kanban.
**Theme/a11y implications**: Increases tap target compliance (WCAG 2.5.5). No theme impact.
**Dependencies**: REC-004 (status interaction standard), REC-024 (mobile card standard)

---

### REC-004: Goal/story/task tables are unusable on narrow viewports

**Severity**: Critical
**Effort**: L
**User impact**: Users accessing `/tasks`, `/stories`, or `/goals` on a mobile or tablet browser encounter a full-width dense data table with horizontal scroll, small dropdown controls, and drag handles that don't function on touch. This is technically the primary URL for each of these domains.
**Affected surfaces**: `/tasks` (ModernTaskTable), `/stories` (ModernStoriesTable), `/goals` (ModernGoalsTable)
**Observed issue**: No automatic view-mode switch at any breakpoint. The table layout is always active until the user manually toggles to card view — and the toggle control is itself a small desktop button.
**Recommended standard**: Below 768px viewport width, automatically switch to card view. The view mode toggle is only rendered at ≥ 768px. Card views already exist for all three domains and are responsive.
**Specific UI change**: In TaskListView, StoriesManagement, and GoalsManagement (the wrapper components), read `window.innerWidth` (or use a `useIsMobile()` hook) and default `viewMode` to `'card'` on mobile. Hide the toggle control on mobile. Document this as the canonical mobile entry point for these domains.
**Responsive rule**: Show simplified card version — force card view below 768px.
**Theme/a11y implications**: Card views already adapt better to both themes. Reduces horizontal scroll on mobile.
**Dependencies**: REC-003, REC-024

---

### REC-005: Goal roadmap / year planner surfaces exposed on mobile with no fallback

**Severity**: Critical
**Effort**: M
**User impact**: Users navigating to `/goals/roadmap` or `/goals/year-planner` on mobile see a partially-rendered canvas-based Gantt chart or a dense year grid with no interaction possible. There is no message directing them to desktop.
**Affected surfaces**: `/goals/roadmap`, `/goals/roadmap-v6`, `/goals/year-planner`, `/goals/timeline` — GoalRoadmapV6, GoalsYearPlanner, EnhancedGanttChart
**Observed issue**: These components perform no mobile detection. They render their full complexity on any viewport, resulting in broken, unusable views on mobile.
**Recommended standard**: These surfaces should detect mobile viewport and render a "Desktop required" placeholder screen. The placeholder should explain the feature, show a preview thumbnail or description, and offer a button to share the link via email/clipboard to open later on desktop.
**Specific UI change**: Add a `MobileUnsupportedScreen` component (see REC-033) wrapping each roadmap and year planner component. Trigger it when `isMobile === true`. Do not attempt to render the chart or planner on mobile.
**Responsive rule**: Hide and route user to desktop.
**Theme/a11y implications**: No chart rendering on mobile means no mobile-specific theme issues. The placeholder itself should respect the theme.
**Dependencies**: REC-033 (MobileUnsupportedScreen component)

---

### REC-006: Sprint planning matrix exposed on mobile with no fallback

**Severity**: Critical
**Effort**: M
**User impact**: Same class of issue as REC-005. `/sprints/planning` renders a complex matrix grid on mobile — inoperable for touch interactions.
**Affected surfaces**: `/sprints/planning` — SprintPlanningMatrix.tsx
**Observed issue**: No mobile detection or fallback.
**Recommended standard**: Same MobileUnsupportedScreen treatment as REC-005.
**Specific UI change**: Wrap SprintPlanningMatrix in mobile detection gate. Show `MobileUnsupportedScreen` with message "Sprint planning matrix is optimised for desktop use."
**Responsive rule**: Hide and route user to desktop.
**Theme/a11y implications**: None beyond placeholder theming.
**Dependencies**: REC-033

---

### REC-007: UnifiedPlannerPage (Calendar) drag-and-drop not safe on touch

**Severity**: Critical
**Effort**: L
**User impact**: React Big Calendar with drag-and-drop addon does not function correctly on touch devices. Event creation (click-drag on empty slot) and event moving are both broken on mobile. Users get a confusing non-interactive calendar.
**Affected surfaces**: `/calendar` — UnifiedPlannerPage.tsx
**Observed issue**: `withDragAndDrop` from react-big-calendar uses pointer events. Rendering a `DragDropCalendar` on touch devices produces inconsistent behaviour.
**Recommended standard**: On mobile, switch to agenda-only view (React Big Calendar's built-in `'agenda'` view). Remove drag-and-drop. Replace event creation with a "+ Add" FAB that opens AddStoryModal. Event details open on tap.
**Specific UI change**: In UnifiedPlannerPage, detect mobile. On mobile: set `defaultView="agenda"`, remove `withDragAndDrop` wrapper, render a static `Calendar` component, and show a FAB for adding items. Hide the view-switcher toolbar (day/week/month/agenda selector) on mobile — lock to agenda.
**Responsive rule**: Show summary/read-only version — agenda list with tap-to-view, no drag-and-drop.
**Theme/a11y implications**: Agenda view is already more screen-reader-friendly. No additional theme impact.
**Dependencies**: REC-033

---

## High Severity

---

### REC-008: Status and priority use three different interaction models

**Severity**: High
**Effort**: XL
**User impact**: Users who switch between kanban and card views find that status and priority behave differently in each context. In card views they can click to cycle; in kanban they are read-only; in tables they are dropdowns. This breaks the mental model and creates inconsistent expectations.
**Affected surfaces**: KanbanCardV2, StoriesCardView, TasksCardView, GoalsCardView, ModernTaskTable, ModernStoriesTable, ModernGoalsTable
**Observed issue**: Three patterns in use simultaneously:
  1. Kanban: CSS class pill (read-only, visual only)
  2. Card views: `<Button>` with `statusPillClass()` / `priorityPillClass()` (clickable, cycles value)
  3. Tables: `<select>` dropdown (form control)
**Recommended standard**: Define one shared `StatusPill` and one shared `PriorityPill` component (see REC-034, REC-035 in UI Standards). The component accepts a `mode` prop: `readonly` (Kanban, mobile), `interactive` (card views — click to cycle), or `select` (tables — renders as a styled dropdown with the pill appearance). This way the visual language is identical; only the interaction differs per context.
**Specific UI change**: Create `src/components/shared/StatusPill.tsx` and `PriorityPill.tsx`. Replace existing patterns in all 7+ components. Apply CSS class approach from KanbanCards.css (`.pill`, `.pill--danger`, etc.) as the shared visual base — this is already the most consistent and theme-safe mechanism.
**Responsive rule**: `readonly` mode on mobile; `interactive` mode on cards; `select` mode on tables.
**Theme/a11y implications**: Consolidating to CSS classes removes Bootstrap Badge inconsistency. Dark mode safety depends on REC-020 (token centralisation).
**Dependencies**: REC-020, REC-035

---

### REC-009: AI score badge is invisible in Kanban and inconsistent everywhere

**Severity**: High
**Effort**: M
**User impact**: The AI score is a key decision-making signal (used to sort, filter, and surface Top 3 items), yet it is invisible in the most-used planning surface (Kanban). Users cannot see which items the AI considers critical while triaging the board.
**Affected surfaces**: KanbanCardV2.tsx, SortableStoryCard.tsx, ModernTaskTable, ModernStoriesTable, ModernGoalsTable
**Observed issue**: AI score shown only in card views (as "AI NN/100" Bootstrap Badge) and in table column. Not shown in Kanban cards.
**Recommended standard**: Define one shared `AiScoreBadge` component that renders `AI NN` (compact, no "/100" suffix) as a small pill using the shared pill CSS. Apply it consistently to kanban cards, card views, and table rows. Hide when score is 0 or below a threshold (e.g., < 20).
**Specific UI change**: In KanbanCardV2 and SortableStoryCard, add `AiScoreBadge` to the meta row after priority pill. In card views, replace Bootstrap `Badge bg="secondary"` with `AiScoreBadge`. In tables, align column format to same compact style.
**Responsive rule**: Hide on mobile (too dense; AI sort is applied automatically on mobile).
**Theme/a11y implications**: Remove Bootstrap `Badge` dependency (dark mode unsafe). Use shared pill CSS.
**Dependencies**: REC-008, REC-020

---

### REC-010: Top 3 / manual priority badge is inconsistent and absent from Kanban

**Severity**: High
**Effort**: M
**User impact**: The Top 3 designation is one of the most important daily planning signals. It appears in 3 different visual forms across the product and is missing from the Kanban board entirely.
**Affected surfaces**: SortableStoryCard, StoriesCardView, TasksCardView, KanbanCardV2 (missing), all tables (missing)
**Observed issue**:
  - SortableStoryCard: CSS class `.kanban-card__meta-badge` + inline `rgba(220, 53, 69, 0.45)`
  - Card views: Bootstrap `Badge bg="danger"` "#N Priority"
  - KanbanCardV2: Not present at all
  - Tables: Not present at all
**Recommended standard**: Define one `ManualPriorityBadge` component rendering `#N` in a compact high-contrast badge. Apply to KanbanCardV2 (add to meta row), SortableStoryCard (replace existing), card views (replace Bootstrap Badge), and table rows (add as an inline element).
**Specific UI change**: Create `ManualPriorityBadge` using the shared pill CSS, colour `var(--color-urgency-critical)` for rank ≤ 3. Render in all three contexts. In KanbanCardV2 meta row, place before priority pill.
**Responsive rule**: Show on mobile card (compact `#N` label only).
**Theme/a11y implications**: Replace Bootstrap Badge dependency. Inherits dark mode from REC-001 urgency tokens.
**Dependencies**: REC-001, REC-008

---

### REC-011: Action button size is too small for touch use in card views

**Severity**: High
**Effort**: M
**User impact**: Action buttons in card views (StoriesCardView, TasksCardView, GoalsCardView) are 24px × 24px. WCAG 2.5.5 requires 44 × 44px minimum touch targets. On mobile, these buttons are untappable without precision.
**Affected surfaces**: StoriesCardView, TasksCardView, GoalsCardView
**Observed issue**: Action buttons use `width: 24px; height: 24px` inline styles. The card views are accessible on mobile (responsive grid) but the actions are not.
**Recommended standard**: Increase action button tap targets to minimum 44 × 44px with `padding` (visual size can remain smaller). On viewports ≤ 768px, collapse the 3-button top-right row into a single `...` overflow button that opens a bottom sheet / dropdown menu.
**Specific UI change**: Add `min-width: 44px; min-height: 44px` to action buttons via CSS media query `@media (max-width: 768px)`. Add a `<OverflowMenu>` component triggered by `...` on mobile that lists Schedule, Activity, Edit, Defer, Delete as full-width rows.
**Responsive rule**: Show simplified card version — overflow menu on mobile.
**Theme/a11y implications**: Improves WCAG 2.5.5 compliance. No theme impact.
**Dependencies**: REC-024

---

### REC-012: Domain theme colours (ThemeColors.css) have no dark mode overrides

**Severity**: High
**Effort**: M
**User impact**: Story and goal cards that use domain theme colours (Health, Wealth, Growth, etc.) display light-mode colour backgrounds and borders in dark mode. The visual theme system that makes goals and stories visually distinctive breaks entirely in dark theme.
**Affected surfaces**: All card views and kanban cards that render with a domain `theme` property — goal cards, story cards, sprint blocks, calendar blocks
**Observed issue**: `ThemeColors.css` defines `--theme-health-lighter: rgba(229, 62, 62, 0.1)` etc. There are no `[data-theme="dark"]` overrides, so dark mode cards use the same light-background colour values as light mode.
**Recommended standard**: For each of the 16 domain themes, define `[data-theme="dark"]` overrides that increase saturation and adjust opacity to remain visible and distinctive on dark backgrounds. Dark theme cards should use slightly higher opacity backgrounds (e.g., 0.15 instead of 0.1) with a lighter primary colour variant.
**Specific UI change**: In ThemeColors.css, add a `[data-theme="dark"]` block for each domain theme with adjusted `-lighter` and `-light` values. Test against `--bg: #0b0d11` and `--card: #171a21` for sufficient contrast.
**Responsive rule**: No responsive impact — applies in both mobile and desktop card views.
**Theme/a11y implications**: Core dark mode visual fix. Prevents theme strips from disappearing in dark mode.
**Dependencies**: REC-022

---

### REC-013: Action buttons have no accessible labels (icon-only)

**Severity**: High
**Effort**: M
**User impact**: All action buttons in Kanban, card views, and table rows are icon-only with no visible label and (in most cases) no tooltip or `aria-label`. Users relying on screen readers cannot identify actions. Sighted users face ambiguity on less-common actions (Convert to Story, Schedule, Defer).
**Affected surfaces**: KanbanCardV2, StoriesCardView, TasksCardView, GoalsCardView, ModernTaskTable
**Observed issue**: Buttons render `<Edit3 size={16} />` with no surrounding text or `title` attribute. Some have `aria-label` (not audited exhaustively), but even where present, there are no visible labels.
**Recommended standard**: All action buttons must have an `aria-label` or `title` attribute for screen reader / tooltip support. For ambiguous actions (Schedule, Defer, Convert to Story), add visible text labels on desktop at ≥ 992px. On narrower viewports, icons-only with tooltip are acceptable.
**Specific UI change**: Add `title="Edit"`, `title="Schedule"`, etc. to all icon buttons. For Convert to Story and Defer (most ambiguous), add a visible text label `<span className="d-none d-xl-inline">Schedule</span>` beside the icon at full desktop width.
**Responsive rule**: Show label text at ≥ 992px; icon-only with tooltip at smaller.
**Theme/a11y implications**: WCAG 4.1.2 (Name, Role, Value) compliance. No theme impact.
**Dependencies**: None

---

### REC-014: Lucide icon inconsistency for Edit and Schedule actions

**Severity**: High
**Effort**: S
**User impact**: The same "Edit" action uses `Edit3` icon in Kanban and card views but `Pencil` in some table components. The same "Schedule" action uses `Calendar`, `CalendarClock`, and `CalendarPlus` across different components. Users learn different visual vocabularies for the same action.
**Affected surfaces**: ModernTaskTable, ModernStoriesTable (Pencil), KanbanCardV2, StoriesCardView (Edit3); CalendarClock/Calendar/CalendarPlus variations
**Observed issue**: Icon choice was made ad-hoc per component.
**Recommended standard**: See UI Standards (04-ui-standards.md). Standardise on:
  - Edit: `Pencil` everywhere (more semantically precise than `Edit3`)
  - Schedule/Add to calendar: `CalendarClock` everywhere (implies time + calendar)
  - Defer: `Clock3` everywhere (already consistent)
  - All others: audit and lock in UI Standards doc
**Specific UI change**: Global icon swap across all components. In each file importing `Edit3`, change to `Pencil`. In components using `CalendarPlus` or `Calendar` for the schedule action, change to `CalendarClock`.
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: No theme impact. Icon semantics improvement.
**Dependencies**: None (but should be done alongside REC-013 for a single icon audit pass)

---

### REC-015: MobileHome category colour map is hard-coded and theme-unaware

**Severity**: High
**Effort**: M
**User impact**: In dark mode, MobileHome renders category colours defined in a hard-coded `THEME_COLORS` map with specific hex values. These do not adapt to dark theme, potentially producing unreadable labels or washed-out backgrounds.
**Affected surfaces**: `/mobile` — MobileHome.tsx
**Observed issue**: `THEME_COLORS` object maps category names to specific hex colour strings (e.g., `'learning & education': '#3b82f6'`). No dark mode variant.
**Recommended standard**: Replace hard-coded map with references to `--theme-X-primary` CSS variables from ThemeColors.css (already defined and will be fixed by REC-012). Map category names to theme variable names, not hex values.
**Specific UI change**: In MobileHome.tsx, replace the `THEME_COLORS` object with a `THEME_CSS_VARS` map pointing to CSS variable names. Apply via `style={{ color: 'var(--theme-learning-primary)' }}` etc. This automatically inherits any dark mode overrides added by REC-012.
**Responsive rule**: Mobile-specific fix — applies to MobileHome only.
**Theme/a11y implications**: Dark mode compliance for the only mobile-first surface.
**Dependencies**: REC-012

---

### REC-016: No shared empty state design across views

**Severity**: High
**Effort**: M
**User impact**: When Kanban columns are empty, users see no message or illustration. When tables have no data, the experience is unknown/inconsistent. Only card views show a proper empty state. Inconsistent feedback when data is absent undermines trust.
**Affected surfaces**: KanbanBoardV2 (empty columns), ModernTaskTable, ModernStoriesTable, ModernGoalsTable (empty rows), MobileHome (empty tab sections)
**Observed issue**: KanbanBoardV2: `<div>Loading board...</div>` only. Card views: icon + headline + sub-text (correct pattern). Tables and mobile: not audited but expected to be inconsistent.
**Recommended standard**: Create a shared `EmptyState` component used by all three view types. It accepts `icon`, `title`, `message`, and optionally `action` (a button). Apply to Kanban empty columns, table empty rows, and mobile empty tab sections.
**Specific UI change**: Extract the empty state pattern from StoriesCardView into a shared `src/components/shared/EmptyState.tsx`. Apply in: KanbanBoardV2 (for each empty column), all ModernTable components (empty tbody), MobileHome (empty tab sections).
**Responsive rule**: Show full feature — empty states apply to all viewports.
**Theme/a11y implications**: Use `var(--muted)` for text. Icon opacity 0.5. Fully theme-safe if using CSS variables.
**Dependencies**: None

---

### REC-017: Finance dashboard has no mobile version and no desktop-required gate

**Severity**: High
**Effort**: M
**User impact**: `/finance/dashboard` renders a multi-tab dashboard with complex charts, Bootstrap tables, and dense data on mobile. None of it is adapted for touch or narrow viewports.
**Affected surfaces**: `/finance/dashboard` — FinanceDashboardAdvanced, TransactionsList, BudgetsPage
**Observed issue**: No mobile detection, no fallback. Finance components use Bootstrap tables extensively.
**Recommended standard**: Finance is a desktop-first analytical surface. On mobile, show a summary card view: 2-3 key metrics (current month spending, budget remaining, recent transactions count), with a "Full dashboard available on desktop" prompt. Do not attempt to render charts or tables.
**Specific UI change**: Add mobile detection to FinanceDashboardAdvanced. On mobile, render a `FinanceMobileSummary` component (key numbers only). The chart tabs and transaction table are hidden. Add a `MobileUnsupportedScreen` option for the deeper analytical pages (flow diagram, merchants, budgets).
**Responsive rule**: Show summary/read-only version on mobile; full feature on desktop.
**Theme/a11y implications**: Summary cards should use CSS variable colours. No chart library required on mobile.
**Dependencies**: REC-033, REC-005

---

### REC-018: FocusGoalsPage not responsive on mobile

**Severity**: High
**Effort**: M
**User impact**: `/focus-goals` renders the countdown banner, focus wizard, and KPI studio panel. None of these components are adapted for mobile. The wizard uses complex multi-step layout that overflows on small screens.
**Affected surfaces**: `/focus-goals` — FocusGoalsPage, FocusGoalWizard, FocusGoalCountdownBanner, GoalKpiStudioPanel
**Observed issue**: No mobile detection. FocusGoalWizard uses multi-column step layouts. GoalKpiStudioPanel renders data-heavy charts.
**Recommended standard**: On mobile, show only the countdown banner (high-value status at a glance) and a simplified goal list. Hide the KPI studio panel and wizard. Add a "Manage focus goals on desktop" link.
**Specific UI change**: In FocusGoalsPage, add mobile detection. On mobile: render banner + simplified goal cards only. Hide `FocusGoalWizard` and `GoalKpiStudioPanel`. Add a `MobileUnsupportedScreen` for the wizard and KPI studio sections.
**Responsive rule**: Show summary/read-only version — banner + card list only on mobile.
**Theme/a11y implications**: Fix REC-001 before this (banner contrast). No additional theme work.
**Dependencies**: REC-001, REC-033

---

## Medium Severity

---

### REC-019: Filter controls have no shared design language

**Severity**: Medium
**Effort**: L
**User impact**: Each surface implements its own filter UI. The Kanban board uses prop-based filters (no visible filter bar). Task/story/goal tables have column toggles and sort controls in different positions. MobileHome uses explicit filter pills. There is no consistent "filter chip" design.
**Affected surfaces**: All task/story/goal/sprint surfaces
**Observed issue**: No shared filter component or design pattern.
**Recommended standard**: Define a shared `FilterBar` component with `FilterChip` elements. Active filters are visually highlighted chips. Tapping a chip toggles it off. A `+ Add filter` button opens a filter picker. This pattern is already approximated in MobileHome and should be generalised.
**Specific UI change**: Create `src/components/shared/FilterBar.tsx` and `FilterChip.tsx`. Apply to: task/story/goal list headers (replacing existing sort dropdowns), Kanban toolbar (replacing programmatic filter props), MobileHome tab headers (replacing existing filter buttons).
**Responsive rule**: Show full feature — chip-based filters work on mobile and desktop. Chips wrap to a second row on narrow viewports.
**Theme/a11y implications**: Use CSS variable colours for active chip state. Sufficient contrast in both themes.
**Dependencies**: None

---

### REC-020: Centralise colour tokens — eliminate hard-coded hex values in components

**Severity**: Medium
**Effort**: L
**User impact**: 341+ hard-coded colour values across TSX files create divergent dark mode behaviour. Changes to brand or semantic colours require multi-file updates with no central source of truth.
**Affected surfaces**: All components — especially FocusGoalCountdownBanner, Dashboard, KanbanCardV2, SortableStoryCard, MobileHome, FitnessKPIDisplay
**Observed issue**: Hard-coded hex and RGBA values in inline `style={{}}` props and CSS files. Bootstrap fallback colours (`var(--bs-danger, #dc3545)`) bypass the custom theme system.
**Recommended standard**: All feature components must reference only `var(--*)` tokens from index.css or ThemeColors.css. No inline hex values in component files. Create a token inventory (see 06-theme-governance.md for full list).
**Specific UI change**: Audit each component in the violation list (06-theme-governance.md). Replace hex values with CSS variable references. Priority order: FocusGoalCountdownBanner → Dashboard → KanbanCardV2 → SortableStoryCard → MobileHome.
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: Foundation change for dark mode reliability. No individual UI change visible to users.
**Dependencies**: REC-001 (urgency tokens must be defined first)

---

### REC-021: Bootstrap Badge components are not dark-mode-adapted

**Severity**: Medium
**Effort**: M
**User impact**: Bootstrap `Badge` components (`bg="secondary"`, `bg="danger"`) used for AI score and manual priority are rendered with Bootstrap's own colour system, which is incompatible with the custom dark theme (`data-theme="dark"` does not override Bootstrap's `data-bs-theme` colour tokens in the expected way across all components).
**Affected surfaces**: StoriesCardView, TasksCardView, GoalsCardView (AI score badges and manual priority badges)
**Observed issue**: `<Badge bg="secondary">` in dark mode may render a dark grey badge on a dark card background — low contrast.
**Recommended standard**: Replace all Bootstrap Badge usages in feature-domain components with the shared pill CSS class approach from KanbanCards.css. This is already theme-safe and consistent with status/priority pills.
**Specific UI change**: Remove Bootstrap `Badge` import from StoriesCardView, TasksCardView, GoalsCardView. Replace with `<span className="pill pill--secondary">` (add a `secondary` pill variant to KanbanCards.css). This is covered by REC-008 (StatusPill component) and REC-009 (AiScoreBadge).
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: Resolves Bootstrap/custom theme collision. Improves dark mode reliability.
**Dependencies**: REC-008, REC-009

---

### REC-022: Document and enforce theme selector precedence

**Severity**: Medium
**Effort**: S
**User impact**: With 4 CSS files all defining `[data-theme="dark"]` rules, the cascade order determines which rules win. This is not documented. A minor CSS load order change could silently break theme behaviour.
**Affected surfaces**: index.css, theme-aware.css, themeConsistency.css, MaterialDesign.css
**Observed issue**: Three active theme systems (`[data-theme]`, `[data-bs-theme]`, `.dark`) set in ModernThemeContext, with CSS across multiple files all responding to these selectors.
**Recommended standard**: Document the canonical CSS load order and intended precedence in a comment block at the top of index.css. Define which system is "active" (index.css + ThemeColors.css only), which is "secondary" (themeConsistency.css for Notion-style elements), and which is "deprecated" (MaterialDesign.css).
**Specific UI change**: Add a `/* THEME SYSTEM — load order and precedence */` comment block to index.css. Mark MaterialDesign.css as deprecated in a file header comment. The actual CSS load order must match the documented precedence.
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: Prevents silent cascade breakage. Low risk, high governance value.
**Dependencies**: None

---

### REC-023: Competing kanban implementations need clear resolution

**Severity**: Medium
**Effort**: S (decision only)
**User impact**: `ModernKanbanBoard.tsx` and `KanbanBoardV2.tsx` both exist. The routing sends all traffic to `KanbanBoardV2`. It is unclear if `ModernKanbanBoard` is a work-in-progress replacement, a legacy predecessor, or a second alternate view.
**Affected surfaces**: ModernKanbanBoard.tsx, KanbanBoardV2.tsx
**Observed issue**: Two kanban implementations in the codebase. Only one is routed.
**Recommended standard**: Engineering decision needed: designate one as primary and delete (or clearly mark as legacy) the other. This audit recommends designating KanbanBoardV2 as primary (it is currently routed). ModernKanbanBoard should be either deleted or assigned a specific differentiated purpose.
**Specific UI change**: None (code deletion or file rename/comment). This is a codebase triage task.
**Responsive rule**: No responsive impact until REC-003 is implemented.
**Theme/a11y implications**: Reduces surface area of dark mode audit.
**Dependencies**: REC-003

---

### REC-024: Define mobile card standard with 44px tap targets

**Severity**: Medium
**Effort**: M
**User impact**: Card views (StoriesCardView, TasksCardView, GoalsCardView) are responsive but not touch-optimised. Action buttons at 24px fail WCAG 2.5.5. Items on the card are clickable but tap-target size is inconsistent.
**Affected surfaces**: All card views, MobileHome tab cards
**Observed issue**: Action buttons are 24px × 24px. Item tap areas may not be full-row.
**Recommended standard**: See 04-ui-standards.md for the mobile card spec. Summary: min tap target 44×44px (via padding), single-tap opens detail/edit modal, overflow `...` button for secondary actions, no visible AI score or manual priority badge rank on mobile (space too limited).
**Specific UI change**: Add `@media (max-width: 768px)` block to card CSS expanding action button padding. Make the card title area a full-width tap target. Collapse secondary info to a `...` overflow button.
**Responsive rule**: Simplified card version — different action layout on mobile.
**Theme/a11y implications**: WCAG 2.5.5 improvement. No theme impact.
**Dependencies**: None

---

### REC-025: Card view grid minimum card width creates awkward 1.5-column layouts at tablet sizes

**Severity**: Medium
**Effort**: S
**User impact**: At tablet widths (768-992px), card grid layouts may produce 1.5 column widths due to CSS grid `auto-fill` with `minmax()` values not calibrated for the tablet breakpoint. This produces partially-cut-off cards.
**Affected surfaces**: StoriesCardView, TasksCardView, GoalsCardView — `.goals-card-grid` CSS class
**Observed issue**: Grid uses `auto-fill` with fixed min-width. At intermediate viewports, this can produce uneven column counts.
**Recommended standard**: Define explicit column counts at each breakpoint: 1 column below 576px, 2 columns at 576-992px, 3 columns at 992-1200px, 4+ columns at > 1200px. Use media queries rather than `auto-fill` for predictable layout.
**Specific UI change**: Update `.goals-card-grid` CSS to use explicit `grid-template-columns` at defined breakpoints.
**Responsive rule**: Show full feature — properly responsive grid.
**Theme/a11y implications**: No theme impact.
**Dependencies**: None

---

### REC-026: Loading states are inconsistent and minimal

**Severity**: Medium
**Effort**: M
**User impact**: Different surfaces show different loading treatments. Kanban shows plain text. Card views assume data is pre-loaded. Tables show nothing (or a brief flash of empty state). Users have inconsistent feedback about app responsiveness.
**Affected surfaces**: KanbanBoardV2, ModernTaskTable, ModernStoriesTable, ModernGoalsTable
**Observed issue**: Kanban: `<div>Loading board...</div>`. Card views: no visible loading state (parent handles). Tables: unknown.
**Recommended standard**: Define a `<SkeletonCard>` and `<SkeletonRow>` component (see 04-ui-standards.md). Show 3-4 skeleton cards/rows while data loads, using the same card/row dimensions as real content. Remove the plain-text loading message.
**Specific UI change**: Create `SkeletonCard` and `SkeletonRow` shared components with pulse animation. Apply in KanbanBoardV2 (show 4 skeleton cards per column), ModernTaskTable (show 8 skeleton rows), card views (show 4 skeleton cards). Use the `loading` prop already accepted by these components.
**Responsive rule**: Show full feature — skeletons apply to all viewports.
**Theme/a11y implications**: Skeleton uses `var(--line)` as base colour, which adapts to dark mode. Add `aria-busy="true"` on the container while loading.
**Dependencies**: None

---

### REC-027: Sidebar navigation items have no active state on mobile

**Severity**: Medium
**Effort**: S
**User impact**: In the mobile offcanvas sidebar, the active route may not have a visually distinct highlight compared to inactive routes. Users cannot easily tell where they are.
**Affected surfaces**: SidebarLayout.tsx (mobile offcanvas variant)
**Observed issue**: Desktop sidebar likely uses a highlight class for active routes. Verify whether this carries over to the offcanvas mobile version.
**Recommended standard**: Active navigation item should use `var(--brand)` accent colour as background or left border, with contrasting text colour. This should apply identically in both desktop sidebar and mobile offcanvas.
**Specific UI change**: Ensure the same `active` class / style logic applied to desktop nav links is applied in the mobile offcanvas sidebar.
**Responsive rule**: Mobile-specific fix.
**Theme/a11y implications**: `var(--brand)` is already dark-mode-aware. WCAG 1.4.1 (use of colour) compliance.
**Dependencies**: None

---

### REC-028: Sprint management tabs have inconsistent surface patterns

**Severity**: Medium
**Effort**: M
**User impact**: SprintManagementView hosts 6 tabs (overview, board, table, burndown, retrospective, history). Each tab renders a different layout pattern built independently. The visual language of the tabs themselves is inconsistent with the rest of the product's tab conventions.
**Affected surfaces**: `/sprints/management` — SprintManagementView
**Observed issue**: Tab-based navigation in this view uses a different pattern from SettingsPage tabs, and neither matches what is described in the UI Standards.
**Recommended standard**: Apply the shared tab convention defined in 04-ui-standards.md: horizontal tab bar with underline indicator, no box borders, active tab uses `var(--brand)` underline. Tab panel content fills the available space. Same pattern used in SettingsPage and SprintManagementView.
**Specific UI change**: Align SprintManagementView tab styles to match SettingsPage tab styles (or define a shared `TabBar` component that both use).
**Responsive rule**: On mobile, collapse tabs to a horizontal scrollable row (scroll-snap, no wrapping).
**Theme/a11y implications**: Tab underlines use `var(--brand)`. Full dark mode compatibility.
**Dependencies**: None

---

### REC-029: Goal roadmap version proliferation creates navigation confusion

**Severity**: Medium
**Effort**: S
**User impact**: Users who find `/goals/roadmap` via sidebar get GoalRoadmapV5. Users who know about `/goals/roadmap-v6` get a significantly different and more capable view. The UI offers no indication that V6 exists or that the sidebar link is not pointing to the latest version.
**Affected surfaces**: `/goals/roadmap`, `/goals/roadmap-v5`, `/goals/roadmap-v6`, `/goals/roadmap-legacy`, sidebar navigation
**Observed issue**: V5 and V6 are both active, named differently, and the default route alias (`/goals/roadmap`) points to V5.
**Recommended standard**: Point `/goals/roadmap` to GoalRoadmapV6 (the latest). Mark the V3 and V5 routes as legacy in the sidebar (or remove them entirely from navigation). Only V6 and V3-legacy should remain, clearly labelled.
**Specific UI change**: In App.tsx, change the `/goals/roadmap` route to render `GoalRoadmapV6`. Remove `/goals/roadmap-v5` from the sidebar navigation (keep route for bookmarks but add a redirect notice). Mark `/goals/roadmap-legacy` with a "(legacy)" label in sidebar if it must remain visible.
**Responsive rule**: All roadmap routes → hide on mobile (per REC-005).
**Theme/a11y implications**: No theme impact.
**Dependencies**: REC-005

---

### REC-030: DailyPlanPage embedded context is not discoverable

**Severity**: Medium
**Effort**: S
**User impact**: `DailyPlanPage` is a feature-rich multi-mode daily planning surface (list / plan / review / checkin). It is not on a discoverable route; it is embedded inside other components. Users who would benefit from it may never find it.
**Affected surfaces**: DailyPlanPage.tsx (embedded, no own route)
**Observed issue**: No standalone route for DailyPlanPage. It is only accessible from whichever parent component embeds it.
**Recommended standard**: Assign DailyPlanPage a standalone route (e.g., `/plan/today`) linked from the sidebar under the Planning group. This is a discovery and navigation issue, not a visual one.
**Specific UI change**: Add `/plan/today` route in App.tsx rendering DailyPlanPage. Add to sidebar navigation.
**Responsive rule**: Show simplified version on mobile — the DailyPlanPage modes that involve drag scheduling should be hidden; show list and checkin modes only.
**Theme/a11y implications**: No theme impact.
**Dependencies**: None

---

### REC-031: Settings and integration pages shown to mobile users without a "desktop required" signal

**Severity**: Medium
**Effort**: M
**User impact**: Mobile users who navigate to `/settings` or any of the 15+ integration setting routes encounter dense form-heavy pages that are technically functional but not mobile-optimised. More importantly, there is no signal that these are intended for desktop configuration.
**Affected surfaces**: `/settings` and all `/settings/integrations/*` routes, `/logs/*` routes
**Observed issue**: No mobile detection or indicator in settings pages.
**Recommended standard**: Settings pages should either render a simplified mobile variant (key profile settings only) or show a `MobileUnsupportedScreen` for the full settings hub. Integration settings and developer/log pages should always show the desktop-required placeholder on mobile.
**Specific UI change**: Add mobile detection to SettingsPage. On mobile: show profile and notification settings only (lightweight form). For all `/settings/integrations/*` and `/logs/*`, render `MobileUnsupportedScreen`.
**Responsive rule**: Show summary/read-only for profile/notifications; hide for integrations/logs/developer.
**Theme/a11y implications**: No theme impact. MobileUnsupportedScreen uses standard surface/text tokens.
**Dependencies**: REC-033

---

## Low Severity

---

### REC-032: Terminology inconsistency: "Top 3" vs "Manual Priority" vs "AI Critical"

**Severity**: Low
**Effort**: S
**User impact**: The product uses three overlapping priority concepts: "Top 3 for Today" (aiTop3ForDay), "Manual Priority" (manualPriority rank), and "AI Critical" (aiCriticalityScore > threshold). These are surface differently on different screens and the nomenclature is inconsistent.
**Affected surfaces**: KanbanBoardV2 filter bar, StoriesCardView badge labels, MobileHome filter options
**Observed issue**: Kanban filter button says "Top3". MobileHome filter says "top3" in code and "Top 3" in UI. Badge in card views says "#N Priority". AI score column is "AI Score". Filters are "AI Critical" on some surfaces.
**Recommended standard**: Define canonical user-facing labels: "Top 3" (for Top 3 designation), "#1 Priority" / "#2 Priority" (for manual priority rank), "AI Score" (for aiCriticalityScore column header). Use these consistently across all filter labels, badge text, and column headers.
**Specific UI change**: Global copy pass across kanban filters, card view badge labels, table column headers, and mobile filter labels to align with canonical terms.
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: No theme impact.
**Dependencies**: None

---

### REC-033: Create MobileUnsupportedScreen shared component

**Severity**: Low (as a standalone recommendation; Critical when used by REC-003 through REC-007)
**Effort**: S
**User impact**: Multiple surfaces need a "this feature is designed for desktop" placeholder when accessed on mobile. Without a shared component, these will be implemented inconsistently.
**Affected surfaces**: GoalRoadmapV6, GoalsYearPlanner, SprintPlanningMatrix, UnifiedPlannerPage (drag mode), FinanceDashboardAdvanced deep tabs, Settings integrations
**Observed issue**: No such component exists.
**Recommended standard**: Create `src/components/shared/MobileUnsupportedScreen.tsx` accepting `title`, `description`, and optional `copyLinkButton`. Renders a centred card with a desktop icon, title, brief description, and a "Copy link to open on desktop" button. Uses standard theme tokens.
**Specific UI change**: Create component. It must be usable as a drop-in wrapper: `if (isMobile) return <MobileUnsupportedScreen title="..." description="..." />;`
**Responsive rule**: Only visible on mobile.
**Theme/a11y implications**: Use CSS variable tokens. Fully theme-safe.
**Dependencies**: None

---

### REC-034: Remove legacy routes from sidebar navigation (keep routes for backwards compat)

**Severity**: Low
**Effort**: S
**User impact**: The sidebar may surface legacy routes (V3 roadmap, old calendar routes) that create confusion when users find them.
**Affected surfaces**: SidebarLayout.tsx navigation items
**Observed issue**: Multiple legacy route aliases still exist in routing. If any are in the sidebar, they create navigation confusion.
**Recommended standard**: Audit sidebar navigation items against the primary surface classification in 01-surface-inventory.md. Remove any nav items pointing to legacy or redirect routes. Keep the underlying routes live for backwards compatibility but do not link to them from the main navigation.
**Specific UI change**: Review SidebarLayout.tsx nav items. Remove links to: V3/V5 roadmap variants (only V6 in nav), old sprint routes, old finance routes. Keep routes in App.tsx as redirects.
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: No theme impact.
**Dependencies**: REC-029

---

### REC-035: Remove unused MaterialDesign.css

**Severity**: Low
**Effort**: S
**User impact**: 520 lines of CSS defining `--md-*` variables that are never consumed by any component. Dead code adds maintenance surface area and potential for future accidental reference.
**Affected surfaces**: MaterialDesign.css (520 lines)
**Observed issue**: No component references `--md-primary`, `--md-surface`, `--md-on-surface`, etc. The file is loaded but produces no visible output.
**Recommended standard**: Delete MaterialDesign.css. Remove its import from wherever it is loaded.
**Specific UI change**: Delete file. Remove import statement.
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: No impact — file is currently inert.
**Dependencies**: REC-022 (document theme systems first, confirm the file is truly unused)

---

### REC-036: Add a "requires desktop" badge to sidebar nav items for desktop-only surfaces

**Severity**: Low
**Effort**: S
**User impact**: Mobile users navigating from the sidebar to desktop-only surfaces get a poor experience. A small indicator next to the nav item (or hiding it on mobile) would set correct expectations.
**Affected surfaces**: SidebarLayout.tsx — nav items for roadmap, sprint planning, year planner, finance dashboard, calendar planner
**Observed issue**: No visual indicator or hiding logic for desktop-only nav items on mobile.
**Recommended standard**: On mobile viewports, hide nav items leading to surfaces classified `desktop-only` by the responsive policy (05-responsive-policy.md). Add a `title="Desktop only"` tooltip on desktop if the surface is expected to be desktop-primary (helps set expectations for narrow desktop views).
**Specific UI change**: In SidebarLayout, conditionally hide nav items based on a `desktopOnly` metadata flag on each nav item definition. On mobile (`window.innerWidth <= 768`), skip rendering those items.
**Responsive rule**: Mobile-specific: hide desktop-only nav items.
**Theme/a11y implications**: No theme impact.
**Dependencies**: REC-005, REC-007

---

### REC-037: Standardise modal header and footer treatment across all modals

**Severity**: Low
**Effort**: M
**User impact**: Modals (AddStoryModal, EditStoryModal, EditTaskModal, DeferItemModal, FocusGoalWizard) have inconsistent header heights, footer button orders (confirm vs cancel position), and close button placements.
**Affected surfaces**: All modals — AddStoryModal, EditStoryModal, EditTaskModal, DeferItemModal, FocusGoalWizard
**Observed issue**: Not fully audited; modals were not the focus of this round. Known inconsistency in button order and header style.
**Recommended standard**: Define a `<ModalLayout>` wrapper (see 04-ui-standards.md) with fixed: header with title + close button (right), body with standard padding, footer with Cancel (left/secondary) and Confirm (right/primary) buttons. Confirm button labelled with action ("Save", "Defer", "Create", "Update") not generic "OK".
**Specific UI change**: Create a shared `ModalLayout` component. Refactor all feature modals to use it for header/footer, keeping only the body content component-specific.
**Responsive rule**: Modals should be full-screen on mobile (bottom-sheet style) with the same button order.
**Theme/a11y implications**: Use CSS variable tokens. Modal background uses `var(--panel)`. Standard focus trap on open.
**Dependencies**: None

---

### REC-038: Checkin surfaces (daily and weekly) should be accessible from MobileHome

**Severity**: Low
**Effort**: S
**User impact**: `/checkin/daily` and `/checkin/weekly` are among the best mobile-optimised surfaces in the product. They are not linked from MobileHome. Mobile users doing their daily review have to know the route or find it via sidebar.
**Affected surfaces**: MobileHome.tsx, CheckInDaily.tsx, CheckInWeekly.tsx
**Observed issue**: MobileHome overview tab has no link or card for the daily checkin.
**Recommended standard**: Add a "Daily Check-in" card or action button in the MobileHome overview tab. If a check-in is pending (not yet completed today), show it as a highlighted CTA.
**Specific UI change**: In MobileHome overview tab, add a `CheckInSummaryCard` component. If `!checkinCompletedToday`, render a prominent CTA. If completed, show a brief summary of what was checked in.
**Responsive rule**: Mobile-specific addition.
**Theme/a11y implications**: No theme concerns.
**Dependencies**: None

---

### REC-039: Planner capacity banner is hidden on mobile but gives no indication

**Severity**: Low
**Effort**: S
**User impact**: `PlannerCapacityBanner.tsx` is conditionally hidden on mobile. If a user is over capacity, they receive no mobile signal about this important scheduling state.
**Affected surfaces**: PlannerCapacityBanner.tsx (hidden on mobile)
**Observed issue**: Banner uses `d-none d-md-block` or equivalent — explicitly hidden on mobile.
**Recommended standard**: On mobile, show a compact inline status indicator (1 line, not the full banner) in the MobileHome overview tab when capacity is exceeded. Full banner only on desktop.
**Specific UI change**: Extract capacity state data from PlannerCapacityBanner into a hook. Use that hook in MobileHome overview to render a compact `CapacityWarningBadge` (small chip with "Over capacity" message and count).
**Responsive rule**: Simplified status on mobile; full banner on desktop.
**Theme/a11y implications**: Use `var(--color-urgency-high)` for the warning colour (depends on REC-001).
**Dependencies**: REC-001

---

### REC-040: Public goal share page has no mobile optimisation

**Severity**: Low
**Effort**: S
**User impact**: `/share/:shareCode` renders a public goal view. Recipients receiving a shared link on mobile may see a poorly-formatted page. This is an external-facing page — first impressions matter.
**Affected surfaces**: `/share/:shareCode` — PublicGoalView
**Observed issue**: Classified as `partial` mobile support in the surface inventory.
**Recommended standard**: PublicGoalView should use the same mobile card pattern as the card views. Simple, full-width, no action buttons (read-only). Single column at all sizes.
**Specific UI change**: Ensure PublicGoalView renders in single-column card layout on all viewports. Test at 375px (iPhone SE) width.
**Responsive rule**: Show full feature — but layout is card-only, no table/kanban.
**Theme/a11y implications**: Apply standard theme tokens. External-facing so light mode default is appropriate (not everyone has dark mode set in the app).
**Dependencies**: None

---

### REC-041: Dashboard gradient backgrounds may fail in dark mode

**Severity**: Low
**Effort**: S
**User impact**: Dashboard.tsx uses linear gradient backgrounds (e.g., `linear-gradient(135deg, #fd7e14 0%, #b35c00 100%)`) on banner cards. In dark mode these can produce a harsh, overly saturated appearance against the dark background.
**Affected surfaces**: `/dashboard` — Dashboard.tsx banner cards
**Observed issue**: Gradient colours are hard-coded and not dark-adapted.
**Recommended standard**: In dark mode, gradient banners should use lower-opacity or desaturated versions of the gradient colours. Define dark-mode gradient tokens: `--gradient-accent-start` and `--gradient-accent-end` with appropriate dark values.
**Specific UI change**: Replace hard-coded gradient values with CSS variable references. Add `[data-theme="dark"]` overrides in Dashboard.css for gradient banner cards.
**Responsive rule**: No responsive impact.
**Theme/a11y implications**: Subtle dark mode visual improvement.
**Dependencies**: REC-020

---

### REC-042: Goal, story, and task card views show "No items found" instead of contextual empty messaging

**Severity**: Low
**Effort**: S
**User impact**: The empty state in card views correctly shows an icon and title, but the message text may be generic across all domains. Goals, stories, and tasks should each have domain-specific messaging (e.g., "Create your first goal to start tracking progress" vs "No tasks match your current filters").
**Affected surfaces**: StoriesCardView, TasksCardView, GoalsCardView
**Observed issue**: Empty state messages are likely generic ("No Stories Found", "No Tasks Found") without distinguishing between "you have none" and "filters are hiding them".
**Recommended standard**: Empty state messaging should have two variants: (a) "no items exist" — offer a create CTA, and (b) "filters are active but nothing matches" — offer a clear-filters CTA. The icon and title differ between these two states.
**Specific UI change**: In each card view, check whether any filter/search is active when the list is empty. If yes, show "Nothing matches your filters — Clear filters". If no, show "You have no [goals/stories/tasks] yet — Create your first".
**Responsive rule**: Show full feature — applies to all viewports.
**Theme/a11y implications**: No theme impact.
**Dependencies**: REC-016

---

## Recommendation Summary Table

| ID | Title | Severity | Effort | Primary Domain |
|----|-------|----------|--------|---------------|
| REC-001 | FocusGoalCountdownBanner dark mode contrast | Critical | S | Theme |
| REC-002 | Dashboard calendar hard-coded time indicator | Critical | S | Theme |
| REC-003 | Kanban inaccessible on touch | Critical | L | Mobile |
| REC-004 | Tables unusable on narrow viewports | Critical | L | Mobile |
| REC-005 | Roadmap/year planner exposed on mobile | Critical | M | Mobile |
| REC-006 | Sprint planning matrix exposed on mobile | Critical | M | Mobile |
| REC-007 | Calendar drag-and-drop not safe on touch | Critical | L | Mobile |
| REC-008 | Status/priority interaction model inconsistency | High | XL | Consistency |
| REC-009 | AI score invisible in Kanban | High | M | Consistency |
| REC-010 | Top 3 / manual priority badge inconsistency | High | M | Consistency |
| REC-011 | Action button tap targets too small | High | M | Mobile |
| REC-012 | Domain theme colours have no dark overrides | High | M | Theme |
| REC-013 | Action buttons have no accessible labels | High | M | A11y |
| REC-014 | Icon inconsistency: Edit and Schedule | High | S | Consistency |
| REC-015 | MobileHome hard-coded category colours | High | M | Theme |
| REC-016 | No shared empty state design | High | M | Consistency |
| REC-017 | Finance dashboard no mobile version | High | M | Mobile |
| REC-018 | FocusGoalsPage not responsive on mobile | High | M | Mobile |
| REC-019 | Filter controls have no shared design language | Medium | L | Consistency |
| REC-020 | Centralise colour tokens | Medium | L | Theme |
| REC-021 | Bootstrap Badge not dark-mode adapted | Medium | M | Theme |
| REC-022 | Document theme selector precedence | Medium | S | Theme |
| REC-023 | Competing kanban implementations | Medium | S | Consistency |
| REC-024 | Define mobile card standard | Medium | M | Mobile |
| REC-025 | Card grid awkward at tablet breakpoints | Medium | S | Layout |
| REC-026 | Loading states inconsistent | Medium | M | Consistency |
| REC-027 | Sidebar active state missing on mobile | Medium | S | Mobile |
| REC-028 | Sprint management tabs inconsistent | Medium | M | Consistency |
| REC-029 | Goal roadmap version proliferation | Medium | S | Navigation |
| REC-030 | DailyPlanPage not discoverable | Medium | S | Navigation |
| REC-031 | Settings pages missing desktop-required signal | Medium | M | Mobile |
| REC-032 | Terminology inconsistency (Top 3 / AI / Priority) | Low | S | Consistency |
| REC-033 | Create MobileUnsupportedScreen component | Low | S | Mobile |
| REC-034 | Remove legacy nav links | Low | S | Navigation |
| REC-035 | Remove unused MaterialDesign.css | Low | S | Theme |
| REC-036 | Desktop-required badge on nav items | Low | S | Mobile |
| REC-037 | Standardise modal header/footer | Low | M | Consistency |
| REC-038 | Checkins not linked from MobileHome | Low | S | Mobile |
| REC-039 | Capacity banner hidden on mobile with no replacement | Low | S | Mobile |
| REC-040 | Public share page mobile optimisation | Low | S | Mobile |
| REC-041 | Dashboard gradient dark mode | Low | S | Theme |
| REC-042 | Empty state messaging not contextual | Low | S | Consistency |
