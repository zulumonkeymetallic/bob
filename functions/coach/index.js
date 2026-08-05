/**
 * Agentic Ironman Coach — barrel file
 * Re-exports all Cloud Function symbols from the coach module.
 */

'use strict';

const orchestrator = require('./coachOrchestrator');
const briefing = require('./coachDailyBriefing');
const scheduler = require('./coachFitnessScheduler');

// Orchestration & data
exports.runCoachOrchestratorNightly = orchestrator.runCoachOrchestratorNightly;
exports.logHealthMetric            = orchestrator.logHealthMetric;
exports.getCoachToday              = orchestrator.getCoachToday;
exports.provisionIronmanGoals      = orchestrator.provisionIronmanGoals;
exports.analyzeBodyPhoto               = orchestrator.analyzeBodyPhoto;
exports.sendCoachNudgesNoon            = orchestrator.sendCoachNudgesNoon;
exports.sendCoachNudgesEvening         = orchestrator.sendCoachNudgesEvening;
// checkAfternoonSteps is retired — superseded by eveningCheckpoint below.
//
// It read `profiles.healthkitStepsToday`, an undated mirror that showed the same 5,675 on
// three consecutive days; hardcoded a 12,000 target rather than reading the profile's;
// booked exactly 30 minutes whatever the deficit, so an 8,000-step gap got a walk that
// closes 3,000 of it; placed the block at the next half-hour boundary with **no check for
// whether the time was free**; and ran only for users with a telegram_sessions row.
//
// Replaced rather than run alongside: two schedulers both adding walk blocks is precisely
// the duplication this codebase keeps being bitten by.

// Telegram briefings & alerts
exports.sendCoachMorningBriefing   = briefing.sendCoachMorningBriefing;
exports.sendWeeklyPhaseProgress    = briefing.sendWeeklyPhaseProgress;
exports.checkKpiOffTrack           = briefing.checkKpiOffTrack;
exports.triggerCoachBriefingNow    = briefing.triggerCoachBriefingNow;

// Internal helper re-exported for telegramWebhook.js command router
exports.handleCoachCommand         = briefing.handleCoachCommand;

// Fitness programme scheduler — iCal polling + calendar block creation
exports.pollFitnessProgrammes             = scheduler.pollFitnessProgrammes;
exports.scheduleCoachFitnessBlocks        = scheduler.scheduleCoachFitnessBlocks;
exports.triggerPollFitnessProgrammes      = scheduler.triggerPollFitnessProgrammes;
exports.triggerScheduleCoachFitnessBlocks = scheduler.triggerScheduleCoachFitnessBlocks;

// Evening catch-up — steps against target, a walk sized to the gap, one nudge
const eveningCheckpoint = require('./eveningCheckpoint');
exports.eveningStepCheckpoint    = eveningCheckpoint.eveningStepCheckpoint;
exports.triggerEveningCheckpoint = eveningCheckpoint.triggerEveningCheckpoint;
