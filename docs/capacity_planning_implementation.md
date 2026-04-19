# Implementation Plan: Capacity Planning & Algorithmic Prioritization

## Goal Description
Implement a robust Capacity Planning Dashboard and an algorithmic (non-AI) prioritization engine for Stories. This ensures the user can visualize their sprint load and that stories are prioritized based on real urgency (Due Dates vs. Effort) rather than just manual input or LLM guesses.

## User Review Required
> [!IMPORTANT]
> **Priority Overwrite**: The new `updateStoryPriorities` job will **overwrite** manually set priorities if they conflict with the calculated urgency.
> **Capacity Rules**: We are hardcoding capacity to 8h (M-F) and 16h (S-S). This assumes a strict schedule.

## Proposed Changes

### Backend (Cloud Functions)
#### [MODIFY] `functions/capacityPlanning.js`
*   `calculateSprintCapacity(sprintId)`:
    *   **Capacity**: Query `calendar_blocks` for "Work"/"Main Gig". If found, subtract duration from 16h (24-8). Else default to 8h deduction (M-F).
    *   **Progress**: Calculate `completedPoints` vs `totalPoints`. Return `progressPercent` and `remainingHours`.
    *   **Breakdown**: Include `allocated` vs `utilized` per Goal.
*   `updateStoryPriorities()`:
    *   Update logic to use 1-5 scale.
    *   Use `RemainingEffort` for ratio calculation.

### Frontend (React)
#### [MODIFY] `src/components/CapacityDashboard.tsx`
*   Add **Progress Bars**:
    *   Show "Allocated: X h" vs "Progress: Y%".
    *   Show "Remaining: Z h".
*   Update Charts to show Utilized vs Allocated if possible, or just Allocated.

#### [MODIFY] `src/components/GoalsManagement.tsx` (or GoalCard)
*   Fetch capacity data (maybe via a new hook or prop).
*   Display "Allocated" and "Utilized" badges/bars on the card.

## Verification Plan
### Automated Tests
*   Verify Capacity Logic with "Work" blocks present vs absent.
*   Verify Priority Logic with 1-5 scale.

### Manual Verification
1.  **Work Blocks**: Create a "Work" block. Check Capacity Dashboard. Total Capacity should decrease.
2.  **Progress**: Mark a Story as Done. Check Capacity Dashboard. Progress % should increase.
3.  **Goal Card**: Check `/goals` to see if capacity metrics appear.
