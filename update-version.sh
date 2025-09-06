#!/bin/bash

# Git-based version generator for BOB app
echo "Updating version from git..."

GIT_TAG=$(git describe --tags --always 2>/dev/null || echo "v1.1-dev")
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "Git Tag: $GIT_TAG"
echo "Git Hash: $GIT_HASH"
echo "Branch: $GIT_BRANCH"
echo "Build Time: $BUILD_TIME"

# Update version.ts
cat > react-app/src/version.ts << EOV
// Version tracking for cache busting - Auto-generated from git
export const VERSION = '$GIT_TAG';
export const BUILD_TIME = '$BUILD_TIME';
export const BUILD_HASH = '$GIT_HASH';
export const GIT_BRANCH = '$GIT_BRANCH';

console.log(\`🚀 BOB App loaded - Version: \${VERSION}\`);
console.log(\`✅ Status: UI Consistency & Field Standardization Complete\`);
console.log(\`🎯 Features: Standardized Delete Actions, Consistent Field Layouts\`);
console.log(\`🚀 Architecture: Git-based versioning with modern UI patterns\`);
console.log(\`📅 Build time: \${BUILD_TIME}\`);
console.log(\`🔨 Build hash: \${BUILD_HASH}\`);
EOV

echo "✅ Version file updated successfully!"
