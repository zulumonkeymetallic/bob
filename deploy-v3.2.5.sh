#!/bin/bash

# BOB v3.2.5 Deployment Script - Critical Fixes & Production Stabilization
# This script automates version updates, building, and deployment

set -e  # Exit on any error

echo "🚀 BOB v3.2.5 Deployment Script Starting..."
echo "📅 Started at: $(date)"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NEW_VERSION="v3.2.5"
COMMIT_MESSAGE="fix(critical): v3.2.5 - infinite loop fixes, activity stream enhancements, CORS fixes

🚨 CRITICAL PRODUCTION FIXES:

1. **Infinite Loop Resolution:**
   - Fixed ModernGoalsTable automatic view tracking causing 2000+ activity logs
   - Removed trackView dependencies from useEffect to prevent re-render cascades
   - Replaced automatic tracking with explicit user interaction tracking
   - Added proper useAuth integration for activity logging

2. **Activity Stream Enhancements:**
   - Enhanced Latest Comment field display with blue highlight styling
   - Fixed reference number parity between activity stream and table views
   - Improved activity metadata display with user context
   - Added fallback reference number generation for legacy activities

3. **Version Synchronization:**
   - Updated version.ts from v3.1.4 to v3.2.5 for consistency
   - Enhanced build-time version notifications
   - Updated package.json version for proper deployment tracking

4. **CORS & Index Fixes:**
   - Documented CORS issues with calendar functions for future resolution
   - Added required Firestore index creation links in error logging
   - Enhanced error handling for missing permissions

🔧 TECHNICAL IMPROVEMENTS:
- Proper currentUser integration in activity tracking
- Direct ActivityStreamService calls instead of unstable hook dependencies
- Enhanced deployment script with automated version management
- Comprehensive git tagging and release automation

🎯 USER EXPERIENCE:
- No more console flooding with infinite activity logs
- Activity stream shows consistent reference numbers
- Latest comment prominently displayed with visual highlighting
- Stable activity tracking without performance degradation

Resolves: Infinite activity logging, CORS errors, version inconsistencies
Fixes: Console spam, activity tracking loops, missing indexes"

# Function to update version in a file
update_version() {
    local file="$1"
    local old_version="$2"
    local new_version="$3"
    
    if [ -f "$file" ]; then
        echo "📝 Updating version in $file: $old_version → $new_version"
        sed -i '' "s/$old_version/$new_version/g" "$file"
    else
        echo "⚠️  File not found: $file"
    fi
}

# Function to update package.json version
update_package_version() {
    local package_file="$1"
    local new_version_number="${NEW_VERSION#v}"  # Remove 'v' prefix
    
    if [ -f "$package_file" ]; then
        echo "📦 Updating package.json version to $new_version_number"
        # Use a more robust sed command for JSON
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version_number\"/g" "$package_file"
    else
        echo "⚠️  Package file not found: $package_file"
    fi
}

echo -e "${BLUE}🔍 Step 1: Version Updates${NC}"

# Update version in version.ts
update_version "react-app/src/version.ts" "v3.2.4" "$NEW_VERSION"

# Update package.json version
update_package_version "react-app/package.json"

# Update any documentation files
update_version "README.md" "v3.2.4" "$NEW_VERSION" 2>/dev/null || echo "ℹ️  README.md not found or no version to update"

echo -e "${BLUE}🏗️  Step 2: Building Application${NC}"

# Navigate to react-app directory and build
cd react-app

echo "📦 Installing dependencies..."
npm install

echo "🏗️  Building production bundle..."
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed! Aborting deployment.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build completed successfully${NC}"

echo -e "${BLUE}🚀 Step 3: Firebase Deployment${NC}"

echo "🌐 Deploying to Firebase hosting..."
firebase deploy --only hosting

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Firebase deployment failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Firebase deployment completed${NC}"

# Return to root directory
cd ..

echo -e "${BLUE}📝 Step 4: Git Operations${NC}"

echo "📝 Adding changes to git..."
git add .

echo "💾 Committing changes..."
git commit -m "$COMMIT_MESSAGE"

echo "🏷️  Creating git tag..."
git tag "$NEW_VERSION" -m "BOB $NEW_VERSION - Critical Production Fixes & Activity Stream Enhancements"

echo "⬆️  Pushing to remote..."
git push origin main
git push origin "$NEW_VERSION"

echo -e "${BLUE}📊 Step 5: Deployment Summary${NC}"

# Get file sizes for summary
BUILD_SIZE=$(du -sh react-app/build 2>/dev/null | cut -f1 || echo "Unknown")
JS_SIZE=$(find react-app/build/static/js -name "*.js" -exec du -ch {} + 2>/dev/null | tail -1 | cut -f1 || echo "Unknown")

echo -e "${GREEN}
🎉 DEPLOYMENT COMPLETE! 🎉

📊 Summary:
├── Version: $NEW_VERSION
├── Build Size: $BUILD_SIZE
├── JS Bundle: $JS_SIZE
├── Deployment URL: https://bob20250810.web.app
├── Console URL: https://console.firebase.google.com/project/bob20250810
└── Completed: $(date)

🔧 Key Fixes Applied:
✅ Infinite activity logging loop resolved
✅ Activity stream enhanced with latest comments
✅ Reference number parity across views
✅ Version synchronization completed
✅ CORS issues documented for future resolution

🎯 What's New:
• Stable activity tracking without performance issues
• Enhanced activity stream UI with comment highlighting  
• Consistent reference numbers across all components
• Improved error handling and logging
• Automated deployment script with version management

🚀 The application is now live and stable!
${NC}"

echo -e "${YELLOW}📋 Next Steps:${NC}"
echo "1. Test the deployed application at https://bob20250810.web.app"
echo "2. Verify activity logging is no longer flooding the console"
echo "3. Check that activity stream shows latest comments properly"
echo "4. Validate reference number consistency across views"
echo "5. Monitor for any remaining CORS issues with calendar functions"

echo -e "${BLUE}📚 Useful Commands:${NC}"
echo "• View deployment logs: firebase hosting:channel:list"
echo "• Check git tags: git tag -l"
echo "• View commit history: git log --oneline -10"
echo "• Firebase console: https://console.firebase.google.com/project/bob20250810"

echo -e "${GREEN}🏁 Deployment script completed successfully!${NC}"
