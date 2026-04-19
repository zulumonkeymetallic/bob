# [CAL-1] Calendar CRUD endpoints and UI wiring

- Labels: epic:AI-scheduling, calendar, ui, firestore

Description
Wire CalendarIntegrationView to callable endpoints for create/update/delete/list events and Google OAuth status. Replace mocked data with live events.

Acceptance Criteria
- UI calls functions: createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, listUpcomingEvents
- OAuth connect button invokes oauthStart; status shown via calendarStatus
- Errors surface as toasts (no secrets)

Dependencies
- functions/index.js OAuth + calendar callables

Test Notes
- Manual: Connect calendar, create event, edit, delete; verify event appears in Google and Firestore blocks when linked.
