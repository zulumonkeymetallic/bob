#!/usr/bin/env python3
"""
Debug Selenium Authentication Issues
Identifies timing and interaction differences between selenium and regular Chrome
"""

import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def test_authentication_timing():
    """Test authentication with extended wait times and detailed logging"""
    
    print("🔍 Testing Authentication Timing with Selenium...")
    
    # Set up Chrome with same options as working debug script
    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--window-size=1920,1080')
    
    # Enable console logging
    chrome_options.add_argument('--enable-logging')
    chrome_options.add_argument('--log-level=0')
    chrome_options.add_experimental_option('useAutomationExtension', False)
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    
    driver = webdriver.Chrome(options=chrome_options)
    
    try:
        url = "https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true"
        print(f"📍 Loading: {url}")
        
        driver.get(url)
        print(f"✅ Page loaded. Current URL: {driver.current_url}")
        
        # Wait for different timing intervals and check authentication each time
        wait_times = [2, 5, 10, 15, 20]
        
        for wait_time in wait_times:
            print(f"\n⏱️  Waiting {wait_time} seconds...")
            time.sleep(wait_time - (wait_times[wait_times.index(wait_time)-1] if wait_time != 2 else 0))
            
            # Check for authentication indicators
            auth_checks = {
                "localStorage test mode": driver.execute_script("return localStorage.getItem('test-mode');"),
                "localStorage auth token": driver.execute_script("return localStorage.getItem('auth-token');"),
                "URL params": driver.execute_script("return window.location.search;"),
                "Auth context ready": driver.execute_script("return window.authContextReady;"),
                "Current user": driver.execute_script("return window.currentUser;"),
                "Firebase auth": driver.execute_script("return window.firebase && window.firebase.auth ? 'available' : 'not available';")
            }
            
            print(f"🔍 Authentication status at {wait_time}s:")
            for key, value in auth_checks.items():
                print(f"   {key}: {value}")
            
            # Check for QuickActionsPanel
            try:
                quick_actions = driver.find_element(By.CSS_SELECTOR, "[data-testid='quick-actions-panel']")
                print(f"   ✅ QuickActionsPanel found: {quick_actions.is_displayed()}")
                
                # Count buttons
                buttons = driver.find_elements(By.CSS_SELECTOR, "[data-testid^='create-'][data-testid$='-button']")
                print(f"   🔘 Action buttons found: {len(buttons)}")
                for button in buttons:
                    print(f"      - {button.get_attribute('data-testid')}: {button.text}")
                    
            except Exception as e:
                print(f"   ❌ QuickActionsPanel not found: {str(e)}")
            
            # Check for user indicator in DOM
            try:
                user_elements = driver.find_elements(By.CSS_SELECTOR, "[data-testid*='user'], .user-info, .auth-status")
                print(f"   👤 User elements found: {len(user_elements)}")
                for elem in user_elements:
                    print(f"      - {elem.tag_name}.{elem.get_attribute('class')}: {elem.text[:50]}")
            except Exception as e:
                print(f"   ❌ No user elements found: {str(e)}")
                
            # Get console logs if available
            try:
                logs = driver.get_log('browser')
                console_logs = [log for log in logs if log['level'] in ['INFO', 'WARNING', 'SEVERE']]
                if console_logs:
                    print(f"   📝 Console logs ({len(console_logs)}):")
                    for log in console_logs[-5:]:  # Last 5 logs
                        print(f"      {log['level']}: {log['message'][:100]}")
            except Exception as e:
                print(f"   ❌ Console logs not accessible: {str(e)}")
        
        print(f"\n🎯 Final check - DOM content:")
        body_text = driver.find_element(By.TAG_NAME, "body").text
        print(f"   Body contains 'Dashboard': {'Dashboard' in body_text}")
        print(f"   Body contains 'Create': {'Create' in body_text}")
        print(f"   Body contains 'Goal': {'Goal' in body_text}")
        print(f"   Body length: {len(body_text)} characters")
        
        # Take final screenshot
        driver.save_screenshot("./test-results/selenium_auth_debug.png")
        print(f"   📸 Screenshot saved: ./test-results/selenium_auth_debug.png")
        
    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
        
    finally:
        driver.quit()
        print("🏁 Test completed")

if __name__ == "__main__":
    test_authentication_timing()
