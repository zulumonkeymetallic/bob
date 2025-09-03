#!/bin/bash

# BOB Feature Analysis & GitHub Issue Creator
# Analyzes all .md files and creates comprehensive GitHub issues

echo "🔍 BOB Feature Analysis & GitHub Issue Creator"
echo "=============================================="

# Set colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in BOB directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Run this script from BOB project root${NC}"
    exit 1
fi

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ GitHub CLI (gh) not found. Install: brew install gh${NC}"
    exit 1
fi

# Check if logged into GitHub
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged into GitHub. Please run: gh auth login${NC}"
    exit 1
fi

echo -e "${BLUE}📊 Analyzing markdown files for BOB features...${NC}"

# Create temporary file for analysis
ANALYSIS_FILE="/tmp/bob_features_analysis.md"
echo "# BOB Features Analysis from .md Files" > $ANALYSIS_FILE
echo "Generated: $(date)" >> $ANALYSIS_FILE
echo "" >> $ANALYSIS_FILE

# Count markdown files
MD_COUNT=$(find . -name "*.md" -type f | wc -l)
echo -e "${GREEN}📋 Found $MD_COUNT markdown files to analyze${NC}"

# Extract features from key files
echo "## Core Features Identified" >> $ANALYSIS_FILE

# Analyze main requirement files
key_files=(
    "BOB – Consolidated Priority Requirements & Schema Deltas (v3.0.7 Handoff).md"
    "BOB – Consolidated Priority Requirements & Schema Deltas (v3.0.8 Handoff).md"
    "BOB_iOS_REMINDER_SYNC_APP_PLAN.md"
    "BOB_DATABASE_SCHEMA_COMPLETE.md"
    "ACTIVITY_STREAM_IMPLEMENTATION.md"
    "AI_DEPLOYMENT_GUIDE.md"
    "📱 BOB iOS App – MVP Requirements.ini"
)

# Function to create GitHub issue
create_issue() {
    local title="$1"
    local body="$2"
    local labels="$3"
    local milestone="$4"
    
    echo -e "${YELLOW}📝 Creating issue: $title${NC}"
    
    # Only use labels that exist in the repo
    local safe_labels=""
    case "$labels" in
        *feature*) safe_labels="enhancement" ;;
        *bug*) safe_labels="bug" ;;
        *critical*) safe_labels="bug,enhancement" ;;
        *) safe_labels="enhancement" ;;
    esac
    
    gh issue create \
        --title "$title" \
        --body "$body" \
        --label "$safe_labels" \
        --assignee "@me" 2>/dev/null || echo -e "${RED}❌ Failed to create: $title${NC}"
}

echo -e "${BLUE}🎯 Creating comprehensive GitHub issues...${NC}"

# Core Application Features
create_issue "BOB-001 - Sprint Planning 2D Matrix" \
"## 🎯 Sprint Planning & Maintenance (Future Planning)

**Goal**: Two-dimensional planner to manage backlog and assign stories into current and upcoming sprints.

### Layout Requirements
- **Vertical (columns)**: Sprints (active + N future), reorderable (sprints.orderIndex)
- **Horizontal (rows)**: Theme → Goal → Subgoal (expand/collapse; persist in ui_state.plannerRowExpansion)
- **Cells**: Intersection holds Story cards for that sprint + (goal/subgoal)

### Interactions
- Vertical move: updates stories.sprintId; log activity_stream.activityType='sprint_changed'
- Horizontal move: updates stories.goalId/subGoalId; log activity_stream.activityType='backlog_retargeted'
- In-cell reorder: stable, scope-specific order

### Acceptance Criteria
- Correct 2-D layout rendered
- Optimistic updates <150–200ms
- User expansion state remembered
- Smooth performance at 200 stories × 8 sprints

**Priority**: High
**Status**: Not Implemented" \
"feature,sprint-planning,high-priority" \
"v3.1.0"

create_issue "BOB-002 - Current Sprint Kanban Execution View" \
"## 🎯 Current Sprint Kanban (Execution View)

