#!/usr/bin/env python3
"""
Quick verification test for Agentic AI test user
"""

import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def test_agentic_user_login():
    print("🤖 Testing Agentic AI User Authentication...")
    
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    
    driver = webdriver.Firefox(options=options)
    
    try:
        # Read the token
        with open('agentic-ai-test-token.txt', 'r') as f:
            token = f.read().strip()
        
        # Test side-door authentication
        side_door_url = f"https://bob20250810.web.app?test-login={token}&test-mode=true"
        driver.get(side_door_url)
        time.sleep(5)
        
        # Check for authentication indicators
        auth_indicators = [".sidebar", "[data-testid='sidebar']", ".user-display", ".auth-user-name"]
        
        authenticated = False
        for selector in auth_indicators:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    authenticated = True
                    print(f"✅ Authentication successful (found: {selector})")
                    break
            except:
                continue
        
        if authenticated:
            # Test navigation to goals
            driver.get("https://bob20250810.web.app/goals")
            time.sleep(3)
            
            page_title = driver.title
            page_content = driver.page_source
            
            if "goals" in page_content.lower() or "goal" in page_content.lower():
                print("✅ Goals page accessible")
            else:
                print("⚠️ Goals page content unclear")
            
            print(f"📄 Page title: {page_title}")
            print("✅ Agentic AI test user is working correctly!")
            return True
        else:
            print("❌ Authentication failed")
            return False
            
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False
    finally:
        driver.quit()

if __name__ == "__main__":
    success = test_agentic_user_login()
    if success:
        print("\n🎉 Agentic AI test user is ready for production testing!")
    else:
        print("\n❌ Issues detected with Agentic AI test user")
