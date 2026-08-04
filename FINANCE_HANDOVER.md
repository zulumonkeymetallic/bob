# BOB Finance — Session Handover

**Date:** 2026-08-04
**Branch:** `feat/finance-position-ledger` — **fast-forward merged into `main`** (§8)
**Deployed:** yes — web app live at commit `89357a45`, all finance/Monzo functions deployed
**Owner UID:** `3L3nnXSuTPfr08c8DTXG5zYX37A2`

---

## 1. Read this first

The original ask was a reconciled personal-finance coach: Monzo as the spine, a monthly
sheet of debts and assets, pensions, statement reconciliation, centralised dashboards,
and FIRE.

**The gap was never features. BOB modelled money *flows* well and money *positions* not
at all.** That framing drove everything below.

What is now true and was not before:

- Monzo is reconnected, syncing, and can renew itself (it could not — see §3)
- A monthly position ledger exists (`/finance/ledger`)
- One categorisation resolver replaced five that disagreed
- The dashboard shows one spend number instead of three
- An income→everything Sankey exists, including money into pots

**What is NOT trustworthy yet, and why, is §5. Start there.**

---

## 2. Verification commands

CI does **not** run these — `.github/workflows/ci.yml` is `name: CI (disabled)`,
`on: workflow_dispatch`. The only auto-triggered workflow runs Python pytest. Run them
yourself and state the output.

```bash
cd /Users/jim/git/bob/react-app && npx tsc --noEmit --skipLibCheck
```
```bash
cd /Users/jim/git/bob/react-app && CI=true npx react-scripts test --watchAll=false
```
```bash
cd /Users/jim/git/bob/functions && npx jest
```

Last known good: **react-app 450/450 (29 suites)**, **functions 137/137 (10 suites)**,
typecheck clean.

> `tsc --noEmit` was checking **nothing** until this session. TS5107 (the
> `moduleResolution` deprecation) is a *config-level* error and tsc stops before checking
> any source when config errors exist. Fixed with `ignoreDeprecations: "6.0"` in
> `react-app/tsconfig.json`. Verify it still works with a deliberate undefined-name probe
> before trusting a clean run.

**Deploy:** `./build web` (hosting → rules → indexes → functions). For functions only,
prefer targeted deploys — `index.js` exports 178 functions and a full deploy has hit the
Cloud Run CPU quota wall before (24 of 251 failed on 2026-08-03).

**Calling deployed callables as Jim** (used constantly this session to verify against real
data — local dev login does NOT authenticate to Firebase):

```python
import firebase_admin, json, urllib.request
from firebase_admin import credentials, auth
firebase_admin.initialize_app(credentials.Certificate('/Users/jim/.hermes/secret/bob.json'))
API_KEY = '<from react-app/src/firebase.ts, the "AIza..." value>'
custom = auth.create_custom_token('3L3nnXSuTPfr08c8DTXG5zYX37A2').decode()
r = urllib.request.Request(
    f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={API_KEY}',
    data=json.dumps({'token': custom, 'returnSecureToken': True}).encode(),
    headers={'Content-Type': 'application/json'})
tok = json.loads(urllib.request.urlopen(r).read())['idToken']
# then POST {"data": {...}} to
# https://europe-west2-bob20250810.cloudfunctions.net/<functionName>
# with Authorization: Bearer <tok>
```

---

## 3. What was fixed (all verified against the live account)

### Monzo was dead for 8 days and reported healthy

Four faults stacked, each hidden by the one in front. Worth reading because the same
patterns will recur.

1. **Non-confidential OAuth client** → Monzo issues refresh tokens only to *confidential*
   clients. Without one, the access token expired 2026-07-26 and nothing could renew it.
   `integration_status` recorded `lastErrorMessage: 'Missing Monzo refresh token'` while
   leaving `connected: true`, so every surface showed healthy. **Jim has since switched the
   client to Confidential.** `ensureMonzoAccessToken` now sets `connected: false` +
   `needsReauth: true` when there is no refresh token.

2. **OOM at 256MiB** — `monzoOAuthCallback` died on cold start. `index.js` is ~22k lines
   and every function in it loads the whole module tree before doing any work, arriving
   near 256MiB. **This bit three separate functions this session.** Raised ~15 Monzo/finance
   functions to 512MiB–1GiB. *Any other function in `index.js` remains exposed.*

