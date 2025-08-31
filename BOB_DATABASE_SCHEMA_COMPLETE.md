# 🗄️ BOB Application - Complete Database Schema

**Document Version:** 3.0.1  
**Last Updated:** August 31, 2025  
**Status:** Production Schema Documentation  

## 📊 **Executive Summary**

This document provides the complete database schema for the BOB productivity platform, a multi-layered personal and work productivity system built on Firebase Firestore. The schema supports goal-oriented task management, calendar integration, activity tracking, and AI-powered planning across personal and work contexts.

## 🏗️ **Architecture Overview**

### **Database Technology**
- **Platform:** Firebase Firestore (NoSQL Document Database)
- **Authentication:** Firebase Auth with UID-based ownership
- **Real-time:** Firestore real-time listeners for live updates
- **Security:** Rule-based access control with owner validation

### **Core Design Principles**
1. **Persona Separation**: Clear isolation between 'personal' and 'work' contexts
2. **Hierarchical Relationships**: Goal → Story → Task (Personal) | Project → Task (Work)
3. **Polymorphic Parents**: Tasks can belong to either Stories or Projects
4. **Audit Trail**: Complete activity tracking across all entities
5. **AI Integration**: Built-in fields for AI suggestions and confidence scoring
6. **Legacy Compatibility**: Maintains backward compatibility for migration
7. **Sync State Management**: Offline/online synchronization support

---

## 📋 **Collections Overview**

| Collection | Purpose | Persona Support | Relationships | Security Rules |
|------------|---------|----------------|---------------|----------------|
| `goals` | Personal goal management | Personal only | Parent to Stories | ✅ Owner-based |
| `stories` | User stories/initiatives | Personal only | Child of Goals, Parent to Tasks | ✅ Owner-based |
| `tasks` | Individual work items | Personal + Work | Child of Stories/Projects | ✅ Owner-based |
| `sprints` | Sprint management | Cross-persona | Contains Stories/Tasks | ⚠️ Missing rules |
| `projects` | Work projects | Work only | Parent to Tasks | ⚠️ Missing rules |
| `calendar_blocks` | Calendar integration | Personal + Work | Links to Tasks/Goals | ⚠️ Missing rules |
| `activity_stream` | Audit trail | Cross-entity | Tracks all changes | ⚠️ Missing rules |
| `personalItems` | Personal lists | Personal only | Standalone items | ⚠️ Missing rules |
| `habits` | Habit tracking | Personal only | Links to Goals | ✅ Owner-based |
| `profiles` | User preferences | Per-user | Configuration data | ✅ User-specific |

---

## 🎯 **Detailed Schema Definitions**

### **1. Goals Collection** (`goals`)

**Purpose:** Personal goal management with theme-based categorization  
**Access Pattern:** Owner-only read/write  
**Relationships:** One-to-many with Stories  

```typescript
interface Goal {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  
  // === CORE FIELDS ===
  title: string;                 // Goal title/name (required)
  description?: string;          // Optional detailed description
  persona: 'personal';           // Always personal (per business requirements)
  
  // === CLASSIFICATION ===
  theme: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
  size: 'XS' | 'S' | 'M' | 'L' | 'XL';    // Effort sizing
  category?: string;             // Legacy field for backward compatibility
  
  // === PLANNING & METRICS ===
  timeToMasterHours: number;     // Estimated effort in hours
  targetDate?: string;           // Target completion date (ISO string)
  confidence: number;            // Confidence level (0-100)
  kpis?: Array<{                 // Key Performance Indicators
    name: string;                // KPI name
    target: number;              // Target value
    unit: string;                // Unit of measurement
  }>;
  
  // === STATUS MANAGEMENT ===
  status: 'new' | 'active' | 'paused' | 'done' | 'dropped';
  priority?: 'low' | 'medium' | 'high';  // Legacy field
  
  // === OWNERSHIP & AUDIT ===
  ownerUid: string;              // Firebase Auth UID (required)
  createdAt: any;                // Firebase Timestamp
  updatedAt: any;                // Firebase Timestamp
  dueDate?: number;              // Legacy timestamp field
}
```

