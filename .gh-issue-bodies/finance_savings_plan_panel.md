**Title**
Dedicated Savings Plan panel: per‑goal required/month, ETA, and roll‑up vs savings pace

**Description**
Add a dedicated Savings Plan UI to the Finance Hub that translates goal costs and pot balances into concrete monthly targets per goal based on target dates. Provide a roll‑up view that compares the total required/month to the user’s average monthly savings pace and flags any shortfall. Include a simple visual (bar/list) plus deep links to goals and pots.

**Acceptance Criteria**
- [ ] Per‑goal row shows: Goal title, Theme, Shortfall (EstimatedCost − PotBalance), Required per month (Shortfall ÷ months to target date), and Projected completion date.
- [ ] Roll‑up shows “Total Required / month” and compares to detected “Monthly Savings pace” with status: Achievable (>= pace) or Shortfall (< pace).
- [ ] Uses goal targetDate (if present). If no targetDate, show “—” and omit Required/month and ETA.
- [ ] Pulls pot balances from analytics alignment (theme/goal) and falls back to pot name matching when alignment is stale.
- [ ] Deep links: clicking goal opens goal details; clicking pot opens Monzo pot in Integrations (if available).
- [ ] Empty states are clear (no goals, no target dates, no analytics yet).
- [ ] Performance: panel loads under 300ms for 200 goals on a typical connection.

**Detailed Steps**
1. Data sources
   - monzo_goal_alignment.goals[]: { goalId, title, themeId, estimatedCost, potBalance }.
   - goals collection: targetDate (Timestamp), theme, estimatedCost (fallback if missing in alignment).
   - monzo_budget_summary.monthly[]: derive average monthly savings pace.
2. Computation
   - shortfall = max(estimatedCost − potBalance, 0).
   - monthsToTarget = months between now and goal.targetDate (ceil). If <= 0, treat as “—”.
   - requiredPerMonth = shortfall / monthsToTarget (round to whole currency); else “—”.
   - projectedDate = now + ceil(shortfall / monthlySavingsPace) months (only if pace > 0).
   - totalRequired = sum(requiredPerMonth for all goals with targetDate>now).
3. UI
   - Panel “Savings Plan” with a table (Goal | Shortfall | Required/mo | Status | ETA).
   - A roll‑up banner showing Total Required/mo vs Monthly Savings pace with Achievable/Shortfall badge.
   - Optional sparkline or mini bar for proportion of shortfall.
4. Edge cases
   - No alignment yet: compute pot by matching pot names with theme synonyms (Health, Growth, Finance & Wealth, Tribe, Home).
   - Missing targetDate: show row with Shortfall and “—” for Required/mo and ETA.
   - Zero savings pace: show informative hint to increase savings to meet goals.

**Proposed Technical Implementation**
- Component: FinanceSavingsPlan.tsx (lazy-loaded in Finance Hub), reusing hooks in FinanceDashboard for alignment and monthly pace.
- Utilities: helpers to compute months to target, per-goal required per month, and roll‑up.
- Styling: Bootstrap Card + Table; follow Finance dashboard style.
- Performance: memoize computations; limit Firestore reads; reuse existing listeners.
- Tests: snapshot unit test for computation helpers with edge cases.

**Out of Scope**
- Automated pot transfers. This panel is informational only.

