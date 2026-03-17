#!/bin/bash

################################################################################
# BOB Multi-Repo Build Orchestrator
# Master script to build, deploy, and coordinate across:
#   - Web UI (React + Firebase functions)
#   - iOS App (Xcode)
#   - Mac Sync App (native macOS)
#
# Usage from any repo:
#   /path/to/bob/orchestrate-build.sh [OPTIONS]
#
# Options:
#   --web               Build & deploy web only
#   --ios               Build & deploy iOS only
#   --mac               Build & deploy Mac sync only
#   --all               Build & deploy all (default)
#   --skip-pr           Don't create PR/comments
#   --version VERSION   Set explicit version (e.g., 4.5.1)
#   --beta              Mark as beta build
#   --dry-run           Show what would be deployed without deploying
#
################################################################################

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BOB_ROOT="/Users/jim/GitHub/bob"
BOB_IOS_ROOT="/Users/jim/GitHub/bob-ios"
BOB_MAC_SYNC_ROOT="/Users/jim/GitHub/bob-mac-sync"
BUILD_LOGS_DIR="/Users/jim/GitHub/bob/build-logs"
BUILD_MANIFEST_FILE="${BUILD_LOGS_DIR}/manifest.json"

# Build options
BUILD_TARGET="all"
SKIP_PR=false
EXPLICIT_VERSION=""
IS_BETA=false
DRY_RUN=false

# Build metadata
BUILD_ID=$(date +%s%N | cut -b1-13)
BUILD_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BUILD_DATE=$(date +"%Y-%m-%d %H:%M:%S")
CURRENT_BRANCH=$(cd "$BOB_ROOT" && git rev-parse --abbrev-ref HEAD)
BUILD_USER=$(whoami)

# ============================================================================
# Utility Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1" >&2
}

get_git_commit() {
    cd "$1" && git rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

get_git_author() {
    cd "$1" && git config user.name 2>/dev/null || echo "Unknown"
}

get_version() {
    local target=$1
    if [ -n "$EXPLICIT_VERSION" ]; then
        echo "$EXPLICIT_VERSION"
    else
        case $target in
            web)
                cd "$BOB_ROOT" && jq -r '.version' package.json 2>/dev/null || echo "4.5.0"
                ;;
            ios)
                cd "$BOB_IOS_ROOT" && grep -o 'MARKETING_VERSION = .*;' BOB\ Universal.xcodeproj/project.pbxproj | head -1 | sed 's/.*= \(.*\);/\1/' | tr -d ' "' || echo "4.5.0"
                ;;
            mac)
                cd "$BOB_MAC_SYNC_ROOT" && grep 'version' Cargo.toml 2>/dev/null | head -1 | sed 's/.*version = "\(.*\)".*/\1/' || echo "4.5.0"
                ;;
            *)
                echo "4.5.0"
                ;;
        esac
    fi
}

# ============================================================================
# Build Functions
# ============================================================================

build_web() {
    log_info "Building Web UI..."
    
    cd "$BOB_ROOT"
    local web_version=$(get_version "web")
    local web_commit=$(get_git_commit "$BOB_ROOT")
    local build_start=$(date +%s)
    
    log_info "Version: $web_version | Commit: $web_commit"
    
    # Install deps
    log_info "Installing dependencies..."
    npm install --prefix react-app 2>&1 | tail -5 >&2
    
    # Build React
    log_info "Building React application..."
    REACT_APP_BUILD_TIME="$BUILD_TIMESTAMP" \
    REACT_APP_BUILD_ID="$BUILD_ID" \
    REACT_APP_VERSION="$web_version" \
    REACT_APP_GIT_COMMIT="$web_commit" \
    npm run build --prefix react-app 2>&1 | tail -10 >&2
    
    # Inject build info into index.html
    log_info "Injecting build metadata..."
    cat >> react-app/build/index.html <<EOF
<!-- Build Metadata -->
<script>
  window.__BOB_BUILD__ = {
    version: '$web_version',
    commit: '$web_commit',
    buildId: '$BUILD_ID',
    timestamp: '$BUILD_TIMESTAMP',
    date: '$BUILD_DATE',
    user: '$BUILD_USER'
  };
</script>
EOF
    
    if [ "$DRY_RUN" != "true" ]; then
        # Deploy to Firebase Hosting
        log_info "Deploying to Firebase Hosting..."
        firebase deploy --only hosting --force 2>&1 | grep -E "Deploy complete|Error" | head -5 >&2
        
        # Deploy functions
        log_info "Deploying Cloud Functions..."
        firebase deploy --only functions --force 2>&1 | grep -E "Deploy complete|Error|functions" | head -10 >&2
    else
        log_warning "DRY RUN: Skipping Firebase deployment"
    fi
    
    local build_end=$(date +%s)
    local build_duration=$((build_end - build_start))
    
    log_success "Web build complete (${build_duration}s)"
    
    # Return build info
    printf '%s\n' "$web_version|$web_commit|${build_duration}s|$BUILD_TIMESTAMP"
}

