# Project Gemini - Feature Documentation

## Current Features

### Core Features
- [x] Google Authentication
- [x] Dark/Light/System theme support
- [x] Mobile responsive design
- [x] Version tracking and changelog

### Goal Management
- [x] Goal creation and management
- [x] Goal categorization
- [x] Story linking to goals
- [x] Goal progress tracking

### Story Management
- [x] Story creation and editing
- [x] Story backlog view
- [x] Story-to-Goal associations
- [x] Story task panel

### Task Management
- [x] Comprehensive task creation form
- [x] Task fields:
  - Reference ID
  - Title
  - Effort sizing (Small/Medium/Large)
  - Start Date
  - Due Date
  - Status
- [x] Task-to-Story associations
- [x] Kanban board with drag-and-drop
- [x] Sprint-based filtering

### Sprint Management
- [x] Sprint administration
- [x] Automatic date calculations
- [x] Sprint planning integration
- [x] Sprint retro scheduling

### Development Tracking
- [x] Feature implementation status
- [x] UAT tracking
- [x] Development progress visualization

### AI Integration
- [x] OpenAI integration for task planning
- [x] Calendar optimization
- [x] AI-powered scheduling suggestions

### Calendar Integration
- [x] Google Calendar integration
- [x] Event synchronization
- [x] Upcoming events view

## Remaining Work

### High Priority
1. Testing and QA
   - [ ] End-to-end testing of task creation flow
   - [ ] Sprint management integration tests
   - [ ] Story-Task relationship validation
   - [ ] Performance testing for large datasets

2. Documentation
   - [ ] User guide
   - [ ] API documentation
   - [ ] Development setup guide
   - [ ] Deployment procedures

3. Performance Optimization
   - [ ] Query optimization for Firestore
   - [ ] React component memoization
   - [ ] Asset optimization
   - [ ] Lazy loading implementation

### Medium Priority
1. Features
   - [ ] Batch operations for tasks
   - [ ] Advanced filtering options
   - [ ] Custom fields for tasks
   - [ ] Template support for recurring tasks

2. UX Improvements
   - [ ] Keyboard shortcuts
   - [ ] Drag-and-drop file attachments
   - [ ] Rich text editing for descriptions
   - [ ] Improved mobile navigation

### Low Priority
1. Analytics
   - [ ] Task completion metrics
   - [ ] Sprint velocity tracking
   - [ ] Goal achievement analytics
   - [ ] Time tracking integration

2. Integration
   - [ ] Additional calendar providers
   - [ ] Issue tracker integration
   - [ ] CI/CD pipeline improvements
   - [ ] Backup and restore functionality

## Technical Stack

- Frontend: React with TypeScript
- UI Framework: Bootstrap
- State Management: React Context
- Authentication: Firebase Auth
- Database: Firestore
- Hosting: Firebase Hosting
- AI: OpenAI API
- Calendar: Google Calendar API

## Development Guidelines

1. Code Style
   - Follow TypeScript best practices
   - Use functional components with hooks
   - Implement proper error handling
   - Write meaningful comments
   - Follow the existing project structure

2. Testing
   - Write unit tests for new features
   - Update integration tests as needed
   - Test across different browsers
   - Verify mobile responsiveness

3. Documentation
   - Update changelog for all changes
   - Document new features
   - Keep API documentation current
   - Include usage examples

4. Deployment
   - Test in development environment
   - Verify all builds pass
   - Check for TypeScript errors
   - Follow the deployment checklist


Here’s a **consolidated `gemini.md`** that merges the strengths of both specs into one master requirements document — covering your **product vision** *and* the **engineering detail** needed for implementation and scaling.

---

# BOB Productivity Tool – Requirements Specification (Gemini.md)

**Project Codename:** Gemini
**Last Updated:** 27 August 2025
**Owner:** Jim Donnelly

---

## 📌 Summary

The BOB Productivity Tool (formerly "Jake") is a personal productivity assistant that unifies **goal management, task planning, calendar scheduling, and habit tracking** into one AI-powered system.
It leverages GPT APIs, Firebase, HealthKit, and iOS Reminders to deliver a **smart, proactive assistant** across web and mobile platforms, with full control over goals, tasks, and daily routines.

---

## 🧠 Core Features

