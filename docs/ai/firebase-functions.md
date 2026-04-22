# Firebase Functions Reference

Last updated: 2026-04-22

This is the canonical grouped reference for the Bob backend in `functions/`.

## Architecture Notes

- Runtime: Node 20
- Region: primarily `europe-west2`
- Main deployment entrypoint: `functions/index.js`
- Additional exports come from modules such as `calendarSync.js`, `nightlyOrchestration.js`, `transcriptIngestion.js`, `coach/*`, `finance/enhancements.js`, and others.
- The backend mixes Firebase Functions v1 and v2 APIs.

## Important Caveats

- `functions/index.js` is both a composition file and a large implementation file.
- Some export names are reassigned later in the file; the last assignment wins.
- `convertTasksToStories` from `functions/aiPlanning.js` is shadowed later by a callable of the same name in `functions/index.js`.
- `generateWeeklySummaries` is declared twice in `functions/index.js`; the later declaration is the effective export.

## Module Map

| Module | Purpose |
| --- | --- |
| `functions/index.js` | Main Bob backend aggregator plus many inline function implementations |
| `functions/nightlyOrchestration.js` | Scheduler/orchestration pipeline for planning, scoring, and calendar materialization |
| `functions/calendarSync.js` | Calendar block sync and reconciliation helpers |
| `functions/transcriptIngestion.js` | Transcript/text ingestion, journal extraction, assistant-style routing |
| `functions/aiPlanning.js` | Older scheduler/planner automation module |
| `functions/capacityPlanning.js` | Sprint and calendar capacity calculations |
| `functions/fuzzyTaskLinking.js` | Goal/story/task suggestion and auto-linking |
| `functions/focusGoals.js` | Focus goal and Monzo-pot helper functions |
| `functions/globalSnapshot.js` | Hierarchy snapshot generation/export |
| `functions/intentBroker.js` | Focus-goal suggestion prompts and conversion tracking |
| `functions/finance/enhancements.js` | External finance imports, matching, debt/account helpers, action insights |
| `functions/coach/*` | AI coach orchestration, briefings, and fitness block scheduling |

## Planning, Scheduling, And Calendar

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `buildPlan` | callable | `functions/index.js` | Primary plan-building entrypoint. |
| `planBlocksV2` | callable | `functions/index.js` | Schedules blocks from Bob task/story/calendar data. |
| `planBlocksV2Http` | HTTP | `functions/index.js` | Public HTTP wrapper around block planning. |
| `priorityNow` | HTTP | `functions/index.js` | Public priority/recommendation endpoint. |
| `replanDay` | HTTP | `functions/index.js` | Public day-level replan endpoint. |
| `plannerLLM` | callable | `functions/index.js` | LLM layer for planner guidance before block writing. |
| `planCalendar` | callable | `functions/index.js` | LLM-backed calendar planning. |
| `runPlanner` | callable | `functions/index.js` | Combined planning flow that can also sync to Google Calendar. |
| `syncCalendarAndTasks` | callable | `functions/index.js` | Coordinates calendar/task sync operations. |
| `reconcilePlanFromGoogleCalendar` | callable | `functions/index.js` | Pulls Google Calendar state back into Bob plan data. |
| `syncPlanToGoogleCalendar` | callable | `functions/index.js` | Pushes Bob plan state to Google Calendar. |
| `syncCalendarBlocksBidirectional` | callable | `functions/index.js` | Two-way block sync. |
| `scheduleDueTasksToday` | callable | `functions/index.js` | Creates same-day calendar placements for due tasks. |
| `reconcileAllCalendars` | scheduled | `functions/index.js` | Reconciliation sweep across linked calendars. |
| `syncGoogleCalendarsHourly` | scheduled | `functions/index.js` | Hourly Google Calendar sync. |
| `calendarStatus` | callable | `functions/index.js` | Reports Google Calendar connection/sync state. |
| `createCalendarEvent` | callable | `functions/index.js` | Creates a Google Calendar event. |
| `updateCalendarEvent` | callable | `functions/index.js` | Updates a Google Calendar event. |
| `deleteCalendarEvent` | callable | `functions/index.js` | Deletes a Google Calendar event. |
| `listUpcomingEvents` | callable | `functions/index.js` | Lists future Google Calendar events. |
| `checkGoogleDocsAccess` | callable | `functions/index.js` | Verifies Google Docs/Drive access path. |
| `oauthStart` / `oauthCallback` | HTTP | `functions/index.js` | Google OAuth flow for Bob integrations. |
| `youtubeOAuthStart` / `youtubeOAuthCallback` | HTTP | `functions/index.js` | YouTube/Google integration OAuth flow. |
| `disconnectGoogle` | callable | `functions/index.js` | Disconnects Google integration. |

