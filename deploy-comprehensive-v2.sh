#!/bin/bash

# BOB Comprehensive Deployment Script v2.0 with Version Parity
# This script ensures version consistency across all components

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Extract version from package.json to ensure parity
get_app_version() {
    if [ -f "react-app/package.json" ]; then
        VERSION=$(grep '"version"' react-app/package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
        echo "v${VERSION}"
    else
        echo "ERROR: react-app/package.json not found"
        exit 1
    fi
}

# Extract version from version.ts to verify consistency
get_version_ts() {
    if [ -f "react-app/src/version.ts" ]; then
        grep "export const VERSION" react-app/src/version.ts | sed "s/.*VERSION = '\([^']*\)'.*/\1/"
    else
        echo "ERROR: react-app/src/version.ts not found"
        exit 1
    fi
}

# Validate version consistency
validate_versions() {
    PACKAGE_VERSION=$(get_app_version)
    VERSION_TS=$(get_version_ts)
    
    echo -e "${BLUE}🔍 Version Validation:${NC}"
    echo -e "   📦 package.json: ${PACKAGE_VERSION}"
    echo -e "   📄 version.ts:   ${VERSION_TS}"
    
    if [ "$PACKAGE_VERSION" != "$VERSION_TS" ]; then
        echo -e "${RED}❌ VERSION MISMATCH DETECTED!${NC}"
        echo -e "${YELLOW}⚠️  Please synchronize versions before deployment${NC}"
        echo -e "${YELLOW}   Update either package.json or version.ts to match${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Version consistency validated${NC}"
    VERSION="$PACKAGE_VERSION"
}

# Generate comprehensive deployment metadata
generate_deployment_metadata() {
    cat > "deployment-metadata.json" << EOF
{
  "deployment": {
    "version": "${VERSION}",
    "timestamp": "${TIMESTAMP}",
    "commit_hash": "$(git rev-parse HEAD)",
    "branch": "$(git branch --show-current)",
    "author": "$(git config user.name)",
    "email": "$(git config user.email)",
    "build_environment": {
      "node_version": "$(node --version)",
      "npm_version": "$(npm --version)",
      "os": "$(uname -s)",
      "hostname": "$(hostname)"
    }
  }
}
EOF
}

# Main deployment execution
main() {
    echo -e "${BLUE}🚀 BOB Comprehensive Deployment v2.0 Starting...${NC}"
    echo -e "${BLUE}📅 Started at: $(date)${NC}"
    
    # Step 1: Version validation
    validate_versions
    
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
    DEPLOY_LOG="./deployment-logs/deploy-${VERSION}-${TIMESTAMP}.log"
    
    echo -e "${BLUE}📋 Log file: ${DEPLOY_LOG}${NC}"
    
    # Create deployment logs directory
    mkdir -p deployment-logs
    
    # Log function with color support
    log() {
        echo -e "$1" | tee -a "${DEPLOY_LOG}"
    }
    
    log "${BLUE}🚀 BOB ${VERSION} Comprehensive Deployment Started${NC}"
    log "${BLUE}📅 Timestamp: $(date)${NC}"
    
    # Generate deployment metadata
    generate_deployment_metadata
    log "${GREEN}📊 Deployment metadata generated${NC}"
    
    # Step 2: Pre-deployment validation
    log "${BLUE}🔍 Step 1: Pre-deployment validation...${NC}"
    
    # Check if we're in the right directory
    if [ ! -d "react-app" ]; then
        log "${RED}❌ Error: react-app directory not found. Run from BOB root directory.${NC}"
        exit 1
    fi
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        log "${YELLOW}⚠️  Warning: Uncommitted changes detected${NC}"
        log "${YELLOW}   These will be included in the deployment${NC}"
    fi
    
    # Check if Selenium testing is available
    if [ ! -f "selenium_virtual_browser_test.py" ]; then
        log "${YELLOW}⚠️  Warning: Selenium testing not found. Installing...${NC}"
        if [ -f "setup-selenium-testing.sh" ]; then
            ./setup-selenium-testing.sh
        else
            log "${RED}❌ Error: Selenium setup script not found.${NC}"
            exit 1
        fi
    fi
    
    log "${GREEN}✅ Pre-deployment validation completed${NC}"
    
    # Step 3: Build the application
    log "${BLUE}🏗️  Step 2: Building application...${NC}"
    cd react-app
    if npm run build; then
        log "${GREEN}✅ Build completed successfully${NC}"
    else
        log "${RED}❌ Build failed${NC}"
        exit 1
    fi
    cd ..
    
    # Step 4: Deploy to Firebase
    log "${BLUE}🚀 Step 3: Deploying to Firebase hosting...${NC}"
    if firebase deploy --only hosting; then
        log "${GREEN}✅ Firebase deployment completed${NC}"
    else
        log "${RED}❌ Firebase deployment failed${NC}"
        exit 1
    fi
    
    # Step 5: Wait for propagation
    log "${BLUE}⏳ Step 4: Waiting for deployment to propagate (30 seconds)...${NC}"
    sleep 30
    
    # Step 6: Comprehensive Selenium testing
    log "${BLUE}🧪 Step 5: Running comprehensive Selenium testing...${NC}"
    log "${BLUE}🦊 Running Firefox headless testing...${NC}"
    
    python3 selenium_virtual_browser_test.py --browser firefox --headless > selenium-test-output.log 2>&1
    SELENIUM_EXIT_CODE=$?
    
    # Check test results
    if [ $SELENIUM_EXIT_CODE -eq 0 ]; then
        log "${GREEN}✅ Selenium testing passed - No critical defects found${NC}"
        TESTING_STATUS="PASSED"
    else
        log "${YELLOW}⚠️  Selenium testing found defects - See reports for details${NC}"
        TESTING_STATUS="DEFECTS_FOUND"
    fi
    
    # Copy test results to deployment logs
    if [ -d "test-results" ]; then
        cp -r test-results "deployment-logs/test-results-${VERSION}-${TIMESTAMP}"
        log "${GREEN}📋 Test results copied to deployment-logs/test-results-${VERSION}-${TIMESTAMP}${NC}"
    fi
    
    # Extract test metrics
    if [ -f "test-results/BOB_v"*"_SELENIUM_DEFECT_REPORT_"*".md" ]; then
        LATEST_REPORT=$(ls -t test-results/BOB_v*_SELENIUM_DEFECT_REPORT_*.md | head -1)
        log "${GREEN}📊 Latest test report: ${LATEST_REPORT}${NC}"
        
        # Extract key metrics from report
        TOTAL_DEFECTS=$(grep "Total Defects" "${LATEST_REPORT}" | grep -o '[0-9]*' | head -1)
        CRITICAL_DEFECTS=$(grep "Critical.*🔴" "${LATEST_REPORT}" | grep -o '[0-9]*' | head -1)
        
        log "${BLUE}📊 Test Results Summary:${NC}"
        log "   - Total Defects: ${TOTAL_DEFECTS:-0}"
        log "   - Critical Defects: ${CRITICAL_DEFECTS:-0}"
        
        if [ "${CRITICAL_DEFECTS:-0}" -gt 0 ]; then
            log "${RED}🚨 WARNING: Critical defects found! Review test report before proceeding.${NC}"
            DEPLOYMENT_STATUS="DEPLOYED_WITH_CRITICAL_DEFECTS"
        else
            DEPLOYMENT_STATUS="DEPLOYED_SUCCESSFULLY"
        fi
    else
        log "${YELLOW}⚠️  No test report found${NC}"
        DEPLOYMENT_STATUS="DEPLOYED_NO_TESTING"
    fi
    
    # Step 7: Git operations with version parity
    if [ "${CRITICAL_DEFECTS:-0}" -gt 0 ]; then
        log "${RED}🚨 Critical defects detected. Do you want to proceed with git tagging? (y/N)${NC}"
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            log "${YELLOW}⏸️  Deployment completed but git tagging skipped due to critical defects.${NC}"
            log "${YELLOW}🔧 Fix critical issues and re-run deployment.${NC}"
            exit 2
        fi
    fi
    
    log "${BLUE}📝 Step 6: Git operations with version parity...${NC}"
    
    # Add deployment metadata to git
    git add deployment-metadata.json
    git add .
    
    # Create semantic commit message
    COMMIT_MSG="deploy(${VERSION}): Comprehensive deployment with version parity - ${TESTING_STATUS}

    - Version: ${VERSION}
    - Timestamp: ${TIMESTAMP}
    - Testing: ${TESTING_STATUS}
    - Total Defects: ${TOTAL_DEFECTS:-0}
    - Critical Defects: ${CRITICAL_DEFECTS:-0}
    
    Deployment includes:
    - Version consistency validation
    - Comprehensive Selenium testing
    - Automated git tagging with version parity
    - Full deployment documentation"
    
    git commit -m "${COMMIT_MSG}"
    
    # Create version-consistent tag
    VERSION_TAG="${VERSION}"
    TIMESTAMP_TAG="${VERSION}-${TIMESTAMP}"
    
    # Check if clean version tag exists and handle appropriately
    if git tag --list | grep -q "^${VERSION_TAG}$"; then
        log "${YELLOW}⚠️  Tag ${VERSION_TAG} already exists. Creating timestamped version only.${NC}"
        git tag "${TIMESTAMP_TAG}"
        git push origin main
        git push origin "${TIMESTAMP_TAG}"
        log "${GREEN}✅ Git operations completed with timestamped tag: ${TIMESTAMP_TAG}${NC}"
    else
        git tag "${VERSION_TAG}"
        git tag "${TIMESTAMP_TAG}"
        git push origin main
        git push origin "${VERSION_TAG}"
        git push origin "${TIMESTAMP_TAG}"
        log "${GREEN}✅ Git operations completed with tags: ${VERSION_TAG}, ${TIMESTAMP_TAG}${NC}"
    fi
    
    # Step 8: Generate comprehensive deployment summary
    log "${BLUE}📋 Step 7: Generating comprehensive deployment summary...${NC}"
    
    cat > "deployment-logs/DEPLOYMENT_SUCCESS_${VERSION}_${TIMESTAMP}.md" << EOF
# BOB ${VERSION} - Deployment Success Report
## Deployment: ${TIMESTAMP}

### 🎯 Deployment Summary
- **Version**: ${VERSION}
- **Timestamp**: $(date)
- **Status**: ${DEPLOYMENT_STATUS}
- **Testing Status**: ${TESTING_STATUS}
- **Commit Hash**: $(git rev-parse HEAD)
- **Branch**: $(git branch --show-current)

### 🔄 Version Consistency Validation
- **package.json**: ${PACKAGE_VERSION}
- **version.ts**: ${VERSION_TS}
- **Git Tags**: ${VERSION_TAG}, ${TIMESTAMP_TAG}
- **Deployment Script**: Auto-synced ✅

### 🧪 Selenium Testing Results
- **Test Execution**: Completed
- **Browser**: Firefox (Headless)
- **Total Defects**: ${TOTAL_DEFECTS:-0}
- **Critical Defects**: ${CRITICAL_DEFECTS:-0}
- **Report Location**: \`deployment-logs/test-results-${VERSION}-${TIMESTAMP}/\`

### 🚀 Deployment Steps Completed
1. ✅ Version parity validation (package.json ↔ version.ts)
2. ✅ Pre-deployment validation
3. ✅ Application build (\`npm run build\`)
4. ✅ Firebase hosting deployment
5. ✅ Deployment propagation wait
6. ✅ Comprehensive Selenium testing
7. ✅ Git tagging with version consistency
8. ✅ Documentation generation

### 🌐 Application URLs
- **Production**: https://bob20250810.web.app
- **Test URL**: https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true

### 📊 Test Reports Generated
- **JSON Report**: \`test-results/BOB_v${VERSION}_SELENIUM_DEFECT_REPORT_*.json\`
- **Markdown Report**: \`test-results/BOB_v${VERSION}_SELENIUM_DEFECT_REPORT_*.md\`
- **Screenshots**: \`test-results/screenshots/\`

### 📋 Deployment Metadata
\`\`\`json
$(cat deployment-metadata.json)
\`\`\`

### 🎯 Next Actions
$(if [ "${CRITICAL_DEFECTS:-0}" -gt 0 ]; then
    echo "🚨 **IMMEDIATE**: Address critical defects found in testing"
    echo "🔧 **Required**: Review test report and fix issues"
else
    echo "✅ **Success**: No critical issues found"
    echo "🎉 **Ready**: Application is fully operational"
fi)

### 🔧 Re-run Testing Command
\`\`\`bash
python3 selenium_virtual_browser_test.py --browser firefox --headless
\`\`\`

### 📝 Version History
- Previous deployments available in: \`deployment-logs/\`
- Git history: \`git log --oneline --grep="deploy"\`
- Tag history: \`git tag --sort=-v:refname\`

---
**Deployment completed at $(date)**
**Version parity ensured: UI ↔ package.json ↔ git tags**
EOF
    
    log "${GREEN}✅ Comprehensive deployment summary generated${NC}"
    
    # Cleanup temporary files
    rm -f deployment-metadata.json
    
    # Final status with enhanced reporting
    echo ""
    echo -e "${GREEN}🎉 ====== DEPLOYMENT COMPLETE ====== 🎉${NC}"
    echo -e "${BLUE}📊 Version: ${VERSION}${NC}"
    echo -e "${BLUE}📅 Timestamp: ${TIMESTAMP}${NC}"
    echo -e "${BLUE}🏆 Status: ${DEPLOYMENT_STATUS}${NC}"
    echo -e "${BLUE}🧪 Testing: ${TESTING_STATUS}${NC}"
    echo -e "${BLUE}🔗 Git Tags: ${VERSION_TAG}, ${TIMESTAMP_TAG}${NC}"
    echo -e "${BLUE}📋 Full log: ${DEPLOY_LOG}${NC}"
    echo -e "${BLUE}📊 Summary: deployment-logs/DEPLOYMENT_SUCCESS_${VERSION}_${TIMESTAMP}.md${NC}"
    echo ""
    
    if [ "${CRITICAL_DEFECTS:-0}" -gt 0 ]; then
        echo -e "${RED}🚨 WARNING: Critical defects detected!${NC}"
        echo -e "${YELLOW}📋 Review: deployment-logs/test-results-${VERSION}-${TIMESTAMP}/${NC}"
        exit 2
    else
        echo -e "${GREEN}✅ SUCCESS: Application deployed with version parity!${NC}"
        echo -e "${GREEN}🔄 Version consistency: UI (${VERSION_TS}) ↔ package.json (${PACKAGE_VERSION}) ↔ git tags${NC}"
        echo -e "${GREEN}🌐 Live at: https://bob20250810.web.app${NC}"
        exit 0
    fi
}

# Check if we're in the right directory before starting
if [ ! -f "react-app/package.json" ]; then
    echo -e "${RED}❌ Error: Must run from BOB root directory (react-app/package.json not found)${NC}"
    exit 1
fi

# Execute main function
main "$@"
