# Global Title Dedupe + TK Refs — Operator Guide

Purpose
- Enforce global uniqueness by normalized task title across the entire account, without user intervention.
- Standardize all task references to the `TK-XXXXXX` format.

What’s Enabled Now
- Server dedupe merges duplicates by title globally:
  - Strong keys first (exact identifiers): `reminderId`, `ref`, `sourceRef`, `iosReminderId`, `externalId`.
  - Then a title-only pass groups by normalized title (URLs stripped, punctuation collapsed, lowercased). All items in a title group collapse to one canonical task.
  - Canonical pick order: not deleted → not done → oldest created → lexicographic id.
  - Code: functions/index.js:4675
- Mac app always triggers server dedupe after every sync (not just full):
  - Code: reminders-menubar/reminders-menubar/Services/FirebaseSyncService.swift:3183
- Nightly maintenance also forces the title-based dedupe:
  - Code: functions/index.js:5318
- Task references standardized to `TK-…`:
  - Server push payload fallback: functions/index.js:7684
  - Ensure missing refs job: functions/index.js:10295
  - Reporting fallback: functions/lib/reporting.js:207
  - Mac import fallback: reminders-menubar/reminders-menubar/Services/FirebaseSyncService.swift:1010

Environment
- Place your service account JSON at: `/Users/jim/GitHub/.secrets/bob20250810-service-account.json`
- Recommended exports for terminal sessions:
  - `cd /Users/jim/GitHub/bob`
  - `export SA="/Users/jim/GitHub/.secrets/bob20250810-service-account.json"`
  - `export GOOGLE_APPLICATION_CREDENTIALS="$SA"`
  - `export TARGET_UID='3L3nnXSuTPfr08c8DTXG5zYX37A2'` (avoid `UID` in zsh; it’s reserved)

Deploy Updated Functions
- `firebase deploy --only functions --project bob20250810`

One‑off Backfills and Actions
- Backfill task refs to TK-… for one user:
  - `node scripts/backfill-task-refs-tk.js --project bob20250810 --uid "$TARGET_UID" --dry-run`
  - `node scripts/backfill-task-refs-tk.js --project bob20250810 --uid "$TARGET_UID"`
- Backfill for all users:
  - `node scripts/backfill-task-refs-tk.js --project bob20250810`
- Force server dedupe now (includes global title merge):
  - `node scripts/run-dedupe-now.js --uid "$TARGET_UID" --serviceAccount "$SA" --hardDelete true`

How Title Dedupe Works
- Normalization removes URLs, punctuation, collapses whitespace, lowercase.
- Bucket key: `title:<normalized-title>` (global; ignores list and due date).
- All documents in a bucket except the canonical are marked with:
  - `duplicateOf: <canonicalTaskId>`
  - `duplicateKey: title:<normalized-title>`
  - `duplicateReason: duplicateTitleGlobal`
  - `deleted: true`, `status: 2`, and reminder completion hints for downstream sync.

Caveats
- Global title dedupe is aggressive. Very common titles (e.g., "Gym", "Call mum") will be collapsed across lists and dates. If you need exceptions (e.g., keep work vs personal separate), adjust rules to include persona or list scoping.

Troubleshooting
- Missing SA file:
  - Verify path: `test -f "$SA" && echo OK || echo MISSING`
- zsh variable error `bad math expression`:
  - Don’t use `UID` (reserved). Use `TARGET_UID` as above.
- Verify dedupe results:
  - Run now: `node scripts/run-dedupe-now.js --uid "$TARGET_UID" --serviceAccount "$SA" --hardDelete true`
  - Check activity stream in Firestore for `deduplicate_tasks` entries and `reasonCounts.duplicateTitleGlobal`.

