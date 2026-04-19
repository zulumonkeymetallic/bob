# Phase 4: Orchestration Lock Implementation
**Status:** Implementation Started  
**Date:** March 9, 2026

---

## Overview

Orchestration Lock prevents AI from rescheduling items that users have manually placed on their Google Calendar. This maintains user agency while allowing AI scheduling for unscheduled items.

---

## Part 1: Firestore Schema Changes

### Fields to Add to `tasks` and `stories` collections

```firestore
// Orchestration Manual Scheduling (NEW)
{
  // Manual scheduling flag
  "manualScheduled": boolean          // true if user manually created/moved GCal event
  "manualScheduledAt": timestamp      // when the manual schedule was set
  "manualScheduledBy": string         // "user" | "gcal_import" | "ai_matched"
  
  // Orchestration lock (PRIMARY FIELD)
  "orchestrationLocked": boolean      // CRITICAL: prevent AI rescheduling
  "orchestrationLockedReason": string // "manual" | "user_edited" | "deleted_on_gcal"
  "orchestrationLockedAt": timestamp

  // Origin label (for UI)
  "origin": string                    // "manual" | "ai_prioritized" | null
  "originLabel": string               // "Manual" | "AI Prioritized" (human-readable)
  
  // GCal reference (tracking)
  "gcalEventId": string               // Google Calendar event ID
  "gcalEventUrl": string              // Direct link to GCal event
  "gcalLastSyncedAt": timestamp       // When we last synced to GCal
}
```

### Migration (Run Once)

**Command to initialize new fields:**
```javascript
// For all existing tasks/stories, initialize orchestrationLocked = false
db.collection('tasks').where('orchestrationLocked', '==', undefined)
  .get()
  .then(snap => {
    const batch = db.batch();
    snap.docs.forEach(doc => {
      batch.set(doc.ref, {
        orchestrationLocked: false,
        orchestrationLockedReason: null,
        origin: null,
        originLabel: null,
        manualScheduled: false,
      }, { merge: true });
    });
    return batch.commit();
  });
```

### Firestore Indexes

Add composite indexes for query performance (automated or manual):

```json
[
  {
    "collectionName": "tasks",
    "fields": [
      { "name": "ownerUid", "orderBy": "Ascending" },
      { "name": "orchestrationLocked", "orderBy": "Ascending" }
    ]
  },
  {
    "collectionName": "stories",
    "fields": [
      { "name": "ownerUid", "orderBy": "Ascending" },
      { "name": "orchestrationLocked", "orderBy": "Ascending" }
    ]
  }
]
```

---

## Part 2: Backend Logic in `replanCalendarNow()`

### Location: `functions/nightlyOrchestration.js` (Line ~3312)

**Change 1: Filter locked items from scheduling**

Current code (before line ~3460):
```javascript
const openTasks = tasksSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() || {}) }))
  .filter((t) => !isTaskDoneStatus(t.status))
  .filter((t) => !isRoutineChoreHabit(t))
  .filter((t) => {
    if (activeSprintIds.length === 0) return true;
    if (t.sprintId && activeSprintIds.includes(t.sprintId)) return true;
    if (t.storyId && openStoryIds.has(t.storyId)) return true;
    return false;
  });
```

**ADD THIS FILTER:**
```javascript
const openTasks = tasksSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() || {}) }))
  .filter((t) => !isTaskDoneStatus(t.status))
  .filter((t) => !isRoutineChoreHabit(t))
  .filter((t) => {
    if (activeSprintIds.length === 0) return true;
    if (t.sprintId && activeSprintIds.includes(t.sprintId)) return true;
    if (t.storyId && openStoryIds.has(t.storyId)) return true;
    return false;
  })
  // NEW: Skip locked items (prevent rescheduling manual placements)
  .filter((t) => {
    if (t.orchestrationLocked === true) {
      console.log(`[Replan] Skipping locked task: ${t.id} (reason: ${t.orchestrationLockedReason})`);
      return false;
    }
    return true;
  });
```

Same pattern for `openStories`:
```javascript
const openStories = storiesSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() || {}) }))
  .filter((s) => !isStoryDoneStatus(s.status))
  .filter((s) => activeSprintIds.length === 0 || (s.sprintId && activeSprintIds.includes(s.sprintId)))
  // NEW: Skip locked stories
  .filter((s) => {
    if (s.orchestrationLocked === true) {
      console.log(`[Replan] Skipping locked story: ${s.id} (reason: ${s.orchestrationLockedReason})`);
      return false;
    }
    return true;
  });
```

---

## Part 3: Locking Behavior

### When to SET Lock = true

**Scenario 1: User manually creates GCal event**
```javascript
// In calendarSync.js or when task/story is synced to GCal
async function markAsManuallyScheduled(db, userId, taskId, gcalEventId) {
  const ref = db.collection('tasks').doc(taskId); // or stories
  await ref.set({
    manualScheduled: true,
    manualScheduledAt: admin.firestore.FieldValue.serverTimestamp(),
    manualScheduledBy: 'user',
    orchestrationLocked: true,
    orchestrationLockedReason: 'manual',
    orchestrationLockedAt: admin.firestore.FieldValue.serverTimestamp(),
    origin: 'manual',
    originLabel: 'Manual',
    gcalEventId: gcalEventId,
    gcalLastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}
```

