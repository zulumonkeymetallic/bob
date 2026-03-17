# BOB UX Audit — 06: Theme Governance

**Audit date**: 2026-03-17
**Purpose**: Define the authoritative theme system, its governance rules, and catalogue all known violations.

---

## 1. Current Theme System Overview

The app currently has **four CSS systems** that all respond to `[data-theme="dark"]`:

| System | Files | Status | Description |
|--------|-------|--------|-------------|
| **System A — Core** | `index.css` | ✅ Active | Defines `--bg`, `--panel`, `--card`, `--text`, `--muted`, `--brand`, `--line`. Light and dark mode tokens. Primary theme system. |
| **System B — Domain Themes** | `ThemeColors.css`, `globalThemes.ts` | ✅ Active | 16 domain colour palettes (Health, Wealth, Growth, etc.) with `--theme-X-primary/light/lighter/dark/darker` variables. No dark mode overrides. |
| **System C — Notion Style** | `themeConsistency.css`, `theme-aware.css` | ⚠️ Partially active | "Notion-inspired" button and form styles using `--notion-*` variables. Has its own `[data-theme="dark"]` overrides that may conflict with System A. |
| **System D — Material Design** | `MaterialDesign.css` | ❌ Unused | Defines `--md-*` variables. No component references these. 520 lines of dead CSS. |

**Theme Toggle** sets three attributes simultaneously (ModernThemeContext.tsx):
```typescript
root.setAttribute('data-theme', theme)        // Used by Systems A, B, C, D
root.classList.toggle('dark', theme === 'dark') // Tailwind convention (unused)
document.body.setAttribute('data-bs-theme', theme) // Bootstrap adaptation
```

---

## 2. Authoritative Token Set (System A)

All feature components must use only these CSS variables. No direct hex or RGBA values in component files.

### Core Surface Tokens
| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--bg` | `#f0f2f5` | `#0b0d11` | Page background |
| `--panel` | `#ffffff` | `#12141a` | Sidebar, modal backgrounds, header |
| `--card` | `#ffffff` | `#171a21` | Card backgrounds |
| `--line` | `#e0e0e0` | `#232632` | Borders, dividers, separators |

### Core Text Tokens
| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--text` | `#333333` | `#e8e9ed` | Primary body text, titles |
| `--muted` | `#666666` | `#a0a5b1` | Secondary text, placeholders, labels |
| `--on-accent` | `#ffffff` | `#ffffff` | Text on coloured backgrounds |

### Core Accent Tokens
| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--brand` | `#007bff` | `#6aa5ff` | Primary actions, active states, links |

### Semantic Status Tokens (To Be Added — Required by REC-001, REC-008)
These do not currently exist and must be added to index.css:

| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--color-urgency-critical` | `#dc3545` | `#e87d87` | Critical priority, errors, overdue |
| `--color-urgency-high` | `#fd7e14` | `#f4a45a` | High priority, warnings |
| `--color-urgency-medium` | `#e5a400` | `#f0c040` | Medium priority, caution |
| `--color-urgency-low` | `#6c757d` | `#a0a5b1` | Low priority, neutral |
| `--color-status-done` | `#198754` | `#5dba85` | Completed states, success |
| `--color-status-inprogress` | `#0d6efd` | `#6aa5ff` | Active/in-progress states |
| `--color-status-backlog` | `#6c757d` | `#a0a5b1` | Inactive/backlog states |
| `--color-status-blocked` | `#dc3545` | `#e87d87` | Blocked states |
| `--color-status-review` | `#fd7e14` | `#f4a45a` | Under review states |

### Glass/Overlay Tokens
| Token | Light | Dark | Use for |
|-------|-------|------|---------|
| `--glass-bg-opacity` | `0.7` | `0.15` | Glass card opacity |
| `--glass-border-color` | `rgba(255,255,255,0.3)` | `rgba(255,255,255,0.1)` | Glass borders |
| `--glass-shadow-color` | `rgba(0,0,0,0.1)` | `rgba(0,0,0,0.3)` | Glass shadows |

