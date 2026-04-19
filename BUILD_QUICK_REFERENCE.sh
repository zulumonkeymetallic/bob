#!/bin/bash

################################################################################
# BOB Build Quick Reference
# Print common build commands with examples
################################################################################

cat <<'EOF'

╔════════════════════════════════════════════════════════════════════════════╗
║                   BOB BUILD ORCHESTRATION - QUICK REFERENCE                 ║
╚════════════════════════════════════════════════════════════════════════════╝

MASTER ORCHESTRATOR LOCATION:
  /Users/jim/GitHub/bob/orchestrate-build.sh

WRAPPERS (call from any repo):
  ./ORCHESTRATE_BUILD.sh [OPTIONS]

═══════════════════════════════════════════════════════════════════════════════

COMMON COMMANDS:

  1. BUILD ALL (Web + iOS + Mac)
     orchestrate-build.sh --all
     
  2. BUILD & DEPLOY WEB ONLY
     orchestrate-build.sh --web
     
  3. BUILD iOS ONLY
     orchestrate-build.sh --ios
     
  4. BUILD MAC SYNC ONLY
     orchestrate-build.sh --mac
     
  5. PREVIEW WITHOUT DEPLOYING
     orchestrate-build.sh --all --dry-run
     
  6. SET CUSTOM VERSION
     orchestrate-build.sh --all --version 4.5.2
     
  7. BETA BUILD
     orchestrate-build.sh --all --beta
     
  8. SKIP GIT PR COMMENTS
     orchestrate-build.sh --all --skip-pr

═══════════════════════════════════════════════════════════════════════════════

REAL-WORLD EXAMPLES:

  ✓ Standard deployment (from any repo):
    cd /Users/jim/GitHub/bob-ios
    ./ORCHESTRATE_BUILD.sh --all
    
  ✓ Quick web-only hotfix:
    /Users/jim/GitHub/bob/orchestrate-build.sh --web --version 4.5.1
    
  ✓ Test changes without deployment:
    orchestrate-build.sh --ios --dry-run
    
  ✓ Release build with git automation:
    orchestrate-build.sh --all --version 4.6.0
    # (automatically creates PR comment with build details)

═══════════════════════════════════════════════════════════════════════════════

BUILD ARTIFACTS & LOCATIONS:

  📁 Web Build Output:
     /Users/jim/GitHub/bob/react-app/build/
     ↳ Deployed to: Firebase Hosting
     
  📁 iOS Build Output:
     /tmp/bob-ios-build/Build/Products/Release/BOB.app
     ↳ Installed to: /Applications/BOB-Mac.app
     
  📁 Mac Build Output:
     target/release/bob-mac-sync (or .build/release/)
     ↳ Installed to: /Applications/BOB-SyncService
     
  📁 Build Logs:
     /Users/jim/GitHub/bob/build-logs/
     ↳ manifest.json (complete build details)
     ↳ Previous builds (timestamped)
     
  📁 Build Info Display:
     window.__BOB_BUILD__ (web UI JavaScript)
     /build-manifest.json (serve via web server)

═══════════════════════════════════════════════════════════════════════════════

BUILD MANIFEST (auto-generated after each build):

  Path: /Users/jim/GitHub/bob/build-logs/manifest.json
  
  Usage:
    # View all build info
    cat build-logs/manifest.json | jq
    
    # Get specific version
    jq '.versions.web' build-logs/manifest.json
    
    # Get commits for all targets
    jq '.commits' build-logs/manifest.json
    
    # View build durations
    jq '.durations' build-logs/manifest.json

═══════════════════════════════════════════════════════════════════════════════

WEB UI BUILD INFO DISPLAY:

  Add to React components:
  
    import BuildInfo from '@/components/BuildInfo';
    
    // Compact badge (shows v4.5.0, click to expand)
    <BuildInfo compact={true} />
    
    // Full panel (shows all metadata)
    <BuildInfo />
    
    // Access directly in JavaScript
    const build = window.__BOB_BUILD__;
    console.log(`Built at ${build.timestamp}`);

═══════════════════════════════════════════════════════════════════════════════

TROUBLESHOOTING:

  ❌ "Master build script not found"
     → Ensure /Users/jim/GitHub/bob/orchestrate-build.sh exists
     
  ❌ Firebase deploy fails
     → Run: firebase login
     → Set project: firebase use bob20250810
     
  ❌ Xcode build fails
     → Run: xcode-select --install (or update Xcode)
     → Check: xcodebuild -showsdks
     
  ❌ Code signing fails
     → Check keychain: security unlock-keychain
     → View certs: security find-certificate -a ~/Library/Keychains/login.keychain
     
  ❌ PR comment not posting
     → Install GitHub CLI: brew install gh
     → Authenticate: gh auth login
     → Allow PR comment access in OAuth scopes

═══════════════════════════════════════════════════════════════════════════════

HELP & INFO:

  # Show all options
  orchestrate-build.sh --help
  
  # View build documentation
  cat /Users/jim/GitHub/bob/BUILD_ORCHESTRATION_GUIDE.md
  
  # Check last build details
  cat /Users/jim/GitHub/bob/build-logs/manifest.json | jq
  
  # Search build history
  ls -lt /Users/jim/GitHub/bob/build-logs/ | grep manifest

═══════════════════════════════════════════════════════════════════════════════

VERSION HISTORY:

  Orchestrator v1.0.0 - March 9, 2026
  ✓ Multi-repo coordination
  ✓ Automated version tracking
  ✓ Build metadata injection
  ✓ Git PR automation
  ✓ 7-day signing workaround
  
═══════════════════════════════════════════════════════════════════════════════

EOF
