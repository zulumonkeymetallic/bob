#!/bin/bash

# BOB Single Issue Test Script - Debug Version
# Creates one issue with detailed logging

echo "🔍 BOB Single Issue Test Script"
echo "=============================="

# Set colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in BOB directory
echo -e "${BLUE}📋 Checking directory...${NC}"
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Run this script from BOB project root${NC}"
    exit 1
fi
echo -e "${GREEN}✅ In BOB project root${NC}"

# Check if gh CLI is installed
echo -e "${BLUE}📋 Checking GitHub CLI...${NC}"
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ GitHub CLI (gh) not found. Install: brew install gh${NC}"
    exit 1
fi
echo -e "${GREEN}✅ GitHub CLI found${NC}"

# Check if logged into GitHub
echo -e "${BLUE}📋 Checking GitHub authentication...${NC}"
if ! gh auth status &> /dev/null; then
    echo -e "${RED}❌ Not logged into GitHub. Please run: gh auth login${NC}"
    exit 1
fi
echo -e "${GREEN}✅ GitHub authentication confirmed${NC}"

# Show current repo info
echo -e "${BLUE}📋 Repository information:${NC}"
gh repo view --json name,owner,url | jq -r '"Repository: \(.owner.login)/\(.name)\nURL: \(.url)"'

# Test creating a single issue
echo -e "${BLUE}🎯 Creating test issue...${NC}"

TITLE="BOB-TEST - Goal Visualization Page Fix"
BODY="## 🔧 Fix Goal Visualization Page Issues

**Goal**: Resolve routing and display issues with /goals/roadmap page.

### Issues Identified
- Route /goals/roadmap not defined (causing console errors)
- ThemeBasedGanttChart component rendering problems
- Navigation inconsistencies

### Fixes Required
- Add missing route for /goals/roadmap ✅ (completed)
- Debug ThemeBasedGanttChart component
- Ensure consistent navigation behavior
- Test visualization rendering

### Current Status
- Route added in session ✅
- Component debugging needed

**Priority**: High
**Status**: Partially fixed"

echo -e "${YELLOW}📝 Creating issue with title: $TITLE${NC}"
echo -e "${YELLOW}📝 Issue body length: ${#BODY} characters${NC}"

# Create the issue with verbose output
echo -e "${BLUE}🚀 Executing gh issue create command...${NC}"

gh issue create \
    --title "$TITLE" \
    --body "$BODY" \
    --label "bug,enhancement" \
    --assignee "@me" \
    --repo zulumonkeymetallic/bob

# Check the exit code
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Issue created successfully!${NC}"
else
    echo -e "${RED}❌ Failed to create issue${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🔗 View all issues at: https://github.com/zulumonkeymetallic/bob/issues${NC}"
echo ""
echo -e "${GREEN}Test completed successfully! 🎉${NC}"
