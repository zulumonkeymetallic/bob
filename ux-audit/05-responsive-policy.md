# BOB UX Audit — 05: Responsive Support Policy

**Audit date**: 2026-03-17
**Purpose**: Define the official mobile support classification for every major surface. This document is the authoritative source for mobile/desktop routing decisions.

---

## Policy Definitions

| Classification | Definition | Implementation |
|----------------|------------|----------------|
| **`show full`** | The surface is designed for mobile. Full feature parity with desktop. | Default; no conditional rendering needed. |
| **`show simplified card`** | The surface renders a mobile-optimised card or list view instead of the desktop table/kanban/planner. Data access is full; interaction is simplified. | Detect mobile viewport; render alternate mobile component or switch view mode. |
| **`show summary/read-only`** | The surface shows key data points in a compact read-only format. Edit and create actions are hidden or reduced. | Render a mobile summary component; deep editing deferred to desktop. |
| **`hide — route to desktop`** | The surface is not appropriate for mobile. Render `MobileUnsupportedScreen` instead. | Replace component with `MobileUnsupportedScreen` on mobile viewport. |

## Viewport Breakpoints

| Name | Width | Description |
|------|-------|-------------|
| Mobile | < 768px | Primary mobile context. All `show simplified card` and `hide` rules activate here. |
| Tablet | 768–992px | Mobile rules apply for touch-dependent or highly dense surfaces. Desktop rules apply for readable surfaces. |
| Desktop | ≥ 992px | Full desktop experience. No restrictions. |

---

## Surface Policy Table

### Dashboard & Overview

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/` | RootRedirect | — | Redirect only; auto-routes mobile to `/mobile` |
| `/dashboard` | Dashboard | `show summary/read-only` | Show key metrics cards and upcoming events. Hide complex analytics panels. Charts collapse to single metric tiles. |
| `/metrics` | AdvancedOverview | `hide — route to desktop` | Multi-chart analytics surface with Recharts; not appropriate for mobile. |
| `/metrics/progress` | ThemeProgressDashboard | `hide — route to desktop` | Same rationale as AdvancedOverview. |
| `/mobile-priorities` | MobilePriorityDashboard | `show full` | Mobile-first surface. |

---

### Task Management

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/tasks` (table mode) | ModernTaskTable | `show simplified card` | Auto-switch to card view below 768px. User cannot toggle back to table on mobile. |
| `/tasks` (card mode) | TasksCardView | `show simplified card` | Card view renders but with mobile card spec: larger tap targets, overflow action menu. |
| `/tasks/:id` | DeepLinkTask | `show full` | Modal detail view; acceptable on mobile. |

---

### Story Management

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/stories` (table mode) | ModernStoriesTable | `show simplified card` | Same as tasks: auto-switch to card view below 768px. |
| `/stories` (card mode) | StoriesCardView | `show simplified card` | Same as TasksCardView mobile treatment. |
| `/stories/:id` | DeepLinkStory | `show full` | Modal detail view acceptable on mobile. |

---

### Kanban & Sprints

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/sprints/kanban` | KanbanBoardV2 | `show simplified card` | On mobile: single-column stacked list grouped by status. Drag-and-drop replaced by status picker. |
| `/sprints` | SprintsPage | `show summary/read-only` | Sprint list with key dates; no deep editing on mobile. |
| `/sprints/management` | SprintManagementView | `show summary/read-only` | Show only overview tab on mobile. Board, table, burndown, retrospective tabs hidden. |
| `/sprints/table` | ModernSprintsTable | `show simplified card` | Same table→card rule applies. |
| `/sprints/planning` | SprintPlanningMatrix | `hide — route to desktop` | Dense planning matrix; no mobile interaction model. |
| `/sprints/capacity` | CapacityDashboard | `show summary/read-only` | Show current vs available capacity as numbers and a simple progress bar. Chart hidden. |
| `/sprints/retrospective` | SprintRetrospective | `show full` | Form-based; mobile-appropriate. |

---

