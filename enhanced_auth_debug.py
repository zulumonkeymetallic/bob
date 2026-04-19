#!/usr/bin/env python3
"""
Enhanced Authentication Debug Test
Uses Chrome to access console logs and debug authentication flow
"""

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
import time
import json

def enhanced_auth_debug():
    print("🔍 Starting enhanced authentication debugging with Chrome...")
    
    # Setup Chrome for console log access
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_experimental_option('useAutomationExtension', False)
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_argument("--user-agent=BOB-AI-Agent/1.0 Chrome/Selenium")
    
    # Enable logging
    options.set_capability('goog:loggingPrefs', {
        'browser': 'ALL',
        'performance': 'ALL'
    })
    
    service = Service()
    driver = webdriver.Chrome(service=service, options=options)
    
    try:
        # Step 1: Navigate with test parameters
        test_url = "https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true"
        print(f"📍 Navigating to: {test_url}")
        driver.get(test_url)
        
        # Step 2: Wait for initial page load
        WebDriverWait(driver, 10).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        
        print(f"📍 Current URL after load: {driver.current_url}")
        
        # Step 3: Get console logs
        try:
            logs = driver.get_log('browser')
            print("🔍 Console logs:")
            for log in logs[-20:]:  # Last 20 logs
                if any(keyword in log['message'] for keyword in ['🧪', '🔐', 'auth', 'test', 'SideDoor']):
                    print(f"  {log['level']}: {log['message']}")
        except Exception as e:
            print(f"❌ Could not get console logs: {e}")
        
        # Step 4: Wait longer for React initialization
        print("⏳ Waiting 5 seconds for React component initialization...")
        time.sleep(5)
        
        # Step 5: Execute detailed auth status check
        auth_debug_script = """
        console.log('🔍 Enhanced Auth Debug Script Starting...');
        
        // Check URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const testLogin = urlParams.get('test-login');
        const testMode = urlParams.get('test-mode');
        console.log('🧪 URL Parameters found:', { testLogin, testMode });
        
        // Check SideDoorAuth availability and status
        let sideDoorStatus = 'not available';
        if (typeof window.SideDoorAuth !== 'undefined') {
            sideDoorStatus = {
                isTestEnvironment: window.SideDoorAuth.isTestEnvironment(),
                isTestModeActive: window.SideDoorAuth.isTestModeActive(),
                currentTestUser: window.SideDoorAuth.getCurrentTestUser()
            };
        }
        console.log('🧪 SideDoorAuth status:', sideDoorStatus);
        
        // Check localStorage
        const testModeStorage = localStorage.getItem('bob_test_mode');
        console.log('🧪 Test mode in localStorage:', testModeStorage);
        
        // Check global auth state
        const globalAuthState = window.__BOB_TEST_AUTH_STATE;
        console.log('🧪 Global auth state:', globalAuthState);
        
        // Check if React AuthContext exists
        let authContextStatus = 'not accessible';
        try {
            // Try to find React components with auth context
            const authElements = document.querySelectorAll('[data-testid*="auth"], [data-testid*="user"]');
            authContextStatus = `Found ${authElements.length} auth-related elements`;
        } catch (e) {
            authContextStatus = `Error: ${e.message}`;
        }
        console.log('🧪 Auth context status:', authContextStatus);
        
        // Check if user button or authenticated UI elements exist
        const userButton = document.querySelector('[data-testid="user-button"]');
        const quickActions = document.querySelector('[data-testid="quick-actions-panel"]');
        const testIndicator = document.querySelector('[data-testid="test-mode-indicator"]');
        
        console.log('🧪 UI Elements:', {
            userButton: userButton !== null,
            quickActions: quickActions !== null,
            testIndicator: testIndicator !== null
        });
        
        return {
            urlParams: { testLogin, testMode },
            sideDoorStatus,
            testModeStorage,
            globalAuthState,
            authContextStatus,
            uiElements: {
                userButton: userButton !== null,
                quickActions: quickActions !== null,
                testIndicator: testIndicator !== null
            }
        };
        """
        
        debug_result = driver.execute_script(auth_debug_script)
        print(f"🔍 Enhanced debug result:")
        print(json.dumps(debug_result, indent=2))
        
        # Step 6: Get updated console logs
        try:
            logs = driver.get_log('browser')
            print("🔍 Console logs after debug script:")
            for log in logs[-10:]:  # Last 10 logs
                print(f"  {log['level']}: {log['message']}")
        except Exception as e:
            print(f"❌ Could not get updated console logs: {e}")
        
        # Step 7: Check for any error messages on page
        try:
            error_elements = driver.find_elements(By.XPATH, "//*[contains(text(), 'error') or contains(text(), 'Error') or contains(text(), 'ERROR')]")
            if error_elements:
                print("⚠️ Found error messages on page:")
                for elem in error_elements[:5]:
                    print(f"  - {elem.text}")
        except:
            pass
        
        # Step 8: Take screenshot for visual inspection
        driver.save_screenshot("./test-results/enhanced_auth_debug_screenshot.png")
        print("📸 Screenshot saved: ./test-results/enhanced_auth_debug_screenshot.png")
        
        return debug_result
        
    finally:
        driver.quit()

if __name__ == "__main__":
    enhanced_auth_debug()