build_ios() {
    log_info "Building iOS App..."
    
    cd "$BOB_IOS_ROOT"
    local ios_version=$(get_version "ios")
    local ios_commit=$(get_git_commit "$BOB_IOS_ROOT")
    local build_start=$(date +%s)
    
    log_info "Version: $ios_version | Commit: $ios_commit"
    
    # Update build settings
    log_info "Updating build metadata in Info.plist..."
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion '$BUILD_ID'" \
        BOB/Resources/Info.plist 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :BOBBuildTime '$BUILD_TIMESTAMP'" \
        BOB/Resources/Info.plist 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :BOBGitCommit '$ios_commit'" \
        BOB/Resources/Info.plist 2>/dev/null || true
    
    if [ "$DRY_RUN" != "true" ]; then
        # Build for Mac Catalyst
        log_info "Building for Mac Catalyst..."
        xcodebuild build \
            -project "BOB Universal.xcodeproj" \
            -scheme BOB \
            -destination 'platform=macOS' \
            -derivedDataPath /tmp/bob-ios-build \
            -configuration Release 2>&1 | grep -E "Build complete|error:" | head -5 >&2
        
        # Copy app to Applications
        log_info "Installing to Applications..."
        if [ -d "/tmp/bob-ios-build/Build/Products/Release/BOB.app" ]; then
            cp -r "/tmp/bob-ios-build/Build/Products/Release/BOB.app" /Applications/BOB-Mac.app
            log_success "Installed to /Applications/BOB-Mac.app"
        fi
    else
        log_warning "DRY RUN: Skipping Xcode build"
    fi
    
    local build_end=$(date +%s)
    local build_duration=$((build_end - build_start))
    
    log_success "iOS build complete (${build_duration}s)"
    
    printf '%s\n' "$ios_version|$ios_commit|${build_duration}s|$BUILD_TIMESTAMP"
}

build_mac() {
    log_info "Building Mac Sync App..."
    
    cd "$BOB_MAC_SYNC_ROOT"
    local mac_version=$(get_version "mac")
    local mac_commit=$(get_git_commit "$BOB_MAC_SYNC_ROOT")
    local build_start=$(date +%s)
    
    log_info "Version: $mac_version | Commit: $mac_commit"
    
    if [ "$DRY_RUN" != "true" ]; then
        # Build with Cargo or Swift depending on project setup
        if [ -f "Cargo.toml" ]; then
            log_info "Building Rust project..."
            cargo build --release 2>&1 | tail -10 >&2
            local binary_path="target/release/bob-mac-sync"
        else
            log_info "Building Swift project..."
            swift build -c release 2>&1 | tail -10 >&2
            local binary_path=".build/release/bob-mac-sync"
        fi
        
        # Code sign
        log_info "Code signing..."
        if [ -f "$binary_path" ]; then
            codesign -s - "$binary_path" 2>&1 | grep -v "replacing existing signature" >&2 || true
            log_success "Binary signed"
        fi
        
        # Copy to Applications
        if [ -f "$binary_path" ]; then
            cp "$binary_path" /Applications/BOB-SyncService
            chmod +x /Applications/BOB-SyncService
            log_success "Installed to /Applications/BOB-SyncService"
        fi
        
        # Remove old 7-day signed version if newer build exists
        if [ -f "/Applications/BOB-SyncService-old" ]; then
            log_info "Removing previous build to avoid signing conflicts..."
            rm -f /Applications/BOB-SyncService-old
        fi
    else
        log_warning "DRY RUN: Skipping build and code signing"
    fi
    
    local build_end=$(date +%s)
    local build_duration=$((build_end - build_start))
    
    log_success "Mac build complete (${build_duration}s)"
    
    printf '%s\n' "$mac_version|$mac_commit|${build_duration}s|$BUILD_TIMESTAMP"
}

# ============================================================================
# Git & PR Functions
# ============================================================================