### Supporting Calendar Modules

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `syncCalendarBlock` | callable | `functions/calendarSync.js` | Syncs one calendar block. |
| `onCalendarBlockWrite` | Firestore | `functions/calendarSync.js` | Reacts to calendar block writes. |
| `syncFromGoogleCalendar` | callable | `functions/calendarSync.js` | Imports Google Calendar events. |
| `syncCalendarNow` | callable | `functions/calendarSync.js` | Manual calendar sync trigger. |
| `scheduledCalendarSync` | scheduled | `functions/calendarSync.js` | Scheduled calendar import/sync. |
| `gcalLinkUnlinkedEvents` | callable | `functions/calendarSync.js` | Attempts event-to-entity linking. |
| `repairDuplicateCalendarEvents` | callable | `functions/calendarSync.js` | Repairs duplicate Google events. |

### Nightly Orchestration

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `runAutoPointing` | scheduled | `functions/nightlyOrchestration.js` | Auto-points tasks/stories for planner inputs. |
| `runAutoConversions` | scheduled | `functions/nightlyOrchestration.js` | Converts oversized tasks or planning entities. |
| `runPriorityScoring` | scheduled | `functions/nightlyOrchestration.js` | Recomputes scheduling and prioritization signals. |
| `runCalendarPlanner` | scheduled | `functions/nightlyOrchestration.js` | Materializes planner output into calendar state. |
| `materializeFitnessBlocksNow` | callable | `functions/nightlyOrchestration.js` | On-demand fitness block materialization. |
| `replanCalendarNow` | callable | `functions/nightlyOrchestration.js` | Manual replan trigger. |
| `schedulePlannerItem` | callable | `functions/nightlyOrchestration.js` | Schedules a single planner item mutation. |
| `runNightlyChainNow` | callable | `functions/nightlyOrchestration.js` | Runs the nightly orchestration chain immediately. |
| `runNightlyChainNowHttp` | HTTP | `functions/nightlyOrchestration.js` | HTTP wrapper for nightly chain execution. |
| `seedNextWeekPlannerOverridesWeekly` | scheduled | `functions/nightlyOrchestration.js` | Seeds next-week theme allocation overrides. |
| `seedNextWeekPlannerOverridesNow` | callable | `functions/nightlyOrchestration.js` | Immediate seeding of next-week planner overrides. |
| `applyEveningPullForward` | callable | `functions/nightlyOrchestration.js` | Pulls forward work into available evening capacity. |
| `deltaPriorityRescore` | callable | `functions/nightlyOrchestration.js` | Incremental priority rescore after local state changes. |

