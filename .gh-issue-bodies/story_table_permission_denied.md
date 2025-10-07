## 🚨 Critical Bug Report: Modern Story Table edits fail via Goals list

**Priority:** Critical  
**Component:** Goals → ModernStoriesTable  
**Version:** v3.9.1 (Oct 2025)  
**Environment:** Production (Web)

### Description
When a user opens the Modern Stories table from the Goals list and attempts to save changes, Firestore rejects the write with a `permission-denied` error. The table silently fails, so edits are never persisted.

### Steps to Reproduce
1. Navigate to Goals → select a goal → open the associated Stories list.
2. Edit a story inline (e.g., change status or title) and hit save.
3. Observe console throws:
   ```
   [2025-10-05T14:15:39.326Z]  @firebase/firestore: "Firestore (12.1.0): Uncaught Error in snapshot listener:" "FirebaseError: [code=permission-denied]: Missing or insufficient permissions."
   ```
4. Refresh – the change is lost.

### Impact
- Story updates from Goals view are completely broken.  
- Breaks alignment workflows tied to goals.  
- Critical productivity regression for primary daily flow.

### Expected vs Actual
- **Expected:** Stories edited via Goals view should persist exactly as when editing from the dedicated Stories page.  
- **Actual:** Edits are blocked by Firestore security; UI offers no feedback.

### Suspected Root Cause
- ModernStoriesTable requests use a query scoped to a Firestore security rule path that differs from `/stories/{id}` read/write rules. Likely missing `ownerUid == request.auth.uid` clause or using an aggregation collection without rules.

### Proposed Fix
1. Audit Firestore security rules covering `stories` and any materialized view accessed by Goals → Stories table.  
2. Ensure writes from Goals context use the same authorized `stories` document path.  
3. Add defensive UI error handling so the user sees permission problems immediately.

### Verification Checklist
- [ ] Update Firestore rules + emulator tests.  
- [ ] Regression test story editing from both Stories page and Goals view.  
- [ ] Confirm no additional permission-denied warnings in console.

---
**SLA:** Blocker – requires immediate attention.
