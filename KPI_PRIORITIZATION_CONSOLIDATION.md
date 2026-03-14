# KPI And Prioritization Consolidation

## What was duplicated

1. KPI storage split across legacy `goal.kpis` and newer `goal.kpisV2`.
   - Result: the old designer only appended a minimal legacy object, while newer sync/charting code expected richer metadata.
   - Fix direction: treat `kpisV2` as canonical and only project a compatibility subset into `kpis`.

2. KPI design UX existed in two separate places.
   - Live app: `/Users/jim/GitHub/bob/react-app/src/components/KPIDesigner.tsx`
   - Figma/prototype workspace: `/Users/jim/GitHub/bob/KPI Designer and Dashboard Integration/`
   - Result: the shipped UI lagged behind the richer source-mapping/dashboard concepts already explored in the prototype.
   - Fix direction: pull source, metric, visualization, and traceability concepts into the live React app instead of maintaining a parallel demo.

3. Dashboard surfaces are fragmented.
   - There are multiple dashboard-era components (`Dashboard.tsx`, `NewDashboard.tsx`, `Dashboard-New.tsx`, `Dashboard-Simple.tsx`, `MobilePriorityDashboard.tsx`).
   - Result: KPI visibility and prioritization logic risk being reimplemented per surface.
   - Fix direction: add reusable widgets and utilities to the live `Dashboard.tsx` path and keep new logic out of legacy variants.

4. Prioritization and deferral heuristics are spread across several layers.
   - Backend scoring and top-3 selection in `functions/nightlyOrchestration.js`
   - Date suggestion callable in `functions/deferralSuggestions.js`
   - Capacity calculations in `functions/capacityPlanning.js`
   - Dashboard/UI-specific ranking in multiple components
   - Result: score, focus-alignment, and capacity reasoning were not expressed in one reusable client-side model for “what should move out of this sprint?”
   - Fix direction: keep authoritative scoring in backend orchestration, but centralize dashboard defer recommendations in one UI utility.

## What this change set establishes

1. Canonical KPI authoring path
   - `react-app/src/components/KPIDesigner.tsx`
   - `react-app/src/utils/kpiDesignerCatalog.ts`
   - `react-app/src/utils/kpiPersistence.ts`

2. Canonical dashboard KPI surface
   - `react-app/src/components/KpiDashboardWidget.tsx`
   - Integrated into the live dashboard widget grid in `react-app/src/components/Dashboard.tsx`

3. Canonical client-side defer recommendation logic
   - `react-app/src/utils/prioritizationInsights.ts`
   - Reused by the dashboard KPI widget for “defer to next sprint” recommendations

## Recommended next consolidation steps

1. Remove or archive unused dashboard variants once the live dashboard fully replaces them.

2. Move item-specific defer option generation in `functions/deferralSuggestions.js` to use the same shared concepts:
   - focus alignment
   - AI criticality
   - sprint over-capacity
   - next sprint availability

3. Add a small backend mirror for pinned KPI dashboard widgets if profile-level widget persistence becomes a product requirement.

4. Extend `goal_kpi_metrics` generation so non-fitness KPI types write resolved metrics as consistently as the fitness path already does.
