#!/usr/bin/env python3
"""
Test Tasks and Stories Workflow Consistency
Compare with working Goals pattern to ensure consistency
"""

import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

def test_task_story_consistency():
    """Test Tasks and Stories follow same pattern as Goals"""
    
    print("📋 Testing Tasks and Stories Workflow Consistency...")
    
    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--window-size=1920,1080')
    
    driver = webdriver.Chrome(options=chrome_options)
    
    test_results = {
        'goals': {'modal': True, 'fields': 3, 'page_works': True},
        'tasks': {'modal': None, 'fields': 0, 'page_works': None},
        'stories': {'modal': None, 'fields': 0, 'page_works': None}
    }
    
    try:
        url = "https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true"
        print(f"📍 Loading: {url}")
        driver.get(url)
        time.sleep(3)
        
        # Test each workflow type
        workflows = [
            ('tasks', 'create-task-button', 'Quick Task'),
            ('stories', 'create-story-button', 'Quick Story')
        ]
        
        for workflow_type, button_selector, button_text in workflows:
            print(f"\n🔍 Testing {workflow_type.upper()} Workflow:")
            
            # Go back to dashboard
            driver.get(url)
            time.sleep(2)
            
            try:
                # Step 1: Find button
                button = driver.find_element(By.CSS_SELECTOR, f"[data-testid='{button_selector}']")
                print(f"   ✅ {button_text} button found: {button.is_displayed()}")
                
                # Step 2: Click button
                button.click()
                time.sleep(2)
                
                # Step 3: Check for modal
                modal_selectors = [
                    f"[data-testid='{workflow_type}-modal']",
                    f"[data-testid='add-{workflow_type}-modal']", 
                    f"[data-testid='create-{workflow_type}-modal']",
                    ".modal",
                    "[role='dialog']"
                ]
                
                modal_found = False
                form_fields = 0
                
                for selector in modal_selectors:
                    try:
                        elements = driver.find_elements(By.CSS_SELECTOR, selector)
                        if elements:
                            modal = elements[0]
                            if modal.is_displayed():
                                print(f"   ✅ Modal found: {selector}")
                                modal_found = True
                                
                                # Count form fields
                                fields = modal.find_elements(By.CSS_SELECTOR, "input, textarea, select")
                                form_fields = len(fields)
                                print(f"   📝 Form fields: {form_fields}")
                                
                                for field in fields:
                                    field_type = field.get_attribute('type') or field.tag_name
                                    placeholder = field.get_attribute('placeholder') or field.get_attribute('name') or 'no placeholder'
                                    print(f"      - {field_type}: {placeholder}")
                                break
                    except Exception:
                        continue
                
                test_results[workflow_type]['modal'] = modal_found
                test_results[workflow_type]['fields'] = form_fields
                
                if not modal_found:
                    print(f"   ❌ No modal found for {workflow_type}")
                    print(f"   🌐 Current URL: {driver.current_url}")
                    
                    # Check if navigated to dedicated page
                    if workflow_type in driver.current_url:
                        print(f"   ✅ Navigated to {workflow_type} page instead")
                        test_results[workflow_type]['page_works'] = True
                    else:
                        test_results[workflow_type]['page_works'] = False
                
                # Step 4: Test direct page navigation
                print(f"   🔍 Testing direct {workflow_type} page navigation...")
                direct_url = f"https://bob20250810.web.app/{workflow_type}?test-login=ai-agent-token&test-mode=true"
                driver.get(direct_url)
                time.sleep(2)
                
                page_content = driver.find_element(By.TAG_NAME, "body").text
                if workflow_type.rstrip('s') in page_content.lower():  # Remove 's' for singular
                    print(f"   ✅ {workflow_type} page contains relevant content")
                    test_results[workflow_type]['page_works'] = True
                else:
                    print(f"   ❌ {workflow_type} page missing relevant content")
                    test_results[workflow_type]['page_works'] = False
                
                # Take screenshot
                driver.save_screenshot(f"./test-results/{workflow_type}_workflow_test.png")
                print(f"   📸 Screenshot: {workflow_type}_workflow_test.png")
                
            except Exception as e:
                print(f"   ❌ {workflow_type} test failed: {str(e)}")
                test_results[workflow_type] = {'modal': False, 'fields': 0, 'page_works': False}
        
        # Generate consistency report
        print(f"\n📊 CONSISTENCY ANALYSIS:")
        print(f"{'Workflow':<10} {'Modal':<10} {'Fields':<10} {'Page':<10} {'Status'}")
        print(f"{'-'*50}")
        
        goals_pattern = test_results['goals']
        
        for workflow, results in test_results.items():
            modal_status = "✅" if results['modal'] else "❌"
            fields_status = f"{results['fields']}"
            page_status = "✅" if results['page_works'] else "❌"
            
            # Check consistency with Goals
            if workflow == 'goals':
                consistency = "BASELINE"
            else:
                modal_consistent = results['modal'] == goals_pattern['modal']
                fields_consistent = results['fields'] == goals_pattern['fields']
                page_consistent = results['page_works'] == goals_pattern['page_works']
                
                if modal_consistent and fields_consistent and page_consistent:
                    consistency = "✅ CONSISTENT"
                else:
                    consistency = "❌ INCONSISTENT"
            
            print(f"{workflow.upper():<10} {modal_status:<10} {fields_status:<10} {page_status:<10} {consistency}")
        
        print(f"\n🎯 RECOMMENDATIONS:")
        for workflow, results in test_results.items():
            if workflow != 'goals':
                issues = []
                if not results['modal']:
                    issues.append("Modal not working")
                if results['fields'] != goals_pattern['fields']:
                    issues.append(f"Fields mismatch (has {results['fields']}, expected {goals_pattern['fields']})")
                if not results['page_works']:
                    issues.append("Direct page navigation broken")
                
                if issues:
                    print(f"   {workflow.upper()}: {', '.join(issues)}")
                else:
                    print(f"   {workflow.upper()}: ✅ Fully consistent with Goals")
        
    except Exception as e:
        print(f"❌ Consistency test failed: {str(e)}")
        
    finally:
        driver.quit()
        print("🏁 Consistency test completed")

if __name__ == "__main__":
    test_task_story_consistency()
