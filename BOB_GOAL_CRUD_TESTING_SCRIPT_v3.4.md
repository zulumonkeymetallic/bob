# BOB Goal CRUD Testing Script v3.4

## Overview
This script tests complete CRUD (Create, Read, Update, Delete) operations for Goals in BOB v3.2.8, ensuring all functionality works correctly after the activity stream cleanup and goal visualization scaffolding.

## Pre-Test Setup

### 1. Environment Check
- [ ] BOB v3.2.8 deployed and accessible at https://bob20250810.web.app
- [ ] User authenticated (donnelly.jim@gmail.com)
- [ ] Activity stream cleanup completed (no view tracking)
- [ ] Goal visualization components scaffolded

### 2. Test Data Preparation
```javascript
// Test goal templates for various scenarios
const testGoals = [
  {
    title: "Complete Iron Man Training",
    description: "6-month intensive training program for Iron Man competition",
    themeId: "health",
    priority: "high",
    status: "in-progress",
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-06-30')
  },
  {
    title: "Senior Developer Promotion",
    description: "Achieve senior developer role through skill development",
    themeId: "career", 
    priority: "high",
    status: "todo",
    startDate: new Date('2025-02-01'),
    endDate: new Date('2025-08-31')
  },
  {
    title: "Build Emergency Fund",
    description: "Save $10,000 for emergency fund",
    themeId: "finance",
    priority: "medium", 
    status: "todo",
    startDate: new Date('2025-01-15'),
    endDate: new Date('2025-12-31')
  }
];
```

## Testing Phases

### Phase 1: CREATE Operations

#### Test 1.1: Create Goal via Goals Table
**Objective**: Verify goal creation through main interface
**Steps**:
1. Navigate to `/goals`
2. Click "Add Goal" button
3. Fill form with test goal 1 data
4. Submit form
5. Verify goal appears in table with auto-generated reference (GR-XXXXX format)

**Expected Results**:
- [ ] Modal opens correctly
- [ ] Form validation works (required fields)
- [ ] Auto-generated reference ID follows GR-XXXXX pattern
- [ ] Goal appears immediately in table after creation
- [ ] Activity stream logs "goal_created" event
- [ ] No undefined referenceNumber errors in console

#### Test 1.2: Create Goal via Card View
**Objective**: Verify goal creation from card view
**Steps**:
1. Switch to card view mode
2. Click "Add Goal" button
3. Create test goal 2
4. Verify card appears with correct theme colors

**Expected Results**:
- [ ] Card view shows new goal
- [ ] Theme colors applied correctly
- [ ] Progress indicator shows 0%
- [ ] Reference number visible on card

#### Test 1.3: Create Goal with All Optional Fields
**Objective**: Test comprehensive goal creation
**Steps**:
1. Create test goal 3 with all fields populated:
   - Title, description, theme, priority, status
   - Start/end dates
   - Notes
   - Sub-goals (if available)
2. Verify all data persists correctly

**Expected Results**:
- [ ] All fields saved correctly
- [ ] Date fields formatted properly
- [ ] Notes section populated
- [ ] Activity stream captures all field values

### Phase 2: READ Operations

#### Test 2.1: Goals Table Display
**Objective**: Verify goals display correctly in table
**Steps**:
1. Navigate to goals table
2. Verify all created goals visible
3. Check column data accuracy
4. Test sorting functionality
5. Test filtering by status/theme

**Expected Results**:
- [ ] All goals display in table
- [ ] Reference numbers correct (GR-XXXXX format)
- [ ] Status badges show correct colors
- [ ] Theme indicators visible
- [ ] Sorting works (title, status, created date)
- [ ] Filters function correctly

#### Test 2.2: Goals Card View Display
**Objective**: Verify goals display in card format
**Steps**:
1. Switch to card view
2. Verify all goals show as cards
3. Check card layout and information
4. Test theme color inheritance

**Expected Results**:
- [ ] Cards display all essential info
- [ ] Theme colors applied consistently
- [ ] Progress bars show correct percentages
- [ ] Status indicators clear
- [ ] Cards responsive on mobile