**Business Rules:**
- Goals are personal-only per application requirements
- Theme determines color coding and categorization
- Size affects effort estimation and planning
- Status transitions trigger activity stream entries

**Sample Document:**
```json
{
  "id": "goal_123",
  "title": "Complete Marathon Training",
  "description": "Train for and complete first marathon",
  "persona": "personal",
  "theme": "Health",
  "size": "L",
  "timeToMasterHours": 240,
  "targetDate": "2025-12-31",
  "confidence": 85,
  "status": "active",
  "ownerUid": "user_456",
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-08-31T12:00:00Z"
}
```

### **2. Stories Collection** (`stories`)

**Purpose:** User stories and initiatives that break down goals into manageable pieces  
**Access Pattern:** Owner-only read/write  
**Relationships:** Child of Goals, Parent to Tasks  

```typescript
interface Story {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  
  // === CORE FIELDS ===
  title: string;                 // Story title/name (required)
  description?: string;          // Optional detailed description
  persona: 'personal';           // Always personal (per business requirements)
  
  // === RELATIONSHIPS ===
  goalId: string;                // Required parent Goal ID (foreign key)
  theme?: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home'; // Inherited from goal
  sprintId?: string;             // Optional Sprint assignment
  
  // === STORY MANAGEMENT ===
  status: 'backlog' | 'active' | 'done' | 'defect';
  priority: 'P1' | 'P2' | 'P3'; // Priority levels (P1 = highest)
  points: number;                // Story points for estimation
  wipLimit: number;              // Work-in-progress limit
  orderIndex: number;            // Kanban board ordering (timestamp-based)
  
  // === ENHANCED FEATURES ===
  tags?: string[];               // Categorization tags
  acceptanceCriteria?: string[]; // Success criteria checklist
  
  // === OWNERSHIP & AUDIT ===
  ownerUid: string;              // Firebase Auth UID (required)
  createdAt: any;                // Firebase Timestamp
  updatedAt: any;                // Firebase Timestamp
  dueDate?: number;              // Legacy compatibility field
}
```

**Business Rules:**
- Stories cannot transition to 'done' while linked tasks are incomplete
- Theme is inherited from parent Goal
- Priority affects kanban ordering and sprint planning
- Points are used for velocity calculations

**Sample Document:**
```json
{
  "id": "story_789",
  "title": "Build weekly running schedule",
  "description": "Create structured training plan",
  "persona": "personal",
  "goalId": "goal_123",
  "theme": "Health",
  "status": "active",
  "priority": "P1",
  "points": 5,
  "wipLimit": 3,
  "orderIndex": 1693497600000,
  "ownerUid": "user_456",
  "createdAt": "2025-01-15T00:00:00Z",
  "updatedAt": "2025-08-31T12:00:00Z"
}
```

### **3. Tasks Collection** (`tasks`)

**Purpose:** Individual work items that represent actionable units of work  
**Access Pattern:** Owner-only read/write  
**Relationships:** Child of Stories OR Projects (polymorphic)  

