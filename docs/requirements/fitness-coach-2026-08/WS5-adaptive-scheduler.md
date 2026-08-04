# WS5 — Adaptive Training Scheduler

**Repos:** `bob` (functions)
**Depends on:** WS1 (readiness, taxonomy, zone data), WS2 R5 (`trainingPlan` on phase goals), WS4 (one block family)
**Gates:** WS6 (partially)
**Read first:** [README.md](README.md)

---

## 1. Why this exists

This is the piece Jim named as the focus: *"I would love the AI coach to be looking
at my heart rate data, my HRV, and to be dynamically managing my calendar based on
the data and the distance metrics we've got. So for example, if I haven't run for
X days, it should be suggesting that I get my run programme in."*

Per D3 and D4: the coach plans the week from scratch, writes directly to the
calendar, and moves or cancels its own sessions without asking. Per D5, the only
thing it may not move is a booked external commitment.

---

## 2. Current state

### 2.1 What the coach does today

`coachFitnessScheduler.js` runs at 04:30 and:

1. reads cached Runna and WodBoard iCal events (`pollFitnessProgrammes`, every 4h);
2. creates a block at 06:30 for each Runna session, 06:00 for each WodBoard
   session, on days with no existing `coach_*` block;
3. resolves the active phase, looks up `phaseSessionTargets(phaseIndex)` — a
   hardcoded `{swim, bike}` count table (line 230) — and fills the shortfall with
   90-minute bike blocks at 07:00 on weekends and 60-minute swims at 07:00 on
   weekdays.

`coachOrchestrator.js` runs at 04:00 and, if readiness is low, **renames** the next
fitness block: `[AI ADAPTED] Rest / Active Recovery` below 0.6, or prefixes
`[AI ADAPTED]` and notes "load -30%" below 0.8 (lines 379-400).

### 2.2 Why it does not do what Jim asked

| Gap | Detail |
|---|---|
| It knows two disciplines. | `phaseSessionTargets` covers swim and bike only. No run, strength, walk, climb, hike, sauna. |
| It has no concept of "days since". | Nothing computes time since the last session of an activity, so it cannot act on "I haven't run in a fortnight". |
| It never moves anything. | It creates on free days and renames on low readiness. It cannot reschedule or cancel. |
| It cannot see the weather. | `functions/services/newsWeather.js` exists (`fetchWeather` via open-meteo) and is used only by the daily digest. |
| Readiness is a frozen constant. | See WS1 §2.3. Its one adaptive behaviour has been running on a value that has not moved. |
| Fixed times. | 06:00/06:30/07:00 literals, ignoring the theme plan. |
| It fills a week, not a plan. | Session counts only; no volume, no zone bias, no long-session structure. |

### 2.3 The phase model is broken in three ways

