#!/bin/bash

# BOB iOS Reminder Sync App - Automated Setup Script
# Run this after installing Xcode to automate the development setup

set -e  # Exit on any error

echo "🚀 BOB iOS Reminder Sync - Automated Setup"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_APP_DIR="$SCRIPT_DIR/ios-app"
PROJECT_NAME="BOBReminderSync"

echo -e "${BLUE}📱 Setting up iOS development environment...${NC}"

# Check if Xcode is installed
if ! command -v xcodebuild &> /dev/null; then
    echo -e "${RED}❌ Xcode not found. Please install Xcode from the App Store first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Xcode found: $(xcodebuild -version | head -n1)${NC}"

# Check if iOS app directory exists
if [ ! -d "$IOS_APP_DIR" ]; then
    echo -e "${RED}❌ iOS app directory not found at: $IOS_APP_DIR${NC}"
    exit 1
fi

cd "$IOS_APP_DIR"
echo -e "${BLUE}📂 Working in: $(pwd)${NC}"

# Function to prompt for user input with default
prompt_with_default() {
    local prompt="$1"
    local default="$2"
    local result
    
    read -p "$prompt [$default]: " result
    echo "${result:-$default}"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

echo -e "\n${YELLOW}🔧 Configuration Setup${NC}"
echo "======================"

# Get user configuration
echo -e "${BLUE}Setting up project configuration...${NC}"

BUNDLE_ID=$(prompt_with_default "Bundle Identifier" "com.bob.reminder-sync")
TEAM_ID=$(prompt_with_default "Apple Developer Team ID (leave empty if none)" "")
OPENAI_API_KEY=$(prompt_with_default "OpenAI API Key (for AI features)" "")

# Check for Firebase configuration
FIREBASE_CONFIG_PATH="$IOS_APP_DIR/$PROJECT_NAME/GoogleService-Info.plist"
if [ ! -f "$FIREBASE_CONFIG_PATH" ]; then
    echo -e "\n${YELLOW}📋 Firebase Configuration Needed${NC}"
    echo "To complete setup, you'll need to:"
    echo "1. Go to Firebase Console: https://console.firebase.google.com/"
    echo "2. Create/select your BOB project"
    echo "3. Add iOS app with bundle ID: $BUNDLE_ID"
    echo "4. Download GoogleService-Info.plist"
    echo "5. Place it at: $FIREBASE_CONFIG_PATH"
    
    read -p "Press Enter when you have the Firebase config file ready..."
    
    if [ ! -f "$FIREBASE_CONFIG_PATH" ]; then
        echo -e "${RED}⚠️  Firebase config not found. You'll need to add it manually later.${NC}"
    else
        echo -e "${GREEN}✅ Firebase configuration found!${NC}"
    fi
else
    echo -e "${GREEN}✅ Firebase configuration already exists${NC}"
fi

# Create environment configuration
echo -e "\n${BLUE}🔑 Creating environment configuration...${NC}"

ENV_FILE="$IOS_APP_DIR/.env"
cat > "$ENV_FILE" << EOF
# BOB iOS Reminder Sync - Environment Configuration
# Generated on $(date)

# OpenAI Configuration
OPENAI_API_KEY=$OPENAI_API_KEY

# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id

# App Configuration
BUNDLE_IDENTIFIER=$BUNDLE_ID
APP_VERSION=1.0.0
BUILD_NUMBER=1

# Development Settings
DEBUG_MODE=true
VERBOSE_LOGGING=true
EOF

echo -e "${GREEN}✅ Environment configuration created at: $ENV_FILE${NC}"

# Update Xcode project configuration
echo -e "\n${BLUE}⚙️  Updating Xcode project configuration...${NC}"

PROJECT_FILE="$IOS_APP_DIR/$PROJECT_NAME.xcodeproj/project.pbxproj"
if [ -f "$PROJECT_FILE" ]; then
    # Backup original project file
    cp "$PROJECT_FILE" "$PROJECT_FILE.backup"
    
    # Update bundle identifier
    sed -i '' "s/com\.bob\.reminder-sync/$BUNDLE_ID/g" "$PROJECT_FILE"
    
    # Add development team if provided
    if [ ! -z "$TEAM_ID" ]; then
        sed -i '' "s/DEVELOPMENT_TEAM = \"\";/DEVELOPMENT_TEAM = \"$TEAM_ID\";/g" "$PROJECT_FILE"
        echo -e "${GREEN}✅ Development team configured: $TEAM_ID${NC}"
    fi
    
    echo -e "${GREEN}✅ Xcode project configuration updated${NC}"
else
    echo -e "${RED}❌ Xcode project file not found: $PROJECT_FILE${NC}"
fi

# Create build scripts
echo -e "\n${BLUE}📦 Creating build and run scripts...${NC}"

# Build script
cat > "$IOS_APP_DIR/build.sh" << 'EOF'
#!/bin/bash

# BOB iOS Reminder Sync - Build Script

set -e

PROJECT_NAME="BOBReminderSync"
SCHEME_NAME="BOBReminderSync"
CONFIGURATION="Debug"

echo "🔨 Building $PROJECT_NAME..."

# Clean build directory
xcodebuild clean \
    -project "$PROJECT_NAME.xcodeproj" \
    -scheme "$SCHEME_NAME" \
    -configuration "$CONFIGURATION"

# Build for simulator
xcodebuild build \
    -project "$PROJECT_NAME.xcodeproj" \
    -scheme "$SCHEME_NAME" \
    -configuration "$CONFIGURATION" \
    -destination 'platform=iOS Simulator,name=iPhone 15,OS=latest'

echo "✅ Build completed successfully!"
EOF

# Run script
cat > "$IOS_APP_DIR/run.sh" << 'EOF'
#!/bin/bash

# BOB iOS Reminder Sync - Run Script

set -e

PROJECT_NAME="BOBReminderSync"
SCHEME_NAME="BOBReminderSync"
CONFIGURATION="Debug"
SIMULATOR_NAME="iPhone 15"

echo "🚀 Running $PROJECT_NAME on simulator..."

# Boot simulator if not already running
xcrun simctl boot "$SIMULATOR_NAME" 2>/dev/null || true

# Build and run
xcodebuild build \
    -project "$PROJECT_NAME.xcodeproj" \
    -scheme "$SCHEME_NAME" \
    -configuration "$CONFIGURATION" \
    -destination "platform=iOS Simulator,name=$SIMULATOR_NAME,OS=latest" \
    | xcpretty

echo "✅ App launched successfully!"
EOF

# Test script
cat > "$IOS_APP_DIR/test.sh" << 'EOF'
#!/bin/bash

# BOB iOS Reminder Sync - Test Script

set -e

PROJECT_NAME="BOBReminderSync"
SCHEME_NAME="BOBReminderSync"

echo "🧪 Running tests for $PROJECT_NAME..."

xcodebuild test \
    -project "$PROJECT_NAME.xcodeproj" \
    -scheme "$SCHEME_NAME" \
    -destination 'platform=iOS Simulator,name=iPhone 15,OS=latest' \
    | xcpretty

echo "✅ All tests passed!"
EOF

# Make scripts executable
chmod +x "$IOS_APP_DIR/build.sh"
chmod +x "$IOS_APP_DIR/run.sh"
chmod +x "$IOS_APP_DIR/test.sh"

echo -e "${GREEN}✅ Build scripts created and made executable${NC}"

# Install development dependencies
echo -e "\n${BLUE}📚 Installing development dependencies...${NC}"

# Check for xcpretty (makes Xcode output prettier)
if ! command_exists xcpretty; then
    echo "Installing xcpretty for better build output..."
    if command_exists gem; then
        sudo gem install xcpretty
    else
        echo -e "${YELLOW}⚠️  xcpretty not installed (gem not found). Build output will be verbose.${NC}"
    fi
else
    echo -e "${GREEN}✅ xcpretty already installed${NC}"
fi

# Create Assets.xcassets directory structure
echo -e "\n${BLUE}🎨 Setting up app assets...${NC}"

ASSETS_DIR="$IOS_APP_DIR/$PROJECT_NAME/Assets.xcassets"
mkdir -p "$ASSETS_DIR/AppIcon.appiconset"
mkdir -p "$ASSETS_DIR/AccentColor.colorset"

# Create basic Contents.json files
cat > "$ASSETS_DIR/Contents.json" << 'EOF'
{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF

cat > "$ASSETS_DIR/AppIcon.appiconset/Contents.json" << 'EOF'
{
  "images" : [
    {
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "20x20"
    },
    {
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "20x20"
    },
    {
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "29x29"
    },
    {
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "29x29"
    },
    {
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "40x40"
    },
    {
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "40x40"
    },
    {
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "60x60"
    },
    {
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "60x60"
    },
    {
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "20x20"
    },
    {
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "20x20"
    },
    {
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "29x29"
    },
    {
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "29x29"
    },
    {
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "40x40"
    },
    {
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "40x40"
    },
    {
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "76x76"
    },
    {
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "83.5x83.5"
    },
    {
      "idiom" : "ios-marketing",
      "scale" : "1x",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF

cat > "$ASSETS_DIR/AccentColor.colorset/Contents.json" << 'EOF'
{
  "colors" : [
    {
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF

echo -e "${GREEN}✅ App assets structure created${NC}"

# Create documentation
echo -e "\n${BLUE}📚 Creating development documentation...${NC}"

cat > "$IOS_APP_DIR/DEVELOPMENT.md" << 'EOF'
# BOB iOS Reminder Sync - Development Guide

## Quick Start

1. **Open Project**: `open BOBReminderSync.xcodeproj`
2. **Build**: `./build.sh`
3. **Run**: `./run.sh`
4. **Test**: `./test.sh`

## Development Workflow

### Building the App
```bash
./build.sh  # Build for simulator
```

### Running on Simulator
```bash
./run.sh    # Build and run on iPhone 15 simulator
```

### Running Tests
```bash
./test.sh   # Run all unit tests
```

### Manual Development
1. Open `BOBReminderSync.xcodeproj` in Xcode
2. Select iPhone simulator
3. Press ⌘+R to build and run

## Configuration

### Environment Variables
- Edit `.env` file for API keys and configuration
- OpenAI API key required for AI features
- Firebase configuration needed for backend sync

### Firebase Setup
1. Place `GoogleService-Info.plist` in project root
2. Ensure Firebase project matches bundle ID
3. Enable Authentication and Firestore

### Permissions
- Reminders access: Configured in Info.plist
- Notifications: For sync alerts
- Background processing: For automatic sync

## Architecture

### Key Components
- `ReminderSyncManager`: Core sync logic
- `AIService`: OpenAI integration
- `FirebaseService`: Backend communication
- `AuthenticationManager`: User management

### Data Flow
1. iOS Reminders → EventKit → ReminderSyncManager
2. ReminderSyncManager → AIService → OpenAI
3. Processed data → FirebaseService → Cloud Firestore
4. UI updates via SwiftUI + Combine

## Troubleshooting

### Build Issues
- Ensure Xcode is up to date (15.0+)
- Check Development Team in project settings
- Verify bundle identifier is unique

### Runtime Issues
- Check Reminders permission in iOS Settings
- Verify Firebase configuration
- Check console logs for detailed errors

### AI Features
- Ensure OpenAI API key is valid
- Check network connectivity
- Monitor API usage limits
EOF

echo -e "${GREEN}✅ Development documentation created${NC}"

# Create a quick validation script
echo -e "\n${BLUE}🔍 Creating validation script...${NC}"

cat > "$IOS_APP_DIR/validate.sh" << 'EOF'
#!/bin/bash

# BOB iOS Reminder Sync - Project Validation

echo "🔍 Validating BOB iOS project setup..."

PROJECT_NAME="BOBReminderSync"
ERRORS=0

# Check Xcode project exists
if [ ! -f "$PROJECT_NAME.xcodeproj/project.pbxproj" ]; then
    echo "❌ Xcode project not found"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ Xcode project found"
fi

# Check Swift files exist
SWIFT_FILES=(
    "$PROJECT_NAME/BOBReminderSyncApp.swift"
    "$PROJECT_NAME/Services/ReminderSyncManager.swift"
    "$PROJECT_NAME/Services/AIService.swift"
    "$PROJECT_NAME/Views/ContentView.swift"
)

for file in "${SWIFT_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing: $file"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ Found: $file"
    fi
done

# Check configuration files
if [ ! -f "$PROJECT_NAME/Info.plist" ]; then
    echo "❌ Info.plist not found"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ Info.plist found"
fi

# Check Firebase config
if [ ! -f "$PROJECT_NAME/GoogleService-Info.plist" ]; then
    echo "⚠️  GoogleService-Info.plist not found (add manually)"
else
    echo "✅ Firebase configuration found"
fi

# Check environment
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found"
else
    echo "✅ Environment configuration found"
fi

# Summary
if [ $ERRORS -eq 0 ]; then
    echo -e "\n🎉 Project validation passed! Ready for development."
else
    echo -e "\n❌ Found $ERRORS errors. Please fix before proceeding."
fi
EOF

chmod +x "$IOS_APP_DIR/validate.sh"

# Run validation
echo -e "\n${BLUE}🔍 Validating project setup...${NC}"
cd "$IOS_APP_DIR"
./validate.sh

echo -e "\n${GREEN}🎉 iOS Setup Complete!${NC}"
echo "================================"
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Add Firebase GoogleService-Info.plist to the project"
echo "2. Open project: ${YELLOW}open BOBReminderSync.xcodeproj${NC}"
echo "3. Build and run: ${YELLOW}./run.sh${NC}"
echo ""
echo -e "${BLUE}Quick Commands:${NC}"
echo "• Build: ./build.sh"
echo "• Run: ./run.sh" 
echo "• Test: ./test.sh"
echo "• Validate: ./validate.sh"
echo ""
echo -e "${GREEN}🚀 Ready for iOS development!${NC}"
