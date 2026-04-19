# Epic — AI Scheduling & Enrichment Layer

- Type: epic
- Labels: epic:AI-scheduling
- Areas: calendar, LLM, firestore, ui, audit, capacity-planner

Objective
Unify calendar two-way sync, AI-driven task enrichment and conversions, planner flows, and safe auditing into a cohesive layer with clear callable APIs and supporting UI.

Scope
- Calendar two-way sync with audit and conflict handling
- Auto-enrichment for tasks (estimates, links)
- Task→Story conversion orchestration
- On-demand and scheduled planner LLM
- Goal modal/UI enhancements and planner capacity views

Dependencies
- Firebase Functions v2, Firestore rules/indexes, Gemini key
- Google Calendar OAuth and tokens per user

Tracking
- Traceability IDs: CAL‑1..8, DUR‑1..3, GOAL‑1..4, CAP‑1..4, LLM‑1..4, GIT‑1..5, AUD‑1..3, SEC‑1..3
- Daily build log: add updates here or in GitHub Epic comment

Acceptance
- All callable endpoints exist and are documented in docs/ai-scheduling.md
- UI wired for calendar status/sync; planner shows capacity signals; goal modal enhanced
- Tests: smoke E2E for goal modal/planner matrix; unit/integration where feasible

