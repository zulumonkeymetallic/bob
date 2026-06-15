# BOB Listener Consolidation Migration Guide

**Date:** May 2026  
**Purpose:** Reduce Firestore reads from ~500 onSnapshot() listeners to ~6 centralised subscriptions

---

## What Changed

### Before (Inefficient)
- 39+ components each with their own `onSnapshot()` calls
- 499 total active listeners per app session
- Cascading reads when documents update
- **Cost:** £25-37/month Firebase bill

### After (Optimised)  
- Single `BobDataProvider` in App.tsx with 6 central subscriptions
- Components use `useBobData()` hook for shared state
- Non-critical collections use pull-to-refresh instead of real-time
- **Expected cost:** <£5/month

---

## New API Usage

### Basic Import

```tsx
import { useBobData } from '../contexts/BobDataContext';

function MyComponent() {
  const { goals, stories, tasks, sprints, loading } = useBobData();
  
  if (loading) return <div>Loading...</div>;
  
  return (
    <div>
      {tasks.filter(t => t.priority === 4).map(task => (
        <TaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}
```

### Manual Refresh (Pull-to-Refresh Pattern)

```tsx
const { tasks, refreshCollection, isStale } = useBobData();

// Check if data is older than 2 minutes
if (isStale('tasks', 120)) {
  // Optional: show "stale data" indicator
}

// User-initiated refresh
await refreshCollection('tasks');
```

### Entity Lookup (Replaces Individual Subscriptions)

```tsx
// OLD WAY (creates new listener):
const taskQuery = query(collection(db, 'tasks'), where('__name__', '==', taskId));
onSnapshot(taskQuery, ...);

// NEW WAY (uses existing subscription):
const { subscribeToEntity } = useBobData();
const task = subscribeToEntity<Task>('tasks', taskId);
```

---

## Migration Steps Per Component

### Step 1: Remove Local State
```tsx
// DELETE these lines:
const [myTasks, setMyTasks] = useState<Task[]>([]);
const [loading, setLoading] = useState(true);
```

### Step 2: Add useBobData Hook
```tsx
// ADD this at component top:
const { tasks, loading } = useBobData();
```

### Step 3: Remove onSnapshot Calls
```tsx
// DELETE entire useEffect that contained:
useEffect(() => {
  const unsub = onSnapshot(
    query(collection(db, 'tasks'), ...),
    (snap) => setTasks(...)
  );
  return () => unsub();
}, []);
```

### Step 4: Update References
```tsx
// Change all references from myTasks → tasks
// and local loading → shared loading
```

---

## Collections Covered by BobDataProvider

| Collection | Real-Time? | TTL Cache | Notes |
|------------|-----------|-----------|-------|
| `goals` | ✅ Yes | 30 min | Low frequency updates |
| `stories` | ✅ Yes | 15 min | Moderate frequency |
| `tasks` | ✅ Yes | 1 min | High frequency |
| `sprints` | ✅ Yes | 30 min | Stable data |
| `calendar_blocks` | ✅ Yes | 30 sec | Very dynamic |
| `theme_allocations` | ✅ Yes | 1 hour | Rarely changes |

---

## Exceptions - When NOT to Use useBobData

1. **Detail views with optimistic updates** - still need local draft state
2. **Search filters** - filter server-side or use client-side filtering on fetched data
3. **Third-party integrations** (Monzo, Strava) - have dedicated sync mechanisms
4. **Write operations** - continue using direct Firestore mutations

---

## Testing Checklist

After migrating a component:

- [ ] Component renders without errors
- [ ] Data appears correctly
- [ ] Pull-to-refresh works (if implemented)
- [ ] No console errors about duplicate listeners
- [ ] Navigation between pages doesn't cause subscription leaks
- [ ] Firebase Console shows reduced read count

---

## Expected Impact

**Immediate:**
- -90% function invocations from scheduler changes
- React app will see gradual improvement as you migrate components

**Per 10 Components Migrated:**
- ~130 fewer active listeners
- Estimated £2-3/month savings

**Full Migration (All 39 Components):**
- -400+ listeners
- Estimated £8-12/month additional savings
- Combined with scheduler fixes: **~£25→£5/month total**

---

## Rollback Plan

If issues arise:

1. Revert `App.tsx` to remove `<BobDataProvider>` wrapper
2. Restore individual component listeners from git history
3. Delete `contexts/BobDataContext.tsx`

No destructive database changes were made - rollback is safe.
