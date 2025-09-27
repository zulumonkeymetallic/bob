# 196 – Scheduling: Auto Calendar Scheduling & Management (Deterministic + LLM)

## Summary
Automatically slot Stories/Tasks and Daily Chores into user’s calendar blocks using a hybrid deterministic engine with optional LLM assistance for edge cases.

## Acceptance Criteria
- Deterministic scheduler fills blocks respecting work hours, themes, travel time, priorities, and deadlines.
- LLM path explains adjustments (audit log) and only acts within guardrails.
- User can approve/reject suggestions; changes sync to Google Calendar.

## Proposed Technical Approach
- Define hard constraints (hours, capacity, dependencies) and soft constraints (energy, recovery metrics from HealthKit/Strava).
- ILP/CP-SAT or greedy heuristic for baseline; LLM provides tie‑break rationale + user‑friendly summaries.
- Implement change log with undo/redo.
- Feature flags for A/B testing.

## Data Model / Schema
- `blocks` collection (theme, window, capacity), `schedule_proposals`, `audit_log` with actions.
- `constraints` store per user (hard/soft).

## APIs & Endpoints
- `POST /schedule/run`, `POST /schedule/propose`, `POST /schedule/approve`.
- Internal solver module + optional LLM call with bounded schema.

## Security & Permissions
- Never let LLM create events directly; it must propose through typed schema.

## Testing & QA
- Property tests for feasibility; simulation harness with random workloads; snapshot tests for proposals.

