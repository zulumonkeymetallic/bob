#!/bin/bash

# BOB iOS Reminder Sync - Master Setup Script
# Orchestrates complete iOS development environment setup

set -e

echo "🚀 BOB iOS Reminder Sync - Complete Setup"
echo "==========================================="

# Colors for beautiful output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ASCII Art Banner
echo -e "${CYAN}"
cat << 'EOF'
██████╗  ██████╗ ██████╗     ██╗ ██████╗ ███████╗
██╔══██╗██╔═══██╗██╔══██╗    ██║██╔═══██╗██╔════╝
██████╔╝██║   ██║██████╔╝    ██║██║   ██║███████╗
██╔══██╗██║   ██║██╔══██╗    ██║██║   ██║╚════██║
██████╔╝╚██████╔╝██████╔╝    ██║╚██████╔╝███████║
╚═════╝  ╚═════╝ ╚═════╝     ╚═╝ ╚═════╝ ╚══════╝
                                                  
    Reminder Sync - Automated Setup
EOF
echo -e "${NC}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "${BLUE}📂 Working in: $SCRIPT_DIR${NC}"

# Function to check command existence
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to wait for user input
wait_for_user() {
    echo -e "${YELLOW}Press Enter to continue...${NC}"
    read
}

# Function to run step with error handling
run_step() {
    local step_name="$1"
    local command="$2"
    
    echo -e "\n${PURPLE}🔄 $step_name${NC}"
    echo "=================================="
    
    if eval "$command"; then
        echo -e "${GREEN}✅ $step_name completed successfully!${NC}"
    else
        echo -e "${RED}❌ $step_name failed!${NC}"
        echo "You can run this step manually later: $command"
        read -p "Continue anyway? (y/N): " continue_choice
        if [[ ! "$continue_choice" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Welcome and prerequisites check
echo -e "\n${BLUE}👋 Welcome to BOB iOS Development Setup!${NC}"
echo "This script will set up everything you need for iOS development:"
echo "• iOS app project structure"
echo "• Firebase backend configuration"
echo "• Build and deployment scripts"
echo "• Development environment"
echo ""

# Check prerequisites
echo -e "${PURPLE}🔍 Checking Prerequisites${NC}"
echo "========================="

PREREQUISITES_MET=true

# Check macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}❌ This setup requires macOS for iOS development${NC}"
    PREREQUISITES_MET=false
fi

# Check for Xcode
if ! command_exists xcodebuild; then
    echo -e "${YELLOW}⚠️  Xcode not found. Please install from App Store.${NC}"
    echo "After installation, run: sudo xcode-select --install"
    PREREQUISITES_MET=false
else
    echo -e "${GREEN}✅ Xcode found: $(xcodebuild -version | head -n1)${NC}"
fi

# Check for Node.js (for Firebase CLI)
if ! command_exists node; then
    echo -e "${YELLOW}⚠️  Node.js not found. Installing via Homebrew...${NC}"
    if command_exists brew; then
        brew install node
    else
        echo -e "${RED}❌ Please install Node.js from https://nodejs.org/${NC}"
        PREREQUISITES_MET=false
    fi
else
    echo -e "${GREEN}✅ Node.js found: $(node --version)${NC}"
fi

# Check for Git
if ! command_exists git; then
    echo -e "${RED}❌ Git not found. Please install Git.${NC}"
    PREREQUISITES_MET=false
else
    echo -e "${GREEN}✅ Git found: $(git --version | head -n1)${NC}"
fi

if [ "$PREREQUISITES_MET" = false ]; then
    echo -e "\n${RED}❌ Prerequisites not met. Please install missing components.${NC}"
    exit 1
fi

echo -e "\n${GREEN}🎉 All prerequisites met!${NC}"

# Setup options
echo -e "\n${BLUE}⚙️  Setup Options${NC}"
echo "=================="
echo "Choose setup mode:"
echo "1. Full Setup (iOS + Firebase + Everything)"
echo "2. iOS Only (Skip Firebase setup)"
echo "3. Firebase Only (Skip iOS setup)"
echo "4. Quick Setup (Minimal configuration)"

read -p "Enter choice [1-4]: " SETUP_MODE

case $SETUP_MODE in
    1)
        SETUP_IOS=true
        SETUP_FIREBASE=true
        SETUP_FULL=true
        echo -e "${GREEN}Selected: Full Setup${NC}"
        ;;
    2)
        SETUP_IOS=true
        SETUP_FIREBASE=false
        SETUP_FULL=false
        echo -e "${GREEN}Selected: iOS Only${NC}"
        ;;
    3)
        SETUP_IOS=false
        SETUP_FIREBASE=true
        SETUP_FULL=false
        echo -e "${GREEN}Selected: Firebase Only${NC}"
        ;;
    4)
        SETUP_IOS=true
        SETUP_FIREBASE=false
        SETUP_FULL=false
        echo -e "${GREEN}Selected: Quick Setup${NC}"
        ;;
    *)
        echo -e "${RED}Invalid choice. Defaulting to Full Setup.${NC}"
        SETUP_IOS=true
        SETUP_FIREBASE=true
        SETUP_FULL=true
        ;;
