#!/bin/bash

# BOB v3.5.5 - Test Runner (No Deployment)
# Run comprehensive tests without deploying

set -e

echo "🧪 BOB v3.5.5 Test Runner"
echo "========================="
echo "Running comprehensive tests without deployment"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_test() { echo -e "${PURPLE}[TEST]${NC} $1"; }

TESTS_PASSED=0
TESTS_FAILED=0

track_test_result() {
    if [ "$2" = "PASS" ]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        print_success "✅ $1: PASSED"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        print_error "❌ $1: FAILED"
    fi
}

# Check directory
if [ ! -f "firebase.json" ]; then
    print_error "firebase.json not found. Run from project root."
    exit 1
fi

echo "🧪 TEST CHECKLIST"
echo "=================="
echo "1. ✅ TypeScript compilation"
echo "2. ✅ Unit tests"
echo "3. ✅ Build process"
echo "4. ✅ Selenium E2E tests"
echo "5. ✅ Demo user validation"
echo ""

cd react-app

# TypeScript check
print_test "Checking TypeScript compilation..."
if npx tsc --noEmit --skipLibCheck; then
    track_test_result "TypeScript Compilation" "PASS"
else
    track_test_result "TypeScript Compilation" "FAIL"
fi

# Unit tests
print_test "Running unit tests..."
if npm test -- --coverage --silent --watchAll=false; then
    track_test_result "Unit Tests" "PASS"
else
    track_test_result "Unit Tests" "FAIL"
fi

# Build test
print_test "Testing build process..."
if npm run build; then
    if [ -d "build" ] && [ -f "build/index.html" ]; then
        track_test_result "Build Process" "PASS"
    else
        track_test_result "Build Process" "FAIL"
    fi
else
    track_test_result "Build Process" "FAIL"
fi

cd ..

# Selenium tests (if Chrome available)
if command -v google-chrome >/dev/null 2>&1; then
    print_test "Running Selenium E2E tests..."
    
    # Install selenium if needed
    if ! npm list selenium-webdriver >/dev/null 2>&1; then
        npm install selenium-webdriver
    fi
    
    # Create simple Selenium test
    cat > quick-selenium-test.js << 'EOF'
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

(async function quickTest() {
    const options = new chrome.Options();
    options.addArguments('--headless');
    options.addArguments('--no-sandbox');
    
    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    try {
        console.log('🌐 Testing page load...');
        await driver.get('https://bob20250810.web.app');
        await driver.wait(until.titleContains('BOB'), 10000);
        console.log('✅ Page loads successfully');
        
        console.log('🔍 Testing login form...');
        await driver.findElement(By.css('input[type="email"]'));
        console.log('✅ Login form found');
        
        console.log('✅ Quick Selenium test passed');
        
    } catch (error) {
        console.log('❌ Selenium test failed:', error.message);
        process.exit(1);
    } finally {
        await driver.quit();
    }
})();
EOF
    
    if node quick-selenium-test.js; then
        track_test_result "Selenium E2E Tests" "PASS"
    else
        track_test_result "Selenium E2E Tests" "FAIL"
    fi
    
    rm -f quick-selenium-test.js
else
    print_test "Chrome not found - skipping Selenium tests"
fi

# Demo user test
print_test "Validating demo user..."
if node create-demo-user-standalone.js > /dev/null; then
    track_test_result "Demo User Validation" "PASS"
else
    track_test_result "Demo User Validation" "FAIL"
fi

# Results
echo ""
echo "📊 TEST RESULTS SUMMARY"
echo "======================="
echo "✅ Tests Passed: $TESTS_PASSED"
echo "❌ Tests Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    print_success "🎉 ALL TESTS PASSED - Ready for deployment!"
    echo ""
    echo "Run deployment with:"
    echo "  ./comprehensive-deploy-with-testing.sh"
    exit 0
else
    print_error "🚫 $TESTS_FAILED test(s) failed - Fix issues before deployment"
    exit 1
fi