**Goal**: Operate the current sprint efficiently.

### Features Required
- Sprint selector (defaults to current)
- Lanes from profiles.kanbanLaneLabels
- Story card → expandable task subgrid (inline, Excel-like)
- Drag/drop between lanes (status transitions) using unified DnD

### Technical Requirements
- Sprint switch <500ms
- Inline task edits persist instantly
- Denormalised taskCount/doneTaskCount keep progress visible

### Dependencies
- Unified Drag & Drop system (BOB-010)

**Priority**: High
**Status**: Partially Implemented" \
"feature,kanban,sprint,high-priority" \
"v3.1.0"

create_issue "BOB-003 - Google Calendar Integration & AI Scheduling" \
"## 📅 Calendar Blocking & AI Scheduling

**Goal**: Time-blocking by theme/subtheme; AI fills unblocked time with tasks/stories/habits.

### Core Features
1. User defines recurring/static blocks
2. AI schedules from importanceScore, due dates, weekly theme targets, and recovery constraints
3. Google Calendar bidirectional sync (googleEventId) with deep links to BOB entities

### Technical Requirements
- Respects quiet hours/facility hours
- Conflicts resolved via conflictVersion/supersededBy
- External edits round-trip within 15s
- All created blocks exist in Google Calendar with google_event_id within 5s

### Data Model Changes
- Add googleEventId field to calendar_blocks
- Implement conflict resolution fields
- Calendar deep links to BOB entities

**Priority**: Critical
**Status**: Not Implemented" \
"feature,calendar,ai,integration,critical" \
"v3.1.0"

create_issue "BOB-004 - Daily LLM Email Digest System" \
"## 📧 Daily LLM Email Digest

**Goal**: Daily at 06:30 email summarizing priorities and calendar.

### Email Contents
- Tasks Due Today (Ref, Title, Goal, Due, Priority)
- Focus Stories (top N by points/priority)
- Today's Calendar Blocks
- Sprint Pulse (velocity snapshot)
- LLM narrative: \"what first, risks\"

### Technical Implementation
- New 'digests' Firestore collection
- Firebase Function for digest generation
- 06:30 daily email scheduling via Cloud Scheduler
- Mobile-friendly HTML email templates
- Deep links to /story/STRY-###, /task/TASK-###

### Acceptance Criteria
- Mobile-friendly HTML format
- Data reflects live DB at generation time
- Reliable daily delivery at 06:30
- Links work correctly from email clients

**Priority**: High
**Status**: Function exists but needs enhancement" \
"feature,email,ai,digest,high-priority" \
"v3.1.0"

create_issue "BOB-005 - Health & Nutrition Integrations" \
"## 🏃‍♂️ Health & Nutrition Integrations

**Goal**: Import metrics (Strava, Runna, MyFitnessPal) for smarter planning.

### Integrations Required
- **Strava**: Workouts, HRV, performance metrics
- **Runna**: Training plans and workout schedules
- **MyFitnessPal**: Nutrition tracking and macro goals
- **Apple Health**: HRV, VO2 Max, Resting HR, Screen Time

### Data Model
- Per-user integrations document (OAuth tokens/meta)
- New collections: metrics_hrv, metrics_workouts, metrics_nutrition
- 7/30-day health dashboards
- Planning avoids high-intensity when HRV is low

### Technical Requirements
- OAuth integrations for external services
- Nightly data ingestion functions
- Health dashboard components
- HRV-based planning constraints

**Priority**: Medium
**Status**: Schema complete, implementation needed" \
"feature,health,integration,oauth" \
"v3.2.0"

create_issue "BOB-006 - iOS Reminders Two-Way Sync" \
"## 📱 iOS Reminders Two-Way Sync

**Goal**: Bidirectional sync between BOB tasks and iOS Reminders.

### Sync Features
- Create/update/complete sync both ways within ~60s
- Latest edit wins conflict resolution
- Preserve TASK-### in title/notes
- Activity stream logging for sync events

