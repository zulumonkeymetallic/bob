# 160 – All Sprints filter does not clear sprint scope on Goals

- Type: bug
- Priority: P1
- Affects: Global Sprint selector, Goals Management view
- Status: Fixed in repo (pending deploy)

## Summary
Selecting "All Sprints" in the sprint selector did not clear the sprint filter on the Goals page. The selector immediately re-selected the active sprint, so goals remained filtered.

## Steps to Reproduce
1. Open Goals Management (`/goals`).
2. Use the sprint selector and click "All Sprints".
3. Observe the list still only shows goals with stories in the previously active sprint.

## Expected
When "All Sprints" is selected, sprint-based filtering is disabled and all goals are visible (subject to other filters).

## Root Cause
- `SprintSelector` auto-selection logic treated an explicit empty string (`''`) selection as falsy and re-selected the preferred sprint (active/planned), overriding the user’s choice.
- `GoalsManagement` passed `selectedSprintId || undefined` to `SprintSelector`, causing the selector to receive `undefined` when "All Sprints" was chosen, which also triggered auto-selection.

## Fix
- Respect explicit "All Sprints" (empty string) in `SprintSelector` and skip auto-selection in that case.
- Pass the exact `selectedSprintId` to `SprintSelector` from `GoalsManagement` (no `|| undefined`).

## Files Changed
- `react-app/src/components/SprintSelector.tsx` – Guard auto-select when `selectedSprintId === ''`.
- `react-app/src/components/GoalsManagement.tsx` – Pass `selectedSprintId` directly to the selector.

## Validation
- Manually verified on Goals page that selecting "All Sprints" shows all goals and persists selection.
- Confirmed selector label shows "All Sprints" and no re-selection occurs on snapshot updates.

## Notes / Follow-ups
- Audit other callers that pass `selectedSprintId || undefined` (e.g., metrics widgets) to keep behavior consistent with the selector’s semantics. Not required for the fix but recommended for consistency.

