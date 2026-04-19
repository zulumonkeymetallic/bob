# BOB UX Audit — 01: Surface Inventory & Route Map

**Audit date**: 2026-03-17
**Scope**: `/Users/jim/GitHub/bob/react-app/src`
**Source**: App.tsx route map, SidebarLayout.tsx, MobileHome.tsx

---

## Classification Key

| Column | Values |
|--------|--------|
| **Layout** | `table` / `kanban` / `card` / `planner` / `dashboard` / `mobile-tab` / `chart` / `form` / `list` / `redirect` |
| **Mobile** | `full` — mobile-first surface; `partial` — responsive but not optimised; `inaccessible` — technically renders but unusable; `desktop-only` — should not be exposed on mobile |
| **Status** | `primary` — current main surface for this workflow; `alternate` — valid alternative view; `legacy` — keep for compat but should not guide UX decisions; `redirect` — no own UI |

---

## Domain 1 — Dashboard & Overview

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/` | RootRedirect | redirect | — | redirect | Sends mobile → `/mobile`, desktop conditionally to `/dashboard`, `/sprints/kanban`, or `/calendar` by time of day |
| `/dashboard` | Dashboard | dashboard | partial | primary | Multi-card layout with banners, sprint status, calendar events, habits |
| `/metrics` | AdvancedOverview | chart | desktop-only | primary | Recharts analytics; no mobile adaptation |
| `/metrics/progress` | ThemeProgressDashboard | chart | desktop-only | alternate | Theme-specific progress visualization |
| `/mobile-priorities` | MobilePriorityDashboard | card | full | alternate | Mobile-optimised priority card grid |

---

## Domain 2 — Task Management

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/tasks` | TaskListView → ModernTaskTable or TasksCardView | table / card | partial | primary | Toggle between table and card view; no auto-switch on mobile |
| `/tasks/:id` | DeepLinkTask | form | partial | primary | Deep link detail wrapper |
| `/task` | → `/tasks` | redirect | — | redirect | Legacy compat |
| `/tasks-management` | TasksManagement | kanban | desktop-only | legacy | Sprint-based kanban; superseded by `/sprints/kanban` |

**Competing implementations**: ModernTaskTable (table), TasksCardView (card). Both rendered by TaskListView with a toggle. No dedicated mobile list surface.

---

## Domain 3 — Story Management

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/stories` | StoriesManagement → ModernStoriesTable or StoriesCardView | table / card | partial | primary | Toggle between views; same pattern as tasks |
| `/stories/:id` | DeepLinkStory | form | partial | primary | Deep link detail wrapper |
| `/sprints/stories` | StoriesManagement | table / card | partial | alternate | Same component in sprint context |

**Competing implementations**: ModernStoriesTable (table), StoriesCardView (card), SortableStoryCard inside Kanban. Three rendering contexts for the same data type.

---

## Domain 4 — Kanban & Sprint Boards

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/sprints/kanban` | SprintKanbanPageV2 → KanbanBoardV2 | kanban | inaccessible | primary | 3-column drag-and-drop; horizontal scroll on mobile — not usable |
| `/kanban` | → `/sprints/kanban` | redirect | — | redirect | Legacy compat |
| `/current-sprint` | → `/sprints/kanban` | redirect | — | redirect | Legacy compat |

**Note**: `ModernKanbanBoard.tsx` exists but its relationship to `KanbanBoardV2.tsx` is unclear. One appears to be a predecessor; the other drives the primary kanban. This should be resolved in a codebase triage separate from this audit.

---

