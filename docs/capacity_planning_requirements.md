# Capacity Dashboard & Dynamic Re-evaluation Requirements

## 1. Capacity Dashboard
**Objective**: Provide a visual breakdown of capacity allocation per sprint, grouped by Goal and Theme.

### UI Requirements
*   **Location**: New tab/page under `Calendar` or `Sprint Planning`.
*   **Layout**:
    *   **Columns**: Represent Sprints (Current + Future).
    *   **Rows/Groupings**: Grouped by **Theme** (e.g., Work, Health) -> **Goal**.
*   **Metrics**:
    *   **Total Capacity**: Total available hours in the sprint (based on working hours - busy time).
    *   **Allocated Capacity**: Sum of all Story Blocks + Task Estimates assigned to this sprint.
    *   **Utilization %**: `Allocated / Total`.
    *   **Breakdown**: Bar chart or stacked bar showing allocation by Theme/Goal.

### Data Requirements
*   **Total Capacity Calculation**:
    *   **Base**: 24h - 8h (Sleep) = 16h Available per day.
    *   **Work Deduction**:
        *   Check for Calendar Blocks named "Work" or "Main Gig".
        *   If found: Subtract their duration.
        *   If NOT found (and Mon-Fri): Subtract 8h (Standard Work).
    *   *TODO*: Add Settings page for custom Work/Sleep patterns.
*   **Allocated Capacity**:
    *   Sum of `estimateMin` (Tasks) + `Points * 2h` (Stories) linked to Sprint.
*   **Progress Metrics**:
    *   **Progress %**: `Completed Points / Total Points` (for Stories in Sprint).
    *   **Remaining Effort**: `(Total Points - Completed Points) * 2h`.
    *   **Visuals**: Progress Bars showing Allocation vs. Progress.

## 2. Algorithmic Prioritization (1-5 Scale)
**Objective**: Dynamically update Story Priority based on urgency.

### Logic Rules
1.  **Scale**: 1 (Critical) to 5 (Low), matching Tasks.
2.  **Inputs**: `Story Effort`, `Goal Due Date`, `Sprint End Date`.
3.  **Algorithm**:
    *   `DaysRemaining` = `Min(GoalDueDate, SprintEndDate) - Today`.
    *   `UrgencyRatio` = `RemainingEffort / DaysRemaining`.
    *   **P1**: Ratio > 0.8.
    *   **P2**: Ratio > 0.6.
    *   **P3**: Ratio > 0.4.
    *   **P4**: Ratio > 0.2.
    *   **P5**: Default.
4.  **Splitting**: Large stories (High Effort) with High Urgency will naturally have high ratios, ensuring they get P1 and thus priority in scheduling all their blocks.

## 3. Goal Card Enhancements
**Objective**: Show capacity metrics on Goal Cards.
*   **Allocated Capacity**: Total hours assigned to this Goal in the current Sprint.
*   **Utilized Capacity**: Total hours *spent* (based on completed blocks/points) in this Sprint.
*   **Visuals**: Mini progress bar or badge on the Goal Card.
