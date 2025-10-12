Title: FAB · AI Goal Intake Chat (Create → Clarify → Orchestrate)

Description
- From the Floating Action Button (FAB), start an AI-assisted goal intake: user types a goal (e.g., “Make £10k off-grid; terrarium business”).
- Assistant asks 2–5 clarifying questions (time horizon, constraints, assets), then offers to run orchestration: deep research (if needed) → stories/tasks → calendar blocks.
- On approval, calls existing orchestration + planning flows.

Acceptance Criteria
- [ ] FAB action “AI Goal Intake” opens chat-first modal with a goal draft field.
- [ ] Chat captures clarifications, stores messages at `goal_chats/{goalId}/messages`.
- [ ] “Orchestrate” CTA runs `orchestrateGoalPlanning` with context collected from the chat.
- [ ] For simple goals, skip deep research; for complex ones, generate research prompt/doc and email it.
- [ ] After orchestration, show inline summary (stories created, tasks, scheduled blocks, email sent).
- [ ] Deep links to goal/story/task/calendar included in the conversation.

Technical Plan
- UI: `FAB` → open `GoalIntakeChatModal`. Reuse `GoalChatModal` scaffold; add pre-goal draft step.
- Functions: extend `sendGoalChatMessage` to accept an optional `intent: 'intake'` and return a guided list of clarifying questions + an orchestration readiness JSON.
- Orchestration: call `orchestrateGoalPlanning` with overrides derived from chat answers (e.g., preferred cadence, deadline, theme refinement).
- Storage: tag messages with `intent` and `sessionId` for auditing.
- Telemetry: log in `/ai_usage/goal_intake` with counts and completion rate.

Links
- Relates to: #309 (AI Goal Chat), #305 (Orchestration), #307 (Roadmap actions), #306 (Approvals)