## Tasks, Chores, Routines, Journals, And Assistant Flows

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `autoEnrichTasks` | callable | `functions/index.js` | Batch task enrichment with LLM support. |
| `enhanceNewTask` | callable | `functions/index.js` | Enriches a newly created task. |
| `taskStoryConversion` | callable | `functions/index.js` | Coordinates task-to-story conversion flow. |
| `suggestTaskStoryConversions` | callable | `functions/index.js` | Suggests candidate task conversions. |
| `convertTasksToStories` | callable | `functions/index.js` | Performs task-to-story conversion. |
| `enhanceTaskDescription` | callable | `functions/index.js` | Improves task descriptions with AI. |
| `deduplicateTasks` | callable | `functions/index.js` | Task dedupe helper. |
| `listChoresWithStats` | callable | `functions/index.js` | Returns chores plus completion metadata. |
| `listRoutinesWithStats` | callable | `functions/index.js` | Returns routines plus completion metadata. |
| `completeChore` | callable | `functions/index.js` | Marks a chore complete. |
| `completeRoutine` | callable | `functions/index.js` | Marks a routine complete. |
| `completeChoreTask` | callable | `functions/index.js` | Chore completion helper for task-based chores. |
| `snoozeChoreTask` | callable | `functions/index.js` | Snoozes a chore task. |
| `skipRoutine` | callable | `functions/index.js` | Skips a routine instance. |
| `toggleImmovableFlag` | callable | `functions/index.js` | Toggles task immovability for planner logic. |
| `updateTaskTime` | callable | `functions/index.js` | Updates task timing metadata. |
| `updateStoryTime` | callable | `functions/index.js` | Updates story timing metadata. |
| `populateTimeOfDayNightly` | scheduled | `functions/index.js` | Infers blank time-of-day data nightly. |
| `rolloverChoresAndRoutines` | scheduled | `functions/index.js` | Rolls recurring chores/routines into the next window. |
| `archiveCompletedTasksNightly` | scheduled | `functions/index.js` | Archives completed tasks. |
| `ensureChoreBlocksHourly` | scheduled | `functions/index.js` | Ensures chore blocks exist in planner/calendar. |
| `cleanupOldTasksNightly` | scheduled | `functions/index.js` | Deletes or archives stale task data. |
| `nightlyTaskMaintenance` | scheduled | `functions/index.js` | Broad task maintenance job. |
| `autoRescheduleMissed` | callable | `functions/index.js` | Reschedules missed work. |
| `rescheduleMissedHourly` | scheduled | `functions/index.js` | Recurring missed-work reschedule sweep. |
| `runNightlyMaintenanceNow` | callable | `functions/index.js` | Manual trigger for nightly maintenance sequence. |
| `sendAssistantMessage` | callable | `functions/index.js` | Assistant chat endpoint used by the frontend. |
| `ingestTranscript` | callable | `functions/transcriptIngestion.js` | Structured transcript/text ingestion. |
| `ingestTranscriptHttp` | HTTP | `functions/transcriptIngestion.js` | HTTP entrypoint for transcript/text processing. |
| `editJournalEntry` | callable | `functions/transcriptIngestion.js` | Edits existing journal-derived entries. |
| `deleteJournalEntry` | callable | `functions/transcriptIngestion.js` | Deletes existing journal-derived entries. |

