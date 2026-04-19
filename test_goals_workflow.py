#!/usr/bin/env python3
"""
Test Goals Creation Workflow for Consistency
Focus on Goals CRUD operations as priority before Tasks/Stories
"""

import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def test_goals_workflow():
    """Test Goals creation workflow for consistency"""
    
    print("🎯 Testing Goals Creation Workflow for Consistency...")
    
    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--window-size=1920,1080')
    
    driver = webdriver.Chrome(options=chrome_options)
    
    try:
        url = "https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true"
        print(f"📍 Loading: {url}")
        
        driver.get(url)
        time.sleep(3)  # Wait for page load
        
        print("🔍 Step 1: Verify QuickActionsPanel")
        quick_actions = driver.find_element(By.CSS_SELECTOR, "[data-testid='quick-actions-panel']")
        print(f"   ✅ QuickActionsPanel found: {quick_actions.is_displayed()}")
        
        print("🔍 Step 2: Find Create Goal Button")
        goal_button = driver.find_element(By.CSS_SELECTOR, "[data-testid='create-goal-button']")
        print(f"   ✅ Create Goal button found: {goal_button.text}")
        print(f"   🔘 Button visible: {goal_button.is_displayed()}")
        print(f"   🔘 Button enabled: {goal_button.is_enabled()}")
        
        print("🔍 Step 3: Click Create Goal Button")
        goal_button.click()
        time.sleep(2)  # Wait for modal/form
        
        print("🔍 Step 4: Check for Goal Creation Modal/Form")
        
        # Check for different possible selectors
        modal_selectors = [
            "[data-testid='goal-modal']",
            "[data-testid='add-goal-modal']", 
            "[data-testid='create-goal-modal']",
            ".modal",
            "[role='dialog']",
            ".goal-form",
            "[data-testid*='goal']"
        ]
        
        modal_found = False
        for selector in modal_selectors:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    modal = elements[0]
                    print(f"   ✅ Modal found with selector '{selector}': {modal.is_displayed()}")
                    print(f"      Tag: {modal.tag_name}, Class: {modal.get_attribute('class')}")
                    modal_found = True
                    
                    # Look for form fields
                    form_fields = modal.find_elements(By.CSS_SELECTOR, "input, textarea, select")
                    print(f"      📝 Form fields found: {len(form_fields)}")
                    for field in form_fields:
                        print(f"         - {field.tag_name}[{field.get_attribute('type')}]: {field.get_attribute('placeholder') or field.get_attribute('name')}")
                    
                    break
            except Exception as e:
                continue
        
        if not modal_found:
            print("   ❌ No modal found, checking for navigation...")
            print(f"   🌐 Current URL: {driver.current_url}")
            
            # Check if we navigated to goals page
            if 'goals' in driver.current_url or 'goal' in driver.current_url:
                print("   ✅ Navigated to Goals page instead of modal")
                
                # Look for goal creation form on page
                form_selectors = [
                    "form",
                    "[data-testid*='goal']",
                    ".goal-form",
                    "input[placeholder*='goal']",
                    "input[placeholder*='Goal']"
                ]
                
                for selector in form_selectors:
                    try:
                        elements = driver.find_elements(By.CSS_SELECTOR, selector)
                        if elements:
                            print(f"   ✅ Form element found: {selector} ({len(elements)} elements)")
                            for elem in elements:
                                print(f"      - {elem.tag_name}: {elem.get_attribute('class')}")
                    except Exception as e:
                        continue
        
        print("🔍 Step 5: Check Page Content")
        body_text = driver.find_element(By.TAG_NAME, "body").text
        goal_keywords = ['goal', 'Goal', 'GOAL', 'create', 'Create', 'add', 'Add', 'new', 'New']
        
        print("   📄 Page content analysis:")
        for keyword in goal_keywords:
            count = body_text.count(keyword)
            if count > 0:
                print(f"      '{keyword}' appears {count} times")
        
        print(f"   📏 Total page content: {len(body_text)} characters")
        
        # Take screenshot for analysis
        driver.save_screenshot("./test-results/goals_workflow_test.png")
        print(f"   📸 Screenshot saved: ./test-results/goals_workflow_test.png")
        
        print("🔍 Step 6: Test Navigation to Goals Page Directly")
        goals_url = "https://bob20250810.web.app/goals?test-login=ai-agent-token&test-mode=true"
        driver.get(goals_url)
        time.sleep(3)
        
        print(f"   🌐 Navigated to: {driver.current_url}")
        
        # Check for goals page content
        try:
            goals_content = driver.find_element(By.TAG_NAME, "body").text
            print(f"   📄 Goals page content length: {len(goals_content)} characters")
            
            if 'goal' in goals_content.lower():
                print("   ✅ Goals page contains goal-related content")
            else:
                print("   ❌ Goals page doesn't contain goal-related content")
                
            # Look for add/create buttons
            create_buttons = driver.find_elements(By.CSS_SELECTOR, "*[class*='add'], *[class*='create'], *[class*='new'], button")
            print(f"   🔘 Potential action buttons found: {len(create_buttons)}")
            for button in create_buttons[:5]:  # First 5 buttons
                print(f"      - {button.tag_name}: {button.text[:30]} (class: {button.get_attribute('class')})")
                
        except Exception as e:
            print(f"   ❌ Error analyzing goals page: {str(e)}")
        
        # Final screenshot
        driver.save_screenshot("./test-results/goals_page_direct.png")
        print(f"   📸 Goals page screenshot: ./test-results/goals_page_direct.png")
        
    except Exception as e:
        print(f"❌ Goals workflow test failed: {str(e)}")
        driver.save_screenshot("./test-results/goals_workflow_error.png")
        
    finally:
        driver.quit()
        print("🏁 Goals workflow test completed")

if __name__ == "__main__":
    test_goals_workflow()
