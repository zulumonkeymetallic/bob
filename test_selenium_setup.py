#!/usr/bin/env python3
"""
Quick test to verify Selenium setup and BOB accessibility
"""

import sys
import time

def test_imports():
    """Test if all required packages can be imported"""
    try:
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.chrome.options import Options
        print("✅ Selenium imports successful")
        return True
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("Run: pip3 install -r requirements-selenium.txt")
        return False

def test_bob_accessibility():
    """Test if BOB platform is accessible"""
    import requests
    
    try:
        response = requests.get('https://bob20250810.web.app', timeout=10)
        if response.status_code == 200:
            print("✅ BOB platform accessible")
            return True
        else:
            print(f"⚠️  BOB platform returned status code: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Cannot reach BOB platform: {e}")
        return False

def test_webdriver():
    """Test if Chrome WebDriver can be initialized"""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        
        options = Options()
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        
        driver = webdriver.Chrome(options=options)
        driver.get('https://www.google.com')
        title = driver.title
        driver.quit()
        
        print("✅ Chrome WebDriver working")
        return True
        
    except Exception as e:
        print(f"❌ WebDriver error: {e}")
        print("Try installing ChromeDriver or use: pip3 install webdriver-manager")
        return False

def main():
    """Run all tests"""
    print("🧪 BOB v3.5.0 Selenium Testing - Setup Verification")
    print("=" * 50)
    
    tests = [
        ("Import Test", test_imports),
        ("BOB Accessibility", test_bob_accessibility),
        ("WebDriver Test", test_webdriver)
    ]
    
    results = []
    for test_name, test_func in tests:
        print(f"\n🔍 Running {test_name}...")
        try:
            result = test_func()
            results.append(result)
        except Exception as e:
            print(f"❌ {test_name} failed: {e}")
            results.append(False)
    
    print("\n" + "=" * 50)
    print("📋 Setup Verification Results:")
    
    for i, (test_name, _) in enumerate(tests):
        status = "✅ PASS" if results[i] else "❌ FAIL"
        print(f"  {test_name}: {status}")
    
    all_passed = all(results)
    
    if all_passed:
        print("\n🎉 All tests passed! Ready to run full Selenium testing:")
        print("   python3 selenium_virtual_browser_test.py")
    else:
        print("\n⚠️  Some tests failed. Please resolve issues before running full test suite.")
        print("   Check the error messages above and run setup-selenium-testing.sh")
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
