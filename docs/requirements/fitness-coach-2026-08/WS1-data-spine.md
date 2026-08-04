# WS1 — Fitness Data Spine

**Repos:** `bob` (functions, rules), `bob-ios`
**Gates:** WS2, WS3, WS5, WS6
**Read first:** [README.md](README.md)

---

## 1. Why this exists

Every downstream feature Jim asked for — zone charts, KPI progress, a coach that
adapts to HRV — reads from a spine that is broken in four places. Each break has
gone unnoticed because both ends of it are wrong in the same direction, so nothing
ever errors.

The purpose of WS1 is to make the underlying data *true*. It ships no new screens.

---

## 2. Current state

### 2.1 HealthKit workouts are silently discarded

The chain, verified end to end:

1. `HealthKitSyncService.pushUnseenWorkouts` (`bob-ios`, line 552) enqueues each
   new HealthKit workout as `workout_create`.
2. `SyncManager.syncItem` (line 351) routes it to
   `FirestoreService.createWorkoutWithId`.
3. That writes to `db.collection("workouts")` — `FirestoreService.swift:800`.
4. **`workouts` has no rule in `firestore.rules`, and the file has no catch-all.**
   Only `metrics_workouts` is declared. So the write is denied.
5. `SyncManager.isPermanentFailure` (line 316) classifies `permissionDenied` as
   permanent, so the item is **deleted from the queue** with a WARN log rather
   than retried.

Net effect: no HealthKit workout has ever reached Firestore, and the only trace is
a line in the iOS sync log. This is a far better explanation for "0 workouts in the
last 30 days" than "Jim has not trained".

`functions/services/fitnessKpiSync.js:172` reads the same non-existent `workouts`
collection, which is why the server side never complained either.

### 2.2 Zone data exists only for Strava, computed on a guessed max HR

`enrichActivityHr` (`functions/index.js`, ~13690) pulls Strava HR streams and
writes `metrics_workouts.hrZones = {z1Time_s … z5Time_s}` plus `maxHrUsed`.

- `getUserMaxHr` (`functions/index.js:13658`) read `profiles.maxHr`, which was
  `null`, and fell back to `220 - age` or a hardcoded `190`.
- The function returns early with `already_enriched` whenever
  `hrZones.z1Time_s != null`, so correcting `maxHr` does **not** recompute history.
- HealthKit workouts carry no HR data at all — `pushUnseenWorkouts` sends only
  `type`, `sportType`, `distance_m`, `startDate`, `durationSeconds`, `provider`.

Consequence: the headline "46% of training time in Z4/Z5" is computed against the
wrong boundaries and covers only outdoor Strava activities. It is not yet a fact.

### 2.3 Readiness is a frozen constant

`coachOrchestrator.js:332`:

```js
const appleReadiness = profile.healthkitReadinessScore ?? null; // 0-100
```

When set, this short-circuits the HRV/sleep computation entirely. It currently
reads `59`, and nothing in the present iOS source writes it —
`HealthKitSyncService.swift:738` states readiness is deliberately kept local-only
because it is "computed server-side".

So `coach_daily` for 1, 2 and 3 August are byte-identical: `readinessScore 0.59`,
label `red`. The coach has been declaring Jim unrecovered every day off a value
that stopped moving.

There is a second, independent timing fault. The orchestrator runs at 04:00
(`coachOrchestrator.js:729`) and reads `health_metrics/{uid}_{today}` for
`hrvMs` and `sleepDurationH`. At 04:00, "today" has barely started and the night's
sleep has not finished, so both are reliably `null` — Apple writes HRV and sleep
for a night once it ends. Even with the stale field removed, today's readiness
would be computed from nothing.

`stepsToday` has the same shape of problem: read at 04:00, `healthkitStepsToday`
holds the tail of the previous day, which is why three consecutive `coach_daily`
documents record 5,675 steps.

### 2.4 Five disagreeing activity taxonomies

| Location | Buckets |
|---|---|
| `BOBWorkout.sportCategory` (`bob-ios`) | run *(includes walk and hike)*, swim, cycle, other |
| `HealthKitSyncService.category(for:)` (line 617) | same four; strength and climbing → "other" |
| `WorkoutsDashboard.tsx:178` | run, walk, swim, bike, strength, other — matched on title keywords |
| `react-app/src/types/v3.0.8-types.ts:182` | run, bike, swim, strength, other |
| `isProtectedTrainingEvent` (`schedulingService.js:116`) | title contains run/swim/strength/crossfit/gym/training |

Live consequences:

- **Hikes count as runs.** `.hiking` maps to `"run"` in both iOS mappings, so a
  12km hike is credited against a 30km/week *running* KPI.
- **Walks count as runs** in `BOBWorkout.sportCategory`, for the same reason.
- **Indoor and outdoor cycling are indistinguishable**, though both sources
  distinguish them: HealthKit via `HKMetadataKeyIndoorWorkout`, Strava via
  `VirtualRide`.
- **Strength and climbing land in "other"** and therefore in no KPI at all.

### 2.5 KPI resolution is client-side only

