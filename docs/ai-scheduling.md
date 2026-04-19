AI Scheduling & Enrichment Layer

Overview
- Purpose: unify calendar sync, AI task enrichment, conversions, and planner flows under clear APIs and safe auditing.
- Primary components:
  - Firebase Functions (callables): syncCalendarAndTasks, autoEnrichTasks, taskStoryConversion, plannerLLM
  - Scheduled jobs: dailyPlanningJob (existing), nightlyTaskMaintenance (existing); plannerLLM (on‑demand wrapper)
  - UI: CalendarIntegrationView (calendar), SprintPlannerMatrix (matrix), Goal modal

APIs (callables)
- syncCalendarAndTasks
  - Direction: 'both' | 'gcal->firestore' | 'firestore->gcal' (default: both)
  - Effect: runs reconcilePlanFromGoogleCalendar and/or syncPlanToGoogleCalendar; writes sanitized activity_stream entries
  - Returns: { ok: true, reconciled: number, pushed: number }

- autoEnrichTasks
  - Options: { estimateMissing?: boolean, linkSuggestions?: boolean, limit?: number }
  - Effect: finds tasks missing estimateMin or links; calls Gemini to produce { estimateMin, suggestedGoalId? } and merges safely.
  - Returns: { processed, updated, estimatesAdded, linksSuggested }

- taskStoryConversion
  - Options: { taskIds?: string[], autoApply?: boolean, limit?: number }
  - Effect: delegates to suggestTaskStoryConversions then convertTasksToStories when autoApply is true.
  - Returns: { suggestions, converted }

- plannerLLM
  - Options: { day?: 'YYYY-MM-DD', persona?: string, horizonDays?: number }
  - Effect: on‑demand wrapper around planCalendar; cron satisfied by existing dailyPlanningJob.
  - Returns: planCalendar’s result ({ blocksCreated, preview?, score, ... })

Safety & secrets
- Gemini via GOOGLEAISTUDIOAPIKEY (functions/params defineSecret). Do not log prompts/responses.
- Calendar OAuth secrets (GOOGLE_OAUTH_CLIENT_ID/SECRET) managed via Secret Manager. Do not print access/refresh tokens.
- Redaction: audit docs exclude description bodies and token-like strings.

Audit logging
- Collection: activity_stream
- Model keys: entityType ('calendar' | 'task' | 'plan'), activityType, description, metadata (sanitized), userId, timestamps
- Exclude: emails, tokens, raw calendar payloads, free text longer than 256 chars.

UI integration
- CalendarIntegrationView: wire Sync button to syncCalendarAndTasks; show calendarStatus; drive OAuth start via oauthStart endpoint.
- Goal modal: show activity inline; toast on updates; offer “Schedule time” using planCalendar.
- Planner matrix: add capacity badges per cell; unscheduled reasons from scheduled_instances.

Testing
- Unit: recurrence/time helpers already in place. Keep LLM calls behind small batch with limit during tests.
- Integration: add Playwright smoke tests for Goal Modal open/save and Planner Matrix render.

Indexes (recommendations)
- calendar_blocks: ownerUid + goalId (filter), ownerUid + start (range)
- scheduled_instances: ownerUid + occurrenceDate, ownerUid + status
- activity_stream: ownerUid + entityType, ownerUid + createdAt

