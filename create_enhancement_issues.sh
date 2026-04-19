#!/bin/bash

# BOB v3.8.0 Enhancement Issues Creation Script
# Creates GitHub issues for UI consistency, Kanban improvements, and React error fixes

cd /Users/jim/Github/bob

echo "🎯 Creating GitHub Issues for BOB v3.8.0 Enhancement Sprint..."

# Issue 1: Story Kanban Visual Consistency with Goals Management
gh issue create \
  --title "🎨 Story Kanban Visual Consistency with Goals Management" \
  --body "## 🎯 Objective
Refactor the Story Kanban board to use the same visual style and card components as the Goals Management page.

## 📋 Requirements
- [ ] Use identical card styling as Goals Management (ModernGoalsTable card design)
- [ ] Implement consistent CRUD operations (status, delete, edit buttons)
- [ ] Add goal-style card actions and dropdowns
- [ ] Maintain existing drag-and-drop functionality
- [ ] Ensure responsive design consistency

## 🔗 Reference
- Goals Management: https://bob20250810.web.app/goals-management
- Current Kanban: ModernKanbanPage.tsx
- Target Style: ModernGoalsTable.tsx card design

## 🎨 Visual Elements to Align
- Card border radius and shadow
- Button styling and placement
- Badge designs for status/priority
- Typography hierarchy
- Color scheme and theming

## ✅ Acceptance Criteria
- Story cards match Goals cards visually
- All CRUD operations available on cards
- Consistent hover states and interactions
- Mobile responsive design maintained" \
  --label "enhancement,ui-consistency,high-priority"

# Issue 2: Modern Task Management Integration in Kanban
gh issue create \
  --title "📋 Modern Task Management Table Integration in Kanban" \
  --body "## 🎯 Objective
When clicking on a story in the Kanban board, display the modern task management table underneath the board.

## 📋 Requirements
- [ ] Add click handler to story cards
- [ ] Display ModernTaskTable component below Kanban board
- [ ] Filter tasks by selected story
- [ ] Maintain existing task board functionality
- [ ] Add toggle to show/hide task table

## 🔧 Technical Implementation
- Integrate ModernTaskTable component
- Pass selected story ID as filter
- Add state management for selected story
- Implement smooth expand/collapse animation

## ✅ Acceptance Criteria
- Click story card → shows task table below
- Task table filters to selected story
- Existing task cards remain on board
- Performance optimized for large datasets" \
  --label "enhancement,kanban,task-management"

# Issue 3: Sprint-Based Story Filtering in Kanban
gh issue create \
  --title "🎯 Sprint-Based Story Filtering in Kanban Board" \
  --body "## 🎯 Objective
Use Goals board as basis and show only stories belonging to the currently selected sprint in the Kanban board.

## 📋 Requirements
- [ ] Add sprint selector to Kanban page header
- [ ] Filter stories by selected sprint
- [ ] Integrate with existing sprint model
- [ ] Maintain sprint context across navigation
- [ ] Show empty state when no stories in sprint

## 🔧 Technical Implementation
- Add SprintSelector component
- Implement story filtering logic
- Connect to sprint data model
- Add loading states
- Handle sprint changes

## 🐛 Related Issues
- Sprint model logging 'goalId: false' (needs investigation)
- Sprint selector integration across components

## ✅ Acceptance Criteria
- Only sprint stories shown in Kanban
- Sprint selector updates board immediately
- Empty state when no sprint selected
- Consistent with Goals page sprint filtering" \
  --label "enhancement,sprint-management,kanban"

# Issue 4: React Error #31 Investigation and Fix
gh issue create \
  --title "🐛 React Error #31: Timestamp Object Conversion Fix" \
  --body "## 🐛 Error Description