---

## 3. Governance Rules

### Rule 1: No hard-coded colour values in feature components
Feature component files (`.tsx`) must not contain inline hex (`#rrggbb`), RGB (`rgb()`), or RGBA (`rgba()`) colour values. All colours must be expressed as CSS variable references: `var(--token-name)`.

**Applies to**: All component files in `react-app/src/components/`
**Exceptions**: CSS utility files and shared CSS may define colour values as part of token definitions. Test/story files are exempt.
**Enforcement**: Reviewer checklist item on all PRs touching component files.

---

### Rule 2: Bootstrap colour utility classes are banned in new code
Bootstrap utility classes that carry semantic colour meaning (`bg-light`, `bg-dark`, `bg-primary`, `bg-danger`, `bg-warning`, `bg-success`, `text-danger`, `text-success`, `text-warning`, `text-muted`) must not be used in new component code. They bypass the custom theme system.

**Use instead**: CSS variable tokens or pill CSS classes from KanbanCards.css.
**Existing usages**: Acceptable but flagged for removal during refactor passes (see violation list below).
**Permitted Bootstrap utilities**: Layout/spacing utilities (`d-flex`, `mb-3`, `p-2`, `gap-2`) are permitted — only colour-semantic utilities are banned.

---

### Rule 3: Domain theme colours must have dark mode counterparts
Every colour variant in `ThemeColors.css` (`--theme-X-lighter`, `--theme-X-light`, `--theme-X-primary`, `--theme-X-dark`, `--theme-X-darker`) must have a corresponding `[data-theme="dark"]` override.

**Dark mode values**: Increase opacity on `-lighter` variants from `0.1` to `0.15-0.2`. Shift hue slightly warmer/lighter to maintain readability against `--card: #171a21`.

---

### Rule 4: Lucide icon `color` prop must use CSS variables
Icon components used with an explicit `color` prop (e.g., `<Activity color="#0066cc" />`) must use `var(--brand)`, `var(--muted)`, `var(--text)`, or a semantic token instead of a hex value.

**Pattern**:
```tsx
// ❌ Banned
<Activity color="#0066cc" />

// ✅ Correct
<Activity color="var(--brand)" />
// or via CSS class
<Activity className="icon-brand" />  // where .icon-brand { color: var(--brand); }
```

---

### Rule 5: Theme attributes are set only by ModernThemeContext
No component may call `document.documentElement.setAttribute('data-theme', ...)` or toggle the `dark` class directly. All theme switching goes through `ModernThemeContext`.

---

### Rule 6: MaterialDesign.css must be removed
MaterialDesign.css defines 520 lines of `--md-*` CSS variables consumed by no component. It is a source of potential future confusion and CSS load overhead. It must be deleted when the theme governance cleanup begins.

---

### Rule 7: themeConsistency.css must be scoped or merged
themeConsistency.css defines `--notion-*` variables and `[data-theme="dark"]` rules that may conflict with System A. Its rules must be audited for conflicts and either:
- Merged into `theme-aware.css` under a clear namespace, or
- Scoped to specific component classes to prevent cascade pollution

---

## 4. Priority Fix Order

1. **Add semantic tokens to index.css** (REC-001, REC-008) — foundational; all other colour fixes depend on this
2. **Fix FocusGoalCountdownBanner** (REC-001) — Critical WCAG violation
3. **Fix Dashboard.css hard-coded calendar colours** (REC-002) — Critical dark mode break
4. **Add dark mode overrides to ThemeColors.css** (REC-012) — High impact across all domain-themed cards
5. **Fix MobileHome THEME_COLORS map** (REC-015) — Only mobile surface; highest mobile impact
6. **Replace Bootstrap Badge components in card views** (REC-021) — Prerequisite for unified chip standard
7. **Remove MaterialDesign.css** (REC-035) — Dead code cleanup
8. **Audit and remediate remaining hard-coded colours** (REC-020) — Long tail

