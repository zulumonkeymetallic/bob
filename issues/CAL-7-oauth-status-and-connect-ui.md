# [CAL-7] OAuth status and connect flow in UI

- Labels: epic:AI-scheduling, calendar, ui, sec

Description
Wire CalendarIntegrationView to oauthStart redirect, handle callback status, and display calendarStatus consistently.

Acceptance Criteria
- Connect button starts OAuth; status badge reflects connected/not connected
- Error states show toasts without sensitive details

Dependencies
- oauthStart/oauthCallback, calendarStatus callable

Test Notes
- Connect/disconnect; ensure status updates and no secrets in logs.
