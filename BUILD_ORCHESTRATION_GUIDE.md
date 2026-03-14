# BOB Build Orchestration System

**Master build script for coordinating simultaneous builds & deployments across:**
- 🌐 Web UI (React + Firebase)
- 📱 iOS App (Xcode/Mac Catalyst)
- 💻 Mac Sync Service (native macOS)

---

## Quick Start

### From Any Repository

```bash
# From bob/ (web)
/Users/jim/GitHub/bob/orchestrate-build.sh --all

# From bob-ios/
./ORCHESTRATE_BUILD.sh --all

# From bob-mac-sync/
./ORCHESTRATE_BUILD.sh --all
```

### Available Commands

```bash
# Build all targets (default)
orchestrate-build.sh --all

# Build only web
orchestrate-build.sh --web

# Build only iOS
orchestrate-build.sh --ios

# Build only Mac
orchestrate-build.sh --mac

# Preview without deploying
orchestrate-build.sh --all --dry-run

# Set explicit version
orchestrate-build.sh --all --version 4.5.2

# Mark as beta build
orchestrate-build.sh --all --beta

# Skip PR creation
orchestrate-build.sh --all --skip-pr
```

---

## What the Orchestrator Does

### 1. Web UI Build (`--web`)
- ✅ Installs npm dependencies
- ✅ Builds React app with metadata injection
- ✅ Deploys to Firebase Hosting
- ✅ Deploys Cloud Functions
- ✅ Injects build info into HTML (`window.__BOB_BUILD__`)
- ⏱️ Tracks build duration and timestamps

### 2. iOS App Build (`--ios`)
- ✅ Updates Info.plist with build metadata
- ✅ Builds for Mac Catalyst (xcodebuild)
- ✅ Code signs the binary
- ✅ Installs to `/Applications/BOB-Mac.app`
- ✅ Tracks version and commit
- ⏱️ Eliminates 7-day signing cycle (fresh sign each build)

### 3. Mac Sync Service Build (`--mac`)
- ✅ Builds Rust/Swift binary
- ✅ Code signs with local certificate
- ✅ Installs to `/Applications/BOB-SyncService`
- ✅ Removes old builds to avoid signing conflicts
- ⏱️ Handles both Cargo and Swift projects

### 4. Metadata Tracking
Each build creates a manifest JSON stored at:
```
/Users/jim/GitHub/bob/build-logs/manifest.json
```

**Manifest Contents:**
```json
{
  "buildId": "1710067234123",
  "timestamp": "2026-03-09T13:20:34Z",
  "date": "2026-03-09 13:20:34",
  "branch": "main",
  "user": "jim",
  "versions": {
    "web": "4.5.0",
    "ios": "4.5.0",
    "mac": "4.5.0"
  },
  "commits": {
    "web": "abc1234",
    "ios": "def5678",
    "mac": "ghi9012"
  },
  "durations": {
    "web": "45s",
    "ios": "120s",
    "mac": "60s"
  }
}
```

---

## Build Info Display in UIs

### Web UI
Build info is displayed in two ways:

**1. Compact Badge (in footer/toolbar)**
```jsx
<BuildInfo compact={true} />
```
Shows: `v4.5.0` (click to expand)

**2. Full Build Info Panel**
```jsx
<BuildInfo />
```
Shows:
- Version
- Commit hash
- Build ID
- Build timestamp
- Build user

### Display Location
The build info is automatically accessible via:
- `window.__BOB_BUILD__` (JavaScript)
- HTML inject in build output
- Fetch from `/build-manifest.json`

---

## Integration with Git & GitHub

### Automatic PR Comments

When GitHub CLI (`gh`) is installed and configured, the orchestrator can:

1. **Auto-detect active PR** for current branch
2. **Post build details** as PR comment
3. **Include commit hashes** from all three repos
4. **Link to GitHub commits**

