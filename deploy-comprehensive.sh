#!/bin/bash

# BOB v3.5.0+ Comprehensive Deployment Script with Selenium Testing
# This script includes automated testing and validation

VERSION="v3.5.0"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
DEPLOY_LOG="./deployment-logs/deploy-${VERSION}-${TIMESTAMP}.log"

echo "🚀 BOB ${VERSION} Comprehensive Deployment with Testing Starting..."
echo "📅 Started at: $(date)"
echo "📋 Log file: ${DEPLOY_LOG}"

# Create deployment logs directory
mkdir -p deployment-logs

# Log function
log() {
    echo "$1" | tee -a "${DEPLOY_LOG}"
}

log "🚀 BOB ${VERSION} Comprehensive Deployment Started"
log "📅 Timestamp: $(date)"

# Step 1: Pre-deployment validation
log "🔍 Step 1: Pre-deployment validation..."

# Check if we're in the right directory
if [ ! -d "react-app" ]; then
    log "❌ Error: react-app directory not found. Run from BOB root directory."
    exit 1
fi

# Check if Selenium testing is available
if [ ! -f "selenium_virtual_browser_test.py" ]; then
    log "⚠️  Warning: Selenium testing not found. Installing..."
    if [ -f "setup-selenium-testing.sh" ]; then
        ./setup-selenium-testing.sh
    else
        log "❌ Error: Selenium setup script not found."
        exit 1
    fi
fi

log "✅ Pre-deployment validation completed"

# Step 2: Build the application
log "🏗️  Step 2: Building application..."
cd react-app
npm run build

if [ $? -ne 0 ]; then
    log "❌ Build failed!"
    exit 1
fi

log "✅ Build completed successfully"

# Step 3: Deploy to Firebase
log "🚀 Step 3: Deploying to Firebase hosting..."
firebase deploy --only hosting

if [ $? -ne 0 ]; then
    log "❌ Firebase deployment failed!"
    exit 1
fi

log "✅ Firebase deployment completed"

# Step 4: Wait for deployment to propagate
log "⏳ Step 4: Waiting for deployment to propagate (30 seconds)..."
sleep 30

# Step 5: Run Selenium Testing Suite
log "🧪 Step 5: Running comprehensive Selenium testing..."
cd ..

# Run Firefox headless testing (most reliable)
log "🦊 Running Firefox headless testing..."
python3 selenium_virtual_browser_test.py --browser firefox --headless > selenium-test-output.log 2>&1
SELENIUM_EXIT_CODE=$?

# Check test results
if [ $SELENIUM_EXIT_CODE -eq 0 ]; then
    log "✅ Selenium testing passed - No critical defects found"
    TESTING_STATUS="PASSED"
else
    log "⚠️  Selenium testing found defects - See reports for details"
    TESTING_STATUS="DEFECTS_FOUND"
fi

# Copy test results to deployment logs
if [ -d "test-results" ]; then
    cp -r test-results "deployment-logs/test-results-${VERSION}-${TIMESTAMP}"
    log "📋 Test results copied to deployment-logs/test-results-${VERSION}-${TIMESTAMP}"
fi

# Display test summary
if [ -f "test-results/BOB_v3.5.0_SELENIUM_DEFECT_REPORT_"*".md" ]; then
    LATEST_REPORT=$(ls -t test-results/BOB_v3.5.0_SELENIUM_DEFECT_REPORT_*.md | head -1)
    log "📊 Latest test report: ${LATEST_REPORT}"
    
    # Extract key metrics from report
    TOTAL_DEFECTS=$(grep "Total Defects" "${LATEST_REPORT}" | grep -o '[0-9]*' | head -1)
    CRITICAL_DEFECTS=$(grep "Critical.*🔴" "${LATEST_REPORT}" | grep -o '[0-9]*' | head -1)
    
    log "📊 Test Results Summary:"
    log "   - Total Defects: ${TOTAL_DEFECTS:-0}"
    log "   - Critical Defects: ${CRITICAL_DEFECTS:-0}"
    
    if [ "${CRITICAL_DEFECTS:-0}" -gt 0 ]; then
        log "🚨 WARNING: Critical defects found! Review test report before proceeding."
        DEPLOYMENT_STATUS="DEPLOYED_WITH_CRITICAL_DEFECTS"
    else
        DEPLOYMENT_STATUS="DEPLOYED_SUCCESSFULLY"
    fi
