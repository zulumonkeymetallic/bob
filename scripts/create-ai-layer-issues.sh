#!/usr/bin/env bash
set -euo pipefail

# Creates/links issues for the AI Scheduling & Enrichment Layer epic using GitHub CLI.
# Requires: gh CLI authenticated, repo remote set.

EPIC_TITLE="Epic — AI Scheduling & Enrichment Layer"
EPIC_BODY_FILE="issues/epic-ai-scheduling-and-enrichment-layer.md"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install https://cli.github.com/ and authenticate first." >&2
  exit 1
fi

echo "Ensuring labels exist..."
ensure_label() {
  local name="$1"; local color="$2"; local desc="$3";
  gh label create "$name" --color "$color" --description "$desc" 2>/dev/null || true
}
ensure_label "epic:AI-scheduling" "BFD4F2" "Epic grouping for AI Scheduling"
ensure_label "calendar" "0E8A16" "Calendar & sync"
ensure_label "ui" "1D76DB" "Frontend/UI"
ensure_label "firestore" "5319E7" "Firestore models & rules"
ensure_label "LLM" "FBCA04" "Gemini/LLM"
ensure_label "github-sync" "0052CC" "Repo/GitHub automation"
ensure_label "audit" "E11D21" "Audit & activity stream"
ensure_label "capacity-planner" "C2E0C6" "Capacity & planner"
ensure_label "sec" "E99695" "Security & secrets"

echo "Locating or creating Epic..."
# Try to find an existing Epic first
EPIC_URL=$(gh issue list -S "$EPIC_TITLE" --json url --jq '.[0].url' 2>/dev/null || true)
if [[ -z "$EPIC_URL" ]]; then
  EPIC_URL=$(gh issue create --title "$EPIC_TITLE" --body-file "$EPIC_BODY_FILE" --label "epic:AI-scheduling" 2>/dev/null || true)
fi
echo "Epic: ${EPIC_URL:-'(not captured)'}"

echo "Creating requirement issues and linking to Epic..."
# Only create issues for new AI-layer requirement files
files=(
  issues/CAL-*.md
  issues/DUR-*.md
  issues/GOAL-*.md
  issues/CAP-*.md
  issues/LLM-*.md
  issues/GIT-*.md
  issues/AUD-*.md
  issues/SEC-*.md
)

for f in "${files[@]}"; do
  # skip patterns with no matches
  [[ -e $f ]] || continue
  base=$(basename "$f")
  # skip epic file itself
  if [[ "$base" == "epic-ai-scheduling-and-enrichment-layer.md" ]]; then continue; fi
  title_line=$(head -n1 "$f" | sed 's/^# //')
  raw_labels=$(grep -i '^- Labels:' -m1 "$f" | sed 's/^-[ ]*Labels:[ ]*//I')
  # Build repeated --label args and ensure labels exist
  label_args=()
  IFS=',' read -r -a label_list <<< "$raw_labels"
  for token in "${label_list[@]}"; do
    t=$(echo "$token" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/,//g')
    [[ -z "$t" ]] && continue
    # Try to ensure label exists with a neutral color if we don't know it
    ensure_label "$t" "D4C5F9" "Auto-created"
    label_args+=(--label "$t")
  done
  url=$(gh issue create --title "$title_line" --body-file "$f" "${label_args[@]}" 2>/dev/null || true)
  echo "$base => $url"
  # Link back to the Epic if we have a URL
  if [[ -n "$EPIC_URL" && -n "$url" ]]; then
    gh issue comment "$url" --body "Linked to Epic: $EPIC_URL" 2>/dev/null || true
  fi
done

echo "Done. Review issues in GitHub UI."
