Title: Finance · LLM Auto-Categorisation (Themes + Subscriptions) for Monzo

Description
- Use Gemini to auto-categorise Monzo transactions into: type (mandatory|optional|savings|income|subscription) and theme (Health, Growth, Finance & Wealth, Tribe, Home).
- Detect recurring subscriptions (e.g., YouTube Premium, JustForFans, Netflix) and mark them as Subscription with cadence hints.
- Respect and learn from user overrides (merchant mappings) and never overwrite them. Store classifier confidence.
- Minimum-PII prompt: send only merchant name (normalized), amount, currency, and short description/scheme flags. No account numbers or tokens.

Acceptance Criteria
- [ ] New function `classifyMonzoTransactionsLLM` labels any unlabeled transactions since last run with: `aiCategoryType`, `aiCategoryLabel`, `aiThemeId`, `aiConfidence`.
- [ ] Subscription detector flags recurring merchants with `isSubscription: true`, `cadence: weekly|monthly|yearly|unknown`.
- [ ] User overrides (merchant_mappings) always win; AI labels applied only when `!userCategoryType`.
- [ ] Backfill job classifies last 90 days on first enable; nightly runs classify new transactions only.
- [ ] Dashboard in Finance shows: “AI Pending Classifications” with one-click accept or bulk accept; shows confidence and reasons.
- [ ] All writes include attribution fields: `source: 'ai'`, `entry_method: 'finance_ai'`, `confidence_score` (0..1).
- [ ] Privacy: redact Monzo raw fields from prompts; log prompt/response metadata only (no raw bank payloads).

Technical Plan
- Cloud Functions:
  - `classifyMonzoTransactionsLLM` (callable + nightly scheduler):
    - Query `/monzo_transactions` where `ownerUid == uid` and `!userCategoryType && !aiCategoryType` within time window.
    - Batch prompts to Gemini with a constrained JSON schema:
      `{ type: 'mandatory|optional|savings|income|subscription', label: string, theme_id: 1..5, is_subscription: boolean, cadence?: string, confidence: 0..1 }`.
    - Write results on transaction docs; compute `monthKey` if missing.
  - `recomputeMonzoAnalytics` re-uses existing pipeline to reflect new labels.
- Heuristics (pre-classification guards):
  - Merchant rules: normalize names and apply high-confidence mappings (e.g., `/asda/i -> Shopping`, `/youtube/i -> Subscriptions`).
  - If heuristic sets label/type/theme, skip LLM and mark `aiConfidence = 0.99` with `aiMethod = 'rule'`.
- Data Model (added fields on `/monzo_transactions/*`):
  - `aiCategoryType`, `aiCategoryLabel`, `aiThemeId`, `aiConfidence`, `aiMethod` ('llm'|'rule'), `isSubscription`, `subscriptionCadence`.
- UI:
  - Finance Dashboard: “AI Suggestions” table with accept/ignore; bulk actions; filter by confidence.
  - MerchantMappings page: add “Train AI” button to reclassify sample transactions for a merchant.
- Security:
  - Ensure Firestore rules allow only owner to see or modify finance docs.
  - Add `FINANCE_AI_ENABLED` feature flag on profile.

Telemetry & Auditing
- Store aggregate counters in `/ai_usage/finance/{uid}`: prompts, tokens, accepted, overridden.
- Log traces in `/logs/ai_finance` with minimal input/output and hash of merchant for privacy.

Dependencies
- Secrets: `GOOGLEAISTUDIOAPIKEY` (Gemini), Monzo OAuth already configured.
- Libraries: reuse existing `callLLMJson` and `normaliseMerchantName` helpers.
- Indexes: `monzo_transactions.ownerUid + createdAt`, `ownerUid + aiCategoryType`.

Out of Scope
- Cross-bank aggregation; this issue is Monzo-only.
- Budget projection engine (covered by budget_engine_projections.md).