### Goals Management

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/goals` (table mode) | ModernGoalsTable | `show simplified card` | Auto-switch to card view below 768px. |
| `/goals` (card mode) | GoalsCardView | `show simplified card` | Mobile card spec applied; tap to view/edit. |
| `/goals/:id` | DeepLinkGoal | `show full` | Modal detail view acceptable. |
| `/focus-goals` | FocusGoalsPage | `show summary/read-only` | Show countdown banner and goal list only. Hide KPI studio and wizard. |
| `/goals/year-planner` | GoalsYearPlanner | `hide — route to desktop` | Complex planning grid; touch-incompatible. |
| `/goals/roadmap` | GoalRoadmapV5 | `hide — route to desktop` | Gantt chart; no mobile interaction model. |
| `/goals/roadmap-v6` | GoalRoadmapV6 | `hide — route to desktop` | Same rationale. This is the recommended primary target. |
| `/goals/roadmap-legacy` | GoalRoadmapV3 | `hide — route to desktop` | Legacy; same rationale. |
| `/goals/timeline` | EnhancedGanttChart | `hide — route to desktop` | Timeline Gantt; no mobile model. |
| `/goals/viz` | GoalVizPage | `hide — route to desktop` | Visualisation surface; desktop-only. |

---

### Calendar & Planner

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/calendar` | UnifiedPlannerPage | `show summary/read-only` | Lock to agenda view on mobile. Remove drag-and-drop. Show FAB for adding items. |
| `/calendar/planner` | WeeklyThemePlanner | `hide — route to desktop` | Theme-based week planner; desktop-only interaction. |
| `/calendar/integration` | CalendarIntegrationView | `show full` | Simple form; mobile-acceptable. |
| `/checkin/daily` | CheckInDaily | `show full` | Mobile-first form. |
| `/checkin/weekly` | CheckInWeekly | `show full` | Mobile-first form. |
| `/planning/approvals` | ApprovalsCenter | `show summary/read-only` | List of pending approvals, read-only on mobile. |
| `/planning/approval` | PlanningApprovalPage | `show full` | Single approval form; acceptable on mobile. |

---

### Finance

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/finance/dashboard` | FinanceDashboardAdvanced | `show summary/read-only` | Show 3-4 key metric tiles (month spend, budget remaining, recent transactions). Hide charts and tables. |
| `/finance/transactions` | TransactionsList | `show simplified card` | Render transactions as swipeable cards with date/merchant/amount. No dense table. |
| `/finance/budgets` | BudgetsPage | `hide — route to desktop` | Budget configuration table; desktop management task. |
| `/finance/merchants` | MerchantMappings | `hide — route to desktop` | Configuration table; desktop-only. |
| `/finance/flow` | FinanceFlowDiagram | `hide — route to desktop` | Sankey chart; not renderable on mobile. |
| `/finance/pots` | PotsBoard | `show simplified card` | Show pots as a scrollable card list; no kanban drag on mobile. |
| `/finance/goals` | GoalPotLinking | `show summary/read-only` | Show existing links read-only; editing deferred to desktop. |

---

### Fitness & Health

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/fitness` | WorkoutsDashboard | `show summary/read-only` | Show recent workouts as cards and key metric tiles (weekly distance, weekly time). Charts hidden on mobile. |
| `/parkrun-results` | WorkoutsDashboard | `show summary/read-only` | Same as fitness dashboard. |

---

### Chores & Habits

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/dashboard/habit-tracking` | HabitsChoresDashboard | `show simplified card` | Habit tracking card view; grid becomes single column. |
| `/chores` | ChoresTasksPage | `show simplified card` | Chore list as mobile cards. |
| `/chores/checklist` | ChoreChecklistPage | `show full` | Mobile-first checklist. |

---

### Content Backlogs

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/games-backlog` | GamesBacklog | `show simplified card` | Card view; single column on mobile. |
| `/shows-backlog` | ShowsBacklog | `show simplified card` | Same. |
| `/books-backlog` | BooksBacklog | `show simplified card` | Same. |
| `/videos-backlog` | VideosBacklog | `show simplified card` | Same. |
| `/youtube-history` | YouTubeHistoryDashboard | `hide — route to desktop` | Analytics dashboard; desktop-only. |
| `/personal-lists` | BacklogManager | `show simplified card` | Legacy; same card treatment. |
| `/personal-lists-modern` | PersonalListsManagement | `show simplified card` | Modern table → card on mobile. |

---

