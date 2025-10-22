# [LLM-4] AI usage logging policy

- Labels: epic:AI-scheduling, LLM, audit

Description
Document and enforce AI usage logging policy with token/cost metrics and strict redaction (no prompts/answers stored by default).

Acceptance Criteria
- aiUsageLogger used in all Gemini call sites
- docs/ai-scheduling.md outlines policy

Dependencies
- aiUsageLogger, callLLMJson wrappers

Test Notes
- Run Settings Diagnostics testLLM; verify minimal logging present.
