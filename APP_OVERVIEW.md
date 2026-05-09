# BOB — Application Overview

> **Purpose of this document:** A complete narrative description of the BOB platform, written for an AI design assistant. It covers what the app is, who it is for, the philosophy behind it, every domain it touches, how the systems interconnect, and the language and mental models the user operates within.

---

## 1. What is BOB?

BOB is a **personal life operating system**. It is a single application that replaces the fragmented collection of productivity tools most people use — task managers, goal trackers, workout apps, budgeting spreadsheets, journals, and calendars — and unifies them under one coherent system built around a single question: *"Am I spending my time on the things that actually matter to me?"*

The name is informal and personal. This is not a corporate product. It was built by and for one person (or a very small team) to manage an ambitious, multi-domain life: career, health, finances, relationships, learning, and creative pursuits. It is deeply opinionated about how life should be organised.

The closest analogues are:
- **Notion** — but with a real data model and real automation instead of free-form blocks
- **Linear** — but for personal life, not just software engineering
- **Whoop/Oura** — but the data feeds into planning decisions, not just dashboards
- **YNAB** — but money is linked to goals, not just budgets
- **A second brain** — but one that acts on the data, not just stores it

BOB is not a generic tool. It has a specific, embedded philosophy about how goals, time, energy, and money should be managed together.

---

## 2. The Core Philosophy

### 2.1 Agile for Life

BOB applies software development's agile methodology to personal life management. The hierarchy is:

```
Goal (the "why" — what you're trying to achieve in life)
  └── Story (the "what" — a meaningful chunk of work toward that goal)
        └── Task (the "how" — a specific atomic action)
```

This mirrors the standard agile pattern of Epic → User Story → Task, but applied to a person's entire existence rather than a software project.

Work is organised into **Sprints** — typically two-week time boxes — with planning ceremonies (sprint planning, retrospective) and capacity management. The system tracks **story points**, **WIP limits**, and **velocity** across sprints.

### 2.2 The Theme System — Life in 16 Domains

Every goal, story, task, and calendar block belongs to one of 16 **themes** — broad life domains. These themes are the fundamental categories that define how the user wants to spend their time and energy:

| Theme | Colour | What it covers |
|-------|--------|----------------|
| General | Grey | Uncategorised, catch-all |
| Health & Fitness | Green | Exercise, nutrition, body composition, recovery |
| Career & Professional | Indigo | Skills, job performance, professional reputation |
| Finance & Wealth | Amber | Savings, income, investments, debt |
| Learning & Education | Purple | Books, courses, skills, knowledge |
| Family & Relationships | Pink | Time with family, friends, partner |
| Hobbies & Interests | Orange | Creative projects, personal interests |
| Travel & Adventure | Cyan | Trips, experiences, exploration |
| Home & Living | Lime | Home maintenance, environment, domestic life |
| Spiritual & Personal Growth | Lavender | Mindset, reflection, meditation, purpose |
| Chores | Grey | Recurring domestic tasks |
| Rest & Recovery | Teal | Deliberate rest, recovery blocks |
| Work (Main Gig) | Blue | Primary employment |
| Sleep | Soft Indigo | Sleep blocks |
| Random | Light Grey | Miscellaneous |
| Side Gig | Rose | Secondary income, freelance |

The theme system is not just organisational — it drives planning. The user sets **weekly theme targets** (e.g., "I want 6 hours on Health, 4 hours on Finance, 3 hours on Learning each week"). The AI planner and dashboard track whether actual time matches these intentions.

### 2.3 The United Planner — Time as the Universal Currency

BOB treats **time** as the one resource that ties everything together. Goals require time. Fitness requires time. Recovery requires time. Financial success requires time to earn, save, and manage. Relationships require time.

The **United Planner** is the calendar view that makes this explicit. Every Goal, Story, and Task eventually lands as a **Calendar Block** — a scheduled chunk of time on the user's day. The AI planner takes the user's goals, their current sprint, their physical readiness (HRV, sleep), and their stated weekly theme targets, and generates an optimal weekly schedule.

This is the core loop:
1. Define what matters (Goals + Focus Goals)
2. Break it down (Stories + Tasks)
3. Schedule it (Calendar Blocks via AI planner)
4. Execute and track (Daily check-in + Coach)
5. Reflect and improve (Weekly check-in + Sprint retrospective)

### 2.4 Focus Goals — The North Star Filter

