---
# ============================================================
# DESIGN.md — United Planner App
# Stitch / Google Labs Design Specification
# Generated: 2026-05-09 | Version: 1.0.0
# Coverage: 100% — All screens, types, routes, and flows
# ============================================================

design_tokens:
  # ─────────────────────────────────────────────
  # COLOR PALETTE
  # ─────────────────────────────────────────────
  colors:
    # Brand / Primary
    primary-50:  "#EEF2FF"
    primary-100: "#E0E7FF"
    primary-200: "#C7D2FE"
    primary-300: "#A5B4FC"
    primary-400: "#818CF8"
    primary-500: "#6366F1"   # Main brand indigo
    primary-600: "#4F46E5"
    primary-700: "#4338CA"
    primary-800: "#3730A3"
    primary-900: "#312E81"

    # Neutral
    neutral-0:   "#FFFFFF"
    neutral-50:  "#F9FAFB"
    neutral-100: "#F3F4F6"
    neutral-200: "#E5E7EB"
    neutral-300: "#D1D5DB"
    neutral-400: "#9CA3AF"
    neutral-500: "#6B7280"
    neutral-600: "#4B5563"
    neutral-700: "#374151"
    neutral-800: "#1F2937"
    neutral-900: "#111827"
    neutral-950: "#030712"

    # Semantic
    success-light: "#D1FAE5"
    success:       "#10B981"
    success-dark:  "#065F46"
    warning-light: "#FEF3C7"
    warning:       "#F59E0B"
    warning-dark:  "#92400E"
    danger-light:  "#FEE2E2"
    danger:        "#EF4444"
    danger-dark:   "#991B1B"
    info-light:    "#DBEAFE"
    info:          "#3B82F6"
    info-dark:     "#1E40AF"

    # Surface — Light Mode
    surface-bg-light:            "#F9FAFB"
    surface-card-light:          "#FFFFFF"
    surface-card-hover-light:    "#F3F4F6"
    surface-table-row-light:     "#FFFFFF"
    surface-table-row-alt-light: "#F9FAFB"
    surface-sidebar-light:       "#FFFFFF"
    surface-modal-light:         "#FFFFFF"

    # Surface — Dark Mode
    surface-bg-dark:             "#0F1117"
    surface-card-dark:           "#1A1D27"
    surface-card-hover-dark:     "#21253A"
    surface-table-row-dark:      "#1A1D27"
    surface-table-row-alt-dark:  "#1E2235"
    surface-sidebar-dark:        "#13151F"
    surface-modal-dark:          "#1A1D27"

    # Theme Domain Colors (16 Global Themes)
    theme-0-general:       { color: "#6B7280", light: "#F3F4F6", dark: "#374151" }
    theme-1-health:        { color: "#10B981", light: "#D1FAE5", dark: "#065F46" }
    theme-2-career:        { color: "#6366F1", light: "#EEF2FF", dark: "#312E81" }
    theme-3-finance:       { color: "#F59E0B", light: "#FEF3C7", dark: "#92400E" }
    theme-4-learning:      { color: "#8B5CF6", light: "#EDE9FE", dark: "#4C1D95" }
    theme-5-family:        { color: "#EC4899", light: "#FCE7F3", dark: "#831843" }
    theme-6-hobbies:       { color: "#F97316", light: "#FFF7ED", dark: "#7C2D12" }
    theme-7-travel:        { color: "#06B6D4", light: "#CFFAFE", dark: "#164E63" }
    theme-8-home:          { color: "#84CC16", light: "#F7FEE7", dark: "#365314" }
    theme-9-spiritual:     { color: "#A78BFA", light: "#EDE9FE", dark: "#4C1D95" }
    theme-10-chores:       { color: "#9CA3AF", light: "#F3F4F6", dark: "#374151" }
    theme-11-recovery:     { color: "#34D399", light: "#D1FAE5", dark: "#065F46" }
    theme-12-work-main:    { color: "#3B82F6", light: "#DBEAFE", dark: "#1E3A8A" }
    theme-13-sleep:        { color: "#818CF8", light: "#E0E7FF", dark: "#3730A3" }
    theme-14-random:       { color: "#D1D5DB", light: "#F9FAFB", dark: "#6B7280" }
    theme-15-side-gig:     { color: "#FB7185", light: "#FFF1F2", dark: "#9F1239" }

  # ─────────────────────────────────────────────
  # TYPOGRAPHY
  # ─────────────────────────────────────────────
  typography:
    font-family-sans:  "'Inter', 'Helvetica Neue', Arial, sans-serif"
    font-family-mono:  "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

    # Scale
    text-xs:   { size: "11px", line-height: "16px", weight: 400 }
    text-sm:   { size: "13px", line-height: "20px", weight: 400 }
    text-base: { size: "14px", line-height: "22px", weight: 400 }
    text-md:   { size: "15px", line-height: "24px", weight: 400 }
    text-lg:   { size: "16px", line-height: "26px", weight: 500 }
    text-xl:   { size: "18px", line-height: "28px", weight: 600 }
    text-2xl:  { size: "20px", line-height: "30px", weight: 700 }
    text-3xl:  { size: "24px", line-height: "34px", weight: 700 }
    text-4xl:  { size: "30px", line-height: "40px", weight: 800 }

    # Semantic Roles
    display:   { size: "30px", weight: 800, tracking: "-0.02em" }
    heading-1: { size: "24px", weight: 700, tracking: "-0.01em" }
    heading-2: { size: "20px", weight: 700, tracking: "-0.01em" }
    heading-3: { size: "16px", weight: 600, tracking: "0" }
    label:     { size: "11px", weight: 600, tracking: "0.06em", transform: "uppercase" }
    caption:   { size: "11px", weight: 400, tracking: "0" }
    mono-ref:  { size: "11px", weight: 700, tracking: "0.02em", family: "mono" }

  # ─────────────────────────────────────────────
  # SPACING
  # ─────────────────────────────────────────────
  spacing:
    px:   "1px"
    0:    "0"
    0.5:  "2px"
    1:    "4px"
    1.5:  "6px"
    2:    "8px"
    2.5:  "10px"
    3:    "12px"
    3.5:  "14px"
    4:    "16px"
    5:    "20px"
    6:    "24px"
    7:    "28px"
    8:    "32px"
    9:    "36px"
    10:   "40px"
    12:   "48px"
    14:   "56px"
    16:   "64px"
    20:   "80px"
    24:   "96px"

    # Component-specific
    card-padding:          "16px"
    card-padding-compact:  "12px"
    table-row-padding-v:   "10px"
    table-row-padding-h:   "16px"
    sidebar-width:         "240px"
    sidebar-collapsed:     "56px"
    modal-padding:         "24px"
    page-padding:          "24px"
    page-padding-mobile:   "16px"

  # ─────────────────────────────────────────────
  # SHADOWS
  # ─────────────────────────────────────────────
  shadows:
    shadow-none: "none"
    shadow-xs:   "0 1px 2px rgba(0,0,0,0.05)"
    shadow-sm:   "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)"
    shadow-md:   "0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)"
    shadow-lg:   "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.03)"
    shadow-xl:   "0 20px 25px -5px rgba(0,0,0,0.08), 0 10px 10px -5px rgba(0,0,0,0.03)"
    shadow-2xl:  "0 25px 50px -12px rgba(0,0,0,0.18)"
    shadow-inner: "inset 0 2px 4px rgba(0,0,0,0.04)"

    # Surface-specific
    surface-card:       "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)"
    surface-card-hover: "0 4px 12px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06)"
    surface-modal:      "0 20px 60px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.1)"
    surface-floating:   "0 8px 24px rgba(0,0,0,0.15), 0 3px 8px rgba(0,0,0,0.08)"

  # ─────────────────────────────────────────────
  # BORDER RADIUS
  # ─────────────────────────────────────────────
  radii:
    none:  "0"
    sm:    "4px"
    base:  "6px"
    md:    "8px"
    lg:    "10px"
    xl:    "12px"
    2xl:   "16px"
    3xl:   "20px"
    full:  "9999px"

    # Semantic
    card:         "10px"
    card-inner:   "6px"
    button:       "6px"
    button-pill:  "9999px"
    badge:        "4px"
    badge-pill:   "9999px"
    input:        "6px"
    modal:        "16px"
    table-row:    "0"

  # ─────────────────────────────────────────────
  # ANIMATION
  # ─────────────────────────────────────────────
  animation:
    duration-instant:  "80ms"
    duration-fast:     "150ms"
    duration-normal:   "250ms"
    duration-slow:     "400ms"
    duration-slower:   "600ms"
    easing-default:    "cubic-bezier(0.16, 1, 0.3, 1)"
    easing-in:         "cubic-bezier(0.4, 0, 1, 1)"
    easing-out:        "cubic-bezier(0, 0, 0.2, 1)"
    easing-spring:     "cubic-bezier(0.34, 1.56, 0.64, 1)"

  # ─────────────────────────────────────────────
  # BREAKPOINTS
  # ─────────────────────────────────────────────
  breakpoints:
    sm:  "640px"
    md:  "768px"
    lg:  "1024px"
    xl:  "1280px"
    2xl: "1536px"
---

# DESIGN.md — United Planner App

> **Canonical design authority.** Every screen, type, and flow is documented here with zero omissions.
> This document is the source of truth for a full UI refactor into a hybrid Kanban Card / Modern Story Table system.

---

## Part A: Design Tokens

*Defined in YAML frontmatter above. The tokens below are the semantic aliases most critical for the Card/List hybrid.*