---

## 5. Hard-Coded Colour Violation Catalogue

The following components contain hard-coded colour values that violate Rule 1. This is a representative list from the code exploration; a full automated scan should be run before remediation.

### Critical Violations (WCAG failure risk)

| File | Line(s) | Hard-coded value | Replace with |
|------|---------|-----------------|--------------|
| `FocusGoalCountdownBanner.tsx` | `getUrgencyColor()` switch | `#dc3545`, `#fd7e14`, `#0066cc`, `#6c757d` | `var(--color-urgency-*)` |
| `Dashboard.css` | ~413-420 | `#dc3545` (`.rbc-current-time-indicator`) | `var(--color-urgency-critical)` |

### High Priority Violations

| File | Line(s) | Hard-coded value | Replace with |
|------|---------|-----------------|--------------|
| `KanbanCardV2.tsx` | Drag handle | `rgba(59, 130, 246, ...)` | `var(--brand)` at low opacity |
| `KanbanCardV2.tsx` | Blocked border | `var(--bs-danger, #dc3545)` | `var(--color-urgency-critical)` |
| `SortableStoryCard.tsx` | Manual priority badge | `rgba(220, 53, 69, 0.45)` | `var(--color-urgency-critical)` at 20% opacity |
| `Dashboard.tsx` | Calendar event fallback | `'#3b82f6'` | `var(--brand)` |
| `Dashboard.tsx` | Gradient banners | `#fd7e14`, `#b35c00` | `var(--color-urgency-high)` |
| `MobileHome.tsx` | `THEME_COLORS` map | Multiple hex values per category | `--theme-X-primary` CSS vars |
| `FocusGoalWizard.tsx` | Selection states | `#0066cc`, `#ddd` | `var(--brand)`, `var(--line)` |

### Medium Priority Violations

| File | Hard-coded value(s) | Notes |
|------|---------------------|-------|
| `FitnessKPIDisplay.tsx` | `#0066cc` on Lucide icon `color` prop | Violates Rule 4 |
| `BirthdayMilestoneCard.tsx` | Unknown — to be confirmed in remediation pass | Not fully audited |
| `StoriesCardView.tsx` | `withAlpha(themeColor, 0.25)` for border | Uses utility function not CSS var — borderline |
| `KanbanCards.css` | `rgba(220, 38, 38, ...)`, `rgba(253, 126, 20, ...)`, `rgba(234, 179, 8, ...)`, `rgba(34, 197, 94, ...)` in pill variants | These are CSS-level definitions, acceptable *if* they map to the semantic tokens defined in Section 2. Migrate to use `var(--color-urgency-*)` |

### Bootstrap Badge Violations (Rule 2)

| File | Badge usage | Replace with |
|------|------------|--------------|
| `StoriesCardView.tsx` | `<Badge bg="secondary">AI NN/100</Badge>` | `AiScoreBadge` component (pill CSS) |
| `StoriesCardView.tsx` | `<Badge bg="danger">#N Priority</Badge>` | `ManualPriorityBadge` component |
| `TasksCardView.tsx` | Same as StoriesCardView | Same |
| `GoalsCardView.tsx` | Same pattern (assumed) | Same |
| Various table components | `text-muted`, `text-danger` classes | `var(--muted)`, `var(--color-urgency-critical)` |

---

## 6. CSS Load Order Documentation

The following is the required CSS load order and intended precedence (lowest specificity first, highest last):

```
1. index.css          — Core System A tokens (light + dark). Global resets.
2. ThemeColors.css    — System B domain theme palettes.
3. theme-aware.css    — System C component-level dark mode overrides.
4. themeConsistency.css — System C Notion-style component rules (must not conflict with 1-3).
5. Bootstrap CSS      — Bootstrap base (loaded by React app entry point).
6. Dashboard.css      — Dashboard-specific calendar overrides.
7. KanbanCards.css    — Kanban/card pill and badge CSS.
8. GlobalEditButton.css — Shared edit button styles.
9. unified-planner.css — Planner-specific calendar overrides.
```

