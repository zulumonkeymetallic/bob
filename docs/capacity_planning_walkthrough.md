# Walkthrough: BOB Platform - AI Planning & Capacity Management

## Overview
This walkthrough covers the comprehensive implementation of AI-driven planning, capacity management, and algorithmic prioritization in the BOB platform.

## Key Features Implemented

### 1. Capacity Planning Dashboard
**Location**: `/sprints/capacity`

**Functionality**:
*   **Dynamic Capacity Calculation**:
    *   Base: 24h - 8h Sleep = 16h
    *   Work Deduction: Scans for "Work"/"Main Gig" calendar blocks OR defaults to 8h (M-F)
    *   **TODO**: Settings page for custom Work/Sleep patterns
*   **Progress Tracking**:
    *   Shows completion % based on completed story points
    *   Displays remaining effort in hours
    *   Progress bar: Green (< 80%), Yellow (80-100%), Red (> 100%)
*   **Breakdown Charts**:
    *   Goal Allocation: Shows Allocated vs Utilized hours per goal
    *   Theme Allocation: Total hours allocated by theme

### 2. Algorithmic Story Prioritization (1-5 Scale)
**Logic**: `functions/capacityPlanning.js` → `updateStoryPriorities()`

**Algorithm**:
```
UrgencyRatio = RemainingEffort / DaysRemaining
P1 (Critical):  Ratio > 0.8
P2 (High):      Ratio > 0.6  
P3 (Medium):    Ratio > 0.4
P4 (Low):       Ratio > 0.2
P5 (Very Low):  Default
```

**Special Cases**:
*   Overdue tasks automatically get P1
*   Not Started + Due < 3 days → P1

**Schedule**: Runs nightly at 4 AM

### 3. Task-to-Story Conversion
**Logic**: `functions/aiPlanning.js` → `convertTasksToStories()`

**Criteria**: Tasks with `estimateMin > 240` (4 hours) are converted to Stories

**Actions**:
1.  Creates new Story (5 points, marked `unlinked: true`)
2.  Original task linked to Story and marked `done`
3.  Appears in Daily Digest "Unlinked Stories" section

**Schedule**: Runs nightly at 3 AM

### 4. AI Task Enrichment
**Logic**: `functions/aiPlanning.js` → `onTaskWrite()`

**Trigger**: When task created/updated without `estimateMin`

**Actions**:
*   LLM estimates task duration
*   Saves `estimateMin` to task
*   Logs to `activity_stream`

### 5. Story Blocking & Scheduling
**Logic**: `functions/aiPlanning.js` → `generateStoryBlocks()`

**Calculation**: `Blocks = Math.ceil(Points / 2)` (e.g., 5 pts = 3 x 2h blocks)

**Placement**:
*   Currently: Naïve 10 AM placement
*   Scheduler engine respects these as "fixed anchors"

**Schedule**: Runs during nightly scheduler at 2 AM

### 6. Google Calendar Sync
**Logic**: `functions/calendarSync.js`

**Features**:
*   Auto-syncs `calendar_blocks` to Google Calendar
*   **Deep Links**: Injects `bob://stories/{id}`, `bob://goals/{id}`, etc.
*   **Metadata**: Hidden `extendedProperties` for robust sync
*   **Bidirectional**: User changes in Google sync back to BOB

### 7. Activity Stream Logging
**Locations**: All automated functions now log to `activity_stream`

**Events Logged**:
*   Task enrichment (AI estimates)
*   Task-to-Story conversion
*   Story block scheduling

---

## Verification Evidence

### Backend Verification
Script: `scripts/verify_capacity_priority.js`

**Results**:
```
✅ Created Sprint: iZc0omZSz5xIc3L5Ex9T
✅ Created Goal: P40NFp5vjW1Zq3fVbc8C (Due: 2025-11-26)
✅ Created Story: dsVWNT0Q7lh9MpmlsFak (Points: 5, Priority: 3)

--- Step 2: Verifying Priority Algorithm ---
   Days Remaining: 2
   Effort Hours: 10
   Urgency Ratio: 5.00
   Calculated Priority: P1
✅ Algorithm correctly identified P1 Critical urgency.

--- Step 3: Verifying Capacity Calculation ---
   Allocated Capacity: 10 hours
✅ Capacity calculation logic matches (Points * 2).
```

---

## TODOs & Future Enhancements

### High Priority
1.  **Work/Sleep Settings Page**: Allow users to configure custom work hours and shift patterns
2.  **Goal Card Capacity Metrics**: Add "Allocated" and "Utilized" badges to `/goals` cards
3.  **Remaining Effort Tracking**: Add `completedPoints` field to Stories for partial progress
4.  **Smart Story Block Placement**: Replace naive 10 AM heuristic with intelligent slot-finding

### Medium Priority
1.  **30-Day Planning Window**: Extend scheduler from 7 to 30 days
2.  **Progress-Aware Re-scheduling**: If block passes without progress, auto-reschedule
3.  **Capacity Dashboard Filters**: Add date range and theme filters

### Low Priority
1.  **LLM Priority Suggestions**: Use LLM to suggest (not set) priority based on keywords
2.  **Dynamic Tag Suggestions**: Auto-complete for tags in `TagInput` component

---

## Manual Verification Steps

### 1. Capacity Dashboard
1.  Navigate to `/sprints/capacity`
2.  Select active sprint
3.  **Verify**: Total Capacity shows realistic available hours
4.  **Verify**: Progress bar updates when stories marked done

### 2. Priority Automation
1.  Create Story linked to Goal with due date in 2 days
2.  Set Story to 5 points
3.  Wait for 4 AM job OR manually run `updateStoryPriorities`
4.  **Verify**: Story priority updated to P1

### 3. Task Conversion
1.  Create Task with 6-hour estimate (> 4h)
2.  Wait for 3 AM job OR manually run `convertTasksToStories`
3.  **Verify**: New Story appears in "Unlinked Stories"
4.  **Verify**: Original task marked done

### 4. Calendar Sync
1.  Create a Story
2.  Wait for nightly job to create blocks
3.  Open Google Calendar
4.  **Verify**: Blocks appear with story title
5.  **Verify**: Event description contains deep link

### 5. Activity Stream
1.  Create a Task (triggers `onTaskWrite`)
2.  Check `activity_stream` collection
3.  **Verify**: Entry exists with type `ai_event` and category `enrichment`

---

## Files Modified

### Backend
*   `functions/capacityPlanning.js` - **NEW**: Capacity calculation & Priority algorithm
*   `functions/aiPlanning.js` - **MODIFIED**: Added conversion, enrichment, with activity logging
*   `functions/calendarSync.js` - **MODIFIED**: Added deep links & metadata
*   `functions/dailyDigestGenerator.js` - **MODIFIED**: Added "Unlinked Stories" section
*   `functions/index.js` - **MODIFIED**: Exported new functions

### Frontend
*   `react-app/src/components/CapacityDashboard.tsx` - **NEW**: Capacity planning UI
*   `react-app/src/App.tsx` - **MODIFIED**: Added `/sprints/capacity` route

### Scripts
*   `scripts/verify_capacity_priority.js` - **NEW**: Verification script for logic
*   `scripts/demo_monkey_task.js` - **NEW**: End-to-end demo script

---

## Deployment Notes
1.  Deploy Cloud Functions: `firebase deploy --only functions`
2.  Deploy React App: `npm run build && firebase deploy --only hosting`
3.  Verify scheduled jobs in Firebase Console > Functions > Logs
