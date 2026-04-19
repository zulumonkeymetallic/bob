**Description**
Auto-schedule active stories/tasks into user-defined time blocks per Theme (Growth, Health, Home, etc.), then push to Google Calendar. Changes made in Google Calendar should sync back to BOB.

**Acceptance Criteria**
- [ ] User can define recurring Theme Blocks (day/time, duration, priority, max fill %, hard/soft rules).
- [ ] Auto-scheduler places eligible stories/tasks into upcoming Theme Blocks based on priority, due date, effort estimate, and dependencies.
- [ ] Events are created/updated on Google Calendar with deep links back to the BOB item.
- [ ] Two-way sync: edits/moves in Google Calendar reflect back in BOB (time, duration, status).
- [ ] Conflict handling: respects work hours, existing events, and do-not-schedule windows; provides a reschedule suggestion list.
- [ ] Manual drag/drop in BOB’s calendar view re-writes Google Calendar events and persists in Firestore.
- [ ] Audit log shows every schedule/write operation (success/failure).

**Proposed Technical Implementation**
- **Schema:** `/blocks/{id}` with `{ themeId, rrule/weeklySpec, durationMin, priority, constraints, maxFillPct }`.
- **Scheduler:** Cloud Function `autoScheduleStories()` runs on block/story updates + hourly cron; uses a priority queue keyed by (dueSoon, priority, effort).
- **Event model:** `/calendar/events/{id}` storing `{storyId, blockId, gcalEventId, start, end, status, source}`; enforce idempotency by `storyId+start`.
- **Google integration:** n8n workflows for create/update/delete; webhooks/polling listener writes back to `/calendar/events`.
- **Two-way mapping:** maintain `gcalEventId` on the event doc; reconcile diffs (time changes, cancellations).
- **UI:** Calendar board (week view) + Theme filter; inline “Reschedule” & “Lock” actions; conflict badges.
- **Rules engine:** small deterministic rule set (hard constraints first, then soft scoring for fit); extensible policy file.
