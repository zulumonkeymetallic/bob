---
name: BOB — Personal Operating System
description: >
  BOB is a full-stack personal productivity and life-management platform. It
  unifies goal tracking, sprint planning, finance, fitness, habits, and AI
  coaching under a single dark-first interface. This document is the canonical
  design reference for the complete application — intended for use by AI coding
  assistants performing a full UI redesign toward consistency, desktop + mobile
  parity, and visual coherence.

colors:
  # Surface stack — light mode
  bg-light: "#f0f2f5"
  panel-light: "#ffffff"
  card-light: "#ffffff"
  line-light: "#e0e0e0"
  text-light: "#333333"
  muted-light: "#666666"
  brand-light: "#007bff"

  # Surface stack — dark mode (primary / default theme)
  bg-dark: "#0b0d11"
  panel-dark: "#12141a"
  card-dark: "#171a21"
  line-dark: "#232632"
  text-dark: "#e8e9ed"
  muted-dark: "#a0a5b1"
  brand-dark: "#6aa5ff"
  on-accent: "#ffffff"

  # Semantic brand
  brand: "#007bff"
  brand-hover-gradient-end: "#4f46e5"
  focus-gold: "#f59e0b"
  focus-gold-ring: "0 0 0 2.5px #f59e0b"

  # Urgency
  urgency-critical: "#dc3545"
  urgency-high: "#fd7e14"
  urgency-medium: "#e5a400"
  urgency-low: "#6c757d"

  # Work item status
  status-done: "#198754"
  status-inprogress: "#0d6efd"
  status-backlog: "#6c757d"
  status-blocked: "#dc3545"
  status-review: "#fd7e14"
  status-testing: "#0dcaf0"

  # Domain palette — light mode
  domain-health: "#e53e3e"
  domain-growth: "#3182ce"
  domain-wealth: "#38a169"
  domain-tribe: "#805ad5"
  domain-home: "#d69e2e"
  domain-work: "#2563eb"
  domain-sidegig: "#14b8a6"
  domain-sleep: "#6366f1"
  domain-random: "#64748b"

  # Domain palette — dark mode (lightened for readability)
  domain-health-dark: "#e87d87"
  domain-growth-dark: "#6aabdf"
  domain-wealth-dark: "#68d391"
  domain-tribe-dark: "#b794f4"
  domain-home-dark: "#f6c05a"
  domain-work-dark: "#7aadff"
  domain-sidegig-dark: "#4fd1c5"
  domain-sleep-dark: "#a5b4fc"
  domain-random-dark: "#94a3b8"

  # Data visualisation
  chart-green: "#22c55e"
  chart-amber: "#f59e0b"
  chart-red: "#ef4444"
  chart-grey: "#374151"
  chart-blue: "#3b82f6"
  chart-teal: "#10b981"
  chart-purple: "#8b5cf6"
  chart-pie-0: "#6366f1"
  chart-pie-1: "#3b82f6"
  chart-pie-2: "#06b6d4"
  chart-pie-3: "#10b981"
  chart-pie-4: "#f59e0b"
  chart-pie-5: "#ef4444"
  chart-pie-6: "#8b5cf6"
  chart-pie-7: "#ec4899"

  # Glassmorphism
  glass-bg-light: "rgba(255,255,255,0.70)"
  glass-bg-dark: "rgba(23,26,33,0.15)"
  glass-border-light: "rgba(255,255,255,0.30)"
  glass-border-dark: "rgba(255,255,255,0.10)"
  glass-shadow-light: "rgba(0,0,0,0.10)"
  glass-shadow-dark: "rgba(0,0,0,0.30)"

  # Special UI
  fab-blue: "#1976d2"
  fab-blue-hover: "#1565c0"
  persona-personal: "#4CAF50"
  persona-work: "#666666"
  readiness-green: "#157347"
  readiness-amber: "#b58105"
  readiness-red: "#b02a37"
  delegation-queued: "#ffc107"
  delegation-running: "#17a2b8"
  delegation-review: "#28a745"
  delegation-failed: "#dc3545"
  map-unvisited: "#111827"
  map-bucket-list: "#facc15"
  map-story-created: "#16a34a"
  map-completed: "#2563eb"

typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "2rem"
    fontWeight: "700"
    lineHeight: "1.2"
  heading-lg:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.75rem"
    fontWeight: "700"
    lineHeight: "1.25"
  heading-md:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: "600"
    lineHeight: "1.4"
  heading-sm:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: "600"
    lineHeight: "1.5"
  body-lg:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: "400"
    lineHeight: "1.5"
  body-md:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: "400"
    lineHeight: "1.5"
  label-lg:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: "600"
    lineHeight: "1.4"
    letterSpacing: "-0.01em"
  label-md:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: "600"
    lineHeight: "1.4"
  label-sm:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: "600"
    lineHeight: "1.3"
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: "400"
    lineHeight: "1.3"
    letterSpacing: "0.02em"
  mono:
    fontFamily: "'SFMono-Regular', 'Fira Mono', 'Consolas', monospace"
    fontSize: "0.8125rem"
    fontWeight: "400"
    lineHeight: "1.5"

spacing:
  base: "8px"
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
  card-padding: "16px 20px"
  card-padding-sm: "12px"
  section-gap: "20px"
  modal-padding: "24px"

rounded:
  none: "0"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  "2xl": "14px"
  "3xl": "16px"
  full: "999px"

elevation:
  "0": "none"
  "1": "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)"
  "2": "0 2px 8px rgba(0,0,0,0.08)"
  "3": "0 4px 12px rgba(0,0,0,0.10)"
  "4": "0 8px 24px rgba(0,0,0,0.15)"
  "5": "0 12px 26px rgba(15,23,42,0.22)"
  glass: "0 8px 32px 0 rgba(0,0,0,0.10)"
  drag: "0 12px 26px rgba(15,23,42,0.22)"
  modal: "0 25px 50px -12px rgba(0,0,0,0.25)"
  sidebar: "-4px 0 8px rgba(0,0,0,0.10)"

motion:
  fast: "150ms ease"
  standard: "200ms ease"
  slow: "300ms ease"
  spring: "200ms cubic-bezier(0.4,0,0.2,1)"
  sidebar-collapse: "width 0.3s ease"
  lift: "translateY(-2px)"
  drag: "translateY(-2px) rotate(1deg)"
  gauge-arc: "stroke-dashoffset 0.6s ease"

blur:
  sm: "10px"
  md: "12px"
  lg: "20px"
  glass: "20px"

components:
  card-default:
    backgroundColor: "{colors.panel-light}"
    border: "1px solid {colors.line-light}"
    borderRadius: "{rounded.2xl}"
    boxShadow: "{elevation.2}"
    padding: "{spacing.card-padding}"
    transition: "{motion.standard}"
  card-kpi:
    backgroundColor: "{colors.panel-light}"
    border: "1px solid {colors.line-light}"
    borderRadius: "{rounded.xl}"
    padding: "16px 18px"
    minHeight: "88px"
  kanban-card:
    backgroundColor: "{colors.card-light}"
    border: "1px solid {colors.line-light}"
    borderLeft: "3px solid {domain-color}"
    borderRadius: "{rounded.lg}"
    padding: "{spacing.card-padding-sm}"
    boxShadow: "{elevation.2}"
    transition: "transform 0.16s ease, box-shadow 0.16s ease"
  kanban-card-drag:
    opacity: "0.4"
    transform: "{motion.drag}"
    boxShadow: "{elevation.drag}"
  sprint-column:
    backgroundColor: "{colors.panel-light}"
    border: "1px solid {colors.line-light}"
    borderRadius: "{rounded.xl}"
    padding: "14px"
    minHeight: "420px"
    minWidth: "300px"
  sprint-column-header:
    borderBottom: "2px solid {domain-color}"
    backgroundColor: "{colors.card-light}"
    borderRadius: "{rounded.md} {rounded.md} 0 0"
    padding: "12px"
    marginBottom: "8px"
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-accent}"
    borderRadius: "{rounded.sm}"
    fontWeight: "500"
    fontSize: "0.875rem"
    padding: "6px 12px"
    transition: "{motion.fast}"
  button-primary-hover:
    background: "linear-gradient(135deg, {colors.brand} 0%, #4f46e5 100%)"
    transform: "{motion.lift}"
    boxShadow: "0 4px 12px rgba(99,102,241,0.4)"
  fab:
    backgroundColor: "{colors.fab-blue}"
    size: "56px"
    borderRadius: "{rounded.full}"
    boxShadow: "0 4px 8px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)"
    fontSize: "24px"
    fontWeight: "700"
    position: "fixed bottom:24px right:24px"
    zIndex: "1050"
  fab-mini:
    backgroundColor: "white"
    textColor: "{colors.fab-blue}"
    border: "2px solid {colors.fab-blue}"
    size: "40px"
    borderRadius: "{rounded.full}"
    fontSize: "18px"
    fontWeight: "600"
  badge-domain:
    borderRadius: "{rounded.full}"
    fontSize: "0.75rem"
    fontWeight: "600"
    padding: "2px 6px"
  heatmap-box:
    size: "13px"
    borderRadius: "4px"
    gap: "2px"
    complete: "{colors.chart-green}"
    partial: "{colors.chart-amber}"
    missed: "{colors.chart-red}"
    empty: "{colors.chart-grey}"
  form-control:
    backgroundColor: "{colors.panel-light}"
    border: "1px solid {colors.line-light}"
    borderRadius: "{rounded.sm}"
    padding: "10px 16px"
    focusBorder: "{colors.brand}"
    focusRing: "0 0 0 3px rgba(99,102,241,0.1)"
    minHeight-mobile: "44px"
    fontSize-mobile: "16px"
  readiness-gauge:
    svgSize: "90px"
    radius: "40"
    cx: "50"
    cy: "50"
    strokeWidth: "10"
    trackColor: "var(--bs-border-color)"
    transition: "{motion.gauge-arc}"
    startAngle: "rotate(-90 50 50)"
  sparkline:
    height: "40px"
    strokeWidth: "2"
    gradientOpacityTop: "0.25"
    gradientOpacityBottom: "0"
  donut-ring:
    innerRadius: "24"
    outerRadius: "32"
    height: "64px"
    emptyFill-dark: "#374151"
    emptyFill-light: "#e5e7eb"
    startAngle: "90"
    endAngle: "-270"
  modal-default:
    backgroundColor: "{colors.panel-light}"
    border: "1px solid {colors.line-light}"
    borderRadius: "{rounded.xl}"
    boxShadow: "{elevation.modal}"
    bodyPadding: "{spacing.modal-padding}"
  right-sidebar:
    width: "400px"
    widthCollapsed: "60px"
    boxShadow: "{elevation.sidebar}"
    transition: "{motion.sidebar-collapse}"
    zIndex: "1000"
  left-sidebar:
    width: "250px"
    background: "{colors.panel-dark}"
    borderRight: "1px solid {colors.line-dark}"
    zIndex: "1001"
---


## Overview