**Principle**: More specific or component-scoped CSS loads last. Global theme tokens load first so they can be referenced throughout. Bootstrap loads after tokens so Bootstrap's `var(--bs-*)` variables can reference custom tokens where mapped.

**Current risk**: `themeConsistency.css` (item 4) defines `[data-theme="dark"]` rules that can override items 1-3 depending on selector specificity. This is the cascade conflict identified in the audit. It must be resolved by scoping themeConsistency.css rules to specific component class namespaces (e.g., `.notion-nav [data-theme="dark"]`) rather than bare `[data-theme="dark"]`.

---

## 7. Dark Mode Test Checklist

Before shipping any component change, verify in both light and dark mode:

- [ ] Text is readable (minimum 4.5:1 contrast ratio for normal text, 3:1 for large text)
- [ ] Card backgrounds are visually distinct from page background
- [ ] Status pills and priority pills are visible and distinctive
- [ ] Domain theme colours (if applied) are visible and distinct on dark card background
- [ ] Borders and dividers are visible but not harsh
- [ ] Icon colours are visible
- [ ] Button states (hover, focus, active, disabled) are all visible
- [ ] Modal overlay (scrim) is appropriately dark
- [ ] Empty state and loading skeleton use theme-appropriate colours
- [ ] Any gradient backgrounds look acceptable (not overly saturated)
- [ ] Focus rings are visible (keyboard navigation)

**Test viewport**: Render in Chrome DevTools with colour theme set to dark. Also test with OS-level dark mode to verify `prefers-color-scheme` media query consistency (if applicable).

---

## 8. Proposed Token Additions to index.css

Add these new tokens to index.css under a `/* Semantic Status & Urgency Tokens */` comment block:

```css
/* Semantic Status & Urgency Tokens */
:root {
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
}

[data-theme="dark"] {
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
}
```

---

## 9. Proposed Dark Mode Additions to ThemeColors.css

For each of the 16 domain themes, add a `[data-theme="dark"]` block. Example for Health:

```css
/* Current (light only) */
:root {
  --theme-health-primary: #e53e3e;
  --theme-health-light: rgba(229, 62, 62, 0.2);
  --theme-health-lighter: rgba(229, 62, 62, 0.1);
  --theme-health-dark: #c53030;
  --theme-health-darker: #9b2c2c;
}

/* Add dark mode overrides */
[data-theme="dark"] {
  --theme-health-light: rgba(232, 125, 135, 0.2);
  --theme-health-lighter: rgba(232, 125, 135, 0.15);
  /* primary, dark, darker: increase brightness for dark backgrounds */
  --theme-health-primary: #e87d87;
  --theme-health-dark: #d4606c;
  --theme-health-darker: #b84d58;
}
```

Repeat for all 16 themes: health, growth, wealth, tribe, home, work, sidegig, sleep, random, chores, rest, travel, and the `defect` variant.

---

## 10. Annotated Before/After: Top 12 UX Changes

The following descriptions serve as annotated wireframe guidance for the highest-impact recommendations. These are text-based layout sketches, not pixel-precise mockups.

---

### Change 1: Unified Status + Priority Pill Row (REC-008)

**Before** (three different renderings of the same data):
```
Kanban:   [In Progress]  [High]     ← CSS text in meta row, read-only
Card:     [In Progress▾] [High▾]   ← Bootstrap Button, click to cycle
Table:    [▼ In Progress] [▼ High]  ← HTML <select> dropdown, no pill style
```

**After** (one component, three modes):
```
Kanban:   [In Progress] [High]      ← StatusPill mode="readonly", same CSS pill
Card:     [In Progress] [High]      ← StatusPill mode="interactive", click to cycle
Table:    [In Progress▾] [High▾]   ← StatusPill mode="select", styled to match pill
```
Identical visual output. Interaction mode is controlled by `mode` prop. Same CSS class on all three.

