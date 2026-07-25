# Nightly Orchestration — How It Actually Works

Last verified against production: 2026-07-25, commit `20808574` + same-day follow-ups.

Entry points: `unifiedNightlyOrchestrator` (scheduled cron, Europe/London), `runNightlyChainNow` /
`runNightlyChainNowHttp` (manual trigger, same logic — `functions/nightlyOrchestration.js`,
`runNightlyChainCore`). All three run the identical 17-step chain, in this fixed order, for
every user in the `profiles` collection. A step throwing does not stop the chain — each step's
result (or error) is recorded and the next step runs regardless.

## The chain, in order

1. **generateMissingAcceptanceCriteria** — LLM-fills `acceptanceCriteria` on active-sprint
   stories that have a description but no criteria yet. Capped at 40 candidates/user, 90s
   budget, so a slow LLM provider can never eat into the scheduling steps later in the chain.

2. **assignMissingTimeOfDay** — LLM-classifies tasks/stories with no `timeOfDay` into
   morning/afternoon/evening based on title/description/theme. Same 40-candidate/60s-budget
   pattern. Chores/habits/routines excluded (their recurrence config already governs
   scheduling). Added 2026-07-25 — previously `timeOfDay` was only ever set by whoever created
   the item, so most items had none and were invisible to anything that keys off it (mobile
   Morning/Afternoon/Evening buckets, due-today widgets).

3. **runAutoPointing** — assigns story points to unpointed active-sprint stories.

4. **runAutoConversions** — converts oversized tasks into stories where appropriate.

5. **runPriorityScoring** — the AI criticality scoring pass (0–100 per item) and Top-3
   designation. Everything downstream that reads `aiCriticalityScore` depends on this having
   just run.

6. **alignStoriesToGoalSprints** — moves stories into the sprint matching their linked goal's
   active window, or the user-pinned/priority-active sprint. `dryRun: false` in production —
   this genuinely moves stories, not just reports what it would do.

7. **rolloverMissedChoresRoutines** — rolls forward chores/habits/routines that were due but
   not completed.

