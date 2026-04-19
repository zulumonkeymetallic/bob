# BOB AI Planning & Scheduling – Audit (Auto-generated)

Date: $(date -u +%Y-%m-%d) (UTC)
Project: bob20250810
Region: europe-west2

## Summary
- Deployed Cloud Functions queried via gcloud.
- Compared against code exports in `functions/index.js`.
- Mapped against required AI planning/scheduling features.

## Deployed Functions (raw)
See: $(basename "$DEPLOYED_JSON") for full JSON.

### Deployed Function IDs (names only)
```
applyMerchantMappings
approveAllGoalResearch
approveGoalResearch
approvePlanningJob
autoConvertOversizedTasks
backfillMerchantKeys
buildPlan
bulkUpsertMerchantMappings
calendarStatus
cleanupTestTokens
cleanupUserLogs
completeChore
completeRoutine
computeParkrunPercentiles
convertTasksToStories
createCalendarEvent
createTrackingIssue
dailyPlanningJob
dailySync
deduplicateTasks
deleteCalendarEvent
deleteFinanceData
detectDuplicateReminders
diagnosticsStatus
dispatchDailySummaryEmail
dispatchDataQualityEmail
enableFitnessAutomationDefaults
enhanceTaskDescription
enrichStravaHR
ensureEntityRefs
exportFinanceData
generateDailyDigest
generateGoalStoriesAndKPIs
generateMonzoAuditReport
generateStoriesForGoal
generateStoriesFromResearch
generateStoryAcceptanceCriteria
generateTasksForStory
generateTestToken
getFitnessOverview
getRunFitnessAnalysis
getSteamAppDetails
importDevelopmentFeatures
importItems
listChoresWithStats
listRoutinesWithStats
listUpcomingEvents
mediaImportGenerateStories
monzoBackstopSync
monzoListAccounts
monzoOAuthCallback
monzoOAuthStart
monzoRegisterWebhook
monzoSyncTransactions
monzoWebhook
n8nCalendarWebhook
nightlyAutoAllocateBacklog
nightlyMonzoAnalytics
nightlyTaskMaintenance
oauthCallback
oauthStart
onCalendarBlockWritten
onFinanceTransactionCreated
onGoalCreated
onMonzoTransactionCreated
onStorySprintChange
orchestrateGoalPlanning
orchestrateStoryPlanning
planBlocksV2
planCalendar
previewDailySummary
previewDataQualityReport
prioritizeBacklog
recomputeMonzoAnalytics
reconcileAllCalendars
reconcilePlanFromGoogleCalendar
remindersPull
remindersPush
revokeMonzoAccess
rolloverChoresAndRoutines
runDailySchedulerAdjustments
runNightlyMaintenanceNow
saveEmailSettings
scheduleSteamGamesViaN8n
sendAssistantMessage
sendDailySummaryNow
sendDataQualityNow
sendGoalChatMessage
sendTestEmail
setMerchantMapping
setMonzoSubscriptionOverride
skipRoutine
stravaOAuthCallback
stravaOAuthStart
stravaWebhook
suggestTaskStoryConversions
syncGoogleCalendarsHourly
syncMonzo
syncParkrun
syncPlanToGoogleCalendar
syncSteam
syncStrava
syncTrakt
testLLM
testLogin
updateCalendarEvent
updateMonzoTransactionCategory
```

### Code → Deployed Diff
- In code but not deployed: (should be 0 ideally)
```
cleanupUserLogs
generateDailyDigest
saveEmailSettings
sendTestEmail
```
- Deployed but not in code (stale; candidates to remove):
```
approveAllGoalResearch
approveGoalResearch
generateTasksForStory
nightlyAutoAllocateBacklog
onFinanceTransactionCreated
onGoalCreated
onMonzoTransactionCreated
setMonzoSubscriptionOverride
```

