#!/usr/bin/env bash
# Helper script to open GitHub issues for the outstanding cleanup items
# mentioned in the 2025-11-18 Monzo/AI discussion.
#
# Usage:
#   ./scripts/create-outstanding-issues.sh
# (Requires the GitHub CLI `gh` to be authenticated.)

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "The GitHub CLI (gh) is required to run this script." >&2
  exit 1
fi

read -r -p "This will create multiple GitHub issues. Continue? [y/N] " yn
case "$yn" in
  [Yy]*) ;;
  *) echo "Aborted."; exit 0;;
esac

create_issue() {
  title="$1"
  body="$2"
  echo "Creating: $title"
  gh issue create --title "$title" --body "$body"
}

create_issue "Monzo OAuth flow not deployed" "## Summary
- The session-based OAuth functions (\`createMonzoOAuthSession\`, new start/callback handlers) have not been deployed.
- Production still uses the placeholder \`MONZO_CLIENT_ID\`, so Monzo displays \"Woops!\" errors.
- We also need the hosting build with the updated Integration Settings UI.

## Acceptance Criteria
- \`MONZO_CLIENT_ID\`/\`MONZO_CLIENT_SECRET\` secrets populated with real values.
- \`MONZO_WEBHOOK_SECRET\` and \`MONZO_KMS_KEY\` configured in prod.
- Deploy the updated functions bundle and Hosting build so \`/api/monzo/start?session=…\` works end-to-end.
- Verify login succeeds and \`integration_status\` updates post-sync."

create_issue "Firestore rules/indexes missing in prod" "## Summary
- The repo includes new rules for \`integration_status\`, but production still runs the older rules leading to \`permission-denied\` errors.
- Kanban queries fail because the required composite index for \`sprint_task_index\` has not been created.

## Acceptance Criteria
- Deploy \`firestore.rules\` + \`firestore.indexes.json\`.
- Confirm clients can read/write \`integration_status\`.
- Build the suggested \`sprint_task_index\` composite index from the Firestore console and document the completion timestamp."

create_issue "Standardize task points across backend" "## Summary
- Tasks currently lack a guaranteed \`points\` field. LLM conversion heuristics infer effort from \`estimateMin\`, causing inconsistencies.
- We need every task doc to carry \`points\`, with defaults during creation and a backfill for historical data.

## Acceptance Criteria
- Update all task creation paths (AI orchestration, quick actions, reminder imports, etc.) to set \`points\` (default 1 or derived).
- Provide a migration script/trigger that backfills \`points\` for existing tasks.
- Update docs noting that \`tasks.points\` is required going forward."

create_issue "Expose task points editing in UI" "## Summary
- Even if backend sets \`points\`, users cannot view/edit the value across the web UI.
- We need points inputs on: Task modals (add/edit), Kanban quick edit, Quick Actions drawer, bulk importer, etc.

## Acceptance Criteria
- Every place where tasks are created/edited exposes a number input for points (1–8) with validation.
- Kanban cards surface the points value similar to stories.
- Persist changes back to Firestore and ensure forms initialize with current values."

create_issue "Sidebar quick edit needs searchable references" "## Summary
- In \`GlobalSidebar\` quick edit, goal/story reference fields are static dropdowns. When accounts have dozens of goals/stories, finding the right one is impossible.
- Replace these selects with searchable typeahead components that query Firestore.

## Acceptance Criteria
- Goal/story reference inputs allow typing to filter results (min 3 characters).
- Works for tasks, stories, and goals (where applicable) and updates Firestore IDs properly.
- Document any new helper (e.g., \`entityLookup.ts\`) for reuse."

echo "All issues created."