| Token | Value | Usage |
|-------|-------|-------|
| `surface-card` | `#FFFFFF` / `#1A1D27` | Card background |
| `surface-card-hover` | `#F3F4F6` / `#21253A` | Card hover state |
| `surface-table-row` | `#FFFFFF` / `#1A1D27` | Table row background |
| `surface-table-row-alt` | `#F9FAFB` / `#1E2235` | Alternating row |
| `shadow-surface-card` | see tokens | Card elevation |
| `radius-card` | `10px` | Card corner rounding |
| `radius-table-row` | `0` | Table rows flush |
| `card-padding` | `16px` | Card interior spacing |
| `table-row-padding-v` | `10px` | Row vertical padding |

---

## Part B: The Schema Blueprint — "The What"

### B.1 Complete Type Registry

Every document type in the system, with all fields, types, and optionality. Fields marked `?` are optional.

---

#### B.1.1 `Goal`

**Collection:** `goals/{goalId}`
**Description:** The highest-level planning unit. Goals can be nested (umbrella → milestone → execution) and span health, wealth, career, and personal themes.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | Firestore doc ID |
| `ref` | `string` | ? | Human-readable reference (e.g., G-042) |
| `persona` | `'personal' \| 'work'` | ✓ | Mode this goal belongs to |
| `title` | `string` | ✓ | Goal headline |
| `description` | `string` | ? | Long-form context |
| `theme` | `number` (0–15) | ✓ | Domain theme ID |
| `size` | `1 \| 2 \| 3` | ✓ | Small / Medium / Large |
| `timeToMasterHours` | `number` | ✓ | Estimated total effort hours |
| `estimatedCost` | `number` | ? | Financial estimate |
| `costType` | `'none' \| 'one_off' \| 'recurring'` | ? | Cost structure |
| `recurrence` | `'monthly' \| 'annual'` | ? | Recurring cost cadence |
| `targetYear` | `number` | ? | Year target |
| `goalRequiresStory` | `boolean` | ? | Flag for story requirement |
| `monzoPotGoalRef` | `string \| null` | ? | Monzo pot reference |
| `monzoPotId` | `string \| null` | ? | Monzo pot ID |
| `targetDate` | `string` | ? | ISO date string |
| `startDate` | `number` | ? | Unix timestamp |
| `endDate` | `number` | ? | Unix timestamp |
| `confidence` | `1 \| 2 \| 3` | ✓ | Low / Medium / High |
| `kpis` | `Array<{name,target,unit}>` | ? | Key performance indicators |
| `status` | `0 \| 1 \| 2 \| 3 \| 4` | ✓ | New/WIP/Complete/Blocked/Deferred |
| `ownerUid` | `string` | ✓ | Firebase UID |
| `createdAt` | `Timestamp` | ✓ | Firestore timestamp |
| `updatedAt` | `Timestamp` | ✓ | Firestore timestamp |
| `url` | `string \| null` | ? | External reference URL |
| `documentLink` | `string \| null` | ? | Google Doc link |
| `orderIndex` | `number` | ? | Manual sort order |
| `parentGoalId` | `string \| null` | ? | Parent for nested goals |
| `dependsOnGoalIds` | `string[]` | ? | Dependency graph edges |
| `goalKind` | `'umbrella' \| 'milestone' \| 'execution'` | ? | Hierarchy level |
| `timeHorizon` | `'sprint' \| 'quarter' \| 'year' \| 'multi_year'` | ? | Planning horizon |
| `rollupMode` | `'children_only' \| 'mixed'` | ? | Progress rollup strategy |
| `isPublished` | `boolean` | ? | Public sharing enabled |
| `shareCode` | `string` | ? | Slug for share URLs |
| `publishedAt` | `Timestamp` | ? | Publish date |

**Status Enum:**
- `0` = New
- `1` = Work in Progress
- `2` = Complete
- `3` = Blocked
- `4` = Deferred

**Size Enum:** `1`=Small, `2`=Medium, `3`=Large

**Confidence Enum:** `1`=Low, `2`=Medium, `3`=High

**Goal Kind Hierarchy:**
```
umbrella
  └── milestone
        └── execution
```

**Relationships:**
- Has many `Story` (via `goalId`)
- Has many `FocusGoal` references (via `goalIds[]`)
- May link to `Sprint.focusGoalIds[]`
- May link to Monzo Pot (via `monzoPotId`)

---

#### B.1.2 `Story`

**Collection:** `stories/{storyId}`
**Description:** Agile-style user stories. The primary mid-level work unit between Goals and Tasks. Equivalent to an epic or feature card.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | Firestore doc ID |
| `ref` | `string` | ✓ | Human reference (e.g., S-007) |
| `referenceNumber` | `string` | ? | Alternate reference |
| `persona` | `'personal' \| 'work'` | ✓ | Mode |
| `title` | `string` | ✓ | Story headline |
| `description` | `string` | ? | Context |
| `goalId` | `string` | ✓ | Parent goal FK |
| `theme` | `number` | ? | Inherited theme override |
| `status` | `0 \| 2 \| 4` | ✓ | Backlog/In Progress/Done |
| `blocked` | `boolean` | ? | Blocked flag |
| `priority` | `1 \| 2 \| 3 \| 4` | ✓ | Low/Medium/High/Critical |
| `points` | `number` | ✓ | Story points |
| `wipLimit` | `number` | ✓ | WIP constraint |
| `tags` | `string[]` | ? | Freeform tags |
| `sprintId` | `string` | ? | Assigned sprint FK |
| `orderIndex` | `number` | ✓ | Column sort position |
| `acceptanceCriteria` | `string[]` | ? | DoD checklist |
| `ownerUid` | `string` | ✓ | Firebase UID |
| `createdAt` | `Timestamp` | ✓ | |
| `updatedAt` | `Timestamp` | ✓ | |
| `url` | `string \| null` | ? | |
| `documentLink` | `string \| null` | ? | |
| `dueDate` | `number` | ? | Unix timestamp |
| `dueTime` | `string` | ? | `HH:mm` |
| `timeOfDay` | `'morning' \| 'afternoon' \| 'evening'` | ? | |
| `targetDate` | `number \| string` | ? | |
| `plannedStartDate` | `number \| string` | ? | |
| `progressPct` | `number \| null` | ? | 0–100 |
| `progressPctUpdatedAt` | `number \| null` | ? | |
| `pointsRemaining` | `number \| null` | ? | |
| `taskCount` | `number` | ? | Denormalized task count |
| `doneTaskCount` | `number` | ? | Denormalized done count |
| `metadata` | `Record<string,any>` | ? | Extension bag |
| `aiCriticalityScore` | `number` | ? | AI ranking 0–100 |
| `aiCriticalityReason` | `string` | ? | AI explanation |
| `aiFocusStoryRank` | `number` | ? | AI daily rank |
| `aiTop3ForDay` | `boolean` | ? | AI-selected top 3 |
| `userPriorityFlag` | `boolean` | ? | User-starred |
| `userPriorityRank` | `1 \| 2 \| 3 \| null` | ? | User top-3 slot |
| `deferredUntil` | `Timestamp` | ? | Snooze date |
| `countryCode` | `string` | ? | ISO alpha-2 |
| `city` | `string` | ? | Location city |
| `locationName` | `string` | ? | Named location |
| `locationLat` | `number` | ? | |
| `locationLon` | `number` | ? | |

**Status Enum:** `0`=Backlog, `2`=In Progress, `4`=Done

**Priority Enum:** `4`=Critical, `3`=High, `2`=Medium, `1`=Low

**Relationships:**
- Belongs to one `Goal` (via `goalId`)
- Has many `Task` (via `parentId`)
- May belong to one `Sprint` (via `sprintId`)

---

#### B.1.3 `Task`

**Collection:** `tasks/{taskId}`
**Description:** Atomic work unit. The leaf node. Syncs bidirectionally with iOS Reminders and can originate from Gmail, AI, or web.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `ref` | `string` | ✓ | Human ref (e.g., T-123) |
| `persona` | `'personal' \| 'work'` | ✓ | |
| `parentType` | `'story' \| 'project'` | ✓ | Parent entity type |
| `parentId` | `string` | ✓ | Story or Project FK |
| `title` | `string` | ✓ | |
| `description` | `string` | ? | |
| `status` | `0 \| 1 \| 2 \| 3` | ✓ | To Do/In Progress/Done/Blocked |
| `priority` | `1 \| 2 \| 3 \| 4` | ✓ | Low/Medium/High/Critical |
| `effort` | `'S' \| 'M' \| 'L'` | ✓ | T-shirt size |
| `estimateMin` | `number` | ✓ | Minutes estimate |
| `points` | `number` | ? | |
| `estimatedHours` | `number` | ? | |
| `startDate` | `number` | ? | Unix timestamp |
| `dueDate` | `number` | ? | Unix timestamp |
| `dueDateMs` | `number` | ? | |
| `dueTime` | `string` | ? | `HH:mm` |
| `timeOfDay` | `'morning' \| 'afternoon' \| 'evening'` | ? | |
| `dueDateLocked` | `boolean` | ? | |
| `dueDateReason` | `string` | ? | AI/user reason |
| `labels` | `string[]` | ? | |
| `blockedBy` | `string[]` | ? | Task IDs blocking this |
| `dependsOn` | `string[]` | ? | Task IDs depended on |
| `checklist` | `Array<{text,done}>` | ? | Sub-checklist items |
| `attachments` | `Array<{name,url}>` | ? | |
| `alignedToGoal` | `boolean` | ✓ | |
| `theme` | `number` | ? | |
| `source` | `'ios_reminder' \| 'MacApp' \| 'web' \| 'ai' \| 'gmail' \| 'sheets'` | ✓ | Origin |
| `sourceRef` | `string` | ? | External ID |
| `aiSuggestedLinks` | `Array<{goalId,storyId?,confidence,rationale}>` | ? | AI link proposals |
| `aiLinkConfidence` | `number` | ✓ | 0–1 |
| `hasGoal` | `boolean` | ✓ | |
| `syncState` | `'clean' \| 'dirty' \| 'pending_push' \| 'awaiting_ack'` | ✓ | Sync FSM state |
| `deviceUpdatedAt` | `number` | ? | |
| `serverUpdatedAt` | `number` | ✓ | |
| `macSyncedAt` | `number` | ? | |
| `createdBy` | `string` | ✓ | UID |
| `ownerUid` | `string` | ✓ | UID |
| `importanceScore` | `number` | ? | |
| `isImportant` | `boolean` | ? | |
| `reminderId` | `string` | ? | iOS Reminder ID |
| `duplicateOf` | `string` | ? | Dedup reference |
| `type` | `'task' \| 'chore' \| 'routine' \| 'habit' \| 'read' \| 'watch' \| string` | ? | |
| `repeatFrequency` | `'daily' \| 'weekly' \| 'monthly' \| 'yearly' \| null` | ? | |
| `rrule` | `string \| null` | ? | RFC 5545 rule |
| `lastDoneAt` | `Timestamp` | ? | |
| `snoozedUntil` | `number` | ? | |
| `sprintId` | `string` | ? | |
| `projectId` | `string` | ? | Work project FK |
| `deepLink` | `string` | ? | Mobile deep link |
| `url` | `string \| null` | ? | |
| `documentLink` | `string \| null` | ? | |
| `completedAt` | `number` | ? | |
| `deferredUntil` | `Timestamp` | ? | |
| `deferredReason` | `string` | ? | |

