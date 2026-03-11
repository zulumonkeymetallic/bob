# Focus Goals Feature - Implementation Guide

## Overview

The **Focus Goals** feature lets you:
- Select 1+ goals to focus on for a specific timeframe (sprint/quarter/year)
- Auto-create stories for goals without them
- Auto-create Monzo savings buckets for cost-based goals
- See countdown banner with progress tracking
- Sync fitness KPIs to track daily habits
- Get daily email reminders with progress

## Components & Files

### Frontend Components

| File | Purpose |
|------|---------|
| `FocusGoalWizard.tsx` | 4-step wizard: select goals → choose timeframe → review changes → confirm |
| `FocusGoalCountdownBanner.tsx` | Displays focus goal progress, countdown timer, story/goal stats |
| `FocusGoalCountdownEmailBanner.tsx` | Text-only banner for email templates |
| `FocusGoalsPage.tsx` | Central hub showing active/past focus goals |
| `FitnessKPIDisplay.tsx` | Show fitness KPI progress inline with goals |
| `FitnessKPISetupModal.tsx` | Setup templates for fitness KPIs |

### Services

| File | Purpose |
|------|---------|
| `focusGoalsService.ts` | Create stories, savings pots, manage focus goals |
| `fitnessKpiSync.js` (backend) | Nightly sync of Strava/HealthKit to KPIs |

### Backend Functions

| Function | Purpose | Schedule |
|----------|---------|----------|
| `createMonzoPotForGoal` | Create Monzo pot for cost tracking | On-demand |
| `syncFocusGoalsNightly` | Update countdown timers | 04:00 UTC nightly |
| `syncFitnessKpisNightly` | Sync workouts to goal KPIs | 03:30 UTC nightly |
| `createMonzoPotForGoal` | HTTP callable to create savings pot | On-demand |

### Firestore Collections

**focusGoals**
```javascript
{
  id: "focus-12345",
  ownerUid: "user-id",
  persona: "personal",
  goalIds: ["goal-1", "goal-2", "goal-3"],
  timeframe: "sprint",           // sprint | quarter | year
  startDate: timestamp,
  endDate: timestamp,
  daysRemaining: 14,             // Auto-calculated nightly
  isActive: true,
  storiesCreatedFor: ["story-1", "story-2"],
  potIdsCreatedFor: {
    "goal-1": "pot-monzo-123"
  },
  createdAt: timestamp,
  updatedAt: timestamp
}
```

## Integration Steps

### 1. Add Route to App.tsx

```typescript
// In App.tsx Routes section
import FocusGoalsPage from './components/FocusGoalsPage';

// Inside <Routes>
<Route path="/focus-goals" element={<FocusGoalsPage />} />
<Route path="/metrics/progress" element={<FocusGoalsPage />} />  // Alias
```

### 2. Add to Sidebar Navigation

```typescript
// In GlobalSidebar.tsx or main nav
<NavLink to="/focus-goals" icon={<Zap />} label="Focus Goals" highlight />
```

### 3. Display in Dashboard/Overview

Add the countdown banner to your main dashboard:

```typescript
import { useFocusGoals } from '../hooks/useFocusGoals';
import FocusGoalCountdownBanner from './FocusGoalCountdownBanner';

export const DashboardCard = () => {
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);
  
  if (activeFocusGoals.length === 0) return null;
  
  return (
    <FocusGoalCountdownBanner
      focusGoal={activeFocusGoals[0]}
      goals={goals}
      stories={stories}
      compact={true}
    />
  );
};
```

### 4. Daily Email Integration

Add to `dailyDigestGenerator.js`:

```javascript
const { FocusGoalCountdownEmailBanner } = require('./lib/templates');

async function processFocusGoalsForEmail(userId) {
  const focusGoals = await db.collection('focusGoals')
    .where('ownerUid', '==', userId)
    .where('isActive', '==', true)
    .get();
    
  if (focusGoals.empty) return '';
  
  const goals = await Promise.all(
    focusGoals.docs[0].data().goalIds.map(id =>
      db.collection('goals').doc(id).get()
    )
  );
  
  return FocusGoalCountdownEmailBanner(
    focusGoals.docs[0].data(),
    goals.map(g => g.data())
  );
}

// Then in email template:
const focusSection = await processFocusGoalsForEmail(uid);
emailBody += focusSection;
```

### 5. Deploy Functions

```bash
cd /Users/jim/GitHub/bob/functions
firebase deploy --only functions
```

This deploys:
- `createMonzoPotForGoal`
- `syncFocusGoalsNightly`
- `syncFocusGoalCountdownsNightly`
- `syncFitnessKpisNightly`

## User Workflows

### Workflow 1: Create Focus Goals

1. User navigates to `/focus-goals` → Click "Create Focus Goals"
2. **Step 1 (Select)**: User selects 3 goals they want to focus on
   - Goals sorted by theme, status
   - Can multi-select
