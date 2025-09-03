#!/bin/bash
# BOB v3.5.0 - Selenium Virtual Browser Testing Setup Script

echo "🚀 Setting up BOB v3.5.0 Selenium Virtual Browser Testing..."

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed"
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"

# Install Python requirements
echo "📦 Installing Python requirements..."
pip3 install -r requirements-selenium.txt

# Check if Chrome is installed (for ChromeDriver)
if command -v google-chrome &> /dev/null || command -v chromium-browser &> /dev/null; then
    echo "✅ Chrome/Chromium browser found"
elif command -v chrome &> /dev/null; then
    echo "✅ Chrome browser found"
else
    echo "⚠️  Chrome browser not found - you may need to install it for optimal testing"
fi

# Make the test script executable
chmod +x selenium_virtual_browser_test.py

echo ""
echo "🎉 Setup complete! You can now run the tests:"
echo ""
echo "Basic usage:"
echo "  python3 selenium_virtual_browser_test.py"
echo ""
echo "Advanced usage:"
echo "  python3 selenium_virtual_browser_test.py --browser chrome --visible"
echo "  python3 selenium_virtual_browser_test.py --browser firefox --headless"
echo ""
echo "Available options:"
echo "  --browser [chrome|firefox|edge]  (default: chrome)"
echo "  --headless                       (run in background, default)"
echo "  --visible                        (show browser window)"
echo ""
echo "Output files will be generated in:"
echo "  ./test-results/BOB_v3.5.0_SELENIUM_DEFECT_REPORT_*.json"
echo "  ./test-results/BOB_v3.5.0_SELENIUM_DEFECT_REPORT_*.md"
echo "  ./test-results/screenshots/*.png"
echo ""
echo "🎯 Ready to test BOB v3.5.0 with automated defect detection!"
