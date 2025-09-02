#!/usr/bin/env python3
"""
Quick test of side-door authentication with a known token
"""

import time
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from webdriver_manager.firefox import GeckoDriverManager

def test_side_door_auth():
    """Test side-door authentication directly"""
    
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    
    driver = None
    try:
        print("🔍 Testing side-door authentication...")
        service = Service(GeckoDriverManager().install())
        driver = webdriver.Firefox(service=service, options=options)
        
        # Test different token formats and URLs
        test_cases = [
            {
                'name': 'Simple test token',
                'url': 'https://bob20250810.web.app?test-login=test123&test-mode=true'
            },
            {
                'name': 'Admin test token',
                'url': 'https://bob20250810.web.app?test-login=admin-test-token&test-mode=true'
            },
            {
                'name': 'AI agent token',
                'url': 'https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true'
            }
        ]
        
        for i, test_case in enumerate(test_cases, 1):
            print(f"\n🧪 Test {i}: {test_case['name']}")
            print(f"🌐 URL: {test_case['url']}")
            
            driver.get(test_case['url'])
            time.sleep(8)
            
            current_url = driver.current_url
            page_title = driver.title
            
            print(f"📍 Result URL: {current_url}")
            print(f"📄 Title: {page_title}")
            
            # Check for authentication indicators
            auth_checks = [
                ('Google Login Button', 'button:contains("Sign in with Google")'),
                ('Sidebar', '.sidebar'),
                ('User Menu', '.user-menu'),
                ('Navbar', '.navbar'),
                ('Main Content', '.main-content'),
                ('Goals Section', '[data-testid="goals"]')
            ]
            
            found_elements = {}
            for check_name, selector in auth_checks:
                try:
                    if ":contains(" in selector:
                        elements = driver.find_elements(By.XPATH, "//button[contains(text(), 'Sign in with Google')]")
                    else:
                        elements = driver.find_elements(By.CSS_SELECTOR, selector)
                    
                    found_elements[check_name] = len(elements)
                    if elements:
                        visible_count = sum(1 for el in elements if el.is_displayed())
                        print(f"  📋 {check_name}: {len(elements)} total, {visible_count} visible")
                except Exception:
                    found_elements[check_name] = 0
            
            # Determine authentication status
            google_login_visible = found_elements.get('Google Login Button', 0) > 0
            has_auth_ui = any(found_elements.get(key, 0) > 0 for key in ['Sidebar', 'User Menu', 'Navbar'])
            
            if google_login_visible:
                print("  ❌ Still showing Google login - not authenticated")
                status = "FAILED"
            elif has_auth_ui:
                print("  ✅ Found authenticated UI elements")
                status = "SUCCESS"
            else:
                print("  ⚠️  Unclear authentication state")
                status = "UNCLEAR"
            
            # Save screenshot
            screenshot_file = f"./test-results/side_door_test_{i}_{status.lower()}.png"
            try:
                driver.save_screenshot(screenshot_file)
                print(f"  📸 Screenshot: {screenshot_file}")
            except Exception as e:
                print(f"  📸 Screenshot failed: {e}")
            
            print(f"  🎯 Status: {status}")
            
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False
        
    finally:
        if driver:
            driver.quit()
            print("\n🧹 Browser cleaned up")

if __name__ == "__main__":
    print("🚪 Side-Door Authentication Test")
    print("=" * 40)
    
    success = test_side_door_auth()
    
    if success:
        print("\n✅ Side-door authentication test completed")
    else:
        print("\n❌ Side-door authentication test failed")
    
    print("\n💡 Check the screenshots to see what the app looks like with different tokens")
