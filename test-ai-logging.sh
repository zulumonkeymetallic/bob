#!/bin/bash

# BOB v3.5.7 - AI Usage Logging Test Script
# Tests the comprehensive AI usage logging system

echo "🤖 BOB v3.5.7: AI Usage Logging Test"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Not in BOB project root directory"
    exit 1
fi

echo "📋 Starting AI Usage Logging System Test..."

# Step 1: Build the React app
echo "🔨 Building React app..."
cd react-app
npm run build
if [ $? -ne 0 ]; then
    echo "❌ React build failed"
    exit 1
fi
cd ..

# Step 2: Deploy Firebase functions
echo "🚀 Deploying Firebase functions..."
firebase deploy --only functions
if [ $? -ne 0 ]; then
    echo "❌ Functions deployment failed"
    exit 1
fi

# Step 3: Deploy hosting (includes AI Usage Dashboard)
echo "📱 Deploying hosting with AI Usage Dashboard..."
firebase deploy --only hosting
if [ $? -ne 0 ]; then
    echo "❌ Hosting deployment failed"
    exit 1
fi

# Step 4: Test AI logging endpoints
echo "🧪 Testing AI logging endpoints..."

# Get Firebase project ID
PROJECT_ID=$(firebase use | grep "Active Project" | awk '{print $3}' | tr -d '()')
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Could not determine Firebase project ID"
    exit 1
fi

BASE_URL="https://us-central1-${PROJECT_ID}.cloudfunctions.net"

echo "🔍 Testing planCalendar function with AI logging..."
curl -X POST "${BASE_URL}/planCalendar" \
  -H "Content-Type: application/json" \
  -d '{
    "goals": [
      {
        "id": "test-goal-1",
        "title": "Test AI Logging Goal",
        "description": "A simple goal to test AI usage logging",
        "priority": "high",
        "category": "testing"
      }
    ],
    "constraints": {
      "startDate": "2025-01-04",
      "endDate": "2025-01-11",
      "dailyHours": 8
    }
  }' \
  --silent \
  --write-out "HTTP Status: %{http_code}\n"

echo ""
echo "🔍 Testing prioritizeBacklog function with AI logging..."
curl -X POST "${BASE_URL}/prioritizeBacklog" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "id": "test-task-1",
        "title": "Test AI Logging Task",
        "description": "A simple task to test AI usage logging",
        "estimatedEffort": 2,
        "category": "testing"
      },
      {
        "id": "test-task-2", 
        "title": "Another Test Task",
        "description": "Another task for AI logging verification",
        "estimatedEffort": 4,
        "category": "development"
      }
    ],
    "goals": [
      {
        "id": "test-goal-1",
        "title": "Test AI Logging Goal",
        "priority": "high"
      }
    ]
  }' \
  --silent \
  --write-out "HTTP Status: %{http_code}\n"

echo ""
echo "✅ AI Usage Logging Test Complete!"
echo ""
echo "📊 To view AI usage analytics:"
echo "1. Visit your BOB application"
echo "2. Navigate to Settings → AI Usage Analytics"
echo "3. Check for logged AI calls from the test functions"
echo ""
echo "🔍 Check Firestore collections:"
echo "- ai_usage_logs: Individual AI call logs"
echo "- ai_usage_aggregates: Daily aggregate data"
echo ""
echo "💰 Monitor token usage and costs in the dashboard"