Encountering React error #31 in production:
\`Error: Minified React error #31; visit https://reactjs.org/docs/error-decoder.html?invariant=31&args[]=object%20with%20keys%20%7Bseconds%2C%20nanoseconds%7D\`

## 🔍 Analysis
This error typically occurs when passing non-serializable objects (like Firestore Timestamps) to React components as props.

## 📋 Investigation Areas
- [ ] Firestore Timestamp objects in component props
- [ ] serverTimestamp() usage in forms/updates
- [ ] Date serialization in component state
- [ ] Timestamp conversion in data fetching

## 🔧 Potential Solutions
- Convert Timestamps to Date objects before passing to components
- Add timestamp serialization utility
- Review all Firestore data mapping
- Add proper type guards for timestamp objects

## 🎯 Files to Review
- Components receiving Firestore data
- Data fetching utilities
- Timestamp handling in forms
- Activity stream components

## ✅ Acceptance Criteria
- No React error #31 in production
- Proper timestamp handling throughout app
- Maintained functionality with dates/times
- Added utility for timestamp conversion" \
  --label "bug,high-priority,firestore,react"

# Issue 5: Sprint Model Integration and Debugging
gh issue create \
  --title "🔧 Sprint Model Integration and 'goalId: false' Debug" \
  --body "## 🐛 Issue Description
Sprint model is logging 'goalId: false' in console, indicating potential data integrity issues.

## 📋 Investigation Points
- [ ] ModernStoriesTable.tsx sprint model usage
- [ ] SprintSelector.tsx data handling
- [ ] Goal-Sprint relationship mapping
- [ ] Data validation in sprint creation/updates

## 🔧 Components to Review
- ModernStoriesTable.tsx
- SprintSelector.tsx
- Sprint data model schema
- Goal-Sprint relationship logic

## 🎯 Expected Behavior
- Sprint model should have valid goalId references
- No false/undefined goalId values
- Proper validation and error handling
- Clear console logging for debugging

## ✅ Acceptance Criteria
- Resolved 'goalId: false' logging
- Proper sprint-goal relationships
- Enhanced error handling
- Improved data validation" \
  --label "bug,sprint-management,data-integrity"

# Issue 6: Unified Card and List Views Across Pages
gh issue create \
  --title "🎨 Unified Card and List Views for Tasks, Stories, and Goals" \
  --body "## 🎯 Objective
Implement consistent card and list view components across Tasks, Stories, and Goals pages, all linked by current sprint context.

## 📋 Requirements
- [ ] Standardize card design across all entity types
- [ ] Implement consistent list view layouts
- [ ] Link all views by current sprint selection
- [ ] Add uniform CRUD operations on all cards
- [ ] Ensure mobile responsiveness

## 🎨 Design Consistency
- Identical card styling and interactions
- Consistent button placement and styling
- Unified color scheme and theming
- Same typography and spacing

## 🔗 Sprint Integration
- All pages filter by current sprint
- Sprint context maintained across navigation
- Consistent sprint selector placement
- Related entities highlighted

## 📋 Pages to Update
- Tasks management page
- Stories management page
- Goals management page (reference)
- Kanban board integration

## ✅ Acceptance Criteria
- Visual consistency across all pages
- Sprint-based filtering everywhere
- Uniform user interactions
- Maintained performance" \
  --label "enhancement,ui-consistency,sprint-management"

# Issue 7: Goal and Story Card Delete Modal Enhancement
gh issue create \
  --title "🗑️ Enhanced Delete Modals for Goal and Story Cards" \
  --body "## 🎯 Objective
Ensure goal delete modal functionality is available on both card views and list views, with consistent UX across stories.

## 📋 Requirements
- [ ] Goal cards have accessible delete modals
- [ ] Story cards implement same delete modal pattern
- [ ] Consistent confirmation dialogs
- [ ] Proper error handling and feedback
- [ ] Cascade delete warnings for related entities

## 🔧 Implementation Details
- Standardized delete modal component
- Consistent warning messages
- Proper entity relationship handling
- Undo functionality consideration
- Loading states during deletion

## 🎨 UX Considerations
- Clear deletion consequences
- Related entity impact warnings
- Accessible keyboard navigation
- Mobile-friendly modal sizing

## ✅ Acceptance Criteria
- Delete modals work on all card views
- Consistent UX across entity types
- Proper relationship cascade handling
- Clear user feedback and confirmation" \
  --label "enhancement,crud-operations,user-experience"

echo "✅ All GitHub issues created successfully!"
echo "🎯 Ready to begin BOB v3.8.0 enhancement sprint"
