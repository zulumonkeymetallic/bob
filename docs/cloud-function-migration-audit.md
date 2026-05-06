# Cloud Function Migration Audit

**Date:** 2026-05-06  
**Scope:** 169 exported cloud functions in `functions/`  
**Purpose:** Identify candidates to shift to direct Firestore SDK calls (web or iOS) to reduce cold-start latency and billing surface.

---

## Category A — Can move to direct Firestore SDK

These functions contain no secrets, no LLM calls, and no external API dependencies. They are simple Firestore reads/writes wrapped in a cloud function for no structural reason.

| Function | Current trigger | Action to take | Firestore target |
|----------|----------------|----------------|------------------|
| `updateTaskTime` | onCall | Web: replace with direct `updateDoc` | `tasks/{id}.estimatedHours` |
| `updateStoryTime` | onCall | Web: replace with direct `updateDoc` | `stories/{id}.estimatedHours` |
| `skipRoutine` | onCall | Web + iOS: replace with `updateDoc` | `tasks/{id}.lastSkippedAt` |
| `logHealthMetric` | onCall | Web: replace with `addDoc` | `health_metrics/{userId}` |
| `setTransactionCategoryOverride` | onCall | Web + iOS: replace with `updateDoc` | `transactions/{id}.categoryOverride` |
| `saveEmailSettings` | onCall | Web: replace with `setDoc` merge | `profiles/{userId}.emailSettings` |
| `getEmailSettings` | onCall | Web: replace with `getDoc` | `profiles/{userId}.emailSettings` |
| `normalizeStatuses` | onCall | Web: inline the status normalisation logic | `tasks`, `stories` collections |
| `listUpcomingEvents` (iOS only) | onCall | iOS: query `calendar_blocks` with date range filter directly | `calendar_blocks` where `ownerUid == uid && startTime >= now` |

**Priority order for migration:**
1. `skipRoutine` — single timestamp write, near-zero logic
2. `setTransactionCategoryOverride` — single field update
3. `updateTaskTime` / `updateStoryTime` — simple Firestore updates, called frequently from UI
4. `logHealthMetric` — direct collection write
5. `listUpcomingEvents` (iOS) — replace with Firestore query on `calendar_blocks`
6. `saveEmailSettings` / `getEmailSettings` — profile sub-field reads, rarely called

**Estimated cold-start savings:** These 6–8 functions are called from interactive UI paths (task editing, transaction categorisation). Removing the function invocation eliminates ~300–800ms of cold-start latency per call and removes the billing event entirely.

---

## Category B — iOS already has local equivalents

The iOS app has Swift local service implementations for these. Cloud calls should only happen when `AIExecutionPolicy.isLocalOnly == false` AND the local service fails. This policy is already wired but should be audited to ensure it's being respected.

| Cloud function | iOS local service | Notes |
|----------------|-------------------|-------|
| `autoEnrichTasks` / `enhanceNewTask` | `LocalAIService.swift` | iOS calls cloud; local should be primary |
| `suggestTaskStoryConversions` | `LocalConversionService.swift` | FunctionsService still calls cloud — check policy gate |
| `scoreCriticalityBatch` / `deltaPriorityRescore` | `LocalPointingService.swift` + `PriorityRescoringService.swift` | iOS calls `deltaPriorityRescore` via FunctionsService |
| `replanCalendarNow` | `LocalCalendarPlannerService.swift` | iOS calls `replanCalendarNow` via FunctionsService |
| Finance categorisation (AI-assisted) | `LocalFinanceCategorisationService.swift` | Already correctly local-first |

**Action:** Audit `FunctionsService.swift` calls to `deltaPriorityRescore` and `replanCalendarNow`. Add local-first routing with cloud fallback using `AIExecutionPolicy.isLocalOnly`.

---

## Category C — Cannot move client-side

These require secrets, OAuth tokens, or LLM API keys that must not be exposed to the client.

- **Monzo sync** (`syncMonzoNow`, `monzoWebhook`) — Monzo OAuth + bank API credentials
- **Strava, Trakt, Steam, Hardcover** — all OAuth + third-party API credentials
- **Google Calendar OAuth flow** (`oauthCallback`, sync functions) — OAuth code exchange requires client secret
- **LLM-powered planners** (`plannerLLM`, `generateStoriesForGoal`, `orchestrateGoalPlanning`, `generateStoryAcceptanceCriteria`, `whatToWorkOnNext`) — Google AI Studio API key
- **Email dispatch** (Brevo) — Brevo API key
- **Webhook receivers** (`monzoWebhook`, external callbacks) — must be public HTTP endpoints

---

## Category D — Backend-only by nature

These cannot and should not run client-side regardless of secrets. They are triggered by schedule or Firestore events.

- All `onSchedule` functions (nightly orchestration, daily summaries, data quality reports, coach scheduler, fitness scheduler)
- All `onDocumentCreated` / `onDocumentUpdated` Firestore triggers (auto-enrichment, calendar event matching, sprint seeding)
- Background jobs that batch-process across all users

---

## Web-only functions with no iOS equivalent

These exist only in the web app and have no iOS surface. Not candidates for migration — they serve desktop-only workflows.

- Sprint planning matrix operations
- Backlog AI prioritisation (`prioritizeBacklog`)
- Gantt chart data assembly
- GitHub issue creation
- AI diagnostics / usage logging
- Import/export helpers

---

## Summary

| Category | Count (approx) | Action |
|----------|---------------|--------|
| A — Move to direct SDK | ~9 functions | Implement in future sessions, highest priority: `skipRoutine`, `setTransactionCategoryOverride` |
| B — iOS local-first already | ~5 functions | Audit policy gate in FunctionsService.swift |
| C — Cannot move | ~60 functions | No action |
| D — Backend-only | ~41 functions | No action |
| Web-only, no iOS surface | ~54 functions | No action |
