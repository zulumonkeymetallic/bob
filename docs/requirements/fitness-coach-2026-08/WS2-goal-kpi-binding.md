# WS2 — Goal KPI Binding

**Repos:** `bob` (functions, react-app), `bob-ios`
**Depends on:** WS1 (R1 collection fix, R6 server-side resolution)
**Gates:** WS3 (KPI display), WS5 (phase session shape as data)
**Read first:** [README.md](README.md)

---

## 1. Why this exists

Jim's ask, in his words: when he sets a focus goal, its KPIs — swim distance, for
example — should be fed automatically from HealthKit or Strava, and the progress
should be visible on iOS as well as web.

Most of the machinery exists. What is missing is the binding between a *goal* and a
*measurement*, expressed as data rather than as a string match, and a path for that
value to reach the phone.

---

## 2. Current state

### 2.1 Two KPI systems, one of them fictional

`react-app/src/types/KpiTypes.ts` defines a genuinely good model: `kpisV2` entries
carry `type`, `timeframe`, `target`, `unit`, `sourcePriority`,
`sourceBindings: Partial<Record<KpiDataSource, MetricBinding>>`,
`freshnessWindowHours`, `targetDirection`, `aggregation`. `KPIDesigner.tsx` writes
it. `kpiResolver.ts` reads it properly.

Alongside it, `react-app/src/types.ts:74` still declares:

```ts
kpis?: Array<{ name: string; target: number; unit: string }>;
```

and two server consumers still read *that*, inferring meaning from the display name:

- `fitnessKpiSync.js:192-219` — `name.includes('step')` → steps,
  `name.includes('swim')` → swimming distance, and so on.
- `phaseResolver.js:83-92` — `extractPhaseKpiTargets` matches `run`/`bike`/`cyc`/
  `swim`/`body fat` in the KPI name to derive the phase's weekly targets that end
  up in `coach_daily.phase.kpiTargets`.

So a KPI renamed from "Swim 4km/week" to "Weekly pool volume" silently stops
counting, server-side, with no error.

### 2.2 The catalogue points at a collection that does not exist

`react-app/src/utils/kpiDesignerCatalog.ts` binds the Strava metrics to
`collection: 'workouts'` (lines ~166, 175, 184, 193). Per WS1 §2.1 there is no such
collection — the real one is `metrics_workouts`. Every Strava-sourced KPI created
through the designer is bound to nothing.

### 2.3 Targets are hardcoded on the surfaces

`MetricsPage.tsx` (the `/fitness` route) renders literal targets:

```
Run 30km/wk · Swim 4km/wk · Cycle 50km/wk · Steps 12k/day · Sleep 8hr/day · Protein 180g
```

Meanwhile the *real* targets already exist as data on the phase goals —
`coach_daily.phase.kpiTargets` currently reads `runKmTarget: 30`,
`swimKmTarget: 4`, `bikeKmTarget: null`, `bodyFatPctTarget: 18`. Two sources of
truth that happen to agree today and will not tomorrow.

### 2.4 iOS has no concept of a KPI

`BOBGoal.swift` has no KPI fields of any kind. There is no `goal_kpi_metrics`
reader, no KPI model, no display. This is greenfield.

### 2.5 There is no KPI type that expresses what Jim actually wants

`KpiType` covers distance, steps, workouts, HRV, sleep, story points, savings,
habit streaks. It has nothing for:

- **zone share** — "at least 70% of training time in Z2+Z3 over 30 days";
- **session count by activity** — "2 strength sessions a week", which matters
  because strength, climbing and indoor cycling have no meaningful distance;
- **duration by activity** — "90 minutes of climbing a week".

---

## 3. Requirements

### R1 — `kpisV2` is the only KPI shape

**R1.1** Migrate every goal carrying a legacy `kpis` array to `kpisV2`, inferring
`type` and `sourceBindings` from the existing name match *once*, at migration time,
and recording `migratedFrom: 'legacy_kpis'`.

**R1.2** `extractPhaseKpiTargets` (`phaseResolver.js:80`) reads the declared
`kpi.type` and binding, not the name. Keep a name-based fallback only for goals
that failed migration, and log when it fires.

**R1.3** Remove the legacy declaration from `react-app/src/types.ts:74` once no
reader remains.

**Acceptance:** renaming a KPI's display name changes no computed value anywhere.

### R2 — Fix the catalogue bindings

**R2.1** `kpiDesignerCatalog.ts` Strava and HealthKit workout metrics bind to
`metrics_workouts`.

**R2.2** Add catalogue entries for the canonical activities introduced in WS1 R2 —
walk distance, hike distance, indoor/outdoor bike split, strength sessions, climb
duration — so they are selectable in the designer rather than reachable only
through the custom-field explorer.

**R2.3** Where a metric is an aggregate over a window (weekly swim distance), the
binding must declare `aggregation` and `timeframe` explicitly. Today several rely
on the resolver's defaults.