## Domain 5 — Goals Management

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/goals` | GoalsManagement → ModernGoalsTable or GoalsCardView | table / card | partial | primary | Toggle views; no auto-switch |
| `/goals/:id` | DeepLinkGoal | form | partial | primary | Deep link detail wrapper |
| `/goals-management` | GoalsManagement | table / card | partial | redirect | Duplicate path for same component |
| `/focus-goals` | FocusGoalsPage | dashboard | desktop-only | primary | Focus goals hub with countdown banner, wizard, KPI studio |
| `/goals/year-planner` | GoalsYearPlanner | planner | desktop-only | primary | Hierarchical year-grid planning — complex interaction |
| `/goals/roadmap` | GoalRoadmapV5 | chart | desktop-only | primary | Current default roadmap alias |
| `/goals/roadmap-v5` | GoalRoadmapV5 | chart | desktop-only | alternate | Explicit V5 route |
| `/goals/roadmap-v6` | GoalRoadmapV6 | chart | desktop-only | primary | Latest with hierarchy support — should become default |
| `/goals/roadmap-legacy` | GoalRoadmapV3 | chart | desktop-only | legacy | V3 Gantt; superseded by V5/V6 |
| `/goals/viz` | GoalVizPage | chart | desktop-only | alternate | Goal visualisation page |
| `/goals/timeline` | EnhancedGanttChart | chart | desktop-only | alternate | Timeline Gantt variant |

**Competing implementations**: 4 roadmap variants (V3, V5, V6, EnhancedGantt). Only V6 should be treated as the design target going forward.

---

## Domain 6 — Sprints & Planning

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/sprints` | SprintsPage | list | partial | primary | Sprint list landing page |
| `/sprints/management` | SprintManagementView | tab | desktop-only | primary | Multi-tab hub: overview / board / table / burndown / retrospective / history |
| `/sprints/table` | SprintTablePage → ModernSprintsTable | table | desktop-only | alternate | Sprint table extracted |
| `/sprints/planning` | SprintPlanningMatrix | planner | desktop-only | primary | Planning matrix; complex interaction |
| `/sprints/capacity` | CapacityDashboard | chart | desktop-only | primary | Capacity planning chart |
| `/sprints/retrospective` | SprintRetrospective | form | partial | alternate | Retrospective form |
| `/sprint-planning` | → `/sprints/management` | redirect | — | redirect | Legacy compat |
| `/sprint-simple` | → `/sprints/management` | redirect | — | redirect | Legacy compat |
| `/sprint-matrix` | → `/sprints/management` | redirect | — | redirect | Legacy compat |

---

## Domain 7 — Calendar & Planner

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/calendar` | UnifiedPlannerPage | planner | inaccessible | primary | React Big Calendar with drag-and-drop; not touch-safe |
| `/calendar/planner` | WeeklyThemePlanner | planner | desktop-only | alternate | Theme-based week view |
| `/calendar/themes` | → `/calendar/planner` | redirect | — | redirect | Legacy compat |
| `/calendar/integration` | CalendarIntegrationView | form | partial | primary | Google Calendar sync settings |
| `/calendar/sync` | CalendarIntegrationView | form | partial | redirect | Duplicate route for same component |
| `/checkin/daily` | CheckInDaily | form | full | primary | Short daily checkin; mobile-appropriate |
| `/checkin/weekly` | CheckInWeekly | form | full | primary | Weekly review form |
| `/planning` | → `/calendar` | redirect | — | redirect | Legacy compat |
| `/planning/approvals` | ApprovalsCenter | list | partial | primary | Approval queue |
| `/planning/approval` | PlanningApprovalPage | form | partial | primary | Single approval detail |

**Note**: `DailyPlanPage.tsx` is not a standalone route — it is embedded inside other components as a multi-mode panel (list/plan/review/checkin).

---

## Domain 8 — Finance

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/finance/dashboard` | FinanceDashboardAdvanced | dashboard | inaccessible | primary | Multi-tab: charts, budget, categories — complex; no mobile adaptation |
| `/finance/advanced` | → `/finance/dashboard` | redirect | — | redirect | Legacy compat |
| `/finance` | → `/finance/dashboard` | redirect | — | redirect | Legacy compat |
| `/finance/budgets` | BudgetsPage | table | desktop-only | primary | Budget table and edit modals |
| `/finance/merchants` | MerchantMappings | table | desktop-only | primary | Merchant mapping configuration |
| `/finance/categories` | → `/finance/merchants` | redirect | — | redirect | Legacy compat |
| `/finance/transactions` | TransactionsList | table | desktop-only | primary | Dense transaction table |
| `/finance/flow` | FinanceFlowDiagram | chart | desktop-only | alternate | Sankey flow diagram |
| `/finance/pots` | PotsBoard | kanban | desktop-only | alternate | Money pot kanban board |
| `/finance/goals` | GoalPotLinking | form | desktop-only | primary | Goal-to-pot linking interface |

**Competing implementations**: 3 finance dashboard components (FinanceDashboard, FinanceDashboardModern, FinanceDashboardAdvanced). Only FinanceDashboardAdvanced is currently active via routing.

---

## Domain 9 — Fitness & Health

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/fitness` | WorkoutsDashboard | dashboard | partial | primary | Workout charts + Strava/Parkrun table |
| `/parkrun-results` | WorkoutsDashboard | dashboard | partial | alternate | Parkrun-specific variant |
| `/running-results` | → `/fitness` | redirect | — | redirect | Legacy compat |
| `/workouts` | → `/fitness` | redirect | — | redirect | Legacy compat |

---

## Domain 10 — Chores & Habits

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/dashboard/habit-tracking` | HabitsChoresDashboard | dashboard | partial | primary | Habit tracking grid |
| `/habits` | → `/dashboard/habit-tracking` | redirect | — | redirect | Legacy compat |
| `/chores` | ChoresTasksPage | list | partial | primary | Chore task management |
| `/chores/checklist` | ChoreChecklistPage | list | full | primary | Checklist-style chore view; mobile-appropriate |

---

