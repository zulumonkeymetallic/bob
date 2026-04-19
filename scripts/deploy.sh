#!/usr/bin/env bash
set -euo pipefail

PROJECT="bob20250810"

echo "==> Building React app"
pushd react-app >/dev/null
npm ci || npm i
npm run build
popd >/dev/null

echo "==> Preparing functions"
pushd functions >/dev/null
npm ci || npm i
popd >/dev/null

echo "==> Deploying to Firebase (project: ${PROJECT})"
npx firebase deploy --only functions,hosting --project "${PROJECT}"

echo "✅ Deploy complete"