At any given time, the user operates with a set of **Focus Goals** — a small selection of 3–7 goals that are the current priority. Everything else is intentionally deprioritised. The Focus Goal system is the user's contract with themselves about what this sprint, quarter, or year is *actually* about.

Focus Goals drive:
- Which stories get auto-generated
- Which calendar blocks get scheduled
- Which Monzo pots get created
- What the AI Coach monitors
- What the daily/weekly check-in emphasises

### 2.5 Persona Duality — Personal vs. Work Mode

The entire app operates in two discrete modes: **Personal** and **Work**. Every entity (goal, story, task, sprint, journal entry) is tagged to a persona. The sidebar has a toggle that switches the entire context.

This exists because the user maintains a strict mental separation between personal life management and professional work management. Both use the same underlying system, but they are filtered and displayed independently.

---

## 3. The Domain Systems

### 3.1 Goal Management

Goals are the top level of the planning hierarchy. They answer "what am I trying to achieve?"

Goals have a **kind** that defines their level in a nested hierarchy:
- **Umbrella Goals** — the highest level. Broad life ambitions. e.g., "Complete an Ironman triathlon", "Achieve financial independence"
- **Milestone Goals** — significant sub-achievements under an umbrella. e.g., "Complete a half-ironman as a training race"
- **Execution Goals** — specific deliverables. e.g., "Run a sub-2:00 half marathon"

Goals have a **time horizon**:
- **Sprint** — achievable in a 2-week sprint
- **Quarter** — a 3-month goal
- **Year** — a 12-month ambition
- **Multi-Year** — 2–5 year vision

Goals have **KPIs** — measurable targets. e.g., "Weekly running volume: 40km", "Body fat %: 12%". KPIs are tracked and the AI Coach monitors when KPIs go off-track.

Goals can have **financial metadata** — an estimated cost, a cost type (one-off or recurring), and a link to a **Monzo savings pot**. This bridges planning and money.

The **Goals Management** screen offers two views:
- **Card Grid** — large visual tiles, good for reviewing the full landscape
- **Table/List** — dense rows, good for managing many goals at once

### 3.2 Stories (Features/Epics)

Stories sit between Goals and Tasks. A story represents a meaningful chunk of work — something that takes several sessions over several days or weeks to complete. In software terms it is similar to a feature or user story. In life terms it might be: "Research and book Portugal trip", "Build 12-week marathon training block", "Set up pension direct debits".

Stories have:
- **Status** — Backlog, In Progress, Done
- **Priority** — Critical, High, Medium, Low
- **Story Points** — effort estimate (Fibonacci-style)
- **WIP Limit** — how many In Progress stories are allowed at once
- **Sprint Assignment** — which sprint it belongs to
- **Acceptance Criteria** — specific conditions for "done"
- **Task children** — atomic sub-tasks
- **AI Criticality Score** — AI-assessed importance (0–100)
- **AI Top 3** — whether the AI recommends this as a top-3 focus for today
- **User Priority Rank** — user's own top-1, top-2, top-3 designation
- **Location data** — for travel-related stories, lat/lon/city/country

The **Stories view** is primarily a **Kanban board** with three columns (Backlog, In Progress, Done). The primary card component is `KanbanCardV2` — a rich, feature-dense card with drag handles, inline status/priority editing, meta badges, AI scoring display, and linked calendar block information.

Stories also have a **Table view** for high-density management.

### 3.3 Tasks

Tasks are atomic work items — the smallest unit of action. They can originate from multiple sources:
- **Web** — created in the browser app
- **iOS Reminders** — synced bidirectionally with Apple Reminders on iPhone/Mac
- **AI** — generated by the agent from journal entries or voice input
- **Gmail** — emails converted into tasks
- **Mac App** — created on macOS
- **Sheets** — imported from Google Sheets

Tasks have a **sync state machine**: `clean → dirty → pending_push → awaiting_ack → clean`. This manages the bidirectional sync with iOS Reminders.

Tasks can be:
- One-off tasks
- **Chores** — recurring domestic tasks
- **Routines** — recurring personal habits embedded as tasks
- **Habits** — tracked separately but can appear as tasks
- Media consumption items: **read**, **watch**

Tasks support full **recurrence** via `rrule` (RFC 5545 standard) — daily, weekly, monthly, yearly patterns.

### 3.4 Sprints