| Phase | Dates |
|---|---|
| [Phase 0 — Base Building](https://bob.jc1.tech/goals/um4tE1Hu1WOyMelW4JkK) | 2026-06-30 → 2026-09-30 |
| [Phase 1 — Build](https://bob.jc1.tech/goals/ccnL8BDMB1wIuR1KqwVU) | 2026-10-01 → 2026-12-31 |
| [Phase 2 — Peak](https://bob.jc1.tech/goals/MHE8cvmrgpbIxwlKqu4A) | 2026-10-03 → 2027-02-15 |
| [Phase 3 — Taper & Race](https://bob.jc1.tech/goals/dDbOcsDKlqDQ7QGoy2Ad) | 2027-01-07 → 2027-05-15 |

1. **Phases 1 and 2 overlap by three months; 2 and 3 by five weeks.**
   `resolveActivePhase` (`phaseResolver.js:72`) returns the *first* phase in
   start-order that brackets today, so from 3 October it will sit in Build and
   never notice Peak has begun. Silently.
2. **The plan ends 15 May 2027; the Ironman is September 2027.** For the final four
   months nothing brackets "now", `resolveActivePhase` returns null, and
   `coachOrchestrator` falls back to phase 0 — base building, immediately before
   the race.
3. **There is no live Hyrox goal.** The only one is
   [GR-13177 HYROX Bilbao](https://bob.jc1.tech/goals/zrzCayLtHEobQlfO3zer), status
   4, dated 2032-09-10. Jim wants Hyrox in Q1 2027, which lands on Phase 2 Peak.

---

## 3. Requirements

### R1 — Fix the phase model first

**R1.1** Phase dates must be contiguous and non-overlapping, and must reach the
race date. Add a validation that runs nightly and reports a gap or an overlap
rather than letting `resolveActivePhase` silently pick the earliest.

**R1.2** `resolveActivePhase` returns an explicit error state when phases overlap,
rather than picking one. Ambiguity in a training plan is a data fault, not a case
to resolve by array order.

**R1.3** When no phase brackets today, the coach must **not** fall back to phase 0.
Report "no active phase" and hold the previous week's plan.

**R1.4** Create the Hyrox goal as a **milestone under the Ironman umbrella** (D8),
with its own date, its own `trainingPlan` for the weeks preceding it, and a short
taper. One timeline, one resolver. Jim's Q1 2027 date needs confirming before the
goal is written.

**R1.5** Extend the phase sequence to September 2027 so the Ironman build is
covered end to end.

**Acceptance:** on any date between today and the race, exactly one phase is
active, and the validation reports clean.

### R2 — Weekly planning, from scratch

**R2.1** A weekly planner runs on a fixed day (Sunday) and produces a plan for the
following seven days from:

- the active phase's `trainingPlan` (WS2 R5) — session counts, volumes, long
  sessions, rest minimum, zone bias, hike cadence;
- **actual volume achieved** in the current and preceding weeks, from
  `metrics_workouts`, so a missed week informs the next;
- **days since last session** per canonical activity — the "haven't run in X days"
  signal;
- the Runna and WodBoard feeds, which are prescriptions to be *placed*, not
  separately scheduled;
- readiness (WS1 R5) and its recent trend;
- weather for outdoor activities (§R4);
- the existing calendar: work blocks, booked commitments, other themes.

**R2.2** Output is a set of filled health blocks (WS4 R1), each carrying its
`sessionPlan` and a rationale that names why it is there — which target it serves,
which gap it closes.

**R2.3** The planner must be able to produce a plan that is *smaller* than the
phase target. A week with three sessions when the phase asks for thirteen is the
correct output when readiness is poor or the calendar is full. It must never pad to
hit a count.

**Acceptance:** a week is planned without any recurring template, and every session
can state why it exists.

### R3 — Constraints

**R3.1 Immovable.** Booked external commitments only. Today: the Tuesday swimming
lesson. Model as a flag on the block (`immovable: true`, `reason: 'booked'`), set
by Jim or by origin (an external Google event he did not create in BOB), not
inferred from the title.

**R3.2 Freeze horizon.** Sessions inside the next 24 hours are not moved, added or
cancelled by an automated run (D6, an assumption pending Jim's confirmation).
Beyond 24 hours the planner may re-plan freely. Intra-day catch-up (WS6) is the
deliberate exception and must be able to add inside the horizon.

**R3.3 Work calendar.** Never place a session over an existing work block or
external calendar event.

**R3.4 Availability bounds.** A configurable earliest start and latest finish per
weekday and weekend. Not yet supplied by Jim — default to the existing waking
window of 05:00–21:00 used elsewhere in the scheduler and make it editable.

**R3.5 Never touch non-fitness events.** The coach's authority (D3) covers fitness
blocks it owns. Anything else is out of bounds.

**R3.6 Rest.** Honour `restDaysMin`. A rest day is a positive output, not the
absence of a session, and should be visible as such.

### R4 — Weather

**R4.1** Use `fetchWeather` (`functions/services/newsWeather.js`) with Belfast
coordinates rather than its London default. Store the location on the profile.

**R4.2** Weather affects three decisions only:

- outdoor bike versus indoor bike (turbo) for the same prescribed session;
- whether a hike is placed on a given weekend (Jim: "one to two weekends a month
  depending on weather");
- whether a run is moved within the day to avoid the worst of it.

**R4.3** Weather may not change the *training* — an easy 45 minutes stays an easy 45
minutes whether it is on the road or the turbo. Only the modality and the timing
move.

**R4.4** Forecast beyond ~5 days is unreliable; do not let a long-range forecast
suppress a session. Place it, and revise inside the window.

**Acceptance:** a wet Saturday converts an outdoor ride to a turbo session of the
same duration and zone target, with the reason recorded.

### R5 — Adaptation from readiness

**R5.1** Once readiness is real (WS1 R5), it modulates *intensity and volume*, not
existence:

| Readiness | Action |
|---|---|
| unknown | no adjustment; plan as prescribed and say the signal is missing |
| green | as prescribed |
| amber | reduce duration and cap zone; keep the session |
| red | convert to active recovery or rest, and record it as a decision |

**R5.2** Replace the `[AI ADAPTED]` title-prefix mechanism
(`coachOrchestrator.js:391`) with structured fields on `sessionPlan`. Encoding
state in a display string is why a numeric `theme` once crashed the whole
orchestrator run (see the comment at `coachOrchestrator.js:362`).

**R5.3** Consecutive red days must escalate — three in a row is a signal about the
plan, not about the day, and should surface as an explicit recommendation to reduce
the phase load.

### R6 — Session catch-up

**R6.1** Track days since the last session of each canonical activity. When it
exceeds a per-activity threshold derived from the phase's weekly count (e.g. a
target of 4 runs a week implies a threshold of ~3 days), raise it as a gap the
planner must close.

**R6.2** After a long absence — Jim's last logged session was 27 June — do not drop
the full phase load back onto the calendar. Ramp: a return-to-training progression
capped at a sensible weekly increase, with the ramp itself visible.

**R6.3** Distinguish "no session" from "no data". Given WS1 §2.1, an empty history
may mean the pipe was broken. Where sync freshness is poor, the planner must say
"cannot tell" rather than prescribing a comeback from nothing.

**Acceptance:** returning after five weeks produces a graduated first week, not
thirteen sessions.

### R7 — Authority and reversibility

**R7.1** The planner writes, moves and cancels its own filled health blocks
automatically (D3). Every change is recorded in `activity_stream` with the before
and after, and the rationale.

**R7.2** Jim is notified after the fact, in one digest, not per change.

**R7.3** Every automated change is reversible from the UI for at least seven days —
"put it back". This is the counterweight to full autonomy.

**R7.4** A block Jim has edited manually is pinned and no longer re-planned, until
he clears the pin or the session date passes.

**Acceptance:** a week of automated changes can be reviewed and individually undone.

### R8 — Retire `coachFitnessScheduler`

**R8.1** `phaseSessionTargets` (line 230) is deleted; session shape comes from
`trainingPlan`.

**R8.2** The iCal poll (`pollFitnessProgrammes`) is kept — the feeds are live — but
its output becomes an input to the planner, not a block-creation path of its own.

**R8.3** The 06:00/06:30/07:00 literals are deleted; placement comes from the theme
plan windows (WS4 R4) and the availability bounds (R3.4).

---

## 4. Inputs still needed from Jim

| Input | Why | Default if unanswered |
|---|---|---|
| Weekly session counts per activity for Phase 0 | Drives everything the planner places | README §2 table |
| Availability bounds — earliest/latest, weekday and weekend | Placement bounds | 05:00–21:00 |
| Confirmation of the 24h freeze horizon | D6 is an assumption | Freeze on |
| Hyrox Q1 2027 target date | R1.4 cannot create the goal without it | Blocked |
| Ironman 2027 race date (which weekend) | R1.5 phase extension | Blocked |

---

## 5. Out of scope

- Intra-day step catch-up and notifications (WS6).
- The charts that show whether the plan is working (WS3).
- Any change to non-fitness scheduling — `sprintForwardPlanner`, work shifts and
  the story/task planner are untouched.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Full autonomy plus fully dynamic planning means the calendar looks different every morning. | R3.2 freeze horizon, R7.2 single digest, R7.4 manual pins. |
| The planner prescribes a phase load Jim cannot absorb after five weeks off. | R6.2 ramp, and R5.3 escalation on repeated red days. |
| Deleting `coach_*` creation before WS4's migration runs leaves orphaned Google events. | Sequence WS4 R2.3 before WS5 R8. |
| `resolveActivePhase` erroring on overlap breaks the morning briefing. | The briefing must degrade to "no active phase" rather than failing; per-user try/catch already exists but has previously hidden faults for a week — log at ERROR and alert. |
