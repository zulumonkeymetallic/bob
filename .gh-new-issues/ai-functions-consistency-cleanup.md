# AI Functions Consistency & Deduplication

Scope
- Audit all AI-related callables and jobs; remove duplicates and align naming/regions.

Inventory (to verify)
- planCalendar (callable)
- approvePlanningJob (HTTPS public)
- dailyPlanningJob (scheduler)
- orchestrateGoalPlanning (callable)
- sendAssistantMessage (callable)
- diagnosticsStatus, testLLM, sendTestEmail (callables)

Tasks
- Ensure all run in region `europe-west2` and share consistent logging, error handling.
- Remove dead/duplicated createTrackingIssue definitions and unused secrets.
- Confirm UI surfaces exist for each (Planner/Matrix, Approvals, Goal/Story AI, Diagnostics) or create tickets.
- Document endpoints in AGENTS.md; add CI check for accidental duplication.

Acceptance
- Single source of truth per function.
- No unused secrets required in deployment.
- Docs updated and linked from README/AGENTS.md.

