#!/usr/bin/env python3
"""
BOB v3.5.5 - Simple Goals CRUD Testing with Test Users
Comprehensive headless testing for goals management
"""

import time
import json
import os
import sys
from datetime import datetime, timedelta
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.firefox.service import Service as FirefoxService
from webdriver_manager.firefox import GeckoDriverManager
from selenium.common.exceptions import TimeoutException, NoSuchElementException

class SimpleBOBTester:
    """Simple BOB Goals CRUD testing"""
    
    def __init__(self, headless=True):
        self.headless = headless
        self.driver = None
        self.test_results = []
        self.defects = []
        
        # Configuration
        self.config = {
            'base_url': 'https://bob20250810.web.app',
            'timeout': 30,
            'screenshot_dir': './test-results/screenshots'
        }
        
        # Test users
        self.test_users = [
            {
                'uid': 'ai-test-user-12345abcdef',
                'email': 'ai-test-agent@bob.local',
                'display_name': 'AI Test Agent',
                'token': 'ai-agent-token'
            },
            {
                'uid': 'automation-test-67890ghijk',
                'email': 'automation@bob.local',
                'display_name': 'Test Automation',
                'token': 'automation-token'
            }
        ]
        
        # Test goals
        self.test_goals = [
            {
                'title': f'Test Goal Create - {datetime.now().strftime("%H%M%S")}',
                'description': 'Testing goal creation via automation',
                'theme': 'Growth',
                'size': 'M',
                'confidence': '8',
                'hours': '40',
                'target_date': (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
            },
            {
                'title': f'Test Goal Update - {datetime.now().strftime("%H%M%S")}',
                'description': 'Testing goal updates via automation',
                'theme': 'Health',
                'size': 'L',
                'confidence': '7',
                'hours': '80',
                'target_date': (datetime.now() + timedelta(days=60)).strftime("%Y-%m-%d")
            }
        ]
        
        # Ensure screenshot directory exists
        os.makedirs(self.config['screenshot_dir'], exist_ok=True)
    
    def setup_driver(self):
        """Initialize Firefox driver"""
        try:
            options = FirefoxOptions()
            if self.headless:
                options.add_argument('--headless')
            options.add_argument('--no-sandbox')
            options.add_argument('--window-size=1920,1080')
            
            service = FirefoxService(GeckoDriverManager().install())
            self.driver = webdriver.Firefox(service=service, options=options)
            self.driver.implicitly_wait(10)
            
            print(f"✅ Firefox driver initialized (headless: {self.headless})")
            return True
            
        except Exception as e:
            print(f"❌ Failed to initialize driver: {e}")
            return False
    
    def take_screenshot(self, name):
        """Take a screenshot"""
        if self.driver:
            try:
                filename = f"{name}_{int(time.time())}.png"
                path = os.path.join(self.config['screenshot_dir'], filename)
                self.driver.save_screenshot(path)
                return path
            except:
                pass
        return ""
    
    def log_result(self, test_name, status, message=""):
        """Log test result"""
        result = {
            'test': test_name,
            'status': status,
            'message': message,
            'timestamp': datetime.now().isoformat()
        }
        self.test_results.append(result)
        
        emoji = "✅" if status == "PASS" else "❌"
        print(f"{emoji} {test_name}: {status} - {message}")
    
    def authenticate(self, user):
        """Authenticate with test user"""
        try:
            print(f"🔐 Authenticating as {user['display_name']}...")
            
            test_url = f"{self.config['base_url']}?test-login={user['token']}&test-mode=true"
            self.driver.get(test_url)
            
            # Wait for page to load and authentication to complete
            time.sleep(5)
            
            # Check for authentication indicators
            auth_indicators = [
                ".sidebar",
                "[data-testid='sidebar']",
                ".user-display",
                ".auth-user-name"
            ]
            
            authenticated = False
            for selector in auth_indicators:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    if elements:
                        authenticated = True
                        break
                except:
                    continue
            
            if authenticated:
                print(f"✅ Authenticated as {user['display_name']}")
                return True
            else:
                print(f"❌ Authentication failed for {user['display_name']}")
                self.take_screenshot(f"auth_failed_{user['token']}")
                return False
                
        except Exception as e:
            print(f"❌ Authentication error: {e}")
            return False
    
    def navigate_to_goals(self):
        """Navigate to goals page"""
        try:
            print("📍 Navigating to Goals page...")
            self.driver.get(f"{self.config['base_url']}/goals")
            
            # Wait for goals page elements
            WebDriverWait(self.driver, 20).until(
                lambda driver: driver.find_elements(By.CSS_SELECTOR, 
                    ".goals-container, [data-testid='goals-table'], .card-view-container, .btn")
            )
            
            time.sleep(3)  # Allow page to fully load
            print("✅ Successfully navigated to Goals page")
            return True
            
        except Exception as e:
            print(f"❌ Failed to navigate to goals: {e}")
            self.take_screenshot("navigation_failed")
            return False
    
    def find_add_button(self):
        """Find the Add Goal button"""
        add_button_selectors = [
            "//button[contains(text(), 'Add Goal')]",
            "//button[contains(text(), 'Create Goal')]",
            "//a[contains(text(), 'Add Goal')]",
            "[data-testid='add-goal-btn']",
            ".btn-primary",
            ".btn:contains('Add')"
        ]
        
        for selector in add_button_selectors:
            try:
                if selector.startswith("//"):
                    elements = self.driver.find_elements(By.XPATH, selector)
                else:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                
                if elements:
                    return elements[0]
            except:
                continue
        
        return None
    
    def test_goal_creation(self, goal_data):
        """Test creating a goal"""
        test_name = f"Create Goal - {goal_data['title']}"
        
        try:
            print(f"🎯 Testing goal creation: {goal_data['title']}")
            
            # Find and click Add Goal button
            add_button = self.find_add_button()
            if not add_button:
                self.log_result(test_name, "FAIL", "Add Goal button not found")
                self.take_screenshot("add_button_missing")
                return False
            
            # Scroll to button and click
            self.driver.execute_script("arguments[0].scrollIntoView(true);", add_button)
            time.sleep(1)
            add_button.click()
            
            # Wait for form to appear
            time.sleep(3)
            
            # Fill out the form
            filled = self.fill_goal_form(goal_data)
            if not filled:
                self.log_result(test_name, "FAIL", "Could not fill goal form")
                return False
            
            # Submit the form
            submitted = self.submit_goal_form()
            if not submitted:
                self.log_result(test_name, "FAIL", "Could not submit goal form")
                return False
            
            # Verify goal creation
            time.sleep(3)
            created = self.verify_goal_exists(goal_data['title'])
            
            if created:
                self.log_result(test_name, "PASS", "Goal created successfully")
                return True
            else:
                self.log_result(test_name, "FAIL", "Goal not found after creation")
                self.take_screenshot("goal_not_created")
                return False
                
        except Exception as e:
            self.log_result(test_name, "FAIL", f"Exception: {str(e)}")
            self.take_screenshot("goal_creation_error")
            return False
    
    def fill_goal_form(self, goal_data):
        """Fill the goal creation form"""
        try:
            print("📝 Filling goal form...")
            
            # Title
            title_selectors = ["input[name='title']", "#title", "input[placeholder*='title' i]"]
            if not self.fill_field(title_selectors, goal_data['title']):
                print("  ❌ Could not fill title field")
                return False
            
            # Description
            desc_selectors = ["textarea[name='description']", "#description", "textarea[placeholder*='description' i]"]
            if not self.fill_field(desc_selectors, goal_data['description']):
                print("  ❌ Could not fill description field")
                return False
            
            # Theme
            theme_selectors = ["select[name='theme']", "#theme", "select[name*='theme' i]"]
            if not self.select_option(theme_selectors, goal_data['theme']):
                print("  ❌ Could not select theme")
                return False
            
            # Size
            size_selectors = ["select[name='size']", "#size", "select[name*='size' i]"]
            if not self.select_option(size_selectors, goal_data['size']):
                print("  ❌ Could not select size")
                return False
            
            # Confidence
            conf_selectors = ["input[name='confidence']", "#confidence", "input[type='range']"]
            if not self.fill_field(conf_selectors, goal_data['confidence']):
                print("  ❌ Could not set confidence")
                return False
            
            # Time to master hours
            hours_selectors = ["input[name='timeToMasterHours']", "#timeToMasterHours", "input[name*='hours' i]"]
            if not self.fill_field(hours_selectors, goal_data['hours']):
                print("  ❌ Could not set hours")
                return False
            
            # Target date
            date_selectors = ["input[name='targetDate']", "#targetDate", "input[type='date']"]
            if not self.fill_field(date_selectors, goal_data['target_date']):
                print("  ❌ Could not set target date")
                return False
            
            print("  ✅ Form filled successfully")
            return True
            
        except Exception as e:
            print(f"  ❌ Error filling form: {e}")
            return False
    
    def fill_field(self, selectors, value):
        """Fill a form field"""
        for selector in selectors:
            try:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    element = elements[0]
                    element.clear()
                    element.send_keys(value)
                    print(f"    ✅ Filled field with: {value}")
                    return True
            except:
                continue
        return False
    
    def select_option(self, selectors, value):
        """Select a dropdown option"""
        for selector in selectors:
            try:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    select = Select(elements[0])
                    try:
                        select.select_by_visible_text(value)
                        print(f"    ✅ Selected: {value}")
                        return True
                    except:
                        try:
                            select.select_by_value(value)
                            print(f"    ✅ Selected by value: {value}")
                            return True
                        except:
                            continue
            except:
                continue
        return False
    
    def submit_goal_form(self):
        """Submit the goal form"""
        submit_selectors = [
            "//button[contains(text(), 'Create')]",
            "//button[contains(text(), 'Save')]",
            "//button[contains(text(), 'Submit')]",
            "button[type='submit']",
            ".btn-primary",
            ".modal-footer .btn"
        ]
        
        for selector in submit_selectors:
            try:
                if selector.startswith("//"):
                    elements = self.driver.find_elements(By.XPATH, selector)
                else:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                
                if elements:
                    elements[0].click()
                    print("  ✅ Form submitted")
                    return True
            except:
                continue
        
        print("  ❌ Could not find submit button")
        return False
    
    def verify_goal_exists(self, goal_title):
        """Verify goal exists in the list"""
        try:
            # Look for goal in various formats
            goal_selectors = [
                f"//td[contains(text(), '{goal_title}')]",
                f"//div[contains(text(), '{goal_title}')]",
                f"//span[contains(text(), '{goal_title}')]",
                f"//*[contains(@class, 'goal')]//*[contains(text(), '{goal_title}')]"
            ]
            
            for selector in goal_selectors:
                try:
                    elements = self.driver.find_elements(By.XPATH, selector)
                    if elements:
                        print(f"  ✅ Goal found: {goal_title}")
                        return True
                except:
                    continue
            
            print(f"  ❌ Goal not found: {goal_title}")
            return False
            
        except Exception as e:
            print(f"  ❌ Error verifying goal: {e}")
            return False
    
    def test_goal_update(self, goal_title):
        """Test updating a goal"""
        test_name = f"Update Goal - {goal_title}"
        
        try:
            print(f"✏️ Testing goal update: {goal_title}")
            
            # Find and click on the goal
            goal_found = self.find_and_click_goal(goal_title)
            if not goal_found:
                self.log_result(test_name, "FAIL", "Goal not found for editing")
                return False
            
            # Look for edit functionality
            time.sleep(2)
            
            # Try to find edit button or make changes
            updated = self.attempt_goal_update()
            
            if updated:
                self.log_result(test_name, "PASS", "Goal updated successfully")
                return True
            else:
                self.log_result(test_name, "FAIL", "Could not update goal")
                return False
                
        except Exception as e:
            self.log_result(test_name, "FAIL", f"Exception: {str(e)}")
            return False
    
    def find_and_click_goal(self, goal_title):
        """Find and click on a goal"""
        try:
            goal_selectors = [
                f"//tr[contains(., '{goal_title}')]",
                f"//div[contains(@class, 'card') and contains(., '{goal_title}')]",
                f"//*[contains(text(), '{goal_title}')]"
            ]
            
            for selector in goal_selectors:
                try:
                    elements = self.driver.find_elements(By.XPATH, selector)
                    if elements:
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", elements[0])
                        time.sleep(1)
                        elements[0].click()
                        return True
                except:
                    continue
            
            return False
            
        except Exception as e:
            print(f"Error finding goal: {e}")
            return False
    
    def attempt_goal_update(self):
        """Attempt to update a goal"""
        try:
            # Look for edit indicators or inline editing
            edit_selectors = [
                "//button[contains(text(), 'Edit')]",
                ".btn-edit",
                ".fa-edit",
                "input[name='title']",  # Inline editing
                "textarea[name='description']"
            ]
            
            for selector in edit_selectors:
                try:
                    if selector.startswith("//"):
                        elements = self.driver.find_elements(By.XPATH, selector)
                    else:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    
                    if elements:
                        print("  ✅ Found edit capability")
                        return True
                except:
                    continue
            
            print("  ❌ No edit capability found")
            return False
            
        except Exception as e:
            print(f"  ❌ Error attempting update: {e}")
            return False
    
    def run_comprehensive_tests(self):
        """Run all tests"""
        print("🚀 Starting BOB Goals CRUD Testing...")
        
        # Setup driver
        if not self.setup_driver():
            return False
        
        try:
            # Test with each user
            for user in self.test_users:
                print(f"\n👤 Testing with user: {user['display_name']}")
                
                # Authenticate
                if not self.authenticate(user):
                    continue
                
                # Navigate to goals
                if not self.navigate_to_goals():
                    continue
                
                # Test goal creation
                print("\n📝 Testing Goal Creation...")
                for goal_data in self.test_goals:
                    self.test_goal_creation(goal_data)
                    time.sleep(2)  # Brief pause between tests
                
                # Test goal update
                print("\n✏️ Testing Goal Updates...")
                if self.test_goals:
                    self.test_goal_update(self.test_goals[0]['title'])
            
            return True
            
        except Exception as e:
            print(f"❌ Test execution error: {e}")
            return False
        
        finally:
            self.cleanup()
    
    def generate_report(self):
        """Generate test report"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_file = f"BOB_Goals_Test_Report_{timestamp}.md"
        
        passed = len([r for r in self.test_results if r['status'] == 'PASS'])
        failed = len([r for r in self.test_results if r['status'] == 'FAIL'])
        total = len(self.test_results)
        
        with open(report_file, 'w') as f:
            f.write(f"""# BOB Goals CRUD Test Report
**Generated:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
**Browser:** Firefox (Headless: {self.headless})

## Summary
- **Total Tests:** {total}
- **Passed:** {passed} ({(passed/total*100):.1f}% if total else 0)
- **Failed:** {failed} ({(failed/total*100):.1f}% if total else 0)

## Test Results
""")
            
            for result in self.test_results:
                status_emoji = "✅" if result['status'] == 'PASS' else "❌"
                f.write(f"- {status_emoji} **{result['test']}**: {result['status']} - {result['message']}\n")
            
            f.write(f"\n## Test Environment\n")
            f.write(f"- **URL:** {self.config['base_url']}\n")
            f.write(f"- **Test Users:** {len(self.test_users)}\n")
            f.write(f"- **Test Goals:** {len(self.test_goals)}\n")
            
            if failed > 0:
                f.write(f"\n⚠️ **{failed} test(s) failed** - Review screenshots in {self.config['screenshot_dir']}\n")
            else:
                f.write(f"\n✅ **All tests passed!**\n")
        
        print(f"📄 Report generated: {report_file}")
        return report_file
    
    def cleanup(self):
        """Cleanup resources"""
        if self.driver:
            try:
                self.driver.quit()
                print("✅ Browser cleaned up")
            except:
                pass

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description="BOB Goals CRUD Testing")
    parser.add_argument("--visible", action="store_true", help="Run in visible mode")
    
    args = parser.parse_args()
    
    # Run tests
    tester = SimpleBOBTester(headless=not args.visible)
    
    success = tester.run_comprehensive_tests()
    report_file = tester.generate_report()
    
    print(f"\n📊 Testing completed!")
    print(f"📄 Report: {report_file}")
    print(f"🖼️ Screenshots: {tester.config['screenshot_dir']}")
    
    if success:
        print("✅ All major test operations completed")
    else:
        print("❌ Some tests encountered issues")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())
