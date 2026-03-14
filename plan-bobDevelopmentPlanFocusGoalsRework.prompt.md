# BOB Development Plan — Focus Goals Rework (12 Mar 2026)

## TL;DR: Focus Goals Vision-First Wizard + Time-Based Goals + Unaligned Banner + KPI Design

Comprehensive rework of Focus Goals feature to:
1. **Wizard UX**: Vision text **first** (step 1) → goal selection (step 2) → goal types (step 3) → timeframe → review → confirm
2. **Goal Types**: Support both **story-based goals** (need Sprint stories) and **time-based goals** (just calendar blocks + KPIs)
3. **Firestore Error Fix**: Sanitize undefined fields in where() clauses (affects autoCreateStoriesForGoals, autoCreateSavinsPots)
4. **Monzo Pots**: User manually creates in Monzo app with goal ref → BOB shows prompt + auto-link on next refresh via backend watcher
5. **Unaligned Stories Banner**: Show stories in active sprint not tied to current focus goals (3 locations: Focus Page + Sprint Table + Dashboard)
6. **KPI Design Integration**: Link from wizard review → separate KPI Designer page (support data-based KPIs like body fat %, distance, etc.)

---

## Phase 1: Foundation Fixes (Can run in parallel)

### 1A. Fix Firestore undefined error in autoCreateStoriesForGoals + autoCreateSavinsPots
- **File**: [react-app/src/services/focusGoalsService.ts](react-app/src/services/focusGoalsService.ts)
- **Root cause**: In `autoCreateStoriesForGoals` line ~110-116, if `goal` is undefined or `goal.id` is undefined, the `where('goalId', '==', goal.id)` clause passes undefined to Firestore, causing error: `Failed to create stories/buckets: Function where() called with invalid data. Unsupported field value: undefined`
- **Fix**: After fetching goals, filter out undefined entries; validate `goal.id` before using in where() clauses
- **Also check**: In `autoCreateSavinsPots`, validate `goal?.id` before where() query
- **Specific changes**:
  - Line ~103: Filter goals to remove undefined: `const goals = (await Promise.all(...)).filter(Boolean)` 
  - Line ~110: Add guard before where clause: `if (!goal?.id) continue;`
  - Line ~144: Add guard in autoCreateSavinsPots: validate goal.id before getDocs query

### 1B. Add story vs. calendar-time goal selector to Goal type
- **File**: [react-app/src/types.ts](react-app/src/types.ts) — update Goal interface
- Add new field: `goalRequiresStory?: boolean = true` (default true for backward compatibility)
- If false → goal expects only calendar time + optional KPIs, no sprint story creation
- This will be user-selected during focus wizard step 3

### 1C. Add goal ref tracking for Monzo manual creation
- **File**: [react-app/src/types.ts](react-app/src/types.ts) — update Goal interface
- Add new field: `monzoPotGoalRef?: string` (user-provided ref for manual pot creation)
- Add new field: `monzoPotId?: string` (auto-populated on next sync when pot found with matching ref)
- Backend watcher listens for goals with `monzoPotGoalRef` set but `monzoPotId` empty, then watches Monzo API for pots with that ref

---

## Phase 2: Wizard Rework (Core UX Change)

### 2A. Restructure wizard steps — Vision First
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- **Current** (5 steps): select → timeframe → vision → review → confirm
- **New** (6 steps): `vision` → `select` → `goalTypes` → `timeframe` → `review` → `confirm`

**Step breakdown:**
- **Step 1 (Vision)**: User enters vision text, loads intent prompts, can optionally run intent matching
- **Step 2 (Select)**: Shows goal list (filtered/sorted), multi-select with checkboxes, search by title
- **Step 3 (GoalTypes)**: NEW — For each selected goal, ask: "Needs Sprint story?" vs "Just calendar time?" 
  - Store selections in state: `goalTypeMap: { [goalId]: 'story' | 'calendar' }`
  - Calendar-time goals will skip auto-story creation
- **Step 4 (Timeframe)**: Choose sprint/quarter/year
- **Step 5 (Review)**: Show what will be created (stories for story-type goals, KPI link prompt) + KPI Designer link
- **Step 6 (Confirm)**: Final review, save

### 2B. Update handleNext() logic for new flow
- Remove auto-story/bucket creation from vision→review transition
- Move auto-creation to review→confirm transition (after user confirms, not during step change)
- Only auto-create stories for goals where `goalTypeMap[goalId] === 'story'`
- Skip story creation for calendar-time goals

### 2C. Update state variables
- Add: `goalTypeMap: { [goalId: string]: 'story' | 'calendar' }`
- Add: `selectedGoalsData: { [goalId: string]: { title, theme, requiresStory } }` (for display)
- Update: `goalsNeedingStories` computed filter to check both "has no story" AND `goalTypeMap[id] === 'story'`