A sprint is a two-week time box for focused delivery. BOB treats personal life like a software project and runs fortnightly sprints with:
- **Sprint Planning** — choosing which stories to work on
- **Active Sprint** — the current two weeks
- **Sprint Retrospective** — reviewing what was and wasn't achieved
- **Velocity tracking** — story points completed per sprint, trended over time
- **Capacity management** — hours available vs hours committed

Sprints link to **Focus Goals** so that every sprint is anchored to the goals that matter most.

The sprint system prevents the common productivity failure of starting many things and finishing none. WIP limits enforce focus.

### 3.5 The Calendar & Calendar Blocks

The calendar is not just a visual display — it is the **execution layer** of the planning system. Everything that gets done gets a Calendar Block.

A **Calendar Block** is a scheduled time allocation. It has:
- A **theme** (which life domain)
- A **category** (more specific than theme — Fitness, Tribe, Sleep, etc.)
- A **flexibility** — `hard` (immovable, e.g., a work meeting) or `soft` (AI can reschedule)
- A **status** — `proposed` (AI suggested, awaiting approval), `applied` (scheduled), `superseded` (replaced)
- An **origin** — `ai` (generated by the planner) or `user` (manually created)
- Optional links to a specific Task, Story, Goal, or Habit

Calendar Blocks sync **bidirectionally with Google Calendar** — blocks created in BOB appear in Google Calendar, and external Google Calendar events appear in BOB's planner.

The **AI Planner** generates proposed blocks nightly (full replan) or on-demand (delta replan for changes). The user reviews proposed blocks in the **Approval Center** and accepts or rejects them. Accepted blocks become `applied`.

### 3.6 Focus Goals & the Intent Broker

The **Focus Goals** system is one of the most important features of BOB. It is the mechanism by which the user formally declares their current priorities.

A Focus Goal set contains:
- A **timeframe** (sprint, quarter, or year)
- A set of **goal IDs** (3–7 goals)
- A **vision text** — a narrative description of what success looks like
- **KPIs** per goal — measurable targets for the period
- A **days remaining** countdown

When a Focus Goal set is created, BOB can automatically:
- Generate stories for each goal
- Create a sprint to contain those stories
- Create Monzo savings pots for goals with financial targets
- Trigger the AI planner to schedule blocks for those goals

The **Intent Broker** is an AI component that matches the user's stated intentions (from voice/journal input) against their active focus goals, scoring alignment and surfacing the most relevant goals to act on.

---

## 4. The AI Coach System

The AI Coach is one of BOB's most sophisticated features. It is specifically designed around **Ironman triathlon training** but the underlying system is general-purpose goal coaching.

### 4.1 What the Coach Does

Every night at 05:00, the **Coach Orchestrator** Cloud Function runs. It:
1. Reads the user's latest health metrics (HRV, sleep, workout data from Strava)
2. Assesses **readiness** — a 0–100 score representing how recovered and ready the user is to train hard
3. Adapts the training plan — if readiness is low, it may reduce intensity or swap a hard session for recovery
4. Updates **macronutrient targets** — adjusting protein, carbs, and fat targets based on the next day's training type and the user's body composition goals
5. Writes a `coach_daily` document to Firestore
6. Sends a **Telegram morning briefing** — a structured message with today's training, nutrition targets, and any alerts

### 4.2 The 4-Phase Ironman Structure

The Coach organises training into four phases:
1. **Base** — building aerobic base and volume
2. **Build** — adding intensity and race-specific training
3. **Peak** — peak fitness, highest stress
4. **Taper** — pre-race reduction in volume to arrive fresh

Each phase is a Goal in the goal hierarchy, under an Umbrella Goal for the Ironman race itself. Phase duration and KPIs are set when the user provisions the structure.

### 4.3 iCal Feed Integration

The Coach polls external training programme iCal feeds (e.g., a running plan from a coaching app) and converts those sessions into Calendar Blocks. This means a structured training plan from any source becomes visible in BOB's planner and is respected by the AI scheduler.

### 4.4 Photo Analysis

The Coach supports weekly progress photo uploads. An AI vision model (`analyzeBodyPhoto`) analyses body composition changes from photos and feeds that data into the coaching context.

### 4.5 Coach Nudges

The Coach sends nudges via Telegram at key moments:
- **Morning briefing** — today's plan, nutrition targets, readiness score
- **Noon nudge** — check-in reminder if morning tasks aren't logged
- **Evening nudge** — end-of-day review prompt
- **Weekly phase progress** — how the week went against training plan
- **KPI off-track alert** — when a key metric diverges from target

