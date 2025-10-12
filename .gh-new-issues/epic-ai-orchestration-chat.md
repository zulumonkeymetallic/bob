Title: EPIC · AI Orchestration & Chat: Goal Intake → Research → Stories/Tasks → Calendar

Overview
Unify AI-driven planning from a single goal-centric chat. Start with intake chat, ask clarifying questions, optionally run deep research, create stories/tasks, and manage calendar blocks and reminders. Include nightly approvals and planner previews.

Objectives
- Chat-first goal intake (web/mobile) with suggested actions.
- Orchestration at goal and story level (research → stories/tasks → schedule).
- Calendar management: plan blocks, approvals flow, and preview warnings.
- Backlog/sprint integration: auto-assign AI-created work to active sprint.
- Research docs: in-app viewer and re-run.
- Guardrails: chat summarization/token control.
- Finance loop (parallel track): LLM categorisation + spend advice chat.

Acceptance Criteria
- End-to-end: from FAB intake chat to scheduled blocks with deep links and reminders for short tasks.
- Approvals: visible badge and Approvals Center with latest proposal.
- Story-level orchestration available from story actions.
- Research viewer available in the goal sidebar with re-run.
- Planner preview clearly surfaces errors/warnings.
- Guardrails for long chats; moderation applied.

Child Issues (initial set)
- Core chat/orchestration/planner
  - #319 FAB · AI Goal Intake Chat (Create → Clarify → Orchestrate)
  - #309 AI Goal Chat: Clarifications + Suggested Tasks
  - #305 AI Goal Orchestration: Research → Stories/Tasks → Schedule
  - #331 AI Story Orchestration: Sub-Goal Research → Tasks → Schedule
  - #328 Planner · Pending Approvals Badge + Approvals Center
  - #332 Planner · Preview Errors/Warnings surfaced in UI
  - #329 Goal Research Docs Viewer + Re-run AI Research
  - #321 Auto-assign Orchestrated Work to Active Sprint
  - #330 AI Goal Chat · Session Summarization + Token Guardrails
  - #333 AI & Email Secrets Setup + Feature Flags Guide
- Finance (parallel)
  - #316 Finance · LLM Auto-Categorisation (Themes + Subscriptions) for Monzo
  - #317 Finance · Chat Assistant for Spend Decisions + Budget Guidance
  - #318 EPIC · Finance AI

Non-goals
- Cross-organization collaboration, full blown budgeting projections (separate epic).

Notes
- Existing PR #322 adds chat actions, approvals page, and intake entry. Follow-up PRs will close the gaps above.