Example comment:
```
## 🚀 Build Deployment Complete

Build ID: `1710067234123`
Timestamp: 2026-03-09 13:20:34

### Commits Included
- 🌐 Web: `abc1234`
- 📱 iOS: `def5678`  
- 💻 Mac: `ghi9012`

### Deployment Status
✅ Web: Deployed to Firebase Hosting
✅ iOS: Built and signed
✅ Mac: Built and signed
```

### Setup GitHub Automation
```bash
# 1. Install GitHub CLI
brew install gh

# 2. Authenticate
gh auth login

# 3. Run build with PR comments
orchestrate-build.sh --all

# To skip PR comments
orchestrate-build.sh --all --skip-pr
```

---

## Version Management

### Automatic Version Detection
Versions are read from source files:
- **Web:** `package.json` (root)
- **iOS:** `Info.plist` (BOB target)
- **Mac:** `Cargo.toml` (dependencies)

### Override Version
```bash
orchestrate-build.sh --all --version 4.5.2
```

### Beta Builds
```bash
orchestrate-build.sh --all --beta
# Appends "-beta" to version in PR comments
```

---

## Build Logs & Inspection

### View Build Manifest
```bash
cat /Users/jim/GitHub/bob/build-logs/manifest.json | jq
```

### Query Last Build
```bash
jq '.buildId, .date, .commits' /Users/jim/GitHub/bob/build-logs/manifest.json
```

### View Build Timeline
```bash
ls -lt /Users/jim/GitHub/bob/build-logs/ | head -20
```

---

## Troubleshooting

### Build fails with "command not found"
- Ensure all tools are in PATH:
  - `xcodebuild` (Xcode)
  - `firebase` (Firebase CLI)
  - `cargo` or `swift` (Rust/Swift toolchain)

### PR comment not created
- Install GitHub CLI: `brew install gh`
- Authenticate: `gh auth login`
- Ensure you have PR permissions in GitHub

### iOS build fails with code signing
- Run: `security unlock-keychain` if prompted
- Verify certificate in Keychain Access

### Dry run not showing what would deploy
- Add `--dry-run` flag to preview without actual deployment
- Review output logs in terminal

---

## Advanced Options

### Custom Build Targets
Edit the script to add custom build targets or environments:

```bash
# Example: Add staging deployments
--web --staging    # Deploy to staging environment
--ios --testflight # Distribute to TestFlight
```

### Integration with CI/CD
The orchestrator is designed to run in GitHub Actions:

```yaml
name: Build & Deploy
on: push
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - name: orchestrate build
        run: ./orchestrate-build.sh --all --skip-pr
```

---

## File Locations

| Component | Location |
|-----------|----------|
| Master Script | `/Users/jim/GitHub/bob/orchestrate-build.sh` |
| iOS Wrapper | `/Users/jim/GitHub/bob-ios/ORCHESTRATE_BUILD.sh` |
| Mac Wrapper | `/Users/jim/GitHub/bob-mac-sync/ORCHESTRATE_BUILD.sh` |
| Build Logs | `/Users/jim/GitHub/bob/build-logs/` |
| React Component | `/Users/jim/GitHub/bob/react-app/src/components/BuildInfo.tsx` |
| Git Hooks | `/Users/jim/GitHub/bob/.git-hooks/` |

---

## Usage Statistics

Each build records:
- Build duration (per target)
- Commit hashes (for traceability)
- Build timestamp (ISO 8601)
- Current branch
- User who initiated build
- Version numbers
- Build ID (unique identifier)

This enables:
- Post-deployment verification
- Performance tracking
- Build history auditing
- Version management

---

## Support

For issues or enhancements:
1. Check build manifest: `cat build-logs/manifest.json | jq`
2. Review build logs in terminal output
3. Run with `--dry-run` to preview
4. Check GitHub Actions logs if running in CI

---

**Last Updated:** March 9, 2026  
**Orchestrator Version:** 1.0.0