## Gap Analysis
| Feature | Status | Evidence (File/Function) | Recommendation |
|---|---|---|---|
| Dynamic daily blocking aligned to sprints/themes | Partial | functions/index.js:6796 (dailyPlanningJob), functions/index.js:2600 (assemblePlanningContext), functions/scheduler/engine.js | Add theme quotas and sprint-aware allocation in planner; propagate theme weights. |
| Time-boxing based on availability and deadlines | Partial | functions/index.js:3236 (validateCalendarBlocks), functions/scheduler/engine.js | Incorporate deadlines explicitly into block duration and selection; adjust buffers dynamically. |
| Auto-rescheduling of incomplete tasks | Partial | functions/index.js:8120 (runDailySchedulerAdjustments) | Extend to reflow scheduled_instances and calendar_blocks, not just due dates. |
| Context-aware (Health/Strava/Recovery) | Partial | functions/index.js:4860 (fitness ingestion/summary), functions/index.js:1384..1460 (Strava OAuth/Sync) | Feed recovery/fitness signals into scheduling priority and capacity. |
| Google/iOS Calendar two-way sync | Partial | functions/index.js:3660..3760 (GCal import/reconcile), functions/calendarSync.js | Harden two-way policy, conflict resolution and per-event provenance. |
| Daily summary generation | Implemented | functions/index.js:7139..7231 (dispatchDailySummaryEmail), functions/dailyDigestGenerator.js | Consolidate summary pipelines; ensure per-user preferences. |
| Theme colour-coding and dashboards | Implemented | functions/services/themeManager.js, react-app/* | Centralise theme map; ensure all blocks/stories/tasks inherit consistently. |
| Adherence analytics | Missing | — | Add adherence KPIs (streaks/completion rate) to dashboards and summaries. |
| Goal → Story → Task hierarchy | Implemented | BOB_DATABASE_SCHEMA_COMPLETE.md, functions/index.js (orchestration) | — |
| AI-assisted creation from goals/conversations | Implemented | functions/index.js:2260..3060 (goal/story orchestration), sendGoalChatMessage | — |
| Point estimation | Partial | functions/scheduler/engine.js (points→minutes), no explicit estimator | Add callable `estimatePointsForStory()` using AI heuristics with constraints. |
| Priority inference | Implemented | functions/index.js:200..360 (scoreTask), prioritizeBacklog | — |
| Duplicate detection | Implemented | functions/index.js:3840..4020 (deduplicateTasks), detectDuplicateReminders | — |
| Theme tagging | Implemented | functions/services/themeManager.js; planner enrichment | — |
| Story progress tracking | Partial | onStorySprintChange trigger; data quality checks | Add progress rollups per story/sprint; block completion hooks. |
| CRUD + Firestore linkage | Implemented | services and triggers across `functions/index.js` | — |
| Sprint backlog generation | Partial | AI orchestration assigns to active sprint | Add `generateSprintBacklog()` to balance themes and capacity. |
| Burndown/velocity tracking | Missing | — | Add nightly velocity compute and weekly burndown snapshot. |
| Theme-balanced sprint logic | Missing | — | Introduce per-theme targets in sprint planning. |
| Retrospective insights | Missing | — | Generate retro email with wins/risks and throughput. |
| Priority highlighting | Implemented | daily summary AI focus; dashboard deeplinks | — |
| Theme/goal progress charts | Partial | Monzo analytics; basic progress | Add theme/goal trend endpoints for dashboard. |
| Duplicate cleanup summary | Implemented | data quality email/templates | — |
| Contextual prompts | Partial | assistant chat suggestions | Expand prompts tied to lagging themes/goals. |
| Conversational daily planning | Implemented | sendAssistantMessage | — |
| Voice interface readiness | Missing | — | Add webhook surface for voice assistant intents. |
| Data ingestion (Strava/Health/Monzo) | Partial | Strava + Monzo implemented; HealthKit missing | Add HealthKit bridge via iOS or n8n ingest. |
| Background refactoring & stale cleanup | Implemented | nightlyTaskMaintenance; ensureEntityRefs | — |

## Implementation Plan
- Phase 1: Core scheduling and task alignment
  - Add theme quotas + sprint-aware placement to planner.
  - Extend auto-rescheduler to reflow scheduled_instances and calendar_blocks.
  - Ship duplicate/stale deployed function cleanup.
- Phase 2: Sprint & dashboard intelligence
  - Velocity/burndown snapshots; theme/goal progress APIs.
  - Sprint backlog generator balancing themes/capacity.
  - Adherence KPIs across chores/routines.
- Phase 3: Calendar & theme automation
  - Conflict policy (reschedule vs skip) + provenance.
  - Voice assistant webhook; HealthKit ingest via iOS/n8n.

## Function Prototypes (skeletons)
```js
// functions/index.js (additions)
exports.computeSprintVelocity = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
  const db = admin.firestore();
  const sprintId = String(req?.data?.sprintId || '').trim();
  // Load stories/tasks completed in sprint window and compute points/time
  return { velocityPoints: 0, completedTasks: 0 };
});

exports.generateRetrospectiveInsights = schedulerV2.onSchedule('every monday 08:00', async () => {
  const db = admin.firestore();
  // Aggregate past week throughput, risk, theme time and email summary
});

exports.estimatePointsForStory = httpsV2.onCall({ secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated');
  const { storyId } = req.data || {}; if (!storyId) throw new httpsV2.HttpsError('invalid-argument','storyId required');
  // Fetch story details, call LLM with guardrails; return bounded estimate
  return { points: 3, rationale: 'Heuristic + AI' };
});

exports.syncCalendarThemes = httpsV2.onCall(async (req) => {
  const uid = req?.auth?.uid; if (!uid) throw new httpsV2.HttpsError('unauthenticated');
  // Normalize calendar_blocks.theme/theme_id against user theme settings
  return { updated: 0 };
});
```

## Dependencies
- Google Cloud: Cloud Functions v2, Eventarc, Secret Manager
- AI: Google AI Studio (Gemini) via HTTPS
- Calendars: Google Calendar API (two-way), Apple Reminders via app bridge
- Fitness: Strava API; Apple HealthKit via iOS app/webhook
- Email: Nylas v3
- Firestore schema updates:
  - Add `sprint_metrics` collection for velocity/burndown
  - Add `adherence_kpis` for routines/chores
  - Extend `calendar_blocks` with provenance and conflict policy

## Stale Deployed Functions (not present in code)
These functions are currently deployed but not defined in `functions/index.js` and are candidates for removal:
```
approveAllGoalResearch
approveGoalResearch
generateTasksForStory
nightlyAutoAllocateBacklog
onFinanceTransactionCreated
onGoalCreated
onMonzoTransactionCreated
setMonzoSubscriptionOverride
```

---
Generated by Codex audit.
