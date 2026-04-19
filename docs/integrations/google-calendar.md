Google Calendar Integration

Scopes
- Minimum scope required: https://www.googleapis.com/auth/calendar (read/write to primary calendar).
- OAuth endpoints:
  - Start: `oauthStart` (public)
  - Callback: `oauthCallback` (public)

Disconnect
- Use the in-app Settings > Calendar Integration or Calendar Integration page to Disconnect.
- Backend callable: `disconnectGoogle` clears the stored refresh token.
- After disconnect, `calendarStatus` will report `connected: false` until you re-auth.

Re-authentication
- Press Connect in Calendar Integration to start a new OAuth session.
- On success, the refresh token is stored under `tokens/{uid}`.

Audit
- All calendar syncs, create/update/delete actions are logged in `activity_stream` with sanitized metadata.

