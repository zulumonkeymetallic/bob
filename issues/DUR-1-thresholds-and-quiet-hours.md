# [DUR-1] Thresholds and quiet hours

- Labels: epic:AI-scheduling, planner, ui

Description
Expose settings for min block size, buffer, and quiet hours; enforce in planner and show reasons for unscheduled items.

Acceptance Criteria
- Settings saved per user/persona
- Planner respects thresholds; unscheduled have reason

Dependencies
- planSchedule engine, SettingsPlannerPage

Test Notes
- Adjust settings; verify planner outputs change and unscheduled reasons appear.
