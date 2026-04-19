#!/bin/bash

# Create GitHub Labels for BOB Project
# This script creates all necessary labels for the enhanced reminders integration

# GitHub repository details
REPO="zulumonkeymetallic/bob"

echo "🏷️ Creating GitHub Labels for BOB Project..."

# Core Technology Labels
gh label create "ios" --description "iOS app development and features" --color "007AFF" --repo $REPO || echo "Label 'ios' already exists"
gh label create "firebase" --description "Firebase backend integration" --color "FF6F00" --repo $REPO || echo "Label 'firebase' already exists"
gh label create "ai" --description "AI and machine learning features" --color "9C27B0" --repo $REPO || echo "Label 'ai' already exists"
gh label create "llm" --description "Large Language Model integration" --color "673AB7" --repo $REPO || echo "Label 'llm' already exists"

# Feature Categories
gh label create "sync" --description "Data synchronization features" --color "4CAF50" --repo $REPO || echo "Label 'sync' already exists"
gh label create "stories" --description "Story management and features" --color "FF9800" --repo $REPO || echo "Label 'stories' already exists"
gh label create "tasks" --description "Task management features" --color "2196F3" --repo $REPO || echo "Label 'tasks' already exists"
gh label create "reminders" --description "iOS Reminders integration" --color "FF5722" --repo $REPO || echo "Label 'reminders' already exists"

# Technical Areas
gh label create "ui" --description "User interface and UX" --color "E91E63" --repo $REPO || echo "Label 'ui' already exists"
gh label create "api" --description "API development and integration" --color "795548" --repo $REPO || echo "Label 'api' already exists"
gh label create "logging" --description "Logging and audit trail" --color "607D8B" --repo $REPO || echo "Label 'logging' already exists"
gh label create "workflow" --description "User workflows and processes" --color "9E9E9E" --repo $REPO || echo "Label 'workflow' already exists"

# Feature Types
gh label create "enhancement" --description "New feature or enhancement" --color "84CC16" --repo $REPO || echo "Label 'enhancement' already exists"
gh label create "integration" --description "Third-party integration" --color "06B6D4" --repo $REPO || echo "Label 'integration' already exists"
gh label create "automation" --description "Automated processes" --color "8B5CF6" --repo $REPO || echo "Label 'automation' already exists"
gh label create "smart-features" --description "AI-powered smart features" --color "EC4899" --repo $REPO || echo "Label 'smart-features' already exists"

# Technical Implementation
gh label create "deduplication" --description "Duplicate detection and handling" --color "F59E0B" --repo $REPO || echo "Label 'deduplication' already exists"
gh label create "auto-linking" --description "Automatic content linking" --color "10B981" --repo $REPO || echo "Label 'auto-linking' already exists"
gh label create "conversion" --description "Data format conversion" --color "EF4444" --repo $REPO || echo "Label 'conversion' already exists"
gh label create "lifecycle" --description "Data lifecycle management" --color "6366F1" --repo $REPO || echo "Label 'lifecycle' already exists"

# System Areas
gh label create "firebase-functions" --description "Firebase Cloud Functions" --color "FFAB00" --repo $REPO || echo "Label 'firebase-functions' already exists"
gh label create "eventkit" --description "iOS EventKit framework" --color "34D399" --repo $REPO || echo "Label 'eventkit' already exists"
gh label create "swiftui" --description "SwiftUI user interface" --color "007AFF" --repo $REPO || echo "Label 'swiftui' already exists"
gh label create "notifications" --description "Push notifications and alerts" --color "F472B6" --repo $REPO || echo "Label 'notifications' already exists"

# Policy and Governance
gh label create "policy" --description "System policies and rules" --color "78716C" --repo $REPO || echo "Label 'policy' already exists"
gh label create "audit" --description "Audit trail and compliance" --color "525252" --repo $REPO || echo "Label 'audit' already exists"
gh label create "transparency" --description "User transparency features" --color "A3A3A3" --repo $REPO || echo "Label 'transparency' already exists"
gh label create "notes" --description "Notes and documentation features" --color "D4D4D8" --repo $REPO || echo "Label 'notes' already exists"

# Suggestions and Intelligence
gh label create "suggestions" --description "AI-powered suggestions" --color "C084FC" --repo $REPO || echo "Label 'suggestions' already exists"
gh label create "naming" --description "Intelligent naming systems" --color "FB7185" --repo $REPO || echo "Label 'naming' already exists"
gh label create "analysis" --description "Content analysis features" --color "60A5FA" --repo $REPO || echo "Label 'analysis' already exists"

# Priority Labels (if not already exist)
gh label create "critical-priority" --description "Critical priority issues" --color "DC2626" --repo $REPO || echo "Label 'critical-priority' already exists"
gh label create "high-priority" --description "High priority issues" --color "EA580C" --repo $REPO || echo "Label 'high-priority' already exists"
gh label create "medium-priority" --description "Medium priority issues" --color "D97706" --repo $REPO || echo "Label 'medium-priority' already exists"
gh label create "low-priority" --description "Low priority issues" --color "65A30D" --repo $REPO || echo "Label 'low-priority' already exists"

echo ""
echo "✅ GitHub Labels Creation Complete!"
echo ""
echo "📊 Created Labels Categories:"
echo "🔧 Technology: ios, firebase, ai, llm"
echo "🎯 Features: sync, stories, tasks, reminders"
echo "⚙️ Technical: ui, api, logging, workflow"
echo "🚀 Types: enhancement, integration, automation"
echo "🤖 Intelligence: smart-features, suggestions, analysis"
echo "📋 Priorities: critical, high, medium, low"
echo ""
echo "🎉 All labels are now available for issue tagging!"
