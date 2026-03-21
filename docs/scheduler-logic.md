# Scheduler Logic

Last reconciled: 2026-03-18

This document describes the current scheduler behavior across:

- nightly orchestration in [functions/nightlyOrchestration.js](/Users/jim/GitHub/bob/functions/nightlyOrchestration.js)
- delta replan in [functions/nightlyOrchestration.js](/Users/jim/GitHub/bob/functions/nightlyOrchestration.js)
- the canonical placement service in [functions/services/schedulingService.js](/Users/jim/GitHub/bob/functions/services/schedulingService.js)

## Scope

The scheduler is responsible for placing live sprint work into `calendar_blocks` and, when eligible, syncing those blocks to Google Calendar.

Eligible planner-created Google events:

- live `story` blocks
- live `task` blocks
- live `chore` blocks

Non-eligible planner blocks for Google sync:

- `routine`
- `habit`
- `work_shift_allocation`
- theme allocation / fitness / planner-only blocks

## High-Level Flow

1. Nightly or delta replan loads profile, timezone, theme allocations, sprint windows, and current `calendar_blocks`.
2. Google-sync policy cleanup runs first:
   - stale Bob-created story/task/chore blocks are deleted
   - Bob-owned non-eligible blocks have `syncToGoogle` disabled
   - imported external Google events are kept
3. Open sprint stories and tasks are loaded.
4. Candidate queues are built using AI score, manual priority, sprint context, and story-task relationships.
5. Existing non-AI manual linked blocks are treated as authoritative:
   - if a story/task already has a non-AI linked block, the scheduler skips creating another one
6. Sprint week buckets are chosen from theme allocations and sprint windows.
7. The canonical scheduling service places each candidate into `calendar_blocks`.
8. Firestore triggers sync eligible live story/task/chore blocks to Google Calendar.

## Candidate Selection

Nightly and delta replan include:

- open stories in active/planning sprints
- open tasks in active/planning sprints
- tasks linked to open sprint stories

The scheduler excludes:

- done stories
- done tasks
- routine/chore/habit items from the story/task placement queue
- explicitly `orchestrationLocked` items

Manual priority affects ordering:

- `#1` manual priority ranks above `#2`
- `#2` ranks above `#3`
- manual priority ranks above AI-only ordering

AI ordering then applies within the remaining candidates.

## Theme Allocations and Busy Time

The canonical scheduler uses theme allocations first. If a theme has explicit user allocations for the day, those allocations are the candidate slots. If not, the fallback theme rules are used.

Busy time handling:

- in `strict` mode, all blocks are treated as busy
- in `smart` mode:
  - imported user Google events are busy
  - work-shift blocks are busy unless scheduling work persona items inside work blocks
  - fitness blocks are busy

This means the scheduler should not place ordinary work on top of external commitments, work blocks, or fitness blocks.

## Manual Overrides

Manual date/time overrides are now first-class scheduler input.

When a story or task has `dueDateLocked` or `lockDueDate`:

- if `dueDate` plus `dueTime` is set:
  - the canonical scheduling service creates an exact forced placement at that date/time
  - this overrides theme-slot selection and normal gap-search behavior
- if `dueDate` is set without `dueTime`:
  - placement is constrained to that exact day
  - `timeOfDay` is used if present

This is how a user-set due date/time overrides the scheduler rather than acting as a weak hint.

## Manual Calendar Entries

If the user manually creates a calendar entry from a story or task and that block is linked via `storyId` or `taskId`:

- the scheduler sees it as a non-AI linked block
- nightly replan and delta replan skip creating another planner block for that same entity

This is the main duplicate-prevention rule for manually planned live work.

## Canonical Placement Service

The canonical placement service:

1. loads related blocks for the entity
2. loads the calendar window
3. builds busy intervals
4. resolves duration from:
   - explicit request
   - existing block duration
   - estimate minutes
   - story/task points
5. chooses either:
   - an exact forced placement for locked due date + due time
   - a same-day constrained placement for locked due date
   - or a normal placement from the requested target day/bucket
6. writes or reuses the linked `calendar_blocks`
7. removes obsolete AI/planner-generated linked blocks for that entity
8. updates the story/task scheduling fields and sprint alignment metadata

## Google Calendar Sync Rules

Google sync happens from `calendar_blocks` through [functions/calendarSync.js](/Users/jim/GitHub/bob/functions/calendarSync.js).

Before create/update:

- the linked entity must still exist
- the linked entity must still be live
- the block must still be eligible for Google sync

If the linked entity is missing or closed:

- the stale Bob block is deleted or de-linked
- the Bob Google event is removed on sync cleanup

## Chores

Legacy chore block creation has been retired. Chore calendar placement should come from the current scheduler pipeline, not the old `chore_*` materializer path.

Only live chore-linked blocks are allowed to survive and sync to Google Calendar.

## Work Blocks

Planner-created work-shift allocation blocks are planner-only structure. They should not create duplicate Bob Google events on top of imported work events.

Theme allocations are used to guide planner capacity, not to spam duplicate work events into Google Calendar.

## Important Guardrails

- manual linked calendar entries prevent duplicate planner creation
- user-locked due date/time overrides planner slot search
- only live story/task/chore blocks can sync to Google Calendar
- stale Bob blocks are cleaned during nightly and delta replan windows
- work-shift/theme allocation blocks are not valid Bob Google event outputs

## Open Review Questions

These are product-review questions rather than undocumented behavior:

- whether forced exact due-time placement should warn when it conflicts with an imported Google event
- whether sprint Done columns should remain strictly due-date scoped or also allow explicit sprint membership when due dates are missing
- whether manual story/task calendar creation should update an existing linked block instead of blocking duplicate creation from the UI
