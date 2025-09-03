#!/bin/bash

# Create Roadmap Issues (Non-Duplicates Only)
# This script creates new roadmap issues avoiding duplicates

# GitHub repository details
REPO="zulumonkeymetallic/bob"

echo "🚀 Creating New BOB Roadmap Issues (Non-Duplicates)..."

# Issue BOB-028: GPT Story Generator (from Goals)
gh issue create \
  --title "BOB-028: GPT Story Generator (from Goals)" \
  --body "## Overview
Converts goals into suggested stories using GPT/LLM analysis to streamline sprint planning.

## Requirements
- **Goal Analysis**: LLM analyzes goal content and context
- **Story Suggestions**: Auto-generate story titles, descriptions, and priorities
- **User Review Flow**: Review and accept/modify suggestions
- **Backlog Integration**: Seamlessly add approved stories to backlog

## Technical Implementation
- Extend AIService with goal-to-story conversion
- Create story suggestion UI components
- Implement approval workflow
- Add bulk story creation capabilities

## User Workflow
1. Select goal(s) for story generation
2. LLM analyzes goals and suggests stories
3. User reviews suggestions with confidence scores
4. Accept/modify/reject individual suggestions
5. Approved stories added to backlog with goal linkage

## Acceptance Criteria
- [ ] LLM-powered goal analysis
- [ ] Multiple story suggestions per goal
- [ ] Confidence scoring for suggestions
- [ ] User review and approval interface
- [ ] Automatic goal-story linking
- [ ] Bulk approval capabilities

## Priority: Medium
## Impact: Streamlines sprint planning by auto-generating stories" \
  --label "ai,llm,stories,automation,medium-priority,smart-features,roadmap" \
  --assignee "zulumonkeymetallic"

# Issue BOB-029: GPT Task Generator (from Stories)
gh issue create \
  --title "BOB-029: GPT Task Generator (from Stories)" \
  --body "## Overview
Uses GPT/LLM to intelligently break down stories into actionable tasks with context inheritance.

## Requirements
- **Story Breakdown**: LLM analyzes stories and creates task suggestions
- **Context Inheritance**: Tasks inherit story tags, estimates, and metadata
- **Inline Editing**: Users can modify tasks before saving
- **Estimation Support**: AI suggests time estimates for generated tasks

## Technical Implementation
- Extend AIService with story-to-task breakdown
- Create task generation UI
- Implement context inheritance logic
- Add estimation algorithms

## LLM Features
- Story content analysis
- Task decomposition strategies
- Effort estimation suggestions
- Dependency identification

## User Workflow
1. Select story for task generation
2. LLM analyzes story and suggests tasks
3. Review generated tasks with estimates
4. Edit/add/remove tasks as needed
5. Save approved tasks with story linkage

## Acceptance Criteria
- [ ] LLM-powered story analysis
- [ ] Intelligent task breakdown
- [ ] Context and metadata inheritance
- [ ] Inline task editing capabilities
- [ ] Time estimation suggestions
- [ ] Story-task relationship tracking

## Priority: Medium
## Impact: Reduces manual planning overhead" \
  --label "ai,llm,tasks,automation,medium-priority,smart-features,roadmap" \
  --assignee "zulumonkeymetallic"

# Issue BOB-030: Goal → Story → Task Traceability Graph
gh issue create \
  --title "BOB-030: Interactive Goal → Story → Task Traceability Graph" \
  --body "## Overview
Interactive visual graph/tree displaying relationships between goals, stories, and tasks with clickable navigation.

## Requirements
- **Visual Hierarchy**: Interactive tree/graph visualization
- **Clickable Navigation**: Navigate between layers (goal → story → task)
- **Progress Visualization**: Visual progress indicators at each level
- **Dependency Mapping**: Show task and story dependencies
- **Filtering Options**: Filter by status, priority, assignment

## Technical Implementation
- Implement graph visualization library (D3.js or similar)
- Create interactive navigation components
- Add progress calculation algorithms
- Implement filtering and search capabilities

## Visualization Features
- **Node Types**: Different shapes/colors for goals, stories, tasks
- **Progress Indicators**: Completion percentages and status
- **Relationship Lines**: Visual connections with dependency types
- **Interactive Elements**: Hover details, click navigation
- **Zoom/Pan**: Navigate large project hierarchies

## Acceptance Criteria
- [ ] Interactive graph visualization
- [ ] Clickable navigation between layers
- [ ] Progress indicators at all levels
- [ ] Dependency visualization
- [ ] Filtering and search functionality
- [ ] Responsive design for different screen sizes