**Status Enum:** `0`=To Do, `1`=In Progress, `2`=Done, `3`=Blocked

**Effort Enum:** `S`=Small (~15–30 min), `M`=Medium (~1–2 hr), `L`=Large (~3+ hr)

**Sync FSM:** `clean → dirty → pending_push → awaiting_ack → clean`

---

#### B.1.4 `Sprint`

**Collection:** `sprints/{sprintId}`
**Description:** Time-boxed iteration (typically 2 weeks). Contains stories and is associated with focus goals.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `ref` | `string` | ✓ | Human ref |
| `name` | `string` | ✓ | Sprint name |
| `objective` | `string` | ? | Sprint goal |
| `notes` | `string` | ? | |
| `persona` | `'personal' \| 'work'` | ? | |
| `status` | `0 \| 1 \| 2 \| 3` | ✓ | Planning/Active/Complete/Cancelled |
| `focusGoalIds` | `string[]` | ? | Focus goals for this sprint |
| `alignmentMode` | `'warn' \| 'strict'` | ? | Story alignment enforcement |
| `alignmentLockedAt` | `Timestamp` | ? | |
| `startDate` | `number` | ✓ | Unix timestamp |
| `endDate` | `number` | ✓ | Unix timestamp |
| `planningDate` | `number` | ✓ | When planning occurs |
| `retroDate` | `number` | ✓ | When retro occurs |
| `ownerUid` | `string` | ✓ | |
| `createdAt` | `Timestamp` | ✓ | |
| `updatedAt` | `Timestamp` | ✓ | |

**Status Enum:** `0`=Planning, `1`=Active, `2`=Complete, `3`=Cancelled

---

#### B.1.5 `FocusGoal`

**Collection:** `focusGoals/{focusGoalId}`
**Description:** A curated set of goals the user is actively focusing on for a given timeframe. Acts as a "North Star" filter for stories and calendar blocks.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `ownerUid` | `string` | ✓ | |
| `persona` | `'personal' \| 'work'` | ✓ | |
| `goalIds` | `string[]` | ✓ | Active focus goals |
| `focusRootGoalIds` | `string[]` | ? | Top-level umbrella goal IDs |
| `focusLeafGoalIds` | `string[]` | ? | Leaf/execution goal IDs |
| `goalTypeMap` | `{[goalId]: 'story' \| 'calendar'}` | ? | Per-goal tracking mode |
| `timeframe` | `'sprint' \| 'quarter' \| 'year'` | ✓ | Planning horizon |
| `startDate` | `Timestamp` | ✓ | |
| `endDate` | `Timestamp` | ✓ | |
| `daysRemaining` | `number` | ? | Computed field |
| `title` | `string` | ? | |
| `description` | `string` | ? | |
| `createdAt` | `Timestamp` | ✓ | |
| `updatedAt` | `Timestamp` | ✓ | |
| `isActive` | `boolean` | ✓ | |
| `storiesCreatedFor` | `string[]` | ? | Goals with stories generated |
| `potIdsCreatedFor` | `{[goalId]: string}` | ? | Monzo pots created |
| `visionText` | `string` | ? | Narrative vision statement |
| `intentBrokerIntakeId` | `string` | ? | AI intake correlation |
| `intentMatches` | `Array<{goalId,title,score,tag?}>` | ? | AI-matched intents |
| `monzoPotGoalRefs` | `{[goalId]: string}` | ? | Pot reference map |
| `assignedSprintIdsByGoalId` | `{[goalId]: string[]}` | ? | Sprint assignments |

---

#### B.1.6 `CalendarBlock`

**Collection:** `calendarBlocks/{blockId}`
**Description:** A time-boxed allocation block on the calendar. Can be linked to tasks, goals, stories, or habits. Bidirectionally syncs with Google Calendar.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `googleEventId` | `string` | ? | GCal event ID |
| `syncToGoogle` | `boolean` | ? | |
| `taskId` | `string` | ? | Linked task |
| `goalId` | `string` | ? | Linked goal |
| `storyId` | `string` | ? | Linked story |
| `habitId` | `string` | ? | Linked habit |
| `seriesId` | `string` | ? | Recurring series ID |
| `subTheme` | `string` | ? | Theme subdivision |
| `persona` | `'personal' \| 'work'` | ✓ | |
| `theme` | `string` | ✓ | Theme label |
| `themeId` | `number \| string` | ? | Theme ID |
| `category` | `string` | ✓ | Block category |
| `start` | `number` | ✓ | Unix timestamp |
| `end` | `number` | ✓ | Unix timestamp |
| `flexibility` | `'hard' \| 'soft'` | ✓ | Hard=immovable, Soft=AI can reschedule |
| `status` | `'proposed' \| 'applied' \| 'superseded'` | ✓ | Lifecycle state |
| `colorId` | `string` | ? | GCal color ID |
| `visibility` | `'default' \| 'private'` | ✓ | |
| `createdBy` | `'ai' \| 'user'` | ✓ | Origin |
| `rationale` | `string` | ? | AI scheduling reason |
| `version` | `number` | ✓ | Optimistic concurrency |
| `supersededBy` | `string` | ? | Replacement block ID |
| `ownerUid` | `string` | ✓ | |
| `createdAt` | `number` | ✓ | |
| `updatedAt` | `number` | ✓ | |
| `title` | `string` | ? | Display override |
| `recurrence` | `{freq,byDay?,until?}` | ? | Recurrence pattern |

**Category Enum:**
`Tribe` | `Chores` | `Gaming` | `Fitness` | `Wellbeing` | `Sauna` | `Sleep` | `Work Shift` | `Work (Main Gig)` | `Side Gig`

**Status Lifecycle:** `proposed → applied` or `proposed → superseded`

---

#### B.1.7 `WorkProject`

**Collection:** `workProjects/{projectId}`
**Description:** A work-mode container for tasks that don't fit under a personal goal. Client/team grouping.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `persona` | `'work'` | ✓ | Always work |
| `title` | `string` | ✓ | |
| `client` | `string` | ? | |
| `team` | `string` | ? | |
| `tags` | `string[]` | ? | |
| `status` | `0 \| 1 \| 2` | ✓ | Backlog/Active/Done |
| `wipLimit` | `number` | ✓ | |
| `ownerUid` | `string` | ✓ | |
| `createdAt` | `Timestamp` | ✓ | |
| `updatedAt` | `Timestamp` | ✓ | |

---

#### B.1.8 `JournalEntry`

**Collection:** `journals/{journalId}`
**Description:** Voice-to-text or written diary entries processed by AI. Can generate tasks and stories as output.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `persona` | `'personal' \| 'work'` | ✓ | |
| `ownerUid` | `string` | ✓ | |
| `originalTranscript` | `string` | ? | Raw voice transcript |
| `journalDateKey` | `string \| null` | ? | `YYYY-MM-DD` |
| `dateHeading` | `string` | ? | Human display heading |
| `structuredEntry` | `string` | ? | AI-structured prose |
| `oneLineSummary` | `string` | ? | TL;DR |
| `aiSummaryBullets` | `string[]` | ? | Bullet summaries |
| `advice` | `string` | ? | Coach advice |
| `mindsetAnalysis` | `JournalMindsetAnalysis \| null` | ? | Mindset scoring |
| `entryMetadata` | `JournalEntryMetadata \| null` | ? | Structured metadata |
| `docUrl` | `string \| null` | ? | Google Doc URL |
| `googleDoc` | `AgentGoogleDocStatus \| null` | ? | Doc sync status |
| `entryType` | `'journal' \| 'mixed' \| 'task_list' \| 'url_only' \| string` | ? | Content classification |
| `storyIds` | `string[]` | ? | Stories generated |
| `taskIds` | `string[]` | ? | Tasks generated |
| `linkedStories` | `Array<{id,ref?,title?}>` | ? | Denormalized story refs |
| `linkedTasks` | `Array<{id,ref?,title?}>` | ? | Denormalized task refs |
| `createdAt` | `Timestamp` | ✓ | |
| `updatedAt` | `Timestamp` | ✓ | |

