---
title: Calendar & Task Orchestration
status: Draft
---

# Calendar & Task Orchestration

Objectives:
- Centralize calendar block management with templates and conflict handling
- Auto-link tasks to goals/stories
- Assign N themes by proportion using LLM
- Schedule items into open blocks and sync to Google Calendar
- Generate daily 07:00 email digest

Components:
- `CalendarService`, `BlockScheduler`, `AutoLinker`, `ThemeAssigner`

Notes:
- Idempotent writes to avoid duplicate events
- iOS Reminders: never delete; mark complete with audit note
- Telemetry for accuracy and scheduling success

