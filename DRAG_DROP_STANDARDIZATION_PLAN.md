# Drag-and-Drop Standardization Plan - BOB Platform

**Priority:** Critical  
**Target Version:** v3.0.7  
**Estimated Effort:** 2-3 days  

---

## 🎯 OBJECTIVE

Standardize all drag-and-drop functionality on `@dnd-kit` library across the entire BOB platform to resolve conflicts, crashes, and inconsistent behavior.

---

## 📊 CURRENT STATE ANALYSIS

### Components Using Drag-and-Drop:

| Component | Current Library | Status | Priority |
|-----------|----------------|---------|----------|
| ModernGoalsTable | @dnd-kit | ✅ Working | Keep |
| ModernTaskTable-Simple | @dnd-kit | ✅ Working | Keep |
| ModernTaskTableProper | @dnd-kit | ✅ Working | Keep |
| ModernKanbanBoard | react-beautiful-dnd | ⚠️ Working but inconsistent | Convert |
| SprintPlanner | react-dnd | ❌ BROKEN (not installed) | Convert |
| Column.tsx | react-beautiful-dnd | ⚠️ Supporting component | Convert |

### Package Dependencies to Remove:
```json
"react-beautiful-dnd": "^13.1.1"  // Remove after conversion
```

### Package Dependencies to Keep:
```json
"@dnd-kit/core": "^6.3.1",
"@dnd-kit/sortable": "^10.0.0", 
"@dnd-kit/utilities": "^3.2.2"
```

---

## 🔧 CONVERSION PLAN

### Phase 1: Fix Critical Crash (Immediate)
**Target:** Fix SprintPlanner crash

**Actions:**
1. ✅ **COMPLETED:** Create SprintPlannerSimple (temporary fix)
2. ✅ **COMPLETED:** Update App.tsx routing
3. **TODO:** Convert SprintPlanner to @dnd-kit

### Phase 2: Convert ModernKanbanBoard
**Target:** Standardize Current Sprint Kanban

**Current Implementation (react-beautiful-dnd):**
```tsx
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';

<DragDropContext onDragEnd={handleDragEnd}>
  <Droppable droppableId="kanban">
    {(provided) => (
      <div ref={provided.innerRef} {...provided.droppableProps}>
        <Draggable draggableId={item.id} index={index}>
          {(provided) => (
            <div ref={provided.innerRef} {...provided.dragHandleProps} {...provided.draggableProps}>
              // Item content
            </div>
          )}
        </Draggable>
      </div>
    )}
  </Droppable>
</DragDropContext>
```

**Target Implementation (@dnd-kit):**
```tsx
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';

<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <SortableContext items={items} strategy={verticalListSortingStrategy}>
    {items.map(item => <SortableItem key={item.id} item={item} />)}
  </SortableContext>
</DndContext>
```

### Phase 3: Clean Up Dependencies
**Target:** Remove unused packages

**Actions:**
1. Remove `react-beautiful-dnd` from package.json
2. Update any remaining imports
3. Test all drag-and-drop functionality
4. Update documentation

---

## 🧪 TESTING STRATEGY

### Unit Testing
- [ ] Each converted component renders without errors
- [ ] Drag events trigger correctly  
- [ ] Drop zones accept appropriate items
- [ ] State updates persist correctly

### Integration Testing  
- [ ] Cross-component drag-and-drop works consistently
- [ ] No library conflicts or version issues
- [ ] Performance maintained or improved
- [ ] Mobile touch events work correctly

### Regression Testing
- [ ] All existing functionality preserved
- [ ] Visual appearance unchanged (unless improved)
- [ ] Accessibility features maintained
- [ ] Keyboard navigation works

---

## 📝 IMPLEMENTATION STEPS

### Step 1: Create SprintPlanner with @dnd-kit
```typescript
// File: SprintPlanner.tsx (new implementation)
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';

// Implementation following ModernGoalsTable pattern
```

### Step 2: Convert ModernKanbanBoard  
```typescript
// File: ModernKanbanBoard.tsx (convert)
// Replace react-beautiful-dnd imports with @dnd-kit
// Update component structure to match @dnd-kit patterns
// Preserve all existing functionality
```

### Step 3: Update Supporting Components
```typescript
// File: Column.tsx (convert or remove if unused)
// Update any shared utilities or types
```

### Step 4: Package Cleanup
```bash
npm uninstall react-beautiful-dnd
npm run build  # Verify no missing dependencies
npm run test   # Run test suite
```

---

## 🎨 DESIGN CONSIDERATIONS

### Consistent Visual Feedback
- Standardized drag handle styling
- Consistent drop zone indicators  
- Unified animation timing
- Matching placeholder styles

### Accessibility
- Keyboard navigation support
- Screen reader announcements
- Focus management during drags
- ARIA labels and roles

### Performance
- Minimize re-renders during drag
- Efficient collision detection
- Optimized for large lists
- Mobile touch optimization

---

## 🚀 BENEFITS

### Technical Benefits
- **Single DnD library:** Reduced bundle size and complexity
- **Consistent API:** Easier development and maintenance  
- **Better Performance:** @dnd-kit is more performant than react-beautiful-dnd
- **Active Maintenance:** @dnd-kit is actively maintained

### User Experience Benefits
- **Consistent Behavior:** Same drag-and-drop feel across all components
- **Better Mobile Support:** @dnd-kit has better touch support
- **Improved Accessibility:** Better screen reader and keyboard support
- **Faster Loading:** Smaller bundle size

### Development Benefits  
- **Easier Debugging:** Single library to understand
- **Consistent Patterns:** Reusable drag-and-drop components
- **Better Documentation:** Single set of docs to reference
- **Future-Proof:** Active community and development

---

## 📅 TIMELINE

### Week 1: Critical Fix
- Day 1-2: Convert SprintPlanner to @dnd-kit
- Day 3: Testing and bug fixes
- Day 4-5: Deploy and monitor

### Week 2: Full Conversion  
- Day 1-2: Convert ModernKanbanBoard  
- Day 3: Convert supporting components
- Day 4: Package cleanup and testing
- Day 5: Documentation and deployment

---

## ✅ SUCCESS CRITERIA

- [ ] No drag-and-drop related crashes
- [ ] All components use @dnd-kit consistently  
- [ ] Bundle size reduced by removing react-beautiful-dnd
- [ ] All existing functionality preserved
- [ ] Performance maintained or improved
- [ ] Full test coverage passes
- [ ] Documentation updated

---

**Created:** August 31, 2025  
**Owner:** Development Team  
**Reviewers:** Architecture Team, QA Team  
**Status:** Ready for Implementation