## Goals, Stories, Focus, Linking, And AI Planning

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `generateStoriesForGoal` | callable | `functions/index.js` | Generates story breakdowns for a goal. |
| `generateStoryAcceptanceCriteria` | callable | `functions/index.js` | Generates acceptance criteria. |
| `generateStoriesFromResearch` | callable | `functions/index.js` | Turns research output into story candidates. |
| `orchestrateGoalPlanning` | callable | `functions/index.js` | Goal-planning orchestration flow. |
| `orchestrateStoryPlanning` | callable | `functions/index.js` | Story-planning orchestration flow. |
| `sendGoalChatMessage` | callable | `functions/index.js` | Goal-specific chat/assistant flow. |
| `prioritizeBacklog` | callable | `functions/index.js` | Backlog prioritization. |
| `whatToWorkOnNext` | callable | `functions/index.js` | Lightweight recommendation endpoint. |
| `matchTravelGoal` | callable | `functions/index.js` | AI matching between travel items and goals. |
| `updateGoalTargetYears` | scheduled | `functions/index.js` | Keeps goal `targetYear` aligned to date data. |
| `generateGoalStoriesAndKPIs` | callable | `functions/index.js` | Fitness/goal story and KPI generation. |
| `resolveGoalFitnessKpis` | callable | `functions/index.js` | Reconciles goal KPI definitions/progress. |
| `syncFocusGoalCountdownsNightly` | scheduled | `functions/index.js` | Updates focus goal countdown state. |
| `createMonzoPotForGoal` | callable | `functions/focusGoals.js` | Creates Monzo pot metadata for a goal. |
| `syncFocusGoalsNightly` | callable | `functions/focusGoals.js` | Per-user focus-goal sync. |
| `syncAllFocusGoalsNightly` | HTTP | `functions/focusGoals.js` | Cross-user focus-goal sync. |
| `getFocusGoalsForUser` | callable | `functions/focusGoals.js` | Reads active focus-goal data. |
| `generateGlobalHierarchySnapshots` | scheduled | `functions/globalSnapshot.js` | Captures hierarchy snapshots. |
| `exportGlobalHierarchySnapshot` | callable | `functions/globalSnapshot.js` | Exports a hierarchy snapshot. |
| `getIntentBrokerPrompts` | callable | `functions/intentBroker.js` | Returns intent-broker prompt assets. |
| `intentBrokerSuggestFocus` | callable | `functions/intentBroker.js` | Suggests focus-goal alignment. |
| `recordIntentFocusConversion` | callable | `functions/intentBroker.js` | Logs accepted focus suggestions. |
| `applyCapacityDeferrals` | callable | `functions/capacityDeferral.js` | Defers work based on capacity limits. |
| `suggestDeferralOptions` | callable | `functions/deferralSuggestions.js` | Returns deferral recommendations. |
| `nightlyTaskLinking` | scheduled | `functions/fuzzyTaskLinking.js` | Suggests or auto-links tasks to stories/goals. |
| `nightlyStoryGoalLinking` | scheduled | `functions/fuzzyTaskLinking.js` | Suggests story-to-goal links. |
| `triggerTaskLinking` | callable | `functions/fuzzyTaskLinking.js` | Manual task-linking trigger. |
| `triggerStoryGoalLinking` | callable | `functions/fuzzyTaskLinking.js` | Manual story-goal linking trigger. |
| `respondToTaskSuggestion` | callable | `functions/fuzzyTaskLinking.js` | Accept/reject task link suggestions. |
| `respondToStoryGoalSuggestion` | callable | `functions/fuzzyTaskLinking.js` | Accept/reject story-goal suggestions. |
| `calculateSprintCapacity` | callable | `functions/capacityPlanning.js` | Sprint capacity computation. |
| `calculateNextWeekCapacity` | callable | `functions/capacityPlanning.js` | Next-week calendar capacity computation. |
| `updateStoryPriorities` | scheduled | `functions/capacityPlanning.js` | Scheduled story reprioritization. |

### Older AI Planning Module

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `runNightlyScheduler` | scheduled | `functions/aiPlanning.js` | Legacy nightly scheduler pipeline. |
| `runMorningPlanner` | scheduled | `functions/aiPlanning.js` | Legacy morning planner pipeline. |
| `onStoryWrite` | Firestore | `functions/aiPlanning.js` | Story write trigger. |
| `onTaskWrite` | Firestore | `functions/aiPlanning.js` | Task write trigger. |

