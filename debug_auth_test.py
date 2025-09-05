#!/usr/bin/env python3
"""
Debug Authentication Test
Detailed debugging of the authentication initialization process
"""

from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
import json

def debug_authentication():
    print("🔍 Starting detailed authentication debugging...")
    
    # Setup Firefox
    options = Options()
    options.add_argument("--headless")
    options.add_argument("--width=1920")
    options.add_argument("--height=1080")
    options.set_preference("general.useragent.override", "BOB-AI-Agent/1.0 Firefox/Selenium")
    
    service = Service()
    driver = webdriver.Firefox(service=service, options=options)
    
    try:
        # Step 1: Navigate with test parameters
        test_url = "https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true"
        print(f"📍 Navigating to: {test_url}")
        driver.get(test_url)
        
        # Step 2: Wait for initial page load
        WebDriverWait(driver, 10).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        
        # Step 3: Check immediate URL status
        current_url = driver.current_url
        print(f"📍 Current URL after load: {current_url}")
        
        # Step 4: Execute debugging script in browser
        debug_script = """
        console.log('🔍 BOB Authentication Debug Script');
        console.log('📍 Current URL:', window.location.href);
        console.log('📍 Search params:', window.location.search);
        
        const urlParams = new URLSearchParams(window.location.search);
        const testLogin = urlParams.get('test-login');
        const testMode = urlParams.get('test-mode');
        console.log('🧪 URL Parameters:', { testLogin, testMode });
        
        // Check if SideDoorAuth is available
        console.log('🧪 SideDoorAuth available:', typeof window.SideDoorAuth !== 'undefined');
        
        // Check localStorage for test mode
        const testModeStorage = localStorage.getItem('bob_test_mode');
        console.log('🧪 Test mode in localStorage:', testModeStorage);
        
        // Check global test auth state
        const globalAuthState = window.__BOB_TEST_AUTH_STATE;
        console.log('🧪 Global auth state:', globalAuthState);
        
        // Try to call SideDoorAuth methods
        if (typeof window.SideDoorAuth !== 'undefined') {
            console.log('🧪 SideDoorAuth.isTestEnvironment():', window.SideDoorAuth.isTestEnvironment());
            console.log('🧪 SideDoorAuth.isTestModeActive():', window.SideDoorAuth.isTestModeActive());
            
            // Try initialization
            const initResult = window.SideDoorAuth.initializeFromUrl();
            console.log('🧪 SideDoorAuth.initializeFromUrl() result:', initResult);
        }
        
        return {
            url: window.location.href,
            search: window.location.search,
            testLogin: testLogin,
            testMode: testMode,
            testModeStorage: testModeStorage,
            globalAuthState: globalAuthState,
            sideDoorAuthAvailable: typeof window.SideDoorAuth !== 'undefined'
        };
        """
        
        # Execute and get results
        debug_result = driver.execute_script(debug_script)
        print(f"🧪 Debug result: {json.dumps(debug_result, indent=2)}")
        
        # Step 5: Wait a few seconds and check again
        print("⏳ Waiting 3 seconds for app initialization...")
        time.sleep(3)
        
        # Step 6: Check authentication state after waiting
        auth_check_script = """
        // Check various authentication indicators
        const indicators = {
            testMode: localStorage.getItem('bob_test_mode'),
            globalAuthState: window.__BOB_TEST_AUTH_STATE,
            authContextUser: null,
            testIndicator: document.querySelector('[data-testid="test-mode-indicator"]') !== null,
            userButton: document.querySelector('[data-testid="user-button"]') !== null,
            quickActions: document.querySelector('[data-testid="quick-actions-panel"]') !== null
        };
        
        // Try to access React state if possible
        try {
            const reactRoot = document.querySelector('#root');
            if (reactRoot && reactRoot._reactInternalFiber) {
                console.log('🧪 React fiber detected');
            }
        } catch (e) {
            console.log('🧪 Could not access React state:', e.message);
        }
        
        console.log('🧪 Authentication indicators:', indicators);
        return indicators;
        """
        
        auth_indicators = driver.execute_script(auth_check_script)
        print(f"🔐 Authentication indicators: {json.dumps(auth_indicators, indent=2)}")
        
        # Step 7: Take screenshot
        driver.save_screenshot("./test-results/debug_auth_screenshot.png")
        print("📸 Screenshot saved: ./test-results/debug_auth_screenshot.png")
        
        # Step 8: Get page source snippet
        page_source = driver.page_source
        if "TEST" in page_source:
            print("✅ Test indicator found in page source")
        else:
            print("❌ Test indicator NOT found in page source")
            
        # Look for auth-related elements
        try:
            test_element = driver.find_element(By.XPATH, "//*[contains(text(), 'TEST')]")
            print(f"✅ Found test element: {test_element.text}")
        except:
            print("❌ No test element found")
            
        return debug_result, auth_indicators
        
    finally:
        driver.quit()

if __name__ == "__main__":
    debug_authentication()
