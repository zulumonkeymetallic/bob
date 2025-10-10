#!/usr/bin/env bash
set -euo pipefail

# Full deploy: Functions (Gen2), Hosting, Firestore rules, Storage rules.
# Usage: scripts/deploy-full.sh [PROJECT_ID]

PROJECT_ID="${1:-bob20250810}"
# Resolve repo root regardless of where this script is executed from
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Project: ${PROJECT_ID}"

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI not found. Install via: npm i -g firebase-tools" >&2
  exit 1
fi

echo "\n==> Ensuring Firebase CLI auth/project"
firebase projects:list >/dev/null 2>&1 || firebase login
firebase use "${PROJECT_ID}" --add || true

echo "\n==> Installing dependencies (functions)"
(cd "${ROOT_DIR}/functions" && npm ci --no-fund --no-audit)

echo "\n==> Building web app (react-app)"
(cd "${ROOT_DIR}/react-app" && npm ci --no-fund --no-audit && npm run build)

echo "\n==> Pre-flight secrets check (Google Calendar)"
firebase functions:secrets:list --project "${PROJECT_ID}" || true
echo "If GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are missing, set them and re-run:" >&2
echo "  firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID --project ${PROJECT_ID}" >&2
echo "  firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET --project ${PROJECT_ID}" >&2

echo "\n==> Deploying Firestore & Storage rules"
firebase deploy --project "${PROJECT_ID}" --only firestore:rules,storage

echo "\n==> Deploying Functions (this can take a few minutes)"
firebase deploy --project "${PROJECT_ID}" --only functions

echo "\n==> Deploying Hosting"
firebase deploy --project "${PROJECT_ID}" --only hosting

echo "\n✅ Deployment complete"
