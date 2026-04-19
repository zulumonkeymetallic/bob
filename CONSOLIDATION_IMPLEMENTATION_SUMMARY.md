# 🎯 Block Consolidation & Capacity Planning - Implementation Summary

**Session**: March 6, 2026  
**Status**: ✅ Complete & Ready for Testing

---

## 📋 What Was Built

### **Phase 1: Event Consolidation** ✅
Instead of creating 5+ separate GCal events for items in the same planner block, we now create **ONE event per block** with all items listed in the description.

**Files Created/Modified:**
- `functions/scheduler/blockConsolidation.js` (NEW) - Core consolidation logic
- `functions/scheduler/syncToFirestore.js` - Updated to export consolidation functions
- `functions/nightlyOrchestration.js` - Calls consolidation instead of legacy approach
- `functions/calendarSync.js` - Detects consolidated `block.items` array and formats GCal event accordingly

**Key Features:**
- Groups multiple tasks/stories/routines in same time block
- Stores items array in calendar_block with metadata
- One GCal event per block with full item list in description

---

### **Phase 2: Capacity Management** ✅
System validates whether items fit in planner blocks based on points.

**Formula:**
- 1 hour block = 4 items (at 0.25 points each)
- Capacity = `Math.floor((blockDurationMinutes / 60) * 4)` items
- Or in points: 1 hour = 1.0 point capacity

**New Functions:**
- `calculateBlockCapacity()` - Checks if items fit, returns excess items
- `writeConsolidatedCalendarBlocks()` - Consolidates + validates capacity
- `getDayCapacityWarnings()` - Daily check: total capacity vs. total demand

**Capacity Warnings Include:**
- Total capacity vs. total demand (points)
- Shortfall amount if over capacity
- List of items to defer (lowest priority first)
- Utilization percentage

---

### **Phase 3: Immovable Flag** ✅
Mark items that must always be completed (e.g., "wear retainer", "take medication")

**New Callable:**
- `toggleImmovableFlag(entityType, entityId, immovable)`
  - entityType: 'task', 'chore', 'routine'
  - Sets `immovable: true/false` on the entity
  - Immovable items deferred LAST when over-capacity

**Usage:**
When capacity is exceeded, deferral priority is:
1. Low-priority movable items (first to defer)
2. High-priority movable items
3. Low-priority immovable items
4. High-priority immovable items (last resort)

---

### **Phase 4: GCal Event Title Format** ✅
Changed format from `TK-XXXXX - Title - [Theme]` to `Title [TK-XXXXX] [Theme]` for better readability on small screens (iPhone, Watch).

**File Modified:**
- `functions/calendarSync.js` (line ~750)

**Before:** `AI Sprint [US-CENTRAL1]`  
**After:** `AI Sprint [US-CENTRAL1] [Growth]`

---

### **Phase 5: React Capacity Warning Banner** ✅
New banner component shows daily capacity status at top of planner.

**Files Created:**
- `react-app/src/components/planner/DayCapacityWarningBanner.tsx` (NEW)
- `react-app/src/components/planner/DayCapacityWarningBanner.css` (NEW)

**Where It Appears:**
- Top of planner page (`/planner`)
- Only shows if `users/{uid}/planner_alerts/capacity-warning` has warning

**Banner Shows:**
- ⚠️ Capacity status (over/at/under)
- Progress bar (capacity utilization %)
- Shortfall amount if over capacity
- List of over-capacity blocks with items to defer
- Recommendation: extend blocks, defer chores, move dates
- Action buttons: "Review Blocks", "Review Items"

**Dismissable:**
- Click X to dismiss for today
- Reappears tomorrow if still over capacity

**Backend Integration:**
- `nightlyOrchestration.js` runs capacity check post-planning
- Writes to `users/{uid}/planner_alerts/capacity-warning`
- React component subscribes via real-time listener

---

## 🔧 Backend Integration Points

### **Nightly Orchestration Flow:**
```
replanCalendarNow()
  ├─ planSchedule() → generates scheduled_instances
  ├─ writeConsolidatedCalendarBlocks() → groups by block + validates capacity
  ├─ getDayCapacityWarnings() → checks shortfall
  ├─ writeCapacityAlert() → stores warning in planner_alerts
  ├─ writeScheduledTimesToSources() → updates source docs with times
  ├─ updatePlannerStats()
  └─ Success → GCal syncing triggers via onCalendarBlockWrite
```

### **Capacity Check Result:**
```json
{
  "date": "2026-03-06",
  "totalCapacity": 8.0,
  "totalDemand": 10.5,
  "shortfall": 2.5,
  "utilizationPercent": 131,
  "overCapacityBlocks": [
    {
      "blockId": "morning-finance",
      "title": "Finance Review (3 items)",
      "excess": 1.5,
      "itemsToDefer": [
        { "title": "Review receipts", "points": 0.5, "priority": 1 }
      ]
    }
  ],
  "message": "Day overbooked by 2.5 points. Consider: 1) deferring low-priority chores, 2) extending block times, 3) moving items to other days."
}
```

