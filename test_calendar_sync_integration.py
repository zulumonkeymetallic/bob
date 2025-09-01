#!/usr/bin/env python3
"""
BOB v3.5.0 Calendar Sync Integration Test Script
Tests the enhanced calendar sync features with goal-focused scheduling
"""

import sys
import time
import json
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException

def setup_driver():
    """Setup Chrome WebDriver"""
    chrome_options = Options()
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_options.add_experimental_option('useAutomationExtension', False)
    
    try:
        driver = webdriver.Chrome(options=chrome_options)
        driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        return driver
    except Exception as e:
        print(f"❌ Failed to setup Chrome driver: {e}")
        sys.exit(1)

def login_to_bob(driver):
    """Login to BOB platform"""
    print("🔐 Logging into BOB platform...")
    
    driver.get("https://bob20250810.web.app")
    
    try:
        # Wait for login button and click
        login_button = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Sign in with Google')]"))
        )
        login_button.click()
        
        # Wait for successful login (dashboard or main content)
        WebDriverWait(driver, 30).until(
            EC.any_of(
                EC.presence_of_element_located((By.CLASS_NAME, "dashboard")),
                EC.presence_of_element_located((By.XPATH, "//h1[contains(text(), 'BOB')]")),
                EC.presence_of_element_located((By.CLASS_NAME, "goal-card")),
                EC.presence_of_element_located((By.XPATH, "//div[contains(@class, 'sidebar')]"))
            )
        )
        
        print("✅ Successfully logged in to BOB")
        return True
        
    except TimeoutException:
        print("❌ Login timeout or failed")
        return False

def test_goals_with_calendar_integration(driver):
    """Test Goals management with calendar sync features"""
    print("\n🎯 Testing Goals with Calendar Integration...")
    
    try:
        # Navigate to Goals section
        goals_nav = driver.find_element(By.XPATH, "//a[contains(text(), 'Goals') or contains(@href, 'goals')]")
        goals_nav.click()
        
        time.sleep(3)
        
        # Count goal cards
        goal_cards = driver.find_elements(By.XPATH, "//div[contains(@class, 'card')]//h5")
        print(f"📊 Found {len(goal_cards)} goal cards")
        
        calendar_features = {
            'time_allocations': 0,
            'schedule_buttons': 0,
            'calendar_status': 0,
            'dropdown_calendar_options': 0
        }
        
        # Check for time allocation displays
        time_elements = driver.find_elements(By.XPATH, "//span[contains(text(), 'minutes allocated') or contains(text(), 'This Week')]")
        calendar_features['time_allocations'] = len(time_elements)
        print(f"⏰ Time allocation displays found: {calendar_features['time_allocations']}")
        
        # Look for calendar sync status alerts
        calendar_alerts = driver.find_elements(By.XPATH, "//div[contains(@class, 'alert')][contains(text(), 'scheduled') or contains(text(), 'calendar') or contains(text(), 'time blocks')]")
        calendar_features['calendar_status'] = len(calendar_alerts)
        print(f"📅 Calendar status alerts found: {calendar_features['calendar_status']}")
        
        # Test dropdown menus for calendar options
        dropdown_toggles = driver.find_elements(By.XPATH, "//button[contains(@class, 'dropdown-toggle')]")
        for i, toggle in enumerate(dropdown_toggles[:3]):  # Test first 3 dropdowns
            try:
                driver.execute_script("arguments[0].click();", toggle)
                time.sleep(1)
                
                # Look for calendar/schedule options
                schedule_items = driver.find_elements(By.XPATH, "//a[contains(text(), 'Schedule') or contains(text(), 'Calendar') or contains(text(), 'Time Blocks')]")
                if schedule_items:
                    calendar_features['dropdown_calendar_options'] += len(schedule_items)
                    print(f"📋 Calendar option found in dropdown {i+1}")
                
                # Close dropdown
                driver.execute_script("arguments[0].click();", toggle)
                time.sleep(0.5)
                
            except Exception as e:
                print(f"⚠️ Could not test dropdown {i+1}: {e}")
        
        print(f"📋 Calendar options in dropdowns: {calendar_features['dropdown_calendar_options']}")
        
        # Test creating a new goal with calendar features
        try:
            add_goal_button = driver.find_element(By.XPATH, "//button[contains(text(), 'Add Goal') or contains(text(), '+ Goal')]")
            add_goal_button.click()
            
            time.sleep(2)
            
            # Check for enhanced modal with calendar-related fields
            time_to_master_field = driver.find_elements(By.XPATH, "//input[@placeholder*='hours' or @placeholder*='time']")
            if time_to_master_field:
                print("✅ Time to master field found in goal creation")
                calendar_features['time_to_master_field'] = True
            
            # Close modal
            close_button = driver.find_element(By.XPATH, "//button[contains(text(), 'Cancel') or contains(@class, 'btn-close')]")
            close_button.click()
            
        except Exception as e:
            print(f"⚠️ Could not test goal creation modal: {e}")
        
        # Test calendar sync by finding a "Schedule Time Blocks" button
        try:
            # First try to find and click a dropdown to expose the schedule option
            first_dropdown = driver.find_element(By.XPATH, "//button[contains(@class, 'dropdown-toggle')]")
            driver.execute_script("arguments[0].click();", first_dropdown)
            time.sleep(1)
            
            schedule_button = driver.find_element(By.XPATH, "//a[contains(text(), 'Schedule Time Blocks')]")
            if schedule_button:
                print("✅ Found 'Schedule Time Blocks' option")
                calendar_features['schedule_buttons'] = 1
                
                # Click it to test functionality
                schedule_button.click()
                time.sleep(3)
                
                # Look for loading or status messages
                status_messages = driver.find_elements(By.XPATH, "//*[contains(text(), 'Scheduling') or contains(text(), 'AI is analyzing') or contains(text(), 'time blocks')]")
                if status_messages:
                    print("✅ Calendar scheduling initiated successfully")
                    calendar_features['scheduling_initiated'] = True
                
                time.sleep(5)  # Wait for potential completion
                
        except Exception as e:
            print(f"⚠️ Could not test calendar scheduling: {e}")
        
        # Summary of calendar integration features
        total_features = sum([
            calendar_features['time_allocations'] > 0,
            calendar_features['schedule_buttons'] > 0,
            calendar_features['dropdown_calendar_options'] > 0,
            calendar_features.get('time_to_master_field', False),
            calendar_features.get('scheduling_initiated', False)
        ])
        
        print(f"\n📈 Calendar Integration Test Results:")
        print(f"   Time allocations displayed: {calendar_features['time_allocations']}")
        print(f"   Schedule buttons available: {calendar_features['schedule_buttons']}")
        print(f"   Calendar dropdown options: {calendar_features['dropdown_calendar_options']}")
        print(f"   Enhanced goal creation: {calendar_features.get('time_to_master_field', False)}")
        print(f"   Scheduling functionality: {calendar_features.get('scheduling_initiated', False)}")
        print(f"   Total features working: {total_features}/5")
        
        return calendar_features
        
    except Exception as e:
        print(f"❌ Error testing goals with calendar integration: {e}")
        return {'error': str(e)}