```typescript
interface Task {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  
  // === CORE FIELDS ===
  title: string;                 // Task title/name (required)
  description?: string;          // Optional detailed description
  persona: 'personal' | 'work';  // Context persona (required)
  
  // === POLYMORPHIC RELATIONSHIPS ===
  parentType: 'story' | 'project';  // Parent entity type (required)
  parentId: string;              // Parent entity ID (foreign key)
  sprintId?: string;             // Optional Sprint assignment
  projectId?: string;            // Optional Project assignment (work tasks)
  
  // === TASK MANAGEMENT ===
  status: 'todo' | 'planned' | 'in-progress' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'med' | 'high';
  effort: 'S' | 'M' | 'L';       // T-shirt sizing (Small/Medium/Large)
  estimateMin: number;           // Time estimate in minutes
  
  // === SCHEDULING ===
  startDate?: number;            // Start timestamp (Unix)
  dueDate?: number;              // Due timestamp (Unix)
  
  // === ENHANCED FEATURES ===
  labels?: string[];             // Categorization labels
  tags?: string[];               // Additional tags
  blockedBy?: string[];          // Array of blocking task IDs
  dependsOn?: string[];          // Array of dependency task IDs
  checklist?: Array<{           // Sub-task checklist
    text: string;                // Checklist item description
    done: boolean;               // Completion status
  }>;
  attachments?: Array<{         // File attachments
    name: string;                // Attachment name
    url: string;                 // Storage URL
  }>;
  
  // === AI & INTEGRATION ===
  alignedToGoal: boolean;        // Goal alignment flag
  theme?: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
  source: 'ios_reminder' | 'web' | 'ai' | 'gmail' | 'sheets';
  sourceRef?: string;            // Source system reference ID
  aiSuggestedLinks?: Array<{     // AI-generated suggestions
    goalId: string;              // Suggested goal link
    storyId?: string;            // Suggested story link
    confidence: number;          // AI confidence (0-100)
    rationale: string;           // AI reasoning
  }>;
  aiLinkConfidence: number;      // Overall AI confidence score
  hasGoal: boolean;              // Quick goal linkage check
  
  // === SYNC & STATE MANAGEMENT ===
  syncState: 'clean' | 'dirty' | 'pending_push' | 'awaiting_ack';
  deviceUpdatedAt?: number;      // Device-side timestamp
  serverUpdatedAt: number;       // Server-side timestamp
  createdBy: string;             // Creator identifier
  
  // === OWNERSHIP & AUDIT ===
  ownerUid: string;              // Firebase Auth UID (required)
  createdAt?: number;            // Legacy timestamp
  updatedAt?: number;            // Legacy timestamp
  
  // === LEGACY COMPATIBILITY ===
  reference?: string;            // Legacy reference field
  storyId?: string;              // Legacy story link (use parentId)
  goalId?: string;               // Legacy goal link
  deleted?: boolean;             // Soft delete flag
}
```

**Business Rules:**
- Tasks must have either parentType='story' with valid Story parent, or parentType='project' with valid Project parent
- Personal tasks typically link to Stories, Work tasks to Projects
- Status transitions trigger activity stream logging
- AI suggestions help with automatic goal/story linking

**Sample Document:**
```json
{
  "id": "task_101",
  "title": "Plan Monday 5K route",
  "description": "Map out safe running route for Monday training",
  "persona": "personal",
  "parentType": "story",
  "parentId": "story_789",
  "status": "todo",
  "priority": "med",
  "effort": "S",
  "estimateMin": 15,
  "dueDate": 1693497600000,
  "alignedToGoal": true,
  "theme": "Health",
  "source": "web",
  "aiLinkConfidence": 95,
  "hasGoal": true,
  "syncState": "clean",
  "serverUpdatedAt": 1693497600000,
  "createdBy": "user_456",
  "ownerUid": "user_456"
}
```

### **4. Sprints Collection** (`sprints`)

**Purpose:** Sprint management for agile planning cycles  
**Access Pattern:** Owner-only read/write  
**Relationships:** Many-to-many with Stories and Tasks  

```typescript
interface Sprint {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  
  // === CORE FIELDS ===
  name: string;                  // Sprint name/title (required)
  
  // === SPRINT TIMELINE ===
  startDate: number;             // Sprint start timestamp (Unix)
  endDate: number;               // Sprint end timestamp (Unix)
  planningDate: number;          // Planning session timestamp
  retroDate: number;             // Retrospective timestamp
  
  // === OWNERSHIP ===
  ownerUid: string;              // Firebase Auth UID (required)
}
```

**Business Rules:**
- Sprint assignment links are maintained in Stories and Tasks via sprintId
- Sprint dates determine active sprint calculations
- Cross-persona support (contains both personal and work items)

**Sample Document:**
```json
{
  "id": "sprint_202",
  "name": "Health Focus Sprint #3",
  "startDate": 1693440000000,
  "endDate": 1694649600000,
  "planningDate": 1693440000000,
  "retroDate": 1694649600000,
  "ownerUid": "user_456"
}
```

### **5. WorkProject Collection** (`projects`)

**Purpose:** Work-context project management for professional tasks  
**Access Pattern:** Owner-only read/write  
**Relationships:** One-to-many with Tasks  

