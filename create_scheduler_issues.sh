#!/bin/bash

# Create BOB Autonomous Scheduling Issues

echo "🚀 Creating BOB Scheduler Issues..."

# 1. Nightly AI Scheduler
gh issue create \
  --title "BOB-041: Implement Nightly AI Scheduler Engine" \
  --body "## Overview
Implement the nightly Cloud Function that generates the schedule for the next 7 days.

## Requirements
- Generate story blocks based on user capacity and priorities.
- Generate routine and chore tasks for tomorrow.
- Update task due dates based on rescheduling logic.
- Recalculate user capacity.
- Rebuild the rolling 7-day calendar.

## Acceptance Criteria
- [ ] Function runs nightly via PubSub.
- [ ] Story blocks are created in Firestore.
- [ ] Routine/Chore tasks are created in Firestore.
- [ ] Capacity is respected (no overbooking).
" \
  --label "backend,ai,scheduling,high-priority"

# 2. Morning Daily AI Planner
gh issue create \
  --title "BOB-042: Implement Morning Daily AI Planner" \
  --body "## Overview
Implement the morning Cloud Function that finalizes today's plan and sends the summary.

## Requirements
- Evaluate today's schedule.
- Re-run prioritisation engine.
- Insert mandatory story blocks for tasks due today.
- Produce the daily summary email with full calendar context.

## Acceptance Criteria
- [ ] Function runs every morning (e.g., 6 AM).
- [ ] Tasks due today force story block creation.
- [ ] Daily summary email contains 7-day rolling view.
" \
  --label "backend,ai,scheduling,high-priority"

# 3. Story Enrichment & Auto-Generation
gh issue create \
  --title "BOB-043: AI Story Enrichment & Task Generation" \
  --body "## Overview
Implement AI logic to automatically enrich stories and generate tasks.

## Requirements
- Generate missing acceptance criteria for stories.
- Convert acceptance criteria into tasks.
- Classify story themes and link goals.
- Estimate hours based on points.

## Acceptance Criteria
- [ ] Trigger on Story creation/update.
- [ ] LLM generates acceptance criteria if missing.
- [ ] Tasks are auto-created from criteria.
" \
  --label "backend,ai,llm,medium-priority"

# 4. Rolling 7-Day Calendar UI
gh issue create \
  --title "BOB-044: Implement Rolling 7-Day Calendar UI" \
  --body "## Overview
Update the Web Calendar view to show a rolling 7-day window centered on today.

## Requirements
- Show Today centered (or as start).
- Show 3 days before + 3 days after (or next 7 days).
- Display all blocks (sleep, work, tasks, stories).
- Support drag-and-drop (linked to rebalancing logic).

## Acceptance Criteria
- [ ] Calendar component updates to rolling view.
- [ ] All block types are visible.
- [ ] Drag-and-drop triggers backend update.
" \
  --label "frontend,ui,calendar,high-priority"

# 5. Two-Way Google Calendar Sync
gh issue create \
  --title "BOB-045: Full Two-Way Google Calendar Sync" \
  --body "## Overview
Ensure robust two-way sync between BOB and Google Calendar.

## Requirements
- Write blocks to Google Calendar.
- Read external edits from Google Calendar.
- Recalculate internal state upon external edit.
- Propagate changes to Mac Agent (via Firestore).

## Acceptance Criteria
- [ ] Sync works bi-directionally.
- [ ] External moves trigger BOB rebalancing.
" \
  --label "backend,integration,calendar,medium-priority"

# 6. Task Due Today Escalation
gh issue create \
  --title "BOB-046: Task Due Today Escalation Logic" \
  --body "## Overview
Enforce the rule that tasks due today MUST have a corresponding story block.

## Requirements
- Identify tasks due today without a scheduled block.
- Insert parent story block into the schedule.
- Handle conflicts (mark as 'Requires Review' if full).

## Acceptance Criteria
- [ ] Tasks due today appear on the calendar.
- [ ] Conflict blocks are created if no space exists.
" \
  --label "backend,scheduling,logic,high-priority"

# 7. Mobile Prioritised List
gh issue create \
  --title "BOB-047: Mobile Prioritised List & Compact Calendar" \
  --body "## Overview
Update the Mobile Dashboard to show the AI-prioritised list and a compact calendar.

## Requirements
- Show list sorted by AI priority score.
- Show compact rolling calendar view.
- Deep links to tasks/stories.

## Acceptance Criteria
- [ ] Mobile view reflects AI priorities.
- [ ] Compact calendar is visible and functional.
" \
  --label "frontend,mobile,ui,medium-priority"

echo "✅ Issues created."