BOB is a personal operating system for a single high-output user (Jim Donnelly) who manages goals, projects, finances, fitness, and habits as a unified digital backlog. It is not a consumer app. It is built for power use, daily immersion, and maximum information density within a working professional context.

This document is the canonical reference for a complete UI redesign. It covers every screen, every component, every modal, and every icon in the codebase, with enough specificity that an AI coding assistant can rebuild or redesign any part of the application consistently without access to the source files.


## Design Principles

**1. Dark-first.** The default and primary theme is near-black (`#0b0d11`). Light mode exists but is secondary. All design decisions should look correct in dark mode first.

**2. Domain-coloured.** Every work item (goal, story, task) is tagged to a life domain. That domain colour is the dominant visual variable — it colours borders, badges, chart fills, sidebar accents, and header gradients. A user scanning the screen should instantly know which domain they are looking at.

**3. Information density over whitespace.** The target user lives in this app for hours daily. Screens show 6–20 simultaneous metrics. Visual hierarchy is achieved through font weight, colour saturation, and component size — not empty space.

**4. Contextual chrome.** A collapsible left sidebar, a persistent right detail panel, a global toolbar, and floating action buttons create overlapping layers of navigation and context. These never go away; they are part of the identity of the app.

**5. Operational, not decorative.** No illustrations, no gradients for decoration, no hero banners. Every visual element serves a data point or an action. The closest thing to decoration is the domain colour system.

**6. Consistency gap (current state).** The app has three overlapping CSS theme systems, mixed Bootstrap and custom variable usage, and bespoke styling per screen. This document should be used to resolve all of those inconsistencies into a single coherent system.


## Colour System

### Surface Stack

The dark-mode surface stack creates depth through subtle brightness steps (~5–7% between levels):

| Level | Dark value | Light value | Usage |
|-------|-----------|------------|-------|
| Page background | `#0b0d11` | `#f0f2f5` | Outermost layer, below all cards |
| Panel | `#12141a` | `#ffffff` | Sidebar, card containers, section panels |
| Card | `#171a21` | `#ffffff` | Inner cards, input backgrounds, dropdowns |
| Line / border | `#232632` | `#e0e0e0` | Dividers, table rules, input borders |
| Text | `#e8e9ed` | `#333333` | Primary text |
| Muted | `#a0a5b1` | `#666666` | Secondary labels, timestamps, placeholders |
| Brand | `#6aa5ff` | `#007bff` | Interactive affordances, active states |
| On-accent | `#ffffff` | `#ffffff` | Text on coloured backgrounds |

### Domain Colour Palette

The most important design decision in the application. Every piece of content belongs to a domain, and that domain colour runs through every surface it touches.

| Domain | Light Primary | Dark Primary | Usage context |
|--------|--------------|-------------|--------------|
| Health | `#e53e3e` | `#e87d87` | Fitness, body, wellbeing |
| Growth | `#3182ce` | `#6aabdf` | Learning, self-improvement |
| Wealth | `#38a169` | `#68d391` | Finance, income, savings |
| Tribe | `#805ad5` | `#b794f4` | Relationships, social |
| Home | `#d69e2e` | `#f6c05a` | Home environment, chores |
| Work | `#2563eb` | `#7aadff` | Primary employment |
| Side Gig | `#14b8a6` | `#4fd1c5` | Secondary income, experiments |
| Sleep | `#6366f1` | `#a5b4fc` | Rest, recovery |
| Random | `#64748b` | `#94a3b8` | Unclassified |

Each domain colour is used at four opacity levels:
- **Primary** — solid border, badge background, chart fill
- **Light** — 20% opacity, selected row background tint
- **Lighter** — 10% opacity, default card background tint for domain-tagged items
- **Dark/Darker** — deeper shades for hover states

### Special Accent: Focus Gold

`#f59e0b` is reserved exclusively for Top-3 priority items and the Focus Goals feature. It never competes with brand blue. It signals "pinnacle importance" and appears as:
- Gold left-border ring on kanban cards
- Gold badge background on "Top 3" meta badge
- Gold dot on focus-aligned items in the planner

### Status Colours

| Status | Colour | Context |
|--------|--------|---------|
| Done | `#198754` | Completed goals, stories, tasks |
| In Progress | `#0d6efd` | Active work |
| Review | `#fd7e14` | Awaiting review |
| Blocked | `#dc3545` | Hard-blocked items |
| Testing | `#0dcaf0` | Items in QA/testing |
| Backlog | `#6c757d` | Not yet started |

### Urgency Colours

| Urgency | Colour |
|---------|--------|
| Critical | `#dc3545` |
| High | `#fd7e14` |
| Medium | `#e5a400` |
| Low | `#6c757d` |

### Data Visualisation Colours

Charts across the application use this consistent semantic set:

- On-target / complete: `#22c55e`
- Partial / warning: `#f59e0b`
- Behind / missed: `#ef4444`
- No data / empty: `#374151`
- Activity / steps / primary metric: `#3b82f6`
- Recovery / HRV: `#10b981`
- Pie chart sequence: indigo → blue → cyan → emerald → amber → red → violet → pink

### Persona Colours

The app supports two personas (Personal / Work). The active persona is signalled visually:
- Personal: toolbar background white, persona dot `#4CAF50` (green)
- Work: toolbar background `#d3d3d3`, persona dot `#666666`


## Typography

Inter is used throughout. It was chosen for its neutral authority and exceptional legibility at small sizes — both critical in a dense dashboard context.

### Scale

| Role | Size | Weight | Use |
|------|------|--------|-----|
| Display | 2rem | 700 | Page titles |
| Heading LG | 1.75rem | 700 | Section headings |
| Heading MD | 1.25rem | 600 | Card headers, modal titles |
| Heading SM | 1rem | 600 | Widget titles, table headers |
| Body | 1rem | 400 | Primary content |
| Body SM | 0.875rem | 400 | Secondary content, descriptions |
| Label LG | 0.875rem | 600 | Button text, field labels |
| Label MD | 0.8125rem (13px) | 600 | Kanban card titles |
| Label SM | 0.75rem (12px) | 600 | Badges, tags |
| Caption | 0.6875rem (11px) | 400 | Heatmap labels, tooltips, micro-data |
| Mono | 0.8125rem | 400 | IDs, amounts, code |

### Typography Conventions

- **UPPERCASE + `letter-spacing: 0.05em`** on KPI category labels and metric headers — signals "data header."
- **Monospace** for transaction amounts, P&L figures, entity reference numbers (ST-XXXXX, TK-XXXXX).
- **`--muted` colour** for secondary labels, timestamps, placeholders.
- **`font-weight: 900` + `letter-spacing: 2px`** for the reference number in the right detail sidebar — the entity ID is meant to feel like a product serial number.
- Mobile: `font-size: 16px` minimum on all input fields to prevent iOS auto-zoom.


## Spacing

Based on an 8px unit. Component internals use 4px increments.

| Token | Value | Context |
|-------|-------|---------|
| 1 | 4px | Gap between tags, inline elements, meta badges |
| 2 | 8px | Gap between compact components |
| 3 | 12px | Kanban card inner padding (compact) |
| 4 | 16px | Standard gap, card body padding |
| 5 | 20px | Dashboard outer padding |
| 6 | 24px | Section separation, modal body padding |
| 8 | 32px | Major section gaps |

### Key Layout Proportions

**Today Plan (daily plan screen):**
- Summary col: 24%
- Calendar col: 31%
- Due Today col: 25%
- Chores col: 20%

**Sprint Planning Grid:** 5 columns, `minmax(220px, 1fr)`, 16px gap

**Goal/Story cards grid:** `auto-fit minmax(250px, 1fr)`, 20px gap

**Right sidebar width:** 400px expanded, 60px collapsed


## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Heatmap boxes, tight chips, table cell badges |
| sm | 6px | Buttons, form inputs, dropdowns, modal corners |
| md | 8px | Forms, column headers, smaller containers |
| lg | 10px | Kanban cards, smaller cards |
| xl | 12px | Modals, medium containers, sprint columns |
| 2xl | 14px | Main content cards, panel containers |
| 3xl | 16px | Metric cards in settings |
| full | 999px | Badges, pills, avatars, FAB, progress bars |


## Elevation & Shadows

Two shadow philosophies coexist (a known inconsistency to resolve):

**Bootstrap `shadow-sm`** (`box-shadow: 0 0.125rem 0.25rem rgba(0,0,0,0.075)`) — applied via `className="shadow-sm border-0"` on finance and planning cards. Intentionally light.

**Custom shadow stack** — applied on interactive and draggable components:

| Level | Value | State |
|-------|-------|-------|
| 0 | none | Flat elements |
| 1 | `0 1px 3px rgba(0,0,0,0.12)` | Table rows |
| 2 | `0 2px 8px rgba(0,0,0,0.08)` | Resting cards |
| 3 | `0 4px 12px rgba(0,0,0,0.10)` | Hover state |
| 4 | `0 8px 24px rgba(0,0,0,0.15)` | Dropdowns, popovers |
| 5 / drag | `0 12px 26px rgba(15,23,42,0.22)` | Active DnD drag |
| glass | `0 8px 32px 0 rgba(0,0,0,0.10)` | Glassmorphism panels |
| modal | `0 25px 50px -12px rgba(0,0,0,0.25)` | Modals |
| sidebar | `-4px 0 8px rgba(0,0,0,0.10)` | Right panel |

Dark mode increases all opacity values by ~2×.


## Motion

| Token | Value | Use |
|-------|-------|-----|
| fast | 150ms ease | Hover colour shifts, badge updates |
| standard | 200ms ease | Card lift, dropdown open |
| slow | 300ms ease | Theme transition, modal open |
| spring | 200ms cubic-bezier(0.4,0,0.2,1) | Sidebar collapse, panel slide |
| lift | `translateY(-2px)` | Hover transform on all interactive cards |
| drag | `translateY(-2px) rotate(1deg)` | Active DnD drag state |
| gauge-arc | `stroke-dashoffset 0.6s ease` | Readiness gauge fill animation |

Drag-and-drop items grow a heavier shadow on lift and return to resting on drop.


## Glassmorphism

Applied only on overlay banners and panels that float over a rich background surface.

- Background: `rgba(card-rgb, 0.15)` dark / `rgba(255,255,255,0.7)` light
- `backdrop-filter: blur(20px)`
- Border: `1px solid rgba(255,255,255,0.10)` dark / `rgba(255,255,255,0.30)` light
- Shadow: `0 8px 32px 0 rgba(0,0,0,0.10)` light / `rgba(0,0,0,0.30)` dark


---

## Navigation Chrome

### Left Sidebar

The primary navigation container. Collapsible to icon-only on desktop; replaced by an offcanvas drawer on mobile.

**Desktop sidebar specs:**
- Width: 250px open, icon-only when collapsed
- Background: `var(--panel)` (dark: `#12141a`)
- Border-right: `1px solid var(--notion-border)`
- Max-height: `100vh`, `overflow-y: auto`
- Icon library: FontAwesome 6 (`fas fa-{name}`)