```typescript
interface WorkProject {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  
  // === CORE FIELDS ===
  title: string;                 // Project title/name (required)
  persona: 'work';               // Always work context
  
  // === PROJECT DETAILS ===
  client?: string;               // Client/customer name
  team?: string;                 // Team assignment
  tags?: string[];               // Project categorization tags
  
  // === PROJECT MANAGEMENT ===
  status: 'backlog' | 'active' | 'done';
  wipLimit: number;              // Work-in-progress limit
  
  // === OWNERSHIP & AUDIT ===
  ownerUid: string;              // Firebase Auth UID (required)
  createdAt: any;                // Firebase Timestamp
  updatedAt: any;                // Firebase Timestamp
}
```

**Business Rules:**
- Projects are work-only per application design
- Tasks link to Projects via parentType='project' and parentId
- Status affects project visibility and task assignment

**Sample Document:**
```json
{
  "id": "project_303",
  "title": "Q4 Platform Migration",
  "persona": "work",
  "client": "TechCorp Inc",
  "team": "Backend Engineering",
  "status": "active",
  "wipLimit": 5,
  "tags": ["migration", "infrastructure"],
  "ownerUid": "user_456",
  "createdAt": "2025-08-01T00:00:00Z",
  "updatedAt": "2025-08-31T12:00:00Z"
}
```

### **6. Calendar Blocks Collection** (`calendar_blocks`)

**Purpose:** Calendar integration and time blocking for tasks and goals  
**Access Pattern:** Owner-only read/write  
**Relationships:** Links to Tasks and Goals  

```typescript
interface CalendarBlock {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  
  // === INTEGRATION ===
  googleEventId?: string;        // Google Calendar event ID
  
  // === RELATIONSHIPS ===
  taskId?: string;               // Linked task ID
  goalId?: string;               // Linked goal ID
  persona: 'personal' | 'work';  // Context persona
  
  // === CLASSIFICATION ===
  theme: 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home';
  category: 'Tribe' | 'Chores' | 'Gaming' | 'Fitness' | 'Wellbeing' | 'Sauna' | 'Sleep';
  
  // === SCHEDULING ===
  start: number;                 // Start timestamp (Unix)
  end: number;                   // End timestamp (Unix)
  flexibility: 'hard' | 'soft'; // Scheduling flexibility
  
  // === STATE MANAGEMENT ===
  status: 'proposed' | 'applied' | 'superseded';
  colorId?: string;              // Calendar color identifier
  visibility: 'default' | 'private'; // Calendar visibility
  
  // === AI & AUTOMATION ===
  createdBy: 'ai' | 'user';      // Creation source
  rationale?: string;            // AI reasoning for scheduling
  version: number;               // Version for conflict resolution
  supersededBy?: string;         // ID of superseding block
  
  // === OWNERSHIP & AUDIT ===
  ownerUid: string;              // Firebase Auth UID (required)
  createdAt: number;             // Creation timestamp
  updatedAt: number;             // Update timestamp
}
```

**Business Rules:**
- Calendar blocks enable time-blocking workflow
- AI-created blocks include rationale for scheduling decisions
- Version management prevents scheduling conflicts
- Google Calendar sync via googleEventId

**Sample Document:**
```json
{
  "id": "block_404",
  "googleEventId": "abc123_google",
  "taskId": "task_101",
  "persona": "personal",
  "theme": "Health",
  "category": "Fitness",
  "start": 1693497600000,
  "end": 1693499400000,
  "flexibility": "soft",
  "status": "applied",
  "colorId": "health_green",
  "visibility": "default",
  "createdBy": "ai",
  "rationale": "Optimal morning slot for running",
  "version": 1,
  "ownerUid": "user_456",
  "createdAt": 1693497600000,
  "updatedAt": 1693497600000
}
```

### **7. Activity Stream Collection** (`activity_stream`)

**Purpose:** Comprehensive audit trail for all entity changes  
**Access Pattern:** Owner-based queries with entity filtering  
**Relationships:** References all other collections  

