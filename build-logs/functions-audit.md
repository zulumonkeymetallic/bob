# Cloud Functions audit — 2026-08-02

270 deployed (256 in europe-west2, 14 us-central1). 173 callables, 47 scheduled,
24 https, 19 event triggers.

Method: every callable name checked against web (react-app/src), iOS (bob-ios),
bob-mac-sync and ~/.hermes/scripts, plus internal references inside functions/.
Validated by confirming known-live functions are detected as referenced.

## TIER 1 — delete now (debug endpoints, no product value)
  debugBulkDeleteBobEvents
  debugCalendarCleanupDiag
  debugCalendarDeleteEvent
  diagnosticsStatus

## TIER 2 — delete now (one-off migration/import tools that have run)
  backfillReferenceNumbers
  cleanupOrphanedCalendarEventsNow
  importDevelopmentFeatures
  importItems
  importMerchantMappingsCsv
  reconcileParkrunStrava
  reconcilePlanFromGoogleCalendar
  repairDuplicateCalendarEvents

## TIER 3 — CONFIRM FIRST (manual ops triggers, called by hand not by code)
  Unreferenced by design. Deleting removes your ability to force a run.
  previewDailySummary
  previewDataQualityReport
  runAlignStoriesToGoalSprintsNow
  runDailyDigestNow
  runSprintForwardPlannerNow
  syncCalendarAndTasks
  syncCalendarBlocksBidirectional
  syncFitnessKpisNow
  syncFromGoogleCalendar
  syncParkrun
  syncStrava
  triggerBriefingNow
  triggerCheckAfternoonSteps
  triggerCoachBriefingNow
  triggerPollFitnessProgrammes
  triggerScheduleCoachFitnessBlocks
  triggerStoryGoalLinking
  triggerTaskLinking

## NOT DEAD — new this session, deliberately not yet wired
  runAiDelegationNow, runAiDelegationNightly

## Remaining unreferenced callables (review individually)
  autoEnrichTasks
  autoRescheduleMissed
  computeParkrunPercentiles
  createTrackingIssue
  deleteGoogleCalendarEventsNow
  enableFitnessAutomationDefaults
  enhanceNewTask
  enrichStravaHR
  generateGoalStoriesAndKPIs
  getFeatureFlags
  getFitnessOverview
  getFocusGoalsForUser
  getRunFitnessAnalysis
  listUserPots
  mediaImportGenerateStories
  plannerLLM
  recordIntentFocusConversion
  resolveGoalFitnessKpis
  respondToStoryGoalSuggestion
  respondToTaskSuggestion
  scheduleDueTasksToday
  setFeatureFlag
  setGoalPotLink
  suggestDeferralOptions
  sweepStaleDueDateLocks
  taskStoryConversion
  tasksIntegrityReport
  toggleImmovableFlag
  updateStoryTime
  updateTaskTime

## Where the CPU actually is
  38 functions at >=512MiB, one at 2048MiB (nightlyTaskMaintenance).
  Setting maxInstances on these reclaims more than deleting the 12 small ones.