## Finance And Monzo

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `createMonzoOAuthSession` | callable | `functions/index.js` | Starts Monzo auth session. |
| `monzoOAuthStart` / `monzoOAuthCallback` | HTTP | `functions/index.js` | Browser OAuth flow for Monzo. |
| `monzoListAccounts` | callable | `functions/index.js` | Lists Monzo accounts. |
| `monzoCreatePot` | callable | `functions/index.js` | Creates a Monzo pot. |
| `monzoRegisterWebhook` | callable | `functions/index.js` | Registers Monzo webhook. |
| `monzoWebhook` | HTTP | `functions/index.js` | Receives Monzo webhook events. |
| `revokeMonzoAccess` | callable | `functions/index.js` | Disconnects Monzo. |
| `syncMonzo` / `syncMonzoNow` | callable | `functions/index.js` | Main Monzo sync endpoints. |
| `monzoSyncTransactions` | callable | `functions/index.js` | Pulls Monzo transactions. |
| `processMonzoSyncJob` | Firestore | `functions/index.js` | Background sync-job processor. |
| `monzoBackstopSync` | scheduled | `functions/index.js` | Frequent safety sync. |
| `monzoTransferPlan` | callable | `functions/index.js` | Generates transfer planning data. |
| `listUserPots` | callable | `functions/index.js` | Lists stored pots. |
| `setGoalPotLink` | callable | `functions/index.js` | Links goals to pots. |
| `fetchDashboardData` | callable | `functions/index.js` | Finance dashboard payload. |
| `deleteFinanceData` | callable | `functions/index.js` | Purges finance data. |
| `exportFinanceData` | callable | `functions/index.js` | Exports finance data. |
| `updateMonzoTransactionCategory` | callable | `functions/index.js` | Updates transaction category. |
| `recomputeMonzoAnalytics` | callable | `functions/index.js` | Rebuilds analytics. |
| `setMerchantMapping` | callable | `functions/index.js` | Upserts merchant mapping. |
| `setMonzoSubscriptionOverride` | callable | `functions/index.js` | Overrides subscription classification. |
| `setTransactionCategoryOverride` | callable | `functions/index.js` | Manual category override. |
| `bulkUpsertMerchantMappings` | callable | `functions/index.js` | Bulk merchant mapping upsert. |
| `importMerchantMappingsCsv` | callable | `functions/index.js` | Imports merchant mappings from CSV. |
| `applyMerchantMappings` | callable | `functions/index.js` | Reapplies mappings to transactions. |
| `backfillMerchantKeys` | callable | `functions/index.js` | Backfills normalized merchant keys. |
| `generateMonzoAuditReport` | callable | `functions/index.js` | Finance audit report. |
| `nightlyMonzoAnalytics` | scheduled | `functions/index.js` | Nightly analytics sweep. |
| `monzoIntegrationMonitor` | scheduled | `functions/index.js` | Monitoring/health sweep. |
| `classifyMonzoTransactions` | Firestore | `functions/index.js` | Classification on transaction write. |
| `monzoAiCategorizationSweep` | scheduled | `functions/index.js` | AI categorization backfill sweep. |
| `backfillMonzoAiCategorization` | callable | `functions/index.js` | Manual AI categorization backfill. |
| `monzoSpendAnomalySweep` | scheduled | `functions/index.js` | Spend-anomaly detection. |
| `monzoGoalPotRefLinker` | scheduled | `functions/index.js` | Links goal references to pot metadata. |
| `syncMonzoTwiceDaily` | scheduled | `functions/index.js` | Scheduled sync. |
| `syncMonzoHourly` | scheduled | `functions/index.js` | Scheduled sync. |

### Finance Enhancement Module

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `importExternalFinanceTransactions` | callable | `functions/finance/enhancements.js` | Imports non-Monzo finance transactions. |
| `importMonzoTransactionsCsv` | callable | `functions/finance/enhancements.js` | Imports Monzo CSV exports. |
| `matchExternalToMonzoTransactions` | callable | `functions/finance/enhancements.js` | Matches imported rows against Monzo data. |
| `recomputeDebtServiceBreakdown` | callable | `functions/finance/enhancements.js` | Rebuilds debt-service analytics. |
| `generateFinanceActionInsights` | callable | `functions/finance/enhancements.js` | LLM-generated finance actions. |
| `convertFinanceActionToStory` | callable | `functions/finance/enhancements.js` | Turns finance actions into stories. |
| `upsertManualFinanceAccount` | callable | `functions/finance/enhancements.js` | Creates/updates manual accounts. |
| `deleteManualFinanceAccount` | callable | `functions/finance/enhancements.js` | Deletes manual accounts. |
| `fetchFinanceEnhancementData` | callable | `functions/finance/enhancements.js` | Fetches enhancement dashboard data. |

