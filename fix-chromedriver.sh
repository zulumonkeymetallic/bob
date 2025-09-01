#!/bin/bash

# Quick fix for ChromeDriver version mismatch
echo "🔧 Fixing ChromeDriver version issue..."

# Option 1: Try to remove old chromedriver from PATH (requires admin)
if [ -f "/usr/local/bin/chromedriver" ]; then
    echo "⚠️  Found old ChromeDriver at /usr/local/bin/chromedriver"
    echo "💡 Temporarily renaming it so webdriver-manager can use the correct version"
    
    # Try to move it without sudo first
    if mv /usr/local/bin/chromedriver /usr/local/bin/chromedriver.backup.$(date +%s) 2>/dev/null; then
        echo "✅ Successfully moved old ChromeDriver"
    else
        echo "❌ Cannot move old ChromeDriver (permission denied)"
        echo "🔄 Will try to run with Firefox instead"
    fi
fi

# Option 2: Force clear webdriver-manager cache and run with Firefox
echo "🔄 Clearing webdriver-manager cache..."
rm -rf ~/.wdm 2>/dev/null || echo "No cache to clear"

echo "🦊 Running Selenium test with Firefox (more reliable)..."
python3 selenium_virtual_browser_test.py --browser firefox --visible

echo "🎯 If Firefox test succeeds, you can also try:"
echo "   python3 selenium_virtual_browser_test.py --browser chrome"
echo "   (webdriver-manager should now download the correct ChromeDriver)"
