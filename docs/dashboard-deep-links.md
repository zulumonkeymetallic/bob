# Dashboard Metric Deep Links

## Summary
Dashboard widgets now route to the relevant filtered views so you can jump directly from a metric to the underlying work. The following shortcuts are available:

- **Tasks Due Today** → `/tasks` with the "due today" preset applied.
- **Today's Blocks** → `/calendar` focused on the current day.
- **Priority Checklist button** → `/calendar` focused on the daily checklist context.
- **Theme Progress rows** → `/stories` filtered by the selected theme.

## QA Notes
1. Sign in and open `/dashboard`.
2. Click **Tasks Due Today** and confirm the Tasks list filters to items due today (blue alert displays, `Clear preset` restores default view).
3. From the dashboard, click **Today's Blocks** and confirm the unified planner opens in day view for the current date.
4. Click **Open Planner Checklist** in the checklist panel; verify the unified planner opens in day view.
5. Click any theme row in Theme Progress; verify Stories Management highlights the theme filter banner.
6. Clear filters using the provided buttons and ensure navigation state resets.
