# WS3 — Fitness Surfaces

**Repos:** `bob` (react-app), `bob-ios`
**Depends on:** WS1 (zone data, taxonomy), WS2 (KPI values on iOS) for the KPI parts only
**Read first:** [README.md](README.md)

---

## 1. Why this exists

Three of Jim's asks are display:

1. A stacked bar per recent session — run, swim, bike — showing how much time was
   spent in each HR zone, against a stated preference for Z2 and Z3.
2. On the fitness surface, over the last 30 days: key metrics including session
   counts, and zone share as a doughnut.
3. Predicted times for 5k, 10k, half, **full marathon**, swim, bike and **Ironman**,
   showing current values, captured as a point-in-time baseline every week so
   progress can be tracked over time.

Item 3 is mostly already computed and thrown away by the phone. Items 1 and 2 exist
in one place on web and nowhere on iOS.

---

## 2. Current state

### 2.1 Zone charts exist on web, monthly-bucketed only

`react-app/src/components/WorkoutsDashboard.tsx` (at `/health/workouts`) already
renders stacked Z1–Z5 bars with a time/percent toggle (`zoneDisplayMode`, line 419;
datasets from line 1454). But the buckets are **months**, not sessions. There is no
per-session view, and nothing on `/fitness`.

Zone data reaches it from `metrics_workouts.hrZones` (line 50), so the shape is
already understood client-side.

### 2.2 iOS discards the data it already receives

`BOBFitnessOverview.swift` is a persisted mirror of `fitness_overview/{uid}`. It
maps `fitnessScore`, `fitnessLevel`, `rangeDays`, totals, last-30, and last workout.

It does **not** map `predictions` or `hrZones`, both of which are present on the
document the phone already syncs. They are dropped in the model layer.

This also resolves the item deferred in July as "5K/10K/HM running predictions need
workout-duration plumbing" — no plumbing is needed if iOS reads the server's
computed predictions instead of recomputing from `BOBWorkout`, which has no
duration field.

### 2.3 Predictions: what exists

Computed nightly at `functions/index.js:15627` using Riegel with exponent 1.06
against the *single best* normalised effort in a 90-day window
(`buildNormalizedPredictions`, line ~15383).

Present: `fiveKSec`, `tenKSec`, `halfMarathonSec`, `swim800mSec`, `bike50kSec`,
`bike30miSec`, plus `trendSec`/`trendPct`/`trendDirection` and per-discipline
`source` fields.

Current values: 5k 22:26 · 10k 46:46 · half 1:43:11 · bike 50k 2:50:18 ·
bike 30mi 2:44:06 · swim 800m 27:58.

Absent: **full marathon** and **Ironman**.

### 2.4 There is no time series

`fitness_overview` is a single document per user, overwritten by the nightly chain.
No history exists, so nothing can be tracked over time.

`trendPct`/`trendDirection` compare the last three normalised efforts to the
previous three *within the 90-day window* — that is a within-window trend, not the
week-over-week baseline Jim asked for.

The pattern to copy already exists: `weekly_goal_kpi_snapshots/{uid}_{weekKey}_{goalId}`,
written by `persistResolvedGoalKpis` in `kpiResolver.ts`.

### 2.5 The `/fitness` page today

`MetricsPage.tsx` renders 12-week box grids for run/swim/cycle against hardcoded
weekly targets, 30-day box grids for steps/sleep/protein, a focus-goals section
with live KPI and story progress, and 30-day habit adherence. No zone content at
all.

---

## 3. Requirements

### R1 — Map what iOS already receives

**R1.1** `BOBFitnessOverview` gains `predictions` (all fields, including the ones
added in R4) and `hrZones`. Map them in `SyncModelActor`.

**R1.2** Render on `FitnessView`: a predictions block and a 30-day zone summary.

**R1.3** Respect the existing `isStale` convention — the model already treats a
`fitness_overview` older than three days as a stopped pipeline rather than a quiet
week. Predictions and zones inherit that treatment.

**Acceptance:** iOS shows 5k/10k/half predictions with no new server work.

### R2 — Per-session zone stacked bar

**R2.1** For the most recent N sessions (default 10, configurable), render one
stacked horizontal bar per session: Z1–Z5 by time, with the session's activity,
date and total duration.

**R2.2** Toggle between absolute minutes and percentage of session, matching the
existing `zoneDisplayMode` behaviour on `WorkoutsDashboard`.

**R2.3** Colour Z2 and Z3 as the target band, distinctly from Z1 (too easy to
count) and Z4/Z5 (too hard). The chart's job is to make the Z2/Z3 share obvious at
a glance, not to be neutral.

**R2.4** Sessions with no zone data show as an unfilled bar labelled with the
reason (no HR recorded / not yet enriched), never as an empty bar that reads as
zero training.