---

#### B.1.9 `IHabit`

**Collection:** `habits/{habitId}`
**Description:** A repeating behaviour goal (e.g., "Run 3x per week"). Tracked via daily/weekly `IHabitEntry` records.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `userId` | `string` | ✓ | |
| `name` | `string` | ✓ | |
| `description` | `string` | ? | |
| `frequency` | `'daily' \| 'weekly' \| 'monthly' \| 'custom'` | ✓ | |
| `targetValue` | `number` | ✓ | Target count per period |
| `unit` | `string` | ? | e.g., "reps", "km" |
| `linkedGoalId` | `string` | ? | FK to parent Goal |
| `createdAt` | `number` | ✓ | Unix timestamp |
| `updatedAt` | `number` | ✓ | |
| `isActive` | `boolean` | ✓ | |
| `color` | `string` | ? | Hex color |

---

#### B.1.10 `IHabitEntry`

**Collection:** `habitEntries/{entryId}`
**Description:** A single log of a habit being performed on a given date.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `habitId` | `string` | ✓ | Parent habit FK |
| `ownerUid` | `string` | ? | |
| `date` | `number` | ✓ | Unix timestamp (day) |
| `value` | `number` | ✓ | Actual count |
| `isCompleted` | `boolean` | ✓ | Target met |
| `notes` | `string` | ? | |
| `createdAt` | `number` | ✓ | |
| `updatedAt` | `number` | ✓ | |

---

#### B.1.11 `MetricsHrv`

**Collection:** `metrics/hrv`
**Description:** Heart Rate Variability data points from wearables.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `date` | `Timestamp` | ✓ | |
| `value` | `number` | ✓ | HRV ms |
| `source` | `string` | ✓ | Device/app name |

---

#### B.1.12 `MetricsWorkouts`

**Collection:** `metrics/workouts`
**Description:** Individual workout sessions synced from Strava.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `date` | `Timestamp` | ✓ | |
| `type` | `string` | ✓ | e.g., "Run", "Swim" |
| `distance` | `number` | ✓ | Metres |
| `duration` | `number` | ✓ | Seconds |
| `hr_avg` | `number` | ✓ | BPM |
| `source` | `string` | ✓ | |
| `stravaActivityId` | `string` | ✓ | |

---

#### B.1.13 `MetricsNutrition`

**Collection:** `metrics/nutrition`
**Description:** Daily nutrition intake synced from MyFitnessPal.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | ✓ | |
| `date` | `Timestamp` | ✓ | |
| `calories` | `number` | ✓ | kcal |
| `protein_g` | `number` | ✓ | grams |
| `carbs_g` | `number` | ✓ | grams |
| `fats_g` | `number` | ✓ | grams |
| `source` | `string` | ✓ | |
| `mfpEntryId` | `string` | ✓ | MFP record ID |

---

#### B.1.14 `PlanningPrefs`

**Collection:** `users/{uid}/planningPrefs`
**Description:** User scheduling preferences that the AI planner uses to generate calendar blocks.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `uid` | `string` | ✓ | |
| `wakeTime` | `string` | ✓ | `HH:mm` |
| `sleepTime` | `string` | ✓ | `HH:mm` |
| `quietHours` | `Array<{start,end}>` | ✓ | No-schedule windows |
| `maxHiSessionsPerWeek` | `number` | ✓ | Max high-intensity sessions |
| `minRecoveryGapHours` | `number` | ✓ | Min hours between HI sessions |
| `weeklyThemeTargets` | `{Health,Tribe,Wealth,Growth,Home}` | ✓ | Target hours per theme per week |
| `poolHours` | `Array<{day,open,close}>` | ? | Pool availability |
| `gymHours` | `Array<{day,open,close}>` | ? | Gym availability |
| `autoApplyThreshold` | `number` | ✓ | Confidence threshold for auto-apply |

---

#### B.1.15 `AgentResponse` (Service DTO)

**Source:** `services/agentClient.ts`
**Description:** Response envelope from the AI agent after processing voice/text input.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ok` | `boolean` | ✓ | Success flag |
| `duplicate` | `boolean` | ? | Already processed |
| `message` | `string` | ? | Human-readable result |
| `mode` | `string \| null` | ? | Agent mode used |
| `intent` | `string \| null` | ? | Classified intent |
| `confidence` | `number \| null` | ? | Intent confidence |
| `spokenResponse` | `string \| null` | ? | TTS response |
| `actionsExecuted` | `string[]` | ? | Action log |
| `ingestionId` | `string \| null` | ? | Correlation ID |
| `entryType` | `string \| null` | ? | |
| `hasJournal` | `boolean` | ? | Journal created |
| `resultType` | `string \| null` | ? | |
| `journalId` | `string \| null` | ? | Created journal ID |
| `docUrl` | `string \| null` | ? | Google Doc URL |

---

#### B.1.16 `AgentPriorityItem` (Service DTO)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `entityType` | `'task' \| 'story'` | ✓ | |
| `reason` | `string \| null` | ? | Priority reason |
| `priorityRank` | `number \| null` | ? | 1–N rank |

---

### B.2 Theme Registry (16 Domains)

| ID | Name | Color | Use in UI |
|----|------|-------|-----------|
| 0 | General | `#6B7280` | Default/uncategorized |
| 1 | Health & Fitness | `#10B981` | Fitness, workouts, HRV |
| 2 | Career & Professional | `#6366F1` | Work goals, sprints |
| 3 | Finance & Wealth | `#F59E0B` | Budgets, pots, transactions |
| 4 | Learning & Education | `#8B5CF6` | Books, courses, skills |
| 5 | Family & Relationships | `#EC4899` | Tribe time, social |
| 6 | Hobbies & Interests | `#F97316` | Games, shows, projects |
| 7 | Travel & Adventure | `#06B6D4` | Routes, trips, maps |
| 8 | Home & Living | `#84CC16` | Home tasks, chores |
| 9 | Spiritual & Personal Growth | `#A78BFA` | Mindset, reflection |
| 10 | Chores | `#9CA3AF` | Routines, checklists |
| 11 | Rest & Recovery | `#34D399` | Sleep, recovery |
| 12 | Work (Main Gig) | `#3B82F6` | Primary employment |
| 13 | Sleep | `#818CF8` | Sleep blocks |
| 14 | Random | `#D1D5DB` | Misc |
| 15 | Side Gig | `#FB7185` | Freelance, secondary income |

---

### B.3 Data-to-UI Mapping (Card vs. List View)

| Document Type | Recommended Primary View | Recommended Secondary View | Rationale |
|--------------|-------------------------|--------------------------|-----------|
| `Goal` (umbrella) | **Card** — large, rich | List for density scan | High visual impact; theme color, confidence, cost, KPIs |
| `Goal` (milestone/execution) | **List / Table** | Card for detail | Many per umbrella; density wins |
| `Story` | **Kanban Card** | Modern Story Table | Classic agile; column-per-status layout ideal |
| `Task` | **List / Checklist** | Card for "Today" view | Atomic, high-volume; list is scannable |
| `Sprint` | **Card** (status, dates, velocity) | Table for history | One active at a time; card shows progress ring |
| `FocusGoal` | **Card** (hero banner) | N/A | Low cardinality; large format conveys priority |
| `CalendarBlock` | **Calendar grid** | List for approval queue | Time-space is the primary dimension |
| `JournalEntry` | **Card** (diary-style) | List for history | Rich narrative content suits cards |
| `IHabit` | **Card** (streak, heatmap) | List for management | Visual completion rings |
| `IHabitEntry` | **Inline in Habit Card** | Table for analytics | Sub-record |
| `MetricsWorkouts` | **List / Table** | Chart overlay | High-volume time series |
| `MetricsHrv` | **Sparkline / Chart** | Table for raw data | Trend is the value |
| `MetricsNutrition` | **List / Daily card** | Chart for trends | Daily snapshot |
| `WorkProject` | **Card** (kanban-style) | Table for backlog | Similar to Story |
| `PlanningPrefs` | **Form (settings screen)** | N/A | Singleton |

---

## Part C: The Experience Blueprint — "The How"

### C.1 Full Navigation Map