**Navigation structure (16 groups):**

| Group | Items |
|-------|-------|
| Overview | Home, Daily check-in, Mobile home, Theme progress, Finance, Habit tracking, Fitness, Kanban, Calendar, Metrics |
| Health | Metrics, AI Coach, Fitness/Workouts, Habit tracking, Parkrun results |
| Goals | Goals list, Focus goals, Goal planner, Gantt, Theme progress, Visual canvas |
| Plan | Year planner, Gantt, Sprint planner, 4-day planner |
| Finance | Dashboard, Budgets, Merchants, Transactions, Spend breakdown, Pots, Goal linking |
| Stories | Stories list, Story kanban, Stories calendar |
| Journals | Journal entries, Journal insights |
| Backlog | Games, Shows, Books, Videos, YouTube history |
| Tasks | Tasks list |
| Sprints | Sprint management, Sprint kanban, Multi-sprint planner, Capacity planning, Retrospective |
| Calendar | Calendar view, Weekly capacity, 4-day planner, Sprint capacity, Google integration |
| Travel | Travel map |
| Settings | Profile, AI, Integrations, Finance, Notifications, Privacy, Developer |
| Logs | Integration logs, AI diagnostics, Transcript logs |

**Item rendering:**
- Group header: icon + label + chevron toggle (`fas fa-chevron-down` / `fas fa-chevron-right`)
- Nav item: `fas fa-{icon}` + label, indented
- Active item: text `var(--brand)`, subtle background highlight
- Hover: background `var(--notion-hover)`

**Bottom of sidebar (sticky):**
- Theme toggle (Light/Dark mode)
- Sign Out button (`outline-danger`, full-width)
- Version display badge (12px monospace, 600 weight, border)

**User section:**
- Avatar circle (32×32, `var(--notion-accent)` background, white initials)
- Display name
- Persona badge
- "Personal" / "Work" toggle buttons (`flex-fill`, size `sm`)

**Brand section (top):**
- Logo 32×32 + "blueprint.organize.build" (16px, 600 weight)

**Collapse toggle (desktop only):**
- Fixed, `top: 10px`, `left: 10px` (collapsed) or `260px` (open)
- Z-index: 2000
- Content: ▶ (collapsed) / ◀ (expanded)
- Style: 1px border, `var(--notion-hover)` bg, `border-radius: 6px`, `padding: 4px 8px`

**Mobile sidebar (Offcanvas):**
- Placement: left (`start`)
- Bootstrap `bg-dark text-white`
- Contains: full navigation groups + user section + bottom actions
- Closes on navigation item click

### Mobile Header (fixed-top, `d-md-none`)

- Height: ~60px
- Background: persona-dependent (personal=white, work=`#d3d3d3`)
- Left: "Menu" button (`outline-dark`, size `sm`) → triggers offcanvas
- Centre: Logo 24×24 + "blueprint.organize.build"
- Right: User avatar circle (24×24)
- Z-index: 1050; main content has `padding-top: 60px` to compensate

### Top Toolbar (desktop only, `d-none d-md-block`)

Fixed below the left sidebar, spans the main content area. Contains (left to right, right-aligned):

1. **Persona indicator** — 8×8 circle dot (Personal=`#4CAF50`, Work=`#666`) + label, 12px 600 weight
2. **ApprovalsBadge** — pending approvals count chip (lazy-loaded)
3. **GlobalSearchBar** — min-width 260px, debounced 250ms, 2-char minimum, 25-result limit
4. **Assistant toggle** — `outline-primary`, size `sm`, "Assistant" / "Hide Assistant"
5. **CompactSprintMetrics** — row of small badges with tooltips:
   - Overall Progress (BookOpen icon)
   - Sprint Days Left (Clock icon)
   - Capacity Remaining (TrendingUp icon)
   - Story Progress (Target icon)
   - Task Progress (CheckCircle icon)
   - Blocked Stories warning (AlertTriangle icon, orange)
6. **"Active Sprint:" label** — `text-muted small`, hidden below xl breakpoint
7. **SprintSelector dropdown** — `outline-primary`, shows sprint name + status badge

Toolbar background: persona-dependent (personal=white, work=`#d3d3d3`).

### Right Detail Sidebar (GlobalSidebar)

Context-aware panel that slides in when a goal/story/task is clicked anywhere in the app.

**Specs:**
- Width: 400px expanded, 60px collapsed
- Height: 100vh, fixed right edge
- `box-shadow: -4px 0 8px rgba(0,0,0,0.10)`
- `border-left: 3px solid {domain-color}`
- `transition: width 0.3s ease`
- Z-index: 1000

**Collapse toggle (left edge):**
- Circle 30×30, `border-radius: 50%`, `background: {domain-color}`
- Position: absolute, left -15px, vertically centred
- Icon: `ChevronLeft` (open) / `ChevronRight` (collapsed), lucide, white

**Collapsed state:**
- Shows type initial (G/S/T) in domain colour, rotated -90°

**Header section:**
- Background: linear-gradient 180°, domain colour at 18% → 10% opacity
- Reference number card: `background: rgba(card, 0.15)`, `border: 2px solid {domain-color}`, monospace 900 weight 24px, letter-spacing 2px
- Header action buttons (right-aligned, gap 8px):
  - `MessageCircle` — Add note
  - `BookOpen` — Research (goals/stories only)
  - `Wand2` — AI orchestrate (stories only)
  - `MessageSquare` — AI chat (goals only)
  - `Edit3` — Inline edit toggle
  - `ExternalLink` — Open full modal editor
  - `Trash2` — Delete (red)
  - `X` — Close

**Content section:**
- Title: editable h4 (18px, 600 weight) in view mode; `Form.Control` in edit mode
- Description: editable textarea (rows 4)
- Tags: badge pills (`#formatted_tag`) in view; `TagInput` in edit
- Status + Priority: 2-column row, Bootstrap badges with variant colours
- Type-specific fields (see screen reference per type)
- Quick-edit panel: condensed form fields in `rgba(card, 0.06)` background
- Metadata section: ID, created/updated timestamps, owner, deep link copy button
- Activity stream: scrollable list (max-height 300px), paginated, with Add Note button

**Save/Cancel footer (edit mode):**
- Save: primary, flex: 1, `Save` icon (16px) + "Save Changes"
- Cancel: `outline-secondary`

### Floating Action Button (FAB)

Bottom-right fixed button. 56×56px circle, `#1976d2`, `z-index: 1050`.

Shows '+' (closed) / '×' (menu open). Opens a vertical stack of 8 mini-buttons (40×40px each):

| Letter | Action |
|--------|--------|
| F | Focus Intake — opens focus period wizard |
| A | Intent Broker — AI intent analysis |
| ↓ | Import & Templates |
| B | Bulk Create — clipboard parsing modal |
| G | Add Goal |
| S | Add Story |
| P | Process Text (transcript intake) |
| T | Quick Task |

Mini buttons: white bg + `#1976d2` border/text; hover inverts to `#1976d2` bg + white text + `scale(1.1)`.

### Assistant Dock (right panel, width 380px)

Fixed right panel (below toolbar), z-index 1040. Triggered by toolbar "Assistant" button.

- Header: "Assistant" label + approvals count badge, "Close" button
- Quick menu: "Top 3", "Next Calendar", "Replan Day", "Replan Week" buttons
- Message thread: user bubbles (primary blue bg, right-aligned); assistant bubbles (secondary bg, left-aligned); max-width 80%
- Input: `Form.Control` + "Send" button (primary, disabled during send)
- Empty state: `text-muted` placeholder

### Contextual Banners

Rendered below the toolbar, above page content. Each is dismissible and persists to localStorage per-day:

**CheckInBanner:**
- Daily: `Alert variant="info"`, CalendarCheck icon, "Daily check-in" title, "Start" button → `/checkin/daily`
- Weekly: `Alert variant="secondary"`, CalendarDays icon, "Weekly check-in" title, "Review week" button

**SprintClosureBanner:**
- Per overdue sprint. `Alert variant="warning"`, Clock icon (orange `#ff9800`), left-border `4px solid #ff9800`
- "Sprint Overdue: [name]" title, days overdue message
- "Planning Matrix" (BarChart3 icon) + "Close Sprint" (Calendar icon) buttons

**CoachVerdictBanner:**
- Gradient card (green / amber / red based on readiness)
- Icon pill (HeartPulse / Activity / Dumbbell, 34×34, `rgba(white, 0.22)` bg)
- "AI Coach" label + readiness label badge + "Readiness X%" text
- Training text (single line, ellipsis)
- Progress bar (light variant, 6px, `rgba(white, 0.22)` bg)
- "Open coach" link + dismiss button

**PlannerCapacityBanner:** Shown when planner detects over-capacity week.

**SprintMetrics BreadcrumbBanner:** Appears when sprint metrics indicate issues.


---

## Component Library

### KPI Stat Card

The atomic unit of dashboards. Used in Finance, Fitness, Metrics, and Dashboard.

**Structure:**
- Icon (Lucide, 16–20px, domain or status colour) + UPPERCASE label in `--muted`, `letter-spacing: 0.05em`
- Large value: 28px, 700 weight, `--text` colour
- Unit suffix: 13px, 500 weight, `--muted`
- Optional trend badge: Bootstrap `<Badge>` — arrow + percentage, `success` (down/saving) or `danger` (up/overspend)
- Optional sparkline: AreaChart 40px tall, gradient fill, no axes, no animation

Finance variant adds `bg-{variant}-subtle` card background colour-wash per spend category.

### Domain Card (Goal / Story)

Cards representing goals and stories carry domain colour in one of two ways:

**1. Left-edge strip (stories in lists and kanban):**
- 4px solid left border in domain primary
- Card background: 10% domain colour tint

**2. Top strip (goal cards in card view):**
- 4px top strip spanning full width, `border-radius: 14px 14px 0 0`
- Below: card body on `--panel`

Goal card additional content: title (600, 0.95rem), KPI progress bar (domain-coloured fill), description (11px, muted, 120-char truncation), story count.

### Kanban Card (KanbanCardV2)

The most detailed component in the app. Every visual element documented:

**Container:** `border-left: 3px solid {domain-color}`, `border: 1px solid var(--line)`, `border-radius: 10px`, `padding: 12px`, `box-shadow: elevation.2`, drag transition.

**Drag handle:** `GripVertical` (16px), 26×26px, `rgba(59,130,246,0.12)` bg, `rgba(59,130,246,0.85)` text/border, `border-radius: 6px`, `cursor: grab`.

**Header row (12 action icons, all 24×24, gap 4px):**

