#!/bin/bash

# BOB iOS Development - Quick Validation & Diagnostic Script

echo "🔍 BOB iOS Setup Validation"
echo "============================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERRORS=0
WARNINGS=0

# Check function
check_item() {
    local description="$1"
    local condition="$2"
    local error_level="$3"  # "error" or "warning"
    
    if eval "$condition"; then
        echo -e "${GREEN}✅ $description${NC}"
    else
        if [ "$error_level" = "error" ]; then
            echo -e "${RED}❌ $description${NC}"
            ERRORS=$((ERRORS + 1))
        else
            echo -e "${YELLOW}⚠️  $description${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
}

echo -e "${BLUE}System Requirements:${NC}"
check_item "macOS detected" '[[ "$OSTYPE" == "darwin"* ]]' "error"
check_item "Xcode installed" 'command -v xcodebuild >/dev/null 2>&1' "error"
check_item "Node.js installed" 'command -v node >/dev/null 2>&1' "warning"
check_item "Git installed" 'command -v git >/dev/null 2>&1' "error"

echo -e "\n${BLUE}iOS Project Structure:${NC}"
check_item "iOS app directory exists" '[ -d "$SCRIPT_DIR/ios-app" ]' "error"
check_item "Xcode project file exists" '[ -f "$SCRIPT_DIR/ios-app/BOBReminderSync.xcodeproj/project.pbxproj" ]' "error"
check_item "Main app file exists" '[ -f "$SCRIPT_DIR/ios-app/BOBReminderSync/BOBReminderSyncApp.swift" ]' "error"
check_item "Core services exist" '[ -f "$SCRIPT_DIR/ios-app/BOBReminderSync/Services/ReminderSyncManager.swift" ]' "error"
check_item "AI service exists" '[ -f "$SCRIPT_DIR/ios-app/BOBReminderSync/Services/AIService.swift" ]' "error"
check_item "Firebase service exists" '[ -f "$SCRIPT_DIR/ios-app/BOBReminderSync/Services/FirebaseService.swift" ]' "error"

echo -e "\n${BLUE}Build Scripts:${NC}"
check_item "Build script exists" '[ -f "$SCRIPT_DIR/ios-app/build.sh" ]' "warning"
check_item "Run script exists" '[ -f "$SCRIPT_DIR/ios-app/run.sh" ]' "warning"
check_item "Test script exists" '[ -f "$SCRIPT_DIR/ios-app/test.sh" ]' "warning"
check_item "Build script executable" '[ -x "$SCRIPT_DIR/ios-app/build.sh" ]' "warning"

echo -e "\n${BLUE}Configuration:${NC}"
check_item "Info.plist exists" '[ -f "$SCRIPT_DIR/ios-app/BOBReminderSync/Info.plist" ]' "error"
check_item "Firebase config exists" '[ -f "$SCRIPT_DIR/ios-app/BOBReminderSync/GoogleService-Info.plist" ]' "warning"
check_item "Environment config exists" '[ -f "$SCRIPT_DIR/ios-app/.env" ]' "warning"

echo -e "\n${BLUE}Setup Scripts:${NC}"
check_item "iOS setup script exists" '[ -f "$SCRIPT_DIR/setup-ios.sh" ]' "warning"
check_item "Firebase setup script exists" '[ -f "$SCRIPT_DIR/setup-firebase.sh" ]' "warning"
check_item "Master setup script exists" '[ -f "$SCRIPT_DIR/setup-master.sh" ]' "warning"

echo -e "\n${BLUE}Development Tools:${NC}"
check_item "xcpretty available" 'command -v xcpretty >/dev/null 2>&1' "warning"
check_item "firebase CLI available" 'command -v firebase >/dev/null 2>&1' "warning"

# Test Xcode project validity
if [ -f "$SCRIPT_DIR/ios-app/BOBReminderSync.xcodeproj/project.pbxproj" ]; then
    echo -e "\n${BLUE}Project Validation:${NC}"
    cd "$SCRIPT_DIR/ios-app" 2>/dev/null
    
    # Try to validate the project
    if xcodebuild -project BOBReminderSync.xcodeproj -list &>/dev/null; then
        echo -e "${GREEN}✅ Xcode project structure valid${NC}"
        
        # Show available schemes
        echo -e "${BLUE}Available build schemes:${NC}"
        xcodebuild -project BOBReminderSync.xcodeproj -list 2>/dev/null | grep -A 10 "Schemes:" | tail -n +2
    else
        echo -e "${RED}❌ Xcode project structure invalid${NC}"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Summary
echo -e "\n${BLUE}📊 Validation Summary:${NC}"
echo "======================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}🎉 Perfect! Everything looks good.${NC}"
    echo -e "${GREEN}Ready to start iOS development!${NC}"
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠️  $WARNINGS warnings found, but core setup is complete.${NC}"
    echo -e "${GREEN}You can start development and address warnings later.${NC}"
else
    echo -e "${RED}❌ Found $ERRORS critical errors and $WARNINGS warnings.${NC}"
    echo -e "${YELLOW}Please run setup scripts to fix issues:${NC}"
    echo "• ./setup-master.sh - Complete setup"
    echo "• ./setup-ios.sh - iOS-only setup"
    echo "• ./setup-firebase.sh - Firebase-only setup"
fi

echo -e "\n${BLUE}🚀 Next Steps:${NC}"
if [ $ERRORS -eq 0 ]; then
    echo "1. cd ios-app"
    echo "2. open BOBReminderSync.xcodeproj"
    echo "3. Add GoogleService-Info.plist (if missing)"
    echo "4. Build and run: ⌘+R in Xcode"
else
    echo "1. Fix critical errors by running setup scripts"
    echo "2. Re-run this validation: ./validate.sh"
    echo "3. Proceed with development once errors are resolved"
fi

echo -e "\n${BLUE}💡 Helpful Commands:${NC}"
echo "• ./validate.sh - Run this validation again"
echo "• cd ios-app && ./build.sh - Build the app"
echo "• cd ios-app && ./run.sh - Run on simulator"
echo "• cd ios-app && open . - Open project in Finder"

exit $ERRORS
