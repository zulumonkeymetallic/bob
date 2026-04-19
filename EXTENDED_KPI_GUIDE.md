# Extended KPI System - Routine-Driven & Content Production

## Overview

The unified KPI system now supports **routine-driven KPIs** and **content production KPIs** in addition to fitness, progress, financial, time and habit tracking.

- **Routine Compliance**: Track adherence to habits that drive physical outcomes (e.g., gym routine → body fat %)
- **Content Production**: Track consistent content creation (e.g., 2 Substack articles/week, podcast episodes, blog posts)

## Routine Compliance KPIs

**Definition**: A KPI where an outcome (body fat %, fitness level) is **driven by consistent adherence to a routine task**.

### Example 1: Body Fat Transformation via Gym Routine

```javascript
{
  id: "goal-bodyfat-20",
  title: "Reduce Body Fat to 20%",
  kpisV2: [
    {
      id: "kpi-gym-routine-adherence",
      name: "Gym Routine Adherence (80% over 100 days)",
      type: "routine_compliance",
      timeframe: "quarterly",
      target: 80,            // 80% compliance target
      unit: "%",
      
      // Routine tracking
      linkedRoutineIds: ["routine-gym-3x-weekly"],
      lookbackDays: 100,      // Evaluate over last 100 days
      complianceThreshold: 80, // Must hit 80% to achieve body fat goal
      
      // Physical metric it drives
      linkedMetric: "body_fat_percent",
      linkedMetricCurrent: 22,    // Current: 22%
      linkedMetricTarget: 20,     // Target: 20%
      
      // Auto-calculated by sync
      current: 82,            // 82 days completed gym routine
      progress: 102,          // 102% of target (exceeded)
      status: "on-target",
      metadata: {
        completedDays: 82,
        totalDays: 100,
        compliancePercent: 82,
        complianceThreshold: 80
      }
    }
  ]
}
```

**How it works**:
1. Create a routine task: "Gym 3x/week" (linked to goal)
2. Create routine compliance KPI: "80% gym adherence over 100 days"
3. Link the routine task ID to the KPI
4. Every night, sync counts completed routine days
5. If routine adherence ≥ 80%, KPI shows "on-target"
6. Physical metric (body fat %) updates via manual tracking or DEXA scans

---

### Example 2: Nutrition via Meal Prep Routine

```javascript
{
  name: "Meal Prep for Calorie Control (1800 cals/day)",
  type: "routine_compliance",
  timeframe: "monthly",
  target: 90,              // 90% meal prep adherence
  unit: "%",
  
  linkedRoutineIds: ["routine-meal-prep-sunday"],
  lookbackDays: 30,
  complianceThreshold: 90,
  
  linkedMetric: "daily_calorie_intake",
  linkedMetricCurrent: 1850,
  linkedMetricTarget: 1800,
  
  // Display
  current: 27,             // 27 days meal prepped
  progress: 90,
  status: "ok"
}
```

---

### Example 3: Sleep Quality via Sleep Routine

```javascript
{
  name: "Sleep Routine Adherence (85% nights in bed by 11pm)",
  type: "routine_compliance",
  timeframe: "monthly",
  target: 85,
  unit: "%",
  
  linkedRoutineIds: ["routine-bedtime-11pm"],
  lookbackDays: 30,
  complianceThreshold: 85,
  
  linkedMetric: "sleep_quality_index",
  linkedMetricCurrent: 7.2,  // Scale 1-10
  linkedMetricTarget: 8.5,
  
  current: 26,               // 26 nights on routine
  progress: 86,              // 86% adherence
  status: "on-target"
}
```

---

## Content Production KPIs

**Definition**: A KPI that tracks consistent content creation across a timeframe.

### Example 1: Substack Article Writing (Transformation Journey)