```typescript
interface ActivityEntry {
  // === IDENTITY ===
  id?: string;                   // Auto-generated Firestore document ID
  
  // === TARGET ENTITY ===
  entityId: string;              // Target entity ID (required)
  entityType: 'goal' | 'story' | 'task'; // Target entity type (required)
  
  // === ACTIVITY CLASSIFICATION ===
  activityType: 'created' | 'updated' | 'deleted' | 'note_added' | 
                'status_changed' | 'sprint_changed' | 'priority_changed';
  
  // === USER CONTEXT ===
  userId: string;                // Actor user ID (required)
  userEmail?: string;            // Actor email for display
  timestamp: Timestamp;          // Activity timestamp (Firestore)
  
  // === CHANGE DETAILS ===
  fieldName?: string;            // Changed field name (for updates)
  oldValue?: any;                // Previous value (for field changes)
  newValue?: any;                // New value (for field changes)
  
  // === NOTES ===
  noteContent?: string;          // Note content (for note_added type)
  
  // === GENERAL ===
  description: string;           // Human-readable description (required)
  
  // === METADATA ===
  persona?: string;              // Context persona
  referenceNumber?: string;      // Reference identifier
}
```

**Business Rules:**
- All entity modifications generate activity entries
- Field-level change tracking with before/after values
- User attribution for all activities
- Searchable by entity, user, or activity type

**Sample Document:**
```json
{
  "id": "activity_505",
  "entityId": "task_101",
  "entityType": "task",
  "activityType": "status_changed",
  "userId": "user_456",
  "userEmail": "user@example.com",
  "timestamp": "2025-08-31T12:00:00Z",
  "fieldName": "status",
  "oldValue": "todo",
  "newValue": "in-progress",
  "description": "Status changed from 'todo' to 'in-progress'",
  "persona": "personal"
}
```

### **8. Personal Items Collection** (`personalItems`)

**Purpose:** General personal list management outside of goal hierarchy  
**Access Pattern:** Owner-only read/write  
**Relationships:** Standalone items  

```typescript
interface PersonalItem {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  
  // === CORE FIELDS ===
  title: string;                 // Item title/name (required)
  description?: string;          // Optional description
  persona: string;               // Context persona
  
  // === CLASSIFICATION ===
  category: 'personal' | 'work' | 'learning' | 'health' | 'finance';
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in-progress' | 'waiting' | 'done';
  
  // === SCHEDULING ===
  dueDate?: number;              // Due timestamp (Unix)
  
  // === ENHANCED FEATURES ===
  tags?: string[];               // Categorization tags
  
  // === OWNERSHIP & AUDIT ===
  ownerUid: string;              // Firebase Auth UID (required)
  createdAt: number;             // Creation timestamp
  updatedAt: number;             // Update timestamp
}
```

**Business Rules:**
- Independent of goal/story hierarchy
- Used for miscellaneous personal tracking
- Supports standard task-like workflow

**Sample Document:**
```json
{
  "id": "personal_606",
  "title": "Schedule dentist appointment",
  "description": "Book routine cleaning",
  "persona": "personal",
  "category": "health",
  "priority": "medium",
  "status": "todo",
  "dueDate": 1693584000000,
  "tags": ["health", "appointment"],
  "ownerUid": "user_456",
  "createdAt": 1693497600000,
  "updatedAt": 1693497600000
}
```

### **9. Habits Collection** (`habits`)

**Purpose:** Habit tracking with goal integration and daily logging  
**Access Pattern:** Owner-only read/write with subcollection entries  
**Relationships:** Links to Goals, contains HabitEntry subcollection  