**Scenario 2: AI originally scheduled, user manually edited timing**
```javascript
// When user edits calendar block that's linked to task/story in UI
async function markAsUserEdited(db, userId, taskId) {
  const ref = db.collection('tasks').doc(taskId);
  await ref.set({
    orchestrationLocked: true,
    orchestrationLockedReason: 'user_edited',
    orchestrationLockedAt: admin.firestore.FieldValue.serverTimestamp(),
    origin: 'manual', // Changed from 'ai_prioritized'
    originLabel: 'Manual',
  }, { merge: true });
}
```

### When to UNSET Lock = false

**Scenario 1: User explicitly unlocks**
```javascript
// iOS UI: "Unlock for rescheduling" button
async function unlockForRescheduling(db, userId, taskId) {
  const ref = db.collection('tasks').doc(taskId);
  await ref.set({
    orchestrationLocked: false,
    orchestrationLockedReason: admin.firestore.FieldValue.delete(),
    orchestrationLockedAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });
  
  // Log activity
  await db.collection('activity_stream').add({
    userId,
    entityId: taskId,
    entityType: 'task',
    activityType: 'orchestration_unlocked',
    description: 'User manually unlocked for rescheduling',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}
```

**Scenario 2: GCal event deleted (user removes it)**
```javascript
// In calendarSync.js when detecting deleted GCal event
async function unlockAfterGcalDelete(db, userId, taskId) {
  const ref = db.collection('tasks').doc(taskId);
  await ref.set({
    orchestrationLocked: false,
    orchestrationLockedReason: admin.firestore.FieldValue.delete(),
    gcalEventId: admin.firestore.FieldValue.delete(),
    gcalLastSyncedAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });
}
```

---

## Part 4: Chore/Habits/Routines Gating

### NEW: User Setting for Scheduling Chores to Calendar (iOS)

Already implemented in `SettingsView.swift`:
- **Key:** `bob_schedule_chores_to_calendar` (UserDefaults)
- **Default:** `true` (enabled)
- **Visible in:** Calendar view navbar

### Backend Implementation

In `replanCalendarNow()` function, add check BEFORE chore scheduling:

```javascript
// NEW: Check user setting for chore scheduling
const scheduleChoresEnabled = /* determine from user profile or settings doc */;

const choresRoutines = tasksSnap.docs
  .map((d) => ({ id: d.id, ...(d.data() || {}) }))
  .filter((t) => !isTaskDoneStatus(t.status))
  .filter((t) => isRoutineChoreHabit(t))
  // NEW: Filter by user setting
  .filter((t) => {
    if (!scheduleChoresEnabled) {
      console.log(`[Replan] Skipping chore (scheduling disabled): ${t.id}`);
      return false;
    }
    // Also skip if they have orchestrationLocked = true
    if (t.orchestrationLocked === true) {
      console.log(`[Replan] Skipping locked chore: ${t.id}`);
      return false;
    }
    return true;
  });
```

---

## Part 5: UI Implementation (iOS)

### Already Implemented

1. **SettingsView.swift** - Toggle for "Include in Calendar Sync"
   - Toggles `bob_schedule_chores_to_calendar` in UserDefaults
   - Visible in new "Calendar" section

2. **CalendarView.swift** - Visual indicator
   - Shows "Chores: On/Off" with icon in week nav bar
   - Reading from same UserDefaults key

3. **OverviewCards2.swift** - Already reads chore toggle for display

### TODO: Add Unlock UI (Phase 4b)

**In TaskCard or StoryDetail view:**
```swift
Button(action: { unlockForRescheduling() }) {
  VStack(spacing: 4) {
    Image(systemName: "lock.fill")
      .foregroundStyle(Color.bobOrange)
    Text("Unlock for Rescheduling")
      .font(.caption)
  }
  .padding(8)
  .background(Color.orange.opacity(0.1))
  .cornerRadius(6)
}

private func unlockForRescheduling() {
  Task {
    try await FunctionsService.shared.unlockOrchestratedItem(
      id: task.id,
      type: "task"
    )
    // Refresh UI
  }
}
```

---

## Part 6: Testing Checklist

### Unit Tests

```javascript
// Test 1: Locked items skipped
describe('replanCalendarNow with orchestrationLocked', () => {
  it('should skip items where orchestrationLocked = true', async () => {
    const lockedTask = {
      id: 'task-1',
      title: 'Locked Task',
      orchestrationLocked: true,
      orchestrationLockedReason: 'manual',
    };
    
    // Mock filter - should exclude
    const openTasks = [lockedTask].filter(t => t.orchestrationLocked !== true);
    expect(openTasks.length).toBe(0);
  });
});

// Test 2: Unlocked items included
it('should include items where orchestrationLocked = false', async () => {
  const unlockedTask = {
    id: 'task-2',
    title: 'Unscheduled Task',
    orchestrationLocked: false,
  };
  
  const openTasks = [unlockedTask].filter(t => t.orchestrationLocked !== true);
  expect(openTasks.length).toBe(1);
});

// Test 3: Chore filtering
it('should skip chores if scheduleChoresEnabled = false', async () => {
  const chore = {
    id: 'chore-1',
    type: 'chore',
    title: 'Workout',
  };
  
  const scheduleChoresEnabled = false;
  const filtered = [chore].filter(c => scheduleChoresEnabled);
  expect(filtered.length).toBe(0);
});
```