| Icon | Library | Size | Action | Colour |
|------|---------|------|--------|--------|
| `CalendarPlus` | Lucide | 12px | Create calendar event | muted |
| `Activity` | Lucide | 12px | Open activity stream in sidebar | muted |
| `Wand2` | Lucide | 12px | Story: generate tasks / Task: convert to story | muted |
| `Shuffle` | Lucide | 12px | Story: convert to task | muted |
| `Bot` | Lucide | 12px | Delegate to Hermes AI | colour-coded by status |
| Rank number | text | 11px | Manual priority indicator (1/2/3) | red if flagged, grey otherwise |
| `Clock3` | Lucide | 12px | Defer item | muted (amber if deferred) |
| `Edit3` | Lucide | 12px | Open edit modal | muted |
| `Trash2` | Lucide | 12px | Delete | red |
| `FileText` | Lucide | 13px | Open linked document | muted |
| `Target` | Lucide | 12px | Goal link (bottom of card, stories) | domain colour |
| `BookOpen` | Lucide | 12px | Parent story (bottom of card, tasks) | domain colour |

**Bot (Hermes delegation) colour states:**
- Not delegated: grey/muted
- Queued: `#ffc107` (yellow)
- In progress: `#17a2b8` (teal), opacity 0.5
- Review: `#28a745` (green)
- Failed: `#dc3545` (red)

**Reference label:** 11px, 600 weight, `letter-spacing: 0.02em`, domain colour, ellipsis overflow.

**Title:** 13px, 600 weight, `word-break: break-word`, white-space normal.

**Description (optional, detail level "full"):** 11px, `--muted`, `line-height: 1.35`.

**Quick-edit row (3 inline chips):**
1. Priority select — options: None / Low / Medium / High / Critical. Bootstrap `bg-{variant}` background, 11px, `border-radius: 999px`, custom SVG arrow.
2. Due date input — HTML5 date, `border: 1px var(--line)`, `min-width: 116px`, 11px.
3. Status select — story: Backlog / Planned / In progress / Testing / Done. Task: To do / Doing / Blocked / Done.

**Tags row (optional):** 10px, first 4 tags shown, `+N` for remainder. Tag style: `2px 6px` padding, `border-radius: 999px`, `border: 1px var(--line)`, `rgba(card-rgb, 0.85)` bg.

**Notes section (full detail):** 11px, muted, 140-char truncation, dashed 1px border, `rgba(card-rgb, 0.6)` bg.

**Meta badges row (10px, flex-wrap, gap 6px):**

| Badge | Condition | Colour |
|-------|-----------|--------|
| Manual priority "N Priority" | Story, manually ranked | Red border/tint |
| "Top 3" | flaggedAsTop3 | Gold border `rgba(234,179,8,0.6)`, gold tint bg |
| "Focus Goal" (Target icon) | isFocusAligned | Gold/amber |
| "{N}d overdue" | Days overdue > 0 | Red |
| "Planned {day} {time}" (CalendarClock icon) | Has scheduled block | Blue |
| "Deferred" (Clock3 icon) | Deferred | Amber |
| "{N} pts" | Story, full detail | Muted |
| "Progress {N}%" | Story with progress, full | Muted |
| "Effort {N}" | Task, full | Muted |
| "AI {score}" | Has AI score | Muted, tooltip with reason |
| Bot status label | Delegated | Matches Bot icon colour |
| Hermes review dropdown | Delegation in review | Green tint select |
| "doc" (FileText icon) | Has Hermes document | Green |

**Drag state:** `opacity: 0.4`, `transform: translateY(-2px) rotate(1deg)`, `box-shadow: elevation.drag`.

**Click behaviour:** Opens right detail sidebar (GlobalSidebar) via `showSidebar(item, type)` hook. Keyboard: Enter / Space.

### Sprint Column (KanbanColumnV2)

**Container:** `flex column`, `min-width: 300px`, `flex: 1`, `height: 100%`.

**Header:** `border-bottom: 2px solid {column-color}`, `background: var(--card)`, `border-radius: 8px 8px 0 0`, `padding: 12px`. Title (16px, 600) left, count badge (12px, 600, `{column-color}` bg, white text, `border-radius: 12px`) right.

**Column colours:**
- Backlog: `var(--muted)` (grey)
- In Progress: `var(--brand)` (blue)
- Done: `var(--green)` (`#198754`)

**Body / drop zone:** `flex: 1`, `padding: 8px`, `min-height: 200px`, `overflow-y: auto`. `is-dragged-over` state: background `var(--notion-hover)`, `transition: background-color 0.2s ease`.

### Progress Bar

Height 6–8px, `border-radius: 4px`, Bootstrap variant colour. Used in finance budgets, story progress, theme rings, capacity.

### Heatmap Box

The defining visual pattern of the Habits and Fitness KPI screens.

**Spec:** 13×13px squares, 4px border-radius, 2px gap. Horizontal rows. Label column: 96px (Fitness KPI) or 180px (Habits), 12px grey text.

**Colour scale:**
- Fitness KPI: ≥100% target → `#22c55e`; ≥70% → `#f59e0b`; <70% → `#ef4444`; no data → `#374151`
- Habits: done → `#22c55e`; missed → `#ef4444`

30 boxes visible per row (Fitness); 30-box lookback, 180-day history (Habits).

**Tooltip on hover:** positioned `bottom: 19px`, centred on box. `background: #111827`, `color: #f9fafb`, `border: 1px solid #374151`, 11px, `border-radius: 4px`, no pointer-events.

### Readiness Gauge (SVG)

Used on the AI Coach screen.