## Priority: Medium
## Impact: Improves project understanding and planning" \
  --label "ui,visualization,roadmap,medium-priority,analysis,workflow" \
  --assignee "zulumonkeymetallic"

# Issue BOB-031: CSV/Excel Goal Import System
gh issue create \
  --title "BOB-031: CSV/Excel Goal Import (Spreadsheet Upload)" \
  --body "## Overview
Import structured OKRs/goals from CSV or Excel files with field mapping and validation.

## Requirements
- **File Upload**: Support CSV and Excel (.xlsx) formats
- **Field Mapping**: Visual interface for mapping columns to BOB fields
- **Validation Preview**: Show import preview with error detection
- **Auto-Tagging**: Tag imported goals with 'source:import'
- **Bulk Operations**: Import hundreds of goals efficiently

## Technical Implementation
- File upload and parsing components
- Field mapping interface
- Data validation and error handling
- Bulk import optimization
- Progress tracking for large imports

## Supported Fields
- Goal title and description
- Priority levels and categories
- Due dates and time estimates
- Tags and metadata
- Owner/assignee information

## Import Workflow
1. Upload CSV/Excel file
2. Preview data structure
3. Map columns to BOB fields
4. Validate data and show errors
5. Review import summary
6. Execute bulk import with progress

## Acceptance Criteria
- [ ] CSV and Excel file support
- [ ] Visual field mapping interface
- [ ] Data validation and error reporting
- [ ] Import preview functionality
- [ ] Auto-tagging with source information
- [ ] Progress tracking for large imports

## Priority: Medium
## Impact: Quick onboarding for existing backlog users" \
  --label "import,csv,excel,roadmap,medium-priority,workflow,data" \
  --assignee "zulumonkeymetallic"

# Issue BOB-032: Android TV App for Bravia - Screen Time Monitoring
gh issue create \
  --title "BOB-032: Android TV App for Bravia – Screen Time Monitoring & Detox Enforcement" \
  --body "## Overview
Android TV application for Bravia TVs to track screen usage and sync with Firebase for digital detox enforcement.

## Requirements
- **Usage Tracking**: Monitor screen time on Android TVs
- **Firebase Sync**: Sync usage metrics to central Firebase database
- **Detox Integration**: Support BOB AI detox logic and reminders
- **Block Functionality**: Enforce usage limits when needed
- **Family Support**: Multi-user tracking and parental controls

## Technical Implementation
- Android TV app development (Kotlin/Java)
- Firebase integration for data sync
- Usage tracking APIs
- Notification and blocking systems
- User interface for TV screens

## Features
- **Real-time Monitoring**: Track active usage across apps
- **Usage Analytics**: Daily, weekly, monthly reports
- **Smart Reminders**: Context-aware break suggestions
- **Parental Controls**: Time limits and content restrictions
- **Integration**: Sync with mobile app detox goals

## TV-Specific Considerations
- **Remote Control Navigation**: TV-friendly interface design
- **Voice Commands**: Google Assistant integration
- **Background Monitoring**: Minimal performance impact
- **Family Profiles**: Multi-user support

## Acceptance Criteria
- [ ] Android TV app with usage tracking
- [ ] Firebase integration for data sync
- [ ] Detox reminder system
- [ ] Usage blocking capabilities
- [ ] TV-optimized user interface
- [ ] Family/multi-user support

## Priority: Low
## Impact: Extends detox tracking beyond mobile devices" \
  --label "android-tv,detox,firebase,low-priority,roadmap,tracking" \
  --assignee "zulumonkeymetallic"

echo "✅ New BOB Roadmap Issues Created Successfully!"
echo ""
echo "📊 Created Issues:"
echo "- BOB-028: GPT Story Generator (from Goals)"
echo "- BOB-029: GPT Task Generator (from Stories)"  
echo "- BOB-030: Goal → Story → Task Traceability Graph"
echo "- BOB-031: CSV/Excel Goal Import System"
echo "- BOB-032: Android TV App for Bravia Screen Monitoring"
echo ""
echo "🚫 Skipped Duplicates:"
echo "- BOB-042: iOS Reminders Integration (duplicate of BOB-006 + recent work)"
echo "- BOB-043: iOS App Build Initiative (duplicate of BOB-011, BOB-012)"
echo "- BOB-025: iOS Daily Planner (overlap with existing iOS initiatives)"
echo ""
echo "🎯 All new roadmap issues are tracked and ready for development!"
