#!/bin/bash

# Add Labels to All Recent Issues
# This script adds proper labels to recently created issues

# GitHub repository details
REPO="zulumonkeymetallic/bob"

echo "🏷️ Adding Labels to Recent Issues..."

# Get all recent issues and add appropriate labels
echo "📋 Getting recent issues list..."

# Function to add labels to an issue by searching for title keywords
add_labels_by_title() {
    local title="$1"
    local issue_number="$2"
    
    echo "🔍 Processing issue #${issue_number}: ${title}"
    
    # Enhanced Reminders Integration Issues (BOB-021 to BOB-027)
    if [[ "$title" == *"Bidirectional iOS Reminders Sync"* ]]; then
        gh issue edit $issue_number --add-label "ios,firebase,sync,enhancement,high-priority,eventkit,integration" --repo $REPO
        echo "   ✅ Added reminders sync labels"
    elif [[ "$title" == *"LLM-Powered Smart Deduplication"* ]]; then
        gh issue edit $issue_number --add-label "ai,llm,deduplication,firebase-functions,medium-priority,smart-features,automation" --repo $REPO
        echo "   ✅ Added deduplication labels"
    elif [[ "$title" == *"Auto-Story Linking with LLM"* ]]; then
        gh issue edit $issue_number --add-label "ai,llm,stories,auto-linking,smart-features,medium-priority,analysis,suggestions" --repo $REPO
        echo "   ✅ Added story linking labels"
    elif [[ "$title" == *"Story Conversion Workflow"* ]]; then
        gh issue edit $issue_number --add-label "stories,conversion,ios,workflow,ui,high-priority,swiftui,reminders" --repo $REPO
        echo "   ✅ Added conversion workflow labels"
    elif [[ "$title" == *"Comprehensive Logging and Audit"* ]]; then
        gh issue edit $issue_number --add-label "logging,audit,transparency,ios,notes,medium-priority,firebase,tracking" --repo $REPO
        echo "   ✅ Added logging labels"
    elif [[ "$title" == *"iOS Reminders Lifecycle Management"* ]]; then
        gh issue edit $issue_number --add-label "ios,policy,sync,lifecycle,critical-priority,reminders,eventkit,audit" --repo $REPO
        echo "   ✅ Added lifecycle management labels"
    elif [[ "$title" == *"Intelligent Story Name Prompting"* ]]; then
        gh issue edit $issue_number --add-label "ai,llm,stories,naming,suggestions,medium-priority,smart-features,ui" --repo $REPO
        echo "   ✅ Added story naming labels"
    
    # Roadmap Issues (BOB-028 to BOB-032)
    elif [[ "$title" == *"GPT Story Generator"* ]]; then
        gh issue edit $issue_number --add-label "ai,llm,stories,automation,medium-priority,smart-features,roadmap" --repo $REPO
        echo "   ✅ Added story generator labels"
    elif [[ "$title" == *"GPT Task Generator"* ]]; then
        gh issue edit $issue_number --add-label "ai,llm,tasks,automation,medium-priority,smart-features,roadmap" --repo $REPO
        echo "   ✅ Added task generator labels"
    elif [[ "$title" == *"Traceability Graph"* ]]; then
        gh issue edit $issue_number --add-label "ui,visualization,roadmap,medium-priority,analysis,workflow" --repo $REPO
        echo "   ✅ Added traceability graph labels"
    elif [[ "$title" == *"CSV/Excel Goal Import"* ]]; then
        gh issue edit $issue_number --add-label "import,data,roadmap,medium-priority,workflow" --repo $REPO
        echo "   ✅ Added import labels"
    elif [[ "$title" == *"Android TV App"* ]]; then
        gh issue edit $issue_number --add-label "android-tv,tracking,firebase,low-priority,roadmap" --repo $REPO
        echo "   ✅ Added Android TV labels"
    
    # Requirements Issues (BOB-033 to BOB-040)
    elif [[ "$title" == *"Habits & Chores"* ]]; then
        gh issue edit $issue_number --add-label "habits,tracking,medium-priority,ui,firebase" --repo $REPO
        echo "   ✅ Added habits labels"
    elif [[ "$title" == *"HealthKit & Digital Detox"* ]]; then
        gh issue edit $issue_number --add-label "health,integration,ios,tracking,medium-priority,api" --repo $REPO
        echo "   ✅ Added health labels"
    elif [[ "$title" == *"Telegram Bot"* ]]; then
        gh issue edit $issue_number --add-label "telegram,notifications,medium-priority,api,automation" --repo $REPO
        echo "   ✅ Added telegram labels"
    elif [[ "$title" == *"Voice Interface"* ]]; then
        gh issue edit $issue_number --add-label "voice,ai,ios,low-priority,smart-features" --repo $REPO
        echo "   ✅ Added voice labels"
    elif [[ "$title" == *"Monetization Tiers"* ]]; then
        gh issue edit $issue_number --add-label "monetization,high-priority,business,ui" --repo $REPO
        echo "   ✅ Added monetization labels"
    elif [[ "$title" == *"Expense Management"* ]]; then
        gh issue edit $issue_number --add-label "expenses,low-priority,roadmap,ui,tracking" --repo $REPO
        echo "   ✅ Added expense labels"
    elif [[ "$title" == *"Smart Home"* ]]; then
        gh issue edit $issue_number --add-label "smart-home,integration,low-priority,roadmap,api" --repo $REPO
        echo "   ✅ Added smart home labels"
    elif [[ "$title" == *"AI Coaching"* ]]; then
        gh issue edit $issue_number --add-label "coaching,ai,llm,low-priority,roadmap,smart-features" --repo $REPO
        echo "   ✅ Added coaching labels"
    else
        echo "   ⚠️  No specific labels found for: $title"
    fi
}

# Get recent issues (last 25) and process them
echo "🔄 Processing recent issues..."
gh issue list --limit 25 --json number,title --jq -r '.[] | "\(.number)|\(.title)"' --repo $REPO | while IFS='|' read -r number title; do
    add_labels_by_title "$title" "$number"
done

echo ""
echo "✅ Label addition process completed!"
echo ""
echo "🎯 All recent issues should now have proper labels assigned!"
echo ""
echo "📊 To verify, run: gh issue list --limit 20 --repo $REPO"
