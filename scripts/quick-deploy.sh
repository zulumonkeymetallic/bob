#!/usr/bin/env bash
set -euo pipefail

# Quick deploy without version bump - just build and deploy current code
PROJECT_ID="${1:-bob20250810}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 Quick Deploy (no version bump)"
echo "================================="

# Build
echo "Building React app..."
cd "${ROOT_DIR}/react-app"
npm run build
cd "${ROOT_DIR}"

# Deploy hosting only (fastest)
echo "Deploying to Firebase..."
firebase deploy --project "${PROJECT_ID}" --only hosting

echo "✅ Quick deploy complete"
echo "Site: https://bob.jc1.tech"