#### Test 2.3: Goal Detail Views
**Objective**: Test detailed goal information access
**Steps**:
1. Click on a goal to open details
2. Verify side panel opens (if available)
3. Check all goal information displayed
4. Test activity history display

**Expected Results**:
- [ ] Detail view opens correctly
- [ ] All goal fields displayed
- [ ] Activity history shows creation event
- [ ] No "viewed" events in activity stream (cleanup verified)

#### Test 2.4: Search and Filter Functionality
**Objective**: Test goal discovery features
**Steps**:
1. Test search by title: "Iron Man"
2. Test search by reference: "GR-"
3. Test filter by status: "in-progress"
4. Test filter by theme: "health"
5. Test combined filters

**Expected Results**:
- [ ] Search returns correct results
- [ ] Reference search works
- [ ] Status filters apply correctly
- [ ] Theme filters work
- [ ] Combined filters function properly
- [ ] "No results" state handled gracefully

### Phase 3: UPDATE Operations

#### Test 3.1: Inline Field Updates
**Objective**: Test direct field editing
**Steps**:
1. In goals table, click title field
2. Edit title inline
3. Press Enter to save
4. Verify immediate update and activity logging
5. Repeat for other editable fields

**Expected Results**:
- [ ] Inline editing activates correctly
- [ ] Enter key saves changes
- [ ] Optimistic UI updates immediately
- [ ] Activity stream logs field changes with old/new values
- [ ] No undefined referenceNumber errors
- [ ] Changes persist after page refresh

#### Test 3.2: Status Updates
**Objective**: Test status change functionality
**Steps**:
1. Change goal status from "todo" to "in-progress"
2. Verify status badge updates
3. Check activity stream logging
4. Change to "completed"
5. Verify completion behavior

**Expected Results**:
- [ ] Status dropdown shows all options
- [ ] Status badge colors update immediately
- [ ] Activity stream logs status changes
- [ ] Completed goals handled appropriately
- [ ] Progress indicators update if applicable

#### Test 3.3: Bulk Updates
**Objective**: Test multiple goal updates
**Steps**:
1. Select multiple goals (if bulk selection available)
2. Perform bulk status update
3. Verify all selected goals updated
4. Check activity logging for each goal

**Expected Results**:
- [ ] Bulk selection works
- [ ] Bulk updates apply to all selected
- [ ] Individual activity entries created
- [ ] UI reflects all changes
- [ ] No data corruption

#### Test 3.4: Date Range Updates
**Objective**: Test timeline modifications
**Steps**:
1. Edit goal start/end dates
2. Verify date validation
3. Test invalid date ranges
4. Check calendar integration (if available)

**Expected Results**:
- [ ] Date pickers function correctly
- [ ] Validation prevents invalid ranges
- [ ] Changes reflect in visualization
- [ ] Activity stream logs date changes

### Phase 4: DELETE Operations

#### Test 4.1: Single Goal Deletion
**Objective**: Test individual goal removal
**Steps**:
1. Select a test goal
2. Click delete button
3. Confirm deletion in modal
4. Verify goal removed from all views
5. Check activity stream logging

**Expected Results**:
- [ ] Confirmation modal appears
- [ ] Goal removed from table/cards
- [ ] Activity stream logs deletion
- [ ] Related data handled appropriately
- [ ] Undo functionality (if available)

#### Test 4.2: Bulk Deletion
**Objective**: Test multiple goal deletion
**Steps**:
1. Select multiple test goals
2. Perform bulk delete
3. Confirm operation
4. Verify all selected goals removed

**Expected Results**:
- [ ] Bulk delete confirmation clear
- [ ] All selected goals removed
- [ ] Activity entries for each deletion
- [ ] UI updates correctly

#### Test 4.3: Goal Dependency Handling
**Objective**: Test deletion with related data
**Steps**:
1. Create goal with stories/tasks (if available)
2. Attempt to delete goal
3. Verify warning about dependencies
4. Choose appropriate action

**Expected Results**:
- [ ] Dependency warning shows
- [ ] Options presented (cascade delete, reassign, etc.)
- [ ] Chosen action executes correctly
- [ ] Data integrity maintained

### Phase 5: Goal Visualization Integration

