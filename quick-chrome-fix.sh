#!/bin/bash

echo "🔧 Quick ChromeDriver Fix..."

# Check Chrome version
echo "🔍 Chrome version:"
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version

# Check current chromedriver version if it exists
if command -v chromedriver &> /dev/null; then
    echo "📦 Current ChromeDriver version:"
    chromedriver --version
fi

# Clear webdriver-manager cache to force fresh download
echo "🧹 Clearing webdriver-manager cache..."
rm -rf ~/.wdm 2>/dev/null || true

# Test if we can move the old chromedriver
if [ -f "/usr/local/bin/chromedriver" ]; then
    echo "⚠️  Found old ChromeDriver at /usr/local/bin/chromedriver"
    if mv "/usr/local/bin/chromedriver" "/usr/local/bin/chromedriver.old.$(date +%s)" 2>/dev/null; then
        echo "✅ Successfully renamed old ChromeDriver"
    else
        echo "❌ Cannot rename old ChromeDriver - will try to work around it"
    fi
fi

# Try the test with visible Chrome first for debugging
echo "🚀 Testing with visible Chrome browser..."
python3 selenium_virtual_browser_test.py --browser chrome --visible
