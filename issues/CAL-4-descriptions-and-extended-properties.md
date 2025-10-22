# [CAL-4] Descriptions and extendedProperties enrichment

- Labels: epic:AI-scheduling, calendar

Description
Standardize event description templates and extendedProperties.private fields, ensuring safe content and no PII leakage in audits.

Acceptance Criteria
- Description template applied for goal/story/task links
- extendedProperties include stable bob-* keys
- Audit entries redact free-text description content

Dependencies
- calendarSync.js, applyCalendarBlocks, audit policy

Test Notes
- Create/update event; verify sanitized audit and stable properties.
