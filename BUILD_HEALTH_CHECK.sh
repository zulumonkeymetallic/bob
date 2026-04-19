#!/bin/bash

################################################################################
# BOB Build System - Health Check & Validation
# Diagnose orchestration setup
################################################################################

echo "🔍 BOB Build Orchestration - Health Check"
echo "=========================================="
echo ""

HEALTH_SCORE=0
HEALTH_TOTAL=12

# Check 1: Master script exists and is executable
if [ -x "/Users/jim/GitHub/bob/orchestrate-build.sh" ]; then
    echo "✓ Master build script found and executable"
    ((HEALTH_SCORE++))
else
    echo "✗ Master build script missing or not executable"
fi
((HEALTH_TOTAL++))

# Check 2: iOS wrapper exists
if [ -x "/Users/jim/GitHub/bob-ios/ORCHESTRATE_BUILD.sh" ]; then
    echo "✓ iOS wrapper script found"
    ((HEALTH_SCORE++))
else
    echo "✗ iOS wrapper script missing"
fi

# Check 3: Mac wrapper exists
if [ -x "/Users/jim/GitHub/bob-mac-sync/ORCHESTRATE_BUILD.sh" ]; then
    echo "✓ Mac wrapper script found"
    ((HEALTH_SCORE++))
else
    echo "✗ Mac wrapper script missing"
fi

# Check 4: Build logs directory exists
if [ -d "/Users/jim/GitHub/bob/build-logs" ]; then
    echo "✓ Build logs directory exists"
    ((HEALTH_SCORE++))
else
    echo "✗ Build logs directory missing (will be created on first build)"
fi

# Check 5: React BuildInfo component exists
if [ -f "/Users/jim/GitHub/bob/react-app/src/components/BuildInfo.tsx" ]; then
    echo "✓ React BuildInfo component found"
    ((HEALTH_SCORE++))
else
    echo "✗ React BuildInfo component missing"
fi

# Check 6: Firebase CLI available
if command -v firebase &> /dev/null; then
    echo "✓ Firebase CLI installed"
    ((HEALTH_SCORE++))
else
    echo "⚠ Firebase CLI not found (required for web deployment)"
fi

# Check 7: Xcode available
if command -v xcodebuild &> /dev/null; then
    echo "✓ Xcode toolchain available"
    ((HEALTH_SCORE++))
else
    echo "⚠ Xcode not found (required for iOS builds)"
fi

# Check 8: Git available
if command -v git &> /dev/null; then
    echo "✓ Git installed"
    ((HEALTH_SCORE++))
else
    echo "✗ Git not found"
fi

# Check 9: GitHub CLI (optional but recommended)
if command -v gh &> /dev/null; then
    echo "✓ GitHub CLI installed (PR automation enabled)"
    ((HEALTH_SCORE++))
else
    echo "⚠ GitHub CLI not installed (optional: improves PR automation)"
fi

# Check 10: jq available
if command -v jq &> /dev/null; then
    echo "✓ jq JSON parser available"
    ((HEALTH_SCORE++))
else
    echo "⚠ jq not found (recommended for manifest inspection)"
fi

# Check 11: Node.js available
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✓ Node.js installed ($NODE_VERSION)"
    ((HEALTH_SCORE++))
else
    echo "✗ Node.js not found (required for web builds)"
fi

# Check 12: npm available
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✓ npm installed ($NPM_VERSION)"
    ((HEALTH_SCORE++))
else
    echo "✗ npm not found (required for web builds)"
fi

echo ""
echo "=========================================="
echo "Health Score: $HEALTH_SCORE / $HEALTH_TOTAL"

if [ $HEALTH_SCORE -ge 11 ]; then
    echo "Status: ✓ READY - Build system fully configured"
    exit 0
elif [ $HEALTH_SCORE -ge 8 ]; then
    echo "Status: ⚠ PARTIAL - Some optional tools missing"
    exit 0
else
    echo "Status: ✗ INCOMPLETE - Critical tools missing"
    exit 1
fi