### 1. 🧭 Goal Management

* Import goals from external sources (OKR spreadsheets, CSV, manual input).
* AI-powered cleaning, classification, and tagging.
* Assign **size estimates, mastery vs completion time**, and confidence levels.
* Categorise by theme: **Health, Growth, Wealth, Tribe, Home**.
* Link stories, tasks, and habits to goals.
* Track goal progress and achievement metrics.

### 2. 🗂️ Story & Task Management

* Story creation and backlog management.
* AI grouping of tasks into stories.
* Task features:

  * Reference ID
  * Title
  * Effort sizing (S/M/L)
  * Start/Due dates
  * Status (Planned, In Progress, Done)
* Task-to-story and story-to-goal associations.
* Kanban board with drag-and-drop.
* Sprint-based filtering and backlog view.

### 3. 📅 Smart Calendar Scheduling

* Block non-negotiable hours (e.g., 9–5 work schedule).
* AI dynamically schedules tasks and goals around fixed commitments.
* Push time blocks into **Google Calendar**.
* Daily/weekly schedule regeneration.
* Adjust time blocks based on complexity, effort, and energy.
* Support for multiple calendar providers (future phase).

### 4. ✅ iOS Reminders Integration

* **Two-way sync** between iOS Reminders ↔ Firebase backlog.
* BOB owns and manages all synced tasks.
* Siri Shortcuts integration for voice task creation.
* Maintain link between Reminder ↔ Story ↔ Goal.
* Allow task review via iOS Kanban.

### 5. 📈 Habit & Health Tracking

* Habit logging: meditation, journaling, macro tracking, etc.
* Sync with Apple HealthKit:

  * VO₂ Max
  * HRV
  * Resting Heart Rate
  * Steps
  * Screen Time
  * MyFitnessPal nutrition logs (via HealthKit/API).
* Habit adherence reporting + streaks.
* Goal-linked habit tracking.

### 6. 🧠 AI Assistant Interface

* Conversational interface for:

  * Daily/weekly planning.
  * "What should I do now?" queries.
  * Journaling & reflections (captured to Google Docs/Notion).
* Voice support: OpenAI Voice API + Siri Shortcuts.
* Periodic AI review to flag unaligned tasks.

---

## 📱 iOS App Features

* Native **chat interface**.
* Story/task creation and sprint planning in-app.
* Two-way Reminders sync.
* HealthKit integration (steps, HRV, VO₂ Max, etc.).
* Personal dashboard showing:

  * Goal progress
  * Task completion metrics
  * Habit adherence
  * Health metrics

---

## 🧰 Technical Stack

| Layer              | Tech Choice                               |
| ------------------ | ----------------------------------------- |
| Backend            | Firebase (Auth, Firestore, Hosting)       |
| AI Integration     | OpenAI GPT API                            |
| Calendar           | Google Calendar API                       |
| iOS Reminders Sync | EventKit (via iOS app)                    |
| Web UI             | React + TypeScript + Tailwind + shadcn/ui |
| State Management   | React Context + hooks                     |
| iOS App            | Swift + Firebase SDK                      |
| Voice Assistant    | OpenAI Voice API + Siri Shortcuts         |
| Health Data        | Apple HealthKit                           |
| Hosting/Deployment | Firebase Hosting + GitHub Actions (CI/CD) |

---

## 🧪 MVP Acceptance Criteria

* [ ] Web app with working **goal/task import, classification, and backlog**.
* [ ] Firebase backend storing goals, stories, tasks, calendar blocks, and health logs.
* [ ] iOS Reminders two-way sync.
* [ ] Daily schedule generation with AI rescheduling.
* [ ] Habit tracker with Apple Health sync.
* [ ] AI chat interface for goals, planning, and journaling.
* [ ] iOS app with:

  * Chat interface
  * Sprint/task view
  * HealthKit sync
  * Dashboard visualisation

---

## ⚙️ Development Guidelines

### Code

* TypeScript best practices.
* Functional React components with hooks.
* Error handling and logging.
* Consistent project structure and naming.

### Testing

* Unit tests for new features.
* Integration tests for workflows (goal → task → sprint).
* End-to-end testing of task creation/scheduling.
* Performance testing (large task datasets).
* Cross-browser and mobile responsiveness validation.