#### Test 5.1: Visualization Display
**Objective**: Test new visualization module
**Steps**:
1. Navigate to `/goals/visualization`
2. Verify goals appear on timeline
3. Check sprint markers display
4. Test zoom levels (month, quarter, half, year)

**Expected Results**:
- [ ] Visualization page loads
- [ ] Goals show on timeline with correct positions
- [ ] Sprint markers visible
- [ ] Zoom controls function
- [ ] Mock data displays properly

#### Test 5.2: Visualization Interactions
**Objective**: Test visualization features
**Steps**:
1. Try dragging a goal timeline bar
2. Test confirmation modal for sprint changes
3. Test theme filtering
4. Test search functionality
5. Test print and share features

**Expected Results**:
- [ ] Goal dragging works (mock behavior)
- [ ] Confirmation modal appears for major changes
- [ ] Filters apply correctly
- [ ] Search functions
- [ ] Print/share dialogs open

### Phase 6: Activity Stream Validation

#### Test 6.1: Activity Stream Cleanup Verification
**Objective**: Confirm view tracking removal
**Steps**:
1. Perform various goal interactions
2. Check activity stream for entries
3. Verify no "viewed" events logged
4. Confirm only meaningful activities captured

**Expected Results**:
- [ ] No "viewed" activity entries
- [ ] Only field changes, creation, deletion logged
- [ ] All activities have valid reference numbers
- [ ] No undefined values in activity data
- [ ] Console free of activity-related errors

#### Test 6.2: Activity Stream Performance
**Objective**: Test debouncing and error handling
**Steps**:
1. Rapidly edit same field multiple times
2. Verify debouncing prevents spam
3. Test error handling with invalid data
4. Check console for error throttling

**Expected Results**:
- [ ] Duplicate activities debounced (2-second window)
- [ ] Error logging throttled (5-second window)
- [ ] No console flooding
- [ ] Valid activities still logged

### Phase 7: Performance and Error Testing

#### Test 7.1: Large Dataset Performance
**Objective**: Test with many goals
**Steps**:
1. Create 20+ test goals
2. Test table/card view performance
3. Check search/filter responsiveness
4. Verify pagination (if implemented)

**Expected Results**:
- [ ] UI remains responsive
- [ ] Search/filter performance acceptable
- [ ] Memory usage reasonable
- [ ] Scrolling smooth

#### Test 7.2: Error Scenarios
**Objective**: Test error handling
**Steps**:
1. Test offline scenario (simulate network issues)
2. Test with invalid data
3. Test concurrent editing
4. Test permission scenarios

**Expected Results**:
- [ ] Offline mode graceful
- [ ] Error messages clear
- [ ] Data validation works
- [ ] Conflicts handled appropriately

## Test Results Template

### Test Summary
- **Test Date**: [DATE]
- **Tester**: [NAME]
- **BOB Version**: v3.2.8
- **Browser**: [BROWSER/VERSION]
- **Environment**: https://bob20250810.web.app

### Results Overview
- **Total Tests**: 25
- **Passed**: [X]/25
- **Failed**: [X]/25  
- **Blocked**: [X]/25

### Critical Issues Found
1. [Issue description]
   - **Severity**: High/Medium/Low
   - **Impact**: [Description]
   - **Reproduction Steps**: [Steps]
   - **Expected**: [Expected behavior]
   - **Actual**: [Actual behavior]

### Performance Metrics
- **Goal creation time**: [X]ms
- **Table load time** (20 goals): [X]ms
- **Search response time**: [X]ms
- **Activity stream write time**: [X]ms

### Browser Console Errors
```
[List any console errors encountered]
```

### Recommendations
1. [Recommendation 1]
2. [Recommendation 2]
3. [Recommendation 3]

---

## Notes for Testing AI
- Use side door authentication: Add `?test_login=true` to URL
- Check browser console for detailed logs
- Activity stream improvements should eliminate undefined reference errors
- Goal visualization is scaffolded - expect mock data initially
- Report any discrepancies between expected auto-generated reference format (GR-XXXXX) vs actual

This comprehensive test script ensures all goal functionality works correctly after recent improvements and scaffolding additions.
