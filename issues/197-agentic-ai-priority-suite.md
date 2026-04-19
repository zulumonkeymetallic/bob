# 197 – Agentic AI priority & scheduling suite

- Type: epic
- Priority: P0
- Areas: Scheduler, AI, Email, Calendar

## Scope
- Surface daily priorities from the deterministic planner + AI re-ranking directly in the dashboard and backlog.
- Close the loop between calendar blocks and task assignments (auto-reschedule gaps, flag overbooked days).
- Ship production daily digest emails (Mailjet) summarising priorities, calendar, weather, and news.

## Deliverables
1. **Priority surfacing** – expose `importanceScore` / `isImportant` outputs in dashboards and mobile, with explainability.
2. **Calendar vs plan alignment** – automatically block time for high-importance tasks, detect conflicts, and offer one-click fixes.
3. **Daily digest** – send reliable Mailjet digests each morning with AI summary plus next actions, leveraging the new callable.

## Notes
- Dependent on stable `buildPlan` scoring; may require lightweight LLM re-ranking within deterministic guardrails.
- Consider feature flags per persona to stage rollouts.