3. **Step 2 (Timeframe)**: Choose duration
   - Sprint (2 weeks) - until next sprint ends
   - Quarter (13 weeks) - until Q2 ends
   - Year (52 weeks) - until end of 2026
4. **Step 3 (Review)**: System shows:
   - Stories to auto-create for goals without them
   - Savings buckets to auto-create for cost-based goals
   - Creates them in background
5. **Step 4 (Confirm)**: Final review → Save

Result: Focus goals saved, stories created, Monzo pots created

### Workflow 2: Track Progress

1. User lands on `/focus-goals` page
2. Sees **FocusGoalCountdownBanner** showing:
   - Days remaining (countdown)
   - Selected goals with progress
   - Overall story completion % (e.g., 45% of stories done)
   - Fitness KPI progress (e.g., Run 4.2/5km today ✓)
3. Clicks goal card → Opens goal details
4. Sees all linked stories, tasks, KPIs in one view

### Workflow 3: Daily Reminders

1. Each morning, user gets daily digest email
2. Email includes "Focus Goals" section:
   - Icon showing urgency (🔥 critical, ⚡ high, 🎯 normal, ✓ low)
   - Days remaining
   - List of focus goals
   - "View Focus Goals" link

### Workflow 4: Fitness Habit Tracking

1. User adds fitness KPI to a focus goal:
   - "Walk 10k steps daily" → syncs HealthKit
   - "Run 5km daily" → syncs Strava
   - "3 workouts weekly" → counts any activity
2. Each night (03:30 UTC):
   - Backend pulls last 90 days of workouts
   - Calculates KPI progress for each goal
   - Updates goal.kpis[].progress, .status, .current
3. Next morning:
   - User sees updated KPI status in focus banner
   - "Walk 8,342/10k steps (83%) ↗ OK"
   - In daily email: "📊 Fitness KPIs: Walk 83% • Run 84%"

## Testing Checklist

- [ ] Create new focus goals via wizard
- [ ] Verify stories auto-created for goals
- [ ] Verify Monzo pots created (if connected)
- [ ] See countdown banner on page
- [ ] Verify daysRemaining updates nightly
- [ ] Test with fitness KPIs
- [ ] Verify KPI progress syncs (after workout logged)
- [ ] Check focus goals in daily email
- [ ] Deactivate focus goal manually
- [ ] Create overlapping timeframes (should deactivate old one)
- [ ] Test on mobile (compact banner)
- [ ] Test on desktop (full banner)

## Configuration

### Feature Flags

If rolling out gradually:

```javascript
// functions/index.js
const FOCUS_GOALS_ENABLED = process.env.FOCUS_GOALS_ENABLED === 'true';

if (FOCUS_GOALS_ENABLED) {
  exports.createMonzoPotForGoal = ...
}
```

### Email Settings

Users can disable focus goals via settings:

```javascript
// profiles collection
{
  id: "user-123",
  emailSettings: {
    focusGoals: true,        // Include focus goals in daily email
    focusGoalsReminders: true // Send focus goal reminders
  }
}
```

## Known Limitations & TODOs

- [ ] **Monzo Integration**: Currently creates local pots, needs real Monzo API calls
- [ ] **HealthKit Data**: Requires Apple Health app setup on iOS
- [ ] **Strava Authentication**: User must connect Strava account in settings
- [ ] **Multiple Focus Sets**: Currently only 1 active per timeframe (design intention)
- [ ] **Editing**: Can't edit existing focus goals (would require wizard redesign)
- [ ] **Mobile Views**: Focus banner compact view needs testing

## Monitoring & Debugging

### Check Focus Goals Sync

```bash
# In Cloud Functions console or Firebase logs
firebase functions:log --only syncFocusGoalCountdownsNightly
```

### Check Fitness KPI Sync

```bash
# View Firestore real-time updates
firebase firestore:list --collection goals --document <goal-id>
```

### Manual Trigger

```javascript
// From browser console
import { httpsCallable } from 'firebase/functions';
const sync = httpsCallable(functions, 'syncFocusGoalsNightly');
await sync();
```

## Related Features

- **Fitness KPIs**: Goal.kpis[] now include auto-synced workout progress
- **Daily Email**: Includes "Focus Goals" section showing countdown + progress
- **Goal Stories**: Auto-created with "focus-goal" tag for filtering
- **Monzo Pots**: Auto-created savings buckets linked to cost-based goals
- **Goals Roadmap**: Can filter by active focus goals

## Future Enhancements

1. **Focus Goals AI Coaching**: Suggest focus goals based on habits
2. **Habit Streaks**: Track focus goal completion streaks
3. **Social Sharing**: Share focus goals progress (public profiles)
4. **Mobile Widgets**: iOS/Android home screen widgets for countdown
5. **Slack Integration**: Daily Slack reminders with focus goals
6. **IFTTT Automation**: Trigger actions when fitness KPIs hit targets