### Manual E2E Tests

**Test A: Manual GCal Event → Lock Prevents Reschedule**

1. Create task "Sprint Planning" (unscheduled)
2. Manually drag to Google Calendar (Sat 2pm)
3. Mark as `orchestrationLocked: true` in Firestore
4. Run `replanCalendarNow()`
5. ✅ Verify: Task stays at Sat 2pm (not rescheduled)
6. ✅ Verify: Activity log shows "Skipping locked task"

**Test B: Chore Scheduling Toggle**

1. Enable "Chores: On" in Settings
2. Create chore "Laundry"
3. Run `replanCalendarNow()`
4. ✅ Verify: Chore appears on calendar

5. Disable "Chores: Off" in Settings
6. Create new chore "Dishes"
7. Run `replanCalendarNow()`
8. ✅ Verify: Chore does NOT appear on calendar

**Test C: Unlock and Reschedule**

1. Create locked task (orchestrationLocked: true)
2. Verify it's NOT on calendar
3. User clicks "Unlock for Rescheduling"
4. Set orchestrationLocked: false in Firestore
5. Run `replanCalendarNow()`
6. ✅ Verify: Task now appears on calendar (scheduled by AI)

---

## Part 7: Deployment Checklist

- [ ] Firestore schema changes deployed (all users, no data migration needed)
- [ ] New indexes created in Firestore console (or auto-deploy via rules)
- [ ] `replanCalendarNow()` updated with lock filters
- [ ] Chore scheduling toggle backend logic added
- [ ] Logging added for locked items skipped (CloudLogging visible)
- [ ] iOS Settings toggle deployed (already complete)
- [ ] iOS Calendar view indicator deployed (already complete)
- [ ] e2e tests passing
- [ ] Activity stream events generated correctly
- [ ] Unlock UI added for Phase 4b

---

## Part 8: Monitoring & Logging

### CloudLogging Queries

**Find all locked items being skipped:**
```
resource.type="cloud_function"
resource.labels.function_name="replanCalendarNow"
textPayload=~"Skipping locked (task|story|chore)"
```

**Find unlock actions:**
```
resource.type="cloud_firestore"
document.name=~"activity_stream"
jsonPayload.activityType="orchestration_unlocked"
```

**Debugging one user's replan:**
```
resource.type="cloud_function"
resource.labels.function_name="replanCalendarNow"
labels.uid="USER_ID_HERE"
```

---

## Part 9: Future Enhancements (Phase 4b)

1. **Unlock UI in iOS**
   - Show lock icon on cards with reasoning (why locked?)
   - "Unlock for rescheduling" button with confirmation

2. **Batch Unlock**
   - "Unlock all" button in Settings
   - Clears all locks at once for aggressive rescheduling

3. **Lock Analytics**
   - Dashboard showing % of items locked by user
   - Trends over time (is user locking more?)

4. **Smart Relocking**
   - If user manually moves a task again → auto-lock it again
   - Detect pattern and respect user's manual scheduling

---

## Implementation Summary

| Component | Status | Location |
|-----------|--------|----------|
| **Firestore Schema** | ✅ Design Complete | tasks/stories docs |
| **replanCalendarNow Filter** | 🔲 TODO | functions/nightlyOrchestration.js:~3460 |
| **Chore Gating** | 🔲 TODO | functions/nightlyOrchestration.js:~chores section |
| **iOS Settings** | ✅ COMPLETE | SettingsView.swift |
| **iOS Calendar View** | ✅ COMPLETE | CalendarView.swift |
| **Backend Tests** | 🔲 TODO | functions/tests/ |
| **E2E Tests** | 🔲 TODO | Selenium/manual |
| **Unlock UI** | 🔲 TODO | Phase 4b |
| **Monitoring** | ✅ READY | CloudLogging |

---

## Quick Start: Backend Implementation Steps

1. **Today (5 mins):** Add filters to `replanCalendarNow()` in nightlyOrchestration.js
   - Add `.filter((t) => t.orchestrationLocked !== true)` for tasks & stories
   - Add `.filter((c) => scheduleChoresEnabled)` for chores

2. **Today (5 mins):** Add logging
   - `console.log([Replan] Skipping locked item...)`

3. **Tomorrow (10 mins):** Write backend tests
   - Test locked items are excluded
   - Test chores filtered by setting

4. **Tomorrow (20 mins):** E2E manual testing
   - Create locked task, verify not rescheduled
   - Toggle chore setting, verify behavior changes
   - Unlock task, verify it IS rescheduled

5. **Deploy:** After tests pass, deploy to production

---

**Ready to implement? Let's go! 🚀**
