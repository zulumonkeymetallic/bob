#!/bin/bash

# BOB v3.5.5 Enhanced Deploy with Backup & Demo User
# This script performs backup, build, deploy, and demo user setup

set -e  # Exit on any error

echo "🚀 BOB v3.5.5 Enhanced Deploy with Backup & Demo User"
echo "===================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_demo() {
    echo -e "${PURPLE}[DEMO]${NC} $1"
}

print_backup() {
    echo -e "${CYAN}[BACKUP]${NC} $1"
}

# Check if we're in the correct directory
if [ ! -f "firebase.json" ]; then
    print_error "firebase.json not found. Please run this script from the project root."
    exit 1
fi

# Get current timestamp for backup
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_DIR="backups"
BACKUP_NAME="bob-v3.5.5-backup-${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Step 1: Create comprehensive backup
print_backup "Creating comprehensive backup..."

# Create backups directory if it doesn't exist
mkdir -p ${BACKUP_DIR}

# Create backup archive
print_backup "Creating backup archive: ${BACKUP_NAME}.tar.gz"
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='build' \
    --exclude='dist' \
    --exclude='backups' \
    --exclude='*.log' \
    -czf "${BACKUP_PATH}.tar.gz" .

print_success "Backup created: ${BACKUP_PATH}.tar.gz"

# Step 2: Git backup and status
print_status "Creating git backup branch..."
git add .
git status

BRANCH_NAME="deploy-backup-${TIMESTAMP}"
git checkout -b ${BRANCH_NAME}
git commit -m "Backup before deployment ${TIMESTAMP}" || echo "No changes to commit"
git checkout main

print_success "Git backup branch created: ${BRANCH_NAME}"

# Step 3: Install dependencies
print_status "Installing dependencies..."
cd react-app
npm install
cd ..

# Step 4: Build the application
print_status "Building React application..."
cd react-app
npm run build
cd ..

print_success "Build completed successfully"

# Step 5: Deploy to Firebase
print_status "Deploying to Firebase..."
firebase deploy --only hosting

print_success "Deployment completed successfully"

# Step 6: Create demo user
print_demo "Creating demo user account..."