## Fitness, Coach, Strava, And Parkrun

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `syncFitnessKpisNightly` | scheduled | `functions/index.js` | Updates KPI progress from workout data. |
| `syncFitnessKpisNow` | callable | `functions/index.js` | Manual per-user KPI sync. |
| `syncStrava` | callable | `functions/index.js` | Pulls Strava activities. |
| `enrichStravaHR` | callable | `functions/index.js` | Adds HR data/detail to Strava records. |
| `stravaOAuthStart` / `stravaOAuthCallback` | HTTP | `functions/index.js` | Strava OAuth flow. |
| `stravaWebhook` | HTTP | `functions/index.js` | Strava webhook receiver. |
| `connectParkrunApi` | callable | `functions/index.js` | Connects Parkrun API metadata. |
| `syncParkrun` | callable | `functions/index.js` | Imports Parkrun results. |
| `reconcileParkrunStrava` | callable | `functions/index.js` | Reconciles Parkrun and Strava data. |
| `getFitnessOverview` | callable | `functions/index.js` | Fitness summary payload. |
| `getRunFitnessAnalysis` | callable | `functions/index.js` | Run-analysis payload. |
| `enableFitnessAutomationDefaults` | callable | `functions/index.js` | Seeds automation defaults for fitness flow. |
| `computeParkrunPercentiles` | callable | `functions/index.js` | Computes Parkrun percentiles. |
| `weeklyParkrunSync` | scheduled | `functions/index.js` | Weekly Parkrun sync. |
| `dailySync` | scheduled | `functions/index.js` | Daily fitness/media sync bundle. |

### Coach Module

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `runCoachOrchestratorNightly` | scheduled | `functions/coach/coachOrchestrator.js` | Main AI coach orchestration job. |
| `logHealthMetric` | callable | `functions/coach/coachOrchestrator.js` | Writes health metric data. |
| `getCoachToday` | callable | `functions/coach/coachOrchestrator.js` | Returns current coaching guidance. |
| `provisionIronmanGoals` | callable | `functions/coach/coachOrchestrator.js` | Seeds Ironman-related goals. |
| `analyzeBodyPhoto` | callable | `functions/coach/coachOrchestrator.js` | Body-photo analysis. |
| `sendCoachNudgesNoon` | scheduled | `functions/coach/coachOrchestrator.js` | Midday nudges. |
| `sendCoachNudgesEvening` | scheduled | `functions/coach/coachOrchestrator.js` | Evening nudges. |
| `sendCoachMorningBriefing` | scheduled | `functions/coach/coachDailyBriefing.js` | Morning briefing. |
| `sendWeeklyPhaseProgress` | scheduled | `functions/coach/coachDailyBriefing.js` | Weekly phase progress summary. |
| `checkKpiOffTrack` | scheduled | `functions/coach/coachDailyBriefing.js` | KPI alerting. |
| `triggerCoachBriefingNow` | callable | `functions/coach/coachDailyBriefing.js` | Manual briefing trigger. |
| `pollFitnessProgrammes` | scheduled | `functions/coach/coachFitnessScheduler.js` | Polls external fitness programmes/calendars. |
| `scheduleCoachFitnessBlocks` | scheduled | `functions/coach/coachFitnessScheduler.js` | Creates fitness blocks from programme data. |
| `triggerPollFitnessProgrammes` | callable | `functions/coach/coachFitnessScheduler.js` | Manual poll. |
| `triggerScheduleCoachFitnessBlocks` | callable | `functions/coach/coachFitnessScheduler.js` | Manual block scheduling. |

