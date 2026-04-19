# [LLM-1] Auto-enrich tasks (estimates + links)

- Labels: epic:AI-scheduling, LLM, firestore

Description
Create callable that fills missing estimateMin and suggests goal/story links using Gemini, with safe auditing.

Acceptance Criteria
- autoEnrichTasks callable processes batch; updates tasks
- Redaction policy enforced in activity log

Dependencies
- functions/index.js new wrapper

Test Notes
- Run on tasks lacking estimate; verify updates and sanitized activity.
