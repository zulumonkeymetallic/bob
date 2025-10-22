# [LLM-2] Task→Story conversion orchestration

- Labels: epic:AI-scheduling, LLM, ui

Description
Wrap suggestTaskStoryConversions + convertTasksToStories in a single callable workflow with audit and optional auto-apply.

Acceptance Criteria
- taskStoryConversion callable suggests and converts when autoApply=true
- Activity entry logs conversions count, no PII

Dependencies
- Existing conversion callables

Test Notes
- Run with a sample batch; verify stories created and tasks closed.
