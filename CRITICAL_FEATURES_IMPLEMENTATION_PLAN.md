# BOB V2.1.3 - Remaining Critical Features Implementation Plan

## 🎯 **PHASE 1: Comments & Updates System (4-5 hours)**

### **Step 1.1: Database Schema Enhancement**
```typescript
// Add to types.ts
interface Comment {
  id: string;
  entityType: 'goal' | 'story' | 'task';
  entityId: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: any;
  updatedAt: any;
  isSystemGenerated: boolean; // for auto-updates like status changes
}

interface EntityWithComments {
  comments?: Comment[];
  lastCommentAt?: any;
  commentCount?: number;
}
```

### **Step 1.2: Comments Component Creation**
- **File**: `CommentsSection.tsx`
- **Features**: 
  - Display comments list with timestamps
  - Add new comment form
  - System-generated updates (status changes, assignments)
  - Rich text editor integration
  - Real-time updates via Firebase listeners

### **Step 1.3: Integration Points**
- Add to goal, story, and task modals
- Add comment indicators in list views
- Create activity feed dashboard

---

## 🔢 **PHASE 2: Reference Numbers System (2-3 hours)**

### **Step 2.1: Reference Number Generation**
```typescript
// Add to utils/referenceNumbers.ts
export const generateReferenceNumber = async (
  type: 'goal' | 'story' | 'task',
  persona: string
): Promise<string> => {
  // Format: BOB-G-001, BOB-S-123, BOB-T-456
  // Or: P-G-001 (Personal), W-S-123 (Work)
};
```

### **Step 2.2: Database Updates**
- Add `referenceNumber` field to all entities
- Create reference number counter collection
- Update all create functions to auto-assign numbers

### **Step 2.3: UI Integration**
- Display reference numbers in cards and lists
- Add reference number search functionality
- Include in exports and reports

---

## 📅 **PHASE 3: Due Dates & Enhanced Columns (2-3 hours)**

### **Step 3.1: Due Date Implementation**
- Add `dueDate` field to Task interface
- Date picker in task creation/edit modals
- Due date column in task lists
- Overdue highlighting logic

### **Step 3.2: Customizable Columns**
- Column selection component
- User preferences storage
- Dynamic table rendering
- Column sorting and filtering

---

## 🏷️ **PHASE 4: Production Release (1 hour)**

### **Step 4.1: Testing & Validation**
- Test all new features end-to-end
- Verify mobile responsiveness
- Performance testing

### **Step 4.2: Deployment**
```bash
# Create production backup
./backup-release.sh v2.1.3

# Deploy to production
npm run build
firebase deploy --only hosting

# Create production tag
./production-tag.sh v2.1.3
```

---

## 📊 **IMPLEMENTATION PRIORITY**

### **Critical (Must Have - Phase 1)**
1. ✅ Navigation visibility fixes (COMPLETED)
2. ✅ Task editing functionality (COMPLETED)  
3. ✅ Status dropdown updates (COMPLETED)
4. 🔄 Comments/updates system (IN PROGRESS)
5. 🔄 Reference numbers (NEXT)

### **High Value (Should Have - Phase 2)**
6. Due dates with overdue highlighting
7. Customizable list columns
8. Search by reference number
9. Activity feed dashboard

### **Enhancement (Nice to Have - Phase 3)**
10. Rich text comments editor
11. @mention system
12. Comment notifications
13. Advanced filtering options

---

## 🚀 **NEXT ACTIONS**

1. **Immediate (Today)**: Start comments system implementation
2. **This Weekend**: Complete reference numbers system
3. **Monday**: Due dates and customizable columns
4. **Tuesday**: Production release v2.1.3

---

## 📝 **DEFECT STATUS UPDATE**

- **C36**: ✅ RESOLVED - Navigation visibility fixed
- **C37**: ✅ RESOLVED - Task editing implemented  
- **C38**: ✅ RESOLVED - Status dropdown added
- **C39**: 🔄 IN PROGRESS - Comments system design complete
- **C40**: 🔄 NEXT - Reference numbers ready for implementation
- **C35**: 🔴 PENDING - Sprint creation modal fix needed

**Total Progress**: 3/6 critical defects resolved (50% complete)