---

## 🚀 What Users Will See

### **In React Planner:**
1. Day starts with capacity check running
2. If over-capacity, warning banner appears at top
3. Shows visual progress bar of capacity utilization
4. Lists which blocks are over capacity
5. Suggests which items to defer
6. Can click "Review Items" to see what to move/skip
7. Can dismiss banner or act on it

### **In Google Calendar:**
1. **Old**: 5 separate events for 5 chores in "Morning Chores" block
2. **New**: 1 event titled "Morning Chores [3 items] [Health]"
3. Description lists all items with points and immovable status
4. Much cleaner on small screens

### **In iOS App:**
1. Events grouped by block (one event = one block)
2. Can tap to see list of items in that block
3. Checkbox each item complete
4. Summary shows "3 items completed in Morning Block"

---

## 📝 Database Schema Changes

### **calendar_blocks** collection
Added fields for consolidated blocks:
```
{
  // Existing
  id, ownerUid, entityType, taskId, storyId, routineId, title, start, end, ...
  
  // NEW for consolidation
  items: [
    { instanceId, sourceId, sourceType, title, points, priority, immovable, ... }
  ],
  itemCount: 3,
  totalPoints: 0.75,
  blockCapacity: 1.0,
  capacityExceeded: true,
  utilizationPercent: 75,
  itemsToDefer: [...],
  sourceInstanceIds: [...]
}
```

### **tasks, chores, routines** collections
Added field:
```
{
  // Existing fields
  ...
  
  // NEW for immovable items
  immovable: false
}
```

### **users/{uid}/planner_alerts** collection (NEW)
```
capacity-warning: {
  type: "capacity",
  date: "2026-03-06",
  totalCapacity: 8.0,
  totalDemand: 10.5,
  shortfall: 2.5,
  utilizationPercent: 131,
  overCapacityBlocks: [...],
  message: "...",
  createdAt: timestamp
}
```

---

##  🧪 Testing Checklist

### **Backend Functions:**
- [ ] `writeConsolidatedCalendarBlocks()` groups items correctly
- [ ] `calculateBlockCapacity()` identifies excess items
- [ ] `getDayCapacityWarnings()` returns correct shortfall
- [ ] `toggleImmovableFlag()` updates entity immovable field
- [ ] Nightly job writes capacity warning to planner_alerts

### **GCal Sync:**
- [ ] Event title format is "Title [REF] [Theme]"
- [ ] Consolidated block creates 1 event (not 5)
- [ ] Event description lists all items with points
- [ ] Immovable items marked with [IMMOVABLE] badge

### **React UI:**
- [ ] DayCapacityWarningBanner displays on planner
- [ ] Shows only when over capacity
- [ ] Progress bar shows utilization %
- [ ] Collapses/expands over-capacity blocks
- [ ] Dismiss button works
- [ ] "Review Items" link navigates correctly

### **iOS App:** *(pending)*
- [ ] Displays one event per block instead of multiple
- [ ] Item list visible when tapping event
- [ ] Immovable badge shows on items

---

## ⚠️ Known Limitations

1. **Manual Firebase Index**: The `planner_alerts` collection queries work without explicit indexes, but high-volume deployments may benefit from a Firestore composite index.

2. **Immovable Migration**: Existing chores/routines don't have the `immovable` field. Use first-time migration or set default to `false`.

3. **Capacity Recalculation**: Currently runs nightly. Real-time validation available via callable functions if needed.

4. **iOS Consolidation**: iOS still needs UI update to display items list for consolidated blocks (backend complete).

---

## 🔄 Next Steps (Optional)

### **Low Priority:**
- Add "Quick Defer" buttons to immovable items past 24 hours
- Show capacity warning in daily email summary
- Add capacity view for weekly/monthly view
- Suggest item reordering by priority to optimize blocks

### **Medium Priority:**
- iOS update: item list view for consolidated blocks
- Add "Auto-defer low-priority" button in banner
- Integrate with calendar block creation UI

### **High Priority:**
- Full E2E testing with real user flow
- Deploy to production with monitoring
- Verify GCal sync works with consolidated events

---

## 📞 Support

**Issues?**
- Check `functions/scheduler/blockConsolidation.js` for capacity logic
- Check `functions/calendarSync.js` for event formatting
- Check `React/DayCapacityWarningBanner.tsx` for UI

---

**Build Date:** March 6, 2026  
**Status:** Ready for review and testing  
**Deployment:** Ready for `firebase deploy --only functions,hosting --force`