---

### Change 2: Standard Action Row (REC-013, REC-014)

**Before** (mixed icons, sizes, no labels):
```
Kanban:    [Edit3:12px] [Activity:12px] [CalendarPlus:12px]
Card view: [Calendar:24px] [Activity:24px] [Edit3:24px]    (top-right)
           [Clock3:?px] [Trash2:?px]                         (bottom bar)
Table:     Unknown
```

**After** (consistent order, consistent icons, labelled at ≥ 992px):
```
Desktop (≥992px):  [📅 Schedule] [📊 Activity] [✏ Edit] [⏱ Defer] [🗑 Delete]
Tablet (768-992px): [📅] [📊] [✏] [⏱] [🗑]  ← icons only with title tooltip
Mobile (<768px):    [•••]  ← single overflow button → bottom sheet
```
Standard order and icon set enforced globally. `CalendarClock` for schedule, `Pencil` for edit.

---

### Change 3: AI Score + Top 3 Badge on All View Types (REC-009, REC-010)

**Before**:
```
Kanban:   [In Progress] [High]                     ← no AI score, no Top 3
Card:     [In Progress] [High] [AI 87/100] [#2 Priority]  ← verbose format
Table:    row column: 87                            ← numeric only, no badge
```

**After**:
```
Kanban:   [In Progress] [High] [AI 87] [#2]        ← compact; both visible
Card:     [In Progress] [High] [AI 87] [#2]        ← same compact format
Table:    AI col: [AI 87]  +  inline: [#2]          ← compact badges in cells
```
Compact `AI 87` format (not `/100`). `#2` manual priority rank badge. Consistent across all three view types. Hidden when score < 20 or rank is unset.

---

### Change 4: Mobile Card Layout with Overflow Menu (REC-011, REC-024)

**Before** (card view on mobile — 24px buttons, not tap-safe):
```
┌────────────────────────────────────┐
│ TASK-042     [⏰:24px][📊:24px][✏:24px] │  ← too small to tap
│ Build auth middleware               │
│ [In Progress:btn] [High:btn]        │  ← buttons small, action unclear
│ ─────────────────────────────────  │
│ Theme: Work   [Clock:24px] [Trash:24px] │  ← bottom bar, also small
└────────────────────────────────────┘
```

**After** (mobile card with overflow and 44px targets):
```
┌────────────────────────────────────┐
│ Build auth middleware    [High] [•••] │  ← priority compact + overflow btn
│ TASK-042  •  In Progress  •  Mar 20  │
│ ↳ Sprint 14                          │
└────────────────────────────────────┘

Tap •••:
┌────────────────────────────────────┐
│ [📅] Schedule                        │  ← 44px rows
│ [📊] Activity stream                 │
│ [✏] Edit                             │
│ [⏱] Defer                            │
│ [🗑] Delete                           │
└────────────────────────────────────┘
```

---

### Change 5: Table → Card Auto-Switch on Narrow Viewport (REC-004)

**Before**: At 600px viewport width, ModernTaskTable renders full-width with horizontal scroll. Column widths overflow. Drag handles and dropdowns are unusable.

**After**: At < 768px, the wrapper component (TaskListView) automatically renders TasksCardView in mobile mode. The view toggle button is hidden. Users interact with cards, not a table.

```
> 768px:  [Toggle: Table | Card]  [Sortable table rendering]
< 768px:  [No toggle — card view only]  [Mobile card grid, 1 column]
```

---

### Change 6: Empty State Component (REC-016)

**Before** (Kanban empty column):
```
[Empty column white space — nothing]
or
[Loading board...]
```

**After** (consistent empty state):
```
         📋
    No backlog items

    All caught up! Add new tasks to
    start planning your sprint.

         [+ Add task]
```
Same pattern for table (empty rows) and mobile (empty tab).

---

### Change 7: Domain Theme Dark Mode Adaptation (REC-012)