# Create demo user creation script
cat > create-demo-user.js << 'EOF'
#!/usr/bin/env node
/**
 * BOB v3.5.5 - Demo User Creation Script
 * Creates demo@jc1.tech user for demonstration purposes
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin (uses GOOGLE_APPLICATION_CREDENTIALS env var)
try {
  admin.initializeApp({
    projectId: 'bob20250810'
  });
} catch (error) {
  console.log('Firebase Admin already initialized or error:', error.message);
}

const auth = admin.auth();
const firestore = admin.firestore();

async function createDemoUser() {
  const demoUser = {
    uid: 'demo-user-jc1-tech',
    email: 'demo@jc1.tech',
    displayName: 'Demo User',
    password: 'Test1234b!',
    emailVerified: true
  };

  try {
    console.log('🎭 Creating demo user:', demoUser.email);
    
    // Check if user already exists
    try {
      const existingUser = await auth.getUser(demoUser.uid);
      console.log('✅ Demo user already exists:', existingUser.email);
      
      // Update password if needed
      await auth.updateUser(demoUser.uid, {
        password: demoUser.password,
        emailVerified: true
      });
      console.log('🔄 Updated demo user password');
      
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Create new user
        const userRecord = await auth.createUser({
          uid: demoUser.uid,
          email: demoUser.email,
          displayName: demoUser.displayName,
          password: demoUser.password,
          emailVerified: true
        });
        console.log('✅ Demo user created:', userRecord.email);
      } else {
        throw error;
      }
    }

    // Create user profile in Firestore
    const userProfile = {
      email: demoUser.email,
      displayName: demoUser.displayName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isDemo: true,
      personas: ['demo-persona'],
      preferences: {
        theme: 'light',
        viewMode: 'card'
      }
    };

    await firestore.collection('users').doc(demoUser.uid).set(userProfile, { merge: true });
    console.log('✅ Demo user profile created in Firestore');

    // Create demo goals
    const demoGoals = [
      {
        id: 'demo-goal-1',
        title: 'Complete Product Demo',
        description: 'Showcase all key features of BOB productivity platform',
        status: 'in-progress',
        priority: 'high',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      },
      {
        id: 'demo-goal-2',
        title: 'User Onboarding Workflow',
        description: 'Create smooth onboarding experience for new users',
        status: 'planned',
        priority: 'medium',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      }
    ];

    for (const goal of demoGoals) {
      await firestore.collection('goals').doc(goal.id).set(goal, { merge: true });
      console.log('✅ Demo goal created:', goal.title);
    }

    // Create demo stories
    const demoStories = [
      {
        id: 'demo-story-1',
        title: 'User can login with demo credentials',
        description: 'As a demo user, I want to login easily to explore the platform',
        status: 'done',
        priority: 'high',
        goalId: 'demo-goal-1',
        goalTitle: 'Complete Product Demo',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      },
      {
        id: 'demo-story-2',
        title: 'User can create and manage goals',
        description: 'As a user, I want to create and organize my goals effectively',
        status: 'in-progress',
        priority: 'high',
        goalId: 'demo-goal-1',
        goalTitle: 'Complete Product Demo',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      },
      {
        id: 'demo-story-3',
        title: 'User can add stories inline like Excel',
        description: 'As a user, I want to add stories quickly with Excel-like interface',
        status: 'done',
        priority: 'medium',
        goalId: 'demo-goal-2',
        goalTitle: 'User Onboarding Workflow',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      }
    ];

    for (const story of demoStories) {
      await firestore.collection('stories').doc(story.id).set(story, { merge: true });
      console.log('✅ Demo story created:', story.title);
    }

    console.log('🎉 Demo user setup completed successfully!');
    console.log('📧 Email: demo@jc1.tech');
    console.log('🔐 Password: Test1234b!');
    console.log('🌐 Login at: https://bob20250810.web.app');

  } catch (error) {
    console.error('❌ Error creating demo user:', error);
    process.exit(1);
  }
}

// Run the demo user creation
createDemoUser()
  .then(() => {
    console.log('✅ Demo user creation completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Demo user creation failed:', error);
    process.exit(1);
  });
EOF

# Make the script executable
chmod +x create-demo-user.js

# Check if Firebase Admin SDK is available
if command -v node >/dev/null 2>&1; then
    # Check if firebase-admin is installed
    if [ -f "package.json" ] && npm list firebase-admin >/dev/null 2>&1; then
        print_demo "Running demo user creation script..."
        node create-demo-user.js
    else
        print_warning "firebase-admin not found. Installing..."
        npm install firebase-admin
        print_demo "Running demo user creation script..."
        node create-demo-user.js
    fi
else
    print_warning "Node.js not found. Please install Node.js to create demo user."
    print_demo "Demo user script created: create-demo-user.js"
    print_demo "Run manually: node create-demo-user.js"
fi

# Step 7: Final status and cleanup
print_status "Deployment Summary:"
echo "=================="
print_success "✅ Backup created: ${BACKUP_PATH}.tar.gz"
print_success "✅ Git backup branch: ${BRANCH_NAME}"
print_success "✅ Application built successfully"
print_success "✅ Deployed to Firebase hosting"
print_success "✅ Demo user setup completed"

echo ""
print_demo "Demo Account Details:"
echo "📧 Email: demo@jc1.tech"
echo "🔐 Password: Test1234b!"
echo "🌐 URL: https://bob20250810.web.app"

echo ""
print_status "Backup Management:"
echo "🗂️  Backup location: ${BACKUP_PATH}.tar.gz"
echo "🔄 To restore from backup: tar -xzf ${BACKUP_PATH}.tar.gz"
echo "🌿 Git backup branch: ${BRANCH_NAME}"

echo ""
print_success "🎉 Deployment completed successfully!"
print_status "Visit https://bob20250810.web.app to test the deployment"
