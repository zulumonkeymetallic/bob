#!/bin/bash

# Load your GitHub token securely
source .env

REPO_OWNER="zulumonkeymetallic"
REPO_NAME="bob"
OUTPUT="issues.json"

echo "🔍 Fetching all issues from $REPO_OWNER/$REPO_NAME..."

# Fetch all paginated issues
page=1
all_issues="[]"

while : ; do
    echo "➡️  Fetching page $page..."
    response=$(curl -s \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/issues?state=all&per_page=100&page=$page")

    # Check if this page has issues
    issue_count=$(echo "$response" | jq length)
    if [ "$issue_count" -eq 0 ]; then
        break
    fi

    # Merge issues into all_issues
    all_issues=$(jq -s 'add' <(echo "$all_issues") <(echo "$response"))

    ((page++))
done

# Write the full output
echo "$all_issues" > "$OUTPUT"

echo "✅ Exported $(echo "$all_issues" | jq length) issues to $OUTPUT"