---

## 5. The Finance System

BOB has a comprehensive financial management system integrated with **Monzo** (a UK digital bank).

### 5.1 What it tracks

- **Transactions** — all Monzo transactions, categorised by merchant and spending category
- **Budgets** — monthly spending limits per category
- **Income vs spend** — net cashflow view
- **Savings rate** — (savings / income × 100)
- **Debt service** — breakdown of debt repayments
- **Monzo Pots** — savings pots, each optionally linked to a Goal

### 5.2 Goal-Pot Linking

This is the key bridge between the planning and finance systems. When a Goal has a financial target (e.g., "Save £5,000 for Portugal trip"), a dedicated **Monzo Pot** can be created and linked. The pot balance displays on the Goal card. Progress toward the savings target is visualised as a progress bar.

### 5.3 Finance Actions → Stories

The system generates **Finance Action Insights** — AI-identified financial actions the user should take (e.g., "You're overspending on dining out by £200/month"). These insights can be converted directly into **Stories** in the planning system, ensuring financial improvements become actual work items with acceptance criteria and sprint assignments.

### 5.4 Transaction Import

Monzo transactions sync automatically. External transactions (from other accounts) can be imported via CSV. The system attempts to **match external transactions to Monzo transactions** to build a complete financial picture.

---

## 6. The Fitness & Health System

### 6.1 Data Sources

BOB ingests health data from multiple external sources:
- **Strava** — workout data (type, distance, duration, average heart rate)
- **MyFitnessPal** — daily nutrition (calories, protein, carbs, fat)
- **Health Kit / Wearables** — HRV (Heart Rate Variability), sleep data
- **Manual input** — via the daily check-in form

### 6.2 HRV as the Readiness Signal

**Heart Rate Variability (HRV)** is the primary physiological signal the coach uses to assess recovery. High HRV = well recovered. Low HRV = fatigued. The coach uses HRV to decide whether to recommend a hard session, a moderate session, or a full rest day.

HRV trends are displayed on the Fitness Dashboard and the AI Coach page.

### 6.3 The Fitness Dashboard

