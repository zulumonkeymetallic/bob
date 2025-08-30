# BOB - Getting Started Guide v2.1.0 🚀

## ✨ **What's New in Version 2.1.0**

Your BOB experience has been dramatically enhanced with:

- **Personal Backlogs Manager** - Track games, movies, books, and custom collections
- **Mobile Priority Dashboard** - Touch-optimized daily task management  
- **Visual Canvas** - Interactive mind mapping for goal-story-task relationships
- **Enhanced Dark Mode** - Fixed table readability with proper contrast
- **Device Detection** - Auto-responsive interface for mobile/tablet/desktop
- **Improved Mobile UX** - Better drag & drop and touch interactions

## 🎯 **Core Features Overview**

### **Personal Productivity**
- **Goals → Stories → Tasks** hierarchy with progress tracking
- **AI-Powered Planning** - Smart prioritization and calendar scheduling  
- **Kanban Board** - Drag & drop project management
- **Persona System** - Switch between Personal and Work contexts

### **🆕 NEW: Personal Collections**
- **Steam Games** - Track your gaming backlog with completion status
- **Movies & TV Shows** - Manage your entertainment watchlist
- **Books** - Reading progress and personal library
- **Custom Collections** - Any personal items you want to track

### **🆕 NEW: Mobile Experience**  
- **Auto-Detection** - Automatically optimizes for your device
- **Daily Focus** - Priority tasks for mobile productivity
- **Touch-Friendly** - One-tap completion and intuitive interactions

### **🆕 NEW: Visual Organization**
- **Mind Mapping** - See connections between goals, stories, and tasks
- **Interactive Canvas** - Zoom, pan, and explore your project structure
- **Visual Planning** - Better understanding of project relationships

## 🚀 **Quick Start**

### 1. **Adding Your First Items**

Click the **blue + button** (bottom-right) to:
- **G** - Add a Goal (personal vision/objective)  
- **S** - Add a Story (project within a goal)
- **T** - Add a Task (actionable item)
- **↓** - Import templates or CSV data

### 2. **Exploring New Features**

**For Personal Collections:**
- Go to **Personal Backlogs** in the main menu
- Add games, movies, books, or create custom collections
- Track progress and manage your entertainment/learning queue

**For Mobile Experience:**
- Visit on mobile device to auto-access the Priority Dashboard
- Use touch gestures for task completion
- Focus on daily priorities with urgent task alerts

**For Visual Planning:**
- Access **Visual Canvas** from the main menu  
- Explore goal-story-task relationships interactively
- Use zoom and pan to navigate your project structure

### 3. **Using Templates**

Click the **↓ button** → **Quick Start Templates** tab:

Available templates:
- **Health**: Marathon training with workout plan
- **Wealth**: Emergency fund building  
- **Growth**: Learning React Native development
- **Tribe**: Strengthen family relationships
- **Home**: Organize and declutter home

Each template includes:
- ✅ Complete goal with KPIs
- ✅ Related stories (projects)  
- ✅ Sample tasks to get started

### 3. **CSV Import/Export**

For bulk import, use the **CSV Import** tab with these formats:

## 📊 **Data Structure BOB Expects**

### Goals CSV Format
```csv
title,description,theme,size,timeToMasterHours,confidence,targetDate,kpi1Name,kpi1Target,kpi1Unit
"Complete Marathon Training","Train for and complete a marathon","Health","L",180,0.7,"2025-12-31","Weekly distance","50","km"
"Build Emergency Fund","Save 6 months expenses","Wealth","M",60,0.8,"2025-10-31","Fund amount","25000","USD"
```

**Fields Explained:**
- `title` - Goal name (required)
- `description` - Detailed description  
- `theme` - Health|Growth|Wealth|Tribe|Home
- `size` - XS|S|M|L|XL (complexity/scope)
- `timeToMasterHours` - Estimated hours to complete
- `confidence` - 0.0-1.0 (how confident you are)
- `targetDate` - YYYY-MM-DD format
- `kpi1Name/Target/Unit` - Key Performance Indicator

### Stories CSV Format  
```csv
title,goalTitle,priority,points,status,acceptanceCriteria1,acceptanceCriteria2
"Create training schedule","Complete Marathon Training","P1",3,"backlog","Schedule includes 4 running days","Rest days planned"
"Purchase running gear","Complete Marathon Training","P2",2,"backlog","Running shoes purchased","Weather gear acquired"
```

**Fields Explained:**
- `title` - Story name (required)
- `goalTitle` - Which goal this belongs to
- `priority` - P1|P2|P3 (P1 = highest)
- `points` - Story points (1-8, complexity estimate)
- `status` - backlog|active|done
- `acceptanceCriteria1/2/3` - What defines "done"

### Tasks CSV Format
```csv
title,parentTitle,parentType,effort,priority,estimateMin,description,theme,status
"30-minute morning run","Create training schedule","story","M","high",30,"Easy pace base building","Health","planned"
"Research running shoes","Purchase running gear","story","S","med",45,"Compare and select shoes","Health","planned"
```

**Fields Explained:**
- `title` - Task name (required)
- `parentTitle` - Which story/project this belongs to  
- `parentType` - story|project
- `effort` - S|M|L (Small=15-30min, Medium=30-60min, Large=1-2hr)
- `priority` - low|med|high
- `estimateMin` - Minutes to complete
- `theme` - Health|Growth|Wealth|Tribe|Home
- `status` - planned|in_progress|done

## 🎯 **BOB's Data Model**

### Hierarchy
```
Goal (Personal only)
├── Story 1
│   ├── Task 1
│   ├── Task 2  
│   └── Task 3
└── Story 2
    ├── Task 4
    └── Task 5

Work Project
├── Task A
├── Task B
└── Task C
```

### Key Rules
1. **Goals** are personal only (Health, Growth, Wealth, Tribe, Home)
2. **Work Projects** don't link to goals
3. **Stories** can't be completed until all tasks are done
4. **Tasks** sync to iOS Reminders (separate Personal/Work lists)
5. **Personas** keep Personal and Work completely separate

## 🤖 **AI Planning System**

Navigate to **AI Planner** to:
1. Let AI analyze your tasks and goals
2. Generate calendar blocks for optimal scheduling  
3. Respect your wake/sleep times and preferences
4. Balance weekly theme targets (Health, Growth, etc.)
5. Automatically sync to Google Calendar

**Prerequisites for AI Planning:**
- Add some tasks/goals first
- Set up planning preferences (wake/sleep times)
- Connect Google Calendar (optional but recommended)

## 🔧 **Troubleshooting**

### "Cannot save stories/tasks"
- Make sure you're signed in
- Check your persona (Personal vs Work) in the header
- For stories: Link them to a goal first

### "Planning doesn't work"  
- Add at least 2-3 tasks first
- Set up planning preferences
- Check browser console for errors

### "Import failed"
- Verify CSV format matches templates exactly
- Check for special characters in data
- Try smaller batches (10-20 items at a time)

## 📱 **Navigation**

- **Dashboard** - Overview and stats
- **Stories** - Kanban board (Personal only)  
- **Tasks** - Task list (both Personal/Work)
- **AI Planner** - Calendar planning system
- **Goals** - Goal management (Personal only)
- **Admin** - Bulk operations and settings

## 💡 **Pro Tips**

1. **Start Small** - Use templates first, then customize
2. **Use Themes** - Categorize everything for better AI planning
3. **Set Estimates** - Helps with calendar planning
4. **Link Everything** - Tasks → Stories → Goals for progress tracking
5. **Regular Reviews** - Check progress weekly and adjust

Need help? Check the browser console for detailed error messages or start with the templates to understand the structure.
