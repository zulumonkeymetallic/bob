#!/usr/bin/env bash
set -euo pipefail

# Manual preview deployment script (no GitHub Actions)
# Usage: scripts/manual-preview.sh [channel-id]
# Requires: firebase CLI logged in with access to project

CHANNEL_ID="${1:-manual-$(date +%Y%m%d-%H%M%S)}"
PROJECT_ID="${FIREBASE_PROJECT_ID:-bob20250810}"

echo "== Generating Firebase client config =="
node "$(dirname "$0")/generate-firebase-config.js"

echo "== Installing & building React app =="
pushd "$(dirname "$0")/../react-app" >/dev/null
npm ci
npm run build
popd >/dev/null

echo "== Deploying to Firebase Hosting preview channel: ${CHANNEL_ID} (project: ${PROJECT_ID}) =="
firebase hosting:channel:deploy "${CHANNEL_ID}" --project "${PROJECT_ID}"

echo "✅ Preview deployed. To list channels:"
echo "   firebase hosting:channel:list --project ${PROJECT_ID}"

