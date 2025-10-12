Title: AI Goal Chat · Session Summarization + Token Guardrails

Description
- Prevent long chat threads from growing unbounded: periodically summarize conversation and trim history before LLM calls.
- Add content moderation and prompt-injection safe prompts.

Acceptance Criteria
- [ ] When messages > N, create `summary` doc and keep last K messages; include summary in system context.
- [ ] Add moderation step (lightweight) to block unsafe content and notify user.
- [ ] Log truncation/summarization events in `/ai_usage/goal_chat`.

Technical Plan
- Functions: wrap `sendGoalChatMessage` with a history manager; add `summaries` subcollection and inject summary into prompts.
- Config: per-user limits (e.g., N=40 messages, K=8 recent).

