# BOB Productivity Tool – Master Requirements (**Version 2.1.1 - CRITICAL DEFECTS IDENTIFIED! �**)

> **📋 CONSOLIDATED STATUS**: Version 2.1.0 deployed but critical issues discovered  
> **🎯 LIVE APPLICATION**: https://bob20250810.web.app  
> **📍 REFERENCE NUMBERS**: C17-C22 (New Critical), W1-W17 (Weekend), R1-R20 (Requirements)

## CRITICAL DEFECTS IDENTIFIED POST-2.1.0 DEPLOYMENT ⚠️
- 🔴 **C17: Emoji Display Issues** - Violates clean Material Design requirements
- 🔴 **C18: Red Circle Buttons Not Visible** - Critical functionality inaccessible  
- 🔴 **C19: System Status Dashboard** - Needs replacement with dev tracking-style dashboard
- 🔴 **C20: Cannot Delete Goals/Stories/Tasks** - CRUD operations incomplete, no delete functionality
- 🔴 **C21: Kanban Drag & Drop Still Broken** - Consider new library implementation
- 🔴 **C22: Tasks Not Visible Under Stories** - Hierarchical view missing in future Kanban rebuild

## IMMEDIATE PRIORITIES (Version 2.1.1)
1. **FIX C18: Red Button Visibility** - (1 hour) - Users cannot access critical functions
2. **FIX C20: Delete Functionality** - (2 hours) - Enable CRUD delete operations for all entities
3. **FIX C17: Remove Emojis** - (1 hour) - Clean Material Design compliance
4. **REPLACE C19: Dashboard** - (3 hours) - User-focused dashboard like dev tracking
5. **REBUILD C21: Kanban with new library** - (4 hours) - Working drag & drop + task visibility (C22)

## Version 2.1.0 Release Status - DEPLOYED BUT ISSUES FOUND ⚠️
- ✅ **Material Design UI** transformation complete
- ✅ **Cache-busting system** implemented and deployed  
- ✅ **Persona switcher** foundation with context management
- ✅ **Stories Kanban** structure with drag-drop persistence working
- ✅ **Tasks List** view (separate from Stories)
- ✅ **Modal functionality FIXED** - AddStoryModal, AddGoalModal fully working
- ✅ **CRUD operations WORKING** - Create/Edit/Delete fully functional via modals & FAB
- ✅ **Priority Pane IMPLEMENTED** - Top 5 tasks with smart scoring & scheduling
- ✅ **AI planning UI connected** - "Plan My Day" button links to existing functions
- ✅ **Goal progress bars WORKING** - Real-time updates from story completion
- ✅ **NEW: Personal Backlogs Manager** - Steam games, Trakt movies/shows, books, custom collections
- ✅ **NEW: Mobile Priority Dashboard** - Touch-optimized daily task management with device detection
- ✅ **NEW: Visual Canvas** - Interactive goal-story-task mind mapping with zoom/pan
- ✅ **FIXED: Dark mode table styling** - All tables now properly styled for accessibility
- ✅ **ENHANCED: Drag & drop support** - Mobile touch events and enhanced handles
- ✅ **Device detection system** - Responsive UI adaptation for mobile/tablet/desktop

## NEW FEATURES DEPLOYED (Version 2.1.0)
1. ✅ **Personal Backlogs at /personal-backlogs** - Manage entertainment & learning collections
2. ✅ **Mobile Priorities at /mobile-priorities** - Auto-detected mobile-optimized interface  
3. ✅ **Visual Canvas at /visual-canvas** - Interactive project visualization with SVG mind mapping
4. ✅ **Enhanced dark mode** - Fixed white table backgrounds and gray text readability issues
5. ✅ **Improved mobile UX** - Touch-friendly interfaces with device-aware navigation

**Codename:** Gemini  
**Owner:** Jim Donnelly  
**Last Updated:** 2025-08-29 (Europe/London)  

---

## 0. Purpose & Audience
This document merges the **product requirements** and the **engineering blueprint** so another AI/development team can run a gap analysis directly against the codebase. It captures vision, personas, flows, data schemas, acceptance criteria, validator rules, and delivery milestones.

---

## 1. Vision & Personas
BOB (“Jake”) is a **personal + work life‑management platform** with an **agentic AI** that plans, prioritises, and schedules across two **personas** under one account:
- **Personal:** Goals → Stories → Tasks, Habits, Health, Finance.
- **Work:** Projects → Tasks (no goal linkage required).

**Key rule:** Tasks from both personas sync to iOS Reminders (two separate lists). All other artefacts remain persona‑scoped and never cross‑link.