`react-app/src/utils/kpiResolver.ts` is capable — healthkit/strava/habit/finance
sources, `sourcePriority`, freshness windows, persistence to `goal_kpi_metrics` and
`weekly_goal_kpi_snapshots`. But it runs in the browser. It resolves only while the
web app is open, which is why no KPI value can reach iOS, a notification, or the
coach.

The server-side equivalent, `fitnessKpiSync.js`, reads the wrong collection (2.1)
*and* the legacy `kpis` array rather than `kpisV2`, matching KPI type by substring
of the KPI's display name (lines 192-219).

---

## 3. Requirements

### R1 — One workouts collection

**R1.1** iOS writes workouts to `metrics_workouts`, not `workouts`.
Change `FirestoreService.createWorkoutWithId` (`FirestoreService.swift:800`).

**R1.2** Document id convention: `{uid}_{stravaActivityId}` for Strava (existing),
`{uid}_hk_{healthKitUUID}` for HealthKit. `pushUnseenWorkouts` currently passes
`hk_{uuid}` as the record id — prefix it with the uid to match.

**R1.3** `firestore.rules` already permits `metrics_workouts` create/read/update/
delete for the owner. Verify the rule satisfies a client create with
`ownerUid == request.auth.uid`, and add a regression note that `workouts` is not a
collection.

**R1.4** `fitnessKpiSync.js:172` reads `metrics_workouts`.

**R1.5** Grep both repos for any other reference to a bare `workouts` collection
and remove it.

**Acceptance:** a workout recorded on the Watch appears in `metrics_workouts`
within one background sync cycle, with `provider: "healthkit"`, and the iOS sync
log records no `Discarding unwritable workout_create` line.

### R2 — Canonical activity taxonomy

**R2.1** Define one taxonomy, in one module per repo:

`run` · `walk` · `bike_outdoor` · `bike_indoor` · `swim` · `strength` · `climb` ·
`hike` · `sauna`

Suggested homes: `functions/utils/activityTaxonomy.js` and
`bob-ios/BOB/Sources/Models/ActivityType.swift`, mirrored, with a test asserting
the two lists match.

**R2.2** Each activity declares its primary metric:

| Activity | Primary metric | Secondary |
|---|---|---|
| run, walk, hike, swim, bike_outdoor | distance | duration, zone time |
| bike_indoor, strength, climb | duration + zone time | — (distance is meaningless or absent) |
| sauna | habit occurrence only | — |

**R2.3** Mapping rules:

- HealthKit: `.running`→run, `.walking`→walk, `.hiking`→hike, `.swimming`/
  `.waterFitness`→swim, `.cycling` with `HKMetadataKeyIndoorWorkout == true`
  →bike_indoor else bike_outdoor, `.traditionalStrengthTraining`/
  `.functionalStrengthTraining`/`.highIntensityIntervalTraining`→strength,
  `.climbing`→climb.
- Strava: `Run`/`TrailRun`→run, `Walk`→walk, `Hike`→hike, `Swim`→swim,
  `VirtualRide`→bike_indoor, `Ride`/`GravelRide`/`MountainBikeRide`→bike_outdoor,
  `WeightTraining`/`Workout`→strength, `RockClimbing`→climb.

**R2.4** Replace every taxonomy listed in §2.4 with the canonical one. Where a
surface needs coarser grouping (e.g. "cycle" covering both bike variants), derive
it from the canonical list rather than re-deciding.