```javascript
{
  id: "goal-substack-journey",
  title: "Document Transformation Journey on Substack",
  description: "Build audience by publishing consistent, high-quality articles about my fitness and lifestyle transformation",
  
  kpisV2: [
    {
      id: "kpi-substack-2x-weekly",
      name: "Write Substack Article 2x/Week",
      type: "content_production",
      timeframe: "weekly",
      target: 2,
      unit: "articles",
      
      // Content tracking
      contentType: "article",     // Type of content
      platform: "substack",       // Where published
      linkedTaskIds: [
        "task-substack-draft-week1",
        "task-substack-draft-week2"
      ],
      
      // Quality tracking
      qualityScore: 8.5,          // 1-10 average quality
      backlogCount: 3,            // Articles in draft
      
      // Auto-calculated
      current: 4,                 // 4 articles published this week
      progress: 200,              // 200% of target!
      status: "on-target",
      lastPublished: "2026-03-09T14:32:00Z",
      metadata: {
        itemsProduced: 4,
        target: 2,
        contentType: "article",
        platform: "substack",
        backlogCount: 3,
        qualityScore: 8.5
      }
    }
  ]
}
```

**Workflow**:
1. Create tasks for content: "Write Substack about gym progress", "Publish fitness transformation update"
2. Create content production KPI: "2x/week articles"
3. Link task IDs to KPI
4. Mark tasks as complete when articles published
5. Sync counts completed articles in the period
6. Progress updates automatically

---

### Example 2: Blog Posts (Monthly consistency)

```javascript
{
  name: "Publish 4 Blog Posts Monthly",
  type: "content_production",
  timeframe: "monthly",
  target: 4,
  unit: "posts",
  
  contentType: "blog_post",
  platform: "medium",         // Or self-hosted blog
  linkedTaskIds: ["task-blog-1", "task-blog-2", "task-blog-3"],
  
  qualityScore: 7.8,
  backlogCount: 2,
  
  current: 3,
  progress: 75,
  status: "ok"
}
```

---

### Example 3: Podcast Episodes

```javascript
{
  name: "Record & Publish 2 Podcast Episodes/Month",
  type: "content_production",
  timeframe: "monthly",
  target: 2,
  unit: "episodes",
  
  contentType: "podcast",
  platform: "spotify",
  linkedTaskIds: ["task-podcast-recording", "task-podcast-editing"],
  
  current: 1,
  progress: 50,
  status: "behind"
}
```

---

### Example 4: LinkedIn Posts (Professional brand)

```javascript
{
  name: "Share to LinkedIn 3x/Week",
  type: "content_production",
  timeframe: "weekly",
  target: 3,
  unit: "posts",
  
  contentType: "post",
  platform: "linkedin",
  linkedTaskIds: [],  // Auto-tracked from task title pattern
  
  current: 2,
  progress: 67,
  status: "ok"
}
```

---

## Dashboard Display

### Routine Compliance KPI Card

```
╔═══════════════════════════════════════════════════════════════╗
║ 💪 Gym Routine Adherence (80% over 100 days)                 ║
║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ║
║ Drives: 20% Body Fat 📊                                       ║
║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ║
║                                                               ║
║ Progress: 82 / 100 days (82%)     [████████████░░] 82%      ║
║ Status: ✓ On Target                                          ║
║                                                               ║
║ Current Body Fat: 22% ← Target: 20% (2% to go)              ║
║ Routine: "Gym 3x/week" | Last Week: 3/3 sessions ✓         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

### Content Production KPI Card

```
╔═══════════════════════════════════════════════════════════════╗
║ ✍️  Substack Article 2x/Week                                  ║
║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ║
║ Platform: Substack | Quality: 8.5/10 | Drafts: 3            ║
║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ║
║                                                               ║
║ This Week: 4 / 2 articles    [██████████████████] 200%       ║
║ Status: ✓ On Target (exceeding!)                             ║
║                                                               ║
║ Latest: "How I Lost 5 Lbs in 30 Days" (Published 3 days ago)║
║ Upcoming drafts: 3 articles in progress                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## Setup Workflow

### Creating a Routine Compliance KPI