3. **KMS never provisioned** — the callback exchanged the code, got a refresh token, then
   threw `MONZO_KMS_KEY not configured` while encrypting it. Worst possible failure point:
   Monzo authorisation codes are single-use, so every retry cost a full re-auth. Replaced
   with AES-256-GCM under a `MONZO_TOKEN_ENCRYPTION_KEY` Firebase secret (no gcloud, no KMS
   provisioning — `gcloud` auth on this Mac is expired and cannot refresh
   non-interactively). Ciphertext is prefixed `v1:`; bare base64 still routes to KMS, so
   KMS remains supported if `MONZO_KMS_KEY` is ever set.

4. **Monzo changed their API** — `refreshMonzoData` hardcoded `fullRefresh: true`, paging
   back to 2018. Monzo now returns
   `HTTP 400: The time range you have requested is too large`. Broke `syncMonzoNow`,
   `syncMonzoHourly` and `syncMonzoTwiceDaily` simultaneously. Now incremental by default.

Plus two more found while verifying:

- **`NaN` in the response** — a sync wrote 69 transactions and four balances successfully,
  then returned a bare 500 because one nested figure could not serialise
  (`Data cannot be encoded in JSON: NaN`). firebase-functions throws while encoding the
  *response*, after the handler has completed. Added `jsonSafe()` in `functions/index.js`.
  **Worth applying more widely** — any callable returning computed figures has this risk.

- **SCA 90-day limit** — outside ~5 minutes after authentication, Monzo tokens only reach
  90 days back; older requests return `HTTP 403: Verification required`. Three secondary
  accounts had no sync cursor so requested from 2018 and 403'd every run — **and that
  failure killed the whole sync including the personal account that was working.**
  Incremental syncs now floor `since` at 89 days; per-account errors are caught and
  recorded on `summary.accountErrors` rather than aborting.

### Other fixes

- **`lastSyncAt` read 2026-03-25 for four months** while transactions landed daily.
  `refreshMonzoData` — the function behind the hourly and twice-daily jobs — never called
  `updateMonzoIntegrationStatus` at all. Only the backstop and job paths wrote it, and the
  backstop's stamp sits *after* its sync call, which was OOMing. Now stamped in
  `refreshMonzoData`.
- **`fetchDashboardData` OOM** — read every one of 8,471 transactions unbounded on 256MiB.
  Now date-windowed in the query + 1GiB. Also required a new composite index
  `monzo_transactions (ownerUid ASC, createdISO ASC)` — the existing one was `DESC` and
  does not serve an ascending range scan.
- **Firestore indexes were never deployed.** `firebase.json` configured them; nothing
  deployed them. Added the step to `orchestrate-build.sh`. ⚠️ The first run reported
  **"Deleting 2 indexes"** — index deploys prune anything live but absent from
  `firestore.indexes.json`. Two console-created indexes are gone; they could not be
  identified (`gcloud` auth expired). Nothing observed broken, and a missing index fails
  loudly with a create-it-here link.
- **Categorisation precedence** — `analytics.js` ranked `aiBucket` above `userCategoryType`,
  so hand-corrected transactions reported under the AI's bucket in `monzo_budget_summary`
  (which feeds budget progress, the Monday email, the coach and the mobile tab).
- **Pot transfers counted as discretionary spend** — the guard was written as
  `if (categoryType === 'bank_transfer') continue;` *after* `coerceCategoryType`, which only
  ever returns one of four V4 values. It never fired.
- **Per-transaction overrides reverted every 15 minutes** — the sync writer overwrote
  `userCategoryType` from `merchant_mappings`; `monzoBackstopSync` runs every 15 min. Now
  skipped for rows with `manualCategory: true`.
- **`functions/.eslintrc.js` had no jest env** — every test file reported
  `describe`/`it`/`expect` as `no-undef` (23 phantom errors in `scoring.test.js` alone).
- **`functions/finance/dashboard.test.js`: all three tests were broken**, not one.
  `parseTransactionDate` never handled a plain `Date`, and fixtures passed pounds where the
  code expects pence.

---

## 4. What was built

### Monthly position ledger — `/finance/ledger`