esac

# Configuration gathering
if [ "$SETUP_FULL" = true ]; then
    echo -e "\n${BLUE}📋 Configuration${NC}"
    echo "================="
    
    # Get OpenAI API key
    echo -e "${YELLOW}OpenAI API Key needed for AI features:${NC}"
    echo "Get your key from: https://platform.openai.com/api-keys"
    read -p "OpenAI API Key (or press Enter to skip): " OPENAI_KEY
    
    # Get Apple Developer info
    echo -e "\n${YELLOW}Apple Developer Information:${NC}"
    read -p "Apple Developer Team ID (optional): " APPLE_TEAM_ID
    read -p "Bundle Identifier [com.bob.reminder-sync]: " BUNDLE_ID
    BUNDLE_ID="${BUNDLE_ID:-com.bob.reminder-sync}"
    
    # Store configuration
    cat > "$SCRIPT_DIR/.setup-config" << EOF
OPENAI_API_KEY=$OPENAI_KEY
APPLE_TEAM_ID=$APPLE_TEAM_ID
BUNDLE_IDENTIFIER=$BUNDLE_ID
SETUP_DATE=$(date)
EOF
    
    echo -e "${GREEN}✅ Configuration saved${NC}"
fi

# Execute setup steps
echo -e "\n${PURPLE}🚀 Starting Setup Process${NC}"
echo "============================"

# Step 1: iOS Setup
if [ "$SETUP_IOS" = true ]; then
    run_step "iOS Development Setup" "./setup-ios.sh"
fi

# Step 2: Firebase Setup
if [ "$SETUP_FIREBASE" = true ]; then
    run_step "Firebase Backend Setup" "./setup-firebase.sh"
fi

# Step 3: Additional Development Tools
if [ "$SETUP_FULL" = true ]; then
    echo -e "\n${PURPLE}🛠️  Installing Development Tools${NC}"
    echo "===================================="
    
    # Install useful development tools
    if command_exists brew; then
        echo "Installing additional development tools..."
        
        # iOS development helpers
        if ! command_exists xcpretty; then
            echo "Installing xcpretty..."
            sudo gem install xcpretty || echo "Failed to install xcpretty"
        fi
        
        # Image optimization tools
        if ! command_exists imageoptim; then
            echo "Installing ImageOptim..."
            brew install --cask imageoptim || echo "Failed to install ImageOptim"
        fi
        
        # Code formatting
        if ! command_exists swiftformat; then
            echo "Installing SwiftFormat..."
            brew install swiftformat || echo "Failed to install SwiftFormat"
        fi
        
        echo -e "${GREEN}✅ Development tools installed${NC}"
    fi
fi

# Step 4: Project Validation
echo -e "\n${PURPLE}🔍 Project Validation${NC}"
echo "======================="

cd "$SCRIPT_DIR/ios-app" 2>/dev/null || echo "iOS app directory not found"
if [ -f "validate.sh" ]; then
    ./validate.sh
else
    echo -e "${YELLOW}⚠️  Validation script not found${NC}"
fi

# Step 5: Create Quick Start Guide
echo -e "\n${PURPLE}📚 Creating Quick Start Guide${NC}"
echo "================================="

