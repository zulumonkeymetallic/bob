# Schedulers — who places what, and when

BOB has **five independent placement engines** writing to the same `calendar_blocks`
collection. They coordinate by convention, not by structure: the rules that keep them from
fighting each other live in code comments, not in a shared contract. This file is the map.

Written 2026-08-07 (ST-64186) after a `planSchedule()` call sat broken in the calendar-pull
path for an unknown length of time because nobody could tell which scheduler owned it.

**If you change placement behaviour, update this file in the same commit.**

---

## The five engines

| Engine | Owns | Does **not** own |
|---|---|---|
| `services/schedulingService.js` (1283 lines) | Stories and tasks — the main planner | chores, routines, habits, fitness |
| `sprintForwardPlanner.js` (517 lines) | Sprint items, forward to sprint end | anything outside the active sprint |
| `scheduler/engine.js` → `planSchedule()` (1207 lines) | Chores, routines, habits **only** | stories and tasks — see below |
| `nightlyOrchestration.js` → `replanExistingBlocksForUser()` | Moving blocks that already exist | creating new blocks |
| `coach/coachFitnessScheduler.js` (718 lines) | Fitness and training blocks | everything else |

### The `planSchedule()` trap

`planSchedule()` computes occurrences for stories and tasks, and **all three callers throw that
half of the result away** — `planBlocksV2` (index.js:2189), `planBlocksV2Http` (index.js:2478)
and `generateCalendarPlanForUser` (index.js:10989) each run the identical line:

```js
const plannedFiltered = plan.planned.filter(
  p => !['story', 'task'].includes(String(p.sourceType || '').toLowerCase())
);
```

So it looks like the story/task planner and is not one. Stories and tasks belong to
`schedulingService.js`. Reading `planSchedule()` in isolation and concluding the planner is
broken is a mistake that has now been made twice.

`planSchedule()` is also **pure** — it returns `{ planned, unscheduled, conflicts, existingIds,
blocks }` and writes nothing. Every caller persists the result itself. A call whose return value
is discarded does nothing at all, which is exactly the bug that prompted this file.

---

## When each runs

| Time (UTC) | Function | Engine |
|---|---|---|
| hourly | `scheduledCalendarSync` | `replanExistingBlocksForUser` after each Google pull |
| every 4h | `pollFitnessProgrammes` | coach fitness |
| 02:00 | `nightlyTaskMaintenance` | `planSchedule` — chores/routines/habits |
| 03:00 (04:00 BST) | `unifiedNightlyOrchestrator` | `runCalendarPlanner`, then `sprintForwardPlanner` |
| 03:30 (04:30 BST) | `scheduleCoachFitnessBlocks` | coach fitness |
| on demand | `planBlocksV2`, `planBlocksV2Http` | `planSchedule` |
| on demand | `runNightlyMaintenanceNow` | `planSchedule` |

`nightlyTaskMaintenance` (02:00 UTC) and `unifiedNightlyOrchestrator` (03:00 UTC) are separate
scheduled functions planning overlapping windows an hour apart. That is not a mistake, but it
is the least obvious thing in this file.

### Nightly chain order

`unifiedNightlyOrchestrator` → `runNightlyChainCore()` (`nightlyOrchestration.js`). Placement
steps, in order:

1. `rolloverMissedChoresRoutines`
2. `clearBobScheduledEvents` — deletes before replanning
3. **`runCalendarPlanner`** — stories/tasks via `schedulingService`
4. `applyProjectedDueDates`
5. **`sprintForwardPlanner`** — fallback pass for sprint items
6. `pushPendingCalendarBlocks` — pushes to Google
7. `cleanupOrphanedCalendarEvents`

Step 2 deleting and step 5 re-creating is deliberate and order-dependent.

---

## The treaties

These are real constraints with no enforcement. Breaking one produces double-booking or
silently dropped work, not an error.

| Treaty | Where | Why |
|---|---|---|
| `sprintForwardPlanner` starts from **tomorrow**, never today | `sprintForwardPlanner.js` | Today belongs to `runCalendarPlannerJob`. Both planning today double-books it. |
| Both planners import `PLANNING_HORIZON_DAYS` from `lib/planningHorizon.js` | `nightlyOrchestration.js:3640` | They must agree on the horizon or one plans into days the other clears. |
| `clearBobScheduledEvents` runs before `sprintForwardPlanner` in the same chain | `nightlyOrchestration.js:2035` | The delete step must not remove what the later planner is about to write. |
| `sprintForwardPlanner` is a **fallback**, not the primary | `sprintForwardPlanner.js:2` | It exists to catch what the main planner missed. Treating it as primary duplicates blocks. |
| Manually placed blocks are off-limits | `utils/manualPlacement.js` — `isManuallyPlacedBlock`, `isOrchestrationLocked` | Any engine that moves a user-placed block loses trust in the whole system. |

---

## Modes (stories and tasks only)

Applies to `schedulingService.js`. The other four engines do not read these.

**`plannerMode`** — from `profile.plannerMode`, overridable per request. Default `smart`.

- `smart` — only the user's Google Calendar plus work and fitness blocks are hard-busy.
  Everything else is fair game.
- `strict` — all planned blocks and the user calendar are hard constraints.

**`constraintMode`** — resolved per entity by `resolveConstraintMode()`:

- `override` — search all real free time, ignoring theme allocations. Automatic for manual Top
  1/2/3 (`userPriorityRank` 1-5, or `userPriorityFlag`) and for `aiTop3ForDay === true`.
  Without this a 10h Top 3 story is gated to its theme's weekly hours and silently dropped on
  days that theme isn't allocated.
- `free_slot` — any free slot, ignoring theme allocations.
- `theme_block` — **default.** Confined to the entity theme's allocated slots.

---

## Where blocks come from

`planSchedule()` places occurrences into day-slots derived from:

1. The `blocks` collection — recurring templates (sleep, work), filtered `enabled == true`.
2. Synthetic blocks built from `themeAllocations`, when the caller passes them.

With neither, there is nowhere to place anything and every occurrence comes back
`reason: 'no-eligible-block'`. As of 2026-08-07 the owner UID has **zero** `blocks` documents
and 55 theme allocations, so `planSchedule` depends entirely on the caller passing
`themeAllocations` — which `planBlocksV2` does and `generateCalendarPlanForUser` does not.

Chores without an eligible block are intentionally *not* written as `scheduled_instances`.
That is a deliberate earlier fix, not a bug.

---

## Read cost

`planSchedule()` reads per call, per user (owner UID, 2026-08-07):

| Collection | Docs | Bounded? |
|---|---|---|
| `stories` | 982 | No — see below |
| `tasks` | 1171 | No — see below |
| `calendar_blocks` | 170 | Yes, both ends on `start` |
| `goals` | 130 | Only when `includeChores` |
| `chores` / `routines` / `habits` | 4 | Only when `includeChores` |

`stories` and `tasks` cannot be filtered server-side without a schema change:

- **Status** is mixed-type across ints and strings (`0`, `'0'`, `1`, `'backlog'`,
  `'in-progress'`, `4`). A range filter sorts numbers before strings and would drop the
  string-valued ones. `not-in` excludes documents missing the field, which currently schedule
  fine.
- **The window** can't be indexed — the effective date is whichever of six fields is set first
  (`scheduledStart`, `startDate`, `plannedStart`, `dueDate`, `dueDateMs`, `targetDate`).

Both want one normalised, indexed timestamp written on save.
