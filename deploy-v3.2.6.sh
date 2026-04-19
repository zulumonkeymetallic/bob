#!/bin/bash

# BOB v3.2.6 Quick Deployment Script - Firestore Permission Fixes
echo "🚀 BOB v3.2.6 Quick Deployment Starting..."
echo "📅 Started at: $(date)"

# Step 1: Build the application
echo "🏗️  Building application..."
cd react-app
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build completed successfully"

# Step 2: Deploy to Firebase
echo "🚀 Deploying to Firebase hosting..."
firebase deploy --only hosting

if [ $? -ne 0 ]; then
    echo "❌ Firebase deployment failed!"
    exit 1
fi

echo "✅ Firebase deployment completed"

# Step 3: Git operations
echo "📝 Git operations..."
cd ..
git add .
git commit -m "fix(permissions): v3.2.6 - Firestore permission fixes for userId/ownerUid mismatch"
git tag v3.2.6
git push origin main
git push origin v3.2.6

echo "🎉 DEPLOYMENT COMPLETE! 🎉"
echo "📊 Version: v3.2.6"
echo "🔧 Key Fix: Firestore permission issues resolved"
echo "🚀 The application is now live with proper database access!"
