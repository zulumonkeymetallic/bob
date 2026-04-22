# Bob Frontend

Last updated: 2026-04-22

This document describes the main Bob application in `react-app/`.

## Boot Flow

### App Startup

- `react-app/src/index.tsx` initializes the app, installs global error handlers, unregisters stale service workers, optionally starts lag monitoring, and wraps `App` with `ThemeProvider` and `AuthProvider`.
- `react-app/src/firebase.ts` initializes Firebase clients for Firestore, Auth, Storage, and Functions in region `europe-west2`.
- `react-app/src/App.tsx` adds additional providers, determines root redirects, loads global sidebar data, and declares the route map.

### Global Providers In Use

- `ThemeProvider`
- `AuthProvider`
- `PersonaProvider`
- `SprintProvider`
- `ProcessTextActivityProvider`
- `SidebarProvider`
- `TestModeProvider`
- `DetailLevelProvider`

## Main Route Families

The route map is concentrated in `react-app/src/App.tsx`.

### Dashboard / Metrics

- `/dashboard`
- `/metrics`
- `/metrics/progress`
- `/focus-goals`
- `/dashboard/habit-tracking`
- `/ai-usage`

### Entities

- `/tasks`, `/tasks/:id`
- `/stories`, `/stories/:id`
- `/goals`, `/goals/:id`
- `/journals`, `/journals/:id`, `/journals/insights`
- `/personal-lists`, `/personal-lists-modern`

### Sprints / Planning

- `/sprints`
- `/sprints/management`
- `/sprints/kanban`
- `/sprints/table`
- `/sprints/planning`
- `/sprints/retrospective`
- `/sprints/capacity`
- `/planning/approvals`
- `/planning/approval`
- `/daily-plan`

### Calendar / Planner

- `/calendar`
- `/calendar/planner`
- `/calendar/integration`
- `/calendar/sync`
- `/planner/weekly`

### Mobile

- `/mobile`
- `/mobile/daily-plan`
- `/mobile-view`
- `/mobile-checklist`

### Finance / Fitness / Travel / Media

- `/finance/dashboard`
- `/finance/transactions`
- `/finance/merchants`
- `/finance/budgets`
- `/finance/pots`
- `/fitness`
- `/ai-coach`
- `/travel`
- `/games-backlog`, `/books-backlog`, `/shows-backlog`, `/videos-backlog`, `/youtube-history`

### Settings / Public

- `/settings`
- `/settings/ai`
- `/settings/email`
- `/settings/planner`
- `/settings/integrations/*`
- `/share/:shareCode`
- `/public/roadmap/:shareCode`

## Core Frontend Files

| File | Role |
| --- | --- |
| `react-app/src/App.tsx` | Route map and top-level page composition |
| `react-app/src/firebase.ts` | Firebase client setup |
| `react-app/src/types.ts` | Shared entity types for goals, stories, journals, focus goals, tasks, etc. |
| `react-app/src/contexts/AuthContext.tsx` | Auth state and login/logout plumbing |
| `react-app/src/contexts/ThemeContext.tsx` | Theme state |
| `react-app/src/contexts/PersonaContext.tsx` | Personal/work persona state |
| `react-app/src/contexts/SprintContext.tsx` | Sprint data context |
| `react-app/src/components/SidebarLayout.tsx` | App shell/navigation |
| `react-app/src/components/AssistantChatModal.tsx` | UI entrypoint for assistant interactions |

## Service Layer

High-signal service modules:

- `react-app/src/services/agentClient.ts`
  - Calls `ingestTranscriptHttp` for text/transcript processing.
  - Calls `sendAssistantMessage` for assistant chat UI actions.
- `react-app/src/services/focusGoalsService.ts`
  - Frontend wrapper for focus-goal and related backend functions.
- `react-app/src/services/ActivityStreamService.ts`
  - Activity stream reads/writes and formatting.
- `react-app/src/services/ClickTrackingService.ts`
  - Interaction tracking.

Not every `services/` file is equally current. For example, `dataService.ts` still contains some legacy status-parsing utilities and should not be treated as the canonical frontend data architecture.

## Common Data Collections

Based on the live frontend and function code, the main Firestore collections in active use include:

- `goals`
- `stories`
- `tasks`
- `sprints`
- `profiles`
- `focusGoals`
- `calendar_blocks`
- `theme_allocations`
- `journals`
- `monzo_transactions`
- `activity_stream`

## Deep Link Behavior

The app supports several deep-link styles:

- direct route params such as `/tasks/:id`
- query-param gating via `QueryDeepLinkGate`
- older compatibility aliases such as `/task/:id`

If you are changing routing, inspect:

- `react-app/src/App.tsx`
- `react-app/src/components/routes/DeepLinkGoal.tsx`
- `react-app/src/components/routes/DeepLinkStory.tsx`
- `react-app/src/components/routes/DeepLinkTask.tsx`
- `react-app/src/components/routes/QueryDeepLinkGate.tsx`

## Frontend Caveats

- `react-app/src/` contains many backup and experimental files. Ignore `.bak`, `.backup`, `.new`, `.broken`, and stray Markdown/INI files unless explicitly asked to recover them.
- Some legacy route aliases intentionally redirect to consolidated pages instead of rendering distinct screens.
- The main production app is `react-app/`, not `web/`.

## Good Starting Points By Domain

- Planning and calendar: `components/planner/*`, `components/calendar/*`, `hooks/useUnifiedPlannerData.ts`
- Sprints: `components/sprints/*`, `contexts/SprintContext.tsx`
- Goals and roadmaps: `components/GoalsManagement.tsx`, `components/visualization/*`
- Finance: `components/finance/*`
- Fitness/coach: `components/coach/*`, `components/WorkoutsDashboard.tsx`
- Mobile: `components/MobileHome.tsx`, `components/MobileView.tsx`, `components/MobileChecklistView.tsx`