```typescript
interface IHabit {
  // === IDENTITY ===
  id: string;                    // Auto-generated Firestore document ID
  userId: string;                // User identifier (matches ownerUid pattern)
  
  // === CORE FIELDS ===
  name: string;                  // Habit name (required)
  description?: string;          // Optional description
  
  // === HABIT CONFIGURATION ===
  frequency: "daily" | "weekly" | "monthly" | "custom";
  targetValue: number;           // Target value (e.g., 1 for daily, 5 for 5x/week)
  unit?: string;                 // Unit of measurement (e.g., "times", "minutes")
  
  // === GOAL INTEGRATION ===
  linkedGoalId?: string;         // Linked goal ID
  linkedGoalName?: string;       // Cached goal name for display
  
  // === STATUS & UI ===
  isActive: boolean;             // Active status
  color?: string;                // UI color representation
  
  // === TIMESTAMPS ===
  createdAt: number;             // Creation timestamp (Unix)
  updatedAt: number;             // Update timestamp (Unix)
}

// === HABIT ENTRIES SUBCOLLECTION ===
// Path: habits/{habitId}/habitEntries/{entryId}
interface IHabitEntry {
  // === IDENTITY ===
  id: string;                    // Date string (YYYY-MM-DD format)
  habitId: string;               // Parent habit ID
  
  // === TRACKING DATA ===
  date: number;                  // Day start timestamp (Unix)
  value: number;                 // Actual value achieved
  isCompleted: boolean;          // Completion status (derived or explicit)
  notes?: string;                // Optional notes
  
  // === TIMESTAMPS ===
  createdAt: number;             // Creation timestamp (Unix)
  updatedAt: number;             // Update timestamp (Unix)
}
```

**Business Rules:**
- Habits can link to Goals for progress tracking
- Daily entries stored in subcollection for scalability
- Frequency determines completion calculation
- Support for both boolean and numeric tracking

**Sample Documents:**
```json
// Parent habit document
{
  "id": "habit_707",
  "userId": "user_456",
  "name": "Morning Run",
  "description": "30 minute morning run",
  "frequency": "daily",
  "targetValue": 1,
  "unit": "times",
  "linkedGoalId": "goal_123",
  "linkedGoalName": "Complete Marathon Training",
  "isActive": true,
  "color": "#4CAF50",
  "createdAt": 1693497600000,
  "updatedAt": 1693497600000
}

// Habit entry subcollection document
{
  "id": "2025-08-31",
  "habitId": "habit_707",
  "date": 1693440000000,
  "value": 1,
  "isCompleted": true,
  "notes": "Great run in the park",
  "createdAt": 1693497600000,
  "updatedAt": 1693497600000
}
```

### **10. User Profiles Collection** (`profiles`)

**Purpose:** User-specific preferences and planning configuration  
**Access Pattern:** User-specific read/write (uid-based)  
**Relationships:** Per-user configuration  

```typescript
interface PlanningPrefs {
  // === IDENTITY ===
  uid: string;                   // User ID (matches Firebase Auth UID)
  
  // === DAILY SCHEDULE ===
  wakeTime: string;              // Wake time (HH:mm format)
  sleepTime: string;             // Sleep time (HH:mm format)
  quietHours: Array<{           // Quiet periods (no scheduling)
    start: string;               // Start time (HH:mm)
    end: string;                 // End time (HH:mm)
  }>;
  
  // === HEALTH & FITNESS ===
  maxHiSessionsPerWeek: number;  // Maximum high-intensity sessions
  minRecoveryGapHours: number;   // Minimum recovery gap in hours
  
  // === THEME TARGETS ===
  weeklyThemeTargets: {          // Weekly time allocation targets
    Health: number;              // Health theme hours per week
    Tribe: number;               // Tribe theme hours per week
    Wealth: number;              // Wealth theme hours per week
    Growth: number;              // Growth theme hours per week
    Home: number;                // Home theme hours per week
  };
  
  // === FACILITY HOURS ===
  poolHours?: Array<{           // Pool facility availability
    day: number;                // Day of week (0=Sunday, 6=Saturday)
    open: string;               // Opening time (HH:mm)
    close: string;              // Closing time (HH:mm)
  }>;
  gymHours?: Array<{            // Gym facility availability
    day: number;                // Day of week (0=Sunday, 6=Saturday)
    open: string;               // Opening time (HH:mm)
    close: string;              // Closing time (HH:mm)
  }>;
  
  // === AI SETTINGS ===
  autoApplyThreshold: number;    // Auto-apply threshold (0-100)
}
```

