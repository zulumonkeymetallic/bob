#!/usr/bin/env python3
"""
Quick diagnostic test to understand the authentication issue
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.service import Service
from webdriver_manager.firefox import GeckoDriverManager
import time

def quick_diagnostic():
    print("🔍 Running quick diagnostic...")
    
    # Setup Firefox
    options = webdriver.FirefoxOptions()
    options.add_argument('--headless')
    service = Service(GeckoDriverManager().install())
    driver = webdriver.Firefox(service=service, options=options)
    
    try:
        # Navigate to BOB
        test_url = "https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true"
        print(f"📍 Navigating to: {test_url}")
        driver.get(test_url)
        
        # Wait a bit for page load
        time.sleep(5)
        
        # Check page title
        print(f"📄 Page title: {driver.title}")
        print(f"📍 Current URL: {driver.current_url}")
        
        # Check for test mode indicator
        try:
            test_indicators = driver.find_elements(By.XPATH, "//*[contains(text(), '🧪') or contains(text(), 'test')]")
            print(f"🧪 Test indicators found: {len(test_indicators)}")
            for indicator in test_indicators[:3]:
                print(f"   - {indicator.text[:100]}")
        except Exception as e:
            print(f"❌ Error finding test indicators: {e}")
        
        # Check authentication state
        try:
            auth_script = """
            return {
                firebase_auth: typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null,
                user_exists: document.querySelector('[data-user-id]') ? true : false,
                access_token: localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken'),
                page_ready: document.readyState,
                body_classes: document.body.className,
                url_params: window.location.search
            };
            """
            auth_state = driver.execute_script(auth_script)
            print(f"🔐 Authentication state:")
            for key, value in auth_state.items():
                print(f"   - {key}: {value}")
        except Exception as e:
            print(f"❌ Error checking auth state: {e}")
        
        # Look for common elements
        common_selectors = [
            "button",
            "[data-testid]", 
            ".btn",
            "a[href*='dashboard']",
            "[class*='quick']",
            "[class*='action']"
        ]
        
        for selector in common_selectors:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    print(f"🎯 Found {len(elements)} elements for '{selector}'")
                    for elem in elements[:3]:
                        text = elem.text.strip()[:50] if elem.text else elem.get_attribute('class')[:50]
                        print(f"   - {text}")
            except Exception as e:
                print(f"❌ Error with selector '{selector}': {e}")
        
        # Save screenshot
        screenshot_path = "./test-results/diagnostic_screenshot.png"
        driver.save_screenshot(screenshot_path)
        print(f"📸 Screenshot saved: {screenshot_path}")
        
    finally:
        driver.quit()
        print("✅ Diagnostic complete")

if __name__ == "__main__":
    quick_diagnostic()