The core new idea. **Two data points per account per month**: `valuePence` (current value /
statement balance) and `contributedPence` (cumulative net contributed). Return is derived,
never entered. Serves ISAs, pensions, GIAs and — with `apr` on the account — credit cards.

| Collection | Doc id | Purpose |
|---|---|---|
| `finance_ledger_accounts` | `{uid}_{accountId}` | Register: kind, side, apr, creditLimit, statementDay, includeInNetWorth/Fire |
| `finance_positions` | `{uid}_{accountId}_{YYYY-MM}` | One row per account per month |
| `finance_net_worth_history` | `{uid}_{YYYY-MM}` | Persisted rollup incl. FIRE |
| `finance_plan_assumptions` | `{uid}` | FIRE assumptions (per-user singleton) |

Conventions that are load-bearing:

- **Every money field is integer pence, named `…Pence`.** `monzo_pots.balance` is minor
  units, `finance_budgets_v2.monthlyIncome` is pounds, `finance_manual_accounts` stores
  both — do not copy any of those.
- **`valuePence` is always a magnitude**; `side` (derived from `kind`) supplies the sign.
- **Doc ids are deterministic**, so re-seeds, retries and the migration cannot double-count.
- **Phase 1 deliberately uses no composite queries** — see the index-deploy gap above.

Backend `functions/finance/ledger.js`: 7 callables + `financeMonthlyRollup`
(`0 3 1-3 * *` Europe/London — three-day window because deterministic ids make retries
free). `recomputeFinanceNetWorth` accepts `{dryRun: true}` — the safe way to check numbers
against production without writing.

`migrateManualAccountsToLedger` imports `finance_manual_accounts` and the orphaned
`finance_budgets_v2.debts[]` array (which carried APR that **no backend code ever read**).
Idempotent via `mig_{sha1}` ids. **The legacy assets register is still live and labelled
"Legacy" — it is the rollback path. Do not delete it until the ledger has been in use.**

### One bucket resolver

`functions/finance/bucketResolver.js` + mirror `react-app/src/utils/financeBuckets.ts`.
Replaced five disagreeing precedence chains.

```
1. pot transfer  2. userCategoryKey  3. userCategoryType
4. aiBucket      5. aiCategoryKey    6. defaultCategoryType   7. unknown
```

(2) outranks (3) deliberately: the key is a per-transaction *choice*, the type is rewritten
from `merchant_mappings` on every sync and is therefore a *rule*.

**V10 is canonical** (`CategoryBucket`, the 72 catalogue entries). V4
(`SAFE_CATEGORY_TYPES`) is only a projection for the legacy `monzo_budget_summary.totals`.
Both folds (`widenToV10`, `narrowToV4`) live in the resolver.

### Duplication is pinned by parity tests

The catalogue and the money maths each exist twice (CRA's `ModuleScopePlugin` blocks
importing from `functions/`). **`functions/` is the source of truth.**

- `financeBuckets.parity.test.ts` — reads `functions/finance/categories.js` with
  `fs.readFileSync`, asserts identical key/bucket sets (both at 72)
- `financeLedger.parity.test.ts` — **behavioural** parity: runs the same inputs through
  both `functions/finance/ledgerMath.js` and `utils/financeLedger.ts`. Jest *can* `require`
  across the boundary even though webpack cannot.

### UI

- **`BucketDonut`** — mandatory vs discretionary. Overview widget, mobile tab, dashboard.
- **`IncomeFlowSankey`** (`/finance/flow`) — income sources → Take-home → buckets →
  categories, plus pots and unallocated. Bucket nodes carry a **trailing space** so they
  cannot collide with a same-named category — that collision previously produced
  `Sankey is a DAG, the original data has cycle!`. There is a test asserting acyclicity.
- **Overview rebuilt** — ten equal cards → three headline (Spend / Discretionary as a share
  / Budget) + a compact drill-down chip strip. Every chart segment filters the transaction
  table and scrolls to it.
- **Deleted 4,984 lines** — `FinanceDashboardModern` (805, no route), `finance/BudgetSettings`
  (107, never rendered), `PotsBoard` (151, subset of `GoalPotLinking`), 3 `.backup` files.
  `/finance/pots` redirects.

### Actions engine