**Business Rules:**
- One profile per user (1:1 relationship with Firebase Auth)
- Used by AI planning algorithms for personalized scheduling
- Theme targets drive weekly planning optimization
- Facility hours constrain scheduling availability

**Sample Document:**
```json
{
  "uid": "user_456",
  "wakeTime": "06:00",
  "sleepTime": "22:00",
  "quietHours": [
    {"start": "12:00", "end": "13:00"},
    {"start": "18:00", "end": "19:00"}
  ],
  "maxHiSessionsPerWeek": 3,
  "minRecoveryGapHours": 24,
  "weeklyThemeTargets": {
    "Health": 8,
    "Tribe": 6,
    "Wealth": 10,
    "Growth": 4,
    "Home": 3
  },
  "poolHours": [
    {"day": 1, "open": "06:00", "close": "22:00"}
  ],
  "autoApplyThreshold": 80
}
```

---

## 🔗 **Relationship Mapping**

### **Primary Hierarchical Relationships**
```
Personal Context:
Goals (1) ──→ Stories (*) ──→ Tasks (*)

Work Context:
Projects (1) ──→ Tasks (*)

Cross-Context:
Users (1) ──→ Profiles (1)
Goals (1) ──→ Habits (*)
Sprints (*) ←→ Stories (*)
Sprints (*) ←→ Tasks (*)
```

### **Secondary Relationships**
```
Integration & Tracking:
Tasks (*) ──→ Calendar Blocks (*)
Goals (*) ──→ Calendar Blocks (*)
All Entities (*) ──→ Activity Stream (*)

Habit Tracking:
Habits (1) ──→ HabitEntries (*) [subcollection]
```

### **Polymorphic Relationships**
```
Tasks can belong to:
- Stories (Personal context): parentType='story', parentId=storyId
- Projects (Work context): parentType='project', parentId=projectId

Calendar Blocks can link to:
- Tasks: taskId field populated
- Goals: goalId field populated
```

---

## 🔒 **Security Rules Analysis**

### **Current Firestore Security Rules Coverage**

```javascript
// Implemented Rules (✅)
match /goals/{id}     { allow create: if isOwnerForCreate(); allow read, update, delete: if isOwner(); }
match /tasks/{id}     { allow create: if isOwnerForCreate(); allow read, update, delete: if isOwner(); }
match /stories/{id}   { allow create: if isOwnerForCreate(); allow read, update, delete: if isOwner(); }
match /habits/{id} {
  allow create: if isOwnerForCreate();
  allow read, update, delete: if isOwner();
  match /habitEntries/{entryId} {
    allow create: if isOwner();
    allow read, update, delete: if isOwner();
  }
}
match /profiles/{uid} {
  allow read, update, delete: if isSignedIn() && request.auth.uid == uid;
  allow create: if isSignedIn() && request.auth.uid == uid && request.resource.data.ownerUid == uid;
}

// Missing Rules (⚠️) - Security Gap
- sprints collection
- projects collection  
- calendar_blocks collection
- activity_stream collection
- personalItems collection
```

### **Required Security Rule Additions**

```javascript
// RECOMMENDED ADDITIONS TO FIRESTORE.RULES

match /sprints/{id} { 
  allow create: if isOwnerForCreate(); 
  allow read, update, delete: if isOwner(); 
}

match /projects/{id} { 
  allow create: if isOwnerForCreate(); 
  allow read, update, delete: if isOwner(); 
}

match /calendar_blocks/{id} { 
  allow create: if isOwnerForCreate(); 
  allow read, update, delete: if isOwner(); 
}

match /activity_stream/{id} { 
  allow create: if isOwnerForCreate(); 
  allow read, update, delete: if isOwner(); 
}

match /personalItems/{id} { 
  allow create: if isOwnerForCreate(); 
  allow read, update, delete: if isOwner(); 
}
```

---

## 📊 **Data Volume & Performance Considerations**

### **Expected Collection Sizes (Per User)**
- **Goals:** 10-50 active goals
- **Stories:** 50-200 active stories
- **Tasks:** 200-1000 active tasks
- **Sprints:** 20-50 historical sprints
- **Projects:** 5-20 active projects
- **Calendar Blocks:** 100-500 per month
- **Activity Stream:** 1000-10000 entries per month
- **Personal Items:** 50-200 items
- **Habits:** 5-20 active habits
- **Habit Entries:** 30-600 per month (per habit)