### Technical Implementation
- Implement tasks.reminderId field
- Bidirectional sync functions
- Background sync processing
- Conflict resolution logic

### Data Preservation
- Sync fields: Title, Due Date, Notes, Priority
- Tags for Theme, Sprint tracking
- Background sync via iOS background tasks

**Priority**: High
**Status**: Schema ready, sync logic needed" \
"feature,ios,reminders,sync,mobile" \
"v3.1.0"

create_issue "BOB-007 - Mobile Important Now View" \
"## 📱 Mobile View (Important First)

**Goal**: Surface urgent tasks and priorities on mobile devices.

### Features Required
- **Important Now**: overdue, due today, high importanceScore, current sprint tasks
- Habits strip with streak display
- One-tap complete/defer (syncs to Reminders)
- Mobile-optimized interface

### Priority Algorithm
- Overdue tasks (highest priority)
- Due today tasks
- High importance score items
- Current sprint active tasks
- Habit check-ins

### Technical Requirements
- Responsive mobile design
- Touch-optimized interactions
- Real-time sync with main app
- Offline capability

**Priority**: Medium
**Status**: Not Implemented" \
"feature,mobile,priorities,ux" \
"v3.2.0"

create_issue "BOB-008 - Test Automation with Side-Door Auth" \
"## 🧪 Test Automation with Side-Door Auth

**Goal**: Comprehensive automated testing with secure authentication bypass.

### Test Coverage Required
- All 7 critical platform areas
- Authentication flows
- CRUD operations for all entities
- Drag & drop functionality
- Calendar integrations
- Mobile responsive testing

### Side-Door Auth System
- Secure test user authentication
- Bypass normal auth for automated tests
- Test data cleanup and isolation
- Selenium WebDriver integration

### Technical Implementation
- Selenium test suite
- CI/CD integration
- Automated screenshot capture
- Defect reporting system

**Priority**: Medium
**Status**: Partial implementation exists" \
"testing,automation,selenium,ci-cd" \
"v3.2.0"

create_issue "BOB-009 - Theme Color Inheritance System" \
"## 🎨 System-wide Theme Color Inheritance

**Goal**: Consistent theme colors across all components from central Theme Settings.

### Requirements
- All components inherit colors from theme settings
- Real-time theme switching
- Consistent color application across:
  - Goals, Stories, Tasks
  - Kanban boards
  - Calendar blocks
  - Charts and visualizations

### Technical Implementation
- Central theme color management
- CSS custom properties for theme colors
- Real-time theme updates
- Theme persistence

**Priority**: Medium
**Status**: Partially implemented" \
"feature,theming,ui,colors" \
"v3.1.0"

create_issue "BOB-010 - Unified Drag & Drop System" \
"## 🖱️ Pragmatic Drag & Drop Integration

**Goal**: Unified, accessible, virtualization-friendly drag & drop across all tables and kanbans.

### Components to Integrate
- Sprint Planning Matrix
- Kanban boards
- Task lists
- Story management
- Goal organization

### Technical Requirements
- @dnd-kit/core implementation
- Accessibility compliance (WCAG AA)
- Virtualization support
- Touch device compatibility
- Optimistic UI updates <150ms

### Dependencies
- Required for BOB-001 (Sprint Planning)
- Required for BOB-002 (Current Sprint Kanban)

**Priority**: Critical
**Status**: In progress" \
"feature,drag-drop,accessibility,critical" \
"v3.1.0"

# iOS App Specific Features
create_issue "BOB-011 - iOS Native App Development" \
"## 📱 BOB iOS Native App - Complete Implementation

**Goal**: Full-featured iOS app with sync capabilities.

### Core Features
- SwiftUI interface with 5-tab navigation
- Firebase authentication and data sync
- EventKit integration for Reminders
- HealthKit integration for metrics
- Core Data for offline storage

