#!/usr/bin/env python3
"""
BOB v3.5.5 - Simple Goals CRUD Testing
Headless testing for goals management without complex typing
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
    """Simple BOB Goals CRUD testing without complex type annotations"""
    
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
        
        # Test users with email/password authentication
        self.test_users = [
            {
                'uid': 'ai-test-user-12345abcdef',
                'email': 'ai-test-agent@bob.local',
                'password': 'TestPassword123!',
                'display_name': 'AI Test Agent',
                'token': 'ai-agent-token'
            },
            {
                'uid': 'automation-test-67890ghijk',
                'email': 'automation@bob.local',
                'password': 'AutomationPass456!',
                'display_name': 'Test Automation User',
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
    
    def safe_find_elements(self, by_method, selector):
        """Safely find elements without throwing exceptions"""
        try:
            if self.driver:
                return self.driver.find_elements(by_method, selector)
        except:
            pass
        return []
    
    def safe_find_element(self, by_method, selector):
        """Safely find single element"""
        try:
            if self.driver:
                return self.driver.find_element(by_method, selector)
        except:
            pass
        return None
    
    def take_screenshot(self, name):
        """Take a screenshot"""
        try:
            if self.driver:
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
        """Authenticate with test user using side-door authentication"""
        try:
            print(f"🔐 Authenticating as {user['display_name']}...")
            
            if not self.driver:
                return False
            
            # Use side-door authentication with proper token
            print(f"🚪 Using side-door authentication with token: {user['token'][:10]}...")
            test_url = f"{self.config['base_url']}?test-login={user['token']}&test-mode=true"
            
            print(f"🌐 Navigating to: {test_url}")
            self.driver.get(test_url)
            
            # Wait for initial page load
            print("⏳ Waiting for page to load...")
            time.sleep(8)
            
            # Navigate directly to goals page to test access
            goals_url = f"{self.config['base_url']}/goals"
            print(f"🎯 Testing access to goals page: {goals_url}")
            self.driver.get(goals_url)
            time.sleep(8)
            
            current_url = self.driver.current_url
            page_title = self.driver.title
            print(f"📍 Goals page URL: {current_url}")
            print(f"📄 Page title: {page_title}")
            
            # Check if we can access goals content (the key test)
            page_source = self.driver.page_source.lower()
            goals_content_indicators = [
                'goal', 'add goal', 'create goal', 'goals', 'task', 'priority'
            ]
            
            found_content = []
            for indicator in goals_content_indicators:
                if indicator in page_source:
                    found_content.append(indicator)
            
            print(f"🔍 Goals content found: {found_content}")
            
            # Check for interactive elements that suggest we can use the app
            interactive_selectors = [
                # Goal creation/management
                "button:contains('Add')", "button:contains('Create')", 
                "button:contains('New')", ".add-button", ".create-button",
                # Input fields
                "input[type='text']", "textarea", ".input", 
                # Navigation elements
                ".sidebar", ".nav", ".menu", ".tab",
                # Content areas
                ".goals", ".goal-item", ".task", ".content-area"
            ]
            
            interactive_elements = []
            for selector in interactive_selectors:
                try:
                    if ":contains(" in selector:
                        # Convert to XPath for text search
                        text = selector.split("'")[1]
                        elements = self.safe_find_elements(By.XPATH, f"//button[contains(text(), '{text}')]")
                    else:
                        elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                    
                    if elements:
                        interactive_elements.append(selector)
                        print(f"  ✅ Found interactive element: {selector}")
                except Exception:
                    pass
            
            # Determine if we have functional access
            has_content = len(found_content) >= 2  # At least 2 content indicators
            has_interactivity = len(interactive_elements) >= 1  # At least 1 interactive element
            can_access_goals = 'goals' in current_url.lower() or has_content
            
            print(f"📊 Authentication Assessment:")
            print(f"  📄 Content indicators: {len(found_content)}/6")
            print(f"  🎛️  Interactive elements: {len(interactive_elements)}")
            print(f"  🎯 Can access goals: {can_access_goals}")
            
            if can_access_goals and (has_content or has_interactivity):
                print(f"✅ Functional authentication successful for {user['display_name']}")
                print("💡 App content is accessible - proceeding with CRUD testing")
                return True
            else:
                print(f"❌ Authentication failed for {user['display_name']}")
                print("🔍 Taking screenshot for debugging...")
                self.take_screenshot(f"auth_failed_{user['token'][:8]}")
                
                # Additional debugging info
                if 'goals' not in current_url.lower():
                    print("🔍 Could not navigate to goals page")
                if not found_content:
                    print("🔍 No goals-related content found")
                if not interactive_elements:
                    print("🔍 No interactive elements found")
                
                return False
                
        except Exception as e:
            print(f"❌ Authentication error: {e}")
            self.take_screenshot(f"auth_error_{user.get('token', 'unknown')[:8]}")
            return False
    
    def authenticate_email_password(self, user):
        """Authenticate using email/password form"""
        try:
            if not self.driver:
                print("❌ WebDriver not available for email/password auth")
                return False
                
            # Navigate to login page
            self.driver.get(f"{self.config['base_url']}/login")
            time.sleep(3)
            
            # Look for email input field
            email_selectors = [
                "input[type='email']",
                "input[name='email']",
                "#email",
                "input[placeholder*='email' i]"
            ]
            
            email_field = None
            for selector in email_selectors:
                elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    email_field = elements[0]
                    break
            
            if not email_field:
                print("❌ Email field not found")
                return False
            
            # Fill email
            email_field.clear()
            email_field.send_keys(user['email'])
            
            # Look for password field
            password_selectors = [
                "input[type='password']",
                "input[name='password']",
                "#password",
                "input[placeholder*='password' i]"
            ]
            
            password_field = None
            for selector in password_selectors:
                elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    password_field = elements[0]
                    break
            
            if not password_field:
                print("❌ Password field not found")
                return False
            
            # Fill password
            password_field.clear()
            password_field.send_keys(user['password'])
            
            # Look for login button
            login_selectors = [
                "button[type='submit']",
                "input[type='submit']",
                "button:contains('Login')",
                "button:contains('Sign In')",
                ".btn-primary"
            ]
            
            login_button = None
            for selector in login_selectors:
                if "contains" in selector:
                    elements = self.safe_find_elements(By.XPATH, f"//button[contains(text(), 'Login') or contains(text(), 'Sign In')]")
                else:
                    elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                
                if elements:
                    login_button = elements[0]
                    break
            
            if not login_button:
                print("❌ Login button not found")
                return False
            
            # Click login
            login_button.click()
            time.sleep(5)
            
            # Check if authenticated
            auth_indicators = [
                ".sidebar",
                "[data-testid='sidebar']",
                ".user-display",
                ".auth-user-name",
                ".user-menu"
            ]
            
            for selector in auth_indicators:
                elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    print(f"✅ Authenticated as {user['display_name']} (email/password)")
                    return True
            
            print("❌ Email/password authentication failed")
            return False
            
        except Exception as e:
            print(f"❌ Email/password authentication error: {e}")
            return False
    
    def navigate_to_goals(self):
        """Navigate to goals page"""
        try:
            print("📍 Navigating to Goals page...")
            
            if not self.driver:
                return False
            
            self.driver.get(f"{self.config['base_url']}/goals")
            
            # Wait for goals page elements
            time.sleep(5)
            
            # Check for goals page indicators
            goals_indicators = [
                ".goals-container",
                "[data-testid='goals-table']", 
                ".card-view-container",
                ".btn"
            ]
            
            page_loaded = False
            for selector in goals_indicators:
                elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    page_loaded = True
                    break
            
            if page_loaded:
                print("✅ Successfully navigated to Goals page")
                return True
            else:
                print("❌ Failed to load Goals page")
                self.take_screenshot("navigation_failed")
                return False
            
        except Exception as e:
            print(f"❌ Failed to navigate to goals: {e}")
            self.take_screenshot("navigation_failed")
            return False
    
    def find_add_button(self):
        """Find the Add Goal button"""
        if not self.driver:
            return None
        
        add_button_selectors = [
            "//button[contains(text(), 'Add Goal')]",
            "//button[contains(text(), 'Create Goal')]",
            "//a[contains(text(), 'Add Goal')]",
            "[data-testid='add-goal-btn']",
            ".btn-primary"
        ]
        
        for selector in add_button_selectors:
            try:
                if selector.startswith("//"):
                    elements = self.safe_find_elements(By.XPATH, selector)
                else:
                    elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                
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
            
            if not self.driver:
                self.log_result(test_name, "FAIL", "Driver not available")
                return False
            
            # Find and click Add Goal button
            add_button = self.find_add_button()
            if not add_button:
                self.log_result(test_name, "FAIL", "Add Goal button not found")
                self.take_screenshot("add_button_missing")
                return False
            
            # Scroll to button and click
            try:
                self.driver.execute_script("arguments[0].scrollIntoView(true);", add_button)
                time.sleep(1)
                add_button.click()
            except:
                self.log_result(test_name, "FAIL", "Could not click Add Goal button")
                return False
            
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
            
            if not self.driver:
                return False
            
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
            
            print("  ✅ Form filled successfully")
            return True
            
        except Exception as e:
            print(f"  ❌ Error filling form: {e}")
            return False
    
    def fill_field(self, selectors, value):
        """Fill a form field"""
        if not self.driver:
            return False
        
        for selector in selectors:
            elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
            if elements:
                try:
                    element = elements[0]
                    element.clear()
                    element.send_keys(value)
                    print(f"    ✅ Filled field with: {value}")
                    return True
                except:
                    continue
        return False
    
    def submit_goal_form(self):
        """Submit the goal form"""
        if not self.driver:
            return False
        
        submit_selectors = [
            "//button[contains(text(), 'Create')]",
            "//button[contains(text(), 'Save')]",
            "//button[contains(text(), 'Submit')]",
            "button[type='submit']",
            ".btn-primary"
        ]
        
        for selector in submit_selectors:
            try:
                if selector.startswith("//"):
                    elements = self.safe_find_elements(By.XPATH, selector)
                else:
                    elements = self.safe_find_elements(By.CSS_SELECTOR, selector)
                
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
            if not self.driver:
                return False
            
            # Look for goal in various formats
            goal_selectors = [
                f"//td[contains(text(), '{goal_title}')]",
                f"//div[contains(text(), '{goal_title}')]",
                f"//span[contains(text(), '{goal_title}')]",
                f"//*[contains(@class, 'goal')]//*[contains(text(), '{goal_title}')]"
            ]
            
            for selector in goal_selectors:
                elements = self.safe_find_elements(By.XPATH, selector)
                if elements:
                    print(f"  ✅ Goal found: {goal_title}")
                    return True
            
            print(f"  ❌ Goal not found: {goal_title}")
            return False
            
        except Exception as e:
            print(f"  ❌ Error verifying goal: {e}")
            return False
    
    def run_comprehensive_tests(self):
        """Run all tests"""
        print("🚀 Starting BOB Goals CRUD Testing...")
        
        # Setup driver
        if not self.setup_driver():
            return False
        
        try:
            # Test with the first user
            user = self.test_users[0]
            print(f"\n👤 Testing with user: {user['display_name']}")
            
            # Authenticate
            if not self.authenticate(user):
                return False
            
            # Navigate to goals
            if not self.navigate_to_goals():
                return False
            
            # Test goal creation
            print("\n📝 Testing Goal Creation...")
            for goal_data in self.test_goals:
                self.test_goal_creation(goal_data)
                time.sleep(2)
            
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
- **Passed:** {passed} ({(passed/total*100):.1f}% if total > 0 else 0)
- **Failed:** {failed} ({(failed/total*100):.1f}% if total > 0 else 0)

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
