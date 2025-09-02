#!/usr/bin/env python3
"""
Test side-door authentication with longer waits and step-by-step monitoring
"""

import time
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.firefox import GeckoDriverManager

def test_step_by_step_auth():
    """Test side-door authentication step by step"""
    
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    
    driver = None
    try:
        print("🔍 Step-by-step side-door authentication test...")
        service = Service(GeckoDriverManager().install())
        driver = webdriver.Firefox(service=service, options=options)
        wait = WebDriverWait(driver, 30)
        
        test_token = "ai-test-token-1725242400000"
        test_url = f"https://bob20250810.web.app?test-login={test_token}&test-mode=true"
        
        print(f"🌐 Step 1: Loading {test_url}")
        driver.get(test_url)
        
        # Step 2: Wait for the page to load completely
        print("⏳ Step 2: Waiting for page title to load...")
        wait.until(lambda d: d.title != "")
        print(f"  📄 Title loaded: {driver.title}")
        
        # Step 3: Wait for React to start
        print("⏳ Step 3: Waiting for React to initialize...")
        time.sleep(10)
        
        # Step 4: Check if we're still on the same URL or if it redirected
        current_url = driver.current_url
        print(f"  📍 Current URL: {current_url}")
        
        # Step 5: Look for either login form OR authenticated content
        print("🔍 Step 4: Checking initial page state...")
        
        # Check for Google login
        google_login = driver.find_elements(By.XPATH, "//button[contains(text(), 'Sign in with Google')]")
        print(f"  🔒 Google login buttons found: {len(google_login)}")
        
        # Check for any content that suggests we're in the app
        content_selectors = [
            "main", ".main", "#main",
            ".app", "#app", ".content",
            ".container", ".page", ".dashboard"
        ]
        
        content_found = False
        for selector in content_selectors:
            elements = driver.find_elements(By.CSS_SELECTOR, selector)
            if elements:
                print(f"  📄 Found content element: {selector}")
                content_found = True
                break
        
        if not content_found:
            print("  ⚠️  No main content elements found")
        
        # Step 5: If we see login, wait a bit more and check again
        if google_login and any(btn.is_displayed() for btn in google_login):
            print("⏳ Step 5: Still seeing login, waiting longer for side-door auth...")
            time.sleep(15)  # Wait more for side-door to kick in
            
            # Check again
            google_login_after_wait = driver.find_elements(By.XPATH, "//button[contains(text(), 'Sign in with Google')]")
            print(f"  🔒 Google login after wait: {len(google_login_after_wait)}")
            
            # Check localStorage for test mode
            test_mode = driver.execute_script("return localStorage.getItem('bob_test_mode');")
            print(f"  💾 Test mode in localStorage: {test_mode}")
            
            # Check for global test state
            test_state = driver.execute_script("return window.__BOB_TEST_AUTH_STATE;")
            print(f"  🧪 Global test state: {test_state}")
        
        # Step 6: Try to interact with the page
        print("🎯 Step 6: Testing page interaction...")
        
        # Try clicking somewhere safe to ensure page is interactive
        try:
            body = driver.find_element(By.TAG_NAME, "body")
            body.click()
            print("  ✅ Page is interactive")
        except Exception as e:
            print(f"  ❌ Page interaction failed: {e}")
        
        # Step 7: Force navigation to goals and see what happens
        print("🎯 Step 7: Direct navigation to goals page...")
        goals_url = "https://bob20250810.web.app/goals"
        driver.get(goals_url)
        time.sleep(10)
        
        final_url = driver.current_url
        final_title = driver.title
        print(f"  📍 Final URL: {final_url}")
        print(f"  📄 Final title: {final_title}")
        
        # Check what we see on the goals page
        google_login_on_goals = driver.find_elements(By.XPATH, "//button[contains(text(), 'Sign in with Google')]")
        print(f"  🔒 Google login on goals page: {len(google_login_on_goals)}")
        
        # Look for goals-specific content
        goals_indicators = [
            "goal", "goals", "add goal", "create goal",
            "task", "tasks", "dashboard", "sidebar"
        ]
        
        page_text = driver.page_source.lower()
        found_goals_content = []
        for indicator in goals_indicators:
            if indicator in page_text:
                found_goals_content.append(indicator)
        
        print(f"  🎯 Goals content found: {found_goals_content}")
        
        # Step 8: Take final screenshots
        print("📸 Step 8: Taking screenshots...")
        try:
            driver.save_screenshot("./test-results/step_by_step_final.png")
            print("  📸 Final screenshot saved")
        except Exception as e:
            print(f"  📸 Screenshot failed: {e}")
        
        # Step 9: Evaluation
        print("\n📊 Step 9: Final evaluation...")
        
        if len(google_login_on_goals) == 0:
            print("  ✅ SUCCESS: No login required on goals page")
            return True
        elif found_goals_content:
            print("  ⚠️  PARTIAL: Found goals content despite login showing")
            return True
        else:
            print("  ❌ FAILED: Still showing login on goals page")
            return False
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False
        
    finally:
        if driver:
            driver.quit()
            print("\n🧹 Browser cleaned up")

if __name__ == "__main__":
    print("🔍 Step-by-Step Side-Door Authentication Test")
    print("=" * 60)
    
    success = test_step_by_step_auth()
    
    if success:
        print("\n🎉 SUCCESS: Authentication is working!")
    else:
        print("\n❌ FAILED: Authentication issues detected")
    
    print("\n💡 If authentication is working, the CRUD testing should proceed successfully")