- **`assessRecurringActivity`** — a charge only qualifies as live if, over the last 6
  months, it appears in ≥5 of them AND in the most recent month, amounts within ±10% of
  the median, gaps within ±5 days. Fixes a CrossFit membership **cancelled in December
  2025** still being suggested for cancellation, because `merchantSummary.isRecurring` is
  an all-time flag with no recency test. 11 tests.
- **`dismissFinanceAction`** — writes a tombstone that `generateFinanceActionInsights`
  reads back and skips. Previously only `converted` was respected, so dismissals returned.
- Savings estimate capped at discretionary spend (it was claiming £1,339/month of savings
  against £1,242/month of total spend).

### FIRE

Default SWR is **3.5%, not 4%**. The Trinity Study's 4% was validated on a **30-year** US
horizon; retiring at 55 is 40–45 years. Raises the target ~14%. Per-user editable in
`finance_plan_assumptions`.

---

## 5. THE ACTUAL NEXT JOB — make the numbers trustworthy

Everything above renders correctly and displays data that **cannot yet be trusted**. Four
interdependent problems, all variants of *"stop counting the wrong thing as income or
spend"*. Do them as one block.

### 5.1 Personal vs business

Jim has a limited company, **JC1 LTD**, whose Monzo account is synced alongside his personal
one.

- **£37,039 of pots belong to JC1 LTD** (Tax Pot etc. — corporation tax/VAT). That is
  company money currently counted in personal savings and it would flow into net worth
  and FIRE.
- **JC1 LTD has zero transactions synced** — all 401 transactions in the last 90 days are
  the personal account. So BOB has company *balances* with no company *flows*.

Needed: tag every Monzo account personal or business; exclude business accounts and their
pots from personal net worth, savings rate and FIRE. **BOB already has a `persona` concept
(personal/work) to hang this on.**

### 5.2 Internal transfers

Money moving between two accounts Jim owns is neither income nor spend. `FROMMAINACCJD`
£418 is currently counted as income. Detect by matching amount + opposite sign + close
timestamp across owned accounts, and net them out.

### 5.3 Director's pay — the deliberate exception to 5.2

**JC1 LTD → personal *is* real personal income** (salary/dividend). It must survive the
internal-transfer netting and be classified as `net_salary` or a new `dividend` category.
This is the one crossing that counts.

### 5.4 Statement import — and a design trap

**42% of transactions are uncategorised**, and merchants masquerade as categories
(`PayPal`, `Lidl`, `Madigans Court`).

The worst of it is spend hidden behind payment rails. Over 90 days:

| Hidden behind | Spend |
|---|---|
| Barclaycard | £3,742.74 |
| Halifax | £662.56 |
| PayPal | £135.63 |
| **Total** | **£4,540.93** (~28% of £16,163 outflow) |

No categorisation logic can fix this — the information is not in Monzo, only on the
statement.

**The machinery already exists and has NEVER been used:**
`importExternalFinanceTransactions` (barclays/paypal/other) and
`matchExternalToMonzoTransactions`. Verified: `finance_external_transactions` = **0 docs**,
`finance_transaction_matches` = **0 docs**.

⚠️ **THE TRAP:** a matched statement line currently sits *alongside* the Monzo payment, not
instead of it. Importing naively **double-counts** — £3,742 as the Barclaycard payment in
Monzo *and* again as the underlying statement lines. For this to be trustworthy, matched
card payments must be **suppressed** from spend totals once statement lines are present,
with the statement lines becoming the source of truth. The card payment then becomes what
it is — debt servicing, not consumption. `recomputeDebtServiceBreakdown` was built for that
distinction but was never wired into the main aggregates.

**Jim must export the CSVs** (PayPal, Barclaycard, Halifax) — they are behind his logins.

---

## 6. Also outstanding

- **Full refresh is disabled**, not fixed. Backfilling history needs date-windowed requests
  under Monzo's range cap, and anything beyond 90 days only works **inside the ~5 minute
  post-auth window**. So backfill must be a deliberate, user-triggered operation run right
  after a reconnect — never something the hourly job attempts.
- **Payslip / gross pay / pension.** Monzo only ever sees **net** pay landing. Gross, tax,
  NI, employee and **employer** pension contributions are all invisible. Jim's income shows
  as a flat £5,084/month. His real savings rate is materially higher than BOB can compute,
  and employer contributions compounding into FIRE are entirely absent. Needs a monthly
  payslip row reconciled against the Monzo credit. `finance_ledger_accounts` already has
  `monthlyContributionPence` and `employerContributionPence` for pension accounts.