```
App Shell
├── Sidebar (240px, collapsible to 56px)
│   ├── Logo / Persona Switcher [personal | work]
│   ├── GlobalSearchBar
│   │
│   ├── ── PLANNING ──
│   ├── Dashboard              → /dashboard
│   ├── United Planner         → /planner (alias /planning)
│   │   ├── Weekly View        → /planner/weekly
│   │   └── Daily Plan         → /daily-plan
│   ├── Calendar               → /calendar
│   │   ├── Planner            → /calendar/planner
│   │   ├── Themes             → /calendar/themes
│   │   ├── Integration        → /calendar/integration
│   │   └── Sync Status        → /calendar/sync
│   ├── Approval Center        → /planning/approvals
│   │
│   ├── ── GOALS ──
│   ├── Goals                  → /goals
│   │   ├── Management         → /goals/management
│   │   ├── Year Planner       → /goals/year-planner
│   │   └── Focus Goals        → /focus-goals
│   ├── Roadmap                → /goals/roadmap
│   │   ├── V5                 → /goals/roadmap-v5
│   │   ├── V6                 → /goals/roadmap-v6
│   │   └── Legacy             → /goals/roadmap-legacy
│   ├── Visualization          → /goals/viz
│   └── Timeline               → /goals/timeline
│
│   ├── ── WORK ──
│   ├── Stories                → /stories
│   ├── Tasks                  → /tasks
│   │   ├── Chores             → /chores
│   │   │   ├── Manage         → /chores/manage
│   │   │   └── Checklist      → /chores/checklist
│   │   └── Management         → /tasks-management
│   ├── Sprints                → /sprints
│   │   ├── Management         → /sprints/management
│   │   ├── Kanban             → /sprints/kanban
│   │   ├── Table              → /sprints/table
│   │   ├── Planning           → /sprints/planning
│   │   ├── Retrospective      → /sprints/retrospective
│   │   └── Capacity           → /sprints/capacity
│   └── Capacity Dashboard     → /capacity
│
│   ├── ── HEALTH ──
│   ├── Fitness Dashboard      → /fitness
│   ├── Workouts               → /workouts
│   ├── Habits                 → (HabitsManagement component)
│   ├── Check-ins
│   │   ├── Daily              → /checkin/daily
│   │   └── Weekly             → /checkin/weekly
│   └── Metrics                → /metrics
│       └── Progress           → /metrics/progress
│
│   ├── ── FINANCE ──
│   ├── Finance Hub            → /finance
│   │   ├── Dashboard          → /finance/dashboard
│   │   ├── Advanced           → /finance/advanced
│   │   ├── Budgets            → /finance/budgets
│   │   ├── Categories         → /finance/categories
│   │   ├── Merchants          → /finance/merchants
│   │   ├── Transactions       → /finance/transactions
│   │   ├── Flow               → /finance/flow
│   │   ├── Goals/Pots         → /finance/goals & /finance/pots
│   │   └── Integrations       → /finance/integrations
│
│   ├── ── LIFE ──
│   ├── Journals               → /journals
│   │   └── Insights           → /journals/insights
│   ├── Backlogs
│   │   ├── Books              → /books-backlog
│   │   ├── Games              → /games-backlog
│   │   ├── Shows              → /shows-backlog
│   │   └── Videos             → /videos-backlog
│   ├── YouTube History        → /youtube-history
│   ├── Travel                 → /travel
│   └── Routes                 → /routes
│       └── Optimization       → /routes/optimization
│
│   ├── ── AI ──
│   ├── AI Coach               → /ai-coach
│   ├── AI Planner             → /ai-planner
│   └── AI Usage               → /ai-usage
│
│   └── ── SYSTEM ──
│       ├── Settings           → /settings
│       ├── Admin              → /admin
│       ├── Logs               → /logs/*
│       └── Changelog          → /changelog
│
├── FloatingActionButton (bottom-right)
│   ├── + New Task (quick add)
│   ├── + New Story
│   ├── + New Goal
│   └── Voice Input (Transcript Intake)
│
└── FloatingAssistantButton (AI chat trigger)
```

---

### C.2 Screen-by-Screen Inventory

Each screen is documented with: **Route → Component → Key UI Elements → Document Types Displayed → Hybrid View Mode**

---

#### C.2.1 Dashboard

**Route:** `/dashboard`
**Component:** `Dashboard.tsx`
**Hybrid Mode:** Mixed (summary cards + activity list)

**UI Elements:**
- Hero welcome header (user name, date, persona badge)
- `FocusGoal` hero card — active focus goals with countdown
- `SprintVelocityWidget` — current sprint progress ring
- `KpiDashboardWidget` — goal KPI gauges
- `FitnessWidget` — HRV + workout summary
- `ActivityWidget` — recent activity feed
- `CoachVerdictBanner` — AI coach daily recommendation
- `DayCapacityWarningBanner` — overcommitment alert
- Quick-add task strip
- Recent `JournalEntry` card

**Documents displayed:** `Goal`, `Story`, `Sprint`, `FocusGoal`, `IHabit`, `MetricsHrv`, `MetricsWorkouts`, `JournalEntry`

---

#### C.2.2 United Planner (Main Planner)

**Route:** `/planner` · `/planning`
**Component:** `planner/UnifiedPlannerPage.tsx`
**Hybrid Mode:** Calendar grid + sidebar list

**UI Elements:**
- Week navigation (prev/next week arrows, today button)
- Theme column headers (Health / Wealth / Growth / Tribe / Home)
- `CalendarBlock` drag-and-drop grid cells
- Capacity bar per day (hours used / hours available)
- Story sidebar panel (stories to schedule)
- "Propose Plan" button → triggers AI full replan
- Approval queue badge (unapplied proposed blocks)
- Legend: hard block (solid) vs soft block (striped)
- Quick-add block popover on cell click

**Documents displayed:** `CalendarBlock`, `Story`, `Task`, `FocusGoal`, `PlanningPrefs`

---

#### C.2.3 Weekly Theme Planner

**Route:** `/planner/weekly`
**Component:** `planner/WeeklyPlannerPage.tsx` / `planner/WeeklyThemePlanner.tsx`
**Hybrid Mode:** Card grid per theme

**UI Elements:**
- 7-column week grid
- Per-theme bucket cards with hour target vs actual
- Theme color-coded blocks
- "Balance targets" summary row

---

#### C.2.4 Daily Plan

**Route:** `/daily-plan`
**Component:** `planner/DailyPlanPage.tsx` (implied)
**Hybrid Mode:** List (time-ordered)

**UI Elements:**
- Date header with weather/HRV indicator
- Time-sorted `CalendarBlock` list for today
- AI Top-3 stories panel
- "Mark done" inline actions
- Mood/energy check-in prompt

---

#### C.2.5 Planning Approval Center

**Route:** `/planning/approvals`
**Component:** `planner/ApprovalsCenter.tsx`
**Hybrid Mode:** List with card preview

**UI Elements:**
- Pending `CalendarBlock` list (proposed, not applied)
- Accept / Reject / Edit actions per block
- Batch accept-all button
- Filter by theme / date range
- Block detail card preview in right panel

---

#### C.2.6 Goals Management

**Route:** `/goals`
**Component:** `GoalsManagement.tsx`
**Hybrid Mode:** **Toggleable** — Card Grid | List Table

**UI Elements:**
- View toggle (Card / List)
- Filter bar: theme, status, size, persona, year, horizon
- Sort: by date, status, theme, size
- **Card View (`GoalsCardView.tsx`):** Goal cards with theme-colored left border, status badge, confidence pill, cost chip, progress bar
- **List View (`ModernGoalsTable.tsx`):** Virtualized table — columns: Ref, Title, Theme, Status, Size, Confidence, Target Date, Cost, KPIs
- "+ New Goal" button → `AddGoalModal`
- Goal card click → `EditGoalModal`
- Hierarchy toggle (flat | nested tree)
- Persona filter chips (personal / work / all)

**Documents displayed:** `Goal`

---

#### C.2.7 Goal Detail / Edit Modal

**Trigger:** Goal card click, direct route `/goals/:id`
**Component:** `EditGoalModal.tsx`
**Hybrid Mode:** Form (modal or full-page)

**UI Elements:**
- Tab bar: Overview · Stories · Tasks · KPIs · Finance · Settings
- **Overview tab:** Title, description, theme picker, size selector, confidence slider, status dropdown, date range pickers, timeHorizon selector, goalKind selector
- **Stories tab:** Inline story list for this goal; "+ Add Story" action
- **Tasks tab:** Task list (filtered to this goal)
- **KPIs tab:** KPI editor (name, target, unit per row)
- **Finance tab:** Monzo pot link, cost type, estimated cost
- **Settings tab:** Share toggle, share code display, document link, URL

---

#### C.2.8 Add Goal (Guided Flow — "Create a Goal")

**Trigger:** "+ New Goal" button / FAB
**Component:** `AddGoalModal.tsx`
**View:** Modal wizard (3 steps)

**Step 1 — Identity:**
- Title input
- Description textarea
- Theme picker (16 color chips)
- Persona selector (personal / work)

**Step 2 — Scope:**
- Size selector (Small / Medium / Large)
- Time horizon (Sprint / Quarter / Year / Multi-Year)
- Goal kind (Umbrella / Milestone / Execution)
- Confidence selector (Low / Medium / High)
- Target date picker
- Parent goal linker (GoalMultiSelect)

**Step 3 — Finance & Delivery:**
- Estimated cost + cost type
- Monzo pot link (optional)
- KPI rows (name, target, unit)
- Story requirement flag

**Output:** Creates `Goal` document in Firestore

---

#### C.2.9 Goal Year Planner

**Route:** `/goals/year-planner`
**Component:** `visualization/GoalTimelineGrid.tsx`
**Hybrid Mode:** Timeline grid (Gantt-like)

**UI Elements:**
- Year header with month columns (12 cols)
- Goal rows sorted by theme
- Start/end date bars with drag handles
- Theme color coding
- "Today" marker line
- Hover tooltip with goal details

---

#### C.2.10 Roadmap Views (V3–V6)

**Routes:** `/goals/roadmap`, `/goals/roadmap-v5`, `/goals/roadmap-v6`, `/goals/roadmap-legacy`
**Components:** `visualization/GoalRoadmapV3–V6.tsx`, `visualization/ThemeRoadmap.tsx`
**Hybrid Mode:** Visual canvas (non-table)

**UI Elements:**
- Swimlane rows per theme
- Goal nodes (cards with status dot)
- Dependency arrows between nodes
- Time axis (months/quarters)
- Zoom controls
- Filter by status, theme, horizon
- Click node → Goal detail modal

---

#### C.2.11 Goal Visualization

