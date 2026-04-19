# 191 – Scheduler automation for Monzo sync and daily priority emails

- Type: ops / infrastructure
- Priority: P1
- Areas: Cloud Scheduler, Background Jobs, Email

## Scope
- Run Monzo transaction sync nightly via Cloud Scheduler so tokens refresh automatically and budgeting data stays current.
- Reuse Scheduler for the AI-generated daily priority email (daily digest job) and ensure per-environment schedule definitions are documented.

## Acceptance Criteria
- `dailySync` Cloud Function invokes `syncMonzoDataForUser` for each profile with `monzoConnected`.
- Scheduler configuration steps are documented (CLI commands, per-environment project IDs, cron cadence).
- Daily digest email job schedule is confirmed in docs with override guidance for staging vs production.
- Runbook includes how to rerun Monzo sync manually (`syncMonzo`) and how to disable scheduler during incidents.

## Technical Notes
- Scheduler definitions live in Firebase Functions (`functions/index.js`) using `schedulerV2.onSchedule`.
- Use `gcloud scheduler jobs describe`/`update` commands if direct CLI edits are needed outside deploys.
- Capture secrets requirements (Monzo + email SMTP creds) alongside scheduler instructions.