8. **clearBobScheduledEvents** — added 2026-07-25, per Jim: "I am expecting all bob created
   events to be deleted automatically each time nightly orchestration runs to ensure my gcal
   does not contain stale bob events." Deletes every `calendar_blocks` doc with a `storyId` or
   `taskId` set (proof BOB placed it — never touches a doc without one, since that's the only
   reliable signal that Jim didn't type it into Google Calendar himself) and its linked Google
   Calendar event, for every user. Wipe-and-rebuild rather than incremental patching, so
   staleness (deleted stories, re-pointed scores, half-applied manual edits) can never
   accumulate silently between runs. Batched (8 concurrent deletes) with a 90s per-step time
   budget checked *between batches*, not just between users — an account with a large backlog
   can no longer single-handedly blow the whole function's 600s ceiling and kill the rebuild
   steps that come after it (this happened once, 2026-07-25, before the batching fix: a
   months-accumulated backlog of ~460 stale blocks took the wipe past the function timeout with
   nothing rebuilt after it — see "Known limitations" below). `theme_allocation` blocks (Work/
   Health placeholders) are correctly *not* touched here — they never carry a storyId/taskId.

9. **runCalendarPlanner** (`runCalendarPlannerJob`) — the primary scheduler. Materialises
   Work (Main Gig) and Health & Fitness blocks from the user's `theme_allocations` weekly plan
   (`materializePlannerThemeBlocks`), then places Top-3/pinned stories and due-today items into
   real calendar slots.
   - **Work is canonical** (added 2026-07-24, per Jim: "NOTHING should be placed on my work
     block as its canonical"): when a Work block's slot overlaps an existing BOB-linked item,
     that item is evicted (its `calendar_blocks` doc and Google Calendar event deleted) rather
     than left drawn-over. The evicted item becomes unscheduled and gets a real slot from
     `sprintForwardPlanner` later in the same run, which already treats this same Work block as
     busy time — so it can't land back on top of it.
   - Placement is theme-window-aware where possible (`scheduledByPolicy: 'theme_window'`), with
     a documented smart-mode fallback to any free slot in the day when the item's theme has no
     covering window, or that window is already full (`services/schedulingService.js`,
     "Smart-mode free-slot fallback for top items"). See "Known limitations" for a real gap in
     how items reach this fallback.

10. **applyProjectedDueDates** — for active-sprint items with no due date (or a
    system-projected one), assigns a projected due date, 5 items/day starting the day after
    tomorrow, ordered by `aiCriticalityScore` descending.

11. **sprintForwardPlanner** — the Tier-B fallback scheduler. Only fills genuine gaps
    `runCalendarPlanner` didn't use. Scope is deliberately narrow: **tasks only** (no
    stories — pinned/Top-3 stories are `runCalendarPlanner`'s job, not this one's; adding them
    here previously starved the displacement-aware primary scheduler), due on the specific day
    being planned, `pointsRemaining >= 1` (nothing under 1pt/1hr may claim calendar time), and
    `aiCriticalityScore >= 75` (`MIN_SCORE_TO_SCHEDULE`, added 2026-07-24 per Jim: low-value
    tasks around score ~51 were consuming calendar slots). This floor governs whether an item
    gets a real `calendar_blocks` entry — it does **not** govern the separate "due today"
    widgets, which list anything with a due date regardless of score; those are two different
    questions ("what got scheduled" vs "what's due") that can legitimately disagree.

12. **nightlyTaskLinking** — links orphaned tasks to their parent story where one can be
    inferred.

13. **nightlyStoryGoalLinking** — same, for stories to goals.

14. **semanticEmbeddingBackfill** — generates embeddings for items missing them (search/
    similarity features).

15. **nightlySprintCapacityUpdate** — recalculates sprint capacity/velocity metrics.

16. **pushPendingCalendarBlocks** — pushes `calendar_blocks` docs with `googleEventId: null`
    (and `syncToGoogle: true`) to the real Google Calendar, up to 50/user/run. Skips items with
    `status` outside `{planned, applied, confirmed, synced}`, and items whose `start` is more
    than 14 days in the past (`GCAL_PAST_DAYS`). A failed push (e.g. Google API rate limit) just
    leaves `googleEventId: null`, so the item stays eligible and retries on the next run — nothing
    is lost, just delayed.

17. **cleanupOrphanedCalendarEvents** — runs last, after the push step, so newly-created events
    have had a chance to land their `googleEventId` before anything is judged orphaned. Catches
    blocks whose linked story/task was deleted after the block was created — a secondary safety
    net alongside step 8's wipe, not a replacement for it (step 8 only fires at the *start* of a
    run; this one catches anything that went stale *during* the run, or that step 8's
    storyId/taskId criterion didn't cover for some other reason).

## Known limitations (confirmed 2026-07-25, not yet fixed)

- **Malformed `theme` values defeat theme-window placement.** `schedulingService.js` copies
  `theme` straight from the story/task's own field onto the `calendar_blocks` doc
  (`theme: entity.theme || ...`). On a sample of 101 freshly-scheduled items, 60 (59%) had a
  `theme` value that can never match anything in `theme_allocations` — raw numeric codes (`3`,
  `7`, `1`, `8`, likely leftover from an old enum-based theme system) or a near-miss string
  (`'Personal (Health)'` vs the plan's actual `'Health & Fitness'`). These items are
  *guaranteed* to hit the free-slot fallback every time, regardless of whether their theme
  genuinely has free capacity that day — the fallback can't tell "no matching theme" from
  "theme's window is full," because it never has a theme name to look up in the first place.
  A further 29 items (29%) had a valid, matching theme name but still fell back because that
  theme's window was already full for the day — this part is the fallback working as designed.
  Only 12 (12%) landed inside an actual matching theme window on this sample. Fixing the
  malformed `theme` values at the source (wherever `3`/`7`/`1`/`8` get written onto stories/
  tasks) would likely move most of that 59% into genuinely-attempted theme-window placement.

- **Google Calendar API rate limits on a large one-time wipe.** Step 8's *first-ever* run
  cleared ~460 blocks accumulated over months, generating a burst of delete calls large enough
  to trip Google's short-term rate limit, which was still in effect moments later when step 16
  tried to push newly-created events — 40 of that run's pushes failed with a 403
  `rateLimitExceeded`. Self-healing (they retry next run, nothing lost), but worth knowing this
  can happen on an unusually large night. Steady-state nightly wipes should be far smaller
  (roughly one night's worth of blocks, not months) and shouldn't hit this.

- **`pushPendingCalendarBlocks`'s 50/run cap** is generous relative to a typical night's volume
  but is a hard cap, not paginated — a night with more than 50 genuinely new pending pushes
  would leave the excess for the following night rather than processing them same-night.