- 90×90px SVG, `viewBox="0 0 100 100"`
- Track circle: `cx=50 cy=50 r=40`, `stroke: var(--bs-border-color)`, `stroke-width: 10`, `fill: none`
- Arc circle: same geometry, `stroke: {readiness-color}`, `stroke-linecap: round`, `transform: rotate(-90 50 50)` (12 o'clock start), `stroke-dasharray: {circumference}`, `stroke-dashoffset: {offset}`, `transition: stroke-dashoffset 0.6s ease`
- Centre text: `textAnchor: middle`, `fontSize: 18`, `fontWeight: bold`, `fill: {readiness-color}`, content: `{pct}%`

**Readiness colour logic:**
- Green (≥70%): linear-gradient `#157347 → #1f9d63`, HeartPulse icon
- Amber (40–69%): linear-gradient `#b58105 → #d39e00`, Activity icon
- Red (<40%): linear-gradient `#b02a37 → #d63344`, Dumbbell icon

### Theme Donut Ring

Used in Metrics Overview for weekly theme allocation progress.

- Recharts PieChart, 64px height
- `innerRadius=24`, `outerRadius=32`, `startAngle=90`, `endAngle=-270`
- Two cells: domain colour (filled) + `#374151` dark / `#e5e7eb` light (empty)
- `strokeWidth=0`, `isAnimationActive=false`
- Percentage label: 16px, 700 weight, domain colour, `marginTop: -4px`
- Domain label: 10px, 600, uppercase, muted

### Sport Bar Card

Used in Metrics/Fitness for per-sport YTD progress.

- Recharts BarChart, 52px height, no axes, no labels
- Bar fill = sport colour, `radius={[3,3,0,0]}`
- Custom tooltip: 11px, matches card bg, `border-radius: 6px`
- Header: sport icon + name + "YTD" label + YTD distance (18px, 700, sport colour)

### Sparkline (Area Chart)

Used in KPI stat cards.

- Recharts AreaChart, 40px height, no axes
- `<defs>` → `<linearGradient>`: 0% = `stopColor` at 0.25 opacity, 100% = 0 opacity
- Area: `type="monotone"`, `strokeWidth=2`, `dot=false`, `isAnimationActive=false`

### Buttons

All buttons: `border-radius: 6px`, `font-weight: 500`, `transition: 150ms ease`.

- **Primary:** `--brand` bg, white text → hover: indigo gradient + `translateY(-2px)` + glow shadow `rgba(99,102,241,0.4)`
- **Outline-secondary:** transparent bg, `--line` border
- **Outline-danger:** used for destructive secondary actions (Delete in modal footer)
- **Danger:** `--urgency-critical` bg, white text — used for confirmed destructive actions
- **Link variant:** transparent, no border — used for icon-only actions on cards
- **FAB (Material):** `#1976d2` bg, 56px circle
- **FAB mini:** white bg, `#1976d2` border/text — hover inverts

Mobile: minimum 44px height for tap target compliance (36px on tablet).

### Badges & Pills

- **Pill (full-round):** `border-radius: 999px`, 10px text, 600 weight — domain tags, status chips, meta badges, sprint status
- **Square badge:** `border-radius: 4px` — Bootstrap `<Badge>`, counts, trends
- **Top-3 badge:** `border: rgba(234,179,8,0.6)`, `background: rgba(234,179,8,0.12)`, `color: rgba(202,138,4,0.95)`
- **Focus-aligned badge:** gold/amber, Target icon prefix
- **Delegation status badge:** colour matches Bot icon state

### Form Controls

- Input/select: `border-radius: 6px`, `padding: 10px 16px`, `border: 1px solid var(--line)`, `background: var(--panel)`, `color: var(--text)`
- Focus: brand border + `box-shadow: 0 0 0 3px rgba(99,102,241,0.1)`
- Mobile: `font-size: 16px` minimum, `min-height: 44px`
- `Form.Range` for sliders (LLM personality, confidence)
- `TagInput` custom component for tag management

### Modals

All modals: `border-radius: 12px`, `border: 1px solid var(--line)`, `box-shadow: elevation.modal`, `background: var(--panel)`. Header has `closeButton`. Footer: Cancel (secondary) left, primary action right.

**Standard modal footer pattern:**
```
[Cancel]  [Primary Action]
```

**Destructive actions:** `variant="outline-danger"` (Delete in footer) or separate `variant="danger"` button. Always require `ConfirmDialog` for irreversible operations.

**Loading state:** `<Spinner>` + disabled buttons + text update ("Saving…", "Creating…"). Auto-close on success after 1500ms.

**Mobile responsive modals:** `fullscreen="sm-down"` on AssistantChat and ResearchDoc.

### Tables

Bootstrap `<Table>` with `size="sm"` and `responsive`. Headers: 14px, 600 weight, `var(--card)` background. Cells: `padding: 0.75rem`. All use `var(--text)` and `var(--line)` for border colours in dark mode.

Inline editing: double-click cell → `Form.Control`, click outside or Enter to save. Type-specific inputs (text, select, date, number). Drag handle column (left) with `GripVertical` icon for row reordering.

### Charts (Recharts & ECharts)

**Recharts:** LineChart, AreaChart, BarChart, PieChart. Used in Fitness metrics, Journal insights, Sprint burndown, Capacity dashboard.

**ECharts (echarts-for-react):** Used in Finance Advanced dashboard for treemaps, sankey diagrams, and richer analytics.

All chart tooltips should match card background and border colours: `contentStyle: { background: var(--card), border: '1px solid var(--line)', borderRadius: '6px', fontSize: '11px' }`.

Chart grid lines: `rgba(45,55,72,1)` dark / `rgba(0,0,0,0.08)` light. Axis labels: 11px, `var(--muted)`.


---

## Modal Inventory

Every modal in the application documented:

### AddGoalModal

**Trigger:** "Add Goal" button / FAB "G". **Size:** `lg`.

**Fields:** Title (required), Description, Goal Type (Standalone/Umbrella/Milestone), Parent Goal, Cost Type, Estimated Cost, Linked Monzo Pot, Theme, Size (XS–XL), Confidence slider, Start/End dates, Status, Priority, Hours to Master, KPIs (dynamic add/remove list), Dashboard banner toggle, Persona.

**Footer:** Cancel → Create Goal (primary, disabled until title filled, auto-close 1500ms on success).

### AddStoryModal

**Trigger:** "Add Story" button / FAB "S". **Size:** `lg`.

**Fields:** Title (required), Description, Source URL, Persona toggle, Tags (TagInput), Goal link (leaf-goal resolution), Sprint assignment, Priority, Due Date + Time, Time of Day bucket, Story Points.

**Smart features:** Focus goal alignment check; sprint alignment evaluation (warn/strict mode); auto-resolution to leaf goals; status alerts.

### EditGoalModal

**Trigger:** Goal row click, "Edit" button in sidebar. **Size:** `lg`.

**Tabs:** Basic Info, Stories, Tasks, KPIs, Activity.

**Basic Info fields:** Title, Description, URL, Document Link (Drive picker), Theme (autocomplete), Status, Priority (1–5), Size (XS/S/M/L/XL), Confidence slider, Tags, Start Date, End Date, Target Year, Estimated Cost, Cost Type, Linked Pot, Auto Create Pot checkbox, Dashboard banner toggle.

**KPI tab:** Simple mode (designer form) / Advanced mode (structured JSON editor).

**Stories tab:** ModernStoriesTable embedded, inline edit + Add Story button.

**Tasks tab:** ModernTaskTable embedded.

**Activity tab:** ActivityStreamPanel with real-time changelog.

**Header icons:** `Wand2` (AI generation), `Activity` (stream), `Calendar` (composer), `Clock3` (defer), `Shuffle` (sprint reassign), `Trash2` (delete, danger).

**Footer:** Cancel → Delete (outline-danger) → Save (primary).

### EditStoryModal

**Trigger:** Story card click, sidebar "Open full editor". **Size:** `lg`.

**Tabs:** Basic Info, Points & Progress, Sprint & Timing, Tasks, Activity.

**Basic Info fields:** Title, Description, URL, Document Link, Goal (searchable dropdown with hierarchy), Priority, Status, Theme, Acceptance Criteria, Tags.

**Points tab:** Story Points, Progress % (slider), Points Remaining.

**Sprint tab:** Sprint, Due Date, Due Time, Time of Day, Sprint Alignment indicator.

**Tasks tab:** ModernTaskTable + "Generate Tasks" button (`Wand2`).

**Header icons:** `Activity`, `CalendarPlus`, `Clock3`, `Shuffle`, `Wand2`, `Trash2` (danger).

### EditTaskModal

**Trigger:** Task row click, kanban card "Edit". **Size:** `lg`.

**Tabs:** Basic Info, Points & Timing, Recurrence, Calendar Integration, Activity.

**Basic Info fields:** Title, Description, URL, Document Link, Story link (searchable), Goal (resolved), Type (task/read/watch/chore/routine/habit), Status, Priority, Tags.

**Timing tab:** Points, Due Date, Due Time, Time of Day, Sprint.

**Recurrence tab:** Frequency (daily/weekly/monthly/yearly/none), Interval, Days of Week (multi-select), Last Done At, Snoozed Until.

**Calendar tab:** `NewCalendarEventModal` integration.

**Header icons:** `Activity`, `CalendarPlus`, `Clock3`, `Trash2` (danger).

### EntityDetailModal

**Trigger:** Quick-view click. **Type:** Polymorphic (goal/story/task). **Size:** `lg`.

**Content:** Read-only detail view + activity stream. **Tabs:** Details, Activity.

**Actions:** Quick Complete (primary) + Open in sidebar (outline-secondary).

### BulkCreateModal

**Trigger:** FAB "B" / bulk actions. **Size:** `lg`.

**Item type selector** (radio buttons): Stories / Tasks / Goals.

**Main input:** Large textarea (8 rows), one item per line, "Paste from clipboard" button.

**Dynamic options section (varies by type):**
- Goals: Theme selector, auto-generate stories checkbox
- Stories: Goal link, Priority, auto-acceptance-criteria checkbox
- Tasks: Story link, Goal link, Theme, Priority, Points, auto-enhance checkbox

**Results:** ListGroup with success/error badges per item. Spinner during creation.

### DeferItemModal

**Trigger:** Clock3 icon on kanban card or in edit modals. **Size:** Default (centred).

**Content:** Item title + context. Smart suggestions (top 3 + collapsible "more"), rationale per option. Custom date picker (radio + input).

**Suggestion heuristics:** sprint-aware windows, focus goal pressure, recurring task quick-move, capacity-based.

**Footer:** Cancel → Apply move/defer (primary).

### AssistantChatModal

**Size:** `lg`, `fullscreen="sm-down"`. **Trigger:** "Assistant" in sidebar or toolbar.

**Content:** Chat message stream + quick action buttons ("Top 3", "Next Calendar", "Replan Day", "Replan Week") + text input.

### GoalChatModal

**Size:** `lg`. **Trigger:** MessageSquare icon on goal sidebar. Real-time Firestore message subscription.

### GoalPlanningWorkspaceModal

**Size:** Custom `modal-90w` (90% viewport width). **Trigger:** "Planning workspace" on goal row.

**Content:** Embedded iframe of UnifiedPlannerPage. ButtonGroup for view toggle (Gantt / Year / Quarter / Sprint).

### FitnessKPISetupModal

**Trigger:** Fitness goal KPI setup. **Content:** 8 KPI templates (steps, running, cycling, swimming, workout count, custom). Template cards with "Select", selected list with remove. **Footer:** Cancel → Save KPIs (primary, shows count).

### ImportExportModal / ImportModal

**Size:** `lg`. Tabs for Import / Export. File upload (XLSX) + preview table. Template download. Success/error with item count.

### IntentBrokerModal

**Size:** `lg`. **Trigger:** FAB "A". Multi-step workflow: load prompts → select prompt → enter vision → run matching → create goal from proposal.

### LinkGoalModal

**Size:** `lg`. **Trigger:** "Link to parent" in goal detail. Searchable goal list, radio selection. Prevents circular references.

### ResearchDocModal

**Size:** `lg`, `fullscreen="sm-down"`. **Trigger:** Research button on goal/story. Provider dropdown (Gemini/OpenAI), model selector, Re-run and Generate buttons.

### TranscriptIntakeModal

**Size:** `lg`. **Trigger:** FAB "P". Large textarea (12 rows) for transcripts, task lists, notes, URLs. **Footer:** Cancel → Process Text (primary).

### ConfirmSprintChangesModal

**Size:** `lg`. **Trigger:** Goal timeline change affecting sprint stories. Warning alert (AlertTriangle), story table with badge-coded outcomes (No change / Will move / Manual review). **Footer:** Cancel → Confirm (danger).

### NewCalendarEventModal

**Trigger:** CalendarPlus icon on kanban card, or from planner. **Fields:** Title, Date/Time (start + end), Theme, Category, Flexibility (soft/hard), Rationale, Sync to Google checkbox, Story/Task link, Recurrence (none/daily/weekly with days + until date), AI metadata (read-only). **Footer:** Cancel → Save (primary, spinner during save).

### ConfirmDialog

Reusable. Props: title, message, button text, variant (danger/primary/warning), callbacks. **Footer:** Cancel → Confirm (variant-driven).

### FocusGoalWizard

**7-step wizard modal:**
1. Vision — free-text AI matching input
2. Select Goals — multi-select searchable list
3. Goal Types — per-goal: story-based vs. calendar-based
4. Timeframe — sprint/quarter/year, custom end date
5. Milestones — draft leaf goals for parent goals
6. Review — summary of planned changes
7. Confirm — final save

Step indicator: "Step N of 7", CheckCircle (Lucide, green) for completed steps, AlertCircle (amber) for warnings.


---

## Screen Reference

### `/dashboard` — Main Dashboard

**Purpose:** Aggregate critical life signals into one customisable view. Replace the need to visit five screens to understand the day.

**Layout:** Drag-and-drop widget grid (`react-beautiful-dnd`). Widgets are `dashboard-widget-shell` containers wrapping Bootstrap `Card` components. Widget resize handles on hover (hidden on mobile). Widgets fill remaining height via `flex: 1 1 auto; min-height: 0; overflow: auto`.

**Widgets (configurable, default set):**
- Active sprint status (story points remaining, days left, progress bar)
- Top-3 goals progress (GoalCard, domain colour, progress bar)
- Today's plan summary (DailyPlanSummaryCard — alert banner, stat badges, "Open Daily Plan" button)
- Habit streak indicators (compact heatmap rows)
- Finance snapshot (mandatory vs. discretionary, budget progress bars)
- Fitness readiness badge (green/amber/red from AI coach, links to `/ai-coach`)
- Calendar strip (next 3 events from Google Calendar)
- AI criticality score distribution (bar chart, 0–100 range)
- Journal mood snapshot (last 7 days sentiment trend)
- Sprint kanban mini-view (embedded KanbanBoardV2 at compact detail level)

**Stat cards (top row):** `.dashboard-stats` grid, `auto-fit minmax(250px, 1fr)`, 20px gap. Each: `.stat-card`, `border-radius: 8px`, `padding: 20px`, `text-align: center`, `border: 1px solid var(--bs-border-color)`.

**Design intent:** Mission control. Dense but legible. Top row = highest urgency. Nothing decorative.

**Known issues:** Widget reorder persists via localStorage (not Firestore). Some widgets use Bootstrap `shadow-sm border-0`, others use custom elevation — inconsistent.

---

### `/mobile` — Mobile Home

**Purpose:** Stripped-down home for on-the-go use. Today's tasks, overdue items, check-in prompt.

**Layout:** Single column. Large tap targets (44px minimum). Bottom-safe-area aware. No widget grid.

**Content:** Priority task list, overdue count alert, "Check-in" CTA button, quick "Done" toggles.

---

### `/sprints/kanban` — Sprint Kanban Board

**Purpose:** Primary task execution view. All tasks in active sprint arranged in 3 status columns.

**Header:** "Sprint Kanban" (28px, 700) + persona badge. Right-side controls: sidebar toggle, theme filter, goal filter, show descriptions, show notes, show completed, AI-scored only, delegated-only, due date filter, focus-only, sort dropdown (Priority stack / AI score / Due date / Priority), detail level (Full / Compact / Minimal), fullscreen toggle.

**Sprint info row (when sprint selected):** Sprint name, reference badge, PlanActionBar, Delta Replan button (RefreshCw, 14px), Full Replan button (Sparkles, 14px), spinner during replan.

**Sprint metrics (4-column grid):**
1. Stories Done: `{completed}/{total}`, progress badge (success)
2. Tasks Completed: `{completed}/{total}`, progress badge (primary)
3. Story Points: `{completed}/{total}`, progress badge (secondary)
4. Sprint Duration: sprint name + days

**Board (KanbanBoardV2):** 3 columns (Backlog / In Progress / Done), each a `KanbanColumnV2`. See component documentation above. Cards are `KanbanCardV2` at the specified detail level.

**Modals:** EditStoryModal, EditTaskModal.

**Drag-and-drop:** Uses `@atlaskit/pragmatic-drag-and-drop`. Drop updates Firestore status and logs to activity stream.

---

### `/sprints/management` — Sprint Planning

**Purpose:** Full sprint lifecycle management. Create sprints, assign stories, view burndown, run retrospectives.

**Tabs:** Overview | Board | Table | Burndown | Retrospective | History.

**Overview tab:** SprintMetricsPanel (4-column KPI grid), goal/theme breakdown charts.

**Board tab:** SprintKanbanPageV2 embedded.

**Table tab:** ModernSprintsTable — 11 columns: Sprint (name + ref + objective), Status (dropdown), Alignment (strict/warn badge), Start, End, Progress (bar), Goals count, Stories count, Tasks count, Points, Actions (Edit/Delete/Close/Metrics).

**Burndown tab:** LineChart (story points remaining over sprint days), velocity bar chart (last 5 sprints).

**Retrospective tab:** SprintRetrospective — computed metrics (completion rates, velocity) + LLM summary (Generate button + Spinner) + manual notes textarea + Approve toggle.

**History tab:** SprintHistoryTable.

---

### `/sprints/capacity` — Capacity Dashboard

**Purpose:** Show capacity planning across sprints or next week.

**Layout:** Sprint selector + "Next Week" option at top. Two charts below:
1. Goal Breakdown BarChart — Y-axis: hours, series: Allocated (blue) vs Utilised (teal) per goal
2. Theme Schedule BarChart — Y-axis: hours, scheduled time per theme (purple)

**Capacity colour logic:** ≤80% → green, 80–100% → warning, >100% → danger.

**Data source:** Cloud function `calculateSprintCapacity` / `calculateNextWeekCapacity`.

---

### `/sprints/retrospective` — Sprint Retrospective

**Purpose:** Post-sprint review. Auto-generates LLM summary from completion data. Captures manual notes and approval.

**Fields:** LLM summary (auto-generated, read-only), user notes (textarea), Approved toggle.

**Computed display:** totalStories, completedStories, completionRate, totalTasks, completedTasks, totalPoints, completedPoints, velocityPoints, goalsInScope list.

---

### `/goals` — Goals Management

**Purpose:** Full goal inventory with filtering, search, and creation.

**Header:** Title "Goals", view toggle (List/Cards), Add Goal button.

**Dashboard cards (6 cards):** Total Goals, Active, Done, Paused, Total Estimated Cost, Total Saved in Linked Pots.

**Filter bar:** Search Goals (InputGroup), Status dropdown, Theme multi-select, Year multi-select, Sprint selector, KPI Scope (Sprint/Year/Goal), Clear Filters, show descriptions toggle, "only goals with cost and no pot" toggle, "only active focus goals" toggle.

**Main content:**
- **Card view (GoalsCardView):** `auto-fit minmax(220px, 1fr)` grid. Each card: theme top-strip (4px), title (13px, 600), domain badge, KPI progress bar, description (120-char), story count.
- **List view (ModernGoalsTable):** Sortable drag-and-drop table. Columns: Ref, Title, Cost Type, Est Cost, Linked Pot, Theme, Status, Stories count, In Sprint count, KPI Status, KPI Progress, Start Date, End Date, Target Year. Expandable rows show linked stories.

**Right sidebar:** Opens on goal card/row click showing full GoalDetail.

---

### `/goals/:id` — Goal Detail

Renders GoalsManagement in background + EditGoalModal overlay for deep-linked goal. Loading state: spinner "Loading goal…". Not-found: Alert with ref.

---

### `/focus-goals` — Focus Goals Hub

**Purpose:** Manage focus periods — select top 3 goals to concentrate on with a countdown.

**Header:** "Focus Goals" + "New Focus Goal" button (Plus icon, primary).

**Active focus goals display (per active goal):**
- `FocusGoalCountdownBanner`: title, end date + countdown, leaf goal list with checkmarks, progress bar, Edit/Delete actions, KPI Designer button

**Alerts:** Pending Monzo pot links with Retry button; unaligned stories in active sprint.

**FocusGoalWizard** (7-step modal, see Modal Inventory above).

---

### `/stories` — Stories Management

**Purpose:** Stories inventory across all goals, filterable by sprint, theme, status.

**Header:** Title, view toggle (List/Cards), Add Story button.

**Dashboard cards:** Total Stories, Backlog, In Progress, Done.

**Filter bar:** Search, Status (All/Backlog/Active/Done), Goal, Priority, Sprint (+ No sprint option), Tags.

**Main content:**
- **Card view:** Kanban-style cards with left domain-colour border, status badge, points badge
- **List view (ModernStoriesTable):** Drag-and-drop table, columns: Ref, Title, Description, URL, Goal, Theme, Status, Priority, Points, Sprint, Due Date, Tags, Data Quality. Expandable rows showing linked tasks (ModernTaskTable).

**Story card inline edits:** Priority select (chip), due date (chip), status select (chip).

---

### `/stories/:id` — Story Detail

Renders StoriesManagement + EditStoryModal overlay. Same pattern as Goal Detail.

---

### `/tasks` — Tasks

**Purpose:** Task inventory with full filtering and inline editing.

**Dashboard cards:** Total Tasks, Planned, In Progress, Done.

**Filter bar:** Search, Status, Sprint, Theme, Type (task/read/watch/chore/routine/habit), Data quality flags (missing link, missing points, missing description), Due date (All/Today only).

**List view (ModernTaskTable):** Sortable table. Columns: Ref, Title, Description, URL, Story, Goal, Points, Status, Priority, Type, Sprint, Due Date, Tags, Theme, Data Quality indicator. Background highlight (`MISSING_INFO_CELL_BG`) for incomplete data cells.

---

### `/checkin/daily` — Daily Check-in

**Purpose:** Structured reflection on yesterday/today. Captures completion of planned items, health data, wins and blockers.

**Layout:** Date picker (defaults to yesterday if before 8pm, today otherwise). Mode tabs: review / health / notes.

**Item display per scheduled item:**
- Title + theme badge
- Completion checkbox (Done)
- Progress % input (stories, non-routine tasks)
- Last comment + timestamp
- Overdue indicator (red)
- Note button

**Health data section (collapsible):**
- Sleep (hours), Steps, Distance (km), Workout minutes
- Calories, Protein, Fat, Carbs (macro tracking)
- Weight (kg), Body Fat (%)
- Quick save with confirmation alert

---

### `/checkin/weekly` — Weekly Check-in

**Purpose:** Week-in-review + next-week planning.

**Modes:** Reflect | Plan.

**Reflect mode:** Metrics display — themes breakdown, routines, stories, tasks (planned vs completed), spend (3/7 day). Reflection textareas: Went well, To improve, Blockers, Next focus.

**Plan mode:** Capacity review checkbox + WeeklyPlannerSurface component.

---

### `/finance/dashboard` — Finance Hub

The most data-dense screen in the app. 5 tabs.

**Overview tab:**

Four KPI cards (top row, `lg={3} md={6}`): Mandatory Spend, Optional Spend, Savings & Pots, Income Recorded. Each: `shadow-sm border-0 h-100`. Large `display-6` value. Delta badge (▲▼ in danger/success). Subtitle (text-muted, 14px).

Three analytics cards (second row): Budgets vs Actual (progress bars per budget, height 8px, danger when over), Merchant Hotspots (table: merchant, amount, category), Projections panel.

Transaction table (third row, `lg={8}`): `Table responsive hover size="sm"`. Columns: Date, Description, Amount (right-aligned, monospace), Bucket (badge: danger=Mandatory, warning=Discretionary, info=Savings, success=Income), Category (badge), Label, Action.

Classification queue (third row, `lg={4}`): pending unclassified transactions with default category suggestion.

Goal/Pot alignment (fourth row, `lg={6}`): Table — Goal, Theme, Estimated Cost, Pot Balance, Progress %. Funded % as ProgressBar.

Theme Progress (`lg={5}`): funded percentage and monthly trends.

**Spend Analytics tab:** ECharts treemap and sankey diagrams. Merchant category distribution. Time-series spend trend (30/60/90 day selector).

**Transactions tab:** Full sortable table with categorisation and classification queue.

**Goals & Pots tab:** `GoalPotLinking` — maps goals to Monzo pots. Progress bars for funding.

**Merchant Management tab:** Admin table mapping merchant names to categories. Inline edit.

**Design intent:** Red = overspend always. Green = surplus always. No neutral greys for financial direction — every delta communicates instantly.

---

### `/finance/flow` — Finance Flow Diagram

**Purpose:** Sankey/flow diagram showing income → category → spending bucket. Understand structural spend patterns.

**Chart:** ECharts Sankey. Nodes: income sources → categories → spend buckets. Link widths proportional to amount.

---

### `/finance/pots` — Pots Board

**Purpose:** Visual board of Monzo savings pots. Balances, targets, goal linkage.

**Layout:** Card grid. Each pot: balance (large, monospace), target, progress bar, linked goal (if any), pot name.

---

### `/finance/budgets` — Budgets

**Purpose:** Create and track spending budgets per category.

---

### `/finance/transactions` — Transactions List

**Purpose:** Full transaction history with filtering, categorisation, and analysis.

**Filters:** Date range, bucket, category, merchant, search. Export to CSV.

---

### `/metrics` — Advanced Overview

**Purpose:** Cross-domain KPI dashboard combining fitness, goal progress, theme rings, and finance.

**Layout:**
- Top: `MetricCard` grid (`auto-fit minmax(200px, 1fr)`)
- Middle: Theme donut rings row (one per active domain)
- Bottom: Sport cards row with bar sparklines

**Range selector:** 7d / 30d / 90d toggle (affects all charts).

**MetricCard content:** Icon + UPPERCASE label (muted) + large value (28px, 700) + unit + optional trend sparkline (40px AreaChart).

---

### `/metrics/progress` — Theme Progress Dashboard

**Purpose:** Quarterly and annual view of goal-theme progress. How much of each domain's planned work has been completed.

**Layout:** Per-domain progress bars with historical trend lines.

---

### `/dashboard/habit-tracking` — Habits & Chores Dashboard

**Purpose:** All habits and daily chores with historical heatmaps, current streaks, and quick-complete checklist.

**Habits section:**
- Header: streak summary, completion rate, next due count
- One heatmap row per habit: label (180px, 12px grey) + 30 boxes + summary text below (streak count, last completion)
- Tooltip on hover (see Heatmap Box component docs)

**Chores checklist section:**
- Grouped by frequency (daily, weekly, monthly)
- Checkbox rows with domain badge
- Last done timestamp
- "Mark done" button

**Streak counter logic:** `lastDoneAt` tracked per habit task. Streak = consecutive days/occurrences.

---

### `/ai-coach` — AI Fitness Coach

**Purpose:** Daily readiness verdict and training recommendations from HRV + sleep data.

**Layout:**
- Top-left: `ReadinessGauge` (90×90px SVG) — primary focal point
- Beside gauge: HRV (ms) + Sleep (hours) key-value display
- Readiness label badge: `bg-success` / `bg-warning text-dark` / `bg-danger`
- Training phase card: phase name, week number, description
- Weekly workout targets: progress bars per activity type (run, cycle, strength)
- Macro nutrition bar: horizontal segmented bar (protein/carb/fat)
- AI recommendations: bullet list based on readiness + recent load

**Gauge colour logic:** see Readiness Gauge component docs above.

**Design intent:** Gauge is the hero element. User reads readiness in <2 seconds. Everything else is supporting context.

---

### `/fitness` — Workouts Dashboard

**Purpose:** Fitness activity overview. Workout log, PR tracking, Strava integration.

**Layout:**
- FitnessKpiGrid at top: horizontal heatmap rows per KPI (weekly km, sessions, longest run, etc.)
- Workout log table: Date, Activity Type, Distance, Duration, HR, Notes
- PR section: personal records per distance/activity, date achieved

**Heatmap colours:** See Heatmap Box component docs. `#374151` = no data.

---

### `/planner` — Unified Planner

**Purpose:** Multi-level planning via `?level=` URL parameter. One entry point, six views.

**Views:**

**`?level=calendar`** — React-Big-Calendar integration. Month/week/day/agenda views. `dateFnsLocalizer` with en-GB, Monday start. Events: calendar_blocks (semi-transparent theme colour), scheduled_instances (primary blue), external Google Calendar events (lighter blue). Red current-time indicator. Drag-and-drop to reschedule.

**`?level=week`** — WeeklyPlannerSurface. 4–7 day columns, each split into: Morning (9:00) / Afternoon (14:00) / Evening (19:00) / Anytime buckets. Items rendered as `PlannerWorkCard`. Capacity summary per day. Theme allocation bars. Filter bar: goal multi-select, theme multi-select, Top 3/AI scored/Focus toggles.

**`?level=sprint`** — SprintPlanningMatrix. Multi-sprint columns, stories/tasks dragged between sprints. Capacity indicators.

**`?level=quarter`** / **`?level=year`** — UnifiedGoalPlannerLevels. Timeline visualisations.

**`?level=gantt`** — GoalRoadmapV6. See Gantt chart section below.

**Common planner interactions:**
- Mark item done (✓ button) → updates scheduled_instance or task/story
- Move item → date + bucket picker modal
- Defer → DeferItemModal
- Create block → NewCalendarEventModal
- Drag goal on gantt → reschedule (Firestore update)
- Theme allocation → WeeklyThemePlanner grid editor

---

### `/planner?level=gantt` — Gantt / Goal Roadmap (GoalRoadmapV6)

**Purpose:** Enterprise-grade roadmap with story point progress, budget tracking, milestone markers.

**Header controls:** Search, Theme multi-select, Year range selector, toggles (story goals only / focus only / group by theme), sort (start/end date), zoom slider (5–100%), Clear, Fit All, Fullscreen.

**Canvas:**
- Theme group headers (coloured, sticky): if group-by-theme enabled
- Goal lanes: title + parent path, progress bars (story points: blue, budget: red/green), action buttons (Edit, Schedule, Generate stories, Open stream)
- Milestone markers: `Star` icon in theme colour, above timeline, for goals <14 days duration
- Zoom: Dynamic px/ms conversion. At zoom 45–75%, progress bars visible. At extremes, hidden.

**Drag interactions:**
- Drag bar: moves start + end proportionally
- Drag left edge: adjust start only
- Drag right edge: adjust end only
- Shift+drag: snaps to week boundaries
- Drop on theme lane: changes goal theme

**CSS classes:** `.grv6-task-shell`, `.grv6-task`, `.grv6-milestone-shell`, `.grv6-milestone`, `.grv6-progress-bars`, `.grv6-progress-fill.story` (blue), `.grv6-progress-fill.budget` (green/red), `.grv6-actions`.

---

### `/planner/weekly` — Weekly Theme Planner (WeeklyThemePlanner)

**Purpose:** Visual time-grid editor for weekly theme allocations. Drag to create, move, and resize time blocks.

**Layout:** 30-minute rows (4:30am–10pm), 7 day columns. Each cell coloured by theme allocation.

**Interactions:**
- Click + drag: create new allocation (sets start/end time)
- Drag existing: move allocation
- Drag border: resize
- Right-click: delete
- Merge: adjacent same-theme allocations auto-merge

**Controls:** Fitness toggle, Smart/Strict planning mode, Save Week Plan, Template actions (copy/seed/reset/save-as-default), Apply Planner Blocks Now, Replan Around Calendar, Full Replan, Week navigation (8-week dropdown).

---

### `/daily-plan` — Daily Plan Page

**Purpose:** Today's execution view. Time-blocked calendar, due-today task list, chores.

**Layout (4-column desktop):**
- Summary (24%): DailyPlanSummaryCard — alert banner (warning if review items exist), stat badges (Open/Review/Overdue/Focus counts), "Open Daily Plan" button
- Calendar (31%): time-blocked view of today
- Due Today (25%): task list filtered to today's due date
- Chores (20%): daily chore checklist

**Mode toggles within daily plan content:**
- Today (list mode, checkboxes)
- Schedule (bucket layout: morning/afternoon/evening/anytime, KanbanCardV2 cards)
- Triage (review candidates with move/defer recommendations, Sparkles icon for AI suggestions)
- Check-in (inline CheckInDaily component)

**Filter pills:** Tasks, Stories, Chores, Top 3, Focus, Review.

**Item data shown (PlannerWorkCard):**
- Title (fw-semibold, truncated), left-border 4px (domain or kind colour)
- Priority pill, status select (read-only or editable)
- Top 3 badge, Focus badge (indigo), Deferred badge (amber)
- Scheduled block label (blue, CalendarClock icon)
- Due date, Type, AI score
- Goal/story link (Target or BookOpen icon)
- Action buttons: Note, Edit, Schedule, Move, Defer, Accept recommendation

---

### `/journals` — Journal Management

**Purpose:** Long-form personal journal with AI-powered insights.

**List view:** Entry cards — date heading, sentiment badge (positive/negative/neutral/mixed), Google Doc status badge, one-line summary (highlighted), structured entry (prose, pre-wrap), advice section, metadata.

**Entry detail:** Edit modal (oneLineSummary, structuredEntry, advice textareas). Linked Stories/Tasks sections. Activity log.

---

### `/journals/insights` — Journal Insights

**Purpose:** Analytics over journal entries.

**Visualisations:**
- LineChart: 14-day trend — mood, stress, energy lines
- PieChart: sentiment distribution (8-colour PIE_COLORS palette)

**Metric cards:** Mood, Stress, Energy — each with trend arrow (ArrowUpRight / ArrowDownRight), delta, and accent colour (`BrainCircuit` / `Flame` / `HeartPulse` icons).

**Metric card style:** `border-radius: 16px`, `border: 1px solid {accent}22`, gradient bg `{accent}12 → rgba(255,255,255,0.98)`, `padding: 16px`.

---

### `/games-backlog` / `/books-backlog` / `/shows-backlog` — Entertainment Backlogs

**Purpose:** Tracked queues for media consumption integrated with Steam, Hardcover, Trakt.

**Status states:** wishlist → active → completed → dropped.

**Views:** List (Table) or Card (grid with cover images).

**Game card:** Steam appid image, playtime (hrs), rating stars (1–5, ButtonGroup: `variant="warning"` filled, `variant="outline-secondary"` empty), "Convert to Story" button.

**Book card:** Cover image, authors, publication year, genres, status, rating.

**Show card:** Trakt slug, year, network, runtime, last watched timestamp.

**Conversion modal (for each type):** Goal selector, Sprint selector, Target date, Rating. Creates a Story with `points: 3`, `tags: ['{type}']`, embedded metadata.

---

### `/canvas` — Visual Canvas

**Purpose:** Freeform SVG mind-map for goal hierarchy visualisation.

**Layout modes:**
- Swimlane (left-to-right): 240px column width, 80px column gap, bezier connectors
- Tree (top-down): 220px node width, orthogonal elbow connectors

**Column types (with colours):**
- Focus: `#6366f1` (indigo)
- Umbrella: `#0ea5e9` (cyan)
- Phase: `#10b981` (emerald)
- Story: `#f59e0b` (amber)
- Task: `#6b7280` (grey)

**Controls:** ZoomIn, ZoomOut, RotateCcw, Link2 / Link2Off (link mode), Filter dropdown, GitBranch / Rows3 (layout toggle).

---

### `/travel` — Travel Map

**Purpose:** Interactive map of visited and planned locations.

**Library:** MapLibre GL. Tiles: OpenStreetMap. Initial: `center: [0, 20]`, `zoom: 1.2`.

**Marker colours:**
- UNVISITED: `#111827`
- BUCKET_LIST: `#facc15`
- STORY_CREATED: `#16a34a`
- COMPLETED: `#2563eb`

**Interactions:** Right-click context menu, drag goals from sidebar to map, geocoding search (Nominatim), double-click to toggle status, LLM-assisted goal matching.

---

### `/settings` — Settings

**Purpose:** Global configuration. Tab-based: Profile → System Preferences, AI → LLM Settings, Integrations, Finance, Notifications → Reminders, Privacy → Diagnostics, Developer → Database.

**System Preferences tab:** AI story generation prompt, timezone/location (OpenStreetMap geocoding), fitness targets (weight, body fat, steps, distance, workout %, macros, parkrun ID), automation controls, theme mode selector.

**Finance tab:** Monzo integration card (connect/reconnect, account selector, sync button).

**Reminders tab:** iOS Shortcuts integration — user ID, push/pull URLs, secrets, curl examples, Jellycuts code.

**Database tab:** Migration stats cards, migration progress bar, Migrate button.

**Themes tab:** Global theme grid (16 themes), colour swatches, Reset to Defaults, Save Themes, per-theme edit modal (name + color picker + preview).

**Diagnostics tab:** AI & Scheduler diagnostic log (max-height 360px, scrollable), Download JSON, Clear Log.

---

### `/settings/ai` — LLM Settings

**Tabs:** Provider & Model | Personality | Prompts | Story & KPI | Per Feature.

**Provider & Model:** 3 provider cards (Gemini / OpenAI / Anthropic). Per-provider API key (password + toggle + refresh), Model radio buttons (2-col grid, with tier badge, context badge, description). Test Connection button with latency display.

**Personality:** 6 sliders (Intelligence, Humour, Sarcasm, Directness, Warmth, Verbosity), 0–10 range, 2-col layout. Current value badge per slider. Reset to defaults link. Info: "5 = neutral."

**Per Feature table:** Columns: Feature (30%) | Provider override (22%) | Model override | Clear (5%). Each feature row: label (fw-semibold) + description (muted, 75%) + tip (info, 70%). Provider dropdown + Model text input + Clear button (✕, link, text-muted).

---

### `/settings/integrations` — Integration Settings

**Tabs:** Calendar (📅), Monzo (🏦), Strava (🏃), Hardcover (📚), YouTube (▶️), Trakt (🎬), Steam (🎮), Telegram (✈️).

**Google Calendar card:** Last sync, stored event count, Connect/Reconnect, Test Doc Access, Fetch Events, upcoming events table (When + Summary). Default Journal Doc URL input. Journal prompt override textarea. CalendarSyncManager in advanced collapse.

**Monzo card:** Status badge, sync timestamps, mandatory spend + savings transfers. Recent transactions table (Date, Description, Merchant, Pot, Category badge, Amount). Webhook management, Revoke Access (outline-warning), Delete Finance Data (outline-danger), Export JSON (outline-success).

**Strava card:** Last sync, auto-sync switch, exclude 'dad' workouts switch, recent activities table (Date, Name, Distance km, Avg HR).

**Steam card:** SteamID input, last sync, top games table (Title, Playtime hrs).

**YouTube card:** Connect status, sync stats, Watch Later count, Longform count, Takeout import section (file input, Import History button).

**Trakt card:** Username input, last sync, watchlist count, recent history ListGroup (show title, type + year, watched timestamp).

---

### `/logs/integrations` — Integration Logs

**Purpose:** Integration sync logs and error tracking.

**Table:** Timestamp (right), Level badge (dark), Channel badge (secondary), Message (fw-semibold), Details (small text-muted), Context (JSON pre-formatted). Scrollable, max-height 360px. Download JSON + Clear Log buttons.

---

### `/logs/ai` — AI Diagnostics

**Purpose:** AI API call diagnostics and usage.

---

### `/share/:shareCode` — Public Goal View

**Purpose:** Read-only, unauthenticated view of a shared goal.

**Design:** Stripped of navigation chrome. Only logo, goal title, progress, KPIs. Legible to someone unfamiliar with BOB. No domain-specific jargon.

---

## Icon System

### Lucide React Icons (primary library for UI chrome)

Used in all modals, cards, sidebar, toolbar, and interactive components.

| Icon | Usage |
|------|-------|
| `Activity` | Activity stream button on kanban cards and sidebar |
| `AlertCircle` | Wizard warnings, validation errors |
| `AlertTriangle` | Sprint closure banner, capacity warnings, blocked stories |
| `ArrowDownRight` | Downward trend indicator in journal insights |
| `ArrowUpRight` | Upward trend indicator |
| `BarChart3` | Sprint metrics, planning matrix button |
| `BookOpen` | Parent story link on task cards, stories nav |
| `Bot` | Hermes delegation status on kanban cards |
| `BrainCircuit` | Mood metric in journal insights |
| `CalendarClock` | Scheduled block meta badge |
| `CalendarDays` | Weekly check-in banner |
| `CalendarCheck` | Daily check-in banner |
| `CalendarPlus` | Create calendar event (kanban card, task modal) |
| `CheckCircle` | Completed step in wizard, task progress |
| `ChevronLeft` / `ChevronRight` | Sidebar collapse, week navigation, wizard steps |
| `ChevronDown` / `ChevronUp` | Expand/collapse (groups, rows) |
| `Clock` | Sprint days remaining badge |
| `Clock3` | Defer button on kanban cards |
| `Copy` | Copy deep link, copy credentials |
| `DollarSign` | Cost info in wizard |
| `Dumbbell` | Red readiness icon on AI Coach |
| `Edit3` | Inline edit toggle (sidebar, kanban card) |
| `ExternalLink` | Open full editor from sidebar |
| `FileText` | Linked document icon on cards |
| `Filter` | Filter dropdown |
| `Flame` | Stress metric in journal insights |
| `GitBranch` | Layout toggle in canvas |
| `GripVertical` | Drag handle on kanban cards and table rows |
| `HeartPulse` | Green readiness icon, health metrics |
| `KeyRound` | API key fields |
| `Link2` / `Link2Off` | Link mode toggle in canvas |
| `Maximize2` / `Minimize2` | Fullscreen toggle |
| `MessageCircle` | Add note button in sidebar |
| `MessageSquare` | AI chat button for goals |
| `MoveRight` | Move operation in planner |
| `Pencil` | Edit action in focus goals |
| `Plus` | Add new item buttons |
| `RefreshCw` | Delta replan button |
| `RotateCcw` | Reset zoom in canvas |
| `Rows3` | Swimlane layout in canvas |
| `Save` | Save button in sidebar |
| `Settings` | Settings nav, column visibility |
| `Shuffle` | Sprint reassignment, story-to-task conversion |
| `Sparkles` | Full replan, AI recommendations, Triage mode |
| `Target` | Goal link on story cards, Focus alignment badge, story progress |
| `Trash2` | Delete actions |
| `TrendingUp` | Capacity, progress metrics |
| `Upload` | Import button |
| `Wand2` | All AI generation actions |
| `X` | Close buttons |
| `ZoomIn` / `ZoomOut` | Canvas zoom |

### FontAwesome 6 Icons (navigation sidebar only)

All sidebar navigation items use `fas fa-{name}` class icons:

home, clipboard-check, mobile-alt, chart-line, wallet, check-square, heartbeat, kanban, calendar, tachometer-alt, target, bullseye, list, columns, chart-bar, share-alt, project-diagram, route, stream, book, book-open, tv, video, calendar-alt, tasks, chart-pie, rotate-left, globe, cog, user, robot, plug, envelope, shield-alt, flask, database, file-alt, gamepad, chevron-down, chevron-right.

### Issue: Icon Library Mixing

FontAwesome icons in the sidebar and Lucide icons everywhere else creates visual inconsistency. The SVG stroke weights and sizing conventions differ. A redesign should migrate the sidebar to Lucide or adopt a single icon library throughout.


---

## Responsive Behaviour

### Breakpoints

| Breakpoint | Width | Layout change |
|------------|-------|--------------|
| xs (mobile) | <576px | Single column, offcanvas nav, 44px touch targets |
| sm | 576–767px | Single column, form at full width |
| md (tablet) | 768–991px | 2-column grids, sidebar collapses |
| lg | 992–1199px | 3-column grids, 4-column daily plan |
| xl | 1200–1399px | 4-column grids, Sprint selector label visible |
| xxl | ≥1400px | Full density layout |

### Font scaling

- Tablet (768–1199px): `html { font-size: 87.5%; }` (scales all rem values ~6%)
- Mobile (<768px): `html { font-size: 94%; }`

### Touch targets

- Mobile minimum: `min-height: 44px` (iOS HIG standard)
- Tablet minimum: `min-height: 36px`
- Widget resize handles: hidden on mobile
- Drag handles: hidden on mobile (modal-based reorder instead)

### Mobile-specific patterns

- Sidebar → Offcanvas drawer
- Top toolbar → fixed 60px header (logo centred, hamburger left, avatar right)
- Dashboard widget grid → single column, no reorder
- Sprint planning grid → horizontal scroll with `min-width: 280px` columns
- Modals → `fullscreen="sm-down"` on chat and research modals
- Input fields → `font-size: 16px` minimum to prevent iOS auto-zoom

### Known mobile parity gaps

The majority of design effort targets desktop. The following screens are not properly optimised for mobile and need redesign:
- Finance dashboard (tables overflow, chart widths break)
- Sprint planning matrix (5-column grid not scrollable)
- Gantt/roadmap (canvas-based, no touch drag support)
- Settings tabs (pill layout wraps poorly)
- Weekly theme planner grid (30-minute cells not touch-friendly)


---

## Known Design Weaknesses (Priority Targets for Redesign)

These are documented problems to resolve in a full redesign:

**1. Three overlapping theme systems.** `index.css` (global tokens), `ThemeColors.css` (domain palette), and `theme-aware.css` / `themeConsistency.css` (component dark-mode overrides) operate in parallel. CSS variable values are duplicated across all three. A single design-token layer (this DESIGN.md) should replace all three. All components should read from `var(--bg)`, `var(--panel)`, `var(--card)`, `var(--line)`, `var(--text)`, `var(--muted)`, `var(--brand)` exclusively.

**2. Mixed card elevation.** Finance screens use Bootstrap `shadow-sm border-0` while kanban/goal cards use a custom shadow stack. Finance cards look measurably flatter than other domain cards. Standardise to the custom elevation.2 value across all cards.

**3. Bootstrap dark-mode colour bleed.** Finance and Planning screens bypass `var(--panel)` / `var(--card)` in favour of Bootstrap `bg-success-subtle`, `bg-danger`, etc. Bootstrap's light-mode defaults bleed into dark mode. All domain screens should use CSS variable surfaces, with Bootstrap semantic variants applied only to badges and status indicators.

**4. Typography inconsistency in charts.** Recharts and ECharts render text in their own default fonts unless explicitly overridden. Tooltip font, axis label size, and grid line colour are inconsistently applied across chart instances. All charts need: `fontFamily: 'Inter, sans-serif'`, axis labels 11px `var(--muted)`, grid lines `var(--line)`.

**5. Icon library fragmentation.** FontAwesome 6 (navigation sidebar) + Lucide React (everything else) + custom emoji (integration tabs). Migrate everything to Lucide.

**6. No consistent empty state component.** When a widget has no data, each component handles it differently — spinner, blank space, or error message. Need a single `EmptyState` component: icon + label + optional CTA button, consistent across all screens.

**7. No consistent loading skeleton.** Some components show Bootstrap `Spinner`, others show nothing during load. Implement a consistent shimmer skeleton pattern (animated gradient placeholder matching card shape) for all data-loading states.

**8. Mobile parity gap (six screens).** Finance dashboard, sprint planning matrix, gantt/roadmap, settings tabs, weekly theme planner grid, and visual canvas all require mobile-specific layout redesigns. None are currently usable on small screens.

**9. Sidebar navigation information overload.** 60+ links across 16 groups. The current flat expansion model means users need to scroll and expand to find common items. Recommend: 8 top-level destinations in sidebar, with secondary routes as in-screen tabs or breadcrumb sub-nav.

**10. FAB + right sidebar + left sidebar z-index conflicts.** The floating action button (z-index 1050), right detail sidebar (z-index 1000), assistant dock (z-index 1040), and modals (z-index 1055+) create stacking order conflicts on tablet breakpoints. Define a global z-index ladder: base=0, sidebars=900–1000, toolbar=1010, assistant=1040, FAB=1050, modals=1055–1100, tooltips=1200.

**11. Inline editing model is inconsistent.** Tables (double-click to edit), kanban cards (chip selects, always visible), modals (explicit edit mode), and the right sidebar (edit toggle button) all use different models for making data editable. Recommend: kanban cards keep always-visible chip selects; tables use single-click to activate inline edit; right sidebar keeps the toggle model; modals are always edit mode.

**12. Status value type mismatch.** Some components use numeric status codes (0=backlog, 1=planned, 2=done) while others use string names ("Backlog", "In Progress", "Done"). This causes silent comparison failures. Standardise on string enums throughout.
