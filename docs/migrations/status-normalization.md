Status Normalization Migration

Overview
- Canonical status values:
  - Tasks: 0=To Do, 1=In Progress, 2=Done, 3=Blocked
  - Stories: 0=Backlog, 2=In Progress, 4=Done (Planned/Testing map to nearest)

Script
- Run a dry-run first to see counts:
  - `node scripts/migrate-status-normalization.js --entity=both --dry-run`
- Apply changes:
  - `node scripts/migrate-status-normalization.js --entity=both`

Notes
- Requires Firebase Admin credentials (ADC or GOOGLE_APPLICATION_CREDENTIALS).
- Unknown/unsupported string statuses are left unchanged and logged during dry-run counts.