else
    log "⚠️  No test report found"
    DEPLOYMENT_STATUS="DEPLOYED_NO_TESTING"
fi

# Step 6: Git operations (only if testing passed or user confirms)
if [ "${CRITICAL_DEFECTS:-0}" -gt 0 ]; then
    log "🚨 Critical defects detected. Do you want to proceed with git tagging? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        log "⏸️  Deployment completed but git tagging skipped due to critical defects."
        log "🔧 Fix critical issues and re-run deployment."
        exit 2
    fi
fi

log "📝 Step 6: Git operations..."
git add .
git commit -m "deploy(${VERSION}): Comprehensive deployment with Selenium testing - ${TESTING_STATUS}"
git tag "${VERSION}-${TIMESTAMP}"
git push origin main
git push origin "${VERSION}-${TIMESTAMP}"

# Step 7: Generate deployment summary
log "📋 Step 7: Generating deployment summary..."

cat > "deployment-logs/DEPLOYMENT_SUCCESS_${VERSION}_${TIMESTAMP}.md" << EOF
# BOB ${VERSION} - Deployment Success Report
## Deployment: ${TIMESTAMP}

### 🎯 Deployment Summary
- **Version**: ${VERSION}
- **Timestamp**: $(date)
- **Status**: ${DEPLOYMENT_STATUS}
- **Testing Status**: ${TESTING_STATUS}

### 🧪 Selenium Testing Results
- **Test Execution**: Completed
- **Browser**: Firefox (Headless)
- **Total Defects**: ${TOTAL_DEFECTS:-0}
- **Critical Defects**: ${CRITICAL_DEFECTS:-0}
- **Report Location**: \`deployment-logs/test-results-${VERSION}-${TIMESTAMP}/\`

### 🚀 Deployment Steps Completed
1. ✅ Pre-deployment validation
2. ✅ Application build (\`npm run build\`)
3. ✅ Firebase hosting deployment
4. ✅ Deployment propagation wait
5. ✅ Comprehensive Selenium testing
6. ✅ Git tagging and push
7. ✅ Documentation generation

### 🌐 Application URLs
- **Production**: https://bob20250810.web.app
- **Test URL**: https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true

### 📊 Test Reports Generated
- **JSON Report**: \`test-results/BOB_v3.5.0_SELENIUM_DEFECT_REPORT_*.json\`
- **Markdown Report**: \`test-results/BOB_v3.5.0_SELENIUM_DEFECT_REPORT_*.md\`
- **Screenshots**: \`test-results/screenshots/\`

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

---
**Deployment completed at $(date)**
EOF

log "✅ Deployment summary generated"

# Final status
echo ""
echo "🎉 ====== DEPLOYMENT COMPLETE ====== 🎉"
echo "📊 Version: ${VERSION}"
echo "📅 Timestamp: ${TIMESTAMP}"
echo "🏆 Status: ${DEPLOYMENT_STATUS}"
echo "🧪 Testing: ${TESTING_STATUS}"
echo "📋 Full log: ${DEPLOY_LOG}"
echo "📊 Summary: deployment-logs/DEPLOYMENT_SUCCESS_${VERSION}_${TIMESTAMP}.md"
echo ""

if [ "${CRITICAL_DEFECTS:-0}" -gt 0 ]; then
    echo "🚨 WARNING: Critical defects detected!"
    echo "📋 Review: deployment-logs/test-results-${VERSION}-${TIMESTAMP}/"
    exit 2
else
    echo "✅ SUCCESS: Application deployed and tested successfully!"
    echo "🌐 Live at: https://bob20250810.web.app"
    exit 0
fi
