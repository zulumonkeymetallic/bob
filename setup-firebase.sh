#!/bin/bash

# BOB iOS Firebase Setup Automation
# Automates Firebase project configuration for iOS app

set -e

echo "🔥 BOB iOS Firebase Setup"
echo "========================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_APP_DIR="$SCRIPT_DIR/ios-app"

echo -e "${BLUE}📂 Working directory: $IOS_APP_DIR${NC}"

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Firebase CLI...${NC}"
    if command -v npm &> /dev/null; then
        npm install -g firebase-tools
    else
        echo -e "${RED}❌ npm not found. Please install Node.js first.${NC}"
        echo "Install from: https://nodejs.org/"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Firebase CLI found: $(firebase --version)${NC}"

# Login to Firebase
echo -e "\n${BLUE}🔑 Firebase Authentication${NC}"
if ! firebase projects:list &> /dev/null; then
    echo "Please login to Firebase..."
    firebase login
fi

echo -e "${GREEN}✅ Firebase authentication successful${NC}"

# List available projects
echo -e "\n${BLUE}📋 Available Firebase Projects:${NC}"
firebase projects:list

# Get project selection
echo -e "\n${YELLOW}Select Firebase project for BOB iOS app:${NC}"
read -p "Enter project ID (or 'new' to create): " PROJECT_ID

if [ "$PROJECT_ID" = "new" ]; then
    echo -e "\n${BLUE}🆕 Creating new Firebase project...${NC}"
    read -p "Enter new project ID: " NEW_PROJECT_ID
    read -p "Enter project name: " PROJECT_NAME
    
    firebase projects:create "$NEW_PROJECT_ID" --display-name "$PROJECT_NAME"
    PROJECT_ID="$NEW_PROJECT_ID"
fi

# Set Firebase project
firebase use "$PROJECT_ID"
echo -e "${GREEN}✅ Using Firebase project: $PROJECT_ID${NC}"

# Initialize Firebase for iOS
echo -e "\n${BLUE}📱 Setting up Firebase for iOS...${NC}"

# Create firebase.json if not exists
if [ ! -f "$SCRIPT_DIR/firebase.json" ]; then
    cd "$SCRIPT_DIR"
    firebase init --project "$PROJECT_ID"
else
    echo -e "${GREEN}✅ Firebase already initialized${NC}"
fi

# Enable required services
echo -e "\n${BLUE}⚙️  Enabling Firebase services...${NC}"

# Authentication
echo "Enabling Authentication..."
# Note: This requires manual setup in Firebase Console
echo -e "${YELLOW}Manual step required:${NC}"
echo "1. Go to Firebase Console: https://console.firebase.google.com/project/$PROJECT_ID"
echo "2. Navigate to Authentication → Sign-in method"
echo "3. Enable Email/Password authentication"

# Firestore
echo "Enabling Firestore..."
# This also requires manual setup
echo -e "${YELLOW}Manual step required:${NC}"
echo "1. Go to Firebase Console: https://console.firebase.google.com/project/$PROJECT_ID"
echo "2. Navigate to Firestore Database"
echo "3. Create database in production mode"

# iOS App Configuration
echo -e "\n${BLUE}📱 iOS App Configuration${NC}"

# Get bundle ID
BUNDLE_ID="com.bob.reminder-sync"
read -p "Bundle Identifier [$BUNDLE_ID]: " CUSTOM_BUNDLE_ID
BUNDLE_ID="${CUSTOM_BUNDLE_ID:-$BUNDLE_ID}"

echo "Creating iOS app in Firebase project..."
echo -e "${YELLOW}Manual step required:${NC}"
echo "1. Go to Firebase Console: https://console.firebase.google.com/project/$PROJECT_ID"
echo "2. Click 'Add app' → iOS"
echo "3. Enter bundle ID: $BUNDLE_ID"
echo "4. Download GoogleService-Info.plist"
echo "5. Place it in: $IOS_APP_DIR/BOBReminderSync/"

# Wait for user confirmation
read -p "Press Enter when you've downloaded GoogleService-Info.plist..."

# Check if config file exists
CONFIG_FILE="$IOS_APP_DIR/BOBReminderSync/GoogleService-Info.plist"
if [ -f "$CONFIG_FILE" ]; then
    echo -e "${GREEN}✅ Firebase configuration found!${NC}"
    
    # Extract project info from config
    if command -v plutil &> /dev/null; then
        FB_PROJECT_ID=$(plutil -extract PROJECT_ID xml1 -o - "$CONFIG_FILE" | grep -A1 string | tail -1 | sed 's/<[^>]*>//g' | xargs)
        echo -e "${BLUE}📋 Firebase Project ID: $FB_PROJECT_ID${NC}"
    fi
else
    echo -e "${RED}❌ Firebase configuration not found at: $CONFIG_FILE${NC}"
    echo "Please download and place GoogleService-Info.plist in the correct location."
fi

