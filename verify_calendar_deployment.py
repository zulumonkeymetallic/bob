#!/usr/bin/env python3
"""
BOB v3.5.0 Calendar Sync Integration Manual Verification
Simple test to verify the calendar sync features are deployed
"""

import sys
import time
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
    
    try:
        driver = webdriver.Chrome(options=chrome_options)
        return driver
    except Exception as e:
        print(f"❌ Failed to setup Chrome driver: {e}")
        sys.exit(1)

def test_calendar_integration_deployed(driver):
    """Test if calendar integration features are deployed"""
    print("🔍 Checking Calendar Integration Deployment...")
    
    driver.get("https://bob20250810.web.app")
    
    try:
        # Wait for page to load
        WebDriverWait(driver, 15).until(
            EC.any_of(
                EC.presence_of_element_located((By.TAG_NAME, "body")),
                EC.presence_of_element_located((By.XPATH, "//div"))
            )
        )
        
        # Get page source to search for calendar integration features
        page_source = driver.page_source.lower()
        
        calendar_features_found = {
            'schedule_time_blocks': 'schedule time blocks' in page_source,
            'calendar_planning': 'calendar planning' in page_source or 'ai calendar' in page_source,
            'time_allocation': 'time allocation' in page_source or 'minutes allocated' in page_source,
            'goal_scheduling': 'goal scheduling' in page_source or 'schedule goal' in page_source,
            'calendar_sync': 'calendar sync' in page_source or 'google calendar' in page_source,
            'time_blocks': 'time blocks' in page_source,
            'focus_goal': 'focus goal' in page_source or 'focusgoalid' in page_source,
            'calendar_status': 'calendar status' in page_source or 'sync status' in page_source
        }
        
        print("\n📊 Calendar Integration Features Detection:")
        for feature, found in calendar_features_found.items():
            status = "✅" if found else "❌"
            print(f"   {status} {feature.replace('_', ' ').title()}: {found}")
        
        # Count deployed features
        deployed_features = sum(calendar_features_found.values())
        total_features = len(calendar_features_found)
        deployment_rate = (deployed_features / total_features) * 100
        
        print(f"\n📈 Deployment Status: {deployed_features}/{total_features} features detected ({deployment_rate:.1f}%)")
        
        # Look for specific calendar-related components
        print("\n🔍 Searching for Calendar Components...")
        
        calendar_components = {
            'CalendarSyncManager': 'calendarsyncmanager' in page_source,
            'CalendarPlus Icon': 'calendarplus' in page_source,
            'Clock Icon': 'clock' in page_source and 'icon' in page_source,
            'Schedule Function': 'schedulegoaltime' in page_source,
            'Calendar Blocks': 'calendar_blocks' in page_source,
            'AI Planning': 'plancalendar' in page_source
        }
        
        for component, found in calendar_components.items():
            status = "✅" if found else "❌"
            print(f"   {status} {component}: {found}")
        
        component_deployment = sum(calendar_components.values())
        component_total = len(calendar_components)
        component_rate = (component_deployment / component_total) * 100
        
        print(f"\n🧩 Component Status: {component_deployment}/{component_total} components detected ({component_rate:.1f}%)")
        
        # Overall assessment
        overall_rate = (deployed_features + component_deployment) / (total_features + component_total) * 100
        
        print(f"\n🎯 Overall Calendar Integration Deployment: {overall_rate:.1f}%")
        
        if overall_rate >= 70:
            print("✅ CALENDAR SYNC INTEGRATION SUCCESSFULLY DEPLOYED!")
        elif overall_rate >= 50:
            print("⚠️ Calendar sync integration partially deployed")
        else:
            print("❌ Calendar sync integration deployment incomplete")
        
        return {
            'features': calendar_features_found,
            'components': calendar_components,
            'deployment_rate': overall_rate
        }
        
    except Exception as e:
        print(f"❌ Error checking deployment: {e}")
        return None

def main():
    """Main test function"""
    print("🚀 BOB v3.5.0 Calendar Sync Integration Deployment Check")
    print("=" * 60)
    
    driver = setup_driver()
    
    try:
        results = test_calendar_integration_deployed(driver)
        
        if results:
            print(f"\n📋 DEPLOYMENT VERIFICATION COMPLETE")
            print(f"🔗 BOB Platform: https://bob20250810.web.app")
            print(f"📊 Success Rate: {results['deployment_rate']:.1f}%")
        else:
            print("❌ Deployment verification failed")
            
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        
    finally:
        driver.quit()
        print("\n🏁 Verification completed")

if __name__ == "__main__":
    main()
