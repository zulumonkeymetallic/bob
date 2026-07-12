# Handover: Phase-Aware Coach session (Claude Code, 2026-07-11/12)

For the agent/session currently working on `FocusGoalsPage.tsx` / `GoalsCardView.tsx` /
`KanbanBoardV2.tsx` / `KanbanColumnV2.tsx` (uncommitted as of this handover) — **zero file
overlap** with anything below, safe to commit independently or together.

## What shipped, already committed + deployed — nothing pending from this session

### `git/bob` (backend) — 2 commits on `main`, already deployed
```
21d3db47 fix(coach): add missing health_metrics composite index
fd8f095f feat(coach): phase-aware LLM briefing + Settings-target reconciliation
```
Files: `functions/coach/coachOrchestrator.js`, `coachFitnessScheduler.js`,
`coachDailyBriefing.js`, `functions/coach/phaseResolver.js` (new),
`react-app/src/types/CoachTypes.ts`, `firestore.indexes.json`.

**Deployed:**
- `firebase deploy --only functions` — ran successfully, verified by downloading the actual
  deployed source archive (not just trusting CLI output) to confirm the new code is live.
- `firebase deploy --only firestore:indexes` — the new `health_metrics(uid,date)` composite
  index is `READY`.

**Important side-effect to know about:** that `functions` deploy was NOT scoped to specific
function names — it deployed the whole `functions/` codebase as it stood at the time, which
included your (or another session's) **uncommitted** `nightlyOrchestration.js` changes wiring
in `semanticClustering.js` (a new embedding-backfill step in the main nightly chain, gated on
`GOOGLE_AI_STUDIO_API_KEY` — Jim confirmed that secret is in Secret Manager). So
`unifiedNightlyOrchestrator`/`runNightlyChainNow` are **already running that code in
production** even though `nightlyOrchestration.js`/`transcriptIngestion.js`/
`functions/semanticClustering.js` are still uncommitted in the working tree. Worth committing
those to match what's actually live, or reverting the deploy if that wasn't intended.

**Not deployed:** `react-app` hosting (bob.jc1.tech) was never rebuilt/redeployed this session.
`CoachTypes.ts` is a type-only change with no `.tsx` consumer written yet, so this doesn't
affect the live site. Don't bundle a hosting deploy without checking in on your own
`FocusGoalsPage.tsx`/Kanban changes first — they'd ship together since hosting deploys the
whole `react-app/build` output.

### `git/bob-ios` — 5 commits on `main`, TestFlight build 18 uploaded
```
8ea6d4a chore: release v1.3 build 18
756ce8c feat(nav): promote Coach to a top-level tab, replacing the redundant Sync tab
904a6b9 chore: release v1.3 build 17
63a9611 feat(coach): phase-aware triathlon Coach with local discrepancy notifications
a0c270a fix(sync): real theme taxonomy for Reminders + correct HealthKit collection
```
Working tree is clean (only pre-existing, unrelated untracked files from before this session).

## What the feature actually does

Root problem: `AICoachView.swift`'s "AI Coach" was 100% static heuristics — no LLM, no phase
awareness — despite a real nightly coach backend already existing
(`coachOrchestrator.js` → `coach_daily/{uid}_{date}`, Vertex AI `gemini-2.5-flash`). The gap
was (a) the LLM system prompt hardcoded "Current phase: Base Build" instead of using the
resolved phase, and (b) iOS read `coach_daily/{uid}` instead of `coach_daily/{uid}_{date}`
(missing date suffix — never matched a real doc).

Fixed: new `phaseResolver.js` (single source of truth for active-phase lookup, previously
duplicated 3x with inconsistent fallbacks), dynamic phase-aware LLM prompt, Settings-target
reconciliation (steps/protein/fat/bodyfat), rebuilt `AICoachView.swift` consuming the real
`coach_daily` doc, new `CoachNotificationService.swift` (local notifications, no push infra),
Coach promoted to a top-level iOS tab.

## Verified facts (not assumed)
- Ironman phase hierarchy is real: umbrella goal + 4 phase goals with real KPIs exist in
  Firestore for Jim's account (`provisionIronmanGoals` was run previously). Phase 0 — Base
  Building is correctly active right now.
- **Found and fixed an unrelated pre-existing bug** while verifying: the nightly coach job had
  been silently failing every night since at least 2026-07-06 (missing Firestore index,
  `FAILED_PRECONDITION` on the HRV 7-day-average fallback query) — `coach_daily` had never
  been written even once. Now fixed; first real run will be tonight's 04:00 Europe/London job.

## Outstanding (not done, no code exists for these)
- On-device verification of the new Coach screen / notification behavior — not yet done on a
  real device.
- `functions/coach/index.js` still re-exports `getCoachToday`/`analyzeBodyPhoto`/nudge
  functions that are `undefined` (dead, commented out in source) — flagged, not fixed, low
  priority separate cleanup.