**Acceptance:** a KPI created through the designer for "weekly swim distance"
resolves to a non-null value when a swim exists in `metrics_workouts`.

### R3 — New KPI types

**R3.1** `fitness_zone_share` — percentage of total zone-time within a named set of
zones over a timeframe. Config: `zones: [2,3]`, `timeframe: 'monthly'`,
`targetDirection: 'increase'`. Resolves from `metrics_workouts.hrZones`, optionally
filtered to one activity.

**R3.2** `fitness_session_count` — count of sessions of a given canonical activity
in a timeframe. Config: `activity: 'strength'`, `timeframe: 'weekly'`.

**R3.3** `fitness_duration` — summed duration of a given activity in a timeframe.

**R3.4** All three resolve server-side under WS1 R6 and are expressible in the
designer.

**Acceptance:** "70% of training time in Z2+Z3 over 30 days" is a KPI Jim can
create in the designer and see resolved without opening a chart.

### R4 — Focus goals provision a KPI set

**R4.1** When a goal is flagged as a focus goal, offer a starting KPI set derived
from its theme rather than requiring each KPI be designed by hand. For a
health/fitness focus goal, propose: weekly distance per relevant activity, weekly
session counts, 30-day zone share, daily steps, body fat.

**R4.2** Proposals are editable and dismissible before they are written. Do not
silently attach KPIs to a goal.

**R4.3** Record `provisionedBy: 'focus_goal_wizard'` so a later change of mind can
identify what was auto-created.

**Acceptance:** flagging a fitness goal as focus produces a populated, editable KPI
set in one step.

### R5 — Phase goals carry the training plan as data

This is the piece WS5 depends on.

**R5.1** A phase goal (`goalKind: 'milestone'` under the Ironman umbrella) gains a
`trainingPlan` object:

```jsonc
{
  "weeklySessions": {            // canonical activity → sessions per week
    "swim": 3, "bike_outdoor": 2, "bike_indoor": 1, "run": 4,
    "strength": 2, "climb": 1, "walk": 7, "sauna": 3
  },
  "weeklyVolume": {              // canonical activity → km or minutes
    "run": { "km": 30 }, "swim": { "km": 4 }, "bike": { "km": 50 }
  },
  "longSessions": { "run": 1, "bike_outdoor": 1 },
  "restDaysMin": 1,
  "zoneBias": { "zones": [2, 3], "minSharePct": 70 },
  "hikeCadenceWeeks": 2
}
```

**R5.2** This replaces `phaseSessionTargets()` — the hardcoded swim/bike table at
`coachFitnessScheduler.js:230`, which knows nothing of run, strength, walk, climb,
hike or sauna.

**R5.3** `extractPhaseKpiTargets` derives `coach_daily.phase.kpiTargets` from
`weeklyVolume`, not from KPI display names.

**R5.4** The values in README §2 "Weekly session shape" are the Phase 0 seed. They
are an assumption pending Jim's confirmation — make them editable in the UI, do not
bake them into code a second time.

**Acceptance:** changing Phase 1's swim count from 3 to 2 changes what the scheduler
places, with no code change.

### R6 — KPIs on iOS

**R6.1** `BOBGoal` gains a KPI representation. Read from `goal_kpi_metrics/{uid}_{goalId}`
— the resolved output, not the raw definitions — so the phone renders values it did
not compute. This is why WS1 R6 gates this requirement.

**R6.2** Render KPI progress on the Goals surface and, for focus goals, on the
Fitness surface: name, current, target, progress, source, and a staleness indicator
when the resolved value is older than the KPI's freshness window.

**R6.3** A KPI whose value could not be resolved shows "—" and its reason, never 0.
A zero and an absence are different claims.

**R6.4** Jim also asked for KPI progress to appear on notifications. Once R6.1 is
in place, `CoachNotificationService` (`bob-ios`) can read the same document — see
WS6.

**Acceptance:** with the web app closed, iOS shows current swim distance against a
weekly target on a focus goal.

### R7 — Retire the hardcoded targets on `/fitness`

**R7.1** `MetricsPage.tsx` reads targets from the active phase's `trainingPlan` and
from focus-goal KPIs, not from literals.

**R7.2** Where no target is configured, show the metric without a target rather than
inventing one.

**Acceptance:** editing the phase's run target changes the `/fitness` label.

---

## 4. Out of scope

- The charts themselves (WS3).
- Scheduling decisions made from these targets (WS5).
- Finance KPIs — the resolver already handles them and they are untouched here.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Legacy→`kpisV2` migration silently mis-types a KPI. | Migrate in a dry-run mode first, output a diff of inferred types for review, and keep `migratedFrom` so it can be re-run. |
| Auto-provisioned KPIs create noise on goals Jim did not want measured. | R4.2 — proposals require confirmation. |
| `trainingPlan` and the coach's LLM system prompt (`coachOrchestrator.js:52-58`) drift apart. | Generate the prompt's weekly structure block from `trainingPlan`, not from a literal. |
