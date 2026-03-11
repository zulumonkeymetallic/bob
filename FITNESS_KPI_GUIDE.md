# Fitness KPI Integration Guide

## Overview

Link your fitness activities (Strava runs, HealthKit steps, etc.) directly to goal KPIs. Your workouts automatically sync nightly and display progress toward your goals.

## How It Works

### 1. **Setup Fitness KPIs on a Goal**

When creating or editing a goal:
- Click "**+ Add Fitness KPI**"
- Choose from templates or create custom metrics
- Examples:
  - "Walk 10k steps daily" (tracks HealthKit steps)
  - "Run 5km daily" (tracks Strava running distance)
  - "Cycle 50km weekly" (tracks Strava cycling)
  - Custom: any metric you define

### 2. **Supported Fitness Types**

| KPI Type | Source | Unit | Example |
|----------|--------|------|---------|
| **Steps** | HealthKit / Apple Health | steps | 10,000 daily |
| **Running** | Strava / HealthKit | km / miles | 5km daily |
| **Cycling** | Strava / HealthKit | km / miles | 30km weekly |
| **Swimming** | Strava / HealthKit | km / miles | 5km weekly |
| **Walking** | Strava / HealthKit | km / miles | 10km daily |
| **Workout Count** | Any provider | workouts | 3 weekly |

### 3. **Auto-Sync Schedule**

- **When**: Every night at 03:30 UTC (part of nightly orchestration)
- **What**: Pulls last 90 days of workout data from Strava / HealthKit
- **How**: Matches KPIs to workout types and calculates progress
- **Update**: Goal KPI progress displayed in real-time

### 4. **KPI Status Indicators**

Each KPI shows a status badge:

| Status | Indicator | Color | Meaning |
|--------|-----------|-------|---------|
| ✓ On Target | Green | Success | 100%+ of target |
| → Good Progress | Blue | Info | 80-99% of target |
| ↗ OK | Yellow | Warning | 50-79% of target |
| ⚠ Behind | Red | Danger | <50% of target |
| No Data | Gray | Secondary | No workouts recorded |

### 5. **Where to See Progress**

- **Goal List View**: Quick status badge next to each goal
- **Goal Detail**: Full KPI panel with breakdowns
- **Metrics Dashboard**: Fitness KPI widget (coming soon)
- **Daily Email**: "Fitness KPIs" section (coming soon)
- **Focus Goals Banner**: Linked fitness progress display

### 6. **Examples**

#### Example 1: "Run 5km Daily"
```
Goal: "Become a consistent runner"
KPI: "Run 5km daily"
  - Type: Strava running distance
  - Timeframe: Daily (last 24 hours)
  - Sync: Every night, pulls Strava runs
  - Display: "4.2 / 5 km (84%) • 1 workout today"
```

#### Example 2: "Walk 10k Steps Daily"
```
Goal: "Hit 10k daily steps"
KPI: "Walk 10k steps daily"
  - Type: HealthKit steps
  - Timeframe: Daily (last 24 hours)
  - Sync: Every night, pulls Apple Health data
  - Display: "8,342 / 10,000 steps (83%)"
```

#### Example 3: "Train for marathon"
```
Goal: "Complete a marathon"
KPIs:
  - "Run 30km weekly" (Type: running distance, Weekly)
  - "Run 4 days weekly" (Type: workout count, Weekly)
  - Status updates every night with total weekly distance
```

## Technical Details

### Firestore Schema

Goal KPIs are extended with fitness metadata:

```javascript
{
  kpis: [
    {
      name: "Run 5km daily",
      target: 5,
      unit: "km",
      // New fields (auto-populated by sync)
      current: 4.2,
      progress: 84,
      status: "good",
      timeframe: "daily",
      fitnessKpiType: "running_distance",
      lastUpdated: "2026-03-09T03:30:00Z",
      recentWorkoutCount: 1
    }
  ],
  kpisLastSyncedAt: timestamp
}
```

### Sync Functions

**Backend Functions:**

1. `syncFitnessKpisNightly` - Runs daily at 03:30 UTC
   - Syncs all users' fitness KPIs
   - Updates goal KPI progress
   - Logs results to integration_logs

2. `syncFitnessKpisNow` - Manual per-user sync
   - Callable function (auth required)
   - Immediate refresh of KPI progress
   - Returns: `{ synced: number, goalIds: string[] }`

### API

Call from React:

```typescript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const syncFitness = httpsCallable(functions, 'syncFitnessKpisNow');
const result = await syncFitness();
// result = { ok: true, synced: 2, goalIds: ['goal-1', 'goal-2'] }
```

## Troubleshooting

### "No Data" status
- **Cause**: No workouts recorded in the timeframe
- **Fix**: Log workouts in Strava or HealthKit
- **Note**: Data takes ~48 hours to appear after initial connection

### KPI not updating
- **Cause**: Last sync was >24 hours ago
- **Fix**: Click "Sync Now" in goal details for manual refresh
- **Note**: Nightly sync runs automatically, custom forces immediate

### Wrong values
- **Cause**: Workout data not synced from Strava/HealthKit
- **Fix**: Check Strava/HealthKit settings and app permissions
- **Note**: Both apps must have export permissions enabled

## Best Practices

1. **Link to Main Goals** - Focus goals should have fitness KPIs tied to movement habits
2. **Use Timeframes** - Match KPI timeframe to your training plan
3. **Combine Types** - Mix different activities (e.g., "30km running + 2 gym sessions weekly")
4. **Review Weekly** - Check status in Focus Goals banner and metrics dashboard
5. **Set Realistic Targets** - Look at past data before committing to new targets

## Coming Soon

- 📊 Fitness KPI widget in Metrics/Progress page
- 📧 Fitness KPIs in daily email digest
- 📈 Historical KPI charts and trends
- 🎯 KPI achievement badges and streaks
- 📱 Mobile view optimization for fitness tracking
