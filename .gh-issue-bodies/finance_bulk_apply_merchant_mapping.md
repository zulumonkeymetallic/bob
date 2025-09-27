**Title**
Bulk-apply Merchant → Category mapping to recent transactions (backfill userCategory)

**Description**
Implement a safe, idempotent backfill that applies the saved Merchant → Category rules to recent Monzo transactions by writing `userCategoryType` and `userCategoryLabel` where missing. Provide a UI control to run this backfill (with scope options and a dry‑run preview) and then recompute analytics so dashboards update immediately.

**Acceptance Criteria**
- [ ] Button on Merchant Mapping page: “Apply mapping to transactions…”.
- [ ] Scope options: last 30 days (default), last 90 days, all time.
- [ ] Dry‑run preview shows how many transactions will be updated and top 10 sample rows.
- [ ] Execute backfill updates only transactions for the signed‑in user (ownerUid), where `userCategoryType` is not set.
- [ ] For each eligible transaction, set both `userCategoryType` and `userCategoryLabel` using merchantToCategory rules (case-insensitive match on merchant name).
- [ ] On completion, trigger analytics recompute; dashboards reflect new categories.
- [ ] Idempotent: reruns do not create duplicates or regress already user‑assigned categories.
- [ ] Progress feedback and error handling visible in UI.

**Detailed Steps**
1. UI (FinanceMerchantMapping.tsx)
   - Add dialog with scope selector: 30/90 days or all.
   - “Preview” calls callable function with `dryRun: true` → returns counts + sample.
   - “Apply” calls same function `dryRun: false` → runs updates, returns summary.
2. Backend Function (callable)
   - Name: `applyMerchantMapping`.
   - Auth required; uses req.auth.uid.
   - Input: `{ scope: '30d'|'90d'|'all', dryRun?: boolean }`.
   - Query `monzo_transactions` for ownerUid, createdAt within scope.
   - Filter where `userCategoryType` is null/absent.
   - For each tx: compute merchant key (merchant.name || description).toLowerCase(); lookup in finance_mapping.merchantToCategory.
   - If match: (dry-run) collect sample; else (apply) batch.set `userCategoryType`, `userCategoryLabel`, `updatedAt`.
   - Pagination: process in batches of 300 to respect write limits; loop until done.
   - Return `{ updated, skipped, sample: [...] }`.
   - After apply, call existing `computeMonzoAnalytics` or enqueue recompute job.
3. Logging
   - Write integration/activity logs with counters `{ updated, skipped, scope }`.
   - On error, write webhook_logs with details.
4. Security
   - Ensure ownerUid scoping via Firestore queries and server checks.

**Proposed Technical Implementation**
- New callable: `applyMerchantMapping` in functions/index.js.
- UI Dialog in FinanceMerchantMapping.tsx with preview/apply states; use Toast/Alert for summaries.
- Batch writes with 300 doc chunks; set a serverTimestamp `updatedAt`.
- After apply, call `recomputeMonzoAnalytics` function to refresh summaries.

**Out of Scope**
- Migrating historical exports or external providers; this is Monzo only.

