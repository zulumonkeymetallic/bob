#!/usr/bin/env python3
"""
Debug script to understand BOB login page structure
"""

import json
import time
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from webdriver_manager.firefox import GeckoDriverManager

def debug_login_page():
    """Debug the login page structure"""
    
    # Setup Firefox with headless option
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    
    driver = None
    try:
        print("🔍 Initializing Firefox WebDriver...")
        service = Service(GeckoDriverManager().install())
        driver = webdriver.Firefox(service=service, options=options)
        
        print("🌐 Navigating to BOB application...")
        driver.get("https://bob20250810.web.app")
        time.sleep(5)
        
        print("📄 Page title:", driver.title)
        print("🔗 Current URL:", driver.current_url)
        
        # Try to find login-related elements
        print("\n🔍 Looking for authentication elements...")
        
        # Check for common login selectors
        selectors_to_check = [
            # Email inputs
            "input[type='email']",
            "input[name='email']", 
            "#email",
            "input[placeholder*='email' i]",
            # Password inputs
            "input[type='password']",
            "input[name='password']",
            "#password",
            # Login buttons
            "button[type='submit']",
            "input[type='submit']",
            ".btn-primary",
            "button:contains('Login')",
            "button:contains('Sign')",
            # Google auth
            "[data-testid='google-signin']",
            "button[aria-label*='Google']",
            # Firebase auth
            ".firebaseui-container",
            ".firebaseui-card",
            # Common auth patterns
            ".auth-form",
            ".login-form",
            ".signin-form",
            # Navigation/auth state
            ".sidebar",
            ".user-menu",
            ".navbar",
            ".header"
        ]
        
        found_elements = {}
        for selector in selectors_to_check:
            try:
                if ":contains(" in selector:
                    # Handle XPath for text content
                    if "Login" in selector:
                        elements = driver.find_elements(By.XPATH, "//button[contains(text(), 'Login')]")
                    elif "Sign" in selector:
                        elements = driver.find_elements(By.XPATH, "//button[contains(text(), 'Sign')]")
                    else:
                        elements = []
                else:
                    elements = driver.find_elements(By.CSS_SELECTOR, selector)
                
                if elements:
                    found_elements[selector] = len(elements)
                    print(f"  ✅ Found {len(elements)} element(s) for: {selector}")
                    
                    # Get more details for first element
                    first_element = elements[0]
                    try:
                        tag = first_element.tag_name
                        text = first_element.text[:50] if first_element.text else ""
                        displayed = first_element.is_displayed()
                        enabled = first_element.is_enabled()
                        print(f"     📋 Tag: {tag}, Text: '{text}', Visible: {displayed}, Enabled: {enabled}")
                    except:
                        pass
                        
            except Exception as e:
                pass
        
        if not found_elements:
            print("  ❌ No authentication elements found")
        
        # Get page source sample
        print("\n📄 Page source sample (first 500 chars):")
        page_source = driver.page_source
        print(page_source[:500] + "..." if len(page_source) > 500 else page_source)
        
        # Check for Firebase or authentication indicators in source
        auth_keywords = ["firebase", "auth", "login", "signin", "google", "email", "password"]
        print("\n🔍 Authentication keywords in page source:")
        for keyword in auth_keywords:
            count = page_source.lower().count(keyword)
            if count > 0:
                print(f"  📍 '{keyword}': {count} occurrences")
        
        # Try side-door authentication
        print("\n🚪 Testing side-door authentication...")
        test_url = "https://bob20250810.web.app?test-login=debug-token&test-mode=true"
        driver.get(test_url)
        time.sleep(5)
        
        print("🔗 Side-door URL:", driver.current_url)
        print("📄 Side-door title:", driver.title)
        
        # Check for authenticated state indicators
        auth_indicators = [
            ".sidebar", ".user-menu", ".navbar", ".header",
            "[data-testid='sidebar']", "[data-testid='user-menu']",
            ".auth-user-name", ".user-display"
        ]
        
        print("🔍 Checking for authenticated state indicators...")
        for indicator in auth_indicators:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, indicator)
                if elements:
                    print(f"  ✅ Found authenticated indicator: {indicator}")
            except:
                pass
        
        # Save screenshot for visual debugging
        try:
            screenshot_file = "./test-results/debug_login_structure.png"
            driver.save_screenshot(screenshot_file)
            print(f"📸 Screenshot saved: {screenshot_file}")
        except Exception as e:
            print(f"📸 Screenshot failed: {e}")
        
        return found_elements
        
    except Exception as e:
        print(f"❌ Debug failed: {e}")
        return {}
        
    finally:
        if driver:
            driver.quit()
            print("🧹 Browser cleaned up")

if __name__ == "__main__":
    print("🐛 BOB Login Page Structure Debug")
    print("=" * 50)
    
    results = debug_login_page()
    
    print("\n📊 Debug Results Summary:")
    if results:
        print(f"  ✅ Found {len(results)} element types")
        for selector, count in results.items():
            print(f"    - {selector}: {count} elements")
    else:
        print("  ❌ No authentication elements detected")
        print("  💡 This suggests the app may use dynamic loading or custom auth")
    
    print("\n🎯 Next Steps:")
    print("  1. Check the screenshot for visual confirmation")
    print("  2. Review page source for dynamic auth loading")  
    print("  3. Consider implementing wait strategies for dynamic content")