### 2D. Add GoalTypes step UI component
- Render selected goals with radio buttons: "Story-based (will create Sprint story)" vs "Calendar-time (just events + KPIs)"
- Show goal details (theme, cost, etc.) to help user decide
- Save selections to `goalTypeMap`

---

## Phase 3: Monzo Pot Manual Creation Flow

### 3A. Update autoCreateSavinsPots to show prompt instead of API call
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- Change behavior: Instead of calling `createMonzoPotForGoal` HTTPS function, show user a prompt
- Prompt text: "For goal '[Goal Title]' (~£{estimatedCost}), create a Monzo pot manually and use ref: **{goalRef}** to enable BOB to auto-link it on next sync."
- goalRef = `GOAL-{goalId}` or similar (deterministic format)
- Provide copy button for ref + link to Monzo app
- User creates pot manually in Monzo, BOB saves `monzoPotGoalRef` to goal doc
- Backend watcher (in Cloud Functions) periodically checks for goals with `monzoPotGoalRef` set but `monzoPotId` empty, calls Monzo API to find pot with matching ref, links it

### 3B. Update FocusGoal type to track monzoPotGoalRefs
- Add: `monzoPotGoalRefs?: { [goalId: string]: string }` into FocusGoal document
- Saves ref mappings so history is preserved

### 3C. Add backend watcher (Cloud Functions)
- **File**: [functions/index.js](functions/index.js) or new file [functions/monzoPotLinker.js](functions/monzoPotLinker.js)
- Trigger: `onCreate('goals')` or scheduled function every 5 min
- Logic:
  1. Find goals where `monzoPotGoalRef` is set and `monzoPotId` is empty
  2. For each, query Monzo API for pots where name/description contains the ref
  3. If found, update goal: `monzoPotId: potId, monzoPotLinkedAt: serverTimestamp()`
  4. Log match or timeout after 24h
- This is background sync; user sees "Pending pot link" status until linked

---

## Phase 4: Unaligned Stories Banner

### 4A. Add banner to FocusGoalsPage
- **File**: [react-app/src/components/FocusGoalsPage.tsx](react-app/src/components/FocusGoalsPage.tsx)
- Show when: `activeFocusGoals.length > 0` (active focus period exists)
- Query: Stories in `currentSprint` (where sprintId matches active sprint) that are NOT in `activeFocusGoals[*].goalIds`
- Display: Alert/banner listing unaligned story refs, titles, associated goal ID (if any)
- Action: "Align to focus" link → opens story ref quick editor or removes from sprint
- Logic:
  ```
  unalignedStories = sprint.stories.filter(s => 
    !activeFocusGoals.some(fg => fg.goalIds.includes(s.goalId))
  );
  ```

### 4B. Add filter badge to Sprint Table
- **File**: [react-app/src/components/ModernKanbanPage.tsx](react-app/src/components/ModernKanbanPage.tsx) or Sprint view
- Add toggle: "Show unaligned stories only" (if active focus exists)
- Highlight or filter-display unaligned story rows
- Same query logic as 4A

### 4C. Add widget to Dashboard
- **File**: [react-app/src/components/Dashboard.tsx](react-app/src/components/Dashboard.tsx)
- New card: "Focus Alignment Status"
- Show: X unaligned stories in current sprint (if active focus exists)
- Show: Y total stories in focus goals, Z% completion
- Link to "View details on Focus page"

---

## Phase 5: KPI Design Integration

### 5A. Create KPI Designer modal/page
- **New file**: [react-app/src/components/KPIDesigner.tsx](react-app/src/components/KPIDesigner.tsx)
- Purpose: Design KPIs for goals (health-based, metric-based, progress-based)
- Features:
  - KPI type selector: "Health Metric" (body fat %), "Calendar Event" (triathlon hours), "Progress" (story points done %), "Manual Entry" (user-tracked)
  - For Health Metrics: Data source (HealthKit field, e.g., bodyFat%), baseline, target, frequency (weekly/biweekly), trend tracking
  - For Calendar: Event pattern, target hours/count per week
  - For Progress: Goal completion %, story points closed
  - Save KPI to `goal.kpisV2[]` array (use existing KPI schema if available, or extend Goal type)
- Used by: FocusGoalWizard review step (link to KPI Designer)

### 5B. Link KPI Designer from wizard review step
- **File**: [react-app/src/components/FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx)
- In review step UI, show: "Add KPIs to track progress" button
- Opens KPIDesigner modal (or navigates to separate page with back link)
- Allows user to set KPIs for selected goals before confirming focus
- Returns to wizard review on save

### 5C. Add KPI chart display to FocusGoalCountdownBanner
- **File**: [react-app/src/components/FocusGoalCountdownBanner.tsx](react-app/src/components/FocusGoalCountdownBanner.tsx)
- Fetch KPI data for active focus goals from `goal_kpi_metrics/{uid}_{goalId}`
- Display mini-charts: body fat trend (weekly), calendar hours logged, progress %
- Show baseline vs current vs target
- Use existing health KPI display patterns (see FitnessKPIDisplay.tsx)

