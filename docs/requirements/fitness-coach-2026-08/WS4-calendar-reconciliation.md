# WS4 — Calendar & Theme Reconciliation

**Repos:** `bob` (functions, react-app)
**Depends on:** WS1 (canonical taxonomy)
**Gates:** WS5
**Read first:** [README.md](README.md)

---

## 1. Why this exists

In Jim's words: *"I basically have two surfaces and it's confusing because I'm
putting the events in two places — should I just remove fitness theme blocks?"*

Answer, per D1: no. The theme block becomes the session. One event.

---

## 0. The premise was wrong — corrected 2026-08-05

**There were not two producers. There were none.** Before touching anything, the
live calendar held 706 blocks over a five-week window: 613 from Google, 45 work
shifts, 26 planner, 21 chores. **Zero fitness blocks of any kind** — no
`health_allocation`, no `coach_*`.

Three things had to line up for that:

1. **`materializePlannerThemeBlocks` stands down.** Health theme blocks are gated
   behind `fitnessBlocksAutoCreate`, which is `!hasIronmanCoach`
   (`nightlyOrchestration.js:3767`). Jim has an umbrella goal and iCal URLs, so
   the planner deliberately skipped **15 configured Health & Fitness slots** —
   Walk, S&C, Swim, Run, Bike, a complete weekly skeleton already sitting in
   `theme_allocations` — in favour of the coach.
2. **The coach could not see a single session.** `parseICalEvents` guarded on
   `event.dtstart instanceof Date`. node-ical exposes VEVENT dates as `start`/`end`
   and has no `dtstart` at all, so the guard skipped all 249 events in the live
   Runna feed. Every four-hourly poll logged `ical_polled {runnerCount: 0}` — which
   reads as a healthy run against an empty plan.
3. **The scheduler had never executed.** It selected profiles with two `!=`
   filters in one query; Firestore rejects more than one. Both branches threw, the
   rejection escaped the `Promise.all`, and the 04:30 job died before processing
   anyone. No `fitness_blocks_scheduled` event has ever been written.

Both coach faults are fixed (`7f10440e`) and verified live: 12 Runna sessions
cached, **9 coach blocks created** — 7 programme runs plus a phase swim and bike.

### What this changes for the rest of WS4

- The **migration in R2.3 has almost nothing to migrate.** There is no accumulated
  history of `coach_*` blocks; the nine that now exist were created today.
- The **double-entry has still not started**, because the planner remains stood
  down. It would begin the moment `hasIronmanCoach` goes false or the gate is
  removed — so R1 (fill the theme block in place) should land *before* that gate
  is touched, not after.
- **R4 is now the highest-value requirement, not a tidy-up.** Jim's 15 slots
  describe when he actually trains — Tue/Wed/Thu/Sat 05:30 S&C, Wed 06:30 swim,
  Fri 18:30 run, Sun 18:00 bike. The coach ignores all of it and uses the
  hardcoded 06:00/06:30/07:00 literals, so today's nine blocks sit at times he
  never chose.
- **The weekly session shape question is answered.** It was blocked on Jim; his
  own allocations are the answer — 4 S&C, 2 swim, 1 run, 3 bike, 5 walk. That is
  the seed for `trainingPlan` in WS2 R5.

---

## 2. Current state

### 2.1 Two block families both reach Google Calendar

**Theme blocks.** `materializePlannerThemeBlocks` (`nightlyOrchestration.js:1927`)
reads `theme_allocations/{uid}` and writes `calendar_blocks` with:

```js
{
  theme: 'Health & Fitness',
  category: 'Fitness',
  subTheme: rawLabel,
  entityType: 'health',
  sourceType: 'health_allocation',
  source: 'theme_allocation',
  flexibility: 'soft',
  status: 'planned',
  syncToGoogle: true,
  goalId: <fitness focus goal>,
  activityType: 'swim' | 'run' | 'cycle' | 'gym' | 'fitness'   // inferred from the label
}
```

**Coach blocks.** `_scheduleBlocksForUser` (`coachFitnessScheduler.js:240`) writes
separate blocks with `source: 'coach_runner' | 'coach_crossfit' | 'coach_triathlon'`,
`entityType: 'fitness'`, `theme: 'health'`.

**Both are pushed to Google.** The Firestore trigger at `calendarSync.js:2456`
calls `syncBlockToGoogle(blockId, 'create', …)` for any block not sourced from
gcal. Nothing distinguishes the two families.

### 2.2 The precise mechanism of the duplication

`_scheduleBlocksForUser` builds its `busyDates` set from **only** three sources
(`coachFitnessScheduler.js:274-294`):

```js
if (src === 'coach_runner')    { coveredRunnerDates.add(d); busyDates.add(d); }
if (src === 'coach_triathlon') { coveredTriathlonDates.add(d); busyDates.add(d); }
if (src === 'coach_crossfit')  { busyDates.add(d); }
```

A `theme_allocation` / `health_allocation` block is not counted as busy. So a day
that already carries a Health & Fitness theme block is treated as free, and the
coach places a second block on it. That is the double entry, exactly.

### 2.3 The theme block is already most of the way to being a session

It carries the theme, the category, a goal link, `flexibility: 'soft'`, and an
inferred `activityType`. It is a fitness slot with a label. What it lacks is the
concrete session — which discipline, how long, at what intensity.

Note that the `activityType` inference at `nightlyOrchestration.js:2085` is a sixth
independent taxonomy (`swim`/`run`/`cycle`/`gym`/`fitness`, matched on substrings
of the label). It joins the five listed in WS1 §2.4 and must be replaced by the
canonical one.