def test_calendar_sync_manager(driver):
    """Test the Calendar Sync Manager component"""
    print("\n📅 Testing Calendar Sync Manager...")
    
    try:
        # Navigate to Calendar section
        calendar_nav = driver.find_element(By.XPATH, "//a[contains(text(), 'Calendar') or contains(@href, 'calendar')]")
        calendar_nav.click()
        
        time.sleep(3)
        
        calendar_features = {
            'ai_planning_section': False,
            'goal_focus_options': False,
            'time_block_display': False,
            'sync_status': False
        }
        
        # Look for AI planning section
        ai_sections = driver.find_elements(By.XPATH, "//*[contains(text(), 'AI Calendar Planning') or contains(text(), 'AI Planner')]")
        if ai_sections:
            calendar_features['ai_planning_section'] = True
            print("✅ AI Calendar Planning section found")
        
        # Look for goal-focused planning options
        goal_options = driver.find_elements(By.XPATH, "//*[contains(text(), 'Goal') and contains(text(), 'focus')]")
        if goal_options:
            calendar_features['goal_focus_options'] = True
            print("✅ Goal-focused planning options found")
        
        # Look for time blocks display
        time_blocks = driver.find_elements(By.XPATH, "//*[contains(text(), 'time block') or contains(text(), 'calendar block')]")
        if time_blocks:
            calendar_features['time_block_display'] = True
            print("✅ Time blocks display found")
        
        # Look for sync status indicators
        sync_status = driver.find_elements(By.XPATH, "//*[contains(text(), 'sync') or contains(text(), 'connected') or contains(text(), 'Google Calendar')]")
        if sync_status:
            calendar_features['sync_status'] = True
            print("✅ Calendar sync status indicators found")
        
        total_working = sum(calendar_features.values())
        print(f"\n📊 Calendar Sync Manager Results: {total_working}/4 features working")
        
        return calendar_features
        
    except Exception as e:
        print(f"❌ Error testing calendar sync manager: {e}")
        return {'error': str(e)}

def main():
    """Main test function"""
    print("🚀 BOB v3.5.0 Calendar Sync Integration Test")
    print("=" * 50)
    
    driver = setup_driver()
    
    try:
        # Login to BOB
        if not login_to_bob(driver):
            print("❌ Failed to login, exiting test")
            return
        
        time.sleep(3)
        
        # Test Goals with Calendar Integration
        goals_results = test_goals_with_calendar_integration(driver)
        
        # Test Calendar Sync Manager
        calendar_results = test_calendar_sync_manager(driver)
        
        # Final summary
        print("\n" + "="*50)
        print("🎯 CALENDAR SYNC INTEGRATION TEST SUMMARY")
        print("="*50)
        
        if 'error' not in goals_results:
            goals_score = sum([
                goals_results['time_allocations'] > 0,
                goals_results['schedule_buttons'] > 0,
                goals_results['dropdown_calendar_options'] > 0,
                goals_results.get('time_to_master_field', False),
                goals_results.get('scheduling_initiated', False)
            ])
            print(f"📈 Goals Calendar Integration: {goals_score}/5 features working")
        else:
            print(f"❌ Goals Calendar Integration: Error - {goals_results['error']}")
        
        if 'error' not in calendar_results:
            calendar_score = sum(calendar_results.values())
            print(f"📅 Calendar Sync Manager: {calendar_score}/4 features working")
        else:
            print(f"❌ Calendar Sync Manager: Error - {calendar_results['error']}")
        
        # Overall success rate
        if 'error' not in goals_results and 'error' not in calendar_results:
            total_score = goals_score + calendar_score
            max_score = 9  # 5 + 4
            success_rate = (total_score / max_score) * 100
            print(f"\n🎯 Overall Calendar Integration Success Rate: {success_rate:.1f}% ({total_score}/{max_score})")
            
            if success_rate >= 80:
                print("✅ CALENDAR SYNC INTEGRATION TEST PASSED!")
            elif success_rate >= 60:
                print("⚠️ Calendar sync integration partially working")
            else:
                print("❌ Calendar sync integration needs improvement")
        else:
            print("❌ Could not complete full calendar integration test")
        
        print("\n🔗 BOB Platform URL: https://bob20250810.web.app")
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        
    finally:
        driver.quit()
        print("\n🏁 Test completed")

if __name__ == "__main__":
    main()