**Before** (dark mode — light theme colours on dark background):
```
┌────────────────────────────────────┐  ← card: #171a21
│░░ Health goal card (light red)     │  ← --theme-health-lighter: rgba(229,62,62,0.1)
│   Build daily running habit        │  ← barely visible red strip on dark card
└────────────────────────────────────┘
```

**After** (dark mode — higher opacity, lighter hue):
```
┌────────────────────────────────────┐  ← card: #171a21
│▓▓ Health goal card (bright red)    │  ← --theme-health-lighter dark: rgba(232,125,135,0.15)
│   Build daily running habit        │  ← clearly visible salmon/red strip on dark card
└────────────────────────────────────┘
```

---

### Change 8: GoalRoadmap Mobile Gate (REC-005)

**Before** (mobile — partial Gantt render, broken interaction):
```
[Partially visible Gantt chart — labels cut off, no scroll, no zoom, no touch drag]
```

**After** (mobile — clean unsupported screen):
```
            🖥
    Goal Roadmap requires desktop

    The roadmap view is a Gantt chart
    designed for desktop use.
    Open this link on your laptop to
    access the full roadmap.

            [📋 Copy link]
```

---

### Change 9: Finance Dashboard Mobile Summary (REC-017)

**Before** (mobile — desktop charts render at 375px width, overflow and unreadable):
```
[Partial chart rendering — legend overlaps bars — numbers illegible — tabs cut off]
```

**After** (mobile — 3 key metric tiles + link to desktop):
```
┌─────────────────┐  ┌─────────────────┐
│  Mar Spending    │  │  Budget Left    │
│    £1,247        │  │    £312         │
│   of £1,500      │  │  21% remaining  │
└─────────────────┘  └─────────────────┘

┌───────────────────────────────────────┐
│  Last transaction: Costa Coffee £3.40  │
│  2 hours ago                           │
└───────────────────────────────────────┘

[View full dashboard on desktop →]
```

---

### Change 10: Unified Filter Chip Bar (REC-019)

**Before** (inconsistent per-view filter controls):
```
Kanban toolbar:   [Overdue ▼] [Sort: AI ▼] [Theme ▼]  ← dropdowns
Task table:       Column visibility toggle in header
Mobile:           [Top 3] [Due Today] [Overdue] [All]   ← button group
```

**After** (shared filter chip bar):
```
All views:  [Top 3 ✓] [Overdue] [Critical] [AI Critical] [+ Filter]
                ↑ active chip    ↑ inactive chip
```
Active chip: `var(--brand)` border + light fill. Inactive: `var(--line)` border. Identical on desktop and mobile (wraps to second row on narrow viewports).

---

### Change 11: Calendar Agenda-Only Mobile View (REC-007)

**Before** (mobile — React Big Calendar week view with broken drag-and-drop):
```
[7-column week grid — events too small to read — drag fails on touch — overflow not visible]
```

**After** (mobile — agenda list with FAB):
```
TODAY — TUESDAY, MARCH 17

09:00  Sprint standup [30m]
10:30  Focus: Auth middleware [2h]
14:00  1:1 with team [1h]

TOMORROW — WEDNESDAY, MARCH 18

09:00  Design review [45m]

                              [+]  ← FAB to add item
```

---

### Change 12: Settings Responsive Hide Pattern (REC-031)

**Before** (mobile — SettingsPage full multi-tab settings form rendered):
```
[Profile | AI | Finance | Notifications | Privacy | Developer]  ← tabs overflow
[Dense form fields, integration config tables, developer tools]
```

**After** (mobile — profile + notifications only, rest gated):
```
┌─────────────────────────────────────────┐
│ Profile     [editable form fields]      │
│ Notifications [toggle switches]         │
│                                          │
│ More settings available on desktop →    │
└─────────────────────────────────────────┘
```
Integration, AI, Finance, Developer, Privacy tabs hidden on mobile. A single "More settings on desktop" link at the bottom allows power users to navigate there and see the `MobileUnsupportedScreen`.