### 2.4 Fixed times, ignoring the theme plan

The coach places sessions at literals: runner blocks at 06:30
(`coachFitnessScheduler.js:312`), CrossFit at 06:00 (line 338), swim and bike at
07:00 (lines 384, 408). It does not consult the theme allocation's own time-of-day
windows, which is where Jim has already expressed when health work belongs.

---

## 3. Requirements

### R1 — The coach fills the theme block

**R1.1** When placing a session, the scheduler first looks for an existing
`health_allocation` block in the target window. If one exists, it **updates it in
place**: sets the title to the concrete session, sets `activityType` to the
canonical activity, sets duration, and records the session detail. It does not
create a second block.

**R1.2** Only when no health block exists in a usable window does it create one —
and what it creates is a `health_allocation`-shaped block, not a parallel
`coach_*` family.

**R1.3** A filled block records its provenance:

```jsonc
{
  "source": "theme_allocation",
  "sourceType": "health_allocation",
  "filledBy": "coach",
  "filledAt": <ts>,
  "activity": "swim",              // canonical (WS1 R2)
  "sessionPlan": {                 // what the coach prescribed
    "targetZones": [2, 3],
    "durationMin": 45,
    "distanceKm": 1.5,
    "programmeSource": "runna" | "wodboard" | "coach",
    "rationale": "…"
  },
  "originalTitle": "Health & Fitness"   // so it can be emptied again
}
```

**R1.4** `originalTitle` exists so a cancelled or moved session restores the block
to an unfilled slot rather than leaving a stale session title in the calendar.

**Acceptance:** a day with a Health & Fitness theme block and a scheduled swim
produces exactly one Google Calendar event, titled as the swim.

### R2 — Retire the `coach_*` block families

**R2.1** `coach_runner`, `coach_crossfit` and `coach_triathlon` cease to be created.
Runna and WodBoard sessions become `sessionPlan.programmeSource` on a filled health
block, not a distinct block source.

**R2.2** Keep reading the legacy sources during migration so existing future blocks
are not orphaned.

**R2.3** Migration: for each existing `coach_*` block, if a `health_allocation`
block overlaps it, merge into that block and delete the `coach_*` one (deleting the
Google event with it, via the existing delete path at `calendarSync.js:2431`). If
none overlaps, convert it in place to a filled health block.

**R2.4** The migration must be dry-runnable and must report what it would change
before it changes it. This touches Jim's live calendar.

**Acceptance:** no `calendar_blocks` document carries a `coach_*` source, and the
Google Calendar has no orphaned events left behind.

### R3 — Busy detection counts every fitness block

**R3.1** Whatever replaces `_scheduleBlocksForUser` must treat
`sourceType === 'health_allocation'`, `source === 'theme_allocation'` with a
fitness category, and any external gcal event, as occupying the day.

**R3.2** There is already a helper for the second half of this —
`schedulingService.js:238` recognises `work_shift_allocation`, `health_allocation`
and `theme_allocation`. Use it rather than adding a seventh predicate.

**Acceptance:** with a Health & Fitness block on Tuesday, the scheduler does not add
a second Tuesday session.

### R4 — Respect the theme plan's time windows

**R4.1** Session placement uses the theme allocation's own configured windows for
Health & Fitness rather than the hardcoded 06:00/06:30/07:00 literals.

**R4.2** Where the theme plan gives no window for a day, fall back to the
availability bounds defined in WS5, not to a literal in the scheduler.

**Acceptance:** moving the Health & Fitness allocation to evenings moves the
sessions, with no code change.

### R5 — One event, verified

**R5.1** Add a duplicate-detection guard: two blocks of fitness category
overlapping in time for the same user is a data-integrity failure. Report it
through the existing `dataIntegrityGuards.js` path rather than silently
de-duplicating.

**R5.2** `dedupePlannerBlocksForUser` (`nightlyOrchestration.js:2123`) already
exists — extend its remit to cover fitness rather than writing a parallel
mechanism.

**Acceptance:** the integrity check reports zero fitness overlaps after migration.

---

## 4. Open question for Jim

The Health & Fitness theme allocation currently reserves generic slots. Once the
coach fills them, the count of slots per week effectively *becomes* the training
volume cap. If the theme plan reserves four slots and the phase asks for thirteen
sessions, something must give.

Two options, needing a decision before implementation:

- **(a)** The theme allocation is authoritative on *when and how much*, and the
  phase plan fits inside it. Predictable, but the coach cannot honour the phase.
- **(b)** The phase plan is authoritative on *how much*, and the coach extends the
  Health & Fitness allocation as needed within the availability bounds. The
  calendar then reflects the training load honestly, but the theme budget stops
  being a budget.

Recommendation: **(b)**, with a weekly hours ceiling so it cannot run away.

---

## 5. Out of scope

- Deciding *which* session goes where (WS5).
- Non-fitness theme blocks — work shifts and other themes are untouched.
- The Google Calendar sync mechanism itself; only what is fed into it changes.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Migration deletes real events from Jim's live Google Calendar. | R2.4 — dry run and report first. Back up `calendar_blocks` for the affected window before the destructive pass. |
| Filling a theme block in place breaks the capacity maths that reads `theme_allocation`. | The block keeps `source`, `sourceType`, `theme` and `category`; only the title and session fields change. Verify against `capacityService.js` and `schedulingService.js:238`. |
| An external Google edit to a filled block is overwritten by the next nightly run. | Honour the existing external-source guard (`calendarSync.js:472`) and treat a user-edited block as pinned until the session completes. |
