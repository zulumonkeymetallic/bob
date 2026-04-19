# [SEC-3] PII redaction in audits

- Labels: epic:AI-scheduling, sec, audit

Description
Ensure activity_stream metadata never contains PII or free-form message bodies. Keep references and counts only.

Acceptance Criteria
- Audits contain only IDs, refs, counts, times; no raw text bodies

Dependencies
- Audit helper

Test Notes
- Review generated audit docs after actions.