### Journals

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/journals` | JournalsManagement | `show simplified card` | Journal list as cards; tap to open. |
| `/journals/insights` | JournalInsightsPage | `show summary/read-only` | Show recent insight summary card; hide full analytics. |
| `/journals/:id` | JournalsManagement | `show full` | Journal detail form acceptable on mobile. |

---

### Settings & Integrations

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/settings` | SettingsPage | `show summary/read-only` | Show profile and notification tabs only on mobile. Hide AI, finance, developer tabs. |
| `/settings/email` | SettingsEmailPage | `show full` | Simple form; mobile-acceptable. |
| `/settings/planner` | SettingsPlannerPage | `hide — route to desktop` | Configuration surface; desktop-appropriate. |
| `/settings/integrations` | IntegrationSettings | `hide — route to desktop` | Integration management; desktop-appropriate. |
| `/settings/integrations/*` | Various | `hide — route to desktop` | All per-integration config pages. |

---

### Diagnostics & Logs

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/logs/integrations` | IntegrationLogs | `hide — route to desktop` | Developer/ops surface. |
| `/logs/ai` | AiDiagnosticsLogs | `hide — route to desktop` | Developer/ops surface. |
| `/logs/transcripts` | TranscriptProcessingLogs | `hide — route to desktop` | Developer/ops surface. |

---

### Mobile-First Surfaces

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/mobile` | MobileHome | `show full` | Primary mobile experience. |
| `/mobile-view` | MobileView | `show full` | Mobile detail view. |
| `/mobile-checklist` | MobileChecklistView | `show full` | Mobile checklist. |

---

### Miscellaneous

| Route | Surface | Mobile Policy | Notes |
|-------|---------|---------------|-------|
| `/travel` | TravelMap | `hide — route to desktop` | Map visualisation; not appropriate for mobile. |
| `/canvas` | VisualCanvas | `hide — route to desktop` | Custom canvas; desktop-only. |
| `/routes` | RoutesManagementView | `hide — route to desktop` | Route management; desktop-appropriate. |
| `/share/:shareCode` | PublicGoalView | `show full` | Public-facing shared view; single-column card layout on all viewports. |

---

## Implementation Guidelines

### Breakpoint Detection
Use the existing `deviceDetection.ts` utility which already defines:
```typescript
isMobile(): width < 768px OR mobile UA string
isTablet(): (iPad/Android) AND 768 <= width < 1024
```

For component-level checks, use a shared `useIsMobile()` hook wrapping the device detection utility. Do not inline `window.innerWidth` checks in component render logic.

### Route-Level Gates vs Component-Level Gates

**Route-level gates** (in App.tsx or a layout wrapper): Used for `hide — route to desktop` surfaces. The gate wraps the entire route and renders `MobileUnsupportedScreen` when `isMobile`.

**Component-level gates**: Used for `show simplified card` and `show summary/read-only`. The component itself detects mobile and renders the simplified variant.

**Preferred pattern for `show simplified card`**:
```tsx
const isMobile = useIsMobile();

if (isMobile) {
  return <TasksCardView items={items} mode="mobile" />;
}
return <ModernTaskTable items={items} />;
```

### Sidebar Navigation on Mobile
Per REC-036: Hide sidebar navigation items leading to `hide — route to desktop` surfaces when `isMobile`. This prevents users from navigating to surfaces that will only show them `MobileUnsupportedScreen`.

Surfaces classified as `show summary/read-only` should remain in mobile navigation — they provide value on mobile, just in a simplified form.

### The `/mobile` Route vs Desktop Routes on Mobile
The current architecture auto-routes new mobile users to `/mobile`. However, existing mobile users with bookmarked desktop URLs still land on those desktop surfaces. The responsive policy above ensures those desktop surfaces handle mobile visitors gracefully even without the auto-redirect.

Do not remove the `/mobile` route. It provides the optimised mobile experience. The responsive policy fills in the gaps for all other routes.

---

## Summary by Classification

| Policy | Count | Examples |
|--------|-------|---------|
| `show full` | 9 | MobileHome, CheckInDaily, CheckInWeekly, ChoreChecklist, PublicShareView, DeepLink detail views |
| `show simplified card` | 14 | Tasks, Stories, Goals (card mode), Kanban (stacked), Finance Transactions, Content Backlogs, Journals |
| `show summary/read-only` | 12 | Dashboard, SprintManagement (overview tab), FocusGoals (banner + list), Calendar (agenda), Finance summary, Fitness |
| `hide — route to desktop` | 18 | Roadmaps, Sprint Planning, Year Planner, Finance deep config, Analytics, Logs, Settings integrations, Map, Canvas |