create_build_pr() {
    log_info "Creating build PR and commit comment..."
    
    cd "$BOB_ROOT"
    
    local pr_body="## Build Complete ✓

**Build ID:** \`$BUILD_ID\`  
**Date:** $BUILD_DATE  
**Branch:** $CURRENT_BRANCH  
**User:** $BUILD_USER  

### Versions
- Web: $WEB_VERSION  
- iOS: $IOS_VERSION  
- Mac Sync: $MAC_VERSION  

### Commits
- Web: \`$WEB_COMMIT\`  
- iOS: \`$IOS_COMMIT\`  
- Mac Sync: \`$MAC_COMMIT\`  

### Durations
- Web Build: $WEB_DURATION  
- iOS Build: $IOS_DURATION  
- Mac Build: $MAC_DURATION  

### Artifacts
- 🌐 Web: Deployed to Firebase Hosting
- 📱 iOS: Installed to /Applications/BOB-Mac.app
- 💻 Mac Sync: Installed to /Applications/BOB-SyncService

**GitHub Links:**
- [Web Repo](https://github.com/jim/bob/commit/$WEB_COMMIT)
- [iOS Repo](https://github.com/jim/bob-ios/commit/$IOS_COMMIT)
- [Mac Sync Repo](https://github.com/jim/bob-mac-sync/commit/$MAC_COMMIT)
"

    # Try to create comment on recent commit
    local current_commit=$(git rev-parse --short HEAD)
    
    log_info "PR Summary:"
    echo "$pr_body" >&2
    
    if command -v gh &> /dev/null; then
        log_info "Creating GitHub PR comment..."
        # This would require GitHub CLI setup and auth
        # gh pr comment --body "$pr_body" 2>/dev/null || true
    fi
}

# ============================================================================
# Manifest & Logging
# ============================================================================

save_build_manifest() {
    mkdir -p "$BUILD_LOGS_DIR"
    jq -n \
      --arg buildId "$BUILD_ID" \
      --arg timestamp "$BUILD_TIMESTAMP" \
      --arg date "$BUILD_DATE" \
      --arg branch "$CURRENT_BRANCH" \
      --arg user "$BUILD_USER" \
      --arg webVersion "${WEB_VERSION:-}" \
      --arg iosVersion "${IOS_VERSION:-}" \
      --arg macVersion "${MAC_VERSION:-}" \
      --arg webCommit "${WEB_COMMIT:-}" \
      --arg iosCommit "${IOS_COMMIT:-}" \
      --arg macCommit "${MAC_COMMIT:-}" \
      --arg webDuration "${WEB_DURATION:-}" \
      --arg iosDuration "${IOS_DURATION:-}" \
      --arg macDuration "${MAC_DURATION:-}" \
      --argjson dryRun "$DRY_RUN" \
      --argjson beta "$IS_BETA" \
      '{
        buildId: $buildId,
        timestamp: $timestamp,
        date: $date,
        branch: $branch,
        user: $user,
        versions: {
          web: $webVersion,
          ios: $iosVersion,
          mac: $macVersion
        },
        commits: {
          web: $webCommit,
          ios: $iosCommit,
          mac: $macCommit
        },
        durations: {
          web: $webDuration,
          ios: $iosDuration,
          mac: $macDuration
        },
        dryRun: $dryRun,
        beta: $beta
      }' > "$BUILD_MANIFEST_FILE"
    log_success "Manifest saved: $BUILD_MANIFEST_FILE"
}

# ============================================================================
# Main Orchestration
# ============================================================================

show_usage() {
    cat <<EOF
Usage: orchestrate-build.sh [OPTIONS]

Options:
  --web               Build & deploy web only
  --ios               Build & deploy iOS only
  --mac               Build & deploy Mac sync only
  --all               Build & deploy all (default)
  --skip-pr           Don't create PR/comments
  --version VERSION   Set explicit version (e.g., 4.5.1)
  --beta              Mark as beta build
  --dry-run           Show what would be deployed

Examples:
  orchestrate-build.sh --all
  orchestrate-build.sh --web --version 4.5.2
  orchestrate-build.sh --ios --beta --dry-run
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --web)
            BUILD_TARGET="web"
            shift
            ;;
        --ios)
            BUILD_TARGET="ios"
            shift
            ;;
        --mac)
            BUILD_TARGET="mac"
            shift
            ;;
        --all)
            BUILD_TARGET="all"
            shift
            ;;
        --skip-pr)
            SKIP_PR=true
            shift
            ;;
        --version)
            EXPLICIT_VERSION="$2"
            shift 2
            ;;
        --beta)
            IS_BETA=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# ============================================================================
# Execute Build
# ============================================================================

log_info "========================================="
log_info "BOB Multi-Repo Build Orchestrator"
log_info "Build ID: $BUILD_ID"
log_info "Target: $BUILD_TARGET"
log_info "Date: $BUILD_DATE"
log_info "User: $BUILD_USER"
log_info "Branch: $CURRENT_BRANCH"
if [ "$DRY_RUN" = "true" ]; then
    log_warning "DRY RUN MODE ENABLED"
fi
log_info "========================================="

case $BUILD_TARGET in
    web)
        IFS='|' read -r WEB_VERSION WEB_COMMIT WEB_DURATION WEB_TIMESTAMP < <(build_web)
        ;;
    ios)
        IFS='|' read -r IOS_VERSION IOS_COMMIT IOS_DURATION IOS_TIMESTAMP < <(build_ios)
        ;;
    mac)
        IFS='|' read -r MAC_VERSION MAC_COMMIT MAC_DURATION MAC_TIMESTAMP < <(build_mac)
        ;;
    all)
        IFS='|' read -r WEB_VERSION WEB_COMMIT WEB_DURATION WEB_TIMESTAMP < <(build_web)
        IFS='|' read -r IOS_VERSION IOS_COMMIT IOS_DURATION IOS_TIMESTAMP < <(build_ios)
        IFS='|' read -r MAC_VERSION MAC_COMMIT MAC_DURATION MAC_TIMESTAMP < <(build_mac)
        ;;
esac

# Save manifest
save_build_manifest

# Create PR comment if requested
if [ "$SKIP_PR" != "true" ]; then
    create_build_pr
fi

log_info "========================================="
log_success "Build Orchestration Complete!"
log_info "Build Manifest: $BUILD_MANIFEST_FILE"
log_info "========================================="

exit 0
