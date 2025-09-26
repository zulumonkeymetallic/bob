**Description**
Model daily/weekly chores and routines, show them in the Priorities view, optionally push to iOS Reminders, and block time on the calendar when requested.

**Acceptance Criteria**
- [ ] User can define chores/routines with frequency (RRULE), expected duration, and “calendar block?” toggle.
- [ ] Chores appear in the Priorities view each day with streaks and “skip/snooze/complete”.
- [ ] Optional push to iOS Reminders list with two-way completion sync (no duplicate tasks).
- [ ] If “calendar block” is on, create a corresponding event in Google Calendar; completion in BOB marks the calendar event done (adds a ✓ prefix or updates description).
- [ ] Weekly summary shows completion rate and total time spent.

**Proposed Technical Implementation**
- **Schema:** `/routines/{id}` with `{title, rrule, durationMin, pushToReminders, pushToCalendar, themeId(optional)}`; instances in `/routine_instances`.
- **Generation:** daily function `spawnRoutineInstances()` creates today’s instances.
- **Reminders sync:** reuse existing Reminders bridge with a `ref` to `routineInstanceId`.
- **Calendar:** same n8n/Calendar pipeline as theme blocks; mark complete by updating event title/description.
- **Priorities UI:** combined list of (stories, tasks, routine instances) with filters & streak badge.
