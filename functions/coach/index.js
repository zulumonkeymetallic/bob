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
exports.analyzeBodyPhoto           = orchestrator.analyzeBodyPhoto;
exports.sendCoachNudgesNoon        = orchestrator.sendCoachNudgesNoon;
exports.sendCoachNudgesEvening     = orchestrator.sendCoachNudgesEvening;

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
