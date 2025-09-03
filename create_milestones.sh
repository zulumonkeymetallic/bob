#!/bin/bash

# Create project milestones

gh milestone create --title "MVP – Core Features" --description "Includes CRUD for Goals, Stories, Tasks, Kanban, Sprints, and Calendar sync with Reminders integration."
gh milestone create --title "Phase 2 – Health & Digital Detox" --description "Includes HealthKit sync, Apple Watch app, screen time analysis, and Detox AI logic (iOS + Android TV)."
gh milestone create --title "Phase 3 – Agentic AI" --description "Includes GPT-based story/task generation, calendar suggestions, priority engine, and smart goal alignment."
gh milestone create --title "Phase 4 – iOS & Mobile Expansion" --description "Includes native iOS app with Siri Shortcuts, HealthKit tracking, and voice journaling."
gh milestone create --title "Phase 5 – Monetization & Personalization" --description "Includes feature gating, customizable themes, premium AI agents, and usage analytics for upgrade prompts."
gh milestone create --title "Phase 6 – Multi-Agent AI & Automation" --description "Includes n8n orchestrator, planner/coach agents, role-based logic, and automation scaffolding."