**R2.5** `isProtectedTrainingEvent` (`schedulingService.js:116`) keys off the
canonical activity on the block rather than substring-matching the title. Preserve
the existing behaviour that a walk is movable (Jim's decision, 2026-07-21) —
express it as a per-activity `protected: true|false` flag, with sauna and walk
`false`.

**Acceptance:** a 12km hike credits `hike`, not `run`; a Zwift session credits
`bike_indoor`; a gym session credits `strength` and appears in a session count.

### R3 — HR zones from HealthKit

**R3.1** On iOS, for each workout being pushed, query `HKQuantityType(.heartRate)`
samples bounded by the workout's date interval, and bucket time into five zones
using `profiles.maxHr` and the boundaries in D7.

**R3.2** Zone boundaries must come from one shared definition, mirroring
`hrZonesFromMax` (`functions/index.js:13667`) — 50/60/70/80/90% of max. Do not
re-derive them per call site.

**R3.3** Write `hrZones: {z1Time_s … z5Time_s}`, `maxHrUsed`, and
`zoneSource: "healthkit"` onto the `metrics_workouts` document.

**R3.4** Where both a HealthKit and a Strava record exist for the same session
(`pushUnseenWorkouts` already dedupes within a 30-minute window,
`HealthKitSyncService.swift:598`), **HealthKit wins** for zone data per D2.

**R3.5** `BOBWorkout` gains `durationSeconds`, `hrZones` and `activity` (canonical).
It currently has no duration field at all, which is why iOS could not compute
predictions locally.

**Acceptance:** a pool swim recorded on the Watch, never uploaded to Strava,
produces a zone breakdown visible in `metrics_workouts`.

### R4 — Max HR: entry, and re-enrichment

**R4.1** Add a max HR field to `SettingsPage.tsx` (web) and Settings on iOS,
writing `profiles.maxHr`. There is currently no UI anywhere for it — the value was
written directly on 2026-08-04.

**R4.2** `enrichActivityHr` re-enriches when `maxHrUsed !== profiles.maxHr`, rather
than returning `already_enriched` on any existing `hrZones`. Keep the early return
when the max is unchanged.

**R4.3** Provide a one-shot backfill (callable or script) that re-enriches the full
Strava history against `maxHr = 186`, so the zone distribution can be assessed
honestly for the first time.

**R4.4** If `profiles.maxHr` is unset, surface that as a data-quality warning on
the fitness surfaces rather than silently falling back to `220 - age`. A guessed
max produces a confidently wrong chart.

**Acceptance:** after backfill, `fitness_overview.hrZones` and every
`metrics_workouts.maxHrUsed` read `186`.

### R5 — Readiness that reflects reality

**R5.1** Remove the unconditional preference for `profiles.healthkitReadinessScore`
at `coachOrchestrator.js:332`. Either:

- **(preferred)** delete the branch and always compute from HRV and sleep; or
- keep it but require freshness — accept the value only if written today, which
  means iOS must start writing it with a date stamp again.

Do not leave a path where a stale scalar silently outranks live data.

**R5.2** Fix the timing. HRV and sleep for the night ending on day *D* are written
by Apple during the morning of *D*. The 04:00 run must therefore either:

- read the metrics for the night just ended once they exist — move the
  orchestrator to ~07:00, before the 07:00 briefing consumes `coach_daily`; or
- keep the 04:00 run for planning and recompute readiness on the phone when the
  day's metrics land, writing back.

Choose one and state it in the code. The current arrangement guarantees `null`.

**R5.3** `stepsToday` must not be read from `profiles.healthkitStepsToday` at a
time when it holds the previous day's tail. Read `health_metrics/{uid}_{date}` for
the correct date key, or timestamp the profile mirror and reject it when stale.

**R5.4** When readiness cannot be computed, `coach_daily` must record
`readinessScore: null` and `readinessLabel: "unknown"` — never a default that reads
as a real measurement. The current fallback (`hrvRatio = 1.0`, `sleepRatio = 1.0`)
silently yields a perfect score from an absence of data.

**Acceptance:** on a day with no HRV, `coach_daily.readinessLabel` is `unknown` and
the coach makes no intensity adjustment; on a day with HRV, the score moves.

### R6 — Server-side KPI resolution

**R6.1** Port `react-app/src/utils/kpiResolver.ts` to a Cloud Function
(`functions/services/kpiResolution.js`) preserving its semantics: candidate sources
from `sourcePriority`, per-source bindings, freshness windows, first fresh source
wins, `user_input` and `manual_task` always accepted.

**R6.2** Run it in the nightly chain and on demand via a callable. Write
`goal_kpi_metrics/{uid}_{goalId}` and `weekly_goal_kpi_snapshots/{uid}_{weekKey}_{goalId}`
— the same documents the client writes today, so existing readers keep working.

**R6.3** Retire `fitnessKpiSync.js`'s name-substring type detection
(lines 192-219) in favour of the declared `kpisV2` bindings. Keep the legacy path
behind a flag only for goals that still carry a legacy `kpis` array.

**R6.4** The web resolver becomes a thin client of the same result where possible,
so there is one definition of a KPI value, not two that can disagree.

**Acceptance:** with the web app closed for 48 hours, `goal_kpi_metrics` is still
current, and iOS can read a KPI value it did not compute.

### R7 — Strava sync verification

**R7.1** `profiles.stravaConnected` is `true` but `stravaLastSyncAt` has never been
written. Determine whether `syncStrava` is running at all, and write the timestamp
on every run — success and failure both.

**R7.2** Surface Strava and HealthKit freshness on the fitness surface as an
explicit staleness indicator. `kpiResolver.ts:101` already carries a comment noting
`healthkitLastSyncAt` was stuck at 2026-06-06 while iOS wrote `health_metrics` —
the same class of fault, previously worked around rather than fixed.

**Acceptance:** the fitness page states, per source, when it last received data.

---

## 4. Out of scope

- Any new screen or chart (WS3).
- New KPI *types* such as zone share (WS2).
- Changing what the coach does with readiness once it is correct (WS5).
- Garmin, Whoop or any third provider.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Re-enrichment at `maxHr = 186` reveals the Z4/Z5 share is *worse*, not better. | That is the correct outcome; it is the number Jim is trying to move. Do not tune the boundaries to flatter the data. |
| Backfilling Strava HR streams hits API rate limits. | Batch, respect Strava's 100/15min and 1000/day limits, make the backfill resumable. |
| HealthKit HR sampling on older workouts is sparse. | Record sample count alongside `hrZones`; treat a workout with fewer than N samples as having no zone data rather than a misleading one. |
| Moving the orchestrator to 07:00 collides with the 07:00 briefing. | Sequence them explicitly rather than relying on schedule proximity. |
