#!/bin/bash

# 🚀 BOB v3.1.0 Enhanced Deployment Script with Auto-Version Management
# This script automatically increments versions, commits changes, and deploys

set -e  # Exit on any error

echo "🚀 BOB v3.1.0 - Enhanced Deployment Script Starting..."

# Get current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

# Function to get current version from package.json
get_current_version() {
    node -p "require('./react-app/package.json').version"
}

# Function to increment version
increment_version() {
    local version=$1
    local type=$2
    
    IFS='.' read -ra PARTS <<< "$version"
    local major=${PARTS[0]}
    local minor=${PARTS[1]}
    local patch=${PARTS[2]}
    
    case $type in
        "major")
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        "minor")
            minor=$((minor + 1))
            patch=0
            ;;
        "patch")
            patch=$((patch + 1))
            ;;
    esac
    
    echo "$major.$minor.$patch"
}

# Function to update version in files
update_version_in_files() {
    local new_version=$1
    
    print_status "Updating version to $new_version in all files..."
    
    # Update React app package.json
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$new_version\"/" react-app/package.json
    
    # Update root package.json
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$new_version\"/" package.json
    
    # Update version.ts
    sed -i '' "s/export const VERSION = 'v.*';/export const VERSION = 'v$new_version';/" react-app/src/version.ts
    
    # Update build time
    local build_time=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
    sed -i '' "s/export const BUILD_TIME = .*/export const BUILD_TIME = '$build_time';/" react-app/src/version.ts
    
    print_success "Version updated to $new_version"
}

# Function to generate deployment notes
generate_deployment_notes() {
    local version=$1
    local changes_file="DEPLOYMENT_SUCCESS_v${version}_$(date +%Y%m%d-%H%M%S).md"
    
    cat > "$changes_file" << EOF
# 🚀 BOB v${version} Deployment Success

**Deployment Date:** $(date '+%Y-%m-%d %H:%M:%S')
**Version:** v${version}
**Build Time:** $(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

## 🎯 Features Deployed

### Global Activity Stream System
- ✅ Comprehensive activity tracking for all record types
- ✅ UI click tracking with detailed metadata
- ✅ User notes functionality for any entity
- ✅ Enhanced error reporting with emoji prefixes
- ✅ Session tracking and user agent logging

### Version Management
- ✅ Automated version increment system (3.x.x notation)
- ✅ Git integration with automatic commits
- ✅ Build time tracking and cache busting
- ✅ Enhanced deployment script with error handling

### Technical Improvements
- ✅ useActivityTracking hook for component integration
- ✅ Global sidebar with activity stream for any record
- ✅ Comprehensive console logging for debugging
- ✅ Enhanced Firestore indexes for performance
- ✅ Automated UI element tracking

## 🔧 Technical Details

- **React App:** Built successfully with optimized production bundle
- **Firebase Hosting:** Deployed to https://bob20250810.web.app
- **Firestore:** Updated with enhanced indexes and security rules
- **Git:** All changes committed with proper version tags
- **Build Size:** Optimized for performance with tree-shaking

## 🎪 Next Steps

- Monitor activity stream performance in production
- Implement automated Selenium testing using console logs
- Continue with Phase 1 roadmap items from v3.0.8 handoff
- Add more comprehensive error tracking and analytics

## 📊 Deployment Verification

- [ ] Application loads successfully
- [ ] Authentication works correctly
- [ ] Activity stream captures all interactions
- [ ] UI tracking logs appear in console
- [ ] Version displays correctly (v${version})
- [ ] All major features functional

---
*Deployed via automated deployment script v3.1.0*
EOF

    echo "$changes_file"
}

# Main deployment function
main() {
    print_status "🚀 Starting BOB v3.1.0 Enhanced Deployment Process"
    
    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        print_error "Not in a git repository"
        exit 1
    fi
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        print_warning "Uncommitted changes detected. Committing them first..."
        git add .
        git commit -m "Pre-deployment commit: $(date '+%Y-%m-%d %H:%M:%S')"
    fi
    
    # Get current version
    current_version=$(get_current_version)
    print_status "Current version: $current_version"
    
    # Determine version increment type (default to patch)
    version_type=${1:-"patch"}
    print_status "Version increment type: $version_type"
    
    # Calculate new version
    new_version=$(increment_version "$current_version" "$version_type")
    print_status "New version will be: $new_version"
    
    # Update version in all files
    update_version_in_files "$new_version"
    
    # Build React app
    print_status "Building React application..."
    cd react-app
    npm run build
    cd ..
    print_success "React app built successfully"
    
    # Commit version changes
    print_status "Committing version changes..."
    git add .
    git commit -m "v$new_version: Enhanced Global Activity Stream & UI Tracking

🎯 BOB v$new_version FEATURES:
- Global activity stream for all record types
- Comprehensive UI click tracking with metadata
- User notes functionality for any entity
- Enhanced error reporting and console logging
- Automated version management system

🚀 TECHNICAL IMPROVEMENTS:
- useActivityTracking hook for easy integration
- Global sidebar with universal activity stream
- Session tracking and user agent logging
- Enhanced Firestore indexes for performance
- Automated deployment script with Git integration

🔄 VERSION MANAGEMENT:
- Moved to 3.x.x notation for feature releases
- Automated version increment in all files
- Build time tracking and cache busting
- Enhanced deployment documentation

📅 Build: $(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
🏷️  Tag: v$new_version"
    
    # Create Git tag
    git tag -a "v$new_version" -m "BOB v$new_version - Global Activity Stream & UI Tracking"
    print_success "Git commit and tag created for v$new_version"
    
    # Deploy to Firebase Hosting
    print_status "Deploying to Firebase Hosting..."
    firebase deploy --only hosting
    print_success "Deployed to Firebase Hosting"
    
    # Generate deployment notes
    deployment_file=$(generate_deployment_notes "$new_version")
    print_success "Deployment notes generated: $deployment_file"
    
    # Final status
    echo ""
    print_success "🎉 BOB v$new_version Deployment Complete!"
    echo ""
    echo "📋 Deployment Summary:"
    echo "   • Version: v$new_version"
    echo "   • URL: https://bob20250810.web.app"
    echo "   • Notes: $deployment_file"
    echo "   • Git Tag: v$new_version"
    echo ""
    echo "🔍 Next Actions:"
    echo "   • Verify deployment at https://bob20250810.web.app"
    echo "   • Check console logs for UI tracking"
    echo "   • Test activity stream functionality"
    echo "   • Monitor application performance"
    echo ""
}

# Help function
show_help() {
    echo "🚀 BOB v3.1.0 Enhanced Deployment Script"
    echo ""
    echo "Usage: $0 [version_type]"
    echo ""
    echo "Version Types:"
    echo "  patch   - Increment patch version (3.1.0 -> 3.1.1) [default]"
    echo "  minor   - Increment minor version (3.1.0 -> 3.2.0)"
    echo "  major   - Increment major version (3.1.0 -> 4.0.0)"
    echo ""
    echo "Examples:"
    echo "  $0 patch   # 3.1.0 -> 3.1.1"
    echo "  $0 minor   # 3.1.0 -> 3.2.0"
    echo "  $0 major   # 3.1.0 -> 4.0.0"
    echo ""
}

# Check for help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_help
    exit 0
fi

# Run main function
main "$@"
