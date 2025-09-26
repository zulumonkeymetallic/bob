**Description**
Enable BOB to sync backlog items with iOS Reminders, ensuring tasks can be created, updated, and marked complete from either system.

**Acceptance Criteria**
- [ ] Backlog tasks in BOB appear in the chosen Reminders list.
- [ ] Completing a task in Reminders updates the task in BOB.
- [ ] Completing a task in BOB updates the task in Reminders.
- [ ] De-duplication logic prevents duplicates when syncing.

**Proposed Technical Implementation**
- Use Firebase Functions to expose sync endpoints.
- Use n8n (or custom middleware) to handle bi-directional sync with Apple Reminders API.
- Implement a unique `ref` ID on tasks for cross-system identification.
- Schedule a cron job (e.g., via Cloud Scheduler) to reconcile changes daily.
