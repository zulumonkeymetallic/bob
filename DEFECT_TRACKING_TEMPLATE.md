# BOB Platform - Defect Tracking Template

## 🚨 Critical Defects (Immediate Action Required)

### Template for GitHub Issues:

```markdown
## Bug Report: [Short Description]

**Priority:** Critical/High/Medium/Low
**Component:** [Component Name]
**Version:** [v3.0.x]
**Environment:** Development/Production

### Description
[Clear description of the issue]

### Steps to Reproduce
1. Navigate to...
2. Click on...
3. Expected vs Actual behavior

### Technical Details
- **Error Message:** [If any]
- **Browser Console Logs:** [Copy console output]
- **Affected Files:** [List files]
- **Stack Trace:** [If available]

### Impact
- **User Experience:** [How this affects users]
- **Business Impact:** [Critical functionality broken?]
- **Workaround Available:** Yes/No

### Proposed Solution
[Technical approach to fix]

### Related Issues
[Link to related issues if any]
```

## 🎯 Current Critical Defects to Track

### 1. CRITICAL: Modern Stories table permission-denied via Goals
**GitHub Issue Body:** `.gh-issue-bodies/story_table_permission_denied.md`
**Impact:** Story edits from Goals view never persist; console flood of Firestore errors.

### 2. HIGH: Email automation offline & no SMTP configurator
**GitHub Issue Body:** `.gh-issue-bodies/email_delivery_config_ui.md`
**Impact:** Daily summary / data-quality emails fail. Need UI to manage Gmail SMTP + test send.

### 3. CRITICAL: AI planner nightly automation failing
**GitHub Issue Body:** `.gh-issue-bodies/ai_planner_nightly_automation.md`
**Impact:** Auto-plan, 24h rebalance, and nightly scheduling fail; daily pipeline blocked.

## 🔄 Defect Workflow

1. **Discovery:** Log in this file immediately
2. **GitHub Issue:** Create within 24 hours for High/Critical
3. **Fix Planning:** Assign to sprint backlog
4. **Testing:** Verify fix in development
5. **Deployment:** Include in next release
6. **Verification:** Confirm fix in production

## 📊 Defect Categories

- **Critical:** System crashes, data loss, security vulnerabilities
- **High:** Major feature broken, incorrect data display
- **Medium:** Minor functionality issues, UI/UX problems  
- **Low:** Cosmetic issues, performance optimizations

## 🛠️ Standard Labels for GitHub Issues

- `bug-critical` - System breaking issues
- `bug-high` - Major functionality broken
- `bug-medium` - Minor functionality issues
- `bug-low` - Cosmetic/performance issues
- `drag-drop` - Drag and drop related
- `ui-ux` - User interface issues
- `data-integrity` - Data handling problems
- `performance` - Performance related
- `mobile` - Mobile specific issues
- `accessibility` - Accessibility concerns
