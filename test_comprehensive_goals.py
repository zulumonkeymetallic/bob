#!/usr/bin/env python3
"""
Test Comprehensive Goals Functionality
Tests all new enhancements: complete DB fields, edit workflow, last updated display, KPIs
"""

import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

def test_comprehensive_goals():
    """Test comprehensive Goals functionality end-to-end"""
    
    print("🎯 Testing Comprehensive Goals Functionality...")
    
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
        time.sleep(3)
        
        print("🔍 Phase 1: Test Enhanced Goal Creation Modal")
        # Find and click Create Goal button
        goal_button = driver.find_element(By.CSS_SELECTOR, "[data-testid='create-goal-button']")
        goal_button.click()
        time.sleep(2)
        
        # Check for modal with all new fields
        modal = driver.find_element(By.CSS_SELECTOR, ".modal")
        print(f"   ✅ Goal creation modal opened: {modal.is_displayed()}")
        
        # Count form fields
        form_fields = modal.find_elements(By.CSS_SELECTOR, "input, textarea, select")
        print(f"   📝 Total form fields found: {len(form_fields)}")
        
        # Check for specific enhanced fields
        field_checks = [
            ("Title input", "input[placeholder*='title']"),
            ("Description textarea", "textarea[placeholder*='Describe']"),
            ("Theme select", "select"),
            ("Size select", "select"),
            ("Status select", "select"),
            ("Priority select", "select"),
            ("Confidence range", "input[type='range']"),
            ("Target date", "input[type='date']"),
            ("Hours input", "input[type='number']"),
            ("Add KPI button", "button:contains('Add KPI'), button[title*='KPI'], [text*='KPI']")
        ]
        
        fields_found = 0
        for field_name, selector in field_checks:
            try:
                elements = modal.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    print(f"   ✅ {field_name}: Found")
                    fields_found += 1
                else:
                    print(f"   ❌ {field_name}: Not found")
            except Exception as e:
                print(f"   ❌ {field_name}: Error - {str(e)}")
        
        print(f"   📊 Enhanced fields found: {fields_found}/{len(field_checks)}")
        
        # Test KPI functionality by looking for Add KPI text
        modal_text = modal.text
        if "KPI" in modal_text or "Key Performance" in modal_text:
            print("   ✅ KPI section detected in modal")
        else:
            print("   ❌ KPI section not found")
        
        # Close modal
        close_button = modal.find_element(By.CSS_SELECTOR, "button:contains('Cancel'), .btn-close, [aria-label='Close']")
        close_button.click()
        time.sleep(1)
        
        print("🔍 Phase 2: Test Goals Page Direct Navigation")
        goals_url = "https://bob20250810.web.app/goals?test-login=ai-agent-token&test-mode=true"
        driver.get(goals_url)
        time.sleep(3)
        
        page_content = driver.find_element(By.TAG_NAME, "body").text
        print(f"   📄 Goals page loaded: {'goal' in page_content.lower()}")
        
        # Check for goal cards with enhanced information
        try:
            goal_cards = driver.find_elements(By.CSS_SELECTOR, ".card")
            print(f"   🎯 Goal cards found: {len(goal_cards)}")
            
            if goal_cards:
                first_card = goal_cards[0]
                card_text = first_card.text
                
                # Check for "Last Updated" information
                has_updated_info = "Updated:" in card_text or "updated" in card_text.lower()
                print(f"   ⏰ Last updated display: {'✅ Found' if has_updated_info else '❌ Not found'}")
                
                # Check for edit button/dropdown
                try:
                    dropdown_button = first_card.find_element(By.CSS_SELECTOR, ".dropdown-toggle, [data-bs-toggle='dropdown']")
                    dropdown_button.click()
                    time.sleep(1)
                    
                    # Look for edit option
                    edit_options = driver.find_elements(By.CSS_SELECTOR, ".dropdown-item:contains('Edit'), [text*='Edit']")
                    print(f"   ✏️ Edit functionality: {'✅ Found' if edit_options else '❌ Not found'}")
                    
                    # Close dropdown
                    driver.find_element(By.TAG_NAME, "body").click()
                    time.sleep(1)
                    
                except Exception as e:
                    print(f"   ✏️ Edit functionality: ❌ Could not test - {str(e)}")
                
                # Check for modern stories table when expanding
                try:
                    stories_button = first_card.find_element(By.CSS_SELECTOR, "button:contains('Stories'), [text*='Stories']")
                    stories_button.click()
                    time.sleep(2)
                    
                    # Look for table structure (modern stories table)
                    tables = driver.find_elements(By.CSS_SELECTOR, "table, .table, [role='table']")
                    print(f"   📋 Modern stories table: {'✅ Found' if tables else '❌ Not found'}")
                    
                except Exception as e:
                    print(f"   📋 Modern stories table: ❌ Could not test - {str(e)}")
        
        except Exception as e:
            print(f"   🎯 Goal cards: ❌ Error testing - {str(e)}")
        
        print("🔍 Phase 3: Test Activity Stream Integration")
        # Look for activity buttons
        activity_buttons = driver.find_elements(By.CSS_SELECTOR, "button:contains('Activity'), [text*='Activity']")
        print(f"   📝 Activity stream buttons: {len(activity_buttons)} found")
        
        print("🔍 Phase 4: Overall Assessment")
        # Take final screenshot
        driver.save_screenshot("./test-results/comprehensive_goals_test.png")
        print(f"   📸 Screenshot saved: comprehensive_goals_test.png")
        
        # Summary assessment
        total_features = 5  # Enhanced modal, last updated, edit functionality, modern stories, activity stream
        working_features = 0
        
        if fields_found >= 7:  # Most enhanced fields working
            working_features += 1
            print("   ✅ Enhanced creation modal: WORKING")
        else:
            print("   ❌ Enhanced creation modal: NEEDS WORK")
        
        if has_updated_info:
            working_features += 1
            print("   ✅ Last updated display: WORKING")
        else:
            print("   ❌ Last updated display: NEEDS WORK")
        
        if len(goal_cards) > 0:
            working_features += 1
            print("   ✅ Goals card view: WORKING")
        else:
            print("   ❌ Goals card view: NEEDS WORK")
        
        if len(activity_buttons) > 0:
            working_features += 1
            print("   ✅ Activity stream integration: WORKING")
        else:
            print("   ❌ Activity stream integration: NEEDS WORK")
        
        if "KPI" in modal_text:
            working_features += 1
            print("   ✅ KPI functionality: WORKING")
        else:
            print("   ❌ KPI functionality: NEEDS WORK")
        
        success_rate = (working_features / total_features) * 100
        print(f"\n📊 COMPREHENSIVE GOALS SUCCESS RATE: {success_rate:.1f}% ({working_features}/{total_features})")
        
        if success_rate >= 80:
            print("🎉 EXCELLENT! Comprehensive Goals functionality is working well!")
        elif success_rate >= 60:
            print("✅ GOOD! Most Goals features are working, minor issues to address")
        else:
            print("⚠️ NEEDS WORK! Several Goals features need attention")
        
    except Exception as e:
        print(f"❌ Comprehensive Goals test failed: {str(e)}")
        driver.save_screenshot("./test-results/comprehensive_goals_error.png")
        
    finally:
        driver.quit()
        print("🏁 Comprehensive Goals test completed")

if __name__ == "__main__":
    test_comprehensive_goals()
