# 209 – Calendar block engine review & refactor

- Type: review / refactor
- Priority: P0
- Areas: Scheduler, Calendar, Themes, Routines

## Problem
Current issues focus on adding calendar features, but we lack a deep review of the scheduling engine that aligns blocks with Themes, Goals, Chores, and Routines. The spec requires intelligent generation, rescheduling, and deep links into daily communications.

## Scope
1. **Theme-Aligned Blocks**
   - Ensure each Theme (Health, Growth, Wealth, Tribe, Home) has target allocation and that blocks inherit theme styling/metadata.
   - Validate linkage chain: Theme → Goal → Story → Task → Calendar Block.
2. **Chores & Routines Integration**
   - Audit “Chores Modern Table” ingestion and conversion into recurring calendar blocks.
   - Confirm routines (journaling, meditation, weekly planning) auto-schedule with RRULE support and respect availability.
3. **Dynamic Behaviour**
   - Review logic for missed blocks (automatic reschedule), block expansion/contraction, and conflict resolution with fixed appointments/work hours.
   - Assess handling of overlapping commitments and escalate when user intervention required.
4. **Daily Email Integration**
   - Provide structured data for Daily Summary Email (issue 204) including Theme, linked items, deep links, allocated time.
   - Expose summary API for other surfaces (dashboard, mobile).
5. **Code Review & Refactor**
   - Evaluate modularity, test coverage, and scalability of scheduling code.
   - Identify refactor tasks (e.g., extracting planners, improving configuration, better logging).

## Acceptance Criteria
- [ ] Completed audit document outlining current architecture, gaps, and refactor plan.
- [ ] Theme/goal/story/task linkage validated with example scenarios and tests.
- [ ] Chores/routines reliably generate and reschedule blocks; failures raise alerts.
- [ ] Daily Summary Email consumes calendar block feed with deep links and allotted time.
- [ ] Refactor tasks logged (or PRs raised) for modularisation and scaling improvements.

## Dependencies
- Routine documentation updates (`issues/163`, `166`).
- Scheduler adjustments (issue 207) to consume refined availability windows.

## Notes
- Consider adopting rule engine or planner DSL for extensibility.
- Coordinate with mobile team to ensure API format remains consistent.
