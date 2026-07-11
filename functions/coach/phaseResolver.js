/**
 * Agentic Ironman Coach — Active Phase Resolution
 *
 * Single source of truth for "what training phase is the athlete in right now,
 * and what does that phase emphasise". Previously this lookup was duplicated
 * across coachOrchestrator.js, coachFitnessScheduler.js, and coachDailyBriefing.js
 * (twice) with slightly different fallback behaviour in each — consolidated here.
 *
 * Phases are `goals` docs (goalKind:'milestone') with parentGoalId pointing at
 * an umbrella `goals` doc (goalKind:'umbrella'), created by provisionIronmanGoals.
 */

'use strict';

// ─── Phase focus table ────────────────────────────────────────────────────────
//
// Code-resident, not a Firestore field — matches how provisionIronmanGoals
// already hardcodes phase structure/dates. Indexed by phaseIndex (0-3).
// `directive` feeds the LLM system prompt only, not persisted to coach_daily.
const PHASE_FOCUS_TABLE = [
  { // 0 — Base Building
    focusAreas: ['aerobic base', 'technique', 'injury resilience'],
    focusEmphasis: 'performance',
    directive: 'PRIORITISE Zone 2 aerobic volume and technique above all else. Build the engine before adding intensity.',
  },
  { // 1 — Build
    focusAreas: ['threshold work', 'strength', 'volume progression'],
    focusEmphasis: 'performance',
    directive: 'PRIORITISE progressive sport-specific volume with introduced threshold intensity. Strength stays low-rep/compound.',
  },
  { // 2 — Peak
    focusAreas: ['race-specific intensity', 'brick sessions', 'sharpening'],
    focusEmphasis: 'performance',
    directive: 'PRIORITISE race-specific efforts and brick sessions. Volume plateaus while intensity peaks.',
  },
  { // 3 — Taper & Race
    focusAreas: ['recovery', 'nutrition', 'sleep quality'],
    focusEmphasis: 'nutrition_recovery',
    directive: 'PRIORITISE recovery, sleep, and nutrition over training load. Volume drops sharply — trust the taper.',
  },
];

function phaseFocus(phaseIndex) {
  return PHASE_FOCUS_TABLE[phaseIndex] || PHASE_FOCUS_TABLE[0];
}

/**
 * Resolves the athlete's active phase from the `goals` collection.
 * Returns null when there's no umbrella goal, no phase goals, or no phase
 * brackets "now" — callers decide their own fallback (the orchestrator falls
 * back to phase 0 to always have a coach_daily.phase; the Telegram schedulers
 * skip the user for that run instead) rather than this function silently
 * picking one, since the two use cases want different behaviour.
 *
 * @returns {Promise<{phaseIndex: number, phase: object, phases: object[]}|null>}
 */
async function resolveActivePhase(firestore, uid, umbrellaGoalId) {
  if (!umbrellaGoalId) return null;

  const phasesSnap = await firestore
    .collection('goals')
    .where('ownerUid', '==', uid)
    .where('parentGoalId', '==', umbrellaGoalId)
    .get();

  const nowMs = Date.now();
  const phases = phasesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.startDate && p.endDate)
    .sort((a, b) => a.startDate - b.startDate);

  const activePhase = phases.find(p => p.startDate <= nowMs && p.endDate >= nowMs);
  if (!activePhase) return phases.length ? { phaseIndex: -1, phase: null, phases } : null;

  const phaseIndex = phases.indexOf(activePhase);
  return { phaseIndex, phase: activePhase, phases };
}

/** Run/bike/swim/body-fat targets from a phase's kpisV2 (falls back to legacy kpis). */
function extractPhaseKpiTargets(phase) {
  const kpis = (phase && (phase.kpisV2 || phase.kpis)) || [];
  const targets = { runKmTarget: null, bikeKmTarget: null, swimKmTarget: null, bodyFatPctTarget: null };
  for (const kpi of kpis) {
    const name = (kpi.name || '').toLowerCase();
    const target = typeof kpi.target === 'number' ? kpi.target : null;
    if (target === null) continue;
    if (name.includes('run')) targets.runKmTarget = target;
    else if (name.includes('bike') || name.includes('cyc')) targets.bikeKmTarget = target;
    else if (name.includes('swim')) targets.swimKmTarget = target;
    else if (name.includes('body fat') || name.includes('bf')) targets.bodyFatPctTarget = target;
  }
  return targets;
}

/**
 * Assembles the full CoachPhaseRef-equivalent object written into
 * coach_daily.phase. `phaseIndex`/`phase` should come from resolveActivePhase
 * (or a caller-chosen fallback when that returns null).
 */
function buildPhaseRef({ uid, umbrellaGoalId, phaseIndex, phase, nowMs }) {
  const dayInPhase = Math.max(0, Math.ceil((nowMs - phase.startDate) / 86400000));
  const totalDaysInPhase = Math.ceil((phase.endDate - phase.startDate) / 86400000);
  const focus = phaseFocus(phaseIndex);
  return {
    phaseIndex,
    phaseName: phase.title,
    umbrellaGoalId,
    phaseGoalId: phase.id,
    dayInPhase,
    totalDaysInPhase,
    focusAreas: focus.focusAreas,
    focusEmphasis: focus.focusEmphasis,
    kpiTargets: extractPhaseKpiTargets(phase),
  };
}

module.exports = {
  PHASE_FOCUS_TABLE,
  phaseFocus,
  resolveActivePhase,
  extractPhaseKpiTargets,
  buildPhaseRef,
};
