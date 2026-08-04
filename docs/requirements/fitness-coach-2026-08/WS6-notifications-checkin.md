# WS6 — Notifications & Daily Check-in Capture

**Repos:** `bob-ios`, `bob` (react-app, functions)
**Depends on:** WS1 (live steps and readiness), WS2 R6 (KPI values on iOS), WS5 (block placement) for the calendar half
**Read first:** [README.md](README.md)

---

## 1. Why this exists

Jim's closing ask: *"if I'm not meeting my daily targets like steps, put that into
my calendar in the evening and remind me with a notification that I need to get my
steps in. Or if I haven't tracked my macros through HealthKit, the iOS app should
prompt the user to capture that as part of the daily check-in — on mobile, or web
if the user hasn't completed the daily check-in on mobile."*

Two behaviours: an **evening catch-up** that reserves time and tells him, and a
**capture prompt** for data HealthKit cannot supply on its own.

---

## 2. Current state

### 2.1 iOS already has a discrepancy engine

`bob-ios/BOB/Sources/Sync/CoachNotificationService.swift`:

- `CoachDiscrepancyEvaluator.evaluate(coachDaily)` returns at most one
  discrepancy, in priority order: low readiness → protein behind → weekly
  run/bike/swim volume behind pace → body composition off target.
- One notification per day, identifier `coach-discrepancy`, fired at **18:30**
  local (lines 89-91) via `UNCalendarNotificationTrigger`.
- If the fire window has already passed, it declines to fire rather than
  ambushing with a late alert.
- Copy is deterministic; Apple Foundation Models only rephrases it, falling back
  to the deterministic text.

This is a good foundation and should be extended, not replaced.

### 2.2 What it cannot do

- **Steps are not a discrepancy type.** Despite being Jim's headline daily target
  (12,000, `profiles.targetStepsPerDay`), a step deficit raises nothing.
- **It cannot write to the calendar.** It notifies; it does not reserve time.
- **It reads a stale readiness.** `CoachDaily.readinessScore` comes from
  `coach_daily`, which is pinned at 0.59 (WS1 §2.3) — so "Readiness is low today"
  is the top-priority discrepancy every single day, crowding out everything below
  it in the priority order.
- **Only one alert per day, ever.** A single identifier means a midday and an
  evening prompt cannot coexist without redesign.

### 2.3 Check-in surfaces

- iOS: `BOB/Sources/Views/Planning/DailyCheckInView.swift` — mood, stories, habits,
  and a health badge row showing steps, protein and readiness (lines 154-167). It
  **displays** health values; it does not capture them.
- Web: `react-app/src/components/checkins/CheckInDaily.tsx` at `/checkin/daily`,
  plus `CheckInBanner`.

Neither captures macros. Nothing tracks whether the check-in was completed on
mobile, so there is no signal on which to base a web fallback.

### 2.4 Macros come from HealthKit only

`HealthKitSyncService.pushToFirestore` reads `dietaryProtein`,
`dietaryCarbohydrates`, `dietaryFatTotal` and `dietaryEnergyConsumed` and writes
`proteinTodayG`, `carbsTodayG`, `fatTodayG`, `caloriesTodayKcal` to
`health_metrics/{uid}_{date}`. If Jim has not logged food in a HealthKit-writing
app, these are absent — and absent is currently indistinguishable from zero on
several surfaces.

---

## 3. Requirements

### R1 — Evening checkpoint

**R1.1** A checkpoint runs each day at a configurable time (default 18:00,
Europe/London) and evaluates:

- steps today versus `targetStepsPerDay` (12,000);
- whether today's prescribed session was completed;
- whether macros have been logged;
- whether the daily check-in has been completed.

**R1.2** On a step deficit, it does two things (D11):

- **places a walk block** in the calendar at the next free slot before the
  availability cut-off, sized to close the gap — use a stride-based estimate from
  Jim's own history rather than a constant, and record the assumption;
- **sends one notification** stating the actual deficit in steps and the block it
  has just reserved.

**R1.3** The walk block is a filled health block per WS4 R1, `activity: 'walk'`,
`filledBy: 'catch_up'`, so it appears exactly once and in the same family as every
other session.

**R1.4** The freeze horizon (WS5 R3.2) explicitly does **not** apply to catch-up
placement — this is the deliberate exception, since the whole point is to act
inside today.

**R1.5** If there is no free slot before the cut-off, notify without placing, and
say so. Do not place a block Jim cannot act on.

**Acceptance:** at 18:00 on a day at 6,000 steps, a walk block appears in the
calendar and one notification names the deficit.

