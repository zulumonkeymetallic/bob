/**
 * Agentic Ironman Coach — Type Definitions
 * All Firestore-backed interfaces for the coach module.
 */

export type CoachReadinessLabel = 'green' | 'amber' | 'red';
export type CoachAdaptationAction = 'none' | 'reduce_load' | 'rest_recovery';
export type CoachPhotoAnalysisStatus = 'pending' | 'complete' | 'error';
export type CoachTrainingType = 'rest' | 'zone2' | 'threshold' | 'long_endurance';
export type CoachHealthMetricSource = 'ios_app' | 'manual';

// ─── health_metrics/{uid}_{YYYY-MM-DD} ────────────────────────────────────────

export interface HealthMetric {
  uid: string;
  date: string;                    // "2026-03-22"
  hrvMs: number | null;            // HRV in milliseconds (SDNN)
  sleepDurationH: number | null;   // Hours slept
  restingHr: number | null;
  sleepScore: number | null;       // Optional Garmin/Whoop score 0-100
  source: CoachHealthMetricSource;
  createdAt: any;
  updatedAt: any;
}

// ─── coach_daily/{uid}_{YYYY-MM-DD} ───────────────────────────────────────────

export interface CoachMacros {
  proteinG: number;
  carbG: number;
  fatG: number;
  tdeeKcal: number;
  tomorrowTrainingType: CoachTrainingType;
  // Actuals from HealthKit (null = not yet logged today)
  proteinActualG: number | null;
  carbActualG: number | null;
  fatActualG: number | null;
}

export interface CoachPhaseRef {
  phaseIndex: number;        // 0-3
  phaseName: string;
  umbrellaGoalId: string;
  phaseGoalId: string;
  dayInPhase: number;        // e.g. 47
  totalDaysInPhase: number;  // e.g. 150
}

export interface CoachDaily {
  uid: string;
  date: string;
  readinessScore: number;               // 0.0 – 1.0
  readinessLabel: CoachReadinessLabel;
  hrvToday: number | null;
  hrv7dAvg: number | null;
  sleepToday: number | null;
  adaptedBlockId: string | null;        // calendar_blocks doc that was mutated
  adaptationAction: CoachAdaptationAction;
  macros: CoachMacros;
  phase: CoachPhaseRef;
  briefingText: string;                 // Pre-rendered for /coach Telegram command
  weeklyPhotoPromptActive: boolean;     // true on Mondays
  muscleAtrophyAlert: boolean;          // guardrail triggered
  // Surfaced from fitness_overview
  fitnessScore: number | null;          // 0-100 composite fitness score
  fitnessLevel: string | null;          // 'Peak' | 'Sharp' | 'Building' | 'Base' | 'Rebuild'
  weeklyRunKm: number | null;
  weeklyBikeKm: number | null;
  weeklySwimKm: number | null;
  currentBodyFatPct: number | null;
  currentWeightKg: number | null;
  createdAt: any;
  updatedAt: any;
}

// ─── coach_photos/{uid}/photos/{timestamp} ────────────────────────────────────

export interface CoachPhoto {
  uid: string;
  storagePath: string;       // gs:// path used for download
  downloadUrl: string;       // Public HTTPS URL for display
  estimatedBfPct: number | null;
  observations: string | null;
  analysisStatus: CoachPhotoAnalysisStatus;
  analysisError: string | null;
  capturedAt: any;
  analyzedAt: any | null;
}

// ─── coach_weekly_prompts/{uid} ───────────────────────────────────────────────

export interface CoachWeeklyPrompt {
  uid: string;
  weekKey: string;           // "2026-W12"
  promptActive: boolean;
  dismissedAt: any | null;
}

// ─── provisionIronmanGoals response ───────────────────────────────────────────

export interface IronmanProvisionResult {
  umbrellaGoalId: string;
  phaseGoalIds: string[];    // [phase0Id, phase1Id, phase2Id, phase3Id]
  focusGoalId: string;
  alreadyExisted: boolean;
}

// ─── getCoachToday response ───────────────────────────────────────────────────

export interface CoachTodayResponse {
  readiness: {
    score: number;
    label: CoachReadinessLabel;
    hrvToday: number | null;
    hrv7dAvg: number | null;
    sleepToday: number | null;
  };
  macros: CoachMacros;
  todayTraining: {
    blockId: string | null;
    title: string;
    adapted: boolean;
    adaptationAction: CoachAdaptationAction;
  };
  phase: CoachPhaseRef;
  weeklyPhotoPrompt: boolean;
  briefingText: string;
}