### Documentation

* User guide and onboarding.
* API documentation.
* Development setup guide.
* Deployment checklist.
* Changelog updates for each release.

### Deployment & DevOps

* GitHub Actions for CI/CD.
* Firebase Hosting deployment.
* TypeScript build verification.
* Backup & restore strategy for Firestore.

---

## 📊 Analytics & Reporting

* Task completion metrics.
* Sprint velocity tracking.
* Goal achievement analytics.
* Time tracking integration (future).
* Health + habit adherence reports.

---

## 📋 Future Phases

### Phase 2: Finance & Budgeting

* Expense and income tracking.
* Budget goals and notifications.
* Investment dashboard.

### Phase 3: Smart Home Integration

* Integrations: HomeKit, Nest, smart lights.
* Contextual automation (e.g., lights on for evening tasks).

---

## 🗃️ Example Goal Flow

1. Import: **“Run a marathon in 3h30.”**
2. AI classification: Theme = Health, Confidence = High, Size = XL.
3. Auto-generate:

   * Weekly training story blocks.
   * Sub-tasks (long runs, strength training).
   * Habit: "Track nutrition daily."
   * Calendar blocks for training.
   * Reminders synced to iOS.

---

## 🧠 Notes

* Every goal must link to a high-level theme.
* Tasks not linked to goals should be flagged for review.
* Dashboard should allow toggling between: **productivity, health, and habit views**.
* Firestore queries should be optimised for performance at scale.

---

👉 This consolidated version combines the **user/product focus** from your second spec with the **engineering detail** from your first.

Would you like me to also produce a **schema diagram (Goals → Stories → Tasks → Habits/Health Logs)** so you’ve got a visual reference for Firebase collections?


# BOB Productivity Tool – Requirements Specification (Gemini.md)

**Project Codename:** Gemini
**Last Updated:** 27 August 2025
**Owner:** Jim Donnelly

---

## 📌 Summary

The BOB Productivity Tool (formerly "Jake") is a personal productivity assistant that unifies **goal management, task planning, calendar scheduling, habit tracking, email triage, and financial management** into one AI‑powered system. It leverages **GPT APIs, Firebase, HealthKit, Gmail, Google Sheets, and iOS Reminders** to deliver a **smart, proactive assistant** across web and mobile, with the Web App as the command centre. All scheduling writes go to **Google Calendar** so iOS reflects changes via its native Google account integration (no iOS‑app calendar writes required).

---

## 🔲 Current Feature Status (all unchecked)

### Core Features

* [ ] Google Authentication
* [ ] Dark/Light/System theme support
* [ ] Mobile responsive design
* [ ] Version tracking and changelog

### Goal Management

* [ ] Goal creation and management
* [ ] Goal categorisation
* [ ] Story linking to goals
* [ ] Goal progress tracking

### Story Management

* [ ] Story creation and editing
* [ ] Story backlog view
* [ ] Story‑to‑Goal associations
* [ ] Story task panel

### Task Management

* [ ] Comprehensive task creation form
* [ ] Task fields (ID, Title, Effort, Start/Due, Status)
* [ ] Task‑to‑Story associations
* [ ] Kanban board with drag‑and‑drop
* [ ] Sprint‑based filtering

### Sprint Management

* [ ] Sprint administration
* [ ] Automatic date calculations
* [ ] Sprint planning integration
* [ ] Sprint retro scheduling

### Development Tracking

* [ ] Feature implementation status
* [ ] UAT tracking
* [ ] Development progress visualization

### AI Integration

* [ ] OpenAI integration for task planning
* [ ] Calendar optimisation
* [ ] AI‑powered scheduling suggestions

### Calendar Integration

* [ ] Google Calendar integration
* [ ] Event synchronisation
* [ ] Upcoming events view

---

## 🧠 Core Features

### 🧭 Goal Management (Expanded)

* **Import pipeline**: CSV/Sheets ingestion → Firestore `goals`.
* **AI clean/classify**: `goal_classify()` tags by Theme (**Health, Growth, Wealth, Tribe, Home**), sets `size`, `time_to_master_hours`, `confidence`.
* **Traceability**: stories/tasks/habits must reference a `goal_id`. Orphans flagged.
* **KPIs**: optional progress KPIs per goal (e.g., “weekly minutes Health”, “velocity per sprint”).