The Fitness Dashboard shows:
- HRV trend (sparkline chart)
- Weekly training load (bar chart by week)
- Recent workouts list
- Nutrition summary (today's macros vs targets)
- Habit completion rings
- Strava sync status

### 6.4 Habits

**Habits** are recurring behaviours the user wants to track. They are separate from Tasks but can be linked to Goals. Each habit has a frequency (daily, weekly, monthly), a target value, and a unit.

**Habit entries** are the individual daily/weekly logs — each recording the actual value achieved and whether the target was met.

Habits display as **streak cards** with completion rings, heatmap calendars, and history tables.

---

## 7. The Journal System

Journals in BOB are AI-processed diary entries. The input can be:
- **Typed text** — free-form diary entry
- **Voice transcript** — spoken notes transcribed to text
- **URL only** — a webpage or article to capture
- **Mixed** — combination of content types

The AI processes each entry and:
- Classifies the **entry type** (journal, task list, mixed, url-only)
- Generates a **one-line summary**
- Produces **AI summary bullets** (key points)
- Performs **mindset analysis** — assessing the emotional tone and cognitive patterns
- **Extracts tasks and stories** — any action items mentioned become Tasks or Stories
- Creates a **Google Doc** with the structured version of the entry

### 7.1 Journal Insights

The Journal Insights page aggregates across all journal entries to show:
- Mood trend over time
- Entry frequency heatmap
- Recurring themes
- Mindset score trends

This gives the user visibility into patterns in their thinking, energy, and focus over weeks and months.

---

## 8. The Check-In System

### 8.1 Daily Check-In

The daily check-in is a short structured review that the user does each day. It captures:
- **Health data** — steps, workout minutes, sleep, macros, weight, body fat
- **Task completion** — which tasks/chores/routines were completed
- **Notes** — any free-text observations
- **Energy and mood** (implicit, from the journal entry generated)

The check-in data feeds the AI Coach's readiness assessment for the following day.

Smart defaults choose "yesterday" if the check-in is done before 20:00, and "today" if done after — matching natural behaviour patterns.

### 8.2 Weekly Check-In

The weekly check-in has two modes:
- **Reflect mode** — reviewing the week just completed
- **Plan mode** — setting intentions for the week ahead

It surfaces:
- Theme time breakdown (how much time was spent in each domain)
- Sprint completion rate (% of stories done)
- Focus goal KPI health (which KPIs are on/off track)
- 3-day and 7-day financial spend (from Monzo)
- Habit completion rates
- Blockers and what to improve

The output feeds the sprint retrospective and next sprint planning.

---

## 9. Visualisation System

BOB has multiple ways to visualise goals over time:

### 9.1 Goal Roadmap (V3–V6)

A swimlane-style roadmap showing goals as bars on a time axis. Multiple versions exist (V3–V6) showing evolution of the design. Goals are grouped by theme, with dependency arrows between goals that have blockers.

### 9.2 Goal Timeline Grid (Year Planner)

A 12-month grid with goal bars spanning their start-to-end date range. The user can drag bars to adjust dates. Useful for annual planning.

### 9.3 Enhanced Gantt Chart

A traditional Gantt chart view for work projects and sprints.

### 9.4 Goal Visualisation Page (Force Graph)

A force-directed network graph showing goals and stories as nodes, with edges representing dependencies, parent-child relationships, and sprint membership.

### 9.5 Theme Roadmap

A theme-first view that shows all goals grouped and colour-coded by their life domain.

---

## 10. Media & Leisure Backlogs

BOB tracks the user's **consumption backlog** — the books, games, shows, and videos they want to experience. These are personal life goals treated with the same seriousness as professional ones.

Each backlog is a Kanban-style board with columns: **Want / In Progress / Done**.

| Backlog | Integration | Data |
|---------|------------|------|
| Books | Hardcover | Title, author, status, rating, linked goal |
| Games | Steam | Title, playtime, achievement %, status |
| TV Shows | Trakt.tv | Title, episodes, status, rating |
| Videos | YouTube History | Title, channel, watch time |
| YouTube History | YouTube Data API | Full watch history analytics |

These connect leisure to the broader goal system. A "Read 12 books this year" Goal has a Books Backlog as its execution layer.

---

## 11. Travel System

Travel is a first-class feature. The **Travel Map** uses MapLibre GL to show a world map with pins for every Story that has location data (lat/lon/city/country).

Stories can carry location metadata — making it possible to build a rich record of where in the world plans are being made and memories are being created.

The **Routes** system provides route planning and optimisation for travel and logistics.

---

## 12. The Agent & Hermes Layer

Underlying BOB is an AI agent framework called **Hermes**. Hermes is the intelligence layer that:
- Processes voice/text input (the **Transcript Intake** flow)
- Classifies intent from natural language
- Creates Tasks, Stories, and Journal Entries from unstructured input
- Runs the AI Planner (full and delta replanning)
- Powers the AI Coach orchestrator
- Generates daily digests
- Handles the Intent Broker (matching user intent to focus goals)

Hermes can be reached via:
- The in-app **Floating Assistant Button** (text chat)
- The **Transcript Intake Modal** (voice or long text)
- **Telegram** (mobile messaging interface)
- The **Daily Check-in** (structured data input)

The agent processes input and executes actions — creating documents in Firestore, updating existing records, scheduling calendar blocks — and returns a structured `AgentResponse` with what actions were taken.

---

## 13. Integrations Map

| Integration | Direction | What it provides |
|------------|-----------|-----------------|
| **Google Calendar** | Bidirectional | CalendarBlocks ↔ GCal events |
| **Monzo** | Inbound (primarily) | Transactions, pot balances |
| **Strava** | Inbound | Workout history, activity data |
| **MyFitnessPal** | Inbound | Daily nutrition logs |
| **iOS Reminders** | Bidirectional | Tasks ↔ Apple Reminders |
| **Gmail** | Inbound | Emails → Tasks |
| **Google Docs** | Outbound | Journal entries → Docs |
| **Telegram** | Outbound + Inbound | Coach briefings, agent commands |
| **Hardcover** | Inbound | Reading list sync |
| **Steam** | Inbound | Game library and playtime |
| **Trakt.tv** | Inbound | TV show watch history |
| **YouTube** | Inbound | Watch history analytics |
| **iCal feeds** | Inbound | Training programmes → CalendarBlocks |

---

## 14. The Settings & Configuration System

Settings are organised into:

- **Profile** — name, avatar
- **Planner settings** — wake/sleep time, quiet hours, max high-intensity sessions per week, weekly theme targets, gym/pool hours, auto-apply threshold
- **Email settings** — daily digest preferences (time, content)
- **AI settings** — model preferences, usage quotas
- **Notifications** — push and email toggles
- **Privacy & Security** — data export, account deletion
- **Developer** — debug flags, test mode, local login
- **Integration settings** — per-integration auth and configuration
- **Finance settings** — Monzo API keys, MFP credentials

The **Planner Settings** (`PlanningPrefs`) are particularly important — they are the constraints the AI planner uses when generating Calendar Blocks. The user declares their boundaries (sleep time, quiet hours, gym availability) and targets (theme hours per week), and the AI works within those.

---

## 15. The Language of BOB

When working with BOB (in design, development, or AI prompting), these are the terms used consistently:

| Term | Meaning |
|------|---------|
| **BOB** | The app itself |
| **Goal** | A life ambition (umbrella, milestone, or execution) |
| **Story** | An agile user story — a meaningful chunk of work |
| **Task** | An atomic to-do item |
| **Sprint** | A two-week work period |
| **Focus Goal** | A currently active, priority goal |
| **Calendar Block** | A scheduled time allocation |
| **Theme** | One of 16 life domains |
| **Persona** | Personal or Work mode |
| **Coach** | The AI training/life coach |
| **Hermes** | The underlying AI agent framework |
| **United Planner** | The main calendar/planning view |
| **Approval Center** | Where proposed AI blocks are reviewed |
| **Pot** | A Monzo savings pot |
| **Check-in** | Daily or weekly structured review |
| **Retrospective** | End-of-sprint review |
| **KPI** | A measurable target for a goal |
| **Backlog** | Stories not yet in a sprint; or media not yet started |
| **WIP Limit** | Maximum allowed In Progress items |
| **Readiness** | The coach's daily score for physical/mental recovery (0–100) |
| **HRV** | Heart Rate Variability — the primary fitness readiness signal |
| **Replan** | AI regenerating the weekly calendar schedule |
| **Delta replan** | Partial replan after a specific change |
| **Intent Broker** | AI component that matches user intent to focus goals |
| **Ref** | A human-readable reference code (e.g., G-042, S-007, T-123) |
| **Visa** | (context-specific) may refer to a travel goal |
| **Ironman** | The user's primary athletic goal — a long-distance triathlon |

---

## 16. The User Experience Philosophy

### 16.1 Everything has a Ref

Every entity has a human-readable reference code displayed in a monospace font. G-042 for goals. S-007 for stories. T-123 for tasks. This makes verbal and written references to items unambiguous.

### 16.2 Nothing Gets Lost

Tasks that come in from any source (iOS, Gmail, voice, AI) are captured and visible in one place. The sync state machine ensures bidirectional consistency.

### 16.3 The AI Works For You

The AI generates proposals — it does not make decisions. Calendar blocks are `proposed` until the user approves them. Stories are suggested, not mandated. The user is always in control.

### 16.4 Time is Visible

Every goal, story, and task is (eventually) connected to a Calendar Block. Time is not abstract — it shows up on the calendar with a duration, a theme colour, and a reason.

### 16.5 Money is Connected to Goals

Financial targets are not separate from life goals. A Monzo pot is not just a savings bucket — it is the financial execution of a goal. This makes the financial system motivating rather than just administrative.

### 16.6 Physical State Affects Mental Planning

HRV and sleep affect the plan. If the user is fatigued, the coach adapts the training and the planner should schedule lighter cognitive work. The body and the calendar are connected.

---

## 17. Technical Architecture (for AI context)

- **Frontend:** React 18, React Router v7, Bootstrap 5, Recharts, ECharts, MapLibre GL, react-big-calendar, @dnd-kit, date-fns
- **State management:** React Context (Auth, Theme, Sprint, Persona, Sidebar, DetailLevel), LocalStorage for persistence
- **Backend:** Firebase (Firestore for data, Cloud Functions for server-side logic, Firebase Storage for files, Firebase Auth for authentication)
- **AI models:** Google Vertex AI, Google Generative AI (Gemini), Anthropic Claude — used for planning, coaching, journal processing, and photo analysis
- **External APIs:** Monzo, Strava, Google Calendar, Google Docs, YouTube, Steam, Trakt.tv, Hardcover, Telegram Bot API
- **iOS companion:** Native iOS app for Reminders sync and widget support
- **Messaging:** Telegram bot for mobile briefings and agent commands

---

*This document was generated from a full recursive scan of the BOB codebase. It represents the complete as-built state of the application.*
