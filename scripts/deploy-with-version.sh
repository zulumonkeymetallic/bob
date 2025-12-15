#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_ID="${1:-bob20250810}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/..\" && pwd)"
SITE_URL="https://bob.jc1.tech"

echo -e "${BLUE}🚀 BOB Deployment Script with Version Management${NC}"
echo -e "${BLUE}=================================================${NC}\n"

# 1. Check for uncommitted changes
echo -e "${YELLOW}[1/15] Checking for uncommitted changes...${NC}"
if ! git diff-index --quiet HEAD --; then
  echo -e "${RED}⚠️  Warning: You have uncommitted changes${NC}"
  git status --short
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 2. Validate version alignment
echo -e "${YELLOW}[2/15] Validating version alignment...${NC}"
node "${ROOT_DIR}/scripts/check-version-alignment.js" || {
  echo -e "${RED}❌ Version mismatch detected. Run: node scripts/sync-version.js${NC}"
  exit 1
}

# 3. Confirm branch
echo -e "${YELLOW}[3/15] Checking current branch...${NC}"
CURRENT_BRANCH=$(git branch --show-current)
echo -e "Current branch: ${GREEN}${CURRENT_BRANCH}${NC}"

# 4. Pull latest changes
echo -e "${YELLOW}[4/15] Pulling latest changes...${NC}"
git pull origin "${CURRENT_BRANCH}" || true

# 5-8. Version management
echo -e "\n${YELLOW}[5/15] Version Management${NC}"
CURRENT_VERSION=$(node -p "require('${ROOT_DIR}/react-app/package.json').version")
echo -e "Current version: ${GREEN}${CURRENT_VERSION}${NC}"
echo -e "\nSelect version bump type:"
echo "  1) patch (X.Y.Z+1)"
echo "  2) minor (X.Y+1.0)"
echo "  3) major (X+1.0.0)"
echo "  4) manual (enter custom version)"
echo "  5) skip (deploy current version)"
read -p "Choice [1-5]: " VERSION_CHOICE

if [[ "$VERSION_CHOICE" != "5" ]]; then
  case $VERSION_CHOICE in
    1) BUMP_TYPE="patch" ;;
    2) BUMP_TYPE="minor" ;;
    3) BUMP_TYPE="major" ;;
    4) 
      read -p "Enter new version: " NEW_VERSION
      BUMP_TYPE=""
      ;;
    *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
  esac

  # Bump version
  cd "${ROOT_DIR}/react-app"
  if [[ -n "$BUMP_TYPE" ]]; then
    npm version "$BUMP_TYPE" --no-git-tag-version
  else
    npm version "$NEW_VERSION" --no-git-tag-version
  fi
  NEW_VERSION=$(node -p "require('./package.json').version")
  cd "${ROOT_DIR}"

  # Sync version
  node "${ROOT_DIR}/scripts/sync-version.js"

  # Update BUILD_HASH
  read -p "Enter build description (e.g., 'navigation-fix'): " BUILD_DESC
  BUILD_HASH="${BUILD_DESC}-${NEW_VERSION}"
  sed -i.bak "s/export const BUILD_HASH = .*/export const BUILD_HASH = '${BUILD_HASH}';/" "${ROOT_DIR}/react-app/src/version.ts"
  rm "${ROOT_DIR}/react-app/src/version.ts.bak"

  # 9-11. Git operations
  echo -e "${YELLOW}[9/15] Committing version changes...${NC}"
  git add react-app/package.json react-app/src/version.ts
  git commit -m "chore: bump version to ${NEW_VERSION}"

  echo -e "${YELLOW}[10/15] Creating Git tag...${NC}"
  git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"

  echo -e "${YELLOW}[11/15] Pushing to remote...${NC}"
  git push origin "${CURRENT_BRANCH}"
  git push origin "v${NEW_VERSION}"
else
  NEW_VERSION="$CURRENT_VERSION"
  BUILD_HASH=$(grep "export const BUILD_HASH" "${ROOT_DIR}/react-app/src/version.ts" | sed -E "s/.*'(.*)'.*/\1/")
fi

# 12. Build
echo -e "\n${YELLOW}[12/15] Building React app...${NC}"
cd "${ROOT_DIR}/react-app"
npm ci --no-fund --no-audit
npm run build
cd "${ROOT_DIR}"

# 13. Deploy
echo -e "${YELLOW}[13/15] Deploying to Firebase...${NC}"
firebase deploy --project "${PROJECT_ID}" --only hosting,functions,firestore:rules,storage

# 14. Record deployment
echo -e "${YELLOW}[14/15] Recording deployment...${NC}"
DEPLOY_RECORD=$(cat <<EOF
{
  "version": "${NEW_VERSION}",
  "buildHash": "${BUILD_HASH}",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "gitCommit": "$(git rev-parse --short HEAD)",
  "gitBranch": "${CURRENT_BRANCH}",
  "deployedBy": "$(git config user.name)"
}
EOF
)
echo "$DEPLOY_RECORD" | jq . >> "${ROOT_DIR}/deployment_history.json"

# 15. Verify deployment
echo -e "\n${YELLOW}[15/15] Verifying deployment...${NC}"
sleep 5  # Wait for CDN propagation
DEPLOYED_VERSION=$(curl -s "${SITE_URL}/version.json" | jq -r '.version')
if [[ "$DEPLOYED_VERSION" == "$NEW_VERSION" ]]; then
  echo -e "${GREEN}✅ Deployment verified!${NC}"
else
  echo -e "${RED}⚠️  Version mismatch: deployed=${DEPLOYED_VERSION}, expected=${NEW_VERSION}${NC}"
fi

# Summary
echo -e "\n${GREEN}=================================================${NC}"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${GREEN}=================================================${NC}"
echo -e "Version: ${GREEN}${NEW_VERSION}${NC}"
echo -e "Build Hash: ${GREEN}${BUILD_HASH}${NC}"
echo -e "Site: ${BLUE}${SITE_URL}${NC}"
echo -e "Version Info: ${BLUE}${SITE_URL}/version.json${NC}"
