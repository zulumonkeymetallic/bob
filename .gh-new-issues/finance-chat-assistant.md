Title: Finance · Chat Assistant for Spend Decisions + Budget Guidance

Description
- Add a Finance Chat interface (web + mobile) to interact with spending data: “What should I spend this week?”, “How much can I allocate to groceries?”, “Is my YouTube Premium subscription worth it?”.
- The assistant summarises current position (income vs. spend, by Theme and category), highlights subscriptions and anomalies, and proposes actions (adjust budget, transfer to Pot, cancel/keep subscription).
- All assistant suggestions are actionable: Approve to update budgets, create tasks, or schedule a review block in calendar.

Acceptance Criteria
- [ ] New `FinanceChatModal` accessible from Finance dashboard and sidebar; logs to `/finance_chats/{uid}/messages`.
- [ ] Gemini-backed function `sendFinanceChatMessage` returns JSON `{ reply, actions: [...], proposed_budget?: {...} }`.
- [ ] Assistant can:
  - Summarise this week/month spend by Theme and top merchants.
  - Identify subscriptions due next week and propose keep/cancel review tasks.
  - Recommend a weekly spending envelope per Theme based on recent pace and budgets.
  - Create tasks in backlog (entry_method: finance_ai) and/or schedule a “Money Review” calendar block.
- [ ] Clicking “Approve” on assistant actions performs the change (budget update, task create, block scheduling) and logs to activity stream.
- [ ] Deep links provided to merchants, transactions, and budget settings.

Technical Plan
- UI:
  - Add `FinanceChatModal.tsx` patterned after `GoalChatModal` with finance-specific starter prompts.
  - Entry points: Finance Dashboard header button and Global Sidebar when viewing Finance entities.
- Cloud Functions:
  - `sendFinanceChatMessage` (Gemini):
    - Build context from `/monzo_transactions`, `/monzo_pots`, and analytics (recent month totals, top merchants, net cashflow).
    - Constrained JSON schema with list of `actions`: `create_task|update_budget|schedule_block|tag_transaction|open_merchant_mapping`.
    - On approved actions, call existing helpers: create tasks, apply calendar blocks, or open Mapping UI.
- Budgets:
  - Store budgets by Theme/category in `/finance_budgets/{uid}` (if not already present).
  - Assistant proposals update these docs with `source: 'ai'`, `confidence_score`.
- Privacy & Safety:
  - Prompt contains only aggregated numbers and top-merchant names; never include raw account numbers.
  - All actions require explicit user approval in UI; no auto-apply.

Telemetry & Auditing
- Track message counts and accepted actions in `/ai_usage/finance/{uid}`.
- Activity entries for applied changes: `finance_ai_applied` with brief description and links.

Dependencies
- Requires `GOOGLEAISTUDIOAPIKEY` and Monzo OAuth connected.
- Reuses `computeMonzoAnalytics` outputs and `applyCalendarBlocks` for review sessions.

Out of Scope
- Cross-provider budgeting; focus is Monzo + platform budgets.

