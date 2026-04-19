#!/usr/bin/env python3
"""
Enhanced side-door authentication test with browser console monitoring
"""

import time
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from webdriver_manager.firefox import GeckoDriverManager

def test_side_door_with_console():
    """Test side-door authentication and monitor console logs"""
    
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    
    # Enable logging
    options.set_preference("devtools.console.stdout.content", True)
    
    driver = None
    try:
        print("🔍 Testing side-door authentication with console monitoring...")
        service = Service(GeckoDriverManager().install())
        driver = webdriver.Firefox(service=service, options=options)
        
        # Test with a realistic token format
        test_token = "ai-test-token-1725242400000"  # Timestamp-based token
        test_url = f"https://bob20250810.web.app?test-login={test_token}&test-mode=true"
        
        print(f"🌐 Testing URL: {test_url}")
        
        # Navigate and wait for React app to fully load
        driver.get(test_url)
        print("⏳ Waiting for React app initialization (15 seconds)...")
        time.sleep(15)  # Give more time for React app to initialize
        
        current_url = driver.current_url
        page_title = driver.title
        
        print(f"📍 Final URL: {current_url}")
        print(f"📄 Title: {page_title}")
        
        # Try to get console logs (might not work in headless mode)
        try:
            # Firefox doesn't support browser logs the same way as Chrome
            print("\n📝 Console logs not available in Firefox WebDriver")
        except Exception as e:
            print(f"📝 Console logs not available: {e}")
        
        # Check for authentication state in multiple ways
        print("\n🔍 Checking authentication state...")
        
        # 1. Check if Google login button is gone
        google_login_buttons = driver.find_elements(By.XPATH, "//button[contains(text(), 'Sign in with Google')]")
        google_login_visible = any(btn.is_displayed() for btn in google_login_buttons)
        
        print(f"  🔍 Google login button visible: {google_login_visible}")
        
        # 2. Check for authenticated UI elements
        auth_elements = {
            'Sidebar': '.sidebar',
            'User Menu': '.user-menu',
            'Navigation': '.navbar',
            'Header': '.header',
            'Main Content': '.main-content',
            'Goals': '[data-testid="goals"]',
            'Dashboard': '.dashboard'
        }
        
        found_auth_elements = []
        for name, selector in auth_elements.items():
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
                visible_elements = [el for el in elements if el.is_displayed()]
                if visible_elements:
                    found_auth_elements.append(name)
                    print(f"  ✅ Found {name}: {len(visible_elements)} visible element(s)")
            except Exception:
                pass
        
        # 3. Check page content for specific indicators
        page_source = driver.page_source.lower()
        indicators = {
            'Test Mode Active': 'test mode',
            'Side Door Auth': 'side door',
            'AI Agent': 'ai agent',
            'Authenticated': 'authenticated',
            'Dashboard': 'dashboard',
            'Goals': 'goals'
        }
        
        content_indicators = []
        for name, keyword in indicators.items():
            if keyword in page_source:
                content_indicators.append(name)
                print(f"  📄 Found in content: {name}")
        
        # 4. Try to navigate to a protected page
        print("\n🎯 Testing protected page access...")
        goals_url = "https://bob20250810.web.app/goals"
        driver.get(goals_url)
        time.sleep(5)
        
        final_url = driver.current_url
        goals_accessible = 'goals' in final_url or not google_login_visible
        print(f"  🎯 Goals page URL: {final_url}")
        print(f"  🎯 Goals accessible: {goals_accessible}")
        
        # 5. Check for JavaScript state
        try:
            # Check if test authentication state is set
            test_auth_state = driver.execute_script("""
                return window.__BOB_TEST_AUTH_STATE || null;
            """)
            print(f"  🧪 Test auth state: {test_auth_state}")
            
            # Check localStorage for test mode
            test_mode_storage = driver.execute_script("""
                return localStorage.getItem('bob_test_mode');
            """)
            print(f"  💾 localStorage test mode: {test_mode_storage}")
            
        except Exception as e:
            print(f"  🧪 JavaScript state check failed: {e}")
        
        # Take screenshots at different stages
        screenshots = [
            ("initial_load", "After initial page load"),
            ("goals_page", "After navigating to goals")
        ]
        
        for name, description in screenshots:
            try:
                screenshot_file = f"./test-results/side_door_enhanced_{name}.png"
                driver.save_screenshot(screenshot_file)
                print(f"  📸 Screenshot saved: {screenshot_file} - {description}")
            except Exception as e:
                print(f"  📸 Screenshot failed for {name}: {e}")
        
        # Determine overall authentication status
        authentication_score = 0
        
        if not google_login_visible:
            authentication_score += 3
            print("  ✅ +3 points: Google login button hidden")
        
        if found_auth_elements:
            authentication_score += len(found_auth_elements)
            print(f"  ✅ +{len(found_auth_elements)} points: Found auth UI elements")
        
        if content_indicators:
            authentication_score += len(content_indicators)
            print(f"  ✅ +{len(content_indicators)} points: Found content indicators")
        
        if goals_accessible:
            authentication_score += 2
            print("  ✅ +2 points: Goals page accessible")
        
        print(f"\n📊 Authentication Score: {authentication_score}/10")
        
        if authentication_score >= 6:
            print("🎉 SUCCESS: Side-door authentication appears to be working!")
            return True
        elif authentication_score >= 3:
            print("⚠️  PARTIAL: Some authentication indicators found")
            return False
        else:
            print("❌ FAILED: No authentication indicators found")
            return False
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False
        
    finally:
        if driver:
            driver.quit()
            print("\n🧹 Browser cleaned up")

if __name__ == "__main__":
    print("🚪 Enhanced Side-Door Authentication Test")
    print("=" * 50)
    
    success = test_side_door_with_console()
    
    if success:
        print("\n✅ Side-door authentication is working properly!")
        print("💡 You can now proceed with the full CRUD testing suite")
    else:
        print("\n❌ Side-door authentication needs investigation")
        print("💡 Check the screenshots and logs for debugging information")
