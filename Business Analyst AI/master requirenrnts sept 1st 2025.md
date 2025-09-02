Perfect — here’s a detailed consolidated master roadmap (roadmap.md) with everything we’ve discussed across the last few months, structured so you can hand it straight to the coding AI.

⸻

📘 BOB App – Master Roadmap

Owner: Jim Donnelly
Audience: Development AI / Coding Team
Date: September 1, 2025
Version: 1.0 (Master Consolidation)

⸻

🎯 Vision

BOB is a personal AI productivity hub that manages Goals → Stories → Tasks, syncs with iOS Reminders & Calendars, pulls in health and lifestyle data, and uses an agentic AI layer to dynamically plan, prioritize, and coach users.
The platform blends task management, habit tracking, and AI-driven scheduling into a single ecosystem, integrating seamlessly with iOS, web, and Firebase.

⸻

🚀 Major Feature Areas

1. Goals → Stories → Tasks Lifecycle
	•	Goal Management
	•	CRUD operations for goals
	•	Categories (themes: Growth, Wealth, Health, Tribe, Home)
	•	Status parity across all views (New, Work in Progress, Complete, Blocked, Deferred)
	•	Visualization: Kanban, Gantt, mind-map, modern table
	•	Story Management
	•	Link stories under goals
	•	Story backlog view + sprint assignments
	•	Auto-reference IDs
	•	Edit sprint, acceptance criteria, status
	•	Task Management
	•	CRUD operations for tasks
	•	Task linking to stories (and indirectly to goals)
	•	Kanban + modern table view
	•	Drag-and-drop task reassignment
	•	Excel-like customizable table across all list views

⸻

2. iOS & System Integrations
	•	iOS Reminders Sync
	•	Two-way sync between Reminders ↔ Firebase backlog
	•	Auto-task push from BOB into Reminders
	•	Check-off in Reminders reflects in Firebase
	•	Calendar Sync & AI Scheduling
	•	Import events from Google/Apple Calendar
	•	Block out non-negotiables (work, commitments)
	•	AI dynamically schedules goals, chores, and projects in free time
	•	Sprint planning feeds into daily/weekly calendars
	•	Logs and console output for sync reliability
	•	Health & Lifestyle Integrations
	•	Apple HealthKit (VO₂ max, HRV, Resting HR)
	•	Strava (runs, triathlon training)
	•	MyFitnessPal (nutrition + macros)
	•	Screen Time (Digital Detox) – daily usage tracking, detox goal framework, recommendations

⸻

3. AI & Agentic Features
	•	Agentic AI Layer
	•	Continuous monitoring of calendar + to-do list
	•	Proactive nudges (via iOS push / Telegram)
	•	End-to-end testing via side-door authentication
	•	AI BA layer to track coding AI updates & generate test cases
	•	AI Suggestions & Planning
	•	Daily rebalancing of schedule
	•	Sprint summaries (e.g., “10% complete, 12 days left”)
	•	Task alignment to higher-level goals
	•	Conversational coaching in chat (e.g., “What should I focus on today?”)
	•	AI Categorization
	•	Classify goals, tasks, and detox usage
	•	Confidence scoring on imported goals
	•	Flag misaligned tasks (“Not linked to any goal”)

⸻

4. Visualization & Dashboards
	•	Progress Dashboards
	•	Overall % completion across goals
	•	Sprint progress metrics
	•	Travel map (countries visited, % complete)
	•	Chore/project dashboard
	•	Advanced Views
	•	Gantt chart (zoomable: sprint, week, month)
	•	Mind-map view (visual linking of goals, stories, tasks)
	•	Modern table for quick inline editing
	•	Detox Dashboard
	•	Daily/weekly screen time charts
	•	Progress meters for reduction %
	•	Trends and habit recommendations

⸻

5. Home & Chores Module
	•	Weekly Chores (by room)
	•	Bedroom: change bed, dust surfaces, laundry sorting
	•	Living Room: vacuum, dust, tidy cables
	•	Kitchen: clean counters, mop floor
	•	Bathroom: scrub tiles, restock essentials
	•	Monthly Chores
	•	Deep clean per room
	•	Appliance maintenance
	•	Projects (DIY Goals)
	•	Paint doors, skirting, bathroom
	•	Replace broken switches
	•	Redecorate kitchen (September project)
	•	Back garden upgrades

⸻

6. Productivity Enhancements & Defects
	•	QuickActionsPanel – 4 action shortcuts on dashboard
	•	Drag-and-Drop Refactor – stable Kanban movement
	•	Schema Enhancements – deltas captured in defects.md
	•	UI Enhancements
	•	Dark/light/system themes
	•	Responsive mobile design
	•	Inline modals with parity fields (edit vs new)
	•	Modern task table with expandable story/goals

⸻

7. Testing & Logging
	•	AI Test Scripts
	•	CRUD validation across goals/stories/tasks
	•	Calendar + Reminders sync tests
	•	Console output logging defects
	•	Deployment Guardrails
	•	Always push to GitHub with tagging
	•	Auto-backups before deployment
	•	Notification via Telegram after deployment

⸻

8. Future Phases
	•	Phase 2 – Finance
	•	Expense management + budgeting integration
	•	ISA & pension tracking
	•	Discretionary spend dashboards
	•	Phase 3 – Smart Home
	•	Integrate Nest, lights, and cameras
	•	Task triggers linked to home devices
	•	Phase 4 – Advanced AI
	•	Voice journaling with GPT reflection
	•	Therapy-style insights on task patterns
	•	Gamification layer (XP, streaks, badges)

⸻

📅 Phased Timeline

Sept–Oct 2025
	•	iOS Reminders two-way sync
	•	Screen Time ingestion + detox goals
	•	Calendar AI blocking (basic)

Nov–Dec 2025
	•	AI categorization + dashboard rollouts
	•	Sprint-linked Gantt view
	•	Chore/project module release

Jan–Mar 2026
	•	Advanced agentic AI (continuous monitor)
	•	Finance module MVP
	•	Travel map & gamification

Apr–Jun 2026
	•	Smart home integration
	•	Voice journaling
	•	Advanced analytics + habit correlation

⸻

📊 Success Metrics
	•	Task Alignment: 90% of active tasks linked to goals
	•	Calendar Scheduling: >80% of free time successfully scheduled by AI
	•	Health Tracking: >70% of users enable HealthKit/Screen Time
	•	Detox Outcomes: 25% average reduction in target categories after 30 days
	•	Satisfaction: Positive user feedback in weekly check-ins

⸻

✅ This document consolidates all requirements, integrations, and enhancements into one authoritative roadmap.

⸻

Do you want me to also merge this into your existing gemini.md file so the coding AI has both requirements + roadmap in one place, or keep them separate (roadmap.md + gemini.md)?