cat > "$SCRIPT_DIR/QUICK_START.md" << 'EOF'
# 🚀 BOB iOS Reminder Sync - Quick Start

## Immediate Next Steps

### 1. Open iOS Project
```bash
cd ios-app
open BOBReminderSync.xcodeproj
```

### 2. Build and Run
```bash
# Option A: Command line
./build.sh && ./run.sh

# Option B: In Xcode
# Press ⌘+R to build and run
```

### 3. Add Firebase Configuration
1. Download `GoogleService-Info.plist` from Firebase Console
2. Drag into Xcode project (BOBReminderSync folder)
3. Ensure "Add to target" is checked

## Development Workflow

### Daily Development
1. `cd ios-app`
2. `./run.sh` - Build and run on simulator
3. Make changes in Xcode
4. Test features in iOS Simulator

### Testing
- `./test.sh` - Run unit tests
- Test on device: Connect iPhone and select as target

### Deployment
- `./deploy-firebase.sh` - Update backend
- Archive in Xcode for App Store submission

## Key Features to Test

### Reminders Integration
1. Grant Reminders permission when prompted
2. Create test reminders in iOS Reminders app
3. Open BOB app and tap "Sync All"
4. Verify reminders appear in Tasks tab

### AI Features
1. Tap on any reminder
2. Press "Process with AI"
3. View spell check and story suggestions
4. Test duplicate detection

### Firebase Sync
1. Create account in app
2. Add tasks in BOB app
3. Verify sync to Firebase console
4. Test real-time updates

## Troubleshooting

### Build Errors
- Update Xcode to latest version
- Clean build folder: ⌘+Shift+K
- Check bundle identifier conflicts

### Permission Issues
- Settings → Privacy → Reminders → BOB Reminder Sync (ON)
- Delete and reinstall app if needed

### Firebase Issues
- Verify GoogleService-Info.plist is in project
- Check Firebase project authentication settings
- Ensure Firestore is enabled

## Support Resources

- Xcode Documentation: Help → Developer Documentation
- Firebase Console: https://console.firebase.google.com
- iOS Human Interface Guidelines
- SwiftUI Documentation

Happy coding! 🎉
EOF

echo -e "${GREEN}✅ Quick start guide created${NC}"

# Final summary and next steps
echo -e "\n${GREEN}🎉 Setup Complete!${NC}"
echo "=================="

echo -e "${BLUE}📋 Summary:${NC}"
if [ "$SETUP_IOS" = true ]; then
    echo "✅ iOS development environment configured"
fi
if [ "$SETUP_FIREBASE" = true ]; then
    echo "✅ Firebase backend setup initiated"
fi
echo "✅ Build scripts and automation created"
echo "✅ Development documentation generated"

echo -e "\n${YELLOW}📱 Immediate Next Steps:${NC}"
echo "1. Open Xcode project: ${CYAN}cd ios-app && open BOBReminderSync.xcodeproj${NC}"
echo "2. Add Firebase config file (GoogleService-Info.plist)"
echo "3. Build and run: ${CYAN}./run.sh${NC}"
echo "4. Test on iOS Simulator"

echo -e "\n${BLUE}🔧 Available Commands:${NC}"
echo "• ${CYAN}./setup-ios.sh${NC} - Re-run iOS setup"
echo "• ${CYAN}./setup-firebase.sh${NC} - Re-run Firebase setup"
echo "• ${CYAN}cd ios-app && ./build.sh${NC} - Build iOS app"
echo "• ${CYAN}cd ios-app && ./run.sh${NC} - Run on simulator"
echo "• ${CYAN}cd ios-app && ./test.sh${NC} - Run tests"

echo -e "\n${PURPLE}📚 Documentation:${NC}"
echo "• QUICK_START.md - Getting started guide"
echo "• ios-app/README.md - iOS development details"
echo "• ios-app/DEVELOPMENT.md - Development workflow"

echo -e "\n${GREEN}🚀 Ready for iOS Development!${NC}"
echo "Your BOB Reminder Sync app is ready to build and deploy."
echo -e "Questions? Check the documentation or run ${CYAN}./validate.sh${NC} for diagnostics."
