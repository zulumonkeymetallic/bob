# [LLM-3] Prioritisation explainability in UI

- Labels: epic:AI-scheduling, LLM, ui

Description
Surface reasons behind importanceScore/isImportant selections with a brief rationale per task.

Acceptance Criteria
- Hover or detail view shows key factors (due, age, story link, sprint)
- Optional Gemini rationale stored separately (no heavy logs)

Dependencies
- buildPlan scoring outputs

Test Notes
- Inspect important tasks list; verify explanation text appears.