### 5D. Backend KPI sync (if not already done)
- **File**: [functions/fitnessKpiSync.js](functions/fitnessKpiSync.js) or nightly function
- Ensure goal KPIs are synced from HealthKit/Strava nightly
- Create `goal_kpi_metrics/{uid}_{goalId}` docs with:
  - `goalId, ownerUid, dataType (bodyFat, distance, workoutMinutes, etc.)`
  - `weeklyValues: [ { weekStart: Date, value: number, trend: % } ]`
  - `currentValue, baselineValue, targetValue, progressPct`
  - `updatedAt: serverTimestamp()`

---

## Phase 6: Verification & E2E Testing

### 6A. Unit tests for Firestore undefined fix
- Test `autoCreateStoriesForGoals` with goal list containing undefined entries
- Test `autoCreateSavinsPots` with goals missing `id` field
- Verify no "Unsupported field value: undefined" errors

### 6B. Integration test for wizard flow
- Create test with: 1. Enter vision → 2. Select 3 goals → 3. Choose goal types (2 story, 1 calendar) → 4. Pick sprint timeframe → 5. Review + add KPI → 6. Confirm
- Verify: Only 2 stories auto-created, Monzo pot ref shown for cost goal, focus goal doc saved with correct goalTypeMap

### 6C. Manual test: Unaligned banner
- Create active focus goal with 2 goals
- Add story to sprint that has goalId NOT in focus goals
- Verify banner shows on FocusGoalsPage, Sprint Table, Dashboard
- Click "Align to focus" and verify story goalId updates

### 6D. Manual test: KPI Designer
- Open FocusGoalWizard → review step → click "Add KPIs"
- Create health KPI (body fat 0.25% weekly drop)
- Create calendar event KPI (triathlon: 8 hours cycling weekly)
- Save and return to wizard
- Verify KPI data persists on focus goal creation

---

## Relevant Files

- [FocusGoalWizard.tsx](react-app/src/components/FocusGoalWizard.tsx) — Wizard step flow, UI, state management
- [focusGoalsService.ts](react-app/src/services/focusGoalsService.ts) — Story/pot auto-creation, undefined fix
- [FocusGoalsPage.tsx](react-app/src/components/FocusGoalsPage.tsx) — Banner addition, unaligned stories filter
- [types.ts](react-app/src/types.ts) — Goal type update, FocusGoal update
- **NEW** [KPIDesigner.tsx](react-app/src/components/KPIDesigner.tsx) — KPI design modal/page
- [Dashboard.tsx](react-app/src/components/Dashboard.tsx) — Dashboard widget for focus alignment
- [FocusGoalCountdownBanner.tsx](react-app/src/components/FocusGoalCountdownBanner.tsx) — KPI chart display
- [functions/index.js](functions/index.js) — Monzo pot linker watcher function (new or added)

---

## Decisions & Constraints

- **Vision-First UX**: Changes step order significantly; may confuse existing users if feature already released. Recommend soft launch / feature flag if in prod.
- **Story vs. Calendar Toggle**: Added at step 3; user must make explicit choice per goal. Provides clarity but adds slight friction.
- **Monzo Manual Creation**: Defers from wizard to background sync; simplifies auth flow but adds async uncertainty (~5 min delay for link).
- **Unaligned Banner**: 3 locations may feel redundant; can start with FocusGoalsPage only if needed.
- **KPI Designer**: Separate page/modal prevents wizard bloat but adds navigation context switch. User must abandon/complete wizard to edit KPIs.
- **Backward Compat**: Existing focus goals without `goalTypeMap` will default to story-based (safe fallback). KPI data optional.

---

## Further Considerations

1. **How should "calendar-time goals" show on roadmap/sprint views?** — Should they appear as "Time Blocks" rather than "Stories"? Or display differently?
2. **Should Monzo pot creation be optional or required for cost goals?** — Currently optional (prompt shown, user can skip). Should we enforce?
3. **KPI Designer — should it save KPIs immediately or require wizard confirmation?** — Currently scoped as separate page which auto-saves; is that correct?

---

## Next Steps

- [ ] Phase 1A: Fix Firestore undefined error
- [ ] Phase 1B: Add goalRequiresStory field to Goal type
- [ ] Phase 1C: Add Monzo pot ref tracking fields
- [ ] Phase 2A-D: Restructure wizard UI (vision first)
- [ ] Phase 3A-C: Implement Monzo manual creation flow + backend watcher
- [ ] Phase 4A-C: Add unaligned banner to 3 surfaces
- [ ] Phase 5A-D: Create KPI Designer + integration
- [ ] Phase 6A-D: Verification & testing
