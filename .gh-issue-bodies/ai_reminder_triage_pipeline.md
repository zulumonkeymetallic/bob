## Summary
- **Goal**: Introduce an AI-powered triage pipeline that reprioritises reminders, justifies due-date changes, and converts oversized items to stories.
- **Scope**: Cloud Functions automation, LLM integration, Firestore logging, reminder/task annotations, and UI surfacing of AI decisions.

## Functional Requirements
1. **Batch Processing**
   - Scheduled function (e.g., hourly) loads open reminders + linked tasks for a user.
   - Batches are limited (e.g., 25 reminders) to stay within LLM quotas.
2. **LLM Reasoning**
   - Prompt engineered to classify priority (Today / Upcoming / Parking Lot) and flag conversions.
   - Returns structured JSON: `{ id, action, newDueDate?, story?, rationale }`.
3. **Actions**
   - `reprioritise`: update reminder + task due date, annotate with rationale.
   - `convert_to_story`: call existing auto-conversion, then stamp reminder with story ref + completion.
   - `defer` / `snooze`: push to later date with explanation.
4. **Audit Trail**
   - Write `reminder_triage_runs/{runId}` with inputs, outputs, tokens, and status.
   - Persist rationale on reminder (`aiRationale`) and task (`scheduler.lastReasonDetail`).
5. **UI Updates**
   - Dashboard chip showing "AI managed" status and latest reasoning.
   - Triage history tab for transparency.

## Non-Functional Requirements
- Rate limiting per user, retry-safe writes, and guardrails (do not reschedule locked tasks).
- Observability: structured logs + metrics (success count, conversions, deferrals).
- Feature flag to enable per persona or per user.

## Acceptance Criteria
- [ ] Automation runs without exceeding function runtime / quota.
- [ ] Reminders reflect AI decisions with human-readable rationale.
- [ ] Converted stories link back to reminders and original tasks.
- [ ] Unit tests cover prompt parsing + action application; integration test validates full run with emulator + mocked LLM.
- [ ] Dashboard displays triage status and reasons for last adjustment.

## Rollout Plan
1. Implement behind feature flag + dry-run mode (log-only).
2. Dogfood with internal accounts; validate rationale quality.
3. Enable write mode for pilot users; monitor metrics.
4. Scale out once success metrics met.
