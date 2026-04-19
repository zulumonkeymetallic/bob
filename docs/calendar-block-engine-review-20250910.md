# Calendar Block Engine Review – 2025-09-10

> **Update – 2025-09-27:** The scheduler now emits occurrences for open tasks and stories alongside chores and routines. Each scheduled instance persists refs, themes, and deep links to support downstream reporting and calendar tooling.

## Architecture Overview
- The deterministic planner lives in `functions/scheduler/engine.js`, combining `blocks`, `chores`, `routines`, and now task/story backlog into day slots. Blocks are normalised with default windows, capacity and constraint metadata.
- Occurrences for tasks and stories are generated from their scheduled/due dates with estimated durations and theme tags (`functions/scheduler/engine.js:143-219`). Each occurrence may specify tags, required block IDs, or location hints.
- `planOccurrences` attempts to place each occurrence into the earliest available block slot while respecting capacity, buffers, and existing scheduled instances (`functions/scheduler/engine.js:285`). Failed placements record `unscheduled` reports.
- Busy calendars (Google + internal blocks) are carved out before placement via `computeBusyByDay` and `buildBlockDaySlots` to avoid conflicts (`functions/scheduler/engine.js:139`).
- Scheduler runs trigger via new automation `runDailySchedulerAdjustments`, which focuses on due-date recalibration rather than block generation (`functions/index.js:5167`). Daily email aggregation simply reads whatever exists in `calendar_blocks` and enriches with linked stories/tasks (`functions/lib/reporting.js:321`).

## Findings Against Requirements

### 1. Theme-Aligned Blocks
- Blocks carry a `theme` field optionally (`functions/lib/reporting.js:330`), but the engine neither enforces theme quotas nor ensures occurrences inherit theme metadata. Matching relies entirely on optional `tags` (`functions/scheduler/engine.js:84`).
- There is no allocation target per theme (e.g., minimum hours for Health). The planner treats all blocks generically; prioritisation is solely numeric (`functions/scheduler/engine.js:241`).

### 2. Chores & Routines Integration
- Chores/routines are expanded via RRULEs and converted to occurrences with default policies (`functions/scheduler/engine.js:200`).
- Policy objects (e.g., `mode: 'roll_forward'`) are captured but never applied during scheduling or when things miss their slot (`functions/scheduler/engine.js:217`). Missed chores simply appear in the `unscheduled` list without retry logic or notification wiring.
- There is no verification that the "Chores Modern Table" schema populates fields like `requiredBlockId`, `tags`, or `locationNeeds`; the planner will silently fall back to defaults.

### 3. Dynamic Behaviour & Conflict Handling
- `planOccurrences` subtracts busy intervals and respects block capacity, but there is no rescheduling of previously planned instances when conflicts arise. Existing placements are copied forward verbatim if they already exist in `scheduled_instances` (`functions/scheduler/engine.js:260`).
- No expansion/ contraction of blocks occurs—durations are fixed by the occurrence. Buffer handling is basic (before/after) and cannot shrink/extend to fill gaps.
- When no slots remain, the engine emits `unscheduled` entries but does not escalate via notifications or mark chores for retry.
- Due-date adjustments in `runDailySchedulerAdjustments` work on tasks and reminders, independent of block generation. The routine does not mutate or create calendar block documents (`functions/index.js:5167`).

### 4. Daily Email Integration
- The daily summary still pulls existing `calendar_blocks` and attaches linked task/story metadata and allocated minutes (`functions/lib/reporting.js:321`).
- Scheduled instances now embed task/story refs and deep links, but we do not yet promote planner output into `calendar_blocks`, so email/calendar feeds remain dependent on manual blocks.
- There is no summary API beyond the email pipeline; mobile clients rely on raw `calendar_blocks` subscriptions.

### 5. Code Structure & Testing
- The planner is a monolithic module with no unit tests or integration tests. Behaviour is difficult to validate against edge cases (missed occurrences, stale busy windows).
- Policy logic, notification surfaces, and ref data (themes, routines) are intermingled, making extension risky.
- Logging is minimal; diagnosing unscheduled items requires manual inspection of return values.

## Recommendations

| Area | Recommendation | Severity | Notes |
| --- | --- | --- | --- |
| Theme allocation | Introduce per-theme capacity targets and propagate theme metadata through occurrences/blocks for reporting. Consider weighting the sort order by theme deficits. | High | Current engine ignores theme requirements entirely.
| Occurrence policies | Implement handling for `policy.mode` (roll_forward, skip, escalate) and wire missed occurrences to notification/alert channels. | High | Policies captured at `functions/scheduler/engine.js:217` are unused.
| Task/story linkage | ✅ Occurrence generation now includes high-priority tasks/stories with refs, themes, and deep links persisted in `scheduled_instances`. | — | Implemented in `functions/scheduler/engine.js` (Sept 2025).
| Dynamic reschedule | When conflicts occur, allow planner to reflow existing assignments (within the same day) instead of copying `scheduled_instances` blindly. | Medium | `functions/scheduler/engine.js:260`.
| Block mutation | Support flexible block durations (e.g., stretch/contract within min/max ranges) and smarter conflict resolution strategies. | Medium | `functions/scheduler/engine.js:60`.
| Monitoring & Alerts | Persist `unscheduled` results to a collection and surface dashboards/alerts so users understand why chores slipped. | Medium |
| API consolidation | Provide a shared scheduling summary endpoint powering email, web, and mobile, ensuring consistent schema and avoiding duplicate aggregation logic. | Medium | Currently only the email path builds structured data.
| Testing & Modularity | Factor planner into smaller functions (occurrence expansion, slot carving, placement strategy) with unit tests. Add integration tests using synthetic busy calendars. | Medium |
| Documentation | Document expected block/occurrence schemas (required fields, tag conventions) and align "Chores Modern Table" to these expectations. | Low |

## Proposed Follow-up Tasks
1. Draft a redesign proposal outlining theme quota algorithm and policy execution flow; include data model changes (e.g., theme weights on blocks).
2. Implement automated alerts for unscheduled items (e.g., write to `scheduler_alerts`) with audit dashboards.
3. Add instrumentation to capture planner run metrics (placements, roll-forwards, failures) for regression tracking.
4. Schedule pairing session with mobile team to agree on a shared calendar block API schema before rolling out new features.
