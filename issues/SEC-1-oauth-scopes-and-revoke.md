# [SEC-1] OAuth scopes and revoke UX

- Labels: epic:AI-scheduling, sec, calendar

Description
Validate/limit scopes for Calendar, add revoke/refresh controls in settings, and document flow.

Acceptance Criteria
- UI shows connect/disconnect; revoke clears tokens server-side

Dependencies
- oauth helpers; profile settings

Test Notes
- Connect, revoke, reconnect; verify tokens cleared and re-issued.
