#!/bin/bash

# Add Labels to Enhanced Reminders Integration Issues
# This script adds proper labels to the recently created issues

# GitHub repository details
REPO="zulumonkeymetallic/bob"

echo "🏷️ Adding Labels to Enhanced Reminders Integration Issues..."

# Get the most recent issues (assuming they are the ones we just created)
echo "📋 Finding recent BOB-02X issues..."

# BOB-021: Bidirectional iOS Reminders Sync with Firebase
echo "🔄 Adding labels to BOB-021..."
gh issue edit --add-label "ios,firebase,sync,enhancement,high-priority,eventkit,integration" --repo $REPO $(gh issue list --limit 20 --json number,title --jq '.[] | select(.title | contains("BOB-021")) | .number')

# BOB-022: LLM-Powered Smart Deduplication System  
echo "🤖 Adding labels to BOB-022..."
gh issue edit --add-label "ai,llm,deduplication,firebase-functions,medium-priority,smart-features,automation" --repo $REPO $(gh issue list --limit 20 --json number,title --jq '.[] | select(.title | contains("BOB-022")) | .number')

# BOB-023: Auto-Story Linking with LLM Analysis
echo "🔗 Adding labels to BOB-023..."
gh issue edit --add-label "ai,llm,stories,auto-linking,smart-features,medium-priority,analysis,suggestions" --repo $REPO $(gh issue list --limit 20 --json number,title --jq '.[] | select(.title | contains("BOB-023")) | .number')

# BOB-024: Story Conversion Workflow with iOS Integration
echo "📝 Adding labels to BOB-024..."
gh issue edit --add-label "stories,conversion,ios,workflow,ui,high-priority,swiftui,reminders" --repo $REPO $(gh issue list --limit 20 --json number,title --jq '.[] | select(.title | contains("BOB-024")) | .number')

# BOB-025: Comprehensive Logging and Audit Trail
echo "📊 Adding labels to BOB-025..."
gh issue edit --add-label "logging,audit,transparency,ios,notes,medium-priority,firebase,tracking" --repo $REPO $(gh issue list --limit 20 --json number,title --jq '.[] | select(.title | contains("BOB-025")) | .number')

# BOB-026: iOS Reminders Lifecycle Management (No Delete)
echo "🛡️ Adding labels to BOB-026..."
gh issue edit --add-label "ios,policy,sync,lifecycle,critical-priority,reminders,eventkit,audit" --repo $REPO $(gh issue list --limit 20 --json number,title --jq '.[] | select(.title | contains("BOB-026")) | .number')

# BOB-027: Intelligent Story Name Prompting
echo "🎨 Adding labels to BOB-027..."
gh issue edit --add-label "ai,llm,stories,naming,suggestions,medium-priority,smart-features,ui" --repo $REPO $(gh issue list --limit 20 --json number,title --jq '.[] | select(.title | contains("BOB-027")) | .number')

echo ""
echo "✅ All labels added to Enhanced Reminders Integration issues!"
echo ""
echo "🎯 Labeled Issues Summary:"
echo "- BOB-021: ios, firebase, sync, enhancement, high-priority"
echo "- BOB-022: ai, llm, deduplication, firebase-functions, medium-priority"
echo "- BOB-023: ai, llm, stories, auto-linking, smart-features"
echo "- BOB-024: stories, conversion, ios, workflow, high-priority"
echo "- BOB-025: logging, audit, transparency, ios, notes"
echo "- BOB-026: ios, policy, sync, lifecycle, critical-priority"
echo "- BOB-027: ai, llm, stories, naming, suggestions"
echo ""
echo "🚀 All issues are now properly labeled and organized!"
