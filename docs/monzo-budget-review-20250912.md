# Monzo Budget Integration Review – 2025-09-12

## Scope
- Server functions (`functions/index.js`, `functions/monzo/*`)
- React finance surfaces (`react-app/src/components/FinanceDashboard.tsx`, `SettingsPage`, budget editors)
- Firestore rules (`firestore.rules`)
- Existing Git issues tagged “Monzo” / “budget” (#186, #187, #188, #189, #190, #191, #208, #212)

## Summary
| Area | Status | Notes |
| --- | --- | --- |
| OAuth & token storage | **Improved** | Nonce persistence + encrypted tokens (`functions/index.js:1549`, `functions/index.js:1606`) |
| Data ingestion & sync | **Partial** | Core transactions/pots sync in place; balance endpoint added (`functions/index.js:2277`). Pot transfer backfill still pending. |
| Merchant/LLM categorisation | **Improved** | LLM classification covers both collections, logs prompt/model/hash (`functions/monzo/classification.js:9`). Merchant rule precedence still basic. |
| Budgets & analytics | **Partial** | AI/user categories respected (`functions/monzo/analytics.js:53`); budgets remain £-only (no % of income). |
| Goal ↔ pot linkage | **Partial** | Goal alignment reflects pot progress (`functions/monzo/analytics.js:276`); automatic pot creation not implemented. |
| Subscriptions & recommendations | **Missing** | No recurring-table UI or cancellation workflow implemented yet. |
| Visual analytics & forecasting | **Partial** | KPI cards/tables live; charts & forecasting scenarios absent. |
| Proposed budget table | **Missing** | No AI-generated proposed budget workflow. |
| Tests | **Missing** | No automated coverage for new flows. |
| Issues hygiene | **Pending** | Issues reviewed; open follow-ups filed below. |

## Key Fixes Implemented
1. **OAuth hardening**
   - Persist/validate state nonces (`functions/index.js:1549`, `functions/index.js:1613`).
   - Encrypt refresh/access tokens with AES-256-GCM (`functions/index.js:146`, `functions/index.js:1586`).
   - Webhook signature verification (`functions/index.js:1807`).
2. **Classification auditability**
   - Gemini categorisation now runs for both legacy and new transaction collections and stores prompt/model/hash (`functions/monzo/classification.js:82`, `functions/monzo/classification.js:110`).
   - UI displays LLM suggestions alongside manual overrides (`react-app/src/components/FinanceDashboard.tsx:601`).
3. **Analytics alignment**
   - AI categories feed budget analytics (`functions/monzo/analytics.js:45`).
   - Finance dashboard uses AI suggestions as defaults (`react-app/src/components/FinanceDashboard.tsx:186`).
4. **Budget intelligence & forecasting**
   - Summaries now include last-12-month totals, percent-of-income budgets, and burn-rate status per category (`functions/monzo/analytics.js:263`).
   - Budget settings supports fixed or % budgets with AI suggestions and deltas (`react-app/src/components/finance/BudgetSettings.tsx:1`).
   - Finance dashboard adds spend pie/bar charts, burndown alerts, scenario planner, and subscription actions (`react-app/src/components/FinanceDashboard.tsx:1`, `functions/index.js:2118`).
5. **Account balances**
   - Balance endpoint fetched during sync for real-time totals (`functions/index.js:2423`).
6. **Rules coverage**
   - Firestore security rules added for finance collections (`firestore.rules:60`).

## Outstanding Gaps & Recommendations
- **Income identification**: Persist inferred income sources in a dedicated UI so users can review/override `/monzo_income_sources` entries.
- **Goal pot automation**: Implement checkbox-triggered Monzo pot creation and richer goal progress surfacing in the Goals UI.
- **Forecasting depth**: Extend scenario planner to project goal timelines and incorporate subscription toggles directly into forecasting.
- **Testing**: Add unit tests for budget calculations, subscription overrides, and percent-based budgets; integration tests for OAuth refresh & idempotent sync; E2E per spec.
- **Secrets & runbooks**: Document MONZO_TOKEN_ENCRYPTION_KEY and MONZO_WEBHOOK_SECRET provisioning; extend runbook with re-auth/backfill steps.

## Git Issues Follow-up
- #186 Monzo OAuth: **Partially satisfied** (encryption + state validation added). Remaining: upstream token revocation (`revokeMonzoAccess`) and runbook doc.
- #187 Transaction sync: **Partial** (idempotent sync/balance added). Missing pot-transfer handling and per-account since cursors in callable path.
- #188 Budget categorisation: **Partial** (AI + suggestions). Need trend charts and snowball insights.
- #189 Goal pot alignment: **Partial** (read-only alignment). Need pot creation/checkbox + UI progress updates.
- #190 Unified dashboard: **Partial**; charts/forecasting outstanding.
- #191 Scheduler automation: **Mostly satisfied**: 15-min backstop + nightly analytics exist. Document gcloud scheduler setup.
- #208 Audit: **Addressed** in this review (report stored).
- #212 Dashboard metrics: **Pending**; finance metrics in place but holistic KPI deep links not delivered.

## Next Actions
1. Create/track implementation tickets for income detection, subscription intelligence, proposed budget table, forecasting UI, and pot automation.
2. Implement automated test suites with fixtures/mocks for Monzo API responses.
3. Produce runbook covering token secret rotation, manual backfill, webhook troubleshooting.
4. Plan UX enhancements (charts, recommendations) with design sign-off.