1. **Create Goal**: "Reduce to 20% body fat"
2. **Create Routine Task**: "Gym 3x/week" (tagged with goal ID)
3. **Create KPI**:
   - Type: `routine_compliance`
   - Name: "Gym Adherence 80% over 100 days"
   - Linked Routine ID: from step 2
   - Linked Metric: "body_fat_percent"
   - Target: 80 (%)
4. **Manual Tracking**: Update body fat % via integrations or manual entry
5. **Sync**: Every night, routine completion % is calculated

### Creating a Content Production KPI

1. **Create Goal**: "Build Substack audience"
2. **Create Tasks**: "Draft Article: Gym Transformation", "Publish Weekly Recap"
3. **Create KPI**:
   - Type: `content_production`
   - Name: "Write 2x/week"
   - Content Type: "article"
   - Platform: "substack"
   - Linked Task IDs: from step 2
   - Target: 2
4. **Publish**: Complete tasks when articles are published
5. **Sync**: Every night, counts completed articles in period

---

## Integration with Focus Goals

When creating focus goals, you can now include:

- **Body composition goal** → Routine compliance KPI (gym routine 80%)
- **Transformation journey goal** → Content production KPI (2 Substack/week)

**Example Focus Goal Creation**:

```
1. Select Goals:
   ✓ "Reduce to 20% body fat"
   ✓ "Document transformation on Substack"

2. Choose Timeframe: "Quarter" (13 weeks)

3. KPIs Auto-Created:
   • Routine: Gym 3x/week (link to body fat)
   • Content: Write 2x/week articles
   • Associated Story Points: Track progress narratively

4. Dashboard Shows:
   • Body fat KPI: 22% → 20% (driven by gym adherence)
   • Substack KPI: 4 articles/week (exceeding!)
   • 13 days remaining in quarter
   • Overall progress: 45% (halfway through)
```

---

## Benefits of Multi-Type KPI System

| Aspect | Old System | New System |
|--------|-----------|-----------|
| **KPI Types** | Fitness only | 11 types (fitness, progress, financial, time, habit, routine, content) |
| **Outcome Tracking** | Direct metrics only | Routine-driven + outcome linking |
| **Content Goals** | Manual tracking | Automated task-based |
| **Flexibility** | Limited | Fully extensible |
| **Goal Stories** | Separate from metrics | Unified dashboard |
| **Business Goals** | Not supported | 100% supported |

---

## Examples in Use

### Fitness Transformation Journey (Complete)

```
Goal: "22% → 20% Body Fat in Q2"

KPIs:
1. Routine Compliance: Gym adherence 80% (over 100 days)
   → Current: 82% (ON TARGET) ✓
   
2. Content Production: Substack 2x/week
   → Current: 4 articles (EXCEEDING) ✓

3. Progress: Story points complete 75%
   → Current: 78% (ON TARGET) ✓

4. Fitness: Run 30km/week
   → Current: 28km (OK) ↗

Result: Body fat 22% → 20% achieved in 12 weeks! 🎉
```

### Professional Growth (Content Focus)

```
Goal: "Build leadership brand via content"

KPIs:
1. LinkedIn: 3x/week posts
   → Current: 3 posts (ON TARGET) ✓

2. Blog: 4 posts/month
   → Current: 3 posts (OK) ↗

3. Podcast: 2 episodes/month
   → Current: 1 episode (BEHIND) ⚠

4. Time: 10 hours/week on content
   → Current: 8 hours (OK) ↗

Result: Brand visibility up 45%, LinkedIn followers +300 📈
```

---

## Best Practices

1. **Link Routines to Real Outcomes**: Make the progress visible (body fat %, weight, mood, energy)
2. **Set Realistic Compliance**: 80-90% is achievable; 100% is burnout territory
3. **Track Content Quality**: Not just quantity—measure engagement and quality scores
4. **Use Timeframes Wisely**: Routines best tracked monthly/quarterly; content weekly/monthly
5. **Review on Dashboard**: Check progress alongside focus goals countdown
6. **Celebrate Overcompletion**: When you exceed targets, adjust future targets upward!

