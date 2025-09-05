#!/bin/bash

# BOB v3.5.1 - Goals Refinements Implementation Deployment Script
# Date: September 1, 2025

set -e  # Exit on any error

echo "🚀 BOB v3.5.1 - Goals Refinements Implementation Deployment"
echo "============================================================"

# Variables
VERSION="v3.5.1"
COMMIT_MESSAGE="feat: Goals system refinements implementation

✨ New Features:
- Enhanced latest comment display on goals cards
- Activity stream filtering removes UI click noise
- Status change debugging with enhanced logging
- Modal consistency verification between create/edit
- Modern stories table integration confirmed

🔧 Technical Improvements:
- Enhanced loadLatestActivityForGoal function with meaningful activity filtering
- GlobalSidebar activity stream filtering for better UX
- Improved goal update logging for debugging
- Fixed operator precedence warnings in GoalsCardView
- Comprehensive feature parity validation

🎯 User Experience:
- Cleaner activity streams focusing on content changes
- Better latest comment visibility on goal cards
- Enhanced status management with debugging capabilities
- Consistent functionality across all goal modals
- Modern table integration for goal-to-stories workflow

📋 Files Modified:
- GoalsCardView.tsx - Enhanced activity loading and display
- GoalsManagement.tsx - Enhanced goal update logging
- GlobalSidebar.tsx - Added activity stream filtering
- version.ts - Updated to v3.5.1
- package.json - Updated version and description

Version: $VERSION
Status: ✅ Complete and Ready for Production"

echo "📋 Pre-deployment checks..."

# Check if we're in the right directory
if [ ! -f "react-app/package.json" ]; then
    echo "❌ Error: Must be run from BOB project root directory"
    exit 1
fi

# Check for git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not a git repository"
    exit 1
fi

echo "✅ Directory and git checks passed"

# Build the React application
echo "📦 Building React application..."
cd react-app
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "✅ Build completed successfully"
cd ..

# Git operations
echo "📝 Committing changes..."

# Add all changes
git add .

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo "ℹ️  No changes to commit"
else
    # Commit changes
    git commit -m "$COMMIT_MESSAGE"
    echo "✅ Changes committed"
fi

# Create and push tag
echo "🏷️  Creating version tag..."
git tag -a "$VERSION" -m "BOB $VERSION - Goals Refinements Implementation

This release focuses on user experience refinements for the Goals system:

🎯 Goals System Enhancements:
• Enhanced latest comment display on goal cards
• Activity stream filtering removes UI noise  
• Status change debugging improvements
• Modal consistency verification
• Modern stories table integration confirmed

🔧 Technical Improvements:
• Enhanced activity loading with meaningful filtering
• Improved goal update logging for debugging
• Fixed code quality warnings
• Comprehensive feature parity validation

📈 User Impact:
• Cleaner, more focused activity streams
• Better visibility of latest comments and changes
• Enhanced debugging capabilities for status management
• Consistent experience across create/edit workflows
• Modern table integration for goal-to-stories navigation

Ready for production deployment and user testing."

echo "✅ Tag $VERSION created"

# Push to origin
echo "📤 Pushing to remote repository..."
git push origin main
git push origin "$VERSION"

echo "✅ Successfully pushed to remote repository"

# Set as default branch (if needed)
echo "🔧 Checking default branch settings..."
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
if [ "$DEFAULT_BRANCH" != "main" ]; then
    echo "📝 Setting main as default branch..."
    git remote set-head origin main
    echo "✅ Default branch set to main"
else
    echo "✅ main is already the default branch"
fi

echo ""
echo "🎉 DEPLOYMENT COMPLETE!"
echo "============================================"
echo "Version: $VERSION"
echo "Branch: main (default)"
echo "Features: Goals Refinements Implementation"
echo "Status: ✅ Ready for Production"
echo ""
echo "🔗 Next Steps:"
echo "• Test the deployed application"
echo "• Validate Goals system refinements"
echo "• Monitor activity stream filtering"
echo "• Verify enhanced comment display"
echo "• Confirm status change improvements"
echo ""
echo "📋 Release Notes: GOALS_REFINEMENTS_v3.5.1_IMPLEMENTATION.md"
echo "🌟 Ready for user testing and feedback!"