### R2 — Steps as a first-class discrepancy

**R2.1** Add a steps discrepancy to `CoachDiscrepancyEvaluator`, reading a live
step count, not `profiles.healthkitStepsToday` at a moment when it may hold
yesterday's tail (WS1 R5.3).

**R2.2** Re-order priority now that readiness will be real: an unknown readiness
must not occupy the top slot. Suggested order — red readiness → step deficit with
time still available → session not done → macros not logged → volume behind pace →
body composition.

**R2.3** Support more than one notification identifier so a midday nudge and an
evening checkpoint can coexist. Jim did not ask for a midday nudge; build the
capability, default it off.

**Acceptance:** with readiness green and steps behind, the alert is about steps.

### R3 — Macro capture in the daily check-in

**R3.1** `DailyCheckInView` gains a capture section for protein, carbs, fat and
calories, shown **only when HealthKit has supplied nothing for today**. Where
HealthKit has the value, display it and do not ask.

**R3.2** Captured values write to the same `health_metrics/{uid}_{date}` document
with `source: 'user_input'`, so the coach and the KPI resolver read one shape
regardless of origin. The KPI resolver already ranks `user_input` as always
acceptable (`kpiResolver.ts:345`).

**R3.3** Never overwrite a HealthKit value with a manual one silently. If both
exist, HealthKit wins and the manual entry is recorded alongside.

**R3.4** Absent stays absent. A macro with no value shows "—", never 0. On a day
with no food logged, a zero protein reading would trigger the protein discrepancy
and tell Jim he is behind when the truth is that nothing was recorded.

**Acceptance:** on a day with no HealthKit food data, the check-in asks for macros
and the captured figures reach `health_metrics`.

### R4 — Check-in completion state and web fallback

**R4.1** Record daily check-in completion explicitly — a `daily_checkins/{uid}_{date}`
document (or a field on `health_metrics`) with `completedAt` and `completedOn:
'ios' | 'web'`.

**R4.2** Both `DailyCheckInView` (iOS) and `CheckInDaily.tsx` (web) write it, and
both read it, so opening one after completing the other shows the completed state
rather than an empty form.

**R4.3** The web fallback per Jim's ask: if the check-in has not been completed on
mobile by a configurable cut-off, the web surface promotes it — `CheckInBanner`
becomes prominent and the macro capture appears there too.

**R4.4** Do not double-prompt. Once completed anywhere, both surfaces stand down for
the day.

**Acceptance:** completing the check-in on iOS clears the web prompt, and vice
versa.

### R5 — KPI progress in notifications

**R5.1** Jim asked for KPI progress to appear on notifications and on iOS. Once
WS2 R6 lands, `CoachDiscrepancyEvaluator` reads resolved KPI values from
`goal_kpi_metrics` rather than the fixed set of checks currently hardcoded in
`CoachDaily.kpiChecks`.

**R5.2** This makes the alert set follow the goals rather than the code — a new KPI
that falls behind can raise a discrepancy without a release.

**R5.3** Cap the noise: one alert per day remains the rule, with the highest-severity
discrepancy winning.

### R6 — Honest copy

**R6.1** Every notification states the number and its source. "4,100 steps short of
12,000, from HealthKit at 17:58" beats "you're behind on steps".

**R6.2** Where a signal is missing, say so rather than inferring. "No HRV recorded
last night" is useful; a readiness score computed from an absence is not.

**R6.3** Keep the existing pattern: rules decide *whether* and *about what*;
Foundation Models only rephrases, with the deterministic copy as fallback.

---

## 4. Out of scope

- The evening walk's *placement* logic beyond "next free slot" — the general
  scheduler is WS5.
- Weekly check-in (`CheckInWeekly.tsx`).
- Telegram delivery. `coachOrchestrator` has a Telegram path; this workstream is
  push notifications and in-app prompts only.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| The evening block becomes noise Jim ignores, and the calendar fills with dead walk blocks. | Cancel an unactioned catch-up block at end of day rather than leaving it; track the action rate and report it. |
| A step target met by a run still triggers a walk. | R1.1 reads total steps, which already include running steps — no separate handling needed, but test it explicitly. |
| Prompting for macros every day becomes an irritant. | R3.1 — prompt only when HealthKit supplied nothing, and let it be dismissed for the day. |
| 18:30 is too late to close a 6,000-step gap. | Default the checkpoint to 18:00 and make it configurable; consider the midday capability from R2.3 if the action rate is poor. |
