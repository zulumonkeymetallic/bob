Title: AI & Email Secrets Setup + Feature Flags Guide

Description
- Provide a concise guide and UI to verify/set required secrets (Gemini, Nylas) and feature flags for AI chat/orchestration/approvals.

Acceptance Criteria
- [ ] Docs page summarizing secrets: GOOGLEAISTUDIOAPIKEY, NYLAS_API_KEY, APP_BASE_URL, GITHUB_TOKEN.
- [ ] Settings toggles per profile: `calendarPlannerEnabled`, `calendarPlannerApprovalRequired`, `financeAiEnabled`, `audioGoalChatEnabled`.
- [ ] Quick test buttons to send test email and run a sample LLM call.

Technical Plan
- Docs: add to README/Settings page; optional admin UI to ping functions.
- Functions: small diagnostics callable to validate secrets and return status.