# Create Firestore security rules
echo -e "\n${BLUE}🛡️  Creating Firestore security rules...${NC}"

cat > "$SCRIPT_DIR/firestore.rules" << 'EOF'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // User's tasks
      match /tasks/{taskId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      
      // User's stories
      match /stories/{storyId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      
      // User's goals
      match /goals/{goalId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
EOF

# Deploy Firestore rules
if [ -f "$CONFIG_FILE" ]; then
    echo "Deploying Firestore security rules..."
    firebase deploy --only firestore:rules --project "$PROJECT_ID"
    echo -e "${GREEN}✅ Firestore rules deployed${NC}"
fi

# Create Cloud Functions for advanced features (optional)
echo -e "\n${BLUE}⚡ Setting up Cloud Functions...${NC}"

FUNCTIONS_DIR="$SCRIPT_DIR/functions"
if [ ! -d "$FUNCTIONS_DIR" ]; then
    mkdir -p "$FUNCTIONS_DIR"
    cd "$FUNCTIONS_DIR"
    
    # Initialize Cloud Functions
    firebase init functions --project "$PROJECT_ID"
    
    # Create a sample function for AI processing
    cat > "$FUNCTIONS_DIR/src/index.ts" << 'EOF'
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

// Example: AI processing function
export const processReminderWithAI = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { reminderText, userId } = data;

  try {
    // Here you would call OpenAI API
    // For now, return a mock response
    const result = {
      spellCheckedText: reminderText,
      suggestedStory: null,
      shouldConvertToStory: false,
      confidence: 0.8
    };

    // Log the processing
    await admin.firestore()
      .collection('users')
      .doc(userId)
      .collection('aiProcessingLog')
      .add({
        input: reminderText,
        output: result,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

    return result;
  } catch (error) {
    console.error('AI processing error:', error);
    throw new functions.https.HttpsError('internal', 'AI processing failed');
  }
});

// Sync status tracking function
export const updateSyncStatus = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { status, lastSyncTime } = data;
  const userId = context.auth.uid;

  await admin.firestore()
    .collection('users')
    .doc(userId)
    .set({
      syncStatus: status,
      lastSync: lastSyncTime,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

  return { success: true };
});
EOF

    echo -e "${GREEN}✅ Cloud Functions initialized${NC}"
else
    echo -e "${YELLOW}⚠️  Functions directory already exists${NC}"
fi

# Create environment configuration
echo -e "\n${BLUE}🔧 Creating environment configuration...${NC}"

cat > "$SCRIPT_DIR/.firebaserc" << EOF
{
  "projects": {
    "default": "$PROJECT_ID"
  }
}
EOF

# Update iOS app environment
if [ -f "$IOS_APP_DIR/.env" ]; then
    # Update existing .env file
    sed -i '' "s/FIREBASE_PROJECT_ID=.*/FIREBASE_PROJECT_ID=$PROJECT_ID/" "$IOS_APP_DIR/.env"
else
    # Create new .env file
    cat > "$IOS_APP_DIR/.env" << EOF
FIREBASE_PROJECT_ID=$PROJECT_ID
BUNDLE_IDENTIFIER=$BUNDLE_ID
EOF
fi

echo -e "${GREEN}✅ Environment configuration updated${NC}"

# Create deployment script
echo -e "\n${BLUE}🚀 Creating deployment script...${NC}"

cat > "$SCRIPT_DIR/deploy-firebase.sh" << 'EOF'
#!/bin/bash

# BOB Firebase Deployment Script

set -e

echo "🚀 Deploying BOB Firebase backend..."

# Deploy Firestore rules
echo "📋 Deploying Firestore rules..."
firebase deploy --only firestore:rules

# Deploy Cloud Functions (if they exist)
if [ -d "functions" ]; then
    echo "⚡ Deploying Cloud Functions..."
    firebase deploy --only functions
fi

# Deploy hosting (if configured)
if [ -f "firebase.json" ] && grep -q "hosting" firebase.json; then
    echo "🌐 Deploying hosting..."
    firebase deploy --only hosting
fi

echo "✅ Firebase deployment complete!"
EOF

chmod +x "$SCRIPT_DIR/deploy-firebase.sh"

echo -e "\n${GREEN}🎉 Firebase Setup Complete!${NC}"
echo "=================================="
echo -e "${BLUE}Configuration Summary:${NC}"
echo "• Project ID: $PROJECT_ID"
echo "• Bundle ID: $BUNDLE_ID"
echo "• Config file: $CONFIG_FILE"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Enable Authentication in Firebase Console"
echo "2. Create Firestore database"
echo "3. Run iOS setup: ./setup-ios.sh"
echo "4. Open Xcode and build the app"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo "• Deploy backend: ./deploy-firebase.sh"
echo "• View logs: firebase functions:log"
echo "• Open console: firebase open"
echo ""
echo -e "${GREEN}🔥 Firebase ready for iOS development!${NC}"