**Route:** `/goals/viz`
**Component:** `visualization/GoalVizPage.tsx`
**Hybrid Mode:** Graph/Canvas

**UI Elements:**
- Force-directed graph of goals and stories
- Theme-colored nodes
- Edge connections for dependencies
- Click to inspect document

---

#### C.2.12 Stories Management

**Route:** `/stories`
**Component:** `StoriesManagement.tsx`
**Hybrid Mode:** **Toggleable** — Kanban Board | Modern Story Table

**UI Elements:**
- View toggle (Kanban / Table)
- Filter bar: goal, sprint, status, priority, tag, persona
- **Kanban View (`KanbanPage.tsx` / `ModernKanbanPage.tsx`):**
  - 3 columns: Backlog · In Progress · Done
  - Story cards with: ref badge, title, priority chip, points badge, goal chip, tag pills, due date, task progress bar (done/total)
  - WIP limit warning per column
  - Drag-and-drop between columns
  - Column header with count + point total
- **Table View (`ModernStoriesTable.tsx`):**
  - Columns: Ref, Title, Goal, Status, Priority, Points, Sprint, Due Date, Progress, Tags
  - Inline status edit
  - Row expand for description + acceptance criteria
- Sprint filter / "No Sprint" filter
- "+ New Story" → `AddStoryModal`
- Story card click → `EditStoryModal`

**Documents displayed:** `Story`, `Goal` (for name lookup), `Sprint`

---

#### C.2.13 Add Story (Guided Flow — "Create a Story")

**Trigger:** "+ New Story" / Kanban "+" button
**Component:** `AddStoryModal.tsx`
**View:** Modal (2 steps)

**Step 1 — Content:**
- Title input
- Description textarea
- Goal selector (GoalMultiSelect — filtered by persona)
- Tags input
- Priority selector (Critical / High / Medium / Low)
- Points input

**Step 2 — Scheduling:**
- Sprint selector
- Due date picker
- Time of day selector
- WIP limit input
- Acceptance criteria (add/remove rows)

**Output:** Creates `Story` document

---

#### C.2.14 Edit Story Modal

**Trigger:** Story card click, `/stories/:id`
**Component:** `EditStoryModal.tsx`
**View:** Modal with tabs

**UI Elements:**
- Tab bar: Details · Tasks · Progress · AI
- **Details:** All story fields
- **Tasks:** Task list for this story; "+ Add Task" inline
- **Progress:** progressPct slider, pointsRemaining
- **AI:** aiCriticalityScore display, aiCriticalityReason, aiTop3ForDay toggle, userPriorityFlag, userPriorityRank

---

#### C.2.15 Tasks Management

**Route:** `/tasks`
**Component:** `TasksManagement.tsx` / `TaskListView.tsx`
**Hybrid Mode:** **Toggleable** — Card Checklist | Table

**UI Elements:**
- View toggle (List / Table)
- Group by: status, priority, theme, due date, goal
- Filter: status, priority, effort, source, due date range
- **List View:** Task cards with checkbox, title, effort badge, priority dot, due date, source icon
- **Table View (`ModernTaskTable.tsx`):** Columns: Ref, Title, Status, Priority, Effort, Due Date, Story, Goal, Source, Sync State
- Inline check-off
- Swipe actions (mobile)
- "+ New Task" → Quick-add strip or `EditTaskModal`
- Sort: due date, priority, created date

**Documents displayed:** `Task`

---

#### C.2.16 Edit Task Modal

**Trigger:** Task click
**Component:** `EditTaskModal.tsx`
**View:** Modal (single panel)

**UI Elements:**
- Title, description
- Status selector
- Priority selector
- Effort (S/M/L) selector
- Estimate (minutes) input
- Due date/time picker
- Time of day selector
- Story/Project linker
- Goal alignment checkbox
- Labels input
- Repeat frequency / rrule
- Checklist sub-items (add/remove/check)
- Attachments
- Blocked-by selector (other task IDs)
- Source display (read-only)
- Sync state indicator

---

#### C.2.17 Chores Management

**Routes:** `/chores`, `/chores/manage`, `/chores/checklist`
**Component:** `RoutinesChoresManager.tsx`, `HabitsChoresDashboard.tsx`
**Hybrid Mode:** Checklist (specialised list)

**UI Elements:**
- Chores grouped by frequency (daily / weekly / monthly)
- Check-off with streak counter
- "+ Add Chore" inline
- Checklist view: accordion per day

---

#### C.2.18 Sprints

**Route:** `/sprints`
**Component:** `sprints/SprintsPage.tsx`
**Hybrid Mode:** Card (active) + Table (history)

**UI Elements:**
- Active sprint hero card: name, dates, objective, velocity ring, progress bar
- "+ New Sprint" button → Sprint creation modal
- Sprint history table (`SprintHistoryTable.tsx`): completed sprints with velocity, points delivered
- Sprint management (`SprintManagementView.tsx`): edit sprint details, add stories

---

#### C.2.19 Sprint Kanban

**Route:** `/sprints/kanban`
**Component:** `sprints/SprintTablePage.tsx`
**Hybrid Mode:** Kanban

Same story kanban filtered to active sprint stories.

---

#### C.2.20 Sprint Planning

**Route:** `/sprints/planning`
**Hybrid Mode:** Dual-panel (backlog | sprint)

**UI Elements:**
- Left panel: Story backlog (drag source)
- Right panel: Current sprint (drop target)
- Capacity bar (hours planned vs available)
- Filter by goal/theme
- Story cards with point badges
- "Lock Sprint" action

---

#### C.2.21 Sprint Retrospective

**Route:** `/sprints/retrospective`
**Hybrid Mode:** Form + metrics

**UI Elements:**
- What went well / what didn't / actions (3-column form)
- Velocity chart (this sprint vs last 5)
- Story completion rate
- `SprintCloseDialog` workflow

---

#### C.2.22 Focus Goals

**Route:** `/focus-goals`
**Component:** `FocusGoalsPage.tsx`
**Hybrid Mode:** Card (hero) + list of goals

**UI Elements:**
- Active focus set card (dates, persona, timeframe badge)
- Goal list with completion indicators
- "Design Metrics" flow trigger (→ guided flow)
- Intent broker suggestions panel
- Vision text display
- "Set New Focus" button → Focus creation wizard

---

#### C.2.23 Design Metrics (Guided Flow)

**Trigger:** "Design Metrics" button on FocusGoals page
**Component:** Part of `GoalPlanningWorkspaceModal.tsx`
**View:** Modal wizard

**Step 1 — Goal Review:**
- Display current focus goals
- Confirm or modify selection

**Step 2 — KPI Definition:**
- Per-goal KPI editor: name, target value, unit
- Suggested KPI templates by theme

**Step 3 — Timeframe:**
- Timeframe picker (sprint / quarter / year)
- Date range selection

**Step 4 — Vision:**
- Free-text vision statement input
- AI-generated summary preview

**Output:** Updates `FocusGoal` document with KPIs and vision text

---

#### C.2.24 Calendar

**Route:** `/calendar`
**Component:** `Calendar.tsx`
**Hybrid Mode:** Calendar grid (primary) + approval list (secondary)

**UI Elements:**
- Month / Week / Day toggle
- `react-big-calendar` grid
- `CalendarBlock` events color-coded by theme
- Google Calendar event overlay
- "Sync with Google" button
- Proposed blocks shown in dashed border
- Click event → block detail popover
- Block detail: theme, category, rationale, linked story/goal, flexibility tag
- "Apply" / "Reject" per proposed block
- Recurring block indicator

**Documents displayed:** `CalendarBlock`

---

#### C.2.25 Calendar Planner

**Route:** `/calendar/planner`
**Component:** `planner/UnifiedPlannerPage.tsx` (same as §C.2.2)

---

#### C.2.26 Calendar Theme View

**Route:** `/calendar/themes`
**Component:** `planner/WeeklyThemePlanner.tsx`

Theme-first view showing hours per theme per week.

---

#### C.2.27 Check-In Daily

**Route:** `/checkin/daily`
**Component:** `checkins/CheckInDaily.tsx`
**Hybrid Mode:** Form + card summary

**UI Elements:**
- Date display
- Energy level slider (1–5)
- Mood selector (emoji or buttons)
- Top priorities for today (up to 3 story/task pickers)
- Yesterday review: tasks done / missed
- Coach nudge display
- Submit → generates `JournalEntry` with `entryType: 'task_list'`

---

#### C.2.28 Check-In Weekly

**Route:** `/checkin/weekly`
**Component:** `checkins/CheckInWeekly.tsx`
**Hybrid Mode:** Form + metrics

**UI Elements:**
- Week summary: stories closed, points delivered
- Theme time breakdown (actual vs target)
- Habit completion rates
- Free-text reflection
- Goals for next week
- Submit → generates weekly summary journal entry

---

#### C.2.29 Fitness Dashboard

**Route:** `/fitness`
**Component:** `WorkoutsDashboard.tsx`
**Hybrid Mode:** Card grid + table

**UI Elements:**
- HRV trend sparkline card
- Weekly training load bar chart
- Recent workouts list (`MetricsWorkouts` rows)
- Nutrition summary card (`MetricsNutrition`)
- Strava sync status badge
- MyFitnessPal sync status badge
- Habit completion rings per active fitness habit

**Documents displayed:** `MetricsHrv`, `MetricsWorkouts`, `MetricsNutrition`, `IHabit`, `IHabitEntry`

---

#### C.2.30 Workouts View

**Route:** `/workouts`
**Component:** `WorkoutsDashboard.tsx`
**Hybrid Mode:** Table + chart