### **Query Performance Optimization**

**Recommended Firestore Indexes:**
```javascript
// High-priority indexes for performance
{
  "collectionGroup": "tasks",
  "queryScope": "COLLECTION",
  "fields": [
    {"fieldPath": "ownerUid", "order": "ASCENDING"},
    {"fieldPath": "persona", "order": "ASCENDING"},
    {"fieldPath": "status", "order": "ASCENDING"},
    {"fieldPath": "priority", "order": "DESCENDING"}
  ]
}

{
  "collectionGroup": "activity_stream",
  "queryScope": "COLLECTION", 
  "fields": [
    {"fieldPath": "ownerUid", "order": "ASCENDING"},
    {"fieldPath": "entityId", "order": "ASCENDING"},
    {"fieldPath": "timestamp", "order": "DESCENDING"}
  ]
}

{
  "collectionGroup": "stories",
  "queryScope": "COLLECTION",
  "fields": [
    {"fieldPath": "ownerUid", "order": "ASCENDING"},
    {"fieldPath": "goalId", "order": "ASCENDING"},
    {"fieldPath": "status", "order": "ASCENDING"},
    {"fieldPath": "orderIndex", "order": "ASCENDING"}
  ]
}
```

---

## 🎯 **Schema Design Patterns & Best Practices**

### **1. Persona-Based Data Isolation**
- Clear separation between 'personal' and 'work' contexts
- Enables focused queries and UI filtering
- Supports different workflow patterns per persona

### **2. Polymorphic Parent Relationships**
- Tasks can belong to Stories (personal) OR Projects (work)
- Implemented via parentType/parentId pattern
- Enables unified task management across contexts

### **3. Hierarchical Goal Structure**
```
Goal → Story → Task (Personal workflow)
Project → Task (Work workflow)
```

### **4. Activity Stream Audit Pattern**
- Comprehensive change tracking across all entities
- User attribution and timestamp for all modifications
- Supports compliance and debugging requirements

### **5. AI Integration Fields**
- Built-in confidence scoring for AI suggestions
- Rationale fields for explainable AI decisions
- Support for automated linking and scheduling

### **6. Legacy Compatibility**
- Maintains deprecated fields during migration periods
- Enables gradual schema evolution
- Reduces deployment risk

### **7. Sync State Management**
- Supports offline-first mobile applications
- Conflict resolution through version tracking
- Device/server timestamp coordination

---

## 🚨 **Critical Action Items**

### **Immediate Security Fixes Required**
1. **Add missing Firestore security rules** for 5 unprotected collections
2. **Implement owner validation** for all missing collections
3. **Add field validation** in security rules to prevent malformed data

### **Performance Optimization**
1. **Create composite indexes** for high-volume query patterns
2. **Implement pagination** for large result sets
3. **Add caching strategy** for frequently accessed data

### **Data Integrity**
1. **Add server-side validation** for critical business rules
2. **Implement cascade deletion** for dependent entities
3. **Add data consistency checks** for relationships

### **Monitoring & Observability**
1. **Add performance monitoring** for slow queries
2. **Implement data quality alerts** for schema violations
3. **Add usage analytics** for optimization insights

---

## 📚 **Documentation Standards**

This schema documentation follows enterprise documentation standards:

- **Version Control:** Semantic versioning with changelog
- **Field Definitions:** Complete type definitions with business context
- **Relationship Mapping:** Clear foreign key and association documentation
- **Security Analysis:** Comprehensive access control review
- **Performance Guidelines:** Query optimization recommendations
- **Business Rules:** Explicit constraint and validation documentation

**Last Updated:** August 31, 2025  
**Schema Version:** 3.0.1  
**Review Status:** Ready for AI analysis and recommendations  
**Next Review:** September 15, 2025  

---

*This document serves as the authoritative source for BOB application database schema and should be updated with any schema modifications.*
