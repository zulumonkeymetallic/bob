# Fitness, Coach & Calendar — Requirements Set (August 2026)

Six workstreams derived from Jim's brain dump of 2026-08-04 and the interview that
followed. Each document is written to be picked up cold by an agent with no memory
of this conversation.

**Read this file first.** It carries the decisions, the shared facts, and the
sequencing. The workstream documents assume it.

---

## 1. What this set is for

Jim wants five things:

1. Goal KPIs (swim/bike/run distance) fed automatically from HealthKit/Strava, and
   visible on iOS as well as web.
2. A stacked bar per recent session showing time in each HR zone, and a 30-day
   doughnut of zone share plus session counts, with a stated bias toward Z2/Z3.
3. One calendar surface, not two — today he enters fitness in both theme blocks and
   real events.
4. An AI coach that plans and re-plans his training week dynamically from HRV,
   heart rate and volume gaps, writing directly into the calendar.
5. Intra-day catch-up: if he is behind on steps by evening, put a walk in the
   calendar and tell him; if macros are not logged, prompt for them in the daily
   check-in on mobile, with web as fallback.

The obstacle is that the data spine underneath all five is broken in ways nobody
has noticed, because both sides of each break are wrong in the same direction.

---

## 2. Decisions taken (2026-08-04)

| # | Decision |
|---|---|
| D1 | **One calendar event, not two.** The coach *fills* the Health & Fitness theme block in place — retitles it to the actual session — rather than creating a second block alongside it. |
| D2 | **HealthKit is the primary zone source**, Strava fills gaps. Pool swims, gym and indoor bike must produce zone data. |
| D3 | **The coach writes, moves and cancels its own fitness blocks automatically.** It notifies after the fact and never touches non-fitness events. |
| D4 | **The week is planned fully dynamically**, not from a recurring skeleton. |
| D5 | **The only immovable is a booked external commitment.** Today that is the Tuesday swimming lesson. Everything else is movable. |
| D6 | **A 24-hour freeze horizon applies by default** — the 04:00 run may re-plan days 2–7 freely but not tomorrow. (Assumption, stated for correction; Jim did not ask for this.) |
| D7 | **Max HR is 186.** Written to `profiles.maxHr` on 2026-08-04 with `maxHrSource: user_stated_2026-08-04`. Zones are % of max: Z1 93–111, Z2 112–130, Z3 130–149, Z4 149–167, Z5 167–186. |
| D8 | **Hyrox becomes a milestone goal inside the Ironman umbrella**, not a second race timeline. You cannot peak for both. |
| D9 | **Spine before surfaces.** WS1 gates almost everything else. |
| D10 | **Sauna is a calendar block plus a habit tick**, never a derived metric. HealthKit has no sauna workout type. |
| D11 | **Evening catch-up puts a real walk block in the calendar** and notifies, rather than notifying alone. (Assumption, stated for correction.) |

### Activity taxonomy (agreed)

run · walk · bike (outdoor) · bike (indoor) · swim · strength · climb · hike · sauna

Hyrox is a **race**, not a weekly activity — it drives the phase plan.

### Weekly session shape — Phase 0 working assumption

Taken from the coach persona at `functions/coach/coachOrchestrator.js:52-58` and
extended for the new activities. **Not confirmed by Jim** — treat as the default
that WS2 makes editable.

| Activity | Per week |
|---|---|
| Swim | 3 |
| Bike | 3 (one long) |
| Run | 4 (one long easy) |
| Strength | 2 |
| Walk | daily, sized to close a 12,000-step target |
| Sauna | 3 |
| Climb | 1 |
| Hike | every other weekend, weather permitting |
| Full rest | 1 day minimum |

### Default session durations (assumption)

swim 45 · run 45 · bike outdoor 120 · bike indoor 60 · strength 45 · climb 90 ·
sauna 30 · walk sized to the step deficit

---

## 3. Shared facts, verified 2026-08-04

Everything below was read from the live system, not inferred.