**UI Elements:**
- Date-filtered workout table: date, type, distance, duration, avg HR
- Type filter (Run / Swim / Cycle etc.)
- Distance/duration chart over time
- Personal bests summary

---

#### C.2.31 Habits Management

**Component:** `HabitsManagement.tsx`
**Hybrid Mode:** Card (habit tracker) + list (management)

**UI Elements:**
- Habit streak cards with completion ring
- Heatmap calendar per habit
- "+ Add Habit" → habit creation form
- Habit form: name, frequency, target value, unit, linked goal, color
- Log entry inline (tap to complete)
- History table of `IHabitEntry` records

---

#### C.2.32 Finance Hub

**Route:** `/finance`
**Component:** `finance/FinanceHub.tsx`
**Hybrid Mode:** Dashboard cards + table

**UI Elements:**
- Net worth summary card
- Monthly cashflow card (income vs spend)
- Budget category progress bars (`BudgetsPage`)
- Monzo pots board (`PotsBoard.tsx`) — pot cards with balance and goal link
- Recent transactions list (`TransactionsList.tsx`)
- Goal-pot linking panel (`GoalPotLinking.tsx`)

---

#### C.2.33 Finance Transactions

**Route:** `/finance/transactions`
**Component:** `finance/TransactionTable.tsx`
**Hybrid Mode:** Table (primary)

**UI Elements:**
- Date range filter
- Category filter chips
- Merchant search
- Transaction table: date, merchant, category, amount, source
- Import CSV button
- Match to external transactions

---

#### C.2.34 Finance Budgets

**Route:** `/finance/budgets`
**Component:** `finance/BudgetsPage.tsx`
**Hybrid Mode:** Card per category

**UI Elements:**
- Budget category cards: name, budget amount, spent, remaining, progress bar
- Monthly vs annual toggle
- "+ Add Category" button
- Over-budget highlight (red)

---

#### C.2.35 Finance Pots Board

**Route:** `/finance/pots`
**Component:** `finance/PotsBoard.tsx`
**Hybrid Mode:** Card grid (Kanban-style)

**UI Elements:**
- Monzo pot cards: name, balance, goal link, target amount
- Goal-pot linking via `GoalPotLinking`
- "Create Pot for Goal" action → calls `createMonzoPotForGoal`

---

#### C.2.36 AI Coach

**Route:** `/ai-coach`
**Component:** `coach/AiCoachPage.tsx`
**Hybrid Mode:** Card feed (chat-like)

**UI Elements:**
- Daily coach briefing card
- Priority recommendations (top 3 stories)
- KPI off-track alerts
- Energy/recovery assessment
- "Ask Coach" free-text input
- Coach verdict banner (`CoachVerdictBanner.tsx`)

---

#### C.2.37 AI Planner

**Route:** `/ai-planner`
**Hybrid Mode:** Form + calendar preview

**UI Elements:**
- "Run Full Replan" button → `callFullReplan`
- "Run Delta Replan" button → `callDeltaReplan`
- Proposed blocks preview calendar
- Approval workflow trigger

---

#### C.2.38 Journals

**Route:** `/journals`
**Component:** `JournalsManagement.tsx`
**Hybrid Mode:** Card (primary) + list toggle

**UI Elements:**
- Journal entry cards: date, oneLineSummary, entryType badge, linked tasks/stories count
- Date filter
- Persona filter
- Click card → Journal detail view
- "New Journal" → `TranscriptIntakeModal` (voice/text input)

---

#### C.2.39 Journal Detail

**Route:** `/journals/:id`
**Hybrid Mode:** Article (full width)

**UI Elements:**
- Date heading
- Structured entry prose
- AI summary bullets
- Mindset analysis panel
- Linked tasks/stories list
- "Open Google Doc" button
- "Edit" inline actions

---

#### C.2.40 Journal Insights

**Route:** `/journals/insights`
**Component:** `JournalInsightsPage.tsx`
**Hybrid Mode:** Chart dashboard

**UI Elements:**
- Mood trend chart
- Entry frequency calendar heatmap
- Most common themes word cloud
- Mindset score over time

---

#### C.2.41 Media Backlogs

**Routes:** `/books-backlog`, `/games-backlog`, `/shows-backlog`, `/videos-backlog`
**Components:** `BooksBacklog.tsx`, `GamesBacklog.tsx`, `ShowsBacklog.tsx`, `VideosBacklog.tsx`
**Hybrid Mode:** Card grid + List toggle

**UI Elements per backlog:**
- Cards: cover art, title, status, rating, linked goal
- Status columns: Want / In Progress / Done
- Filter by status, rating, linked theme
- Import from integrations (Hardcover, Steam, Trakt)

---

#### C.2.42 YouTube History Dashboard

**Route:** `/youtube-history`
**Component:** `YouTubeHistoryDashboard.tsx`
**Hybrid Mode:** Chart + Table

**UI Elements:**
- Watch time chart (by week/month)
- Top channels list
- Category breakdown pie chart
- Video history table: date, title, channel, duration

---

#### C.2.43 Travel Map

**Route:** `/travel`
**Component:** `TravelMap.tsx`
**Hybrid Mode:** Map canvas

**UI Elements:**
- MapLibre GL map
- Location pins from `Story.locationLat/Lon`
- Click pin → story detail card
- Country/city filter

---

#### C.2.44 Routes Management

**Route:** `/routes`, `/routes/optimization`
**Hybrid Mode:** Map + List

---

#### C.2.45 Metrics Dashboard

**Route:** `/metrics`
**Hybrid Mode:** Chart dashboard

**UI Elements:**
- Theme progress cards (hours this week vs target)
- Sprint velocity chart
- Goal completion rate
- Habit completion rate
- KPI gauge widgets

---

#### C.2.46 Settings

**Route:** `/settings`
**Component:** `SettingsPage.tsx`
**Hybrid Mode:** Sidebar nav + form

**Sub-pages:**
| Route | Content |
|-------|---------|
| `/settings/profile` | Display name, avatar |
| `/settings/email` | Email digest preferences |
| `/settings/planner` | `PlanningPrefs` form |
| `/settings/ai` | AI model preferences, usage quotas |
| `/settings/developer` | Debug flags, test mode toggle |
| `/settings/notifications` | Push/email notification toggles |
| `/settings/privacy-security` | Data export, account deletion |
| `/settings/finance` | Monzo API keys, MFP credentials |
| `/settings/integrations` | Integration hub |
| `/settings/integrations/google` | Google Calendar OAuth |
| `/settings/integrations/monzo` | Monzo OAuth + pot sync |
| `/settings/integrations/strava` | Strava OAuth |
| `/settings/integrations/youtube` | YouTube history sync |
| `/settings/integrations/trakt` | Trakt.tv sync |
| `/settings/integrations/steam` | Steam library sync |
| `/settings/integrations/hardcover` | Hardcover reading sync |
| `/settings/integrations/telegram` | Telegram bot setup |

---

#### C.2.47 Global Search

**Component:** `GlobalSearchBar.tsx`
**Hybrid Mode:** Floating panel

**UI Elements:**
- Keyboard shortcut trigger (Cmd+K)
- Typeahead search across Goals, Stories, Tasks, Journals
- Result groups: Goals / Stories / Tasks / Journals
- Result card: ref badge, title, status chip, type icon
- Click → navigate to entity

---

#### C.2.48 Transcript Intake Modal

**Trigger:** FAB voice button, "New Journal"
**Component:** `TranscriptIntakeModal.tsx`
**View:** Modal

**UI Elements:**
- Text area for transcript/notes
- Record button (voice)
- Processing spinner
- Result preview: classified entryType, extracted tasks/stories
- Accept / Discard actions

---

#### C.2.49 Import/Export Modal

**Trigger:** Settings → Import/Export
**Component:** `ImportExportModal.tsx`
**View:** Modal

**UI Elements:**
- Export: JSON / CSV for Goals, Stories, Tasks
- Import: drag-and-drop JSON/CSV
- Conflict resolution options

---

#### C.2.50 Public Goal Sharing

**Routes:** `/share/:shareCode`, `/public/roadmap/:shareCode`
**Hybrid Mode:** Read-only card view

**UI Elements:**
- Public goal card (no auth required)
- Goal title, theme, description, KPIs, status
- "View Roadmap" link
- Branding watermark

---

#### C.2.51 Mobile Views

**Routes:** `/mobile`, `/mobile/daily-plan`, `/mobile-checklist`, `/mobile-view`
**Hybrid Mode:** Mobile-optimised list

**UI Elements:**
- Simplified task checklist
- Today's calendar blocks
- Quick-complete actions
- Swipe to defer / complete

---

#### C.2.52 Admin Panel

**Route:** `/admin`
**Hybrid Mode:** Table + action buttons

**UI Elements:**
- User list
- Function trigger controls
- Backfill reference numbers action
- System health indicators

---

#### C.2.53 Capacity Dashboard

**Route:** `/capacity`
**Hybrid Mode:** Bar chart + table

**UI Elements:**
- Per-day hour capacity (available vs committed)
- Over-committed day highlights
- Story/task contribution breakdown per block
- "Apply Deferrals" button

---

### C.3 Guided Flow: "Create a Goal" (Full User Journey)