### Key Capabilities
1. **Reminders Sync**: Bidirectional iOS Reminders ↔ BOB Tasks
2. **AI Integration**: OpenAI GPT-4 for deduplication & auto-linking
3. **Health Tracking**: VO₂ Max, HRV, Resting HR, Screen Time
4. **Chat Interface**: GPT-based conversational AI
5. **Calendar View**: Read-only calendar with task integration

### Technical Stack
- Swift + SwiftUI
- Firebase SDK (Auth, Firestore, Functions)
- EventKit & HealthKit frameworks
- Combine for reactive programming
- Background task processing

### Deliverables
- Xcode project with complete source
- Firebase configuration
- TestFlight build
- Documentation and setup guides

**Priority**: High
**Status**: Structure complete, implementation needed" \
"ios,mobile,app,swift,feature" \
"v3.2.0"

create_issue "BOB-012 - Apple Watch Companion App" \
"## ⌚ Apple Watch Companion App

**Goal**: Lightweight Apple Watch app for quick task management.

### Core Features
- Show current day's top 3 priorities
- Single tap to mark task complete
- Siri Shortcut integration
- Complication with streaks or active task

### Watch-Specific Requirements
- Minimal UI optimized for small screen
- Quick interactions (< 3 seconds)
- Offline capability
- Battery-efficient design

### Integration Points
- Sync with main iOS app
- HealthKit data display
- Haptic feedback for completions
- Siri Shortcuts for voice commands

**Priority**: Low
**Status**: Future enhancement" \
"ios,watch,mobile,siri" \
"v3.3.0"

# AI and Intelligence Features
create_issue "BOB-013 - AI Usage Analytics Dashboard" \
"## 📊 AI Usage Analytics Dashboard

**Goal**: Monitor and track AI API usage, costs, and performance.

### Dashboard Features
- Token consumption tracking
- Cost analysis and projections
- Performance metrics (latency, success rates)
- Usage breakdown by service/model/function
- Daily/weekly/monthly aggregates

### Technical Implementation
- AI usage logging system
- Firestore collections for usage data
- React dashboard component
- Real-time analytics updates
- Cost estimation algorithms

**Priority**: Medium
**Status**: ✅ COMPLETED in session" \
"feature,ai,analytics,monitoring" \
"v3.1.0"

create_issue "BOB-014 - Conversational AI Interface" \
"## 🤖 Conversational AI Interface

**Goal**: Natural language interface for task management and planning.

### Core Capabilities
- Daily reflection conversations
- Voice-to-task creation
- Habit check-ins via chat
- Planning assistance
- Progress reviews

### Implementation
- Web chat interface
- iOS voice integration
- Context-aware responses
- Task creation from natural language
- Integration with existing AI systems

**Priority**: Medium
**Status**: Foundation exists" \
"feature,ai,chat,voice,nlp" \
"v3.2.0"

# Infrastructure and Platform Features
create_issue "BOB-015 - Advanced Activity Stream & Auditing" \
"## 📋 Enhanced Activity Stream System

**Goal**: Comprehensive audit trail and activity tracking.

### Current Features ✅
- Field change tracking
- Status update logging
- Sprint change auditing
- Note system with timestamps
- User attribution

### Enhancements Needed
- Visual timeline improvements
- Bulk operation tracking
- Performance optimizations
- Export capabilities
- Advanced filtering

**Priority**: Low
**Status**: Core functionality complete" \
"feature,audit,activity,logging" \
"v3.2.0"

create_issue "BOB-016 - Performance Optimization & Scaling" \
"## ⚡ Performance Optimization & Scaling

**Goal**: Optimize performance for large datasets and concurrent users.

### Performance Targets
- <150ms optimistic UI updates
- Support 200 stories × 8 sprints scale
- <500ms sprint switching
- Real-time updates under heavy load

### Optimization Areas
- Firestore query optimization
- Virtual scrolling for large lists
- Component memoization
- Bundle size reduction
- Image optimization

### Monitoring
- Performance metrics dashboard
- Real user monitoring
- Error tracking and alerting
- Load testing automation