**R2.5** Build on both web and iOS. Filterable by activity.

**Acceptance:** the last ten sessions are visibly sorted into "mostly Z2/Z3" and
"not".

### R3 — 30-day fitness summary

**R3.1** On `/fitness` (web) and `FitnessView` (iOS), a 30-day block containing:

- session count, total by canonical activity (run, walk, bike indoor/outdoor,
  swim, strength, climb, hike);
- total distance and total time;
- **zone share as a doughnut** — percentage of recorded time in each of Z1–Z5,
  with the Z2+Z3 share called out as a single number against the target from the
  phase's `zoneBias` (WS2 R5.1);
- days since last session of each activity — this is the signal the coach uses for
  "you haven't run in X days" (WS5), so showing it keeps the two consistent.

**R3.2** The doughnut reads from `metrics_workouts.hrZones` over 30 days, not from
`fitness_overview.hrZones`, which covers the 90-day window.

**R3.3** Where `profiles.maxHr` is unset or `maxHrUsed` disagrees with it, badge the
doughnut as provisional (WS1 R4.4). A zone chart on a guessed max is a confident
lie.

**Acceptance:** the Z2+Z3 share for the last 30 days is a single readable number,
and it is correct against a max HR of 186.

### R4 — Marathon and Ironman predictions

**R4.1** Add full marathon. `buildNormalizedPredictions('run', 42.195, …)`.

**R4.2** Gate it. Riegel at 1.06 from a 5k to a marathon is an 8.4× extrapolation,
well beyond where the exponent holds, and the current implementation takes the
single fastest effort in the window — Jim's most recent run was 1.37km. Require
either:

- a long run of at least 15km in the window, or
- a stiffer exponent for extrapolations beyond ~2× (1.10 is a defensible default),

and mark the result with a confidence band. Do not display a marathon time derived
from a 1.4km effort as though it were a prediction.

**R4.3** Add Ironman. This is not a Riegel extrapolation — model it per leg:

- swim 3.86km from the swim pace prediction, adjusted for open water;
- bike 180.25km from the bike prediction, adjusted for the longer distance;
- run 42.195km at a fatigued pace — 20–30% slower than the standalone marathon
  prediction is the conventional adjustment;
- plus T1 and T2 as configurable constants.

Show the total and the per-leg split. State the model's assumptions in the UI, not
just in the code.

**R4.4** Each prediction carries `basis` — which effort it was derived from, its
distance and date — so a suspicious number can be traced. With a 90-day window and
five weeks of no training, every current prediction is stale, and the surface
should say so.

**Acceptance:** a marathon prediction either exists with a stated basis, or is
absent with a stated reason. Never present without provenance.

### R5 — Weekly baselines

**R5.1** New collection `weekly_fitness_snapshots/{uid}_{weekKey}`, written by the
nightly chain on the first run of each ISO week, capturing: all predictions,
30-day zone shares, weekly volume by activity, session counts, body composition,
`maxHrUsed`, and the phase reference.

**R5.2** `weekKey` follows the existing `getWeeklySnapshotKey()` convention used by
`weekly_goal_kpi_snapshots` so the two can be joined.

**R5.3** Snapshots are immutable once written — a later re-run of the same week
updates only if the source data changed, and records that it did.

**R5.4** Render the series: prediction trend per discipline over time, zone share
over time, weekly volume over time. Web first; iOS gets the headline trend
(current value plus direction versus four weeks ago).

**R5.5** Backfill is not possible — there is no history. Start the series now and
label the start date rather than implying a longer record.

**Acceptance:** after four weeks, the fitness surface shows whether predicted 5k is
improving, and by how much.

### R6 — Consistency between surfaces

**R6.1** `/fitness` (web), `FitnessView` (iOS) and `/health/workouts` must not
disagree on the same number. Where each currently computes independently, move the
computation server-side into `fitness_overview` or the KPI resolution from WS1 R6.

**R6.2** Every figure states its window (7/30/90 days) inline. Several currently do
not, and `sportTotals` has a documented history of a 30-day total being displayed
against a 7-day target.

**Acceptance:** the same metric reads identically on all three surfaces.

---

## 4. Out of scope

- Adding new *sources* of zone data (WS1 R3).
- New KPI types (WS2 R3) — this document consumes them.
- Any scheduling behaviour based on these numbers (WS5).

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| A marathon or Ironman prediction from thin data becomes a number Jim plans against. | R4.2/R4.4 — gate, band, and always show the basis. |
| Charts ship before WS1's re-enrichment, showing a zone split on the wrong max HR. | Sequence after WS1 R4.3, or badge as provisional until `maxHrUsed == 186` everywhere. |
| The doughnut over 30 days is empty because there has been no training. | Empty state must say "no sessions recorded in this window" and show days since last session — not render a zeroed chart. |
