# 206 – Task → Story conversion automation

- Type: automation / backend
- Priority: P0
- Areas: Tasks, Stories, Reminders, AI

## Problem
Manual conversion workflows do not enforce the specification: tasks over 4 hours must automatically become stories with generated acceptance criteria, Reminder updates, and audit logs. Without automation, large tasks slip through and cross-system syncing remains inconsistent.

## Rules to Implement
1. **Trigger Conditions**
   - Auto-convert any task with effort estimate > 4 hours (or > 2 points if using point scale equivalent).
   - Allow configuration/override per profile, but default to 4h threshold.
2. **Conversion Flow**
   - Create new Story linked to the same Goal/Theme; inherit metadata.
   - Generate acceptance criteria via LLM if blank and persist to story doc.
   - Derive story size (small/medium/large) from effort.
   - Preserve due date, attachments, and comments.
3. **Goal Link Enforcement**
   - If source task lacks goal link, flag in Data Quality Email (issue 205) and notify user via in-app alert.
4. **iOS Reminders Handling**
   - Mark original Reminder complete.
   - Append note `Converted to Story [REF-####]` with deep link.
   - Maintain original due date metadata when syncing back.
5. **Audit Logging**
   - Record conversion in Firebase activity stream with `Actor: AI_Agent`, action `Conversion`, source task ID, destination story ID.
   - Emit analytics event for monitoring volume and failures.
6. **Error Handling**
   - If conversion fails, leave task untouched but log incident for Data Quality Email.

## Acceptance Criteria
- [ ] Tasks exceeding 4h get auto-converted within the scheduler window.
- [ ] New stories contain acceptance criteria, size, and correct Goal/Theme linkage.
- [ ] Original reminders are closed with conversion note and deep link.
- [ ] Activity stream captures conversion metadata for every automated run.
- [ ] Exceptions surface in Data Quality Email and monitoring dashboards.

## Dependencies
- Scheduler window for conversion execution (issue 207).
- Activity stream enhancements (`issues/169`, `197`).

## Notes
- Consider feature flag for staged rollout.
- Provide admin command to re-run conversion on historical backlog with dry-run option.