## Media, Reminders, And External Integrations

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `syncYouTubeWatchLater` | callable | `functions/index.js` | Imports YouTube Watch Later items. |
| `traktDeviceCodeStart` / `traktDeviceCodePoll` | callable | `functions/index.js` | Trakt device-code auth flow. |
| `traktOAuthStart` / `traktOAuthCallback` | HTTP | `functions/index.js` | Trakt browser OAuth flow. |
| `syncTrakt` | callable | `functions/index.js` | Imports/syncs Trakt data. |
| `traktMarkWatched` | callable | `functions/index.js` | Marks Trakt items watched. |
| `onStoryTraktStatusSync` | Firestore | `functions/index.js` | Syncs Trakt status from Bob story changes. |
| `syncSteam` | callable | `functions/index.js` | Imports Steam backlog/library data. |
| `getSteamAppDetails` | callable | `functions/index.js` | Fetches Steam app metadata. |
| `syncHardcover` | callable | `functions/index.js` | Imports Hardcover data. |
| `hardcoverUpdateStatus` | callable | `functions/index.js` | Updates Hardcover item state. |
| `onStoryHardcoverStatusSync` | Firestore | `functions/index.js` | Syncs Hardcover status from story updates. |
| `importHardcoverListToStories` | callable | `functions/index.js` | Converts Hardcover list items into stories. |
| `mediaImportGenerateStories` | callable | `functions/index.js` | Generates stories from imported media data. |
| `remindersPush` | HTTP | `functions/index.js` | Inbound reminders push webhook. |
| `remindersPull` | HTTP | `functions/index.js` | Reminder ingestion + processing endpoint. |
| `n8nCalendarWebhook` | HTTP | `functions/index.js` | n8n calendar webhook entrypoint. |
| `onCalendarBlockWritten` | Firestore | `functions/index.js` | Outbound n8n notification on calendar block changes. |
| `scheduleSteamGamesViaN8n` | callable | `functions/index.js` | Pushes Steam-game scheduling work to n8n. |

## Reporting, Diagnostics, Admin, And Maintenance

| Function | Trigger | Source | Purpose |
| --- | --- | --- | --- |
| `createTrackingIssue` | callable | `functions/index.js` | Creates issue-tracking metadata. |
| `diagnosticsStatus` | callable | `functions/index.js` | Returns diagnostics/health data. |
| `getEmailSettings` | callable | `functions/index.js` | Reads email configuration. |
| `saveEmailSettings` | callable | `functions/index.js` | Writes email configuration. |
| `normalizeStatuses` | callable | `functions/index.js` | Status-normalization migration helper. |
| `generateWeeklySummaries` | scheduled | `functions/index.js` | Weekly summary email/report generation. |
| `dispatchDailySummaryEmail` | scheduled | `functions/index.js` | Daily summary email dispatch. |
| `dispatchDataQualityEmail` | scheduled | `functions/index.js` | Data quality report dispatch. |
| `dispatchWeeklyFinanceSummaryEmail` | scheduled | `functions/index.js` | Weekly finance summary dispatch. |
| `sendDailySummaryNow` | callable | `functions/index.js` | Manual daily summary send. |
| `sendDataQualityNow` | callable | `functions/index.js` | Manual data-quality send. |
| `previewDailySummary` | callable | `functions/index.js` | Preview daily summary output. |
| `previewDataQualityReport` | callable | `functions/index.js` | Preview data-quality output. |
| `cleanupUserLogs` | scheduled | `functions/index.js` | Log retention cleanup. |
| `cleanupTaskCalendarEvent` | Firestore | `functions/index.js` | Removes calendar events when task state no longer warrants them. |
| `onStorySprintChange` | Firestore | `functions/index.js` | Reacts to sprint changes on stories. |
| `onStoryDueDateAutoSprint` | Firestore | `functions/index.js` | Auto-assigns sprint by due date. |
| `onStoryWritten` | Firestore | `functions/index.js` | General story write trigger. |
| `onTaskWritten` | Firestore | `functions/index.js` | General task write trigger. |
| `onTaskWriteNormalize` | Firestore | `functions/index.js` | Task normalization write trigger. |
| `ensureEntityRefs` | scheduled | `functions/index.js` | Maintains reference-number integrity. |
| `tagTasksAndBuildDeepLinks` | scheduled | `functions/index.js` | Builds tags and deep links. |
| `tasksIntegrityReport` | callable | `functions/index.js` | Integrity report for tasks data. |
| `backfillReferenceNumbers` | callable | `functions/index.js` | Backfills entity reference numbers. |
| `getFeatureFlags` / `setFeatureFlag` | callable | `functions/featureFlags.js` | Reads or writes feature flags. |
