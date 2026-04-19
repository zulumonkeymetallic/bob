#!/usr/bin/env bash
set -euo pipefail

# Opens branches and PRs for a given REQ-ID with conventional commits.
# Usage: scripts/open-ai-layer-prs.sh CAL-6 "Two-way sync orchestrator" path1 [path2 ...]

REQ_ID=${1:?"Provide REQ-ID e.g., CAL-6"}
SHORT=${2:?"Provide short description"}
shift 2 || true

BRANCH="feature/ai-layer/${REQ_ID}-${SHORT// /-}"
BRANCH=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]/-._')

git checkout -b "$BRANCH"
git add -A
git commit -m "feat(${REQ_ID}): ${SHORT}" || true

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not installed. Skipping PR creation." >&2
  exit 0
fi

gh pr create \
  --title "feat(${REQ_ID}): ${SHORT}" \
  --body "Linked Epic: AI Scheduling & Enrichment Layer (see issues).\n\nImplements ${REQ_ID}." \
  --label epic:AI-scheduling || true

echo "Branch and PR prepared: $BRANCH"