**Persona UX**
- Global **Persona Switcher** (header): *Personal | Work* with distinct accent/badge.
- Switch cascades to boards, filters, reports, AI planner scope, imports/exports.

**Persona → iOS Lists**
- Personal → **“BOB – Personal”**
- Work → **“BOB – Work”**

**AI Planner scope**
- Runs per‑persona by default; cross‑persona scheduling (e.g., personal task during work hours) requires explicit confirmation.

---

## 2. Scope & Phases
**Phase 1 – Personal Productivity (MVP)**
- Personas, Goals/Stories/Tasks (Personal), Work Projects/Tasks (Work).
- Story **cannot** be marked Complete if any linked Task is open.
- Goal progress bar = (# stories Done / # stories total).
- Kanban (Stories) + **separate** Tasks List view.
- Agentic AI → writes **Google Calendar** blocks (iOS reflects via native sync).
- Daily Habits, HealthKit ingestion; basic Finance panel (CSV import).

**Phase 2 – Finance & Gmail**
- Finance dashboards (budgets, trends, alerts → tasks); Gmail AI triage & task extraction.

**Phase 3 – Smart Home**
- HomeKit/Nest/lights with context‑aware routines tied to schedule/recovery.

**Weekend Milestone (Focus)**
- Load **Goals from templates/CSV**.
- **Stories Kanban** + **Tasks List** (separate views; drill‑downs).
- Goal progress bars fed by Stories’ status.
- **Agentic AI scheduling to Google Calendar** (no iOS Reminders sync required yet).
- Persona switcher skeleton (scopes boards, not all reports).

---

## 3. Architecture Overview
- **Frontend (Web):** React + TypeScript, Tailwind + shadcn/ui, Vite.
- **iOS App:** Swift/SwiftUI, Firebase SDK, HealthKit, EventKit/Reminders.
- **Backend:** Firebase Auth, Firestore, Cloud Functions, Cloud Storage.
- **AI:** GPT APIs (chat, classification, planning, STT/TTS).
- **Integrations:** Google Calendar, iOS Reminders (two lists), HealthKit, Strava, Runna, MyFitnessPal, (Phase 2) Gmail, Google Sheets.
- **Scheduling model:** Web app writes to **Google Calendar**; iOS reflects via native GCal sync.

---

## 4. Data Model (Schemas)
All documents are **persona‑scoped** via `persona: "personal"|"work"` or collection namespaces `personal.*` / `work.*`. Timestamps are ISO or Firestore `timestamp`.

### 4.1 Goals (Personal only) – `personal.goals`
```json
{
  "id": "string",
  "persona": "personal",
  "title": "string",
  "description": "string?",
  "theme": "Health|Growth|Wealth|Tribe|Home",
  "size": "XS|S|M|L|XL",
  "time_to_master_hours": 0,
  "target_date": "timestamp?",
  "confidence": 0.0,
  "kpis": [{"name":"string","target":0,"unit":"string"}]?,
  "status": "new|active|paused|done|dropped",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 4.2 Stories (Personal only) – `personal.stories`
```json
{
  "id": "string",
  "persona": "personal",
  "goal_id": "string",
  "title": "string",
  "status": "backlog|active|done",
  "priority": "P1|P2|P3",
  "points": 0,
  "wip_limit": 0,
  "tags": ["string"]?,
  "sprint_id": "string?",
  "order_index": 0,
  "acceptance_criteria": ["string"]?,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 4.3 Tasks (Both personas) – `*.tasks` (personal + work)
```json
{
  "id": "string",
  "persona": "personal|work",
  "parent_type": "story|project",
  "parent_id": "string",
  "title": "string",
  "description": "string?",
  "status": "planned|in_progress|done",
  "priority": "low|med|high",
  "effort": "S|M|L",
  "estimate_min": 0,
  "start_date": "timestamp?",
  "due_date": "timestamp?",
  "labels": ["string"]?,
  "blocked_by": ["task_id"]?,
  "depends_on": ["task_id"]?,
  "checklist": [{"text":"string","done":false}]?,
  "attachments": [{"name":"string","url":"string"}]?,
  "aligned_to_goal": false,
  "theme": "Health|Growth|Wealth|Tribe|Home?",
  "source": "ios_reminder|web|ai|gmail|sheets",
  "source_ref": "string?",
  "ai_suggested_links": [{"goal_id":"string","story_id":"string?","confidence":0.0,"rationale":"string"}]?,
  "ai_link_confidence": 0.0,
  "has_goal": false,
  "sync_state": "clean|dirty|pending_push|awaiting_ack",
  "device_updated_at": "timestamp?",
  "server_updated_at": "timestamp",
  "created_by": "uid"
}
```

### 4.4 Work Projects (Work only) – `work.projects`
```json
{
  "id": "string",
  "persona": "work",
  "title": "string",
  "client": "string?",
  "team": "string?",
  "tags": ["string"]?,
  "status": "backlog|active|done",
  "wip_limit": 0,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 4.5 Habits (Personal) – `personal.habits`
```json
{
  "id": "string",
  "persona": "personal",
  "name": "string",
  "cadence": "daily|weekly",
  "target": 0,
  "streak_count": 0,
  "adherence_percent": 0,
  "last_logged_at": "timestamp?",
  "nudges_enabled": true
}
```

### 4.6 Finance Items (Personal) – `personal.finance_items`
```json
{
  "id": "string",
  "persona": "personal",
  "date": "YYYY-MM-DD",
  "amount": 0.0,
  "currency": "string",
  "category": "string?",
  "merchant": "string?",
  "account": "string?",
  "notes": "string?",
  "budget_category": "string?",
  "variance": 0.0,
  "source": "csv|ofx|sheets|manual",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 4.7 Health (Personal) – `personal.health_daily`
```json
{
  "date": "YYYY-MM-DD",
  "hrv_ms": null,
  "rhr": null,
  "sleep_minutes": null,
  "sleep_efficiency": null,
  "steps": null,
  "screen_time_min": null,
  "strain_index": null,
  "status": "good|moderate|poor",
  "source": "healthkit"
}
```

### 4.8 Planning Prefs – `planning_prefs`
```json
{
  "uid": "string",
  "wake_time": "HH:mm",
  "sleep_time": "HH:mm",
  "quiet_hours": [{"start":"HH:mm","end":"HH:mm"}],
  "max_hi_sessions_per_week": 2,
  "min_recovery_gap_hours": 24,
  "weekly_theme_targets": {"Health":300,"Tribe":240,"Wealth":300,"Growth":240,"Home":180},
  "pool_hours": [{"day":1,"open":"06:00","close":"22:00"}]?,
  "gym_hours": [{"day":1,"open":"06:00","close":"22:00"}]?,
  "auto_apply_threshold": 0.8
}
```

### 4.9 Training Plan & Workouts
`personal.training_plan` (Runna) and `personal.workouts` (Strava)
```json
{
  "date":"YYYY-MM-DD",
  "session_type":"tempo|long_run|intervals|easy",
  "duration_min":60,
  "target_rpe":6,
  "source":"runna"
}
```
```json
{
  "date":"YYYY-MM-DD",
  "sport":"run|ride|swim|strength|crossfit",
  "duration_min":50,
  "distance_km":10.2,
  "avg_hr":150,
  "tss_like":45,
  "source":"strava"
}
```

### 4.10 Calendar Blocks – `calendar_blocks`
```json
{
  "id":"string",
  "google_event_id":"string?",
  "task_id":"string?",
  "goal_id":"string?",
  "persona":"personal|work",
  "theme":"Health|Growth|Wealth|Tribe|Home",
  "category":"Tribe|Chores|Gaming|Fitness|Wellbeing|Sauna|Sleep",
  "start":"timestamp",
  "end":"timestamp",
  "flexibility":"hard|soft",
  "status":"proposed|applied|superseded",
  "color_id":"string?",
  "visibility":"default|private",
  "created_by":"ai|user",
  "rationale":"string?",
  "version":1,
  "superseded_by":"block_id?",
  "created_at":"timestamp",
  "updated_at":"timestamp"
}
```

### 4.11 Gmail & Finance (Phase 2/3)
**Emails – `emails`**
```json
{
  "id":"string","thread_id":"string",
  "from":"string","to":["string"],"cc":["string"],
  "subject":"string","snippet":"string","labels":["string"],
  "received_at":"timestamp","importance_score":0.0,"category":"string",
  "has_action":false,
  "action_suggested": {"create_task":false,"due_date":"timestamp?","goal_id":"string?","story_id":"string?"},
  "source":"gmail","message_ids":["string"],
  "server_updated_at":"timestamp"
}
```
**Transactions – `personal.transactions`**
```json
{
  "id":"string","account_id":"string","date":"YYYY-MM-DD",
  "description":"string","merchant":"string?","amount":0.0,
  "currency":"string","category":"string?","tags":["string"],
  "source":"sheets|csv|bank_api","source_ref":{"sheet_id":"string","range":"string","row": 12},
  "ai_confidence":0.0,"goal_id":"string?","story_id":"string?",
  "created_at":"timestamp","updated_at":"timestamp"
}
```

---

## 5. Firestore Structure & Indexes
**Collections (persona‑scoped):**
```
personal.goals, personal.stories, personal.tasks, personal.habits, personal.finance_items,
personal.training_plan, personal.workouts, personal.health_daily

work.projects, work.tasks

shared.calendar_blocks, shared.planning_prefs, emails, personal.transactions
```

**Recommended Indexes (examples)**
- `tasks`: `(persona, status, due_date desc)`
- `tasks`: `(persona, has_goal)`
- `tasks`: `(persona, parent_type, parent_id, status)`
- `stories`: `(goal_id, status, order_index)`
- `calendar_blocks`: `(persona, start asc)`
- `finance_items`: `(date desc, category)`

---

## 6. Integrations
- **Google Calendar:** source of truth for scheduling; server pushes blocks; delta sync back to Firestore.
- **iOS Reminders:** two‑way sync; list mapping by persona; defer to Phase‑1.5 unless needed.
- **HealthKit:** VO₂ Max, HRV, RHR, steps, screen time (store aggregates only).
- **Strava/Runna:** read training plan and completed workouts.
- **MyFitnessPal:** nutrition via HealthKit or direct (if available).
- **Gmail & Sheets (Phase 2/3):** AI triage; Sheets finance ingestion.

---

## 7. Web UX (High‑Fidelity Requirements)
### 7.1 Stories Kanban (Personal)
- Columns: Backlog, Active, Done (configurable).
- Cards: title, goal chip, points, status, **progress bar (#tasks done/#total)**.
- D&D reorder and column move; persists within 300ms (optimistic UI).

**Story Detail Drawer**
- Header: title, goal chip, status, priority, points (inline edit).
- **Tasks Table** (linked tasks only): columns Title, Status, Effort, Due, Priority, Labels, Blocked By, Estimate, Source.
- Actions: inline edits, bulk ops (Set Status/Due/Priority/Labels).

**Rule:** Story cannot transition to **done** while any linked task `status != "done"` (server‑enforced).

### 7.2 Tasks List (Personal & Work)
- Independent list view (not in Story modal). Persona filter applied.
- Columns: Title, Status, Effort, Due, Parent (Story/Project), Theme/Goal (chips), Source.
- Filters: persona, status, due range, source, text, labels.
- Keyboard shortcuts: `E` edit, `S` status, `D` due, `G` set goal, `P` set parent.

### 7.3 Goals Page (Personal)
- Table: Title, Theme, Size, Target Date, Progress %, #Stories, #Tasks, Next Milestone.
- Clicking a Goal shows nested **Stories** → expandable **Tasks**.
- Bulk actions: Create Story, Link Tasks, Export CSV.

### 7.4 Work Kanban (Work)
- Projects → Tasks board; no goal/story links.
- Quick add “+ Task” on Project cards.

### 7.5 Unlinked Tasks Report
- Virtualised grid for large N.
- Chipped AI suggestions with confidence + rationale tooltip.
- Bulk link/edit; “Accept All ≥ threshold”.

### 7.6 Planner Review Pane
- Proposed/changed blocks with badges: *Recovery‑adjusted*, *Theme Target*, *Conflict Repair*.
- Controls: **Apply**, **Undo**, **Lock**, **Snooze**.
- Timeline preview (week/day), snap to 5‑min grid.

### 7.7 Habits & Finance Panels
- Habits: streaks, adherence %, quick log, toggle auto‑blocks.
- Finance: budget vs actual, rolling 90 days, alerts → “Create Task”.

---

## 8. iOS App (Conversational UX)
- **Chat interface** closely mirroring ChatGPT (streamed responses, inline action chips).
- **Voice:** robust **STT/TTS** via high‑quality APIs (e.g., OpenAI). Goal: near‑identical experience to ChatGPT’s native app.
- Views: Personal Kanban, Work Kanban, Tasks List, Habits, Finance (read + quick add), Calendar hints.
- Two‑way Reminders sync with separate lists; HealthKit ingestion; offline queue & retry.

---

## 9. Agentic AI Planner
**Inputs:** persona scope, tasks/stories/goals, planning prefs, availability blocks, GCal events, health/recovery, Runna plan, Strava workouts.  
**Constraints:** hard blocks, quiet hours, wake/sleep, facility hours, `min_recovery_gap_hours`, weekly theme targets, WIP limits.  
**Outputs:** `calendar_blocks` with rationale + Google events.

**LLM Planning Loop**
1. Assemble 7‑day context.
2. LLM drafts candidate blocks to maximise theme attainment, minimise rule violations/fragmentation.
3. **Server validator** rejects collisions & rule breaks; returns diff + reasons.
4. LLM repairs; if score ≥ `auto_apply_threshold` → apply. Else show **Planner Review Pane**.
5. Apply to Firestore and push to Google Calendar; store `google_event_id`. Notify with rationale.

**Validator Predicates**
- No overlap with **hard** blocks.
- All blocks within `[wake_time, sleep_time]` and outside `quiet_hours`.
- High‑intensity sessions not allowed when `health_daily.status="poor"`; ensure ≥ `min_recovery_gap_hours`.
- Swim/Gym only within facility hours when configured.
- Transition buffers ≥ 10 min around gym/pool travel.

**Acceptance (Smart Calendaring)**
- 0 hard‑block collisions.
- Poor‑recovery downgrades/defers HI sessions with rationale.
- ≥90% of weekly theme minutes planned unless infeasible (explain shortfall).
- Runna on → ≥80% prescribed sessions scheduled.
- GCal events created & delta‑synced back within SLOs (see §12).

---

## 10. Security & Privacy
- **Schema‑level separation**: `personal.*` vs `work.*`; no cross‑persona links.
- Tokens carry persona claims; Firestore Security Rules enforce.
- PII minimisation: store health aggregates only.
- Encrypted at rest/in transit; secrets in env vars (Functions).

---

## 11. Error Handling & Edge Cases
- Conflicting edits → last‑write wins + change_log; user can revert.
- iOS Reminders offline → queue & retry; warn if divergence > N hours.
- Import validation: orphan tasks/stories; duplicate IDs; invalid dates.
- Deleting a Story with open Tasks → block; offer bulk complete/move.
- Calendar API rate limits → backoff; partial apply with retry cursor.

---

## 12. Import/Export & SLOs
- **Import:** CSV/XLSX for Goals/Stories/Tasks/Habits/Finance; validation report.
- **Export:** CSV/JSON snapshots; Markdown reports for reviews.
- **SLOs:** 
  - GCal delta pull → UI ≤ 15s
  - Block apply → `google_event_id` ≤ 5s
  - HealthKit rollup ingest ≤ 60s from device write

---

## 13. Reporting & Analytics
- Weekly sprint summary per persona: completed, slipped, next‑up.
- Habit adherence + streaks; suggested windows.
- Finance trends (variance, merchant drift); budgets at risk.
- Time allocation: by Goal Area (Personal) and by Project (Work).
- **Audit log** of AI actions (who/what/why), with revert link.

---

## 14. Acceptance Criteria (Per Feature)
**Personas**
- Switcher isolates data; no cross‑bleed. Tasks sync to correct iOS lists.

**Goals/Stories/Tasks**
- Story **cannot** complete with open Tasks (server‑enforced; user sees message).
- Goal progress auto‑updates as Stories reach `done`.
- Tasks List is a separate view from Stories Kanban; both live‑filter by persona.

**Work Projects**
- Work Tasks exist without Goals/Stories; appear on Work Kanban & Tasks List.

**Unlinked Tasks**
- Report lists all unlinked; AI suggestions with justification; bulk Accept/Reject/Edit.

**Habits**
- Create/log; show streaks %; optional auto‑blocks; adherence in weekly report.

**Finance**
- CSV import; dashboards; alerts create tasks; variance shown by category/month.

**Smart Calendaring**
- Meets validator predicates; explains reschedules; all writes visible in GCal & UI.

**iOS App**
- Chat UX mirrors ChatGPT (stream + inline actions); robust STT/TTS; two‑way Reminders; HealthKit ingest.

---

## 15. Cloud Functions (Examples)
- `goal_classify()` – clean/classify/import goals.
- `suggestLinks()` – propose task → goal/story links with confidence.
- `planCalendar()` – planning loop + validator.
- `syncGoogleCalendarDelta()` – delta pull/push; maintain `google_event_id`.
- `ingestReminders()` – idempotent upsert; list → persona mapping.
- `aggregatePersonaMetrics(date)` – daily rollup.
- Phase 2+: `ingestGmailHistory()`, `ingestFinanceSheet()`.

---

## 16. API Payload Examples
**Create Task (web → functions)**
```json
{
  "persona":"work",
  "parent_type":"project",
  "parent_id":"wprj_123",
  "title":"Draft SAM deck",
  "status":"planned",
  "due_date":"2025-09-02T17:00:00Z",
  "effort":"M",
  "labels":["client:IDB","slide"],
  "source":"web"
}
```

**Plan Calendar (request)**
```json
{
  "persona":"personal",
  "horizon_days":7,
  "apply_if_score_ge":0.85
}
```
**Plan Calendar (response)**
```json
{
  "proposed_blocks":[{"task_id":"t_1","start":"2025-09-01T06:00:00Z","end":"2025-09-01T07:00:00Z","rationale":"Gym slot fits and recovery good"}],
  "validator":{"errors":[],"warnings":[]},
  "applied":true
}
```

---

## 17. Deployment & DevOps
- **CI/CD:** GitHub Actions; Firestore emulator for PRs; preview channels.
- **Perf:** Lighthouse budgets; virtualised lists; memoised selectors.
- **Backup:** scheduled exports to GCS; restore playbook with runbook.
- **Observability:** Cloud Logging dashboards; error budgets on SLOs.
- **Access Control:** owner‑only Firestore rules; admin bypass only via secure claim.

---

## 18. Development Guidelines
- TypeScript best practices; functional React with hooks; descriptive errors.
- Unit, integration, and E2E tests for core flows (import → Kanban → schedule).
- Update changelog; API docs stay current; usage examples in README.

---

## 19. Milestones
**Weekend Milestone (Aug 29-31, 2025) - WEEKEND TARGET ACHIEVED! 🎉**
- ✅ Import Goals (template/CSV). [COMPLETE]
- ✅ Stories Kanban + Tasks List (separate views). [COMPLETE - Added dedicated Tasks List component]
- ✅ Goal progress bars. [COMPLETE - Auto-calculated from linked stories]
- ✅ Agentic AI schedules to Google Calendar. [COMPLETE - Full AI planning loop implemented]
- ✅ Persona system (Personal/Work). [COMPLETE - Switcher and context implemented]
- ✅ Data model alignment with requirements. [COMPLETE - Updated all types and collections]

**Recently Completed (Aug 29 PM):**
- ✅ Persona switcher in header with Personal/Work toggle
- ✅ PersonaContext for managing persona state
- ✅ Updated data models to match Gemini spec (Task, Goal, Story, WorkProject)
- ✅ Separate Tasks List view with persona filtering
- ✅ Goal progress bars showing completion based on linked stories
- ✅ Fixed status/priority/effort value alignment across all components
- ✅ **Agentic AI Calendar Planning System**:
  - ✅ Complete planCalendar Cloud Function with OpenAI GPT-4
  - ✅ Context assembly from tasks, goals, preferences, existing events
  - ✅ AI plan generation with constraints and validation
  - ✅ Calendar blocks data model and storage
  - ✅ Planning Dashboard UI with result visualization
  - ✅ Automatic application of high-scoring plans
  - ✅ Google Calendar integration for conflict detection

**🚀 NEXT DEVELOPMENT PHASE (Post-Weekend):**

**Priority 1 - Complete Core MVP:**
- 🚧 Work Projects Kanban (Projects → Tasks without goal linkage)
- 🚧 Unlinked Tasks Report with AI suggestions
- 🚧 Enhanced AI planning with health/recovery awareness
- 🚧 Planning preferences configuration UI
- 🚧 Story completion validation (cannot complete with open tasks)

**Priority 2 - Extended Features:**
- 🚧 Habits tracking system (personal.habits collection)
- 🚧 Basic finance tracking (CSV import, dashboards)
- 🚧 Calendar blocks → Google Calendar event creation
- 🚧 iOS Reminders integration planning

**Priority 3 - Advanced AI:**
- 🚧 HealthKit integration for recovery-aware planning
- 🚧 Theme-based weekly target balancing
- 🚧 Cross-persona scheduling confirmation system

**Deployment Status:**
- ✅ Live at: https://bob20250810.web.app
- ✅ All functions deployed and operational
- ✅ Database schema aligned with requirements
- ✅ Authentication and persona system working

**MVP (Phase 1)**
- Personas; Work Kanban; Habits; HealthKit; Unlinked Tasks report; basic Finance import.

**Phase 2**
- Gmail triage; advanced Finance dashboards + budgets; Sheets connector.

**Phase 3**
- Smart Home routines tied to recovery/schedule.

---

## 20. Changelog
- 2025-08-29: **Weekend Milestone Achieved** - Persona system, AI planning, Tasks List, Goal progress bars all operational
- 2025-08-29: Merged master requirements with Priority Engine, Sprint Automation, and advanced AI features
- 2025-08-27: Initial merged master spec with schemas, personas, validator rules, web/iOS UX, planner loop, indexes, SLOs, and milestones.

---

## 21. Addendum – Priority Engine, Sprint Automation, Promotions, Daily Digests
**Last Updated:** 2025-08-29

### 21.1 Task ⇄ Story ⇄ Goal Promotions (AI‑assisted)
**Purpose:** Right‑size work items. Allow promotion/demotion between Task, Story, Goal with AI recommendations based on **size/complexity/impact**.

**Rules**
- **Promote Task → Story** when: estimated effort > threshold (e.g., >240 min), multiple blockers/dependencies, or belongs to multi‑day calendar occupancy.  
- **Promote Story → Goal** when: Story aggregates ≥3 sibling stories or spans multiple sprints with distinct outcomes.  
- **Demote Story → Task** when: small, single‑session item with no subtasks.  
- **Demote Goal → Story** when: narrow scope and single outcome; no multi‑story structure.

**Flow**
1. User requests promotion/demotion **or** AI proposes via `promotion_suggestions` queue.  
2. Confirmation modal shows **rationale**, **impact preview** (links that will be created/moved), and allows **field mapping**.  
3. On apply: create target entity, re‑link children, preserve backlinks, write to change_log.

**Data**
- Extend `tasks`, `stories`, `goals` with `size_score` (0–1), `ai_promotion_suggested` (bool), `promotion_rationale` (string).  
- Add collection `promotion_suggestions` with `{"entity_ref":"type:id","from_type":"task|story|goal","to_type":"task|story|goal","rationale":"string","score":0.0}`.

**Acceptance**
- [ ] Applying a promotion preserves all child links and history.  
- [ ] AI suggestions only auto‑apply if score ≥ threshold and user enabled auto‑apply.  
- [ ] Undo within 7 days restores original structure.

---

### 21.2 Priority Engine & Daily Focus (Web + iOS)
**Goal:** Produce a **ranked, actionable focus list** each morning and keep it visible all day.

**Inputs**: due dates, estimates, impact/weighting, persona, health/recovery, calendar availability, blockers, sprint goals, goal deadlines.  
**Outputs**: ranked **Tasks**, recommended **Stories**, highlighted **Goals** (if urgent).  

**UI**
- **Priority Pane** (top of Dashboard):  
  - "Today's Top 5 Tasks" (persona‑scoped) with **why** badges (due soon, high impact, sprint commitment, recovery‑friendly, short slot filler).  
  - "Story of the Day" (if applicable) with linked tasks.  
  - "Goal at Risk" banner if any goal deadline < N weeks with low progress.  

**Behaviour**
- Recomputes on: day start, changes to health status, added hard blocks, new deadlines.  
- Clicking an item opens **quick schedule** or **go to parent**.  
- Items scheduled receive a **calendar chip** (start–end).

**Acceptance**
- [ ] Priority list refreshes at 05:30 local or first app open.  
- [ ] Each recommendation includes a machine‑readable `reason_code` and a human explanation.  
- [ ] Applying a priority schedules a block and updates task due date if empty or misaligned (see 21.4).

---

### 21.3 Automated Sprint Planning (Goal‑Driven)
**Objective:** Each week, AI proposes a Sprint backlog aligned to **Goal deadlines**, **weights**, and **capacity**.

**Algorithm**
1. Compute **capacity** from availability (hard/soft blocks) minus existing fixed events.  
2. Identify **urgent goals** by deadline proximity and weight (theme targets included).  
3. Choose **candidate stories** that advance urgent goals; enforce WIP and persona constraints.  
4. Decompose into **daily task selections** sized to available slots; propose calendar placements.  
5. Present **Sprint Proposal** (stories + tasks + projected velocity). User **Accept/Amend/Reject**.  
6. On accept: create **Sprint** record, tag chosen stories (`sprint_id`), and place calendar blocks.

**Data**
- `sprints`: `{"id":"string","persona":"personal|work","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","capacity_min":0,"committed_points":0,"created_at":"timestamp"}`  
- `stories.sprint_id` set when included.

**Acceptance**
- [ ] Sprint Proposal includes at least 3 alternatives when feasible (balanced vs aggressive vs conservative).  
- [ ] Accepted sprint populates calendar blocks ≤ 5s and updates story/task statuses appropriately.  
- [ ] Burndown available from day 2 (computed points/remaining).

---

### 21.4 Due‑Date Harmonisation from Scheduling
When the AI schedules a task's first block **after** its current due date, it proposes to **move the due date**; if the task has no due date, it proposes one based on scheduled finish.

**Rules**
- If reschedule pushes completion beyond due date → prompt: *"Adjust due date to {new_date}?"*  
- Bulk rule for sprint acceptance: *"Align task due dates to scheduled end times"* toggle.

**Acceptance**
- [ ] No silent due‑date changes without explicit setting: `auto_align_due_dates=true`.  
- [ ] Change_log captures previous and new due dates with rationale.

---

### 21.5 Daily Priority Digest (Telegram + Email)
**Goal:** Send a morning brief with **Top 5 Tasks**, **Story of the Day**, **Calendar highlights**, and **Goal‑at‑Risk**.

**Channels**
- **Telegram** via Bot API (user provides bot token + chat_id).  
- **Email** via transactional service (e.g., Firebase Extensions / Mailgun / SendGrid).

**Content**
- Persona‑scoped digests (one per active persona).  
- Sections: Today's Top 5, Story of the Day, Calendar Conflicts, Goal at Risk, Quick Actions (Accept plan, Snooze, Open Planner).  
- Links deep‑link to Web/iOS views.

**Schedule**
- Default 05:45 local; RRULE configurable; on‑demand "Send Now".

**Acceptance**
- [ ] Digest sent on schedule with ≤60s jitter.  
- [ ] Opt‑out per channel/persona.  
- [ ] Links open the exact filtered view with the recommended item pre‑selected.

**Functions**
- `sendDailyDigest(persona)` – assembles content; renders markdown/HTML; sends via Telegram/Email; logs to `digests_log`.

---

### 21.6 iOS & Web – Priority & Sprint Views
**iOS**
- **Priority tab** mirrors web Priority Pane; includes *Schedule*, *Done*, *Later* quick actions.  
- **Sprint tab** shows committed stories with progress bars; "Today's slice" task list.

**Web**
- **Priority Pane** (Dashboard) always visible; draggable into Calendar.  
- **Sprint Planner**: compare Proposed vs Current; point capacity; conflict warnings; *Apply* writes calendar blocks.

**Acceptance (UI)**
- [ ] iOS and Web show identical priority ordering given same inputs.  
- [ ] Drag‑to‑calendar from Priority Pane creates blocks with rationale & due‑date harmonisation prompt.

---

### 21.7 Non‑negotiable Rule (Re‑assertion)
- **A Story cannot be closed until all linked Tasks are completed.**  
- Server‑side guard remains in place; Planner cannot override.

---

### 21.8 Telemetry & Explainability
- Each recommendation includes (`reason_code`, `weight_breakdown`, `constraints_hit[]`).  
- Expose **"Why this?"** popover: human summary and model signals (e.g., *deadline proximity 0.92, impact 0.76, slot fit 0.88*).

**Acceptance**
- [ ] Every applied recommendation has an attached explanation retrievable from the UI and API.  

---

### 21.9 New/Updated Cloud Functions
- `computePriority(persona)` – scores and ranks tasks/stories/goals for today.  
- `proposeSprint(persona, window)` – generates sprint candidates from goal deadlines & capacity.  
- `applyPromotion(entity_ref, to_type)` – executes promotion/demotion with link migration.  
- `sendDailyDigest(persona)` – Telegram/Email.  
- `harmoniseDueDates(task_ids, mode)` – aligns due dates to schedule.

---

### 21.10 API Examples
**Promotion Suggestion (response)**
```json
{
  "entity_ref":"task:t_123",
  "from_type":"task",
  "to_type":"story",
  "score":0.87,
  "rationale":"Estimate > 4h and 3 dependencies detected"
}
```

**Daily Priority (response)**
```json
{
  "date":"2025-09-01",
  "persona":"personal",
  "top_tasks":[{"task_id":"t1","reason_code":"due_soon|impact|slot_fit","explain":"Due today; 45m fits 06:15 slot"}],
  "story_of_day":{"story_id":"s42","explain":"Sprint commitment; 3/5 tasks left"},
  "goal_at_risk":{"goal_id":"g7","explain":"Deadline in 10 days, progress 20%"}
}
```

**Sprint Proposal (response)**
```json
{
  "persona":"work",
  "capacity_min": 1800,
  "candidates":[
    {"type":"balanced","stories":[{"id":"s1","points":5},{"id":"s2","points":3}],"tasks":[{"id":"t5","estimate_min":60}]},
    {"type":"aggressive","stories":[{"id":"s1","points":8}]},
    {"type":"conservative","stories":[{"id":"s2","points":3}]}
  ]
}
```

---

## 22. Updated Acceptance Criteria (Summary)
- **Promotions:** Right‑sizing preserves links/history; reversible for 7 days.  
- **Priority Engine:** Morning Top 5 + Story/Goal recommendations with explainability; one‑click schedule.  
- **Sprint Automation:** Goal‑deadline‑driven proposals; capacity‑aware; alternative plans; burndown available.  
- **Due Date Harmonisation:** Explicit setting controls automatic shifts; all changes logged.  
- **Daily Digest:** Telegram + Email sent on schedule; deep‑links correct.  
- **UI Parity:** iOS and Web show the same priority order; drag‑to‑calendar supported on Web.  
- **Invariant:** Story cannot close while tasks remain.