| Fact | Evidence |
|---|---|
| `profiles.maxHr` was `null` until 2026-08-04; now `186`. | `getUserMaxHr`, `functions/index.js:13658` fell back to `220-age` or a hardcoded `190`. |
| The `workouts` collection **has no Firestore rule** and there is no catch-all. | `firestore.rules` — only `metrics_workouts` is declared; the file states outright that no catch-all exists. |
| iOS writes HealthKit workouts to `workouts`. | `FirestoreService.swift:800` |
| Server-side KPI sync reads `workouts`. | `functions/services/fitnessKpiSync.js:172` |
| Readiness is pinned by a stale profile field. | `coachOrchestrator.js:332` prefers `profiles.healthkitReadinessScore`, currently `59`. `coach_daily` for 1, 2 and 3 August are identical: `readinessScore 0.59`, `red`, `hrvToday: null`, `sleepToday: null`, `stepsToday: 5675`. |
| Nothing in current iOS source writes `healthkitReadinessScore`. | `HealthKitSyncService.swift:738` — readiness is deliberately local-only. |
| Last logged workout: 2026-06-27, 1.37km, avg HR 149.3. `last30` = 0 workouts, 0km. | `fitness_overview.lastWorkout`, `fitness_overview.last30` |
| 90-day zone totals: Z1 6.0h, Z2 3.2h, Z3 2.0h, Z4 4.3h, Z5 5.2h — 46% in Z4/Z5, 25% in Z2/Z3. | `fitness_overview.hrZones`. **Computed on the wrong max HR; unverified until re-enrichment.** |
| Strava is authorised but has never recorded a sync timestamp. | `profiles.stravaConnected: true`, `profiles.stravaLastSyncAt: null` |
| Programme feeds are live: Runna (`cal.runna.com`) and WodBoard. | `profiles.runnerProgrammeUrl`, `profiles.crossFitProgrammeUrl` |
| Predictions already exist server-side and iOS discards them. | Written at `functions/index.js:15627`; `BOBFitnessOverview.swift` maps score/level/totals/last30/lastWorkout only. |
| Current predictions: 5k 22:26 · 10k 46:46 · half 1:43:11 · bike 50k 2:50:18 · bike 30mi 2:44:06 · swim 800m 27:58. | `fitness_overview.predictions` |
| Phase goals overlap and stop four months short of the race. | Phase 1 2026-10-01→2026-12-31 vs Phase 2 2026-10-03→2027-02-15 vs Phase 3 2027-01-07→2027-05-15. Ironman is September 2027. |
| There is no live Hyrox goal. | Only `GR-13177 HYROX Bilbao`, status 4, dated 2032-09-10. |
| Body composition: 72.85kg, 31.1% body fat. Phase 0 target 18%. | `profiles.healthkitWeightKg`, `profiles.healthkitBodyFatPct` |

### Identity

| Key | Value |
|---|---|
| Firebase project | `bob20250810` |
| Owner UID | `3L3nnXSuTPfr08c8DTXG5zYX37A2` |
| Production | `https://bob.jc1.tech` |
| Ironman umbrella goal | `IkJDTUEOFSQhCBQZT6Bn` |
| Repos | `~/git/bob` (web + functions), `~/git/bob-ios` (iOS/watchOS) |

---

## 4. The workstreams

| # | Document | Repos | Gates |
|---|---|---|---|
| WS1 | [Fitness data spine](WS1-data-spine.md) | bob, bob-ios | WS2, WS3, WS5, WS6 |
| WS2 | [Goal KPI binding](WS2-goal-kpi-binding.md) | bob, bob-ios | WS3 (partially), WS5 |
| WS3 | [Fitness surfaces](WS3-fitness-surfaces.md) | bob, bob-ios | — |
| WS4 | [Calendar & theme reconciliation](WS4-calendar-reconciliation.md) | bob | WS5 |
| WS5 | [Adaptive scheduler](WS5-adaptive-scheduler.md) | bob | WS6 (partially) |
| WS6 | [Notifications & daily check-in](WS6-notifications-checkin.md) | bob, bob-ios | — |

### Sequencing

```
WS1 ──┬── WS2 ──┬── WS3
      │         │
      └── WS4 ──┴── WS5 ── WS6
```

WS1 first, and not negotiably: until HealthKit workouts can be written at all,
until zone data is recomputed on the correct max HR, and until readiness stops
reading a frozen field, every downstream surface renders confident nonsense and
the coach makes decisions on a constant.

WS3 can start in parallel with WS2 for the parts that only need `fitness_overview`
mapped onto iOS — that data already exists and is simply being dropped.

---

## 5. Conventions for implementing agents

- **Verify before asserting.** Doc comments in this codebase drift. Trace the call
  graph; if you find a stale comment, fix it in the same change.
- **Status codes differ between stories and tasks.** Story: `0` backlog, `1` in
  progress, `4` done. Task: `0` to do, `1` in progress, `2` done, `3` blocked.
  Never merge the two scales. See `react-app/src/utils/workStatus.ts`.
- **Firestore writes to stories/tasks/goals** go through
  `~/.hermes/scripts/bob_firestore_mutation.py` with `--payload-file`.
- **AI never writes `status`.** On completing delegated work set
  `aiDelegationStatus: 'human_review'`.
- **Deep links** use the Firestore document `id`, not the `ref`:
  `https://bob.jc1.tech/{goals|stories|tasks}/{id}`.
- **UK English** in all user-facing copy. No emojis in code or UI strings that
  Jim will read.
- **Verification**: `npm run lint`, `tsc --noEmit`, `./build --dry-run`. iOS builds
  via `~/git/bob-ios/ORCHESTRATE_BUILD.sh`.
