# GitHub Issues - September 4, 2025

## Issue #59: Sidebar Navigation Not Scrollable
**Priority:** High
**Labels:** bug, ui, navigation

**Description:**
The left-hand navigator (sidebar) is not scrollable, preventing users from accessing navigation items that don't fit in the viewport.

**Expected Behavior:**
- Sidebar should be scrollable when content exceeds viewport height
- Smooth scrolling experience
- Proper overflow handling

**Current Behavior:**
- Sidebar content is cut off
- No scrolling capability
- Navigation items become inaccessible

**Screenshots:** Attached in user feedback

**Technical Notes:**
- Related to SidebarLayout.tsx component
- CSS overflow and flex layout issues
- Needs proper maxHeight calculation

---

## Issue #60: Goal Timeline Bars Need Visual Improvements
**Priority:** Medium
**Labels:** enhancement, ui, visualization

**Description:**
Goal timeline bars in the Goals Roadmap need visual improvements to match the card view style and include sprint information.

**Expected Behavior:**
- Flat design similar to goal cards
- Sprint names displayed on bars
- Better visual hierarchy
- Consistent styling with rest of application

**Current Behavior:**
- Timeline bars lack visual polish
- No sprint names shown
- Inconsistent with card view design

**Screenshots:** Attached in user feedback

**Technical Notes:**
- ThemeBasedGanttChart.tsx component
- CSS styling improvements needed
- Sprint data integration required

---

## Issue #61: Timeline Should Default to Today's Date with Red Line
**Priority:** Medium
**Labels:** enhancement, visualization, ux

**Description:**
The timeline visualization should default to today's date with a prominent red line indicator and support zoom controls.

**Expected Behavior:**
- Red line showing today's date
- Timeline centered on current date by default
- Zoom controls (day/week/month/quarter)
- Pinch-to-zoom support for touch devices
- Automatic zoom level selection based on content

**Current Behavior:**
- Timeline starts at arbitrary date
- No current date indicator
- Limited zoom functionality

**Screenshots:** Attached in user feedback

**Technical Notes:**
- ThemeBasedGanttChart.tsx component
- Date calculation and positioning logic
- CSS for current date line
- Touch gesture support

---

## Issue #62: Sprint Selectors Not Synchronized Globally
**Priority:** High
**Labels:** bug, state-management, sprint

**Description:**
Sprint selectors across the application don't synchronize with each other, leading to inconsistent state.

**Expected Behavior:**
- All sprint selectors show same selected sprint
- Changing sprint in one component updates all others
- Auto-selection of active sprint
- Global state management for current sprint

**Current Behavior:**
- Sprint selectors operate independently
- Inconsistent sprint selection across components
- Manual selection required in each component

**Screenshots:** Attached in user feedback

**Technical Notes:**
- SprintSelector.tsx component
- Global state management needed
- Context or state management solution
- Sprint persistence across navigation

---

## Issue #63: Multiple Firestore Access Control and Index Errors
**Priority:** Critical
**Labels:** bug, backend, firestore, security

**Description:**
Multiple Firestore errors are occurring in production, including access control failures and missing database indexes.

**Error Messages:**
```
- Fetch API cannot load firestore.googleapis.com (access control checks)
- Missing or insufficient permissions
- The query requires an index (sprints, stories, tasks collections)
```

**Expected Behavior:**
- All Firestore queries execute successfully
- Proper permission handling
- Required indexes created

**Current Behavior:**
- Query failures causing data loading issues
- Permission denied errors
- Missing composite indexes for complex queries

**Technical Notes:**
- Firestore security rules need review
- Composite indexes required for:
  - sprints collection (ownerUid, persona, createdAt)
  - stories collection (ownerUid, persona, orderIndex)
  - tasks collection (ownerUid, persona, serverUpdatedAt)
- Listener cleanup issues in ThemeBasedGanttChart.tsx

---

## Issue #64: "Manage Sprints" Button Routing Fixed
**Priority:** Low
**Labels:** bug, navigation, routing

**Description:** ✅ RESOLVED
The "Manage Sprints" button was redirecting to the wrong route.

**Resolution:**
- Updated SprintSelector.tsx to redirect to `/sprints/management`
- Build and deployment completed
- Fix committed: b1b409b

---

## Issue #65: Firestore Listener Cleanup Bug Fixed  
**Priority:** High
**Labels:** bug, memory-leak, firestore

**Description:** ✅ RESOLVED
Firestore listeners were not being properly cleaned up due to incorrect useEffect structure.

**Resolution:**
- Fixed ThemeBasedGanttChart.tsx useEffect structure
- Proper cleanup function return
- Error handling added for listeners
- Build completed with fix