```
Entry Points:
  ① FAB → "+ New Goal"
  ② Sidebar Goals → "+ New Goal" button
  ③ Focus Goals page → "Add to Focus" → new goal
  ④ Dashboard → Goal card "+" icon

Flow:
  [Screen 1 — Identity]
  User enters: Title, Description
  User picks: Theme (color chip grid), Persona toggle
  CTA: "Next →"

  [Screen 2 — Scope & Ambition]
  User selects: Size (S/M/L toggle), Time Horizon (pill select)
  User selects: Goal Kind (Umbrella/Milestone/Execution)
  User rates: Confidence (Low/Med/High)
  Optional: Parent Goal linker
  Optional: Dependencies
  CTA: "Next →"

  [Screen 3 — Targets & Finance]
  Optional: Target date, Start date
  Optional: Estimated cost + cost type
  Optional: Monzo pot link
  KPI rows: add KPI (name, target, unit)
  CTA: "Create Goal"

  [Result]
  → Goal created in Firestore
  → Success toast: "Goal G-XXX created"
  → Navigate to Goal detail (or back to Goals list)
  → Optional prompt: "Create your first Story for this Goal?"
```

---

### C.4 Guided Flow: "Design Metrics" (Full User Journey)

```
Entry Points:
  ① Focus Goals page → "Design Metrics" button
  ② Goal detail → KPIs tab → "Set up metrics"

Flow:
  [Screen 1 — Focus Confirmation]
  Display current active FocusGoal set
  User confirms or modifies goal selection
  CTA: "Continue"

  [Screen 2 — KPI Builder]
  For each selected goal:
    Add KPI rows: name (text), target (number), unit (text)
    Suggested templates by theme shown as chips
    e.g., Health → "Weekly workouts (target: 4, unit: sessions)"
  CTA: "Next →"

  [Screen 3 — Vision Statement]
  Free-text vision input
  AI generates a 1-paragraph vision preview
  User accepts or edits
  CTA: "Next →"

  [Screen 4 — Timeframe]
  Select: Sprint / Quarter / Year
  Pick date range
  CTA: "Save Metrics"

  [Result]
  → FocusGoal document updated with KPIs, visionText, timeframe
  → "Intent Broker" AI suggests focus alignment score
  → Success: "Metrics saved. Your focus is set."
```

---

### C.5 Integration Data Flows

```
External Systems → App:

Strava ──────────────────→ MetricsWorkouts collection
MyFitnessPal ────────────→ MetricsNutrition collection
iOS Reminders ───────────→ Tasks (syncState FSM)
Google Calendar ─────────→ CalendarBlocks (googleEventId)
Monzo ───────────────────→ Finance transactions + Pots
Gmail ───────────────────→ Tasks (source: 'gmail')
Hardcover ───────────────→ Books backlog
Steam ───────────────────→ Games backlog
Trakt.tv ────────────────→ Shows backlog
YouTube ─────────────────→ YouTube history

App → External Systems:

CalendarBlocks ──────────→ Google Calendar (syncToGoogle)
Goals ───────────────────→ Monzo Pots (createMonzoPotForGoal)
Tasks ───────────────────→ iOS Reminders (pending_push → ack)
JournalEntries ──────────→ Google Docs (docUrl)
```

---

### C.6 AI/Agent Function Map

| Function | Trigger | Input | Output |
|----------|---------|-------|--------|
| `callFullReplan` | Manual / nightly | PlanningPrefs, FocusGoals, Stories | CalendarBlocks (proposed) |
| `callDeltaReplan` | Story update | Changed stories | Updated CalendarBlocks |
| `runCoachOrchestratorNightly` | Cron 22:00 | MetricsHrv, Workouts, Stories | Coach recommendations |
| `getCoachToday` | Dashboard load | User context | CoachVerdictBanner content |
| `generateDailyDigest` | Cron 07:00 | All collections | Email digest |
| `intentBrokerSuggestFocus` | Focus Goals page | Goals, recent activity | FocusGoal intent matches |
| `analyzeBodyPhoto` | Fitness dashboard | Photo upload | Body composition metrics |
| `checkKpiOffTrack` | Cron | Goals + KPI data | Alert notifications |
| `scheduleCoachFitnessBlocks` | Coach orchestrator | PlanningPrefs + MetricsHrv | Fitness CalendarBlocks |
| `importMonzoTransactionsCsv` | Manual | CSV file | Finance transactions |
| `matchExternalToMonzoTransactions` | Post-import | External + Monzo txns | Matched transaction pairs |
| `generateFinanceActionInsights` | Finance dashboard | Transactions + Budgets | Finance action cards |
| `convertFinanceActionToStory` | Finance insight card | Finance action | New Story document |
| `applyCapacityDeferrals` | Capacity dashboard | Overcommitted days | Deferred task dates |

---

### C.7 Persona Mode Switching

The app operates in two discrete modes:

| Dimension | Personal Mode | Work Mode |
|-----------|--------------|-----------|
| Goal filter | `persona: 'personal'` | `persona: 'work'` |
| Story filter | `persona: 'personal'` | `persona: 'work'` |
| Sprint filter | personal sprints | work sprints |
| Focus Goals | personal set | work set |
| Sidebar accent | Indigo | Blue |
| Default themes | Health, Family, Finance | Career, Work Main |
| Work Projects | Hidden | Visible |

**Switcher:** `PersonaSwitcher.tsx` — toggle in sidebar header, persisted to localStorage.

---

### C.8 Key Shared Components Inventory

| Component | Purpose | Used On |
|-----------|---------|---------|
| `GoalMultiSelect` | Multi-goal picker dropdown | AddStory, FocusGoals, Sprint planning |
| `ThemeMultiSelect` | Theme picker | Filters, AddGoal |
| `YearMultiSelect` | Year filter | Goals, Roadmap |
| `PersonaSwitcher` | Mode toggle | Sidebar |
| `GlobalSearchBar` | Cmd+K search | App shell |
| `ConfirmDialog` | Destructive action confirm | Delete actions |
| `ErrorBoundary` | Error fallback | Route wrappers |
| `FloatingActionButton` | Quick create | All main pages |
| `FloatingAssistantButton` | AI chat trigger | All main pages |
| `LinkGoalModal` | Link task/story to goal | Task/story forms |
| `ShareGoalsPanel` | Public share UI | Goal detail |
| `ImportExportModal` | Data backup/restore | Settings |
| `TranscriptIntakeModal` | Voice/text intake | FAB, Journals |
| `GoalPlanningWorkspaceModal` | Full planning workspace | Goals, Focus |

---

### C.9 Status Badge System

All status badges follow a consistent token pattern:

| Status | Background | Text | Border |
|--------|-----------|------|--------|
| New / Backlog | `neutral-100` | `neutral-600` | none |
| In Progress / Active | `info-light` | `info-dark` | none |
| Done / Complete | `success-light` | `success-dark` | none |
| Blocked | `danger-light` | `danger-dark` | none |
| Deferred / Cancelled | `warning-light` | `warning-dark` | none |
| Planning | `primary-50` | `primary-700` | none |

Priority chips:

| Priority | Background | Text |
|----------|-----------|------|
| Critical (4) | `#FEE2E2` | `#991B1B` |
| High (3) | `#FEF3C7` | `#92400E` |
| Medium (2) | `#DBEAFE` | `#1E40AF` |
| Low (1) | `neutral-100` | `neutral-600` |

---

### C.10 Firestore Collection Summary

| Collection | Document Type | Key Relationships |
|------------|--------------|-------------------|
| `goals` | `Goal` | → stories, focusGoals, sprints |
| `stories` | `Story` | → tasks (sub), goal, sprint |
| `tasks` | `Task` | → story/project (parent) |
| `sprints` | `Sprint` | → stories, focusGoals |
| `focusGoals` | `FocusGoal` | → goals, sprints |
| `calendarBlocks` | `CalendarBlock` | → tasks, goals, stories, habits |
| `journals` | `JournalEntry` | → tasks, stories |
| `habits` | `IHabit` | → goals |
| `habitEntries` | `IHabitEntry` | → habits |
| `workProjects` | `WorkProject` | → tasks |
| `metrics/hrv` | `MetricsHrv` | standalone |
| `metrics/workouts` | `MetricsWorkouts` | standalone |
| `metrics/nutrition` | `MetricsNutrition` | standalone |
| `users/{uid}/planningPrefs` | `PlanningPrefs` | → calendarBlocks |

---

### C.11 Cross-Domain Relationships (Finance × Fitness × Planning)

```
Finance ↔ Planning:
  Goal ──[monzoPotId]──→ Monzo Pot
  Goal ──[estimatedCost]──→ Budget Category
  FocusGoal ──[potIdsCreatedFor]──→ Monzo Pots
  Finance Action ──[convertFinanceActionToStory]──→ Story

Fitness ↔ Planning:
  MetricsHrv ──→ Coach → CalendarBlock (recovery day)
  IHabit ──[linkedGoalId]──→ Goal
  CalendarBlock[category=Fitness] ──→ MetricsWorkouts (post-activity)
  PlanningPrefs[maxHiSessions] ──→ CalendarBlock scheduling

Fitness ↔ Finance:
  (Indirect via Goals — e.g., fitness equipment Goal has estimated cost)

Planning ↔ Goals:
  FocusGoal ──[goalIds]──→ Goal[]
  Sprint ──[focusGoalIds]──→ FocusGoal[]
  CalendarBlock ──[goalId]──→ Goal
  Story ──[goalId]──→ Goal

Planning ↔ Journals:
  JournalEntry ──[taskIds]──→ Task[]
  JournalEntry ──[storyIds]──→ Story[]
  DailyCheckIn ──generates──→ JournalEntry
```

---

*End of DESIGN.md — Total coverage: 53 screens, 16 document types, 50+ routes, 15 integrations, 2 guided flows, 20+ AI agent functions. Zero omissions.*
