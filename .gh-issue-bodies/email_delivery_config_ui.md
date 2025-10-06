## 🔥 High Priority Bug Report: Transactional emails are not sending + missing SMTP controls

**Priority:** High (blocking critical automations)  
**Component:** Firebase Functions – `dispatchDailySummaryEmail`, `dispatchDataQualityEmail`; React Settings UI  
**Version:** v3.9.1  
**Environment:** Production

### Description
- Scheduled and manual emails (daily summary, data quality, digest) silently fail because SMTP credentials are not configurable or testable from the product UI.  
- Functions rely on env vars (`EMAIL_USER`, `EMAIL_PASSWORD`) that are not set for the current deployment.  
- No quick way for operators to verify credentials or send a test email.

### Symptoms
- Daily summary/data quality status docs show repeated `error` results.  
- No emails delivered to inbox.  
- Operators must redeploy functions to change credentials.

### Requirements
1. **Settings → System tab**: add secure inputs for SMTP host, port, username, app password (with masking + Firestore persistence / Secret Manager integration).  
2. Provide “Send Test Email” button that hits a new callable (`sendTestEmail`) and surfaces success/failure inline.  
3. Update Cloud Functions to read SMTP config from Secret Manager first, falling back to Firestore-managed settings.  
4. Gracefully log failures back to `automation_status` with actionable messages.

### Impact
- Daily automation emails are blocked, removing the morning briefing flow.  
- Support cannot remediate without engineering.

### Acceptance Criteria
- [ ] Can configure SMTP (host, port, user, password, from address) via Settings UI.  
- [ ] Test email succeeds and shows toast confirmation.  
- [ ] Scheduled functions pick up updated credentials without redeploy (use Secret Manager + runtime config).  
- [ ] Detailed error messages recorded in diagnostics log when send fails.

### Follow-up
- Document credential rotation SOP after UI save.  
- Hook into new diagnostics logger so operators can download failure details from Settings → Diagnostics tab.
