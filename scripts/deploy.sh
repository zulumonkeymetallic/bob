#!/bin/bash

# BOB Enhanced Deployment Script
# Ensures alignment between version history, issues fixed, and GitHub

set -e  # Exit on any error

# Configuration
APP_NAME="BOB Productivity Platform"
REPO_OWNER="zulumonkeymetallic"
REPO_NAME="bob"
FIREBASE_PROJECT="bob20250810"
DEPLOYMENT_LOG_FILE="deployment_history.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🚀 BOB Enhanced Deployment Script v2.0${NC}"
echo "=================================================="

# Function to log with timestamp
log() {
    echo -e "${CYAN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

# Function to handle errors
error_exit() {
    echo -e "${RED}❌ Error: $1${NC}" >&2
    exit 1
}

# Check prerequisites
log "🔍 Checking prerequisites..."
command -v npm >/dev/null 2>&1 || error_exit "npm is required but not installed"
command -v firebase >/dev/null 2>&1 || error_exit "Firebase CLI is required but not installed"
command -v gh >/dev/null 2>&1 || error_exit "GitHub CLI is required but not installed"
command -v jq >/dev/null 2>&1 || error_exit "jq is required but not installed"

# Get current directory and check if we're in the right place
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
REACT_APP_DIR="$PROJECT_ROOT/react-app"

if [ ! -f "$REACT_APP_DIR/package.json" ]; then
    error_exit "React app not found at $REACT_APP_DIR"
fi

cd "$REACT_APP_DIR"

# Extract version information
log "📋 Extracting version information..."
PACKAGE_VERSION=$(jq -r '.version' package.json)
VERSION_TS_VERSION=$(grep "export const VERSION" src/version.ts | sed -n "s/.*'\(.*\)'.*/\1/p")
VERSION_JSON_VERSION=$(jq -r '.version' public/version.json)

echo -e "${YELLOW}Package.json version: $PACKAGE_VERSION${NC}"
echo -e "${YELLOW}version.ts version: $VERSION_TS_VERSION${NC}"
echo -e "${YELLOW}version.json version: $VERSION_JSON_VERSION${NC}"

# Check version alignment
if [ "$PACKAGE_VERSION" != "$VERSION_TS_VERSION" ] || [ "$PACKAGE_VERSION" != "$VERSION_JSON_VERSION" ]; then
    error_exit "Version mismatch detected! All versions must be aligned."
fi

CURRENT_VERSION="$PACKAGE_VERSION"
log "✅ Version alignment confirmed: $CURRENT_VERSION"

# Check for uncommitted changes
log "🔍 Checking for uncommitted changes..."
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️ Uncommitted changes detected:${NC}"
    git status --short
    echo ""
    read -p "Continue with deployment? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled."
        exit 1
    fi
fi

# Get release notes from user or auto-generate
log "📝 Preparing release notes..."
echo "Enter release notes for version $CURRENT_VERSION (or press Enter for auto-generated):"
read -r RELEASE_NOTES

if [ -z "$RELEASE_NOTES" ]; then
    # Auto-generate release notes from git commits and GitHub issues
    log "🤖 Auto-generating release notes..."
    
    # Get recent commits
    RECENT_COMMITS=$(git log --oneline -10 --pretty=format:"- %s")
    
    # Get closed issues from GitHub (if any)
    CLOSED_ISSUES=$(gh issue list --state closed --limit 5 --json number,title --jq '.[] | "- #\(.number): \(.title)"' 2>/dev/null || echo "")
    
    RELEASE_NOTES="## $APP_NAME $CURRENT_VERSION

### 🚀 Features & Improvements
$RECENT_COMMITS

### 🐛 Issues Resolved
$CLOSED_ISSUES

### 📈 Technical Details
- Version: $CURRENT_VERSION
- Build Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Deployment: Firebase Hosting
- Repository: $REPO_OWNER/$REPO_NAME"
fi

# Create deployment record
log "📊 Creating deployment record..."
DEPLOYMENT_RECORD=$(cat <<EOF
{
  "version": "$CURRENT_VERSION",
  "deploymentDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deploymentBy": "$(git config user.name)",
  "buildHash": "$(git rev-parse HEAD)",
  "releaseNotes": $(echo "$RELEASE_NOTES" | jq -R -s .),
  "githubIssues": $(jq '.githubIssues' public/version.json),
  "features": $(jq '.features' public/version.json),
  "environment": "production",
  "firebaseProject": "$FIREBASE_PROJECT"
}
EOF
)

# Update deployment history
if [ -f "$PROJECT_ROOT/$DEPLOYMENT_LOG_FILE" ]; then
    HISTORY=$(cat "$PROJECT_ROOT/$DEPLOYMENT_LOG_FILE")
else
    HISTORY="[]"
fi

UPDATED_HISTORY=$(echo "$HISTORY" | jq ". + [$DEPLOYMENT_RECORD]")
echo "$UPDATED_HISTORY" > "$PROJECT_ROOT/$DEPLOYMENT_LOG_FILE"

log "✅ Deployment record created"

# Build the application
log "🔨 Building React application..."
npm run build || error_exit "Build failed"

# Run tests if they exist (allow bypass with SKIP_TESTS=1)
if [ "${SKIP_TESTS:-0}" != "1" ]; then
    if [ -f "package.json" ] && jq -e '.scripts.test' package.json > /dev/null; then
        log "🧪 Running tests..."
        CI=true npm test -- --coverage --watchAll=false || error_exit "Tests failed"
    fi
else
    log "🔕 Skipping tests due to SKIP_TESTS=1"
fi

# Deploy to Firebase
log "🚀 Deploying to Firebase..."
firebase deploy --only hosting --project "$FIREBASE_PROJECT" || error_exit "Firebase deployment failed"

# Create GitHub release
log "📦 Creating GitHub release..."
cd "$PROJECT_ROOT"

# Create release tag
git tag -a "$CURRENT_VERSION" -m "Release $CURRENT_VERSION" || log "⚠️ Tag may already exist"
git push origin "$CURRENT_VERSION" 2>/dev/null || log "⚠️ Tag push may have failed"

# Create GitHub release
RELEASE_BODY=$(echo "$RELEASE_NOTES" | sed 's/"/\\"/g' | tr '\n' '\\n')
gh release create "$CURRENT_VERSION" \
    --title "$APP_NAME $CURRENT_VERSION" \
    --notes "$RELEASE_NOTES" \
    --latest 2>/dev/null || log "⚠️ GitHub release may already exist"

# Update issue tracking
log "🎯 Updating GitHub issues..."
RESOLVED_ISSUES=$(jq -r '.githubIssues[]' "$REACT_APP_DIR/public/version.json" | grep -o '#[0-9]\+' | sed 's/#//' || echo "")

for issue_num in $RESOLVED_ISSUES; do
    if [ -n "$issue_num" ]; then
        log "📌 Updating issue #$issue_num"
        gh issue comment "$issue_num" --body "✅ **Resolved in $CURRENT_VERSION**

This issue has been addressed in the latest deployment.

**Deployment Details:**
- Version: $CURRENT_VERSION  
- Deployed: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
- Live URL: https://$FIREBASE_PROJECT.web.app

The fix is now live in production!" 2>/dev/null || log "⚠️ Could not comment on issue #$issue_num"
    fi
done

# Performance check
log "⚡ Running post-deployment checks..."
DEPLOYMENT_URL="https://$FIREBASE_PROJECT.web.app"

# Check if site is accessible
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOYMENT_URL" || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
    log "✅ Site is accessible at $DEPLOYMENT_URL"
else
    log "⚠️ Site returned HTTP $HTTP_STATUS"
fi

# Check version endpoint
VERSION_CHECK=$(curl -s "$DEPLOYMENT_URL/version.json" | jq -r '.version' 2>/dev/null || echo "unknown")
if [ "$VERSION_CHECK" = "$CURRENT_VERSION" ]; then
    log "✅ Version endpoint confirmed: $VERSION_CHECK"
else
    log "⚠️ Version mismatch: expected $CURRENT_VERSION, got $VERSION_CHECK"
fi

# Final summary
echo ""
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo "=================================================="
echo -e "${CYAN}Version: $CURRENT_VERSION${NC}"
echo -e "${CYAN}Live URL: $DEPLOYMENT_URL${NC}"
echo -e "${CYAN}GitHub Release: https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/$CURRENT_VERSION${NC}"
echo -e "${CYAN}Deployment Time: $(date)${NC}"
echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo "1. Test the deployed application"
echo "2. Monitor for any issues"
echo "3. Update documentation if needed"
echo "4. Close resolved GitHub issues"
echo ""
echo -e "${PURPLE}🔗 Quick Links:${NC}"
echo "- Live App: $DEPLOYMENT_URL"
echo "- GitHub Issues: https://github.com/$REPO_OWNER/$REPO_NAME/issues"
echo "- Firebase Console: https://console.firebase.google.com/project/$FIREBASE_PROJECT"
echo ""

# Optional: Open browser to deployed site
read -p "Open deployed site in browser? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v open >/dev/null 2>&1; then
        open "$DEPLOYMENT_URL"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$DEPLOYMENT_URL"
    else
        echo "Please open $DEPLOYMENT_URL in your browser"
    fi
fi

log "🎯 Deployment script completed successfully!"
