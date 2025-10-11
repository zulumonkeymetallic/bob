# 336 – EPIC · Planning Matrix v2: AI‑Assisted Sprint Planner

Goal: Unify an AI‑assisted Planning Matrix with point‑based capacity planning, calendar sync, and Kanban UI. Child tasks track schema, planner, sync, UI, jobs, and testing.

Scope
- AI‑assisted plan proposal from goals/stories/tasks with estimate points.
- Capacity by persona/sprint (points per sprint, per day budget optional).
- Calendar integration to reflect scheduled blocks; drag/resize → sync.
- Kanban and Matrix views stay in lockstep; approvals for proposed changes.

Data & Schema
- Add `estimate_points` to stories/tasks; align with S/M/L mapping.
- Sprint capacity: `{ persona, sprintId, pointsCapacity }` (+ derived per‑day budget optional).
- Store plan proposals: `planning_jobs` → status: proposed/approved/applied/rejected.

Planner Engine
- Input: backlog (prioritized), sprint dates, capacity, events/blocks.
- Output: proposed schedule (blocks), carryover list, conflicts/warnings.
- Constraints: work hours, event conflicts, max focus blocks per day.

Calendar Sync
- Create/update/delete `calendar_blocks` from approvals.
- Drag/resize in planner updates `calendar_blocks` (and recalc points/day).

UI
- Matrix v2: lanes by day; columns per theme/goal (toggle); points per cell.
- Capacity chips (planned vs capacity) with warning states.
- Approvals panel: summarize proposed changes with accept/apply.

Jobs
- Nightly: generate proposals for next N days (respect capacity).
- Reminder email: proposed plan summary with deep link for approval.

Testing
- E2E: CRUD stories/tasks, estimate entry, approvals flow, calendar drag/resize.
- Unit: capacity math, conflict detection, carryover, points sum.

Milestones
- M1: Schema + read‑only Matrix view with points rollups.
- M2: Proposals + Approvals UI (apply to calendar).
- M3: Drag/resize sync + Kanban parity.
- M4: Nightly job + email summary; polish and docs.

