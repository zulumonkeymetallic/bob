# [SEC-2] Secrets management and redaction helpers

- Labels: epic:AI-scheduling, sec

Description
Add small helper to redact tokens/emails/URLs in logs and ensure Secret Manager is used across all LLM and calendar paths.

Acceptance Criteria
- Redaction helper used in new wrappers
- No secrets printed in logs

Dependencies
- functions/params defineSecret

Test Notes
- Inspect logs during runs; confirm redaction.