## Domain 11 — Content Backlogs

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/games-backlog` | GamesBacklog | list | partial | primary | Game backlog |
| `/shows-backlog` | ShowsBacklog | list | partial | primary | TV shows backlog |
| `/books-backlog` | BooksBacklog | list | partial | primary | Books backlog |
| `/videos-backlog` | VideosBacklog | list | partial | primary | Videos backlog |
| `/youtube-history` | YouTubeHistoryDashboard | dashboard | desktop-only | primary | YouTube history analytics |
| `/personal-lists` | BacklogManager | list | partial | legacy | Generic personal lists |
| `/personal-lists-modern` | PersonalListsManagement | table | partial | primary | Modern table variant |

---

## Domain 12 — Journals

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/journals` | JournalsManagement | list | partial | primary | Journal list |
| `/journals/insights` | JournalInsightsPage | dashboard | desktop-only | primary | AI-generated journal insights |
| `/journals/:id` | JournalsManagement | form | partial | primary | Single journal detail |

---

## Domain 13 — Settings & Integrations

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/settings` | SettingsPage | tab | desktop-only | primary | Multi-tab hub: profile/ai/finance/notifications/privacy/developer |
| `/settings/email` | SettingsEmailPage | form | desktop-only | primary | Email settings |
| `/settings/planner` | SettingsPlannerPage | form | desktop-only | primary | Planner settings |
| `/settings/integrations` | IntegrationSettings | list | desktop-only | primary | Integration hub |
| `/settings/integrations/*` | Various | form | desktop-only | primary | Per-integration settings (Google, Monzo, Strava, Steam, Hardcover, Trakt, YouTube) |

---

## Domain 14 — Mobile-First Surfaces

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/mobile` | MobileHome | mobile-tab | full | primary | 5-tab: overview / tasks / stories / goals / chores — the only intentional mobile UI |
| `/mobile-view` | MobileView | list | full | primary | Mobile detail view |
| `/mobile-checklist` | MobileChecklistView | list | full | primary | Mobile checklist view |

---

## Domain 15 — Diagnostics & Logs

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/logs/integrations` | IntegrationLogs | list | desktop-only | primary | Integration log viewer |
| `/logs/ai` | AiDiagnosticsLogs | list | desktop-only | primary | AI diagnostics |
| `/logs/transcripts` | TranscriptProcessingLogs | list | desktop-only | primary | Transcript processing logs |

---

## Domain 16 — Miscellaneous & Visualisation

| Route | Component | Layout | Mobile | Status | Notes |
|-------|-----------|--------|--------|--------|-------|
| `/travel` | TravelMap | chart | desktop-only | primary | Travel map (lazy-loaded) |
| `/canvas` | VisualCanvas | chart | desktop-only | primary | Visual canvas |
| `/visual-canvas` | VisualCanvas | chart | desktop-only | redirect | Duplicate route |
| `/routes` | RoutesManagementView | list | desktop-only | primary | Route management |
| `/routes/optimization` | RoutesManagementView | list | desktop-only | primary | Route optimisation |
| `/share/:shareCode` | PublicGoalView | card | partial | primary | Public shared goal view |

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Total routes (including redirects) | ~65 |
| Redirect-only routes | ~18 |
| Unique UI surfaces | ~47 |
| Mobile-first surfaces | 3 (`/mobile`, `/mobile-view`, `/mobile-checklist`) |
| Fully mobile-appropriate surfaces | ~8 (checkins, chore checklist, approvals, forms) |
| Surfaces classified as `inaccessible` on mobile | ~6 (kanban, finance dashboard, calendar/planner, roadmap, sprint planning, year planner) |
| Surfaces classified `desktop-only` by design intent | ~20 |
| Domains with competing implementations | 5 (goals, tasks, stories, kanban, finance) |
| Legacy routes still active in routing | ~18 |

---

## Key Structural Observations

1. **The mobile story is MobileHome only.** Every other route defaults to desktop-first, and mobile users who navigate away from `/mobile` land on surfaces that are at best partially responsive and at worst completely unusable on touch.

2. **Competing implementations are unresolved in routing.** Goals, tasks, and stories each have 2 view modes (table + card) toggled manually. There is no automatic breakpoint behaviour to switch to card view on narrow viewports.

3. **Legacy routes remain live.** Approximately 18 redirect-only routes exist for backwards compatibility. These do not degrade UX directly but add maintenance surface area and dilute the conceptual surface map.

4. **Roadmap proliferation.** Four roadmap implementations (V3, V5, V6, EnhancedGantt) are all routable. Only V6 should be the design target; the others should be explicitly marked legacy in documentation and removed from the nav.

5. **Settings and diagnostic surfaces are desktop-only by nature.** These are correctly gated but there is no explicit "requires desktop" message shown to mobile users who navigate to them.
