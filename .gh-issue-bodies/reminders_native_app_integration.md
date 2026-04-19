## Summary
- **Goal**: Replace the Apple Shortcuts bridge with the dedicated BOB Reminders app integration.
- **Scope**: Front-end settings surface, Cloud Functions, Firestore schema, and sync telemetry.
- **Drivers**: Shortcuts flow is unused; native app already handles reminder lifecycle and needs first-class support.

## Requirements
1. **Settings UI**
   - New panel: "BOB Reminders App" with connection status, last sync, and token management.
   - Remove or archive the Shortcuts UI; link to migration doc for legacy users.
2. **Authentication & API**
   - Accept signed app requests (Firebase Auth token or signed JWT) instead of static `REMINDERS_WEBHOOK_SECRET`.
   - Expose endpoints for: pull changes, push updates, health check, tag sync.
3. **Data Model**
   - Store reminder tags, external identifiers, and app metadata on `reminders` documents.
   - Track sync provenance (`source: 'ios_app'`, version info).
4. **Logging & Observability**
   - Integration logs capturing request metrics, failures, and last successful sync timestamp per user.
   - Admin dashboard row (Settings → Integrations) showing connection state.
5. **Migration**
   - Backfill existing reminders with `legacy: 'shortcuts'` flag.
   - Document steps for switching users; ensure no downtime.

## Acceptance Criteria
- [ ] User authenticates via Reminders app, sees "Connected" status + last sync in web UI.
- [ ] Reminders app can create/update/complete items and see immediate reflection in Firebase.
- [ ] Reminder tags from iOS appear on linked task cards.
- [ ] Cloud logs show structured entries for pull/push actions with user IDs and durations.
- [ ] Legacy Shortcuts endpoints respond with 410 Gone (or similar) after migration window.

## Dependencies
- Confirm token exchange approach with mobile team.
- Ensure Firebase security rules updated for new API shape.

## Rollout Plan
1. Implement endpoints + rules behind feature flag.
2. Release web UI update with dual (legacy + new) tabs.
3. Invite pilot users via app TestFlight; monitor logs.
4. Decommission Shortcuts flow once adoption target reached.
