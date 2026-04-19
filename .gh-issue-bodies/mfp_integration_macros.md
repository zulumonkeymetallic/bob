**Description**
Pull MyFitnessPal nutrition data and show a macro adherence dashboard; surface nudges in Priorities when off-track and optionally create micro-tasks (e.g., “Add 30g protein snack”).

**Acceptance Criteria**
- [ ] Daily macro targets (protein/carbs/fat, kcal) defined in BOB (or computed from body weight/goals).
- [ ] MFP data ingested daily (and on-demand) for meals and totals.
- [ ] Dashboard shows Today and 7/30-day trends, adherence %, and deficits/excesses.
- [ ] When off-track by threshold, BOB can suggest or create a micro-task and/or calendar block (optional).
- [ ] Privacy controls to enable/disable nutrition data and delete history.

**Proposed Technical Implementation**
- **Ingestion:** n8n workflow using MFP API or email/export parser → Firebase Function normaliser.
- **Schema:** `/health/mfpDaily/{yyyy-mm-dd}` with totals and per-meal breakdown; `/health/targets` for macro goals.
- **Computation:** `computeMacroAdherence()` writes `{adherencePct, deficitByMacro, suggestion}` to `/health/insights/{date}`.
- **UI:** `HealthDashboard` (Recharts) with Today ring, trend lines, and macro bars; drill-down to meals.
- **Nudges:** write suggested tasks to `/tasks` tagged `health`; optional “auto-create calendar snack block”.
