#!/bin/bash

# GitHub Issues Creation Script for BOB Platform Critical Defects
# Run this script to create GitHub issues for all tracked defects

echo "🚨 Creating GitHub Issues for BOB Platform Critical Defects"
echo "================================================================"

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found. Please install it first:"
    echo "   brew install gh"
    echo "   Then run: gh auth login"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Please run:"
    echo "   gh auth login"
    exit 1
fi

echo "✅ GitHub CLI is ready"
echo ""

# Issue 1: Critical DnD Library Conflicts
echo "Creating Issue 1: Critical Drag-and-Drop Library Conflicts..."
gh issue create \
  --title "[CRITICAL] Multiple conflicting drag-and-drop libraries causing system crashes" \
  --body "$(cat << 'EOF'
## 🚨 Critical Bug Report

**Priority:** Critical  
**Component:** System-wide Architecture  
**Version:** v3.0.7  
**Environment:** Development/Production  

### Description
System uses three different drag-and-drop libraries simultaneously causing conflicts, crashes, and inconsistent behavior:
- `@dnd-kit` (ModernTaskTable, ModernGoalsTable) ✅ Working
- `react-beautiful-dnd` (ModernKanbanBoard) ⚠️ Working but inconsistent  
- `react-dnd` (SprintPlanner) ❌ BROKEN (not installed)

### Impact Assessment
- [x] System crashes or white screen
- [x] Core functionality completely broken
- [x] Affects multiple users/components

### Steps to Reproduce
1. Navigate to Sprint Planning page
2. Component crashes with React hook error
3. Console shows DnD library conflicts

### Error Details
**Error Message:**
```
Cannot read properties of null (reading 'useEffect')
TypeError: Cannot read properties of null (reading 'useEffect')
at exports.useEffect (bundle.js:5848:23)
at DndProvider (bundle.js:3534:51)
```

### Technical Details
- **Affected Files:** 
  - `/react-app/src/components/SprintPlanner.tsx` (BROKEN)
  - `/react-app/src/components/ModernKanbanBoard.tsx` (react-beautiful-dnd)
  - `/react-app/src/components/ModernTaskTable*.tsx` (@dnd-kit)
  - `/react-app/src/components/ModernGoalsTable.tsx` (@dnd-kit)

### Temporary Workaround
Created SprintPlannerSimple.tsx without drag-and-drop as emergency fix.

### Proposed Solution
Standardize all components on `@dnd-kit` library (already installed and working).

**Implementation Plan:**
1. Convert SprintPlanner to @dnd-kit
2. Convert ModernKanbanBoard to @dnd-kit  
3. Remove react-beautiful-dnd dependency
4. Test all drag-and-drop functionality

### Related Documentation
- See `DRAG_DROP_STANDARDIZATION_PLAN.md`
- See `CRITICAL_DEFECTS_LOG_v3.0.6.md`

---

**SLA:** Critical issues require response within 2 hours
EOF
)" \
  --label "bug-critical,priority-high,drag-drop,architecture" \
  --assignee "@me"

echo "✅ Issue 1 created"
echo ""

# Issue 2: Goal Creation Status Mismatch  
echo "Creating Issue 2: Goal Creation Status Mismatch..."
gh issue create \
  --title "[HIGH] Goal creation uses incorrect status values causing display issues" \
  --body "$(cat << 'EOF'
## 🔥 High Priority Bug Report

**Priority:** High  
**Component:** GoalsManagement, AddGoalModal  
**Version:** v3.0.7  
**Environment:** Development/Production  

### Description
AddGoalModal creates goals with `status: 'active'` but ModernGoalsTable expects `['Not Started', 'Work in Progress', 'Complete', 'Paused']`, causing created goals to not appear in filtered lists.

### Impact Assessment
- [x] Major feature not working
- [x] Incorrect data display
- [x] Poor user experience

### Steps to Reproduce
1. Go to Goals Management page
2. Click "Add Goal" button
3. Fill out form and create goal
4. Goal appears to be created but doesn't show in table
5. Dashboard counters don't update