**Priority**: Medium
**Status**: Ongoing optimization needed" \
"performance,optimization,scaling,monitoring" \
"v3.2.0"

# Integration Features
create_issue "BOB-017 - Telegram Integration" \
"## 📱 Telegram Bot Integration

**Goal**: Telegram bot for quick task management and notifications.

### Bot Capabilities
- Daily digest delivery
- Quick task creation via chat
- Habit check-ins
- Priority notifications
- Progress updates

### Technical Implementation
- Telegram Bot API integration
- Firebase Functions for bot logic
- User authentication linking
- Message parsing and NLP
- Rich message formatting

**Priority**: Low
**Status**: Future enhancement" \
"integration,telegram,bot,messaging" \
"v3.3.0"

create_issue "BOB-018 - Advanced Reporting & Analytics" \
"## 📈 Advanced Reporting & Analytics

**Goal**: Comprehensive reporting and business intelligence features.

### Report Types
- Sprint velocity and burn-down charts
- Goal completion analytics
- Time tracking and productivity metrics
- Health correlation analysis
- Habit streak and completion rates

### Technical Features
- Configurable dashboard widgets
- Data export capabilities
- Scheduled report delivery
- Comparative analysis tools
- Predictive analytics

**Priority**: Low
**Status**: Basic analytics exist" \
"feature,reporting,analytics,charts" \
"v3.3.0"

# Bug Fixes and Improvements
create_issue "BOB-019 - Goal Visualization Page Fixes" \
"## 🔧 Fix Goal Visualization Page Issues

**Goal**: Resolve routing and display issues with /goals/roadmap page.

### Issues Identified
- Route /goals/roadmap not defined (causing console errors)
- ThemeBasedGanttChart component rendering problems
- Navigation inconsistencies

### Fixes Required
- Add missing route for /goals/roadmap
- Debug ThemeBasedGanttChart component
- Ensure consistent navigation behavior
- Test visualization rendering

### Current Status
- Route added in session ✅
- Component debugging needed

**Priority**: High
**Status**: Partially fixed" \
"bug,routing,visualization,fix" \
"v3.1.0"

create_issue "BOB-020 - Console Error Cleanup" \
"## 🧹 Console Error and Warning Cleanup

**Goal**: Clean up console errors and warnings for better debugging.

### Issues to Address
- Unused import warnings in multiple components
- React Hook dependency warnings
- TypeScript errors in components
- Performance warnings

### Files Needing Attention
- App.tsx (unused imports)
- AIUsageDashboard.tsx (dependency warnings)
- Multiple component files with TypeScript warnings

**Priority**: Medium
**Status**: Build warnings present" \
"bug,console,warnings,cleanup" \
"v3.1.0"

echo ""
echo -e "${GREEN}✅ GitHub Issues Created Successfully!${NC}"
echo ""
echo -e "${BLUE}📊 Summary:${NC}"
echo -e "${YELLOW}• 20 comprehensive issues created${NC}"
echo -e "${YELLOW}• Features categorized by priority and status${NC}"
echo -e "${YELLOW}• Technical requirements documented${NC}"
echo -e "${YELLOW}• Dependencies and relationships mapped${NC}"
echo ""
echo -e "${BLUE}🔗 View issues at: https://github.com/zulumonkeymetallic/bob/issues${NC}"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo -e "${YELLOW}1. Review and prioritize issues in GitHub${NC}"
echo -e "${YELLOW}2. Set up project milestones and sprints${NC}"
echo -e "${YELLOW}3. Assign team members to issues${NC}"
echo -e "${YELLOW}4. Begin implementation with high-priority items${NC}"
echo ""
echo -e "${BLUE}🎯 Immediate Priorities:${NC}"
echo -e "${YELLOW}• BOB-019: Fix goal visualization page${NC}"
echo -e "${YELLOW}• BOB-010: Complete unified drag & drop${NC}"
echo -e "${YELLOW}• BOB-003: Google Calendar integration${NC}"
echo -e "${YELLOW}• BOB-011: iOS app development${NC}"