**Data Model – `goals`**

```json
{
  "id": "string",
  "title": "string",
  "description": "string?",
  "theme": "Health|Growth|Wealth|Tribe|Home",
  "size": "XS|S|M|L|XL",
  "time_to_master_hours": 0,
  "target_date": "timestamp?",
  "confidence": 0.0,
  "kpis": [{"name":"string","target":"number","unit":"string"}]?,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

---

### 🗂️ Story & Task Management (Expanded)

* **Sources**: tasks from **iOS Reminders**, Web UI, AI suggestions, Gmail extraction (Phase 2).
* **AI linking**: BOB proposes Goal/Story with `ai_suggested_links` + `confidence`; above threshold auto‑applies, else appears in **Needs Review**.
* **Unlinked report**: Any `goal_ids=[]` (or `has_goal=false`) listed in a dedicated Web report with inline edits + bulk actions.
* **Dependencies**: tasks support blockers (`blocked_by[]`) and `depends_on[]` to inform scheduling.

**Data Model – `stories`**

```json
{
  "id": "string",
  "title": "string",
  "goal_id": "string",
  "status": "backlog|active|done",
  "priority": "P1|P2|P3",
  "points": 0,
  "sprint_id": "string?",
  "order_index": 0,
  "acceptance_criteria": ["string"]?,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

**Data Model – `tasks`**

```json
{
  "id": "string",
  "title": "string",
  "description": "string?",
  "status": "planned|in_progress|done",
  "priority": "low|med|high",
  "effort": "S|M|L",
  "estimate_min": 0,
  "start_date": "timestamp?",
  "due_date": "timestamp?",
  "theme": "Health|Growth|Wealth|Tribe|Home?",
  "goal_ids": ["string"],
  "story_id": "string?",
  "labels": ["string"]?,
  "blocked_by": ["task_id"]?,
  "depends_on": ["task_id"]?,
  "checklist": [{"text":"string","done":false}]?,
  "attachments": [{"name":"string","url":"string"}]?,
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

**Indexes**

* `tasks(status, due_date desc)`
* `tasks(has_goal)` or shadow field to query unlinked quickly
* `tasks(goal_ids array_contains, due_date asc)`
* `stories(goal_id, status, order_index)`

---

### 📅 Smart Calendaring (Expanded + Web‑Managed)

**Goal:** Respect **hard blocks** and intelligently auto‑fill remaining time with goal‑aligned blocks (Tribe, Chores, Gaming, Fitness, Daily Well‑being, Sauna, Sleep). **All scheduling is managed from the Web App**, which writes to **Google Calendar**. iOS reflects updates via native Google Calendar sync (no direct iOS calendar writes by BOB).

**Capabilities**

* **Hard Blocks (Non‑negotiables)**: user‑created or imported GCal events that AI cannot move (work 09:00–17:00, family events, travel).
* **Soft Blocks (Preferred Windows)**: moveable guidance (e.g., Gym 06:00–07:00).
* **Auto‑Fill Categories**: Tribe, Chores, Gaming, Fitness (Run, CrossFit, S\&C, Swim), Daily Well‑being (meditation, journaling, walk), Sauna, Sleep.
* **Recovery‑Aware Scheduling**: If **HRV low** / sleep debt high, AI reduces intensity and lengthens sleep/recovery. Integrate **Runna** (plan) and **Strava** (recent load) when enabled.
* **Daily & Weekly Replans**: morning freshen pass; weekly sprint re‑plan.
* **Explainability**: each changed/added block stores a human‑readable `rationale`.

**Inputs**: Google Calendar (events, hard/soft metadata), HealthKit (HRV/RHR/sleep/steps), Runna (plan), Strava (workouts), user prefs.

**Web Calendar Management**

* **Create/Update/Delete blocks** in Web → **Google Calendar API** (primary or selected calendar).
* **Reflect external changes**: pull deltas from GCal; update local `calendar_blocks` + UI.
* **Conflict detection**: validator prevents overlaps with hard blocks/quiet hours/facility hours.
* **iOS behaviour**: iOS shows all changes via its built‑in Google account sync automatically.

**Data Models**

`availability_blocks`

```json
{ "id":"string","type":"hard|soft","title":"string","start":"ts","end":"ts","recurrence":"string?","source":"user|ai","notes":"string?","created_at":"ts","updated_at":"ts" }
```

`planning_prefs`

```json
{ "uid":"string","wake_time":"HH:mm","sleep_time":"HH:mm","quiet_hours":[{"start":"HH:mm","end":"HH:mm"}],"max_hi_sessions_per_week":2,"min_recovery_gap_hours":24,"weekly_theme_targets":{"Health":300,"Tribe":240,"Wealth":300,"Growth":240,"Home":180},"pool_hours":[{"day":1,"open":"06:00","close":"22:00"}]?,"gym_hours":[],"auto_apply_threshold":0.8 }
```

`health_daily`

```json
{ "date":"YYYY-MM-DD","hrv_ms":null,"rhr":null,"sleep_minutes":null,"sleep_efficiency":null,"steps":null,"strain_index":null,"status":"good|moderate|poor","source":"healthkit" }
```

`training_plan` (Runna)

```json
{ "date":"YYYY-MM-DD","session_type":"tempo|long_run|intervals|easy","duration_min":60,"target_rpe":6,"source":"runna" }
```

`workouts` (Strava)

```json
{ "date":"YYYY-MM-DD","sport":"run|ride|swim|strength|crossfit","duration_min":50,"distance_km":10.2,"avg_hr":150,"tss_like":45,"source":"strava" }
```

`calendar_blocks`

```json
{
  "id":"string",
  "google_event_id":"string?",
  "task_id":"string?",
  "goal_id":"string?",
  "theme":"Health|Growth|Wealth|Tribe|Home",
  "category":"Tribe|Chores|Gaming|Fitness|Wellbeing|Sauna|Sleep",
  "start":"timestamp","end":"timestamp",
  "flexibility":"hard|soft",
  "status":"proposed|applied|superseded",
  "color_id":"string?","visibility":"default|private",
  "created_by":"ai|user",
  "rationale":"string?",
  "version":1,"superseded_by":"block_id?"
}
```

**Guardrails**

1. Never move **hard** blocks.
2. Respect wake/sleep and quiet hours.
3. Enforce `min_recovery_gap_hours` between HI sessions.
4. Maintain/extend sleep when recovery poor.

**Recovery Logic**

* `status=poor`: replace CrossFit/Intervals/Long Run with mobility + easy walk ≤45′; add Sauna (if allowed); bring bedtime earlier +30–60′.
* `status=moderate`: downgrade intensity (tempo → easy; CrossFit → strength accessories + mobility).
* `status=good`: follow plan; optional strides/extension.

**LLM Planning Loop**

* **Step 0** Assemble context (7‑day horizon): availability, GCal events, prefs, health, Runna, Strava, theme targets.
* **Step 1** LLM drafts `calendar_blocks` to maximize theme attainment, minimize rule violations/fragmentation.
* **Step 2** Server validator rejects collisions, quiet‑hour breaches, recovery gaps; returns diff.
* **Step 3** LLM repairs; server applies if score ≥ threshold, else show Review Pane.
* **Step 4** Apply to Firestore and push to **Google Calendar**; store `google_event_id`.
* **Step 5** Notify with rationale summary and one‑click overrides (Lock, Undo, Keep HI anyway).

**Acceptance Criteria – Smart Calendaring**

* [ ] 0 hard‑block collisions after validator.
* [ ] When `health_daily.status="poor"`, all HI sessions replaced/downgraded with rationale.
* [ ] Weekly plan hits ≥90% of `weekly_theme_targets` unless impossible (explain shortfall).
* [ ] Sleep minutes meet baseline on ≥6/7 days or explicit reason logged.
* [ ] Runna enabled → ≥80% prescribed sessions scheduled in week (days may shift).
* [ ] All created blocks exist in Google Calendar with `google_event_id` within 5s of Apply.
* [ ] Web edits to blocks reflect back from GCal within 15s (delta sync).
* [ ] iOS devices show changes via native GCal integration (no BOB iOS writes).

**Security & Privacy**: store only required aggregates from HealthKit; tokens least‑scope; LLM prompts pass abstracted signals (e.g., `hrv_z=-1.2`).

---

## 🖥️ Web App UX – High‑Fidelity Requirements

### 1) **Kanban – Stories**

* **Columns**: Backlog, Active, Done (configurable).
* **Cards**: story title, goal chip, points, status, priority, progress bar (#tasks done/#total).
* **D\&D**: reorder within column; move across columns updates `status` (and `sprint_id` when moved into Active during an open sprint).
* **Quick add**: “+ Task” on card creates task linked to story.

**Story Detail Drawer/Page** (opens on click)

* Header: title, goal chip, status, priority, points, edit inline.
* **Tasks Table** (linked to this story):

  * Columns: Title, Status, Effort, Due, Priority, Labels, Blocked By, Estimate (min), Assoc. Goal (chip), Source.
  * Features: sort, filter, search; inline edit; bulk operations (Set Goal, Set Due, Set Status).
  * Actions: add checklist items, attach files, open in Reminders (if `source=ios_reminder`).
* Right rail: Acceptance Criteria, Notes, Activity (change\_log).

**Acceptance Criteria – Kanban & Story Detail**

* [ ] D\&D reorders persist within 300ms and survive reload.
* [ ] Opening a story shows 100% of its linked tasks with live filters.
* [ ] Inline edits are optimistic with rollback on error.

### 2) **Goals Page – Drilldown**

* **Goals Table**: Title, Theme, Size, Target Date, Progress (% tasks done), Stories (#), Tasks (#), Next Milestone.
* Click a **Goal** → **Nested View**:

  * **Stories subtable** grouped under the goal (Title, Status, Points, Progress).
  * Each story row expandable to **Tasks subtable** (same columns as Story Detail).
  * Bulk actions at goal level: Create Story, Link Tasks, Set Theme, Export (CSV).
* Metrics panel: velocity, weekly minutes by theme, overdue tasks.

**Acceptance Criteria – Goals Drilldown**

* [ ] Nested view shows all stories under goal and their tasks without page reload.
* [ ] Bulk link of selected tasks attaches to goal and (optionally) a chosen story.
* [ ] Export produces CSV of current filtered set (UTF‑8, headers).

### 3) **Unlinked Tasks Report**

* Virtualised table for large sets; filters: source, due range, effort, text search.
* Chips display **AI Suggested Links** with confidence + rationale tooltip; Accept/Reject/Edit.
* Keyboard shortcuts: `G` assign Goal, `S` assign Story, `D` due date, `T` theme.

### 4) **Planner Review Pane (Smart Calendar)**

* Shows proposed/changed blocks with badges: *Recovery‑adjusted*, *Theme Target*, *Conflict Repair*.
* Controls: **Apply**, **Undo**, **Lock**, **Snooze**.
* Timeline preview (week/day) with drag adjust (snap to 5‑min grid).

---

## 📊 Persona Analytics

* Breakdowns by **Theme** (Health, Growth, Wealth, Tribe, Home).
* Roles: *Maker*, *Manager*, *Admin*.
* Energy bands vs HRV; context switching; mean task duration.
* Weekly digest with trends and nudges (reduce switches, protect sleep, re‑balance themes).
* Extended metrics (from future phases): **Comms load** (emails triaged, reply latency), **Financial discipline** (budget adherence).

**Data Model – `persona_metrics_daily`**

```json
{
  "date":"YYYY-MM-DD",
  "by_theme": {"Health": {"min":120}, "Wealth": {"min":60}},
  "by_role": {"Maker": 180, "Manager": 120, "Admin": 60},
  "ctx_switches": 22,
  "mean_task_duration_min": 18,
  "health": {"hrv": 68, "rhr": 51, "steps": 8700, "screen_time_min": 140},
  "notes":"string?"
}
```

---

## 📋 Future Phases

### Phase 2: Gmail Inbox Management

**Features**: OAuth Gmail, AI triage (Action Needed / Awaiting Reply / Reference / Newsletter / Finance / Travel), Daily Digest, task extraction, follow‑up tracking, sweep/unsubscribe, meeting parsing → calendar blocks.

**Models**

```json
emails: {
  "id":"string","thread_id":"string","from":"string","to":["string"],
  "cc":["string"],"subject":"string","snippet":"string","labels":["string"],
  "received_at":"ts","importance_score":0.0,"category":"string",
  "has_action":false,
  "action_suggested": {"create_task":false,"due_date":"ts?","goal_id":"string?","story_id":"string?"},
  "source":"gmail","message_ids":["string"],"server_updated_at":"ts"
}
```

**Acceptance**

* [ ] New high‑priority emails appear in Inbox dashboard within 2 min.
* [ ] AI categorisation F1 ≥ 0.80; corrections learn into `triage_rules`.
* [ ] Creating a task preserves backlink to email/thread.

### Phase 3: Finance & Budgeting (Sheets + Looker Studio)

**Features**: Sheets connector, AI categorisation, budgets + goal linkage, Looker Studio dashboard via BigQuery.

**Models**

```json
transactions: {
  "id":"string","account_id":"string","date":"YYYY-MM-DD",
  "description":"string","merchant":"string?","amount":0.0,
  "currency":"string","category":"string?","tags":["string"],
  "source":"sheets","source_ref":{"sheet_id":"string","range":"string","row": 12},
  "ai_confidence":0.0,"goal_id":"string?","story_id":"string?",
  "created_at":"ts","updated_at":"ts"
}
```

**Acceptance**

* [ ] Sheet edits propagate within 5 min.
* [ ] ≥90% category accuracy on recurring merchants after 2 feedback loops.
* [ ] Budget alerts visible in Web & Weekly Digest.

### Phase 4: Smart Home Integration

* Integrate HomeKit, Nest, smart lights; context‑aware automations (e.g., lights for evening tasks).

---

## 🧪 MVP Acceptance Criteria (recap)

* [ ] Web app supports goal/task import, classification, backlog.
* [ ] Firebase stores goals, stories, tasks, calendar blocks.
* [ ] iOS Reminders 2‑way sync (create/update/complete via iOS app; calendar via GCal only).
* [ ] AI schedule generation with validator + rationale.
* [ ] Habit tracker with HealthKit ingestion.
* [ ] iOS app with chat, sprint view, Health dashboard.
* [ ] Unlinked Tasks report on Web.
* [ ] Persona analytics weekly digest.
* [ ] Web Calendar writes to Google Calendar; iOS reflects changes natively.

---

## ⚙️ Engineering Notes

**Cloud Functions (Callable/HTTP)**

* `goal_classify()` – classify/clean goals.
* `ingestReminders()` – idempotent upsert from iOS.
* `suggestLinks()` – propose task → goal/story links.
* `queueReminderUpdate(taskId, payload)` – push back due/title/status to Reminders (when source is Reminders).
* `planCalendar()` – run LLM planning loop (draft → validate → repair).
* `syncGoogleCalendarDelta()` – pull/push event deltas; maintain `google_event_id`.
* `aggregatePersonaMetrics(date)` – daily rollup.
* `ingestGmailHistory()` (Phase 2).
* `ingestFinanceSheet()` (Phase 3).

**Validator Predicates (server)**

* No overlap with `availability_blocks.type=hard`.
* All blocks within `[wake_time, sleep_time]` and outside `quiet_hours`.
* `HI` sessions ≥ `min_recovery_gap_hours` apart and not scheduled when `status=poor`.
* Swim/Gym only within facility hours if configured.
* Transition buffers ≥ 10 min around gym/pool.

**Security & Privacy**

* Firestore Security Rules: owner‑only access by `uid`.
* Token scopes: least privilege (GCal read/write events; Gmail read‑only initially; Sheets read; Strava/Runna read).
* HealthKit: store only derived aggregates (no raw PII).
* Right to be forgotten: purge mirrored + derived data.

**Dev Guidelines**

* TypeScript + React hooks; Swift + BackgroundTasks on iOS.
* Unit, integration, E2E tests; Lighthouse performance budgets.
* CI/CD: GitHub Actions → Firebase Hosting; Firestore emulator for PRs.
* Backup: scheduled exports to GCS; restore playbook.

---

## 📎 Changelog (append as we go)

* **2025‑08‑27**: Added Smart Calendaring (web‑managed to Google Calendar), Kanban Story detail with Tasks Table, Goals nested Stories→Tasks view, validator rules, models for planning and calendar blocks, acceptance criteria.