### Expected Behavior
- Created goal should appear in goals table immediately
- Dashboard counters should update to reflect new goal
- Goal should be filterable by status

### Actual Behavior  
- Goal is created in database but not visible
- Counters remain unchanged
- User thinks goal creation failed

### Technical Information
- **Affected Files:** 
  - `/react-app/src/components/AddGoalModal.tsx` (Line 57)
  - `/react-app/src/components/ModernGoalsTable.tsx` (Status options)
- **Root Cause:** Status value mismatch between components

### Business Impact
Users cannot effectively create and manage goals, core functionality appears broken.

### Fix Applied
Changed AddGoalModal to use 'Not Started' status instead of 'active'.

**Verification Needed:**
- [ ] Test goal creation end-to-end
- [ ] Verify counters update correctly
- [ ] Check filtering works with new status
EOF
)" \
  --label "bug-high,priority-high,data-integrity" \
  --assignee "@me"

echo "✅ Issue 2 created"
echo ""

# Issue 3: Architecture Standardization
echo "Creating Issue 3: Drag-and-Drop Architecture Standardization..."
gh issue create \
  --title "[ARCH] Standardize all drag-and-drop components on @dnd-kit library" \
  --body "$(cat << 'EOF'
## 🏗️ Architecture Issue Report

**Category:** Dependency Conflict / Design Pattern  
**Scope:** System-wide  
**Priority:** High  

### Problem Description
BOB platform currently uses three different drag-and-drop libraries across components, causing conflicts, inconsistent behavior, and maintenance overhead.

### Components/Files Affected
- ModernGoalsTable.tsx (@dnd-kit) ✅
- ModernTaskTable-Simple.tsx (@dnd-kit) ✅  
- ModernTaskTableProper.tsx (@dnd-kit) ✅
- ModernKanbanBoard.tsx (react-beautiful-dnd) ⚠️
- SprintPlanner.tsx (react-dnd - NOT INSTALLED) ❌
- Column.tsx (react-beautiful-dnd) ⚠️

### Issues with Current Approach
- [x] Performance problems
- [x] Maintenance difficulties  
- [x] Code duplication
- [x] Inconsistent patterns
- [x] Dependency conflicts

### Proposed Solution
Standardize all drag-and-drop functionality on `@dnd-kit` library:

**Benefits:**
- Single, modern DnD library
- Better performance than react-beautiful-dnd
- Consistent API across components
- Better accessibility and mobile support
- Active maintenance and development

### Implementation Plan
1. **Phase 1:** Convert SprintPlanner to @dnd-kit (Critical)
2. **Phase 2:** Convert ModernKanbanBoard to @dnd-kit 
3. **Phase 3:** Remove react-beautiful-dnd dependency
4. **Phase 4:** Testing and documentation

### Breaking Changes
None - all existing functionality will be preserved

### Migration Strategy
- Convert components one by one
- Maintain feature parity
- Test each component thoroughly
- Remove old dependencies only after all conversions complete

### Testing Strategy
- Unit tests for each converted component
- Integration tests for drag-and-drop workflows
- Cross-browser and mobile testing
- Performance benchmarking

### Documentation Updates
- Update DRAG_DROP_STANDARDIZATION_PLAN.md
- Component documentation
- Developer guidelines

### Related Issues
Linked to critical DnD library conflicts issue.

---

**Impact:** This architectural change will resolve system crashes and create consistent drag-and-drop behavior across the entire platform.
EOF
)" \
  --label "architecture,technical-debt,drag-drop,priority-high" \
  --assignee "@me"

echo "✅ Issue 3 created"
echo ""

echo "🎉 All GitHub issues created successfully!"
echo ""
echo "Next steps:"
echo "1. Review issues in GitHub repository"
echo "2. Assign to appropriate team members"
echo "3. Add to project board/milestone"
echo "4. Begin implementation of critical fixes"
echo ""
echo "See CRITICAL_DEFECTS_LOG_v3.0.6.md for full defect tracking."