- **`build-logs/manifest.json` is unreliable** — `save_build_manifest` did not run on the
  last two `./build web` invocations despite everything deploying. There is also an
  `npm eresolve` peer-dependency error at the start of the build that the script carries on
  through.
- **`FinanceFlowDiagram`'s spend-only Sankey** still exists below the new one, with a
  hardcoded full-page dark gradient. Merging the two was deliberately not attempted.
- **The theme guard does not cover finance.** `scripts/check-no-color-literals.js` restricts
  scanning to an 8-file allowlist, so `FinanceDashboardAdvanced`'s hardcoded `THEME_COLORS`
  passes and new finance files get no enforcement.

---

## 7. Facts worth not rediscovering

- **Local dev login does not authenticate to Firebase.** "Sign In Locally" renders the shell
  but writes no auth token; every Firestore read fails `permission-denied` and the CRA error
  overlay covers the page and swallows clicks. Workaround that works: split fetch from
  render (page owns the callable, component takes pure props) and add `?demo=1` with a
  fixture — see `/finance/ledger?demo=1` and `components/finance/ledgerFixture.ts`.
  Remove the overlay with
  `document.querySelectorAll('iframe#webpack-dev-server-client-overlay').forEach(el => el.remove())`.
- **`computer` tool coordinates are screenshot pixels, not CSS pixels.** Take a screenshot
  first and scale, or clicks land on the wrong element and look like a broken handler.
- **`gcloud` auth is expired** and cannot refresh non-interactively. Blocks KMS provisioning
  and audit-log reads.
- **`convertFinanceActionToStory` writes `ref: FIN-${Date.now()}`**, violating the
  `{PREFIX}-{5 digits}` convention. Not fixed.
- **`fetchDashboardData` and `fetchFinanceEnhancementData` read every transaction doc.**
  The former is now date-windowed; the latter genuinely needs all history for coverage
  stats and runs at 1GiB. Do not copy the pattern.

---

## 8. Commits on this branch (newest first)

```
89357a45 feat(finance): income-to-everything Sankey, including money moved into pots
cfda867f fix(monzo): respect Monzo's 90-day SCA limit, and stop one account failing the sync
24728192 fix(monzo): a NaN in the response made a successful sync report as failed
0ca3299c fix(monzo): Monzo now rejects unbounded history requests, breaking every sync path
442a9687 fix(monzo): 256MiB across the sync path, and lastSyncAt that never updated
7bd8c331 fix(monzo): OAuth failed at the last step because KMS was never provisioned
c0259ced fix(monzo): OAuth callback was OOMing mid-exchange at 256MiB
10e80200 refactor(finance): rebuild the overview around a hierarchy instead of ten equal cards
4c9c8875 fix(finance): one spend number, live-only suggestions, permanent dismissals
b22dfa99 fix(finance): add the (ownerUid, createdISO ASC) index the new range query needs
82d6ffd4 fix(finance): dashboard was OOMing on every load — 256MiB against 8,471 transactions
f88fd384 feat(finance): category donut alongside buckets, and every chart segment drills into the table
bc194e66 feat(finance): mandatory-vs-discretionary donut, and delete 5k lines of dead finance code
9834fd69 feat(finance): Monzo balances, monthly rollup, and stop the connection rotting silently
ba123310 feat(finance): monthly position ledger, and one bucket resolver
```

Plus unrelated fixes carried on the same branch: `7824d382` (planner priority bonus
inverted), `ba8e9834` / `549ed9ac` (placeholder acceptance criteria).

**The 15 above are only the finance commits.** `feat/finance-position-ledger` was a
long-lived branch cut from `539c28c4` on 2026-08-01 and carried **48 commits** of all BOB
work — roadmap, kanban, delegation, sharing, and the Gen 1 → Gen 2 / Node 22 /
firebase-functions 6 / admin 13 functions migration (`f15b822b`). It has been
fast-forward merged into `main` and pushed; `main` and `origin/main` are level at
`56f91c01`. Pushing to `main` triggers `auto-deploy.yml`, which is **hosting only** — no
functions deploy, no index prune.

Original plan: `/Users/jim/.claude/plans/review-the-code-base-glowing-duckling.md`
