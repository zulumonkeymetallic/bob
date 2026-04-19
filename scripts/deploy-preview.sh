#!/usr/bin/env bash
set -euo pipefail

# Build React app and deploy Firebase Hosting preview channel.
# Usage: ./scripts/deploy-preview.sh [channel-id]

PROJECT="bob20250810"
CHANNEL_ID="${1:-preview-$(date +%Y%m%d-%H%M%S)}"

echo "==> Installing deps and building React app"
pushd react-app >/dev/null
npm ci
npm run build
popd >/dev/null

echo "==> Deploying preview channel: ${CHANNEL_ID}"
firebase hosting:channel:deploy "${CHANNEL_ID}" --expires 7d --project "${PROJECT}"

echo "Done. Use the URL above for validation."

