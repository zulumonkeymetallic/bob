Title: EPIC · Finance AI: Monzo LLM Categorisation + Spend Advisor Chat

Overview
Deliver an AI-powered finance loop: auto-categorise Monzo transactions into themes (with subscription detection), then guide spending decisions via a Finance Chat assistant. All suggestions are explicit, traceable, and opt-in.

Scope
- LLM auto-categorisation for Monzo (type, label, theme, subscription cadence) with privacy-preserving prompts and confidence tracking.
- Finance Chat assistant for budget guidance and approvals; produces actionable changes (budgets, tasks, calendar review blocks) on approval.

Links
- Child: “Finance · LLM Auto-Categorisation (Themes + Subscriptions) for Monzo” (.gh-new-issues/monzo-llm-auto-categorisation.md)
- Child: “Finance · Chat Assistant for Spend Decisions + Budget Guidance” (.gh-new-issues/finance-chat-assistant.md)

Milestones
- M1: LLM classification (rules + Gemini) and analytics updates.
- M2: Finance Chat modal, starter prompts, and approve actions.
- M3: UX polish, confidence review queue, and telemetry dashboards.

Risks & Mitigations
- Privacy: minimise prompt content; document data handling; allow opt-out.
- Misclassification: confidence gating + rule precedence + user overrides.
- Drift: nightly backfill + quick reclassify button on merchant.

